import { useEffect, useRef, useState } from "react";
import {
  displayChannelName,
  playerDisplaySchema,
  validDisplayId,
  type PlayerDisplayFrame,
} from "@/lib/quire/player-display";
import "./player-display.css";

/** This route intentionally mounts no account, campaign, economy, audio or notification providers. */
export function PlayerDisplay() {
  const [frame, setFrame] = useState<PlayerDisplayFrame | null>(null),
    [error, setError] = useState(""),
    [controls, setControls] = useState(true);
  const lastFrame = useRef(0),
    stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 }),
    [image, setImage] = useState({ width: 1, height: 1 });
  useEffect(() => {
    document.title = "Player display · Lootsplit";
    const id = location.hash.slice(1);
    if (!validDisplayId(id)) {
      setError("Open a player display from your DM’s Lootsplit window.");
      return;
    }
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(displayChannelName(id));
    } catch {
      setError("This browser cannot connect a player display. Use a supported desktop browser.");
      return;
    }
    let needsFrame = true;
    channel.onmessage = (event) => {
      if (event.data === "alive") {
        lastFrame.current = Date.now();
        return;
      }
      const next = playerDisplaySchema.safeParse(event.data);
      if (next.success) {
        needsFrame = false;
        lastFrame.current = Date.now();
        setFrame(next.data);
      }
    };
    channel.postMessage("ready");
    const heartbeat = setInterval(() => {
      if (Date.now() - lastFrame.current > 6000) {
        setFrame(null);
        needsFrame = true;
      }
      channel.postMessage(needsFrame ? "ready" : "ping");
    }, 1000);
    return () => {
      clearInterval(heartbeat);
      channel.close();
    };
  }, []);
  const hasMap = !!frame?.map;
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setSize({ width: entries[0].contentRect.width, height: entries[0].contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame?.paused, hasMap]);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError("Fullscreen is unavailable here. Use your browser’s fullscreen control.");
    }
  }
  const camera = frame?.camera,
    rotated = !!camera && camera.rotation % 180 !== 0;
  const fit = Math.min(
    (rotated ? size.height : size.width) / image.width,
    (rotated ? size.width : size.height) / image.height,
  );
  const scale =
    frame?.map?.grid && camera?.tilePixels
      ? (camera.tilePixels * frame.map.grid.columns) / (image.width * frame.map.grid.width)
      : fit;
  const visible = frame && !frame.paused;
  return (
    <main className="player-display" onPointerMove={() => setControls(true)}>
      {controls && (
        <div className="player-display-tools">
          <strong>Lootsplit · Player display</strong>
          <button onClick={() => void fullscreen()}>Fullscreen</button>
          <button onClick={() => setControls(false)}>Hide controls</button>
        </div>
      )}
      {error && (
        <p role="alert" className="display-message">
          {error}
        </p>
      )}
      {!visible ? (
        <div className="display-wait" role="status">
          <h1>{frame?.paused ? "Display paused" : "Waiting for the DM"}</h1>
          <p>The DM controls what appears on this screen.</p>
        </div>
      ) : (
        <div className={`display-layout ${frame.map ? "" : "display-no-map"}`}>
          {frame.map && (
            <div
              className="display-map-stage"
              ref={stage}
              aria-label={`Player map: ${frame.map.name}`}
            >
              <div
                className="display-map-plane"
                style={{
                  width: image.width * scale * (camera!.zoom / 100),
                  height: image.height * scale * (camera!.zoom / 100),
                  left: `${50 + camera!.panX}%`,
                  top: `${50 + camera!.panY}%`,
                  transform: `translate(-50%, -50%) rotate(${camera!.rotation}deg)`,
                }}
              >
                <img
                  src={frame.map.image}
                  alt={frame.map.name}
                  draggable={false}
                  onLoad={(e) =>
                    setImage({
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                    })
                  }
                />
                {frame.map.grid && frame.map.showGrid && (
                  <svg
                    className="display-grid"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {Array.from({ length: frame.map.grid.columns + 1 }, (_, i) => {
                      const g = frame.map!.grid!,
                        x = (g.x + (i * g.width) / g.columns) * 100;
                      return (
                        <line
                          key={`c${i}`}
                          x1={x}
                          x2={x}
                          y1={g.y * 100}
                          y2={(g.y + g.height) * 100}
                        />
                      );
                    })}
                    {Array.from({ length: frame.map.grid.rows + 1 }, (_, i) => {
                      const g = frame.map!.grid!,
                        y = (g.y + (i * g.height) / g.rows) * 100;
                      return (
                        <line
                          key={`r${i}`}
                          y1={y}
                          y2={y}
                          x1={g.x * 100}
                          x2={(g.x + g.width) * 100}
                        />
                      );
                    })}
                  </svg>
                )}
                {frame.map.markers.map((m, i) => (
                  <span
                    key={`m${i}`}
                    className="display-marker"
                    style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
                  >
                    {m.label}
                  </span>
                ))}
                {frame.map.tokens.map((t, i) => (
                  <span
                    key={`t${i}`}
                    className={`display-token ${t.active ? "display-active" : ""}`}
                    style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(frame.encounter || frame.loot) && (
            <aside className="display-sidebar">
              {frame.encounter && (
                <section>
                  <h1>Round {frame.encounter.round}</h1>
                  <p>
                    {frame.encounter.status === "active"
                      ? "Encounter in progress"
                      : frame.encounter.status === "awarded"
                        ? "Loot awarded"
                        : frame.encounter.status === "review"
                          ? "Encounter concluded"
                          : "Encounter ready"}
                  </p>
                  <ol>
                    {frame.encounter.combatants.map((c, i) => (
                      <li key={i} className={c.active ? "display-active" : ""}>
                        <strong>
                          {c.active ? "▶ " : ""}
                          {c.name}
                        </strong>
                        {c.initiative !== null && <span>Initiative {c.initiative}</span>}
                        {c.hp !== null && (
                          <span>
                            HP {c.hp} / {c.maxHp}
                          </span>
                        )}
                        {c.conditions && <span>{c.conditions}</span>}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {frame.loot && (
                <section>
                  <h2>Loot awarded</h2>
                  <ul>
                    {frame.loot.items.map((i, n) => (
                      <li key={n}>
                        {i.quantity} × {i.name}
                      </li>
                    ))}
                  </ul>
                  <p>{frame.loot.text}</p>
                </section>
              )}
            </aside>
          )}
          {!frame.map && !frame.encounter && !frame.loot && (
            <div className="display-wait">
              <p>The DM is preparing the display.</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
