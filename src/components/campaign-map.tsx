import { useEffect, useRef, useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import { readWorld, type CampaignMap } from "@/lib/quire/world-schema";
import { anchorFor, recognizedAnchors, npcAvailableHere, shopVisible } from "@/lib/quire/world";
import { readMarketLocations, locationLabel, locationPath } from "@/lib/quire/shop-locations";
import { prepareMapImage, recognizeMap } from "@/lib/quire/map-image";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { CommandForm, CommandButton } from "./world-tools";
import { LocationOptions, MarketLocationsPanel } from "./market-locations";
import { Button, Fold } from "./ui";
import { AppLink } from "./app-link";
import type { CloudTable } from "@/lib/quire/cloud";

export function CampaignMaps() {
  const t = useWorldTable(),
    w = readWorld(t.journal.world),
    seat = useSeat(),
    dm = seat.role === "dm",
    market = readMarketLocations(t.journal.market);
  const [selected, setSelected] = useState(""),
    [editing, setEditing] = useState<CampaignMap | null | undefined>(),
    [placement, setPlacement] = useState<"" | "anchor" | "marker">(""),
    [location, setLocation] = useState(""),
    [point, setPoint] = useState<{ x: number; y: number }>(),
    [label, setLabel] = useState(""),
    [description, setDescription] = useState(""),
    [secret, setSecret] = useState(false);
  const maps = w.maps.filter((m) => dm || m.visible),
    best = [...locationPath(market, market.currentLocationId)]
      .reverse()
      .map((l) => maps.find((m) => m.locationId === l.id))
      .find(Boolean);
  const map =
    maps.find((m) => m.id === selected) ?? best ?? maps.find((m) => !m.locationId) ?? maps[0];
  const party = map && anchorFor(map, t, market.currentLocationId);
  const pins = map
    ? [
        ...t.holdings
          .filter(
            (h) =>
              h.kind === "property" &&
              h.quantity > 0 &&
              (dm ||
                seat.purseIds.includes(h.purseId) ||
                t.journal.propertyOperations?.sites.some((s) => s.propertyId === h.id)),
          )
          .map((h) => ({
            id: h.id,
            label: h.name,
            kind: "Property",
            point: anchorFor(map, t, h.locationId),
            href: "/features/properties",
          })),
        ...t.shops
          .filter((s) => dm || shopVisible(s, t))
          .map((s) => ({
            id: s.id,
            label: s.name,
            kind: s.blackMarket ? "Black market" : "Shop",
            point: anchorFor(map, t, s.locationId),
            href: `/shop/${s.id}`,
          })),
        ...w.npcs
          .filter((n) => dm || npcAvailableHere(n, t))
          .map((n) => ({
            id: n.id,
            label: n.name,
            kind: "NPC",
            point: anchorFor(map, t, n.locationId),
            href: "/features/npcs",
          })),
        ...(t.journal.propertyOperations?.postal.offices ?? []).flatMap((p) => {
          const s = t.shops.find((s) => s.id === p.shopId);
          return s
            ? [
                {
                  id: s.id,
                  label: s.name,
                  kind: "Post office",
                  point: anchorFor(map, t, s.locationId),
                  href: "/features/properties",
                },
              ]
            : [];
        }),
      ].filter((p) => p.point)
    : [];
  return (
    <div className="campaign-maps">
      <p className="text-muted">
        {locationLabel(market, market.currentLocationId)} ·{" "}
        {party ? "Party position shown" : "Link this location to a map to show the party"}
      </p>
      <div className="world-toolbar">
        <AppLink className="settings-link" href="/features/npcs">
          People & NPCs →
        </AppLink>
        <AppLink className="settings-link" href="/features/trading">
          Trading & Barter →
        </AppLink>
        <label>
          Map
          <select
            value={map?.id ?? ""}
            onChange={(e) => {
              setSelected(e.target.value);
              setPlacement("");
              setPoint(undefined);
            }}
          >
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.visible ? "" : " (DM only)"}
              </option>
            ))}
          </select>
        </label>
        {dm && (
          <>
            <Button onClick={() => setEditing(null)}>Import map</Button>
            {map && <Button onClick={() => setEditing(map)}>Edit map & anchors</Button>}
          </>
        )}
      </div>
      {map ? (
        <>
          <MapViewport
            key={map.id}
            map={map}
            party={party}
            placing={!!placement}
            point={point}
            onPlace={setPoint}
            entities={pins}
          />
          <p className="text-sm text-muted">
            Drag to pan. Pinch or use the scroll wheel to zoom. Keyboard: arrows, +, − and Home.
            Markers update through the shared campaign.
          </p>
          {dm && (
            <Fold title="Place map markers & locations" defaultOpen>
              <div className="world-toolbar">
                <Button
                  onClick={() => {
                    setPlacement("marker");
                    setPoint(undefined);
                  }}
                >
                  Place marker
                </Button>
                <Button
                  onClick={() => {
                    setPlacement("anchor");
                    setPoint(undefined);
                  }}
                >
                  Link location
                </Button>
                <Button
                  onClick={() => {
                    setPlacement("");
                    setPoint(undefined);
                  }}
                >
                  Stop placing
                </Button>
              </div>
              {placement && (
                <p role="status">
                  Tap the map to place {placement === "anchor" ? "a location anchor" : "a marker"}.
                </p>
              )}
              {point && placement === "anchor" && (
                <CommandForm
                  label="Save location anchor"
                  dirty
                  submit={() => {
                    if (!location) throw Error("Choose an existing location.");
                    return {
                      kind: "map-save",
                      mapId: map.id,
                      before: map,
                      map: {
                        ...map,
                        anchors: [
                          ...map.anchors.filter((a) => a.locationId !== location),
                          { locationId: location, ...point },
                        ],
                      },
                    };
                  }}
                  onDone={() => {
                    setPoint(undefined);
                    setPlacement("");
                  }}
                >
                  <label>
                    Linked location
                    <select
                      aria-label="Linked location"
                      required
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    >
                      <option value="">Choose location</option>
                      <LocationOptions market={market} />
                    </select>
                  </label>
                </CommandForm>
              )}
              {point && placement === "marker" && (
                <CommandForm
                  label="Save live marker"
                  dirty
                  submit={() => {
                    const id = crypto.randomUUID();
                    return {
                      kind: "map-marker",
                      mapId: map.id,
                      markerId: id,
                      before: null,
                      marker: {
                        id,
                        label,
                        description,
                        visibility: secret ? "dm" : "party",
                        ...point,
                      },
                    };
                  }}
                  onDone={() => {
                    setPoint(undefined);
                    setPlacement("");
                    setLabel("");
                    setDescription("");
                  }}
                >
                  <label>
                    Marker name
                    <input
                      required
                      maxLength={160}
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </label>
                  <label>
                    Details
                    <textarea
                      maxLength={2000}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={secret}
                      onChange={(e) => setSecret(e.target.checked)}
                    />
                    DM only
                  </label>
                </CommandForm>
              )}
            </Fold>
          )}
          <section className="world-register">
            <h2>Map register</h2>
            {map.anchors.map((a) => (
              <div key={a.locationId} className="world-row">
                <span>
                  {locationLabel(market, a.locationId)}
                  {a.locationId === market.currentLocationId ? " · Party here" : ""}
                </span>
                {dm && (
                  <CommandButton
                    input={{
                      kind: "party-location",
                      before: market.currentLocationId,
                      locationId: a.locationId,
                    }}
                  >
                    Move party here
                  </CommandButton>
                )}
              </div>
            ))}
            {map.markers
              .filter((m) => dm || m.visibility === "party")
              .map((m) => (
                <div key={m.id} className="world-row">
                  <span>
                    <strong>
                      {m.label}
                      {m.visibility === "dm" ? " · DM only" : ""}
                    </strong>
                    <p>{m.description}</p>
                  </span>
                  {dm && (
                    <CommandButton
                      input={{
                        kind: "map-marker",
                        mapId: map.id,
                        markerId: m.id,
                        before: m,
                        marker: null,
                      }}
                    >
                      Remove marker
                    </CommandButton>
                  )}
                </div>
              ))}
            {pins.map((p) => (
              <AppLink key={`${p.kind}-${p.id}`} className="settings-link" href={p.href}>
                {p.kind} · {p.label} →
              </AppLink>
            ))}
            {!party && (
              <p>
                No reviewed anchor for the party's selected location. The map does not guess a
                position.
              </p>
            )}
          </section>
        </>
      ) : (
        <p>No maps shared yet. The DM can import regional, city and area maps.</p>
      )}
      {dm && (
        <Fold title="Manage campaign locations">
          <MarketLocationsPanel />
        </Fold>
      )}
      {editing !== undefined && dm && (
        <MapEditor
          key={editing?.id ?? "new"}
          map={editing ?? undefined}
          table={t}
          close={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}
function MapEditor({
  map,
  table,
  close,
}: {
  map?: CampaignMap;
  table: CloudTable;
  close: () => void;
}) {
  const [draft, setDraft] = useState<CampaignMap>(
      map ?? {
        id: crypto.randomUUID(),
        name: "",
        image: "",
        locationId: null,
        visible: true,
        anchors: [],
        markers: [],
      },
    ),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const market = readMarketLocations(table.journal?.market);
  return (
    <section className="journal-entry">
      <h2>{map ? "Edit map" : "Import a map"}</h2>
      <CommandForm
        label="Save map"
        dirty
        submitDisabled={busy}
        submit={() => {
          if (busy) throw Error("Wait for the image to finish processing.");
          if (!draft.image)
            throw Error("Choose a map image before saving. Your draft is retained.");
          if (!draft.name.trim()) throw Error("Enter a map name before saving.");
          return { kind: "map-save", mapId: draft.id, before: map ?? null, map: draft };
        }}
        onDone={close}
      >
        <label>
          Map name
          <input
            required
            maxLength={160}
            value={draft.name}
            onChange={(e) => {
              const name = e.target.value;
              setDraft((current) => ({ ...current, name }));
            }}
          />
        </label>
        <label>
          Map location
          <select
            aria-label="Map location"
            value={draft.locationId ?? ""}
            onChange={(e) => {
              const locationId = e.target.value || null;
              setDraft((current) => ({ ...current, locationId }));
            }}
          >
            <option value="">World / campaign map</option>
            <LocationOptions market={market} />
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.visible}
            onChange={(e) => {
              const visible = e.target.checked;
              setDraft((current) => ({ ...current, visible }));
            }}
          />
          Share this map image with players
        </label>
        <label>
          Map image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setError("");
              setProgress("Preparing map image… You can fill in the map details while you wait.");
              try {
                const image = await prepareMapImage(file);
                setDraft((current) => ({ ...current, image, anchors: [] }));
                setProgress("Map image ready. Review the details, then save the map.");
              } catch (e) {
                setProgress("");
                setError(e instanceof Error ? e.message : "Map import failed.");
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <p className="text-sm text-muted">
          PNG, JPEG or WebP up to 20 MB. Shared copy: up to 2400 pixels and 500 KB. Players see
          everything drawn in the shared image.
        </p>
        {draft.image && (
          <>
            <img className="map-preview" src={draft.image} alt="Imported map preview" />
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                setProgress("Reading location labels… You can continue editing the map details.");
                try {
                  const result = await recognizeMap(draft.image, setProgress);
                  const matches = recognizedAnchors(
                    result.lines,
                    result.width,
                    result.height,
                    table,
                  );
                  setDraft((current) => ({
                    ...current,
                    anchors: [
                      ...current.anchors,
                      ...matches.filter(
                        (a) => !current.anchors.some((b) => a.locationId === b.locationId),
                      ),
                    ],
                  }));
                  setProgress(
                    `${matches.length} unique location labels matched. Review their positions before saving; ambiguous or unreadable labels can be linked manually.`,
                  );
                } catch (e) {
                  setProgress("");
                  setError(
                    e instanceof Error ? e.message : "Recognition failed. Link locations manually.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Read location labels
            </Button>
          </>
        )}
        {draft.anchors.map((a) => (
          <div className="world-row" key={a.locationId}>
            <span>
              {locationLabel(market, a.locationId)} · {Math.round(a.x * 100)}%,{" "}
              {Math.round(a.y * 100)}%
            </span>
            <Button
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  anchors: current.anchors.filter((b) => b !== a),
                }))
              }
            >
              Remove anchor
            </Button>
          </div>
        ))}
        {progress && <p role="status">{progress}</p>}
        {error && <p role="alert">{error}</p>}
      </CommandForm>
      <Button onClick={close}>Close editor</Button>
      {map && (
        <CommandButton input={{ kind: "map-save", mapId: map.id, before: map, map: null }}>
          Remove map
        </CommandButton>
      )}
    </section>
  );
}
function MapViewport({
  map,
  party,
  placing,
  point,
  onPlace,
  entities,
}: {
  map: CampaignMap;
  party?: { x: number; y: number };
  placing: boolean;
  point?: { x: number; y: number };
  onPlace: (p: { x: number; y: number }) => void;
  entities: { id: string; label: string; kind: string; point?: { x: number; y: number } }[];
}) {
  const root = useRef<HTMLDivElement>(null),
    [ratio, setRatio] = useState(1),
    [size, setSize] = useState({ w: 1, h: 1 }),
    [view, setView] = useState({ x: 0, y: 0, scale: 1 }),
    viewRef = useRef(view),
    pointers = useRef(new Map<number, { x: number; y: number }>()),
    moved = useRef(false),
    start = useRef({ x: 0, y: 0 });
  const w = Math.min(size.w, size.h * ratio),
    h = w / ratio;
  const fit = () => setView({ x: (size.w - w) / 2, y: (size.h - h) / 2, scale: 1 });
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    const el = root.current!;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setView({ x: (size.w - w) / 2, y: (size.h - h) / 2, scale: 1 });
  }, [size.w, size.h, w, h]);
  function zoom(factor: number, x: number, y: number) {
    setView((v) => {
      const scale = Math.min(8, Math.max(0.5, v.scale * factor)),
        f = scale / v.scale;
      return { scale, x: x - (x - v.x) * f, y: y - (y - v.y) * f };
    });
  }
  useEffect(() => {
    const el = root.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect(),
        v = viewRef.current,
        scale = Math.min(8, Math.max(0.5, v.scale * Math.exp(-e.deltaY * 0.002))),
        f = scale / v.scale,
        x = e.clientX - rect.left,
        y = e.clientY - rect.top;
      setView({ scale, x: x - (x - v.x) * f, y: y - (y - v.y) * f });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const center = (ps: { x: number; y: number }[]) => ({
    x: ps.reduce((n, p) => n + p.x, 0) / ps.length,
    y: ps.reduce((n, p) => n + p.y, 0) / ps.length,
  });
  return (
    <>
      <div className="world-toolbar">
        <Button onClick={() => zoom(1.4, size.w / 2, size.h / 2)} aria-label="Zoom in">
          +
        </Button>
        <Button onClick={() => zoom(1 / 1.4, size.w / 2, size.h / 2)} aria-label="Zoom out">
          −
        </Button>
        <Button onClick={fit}>Fit map</Button>
        <span aria-live="polite">{Math.round(view.scale * 100)}%</span>
      </div>
      <div
        ref={root}
        className={`map-viewport ${placing ? "placing" : ""}`}
        role="region"
        aria-label="Interactive campaign map"
        tabIndex={0}
        onKeyDown={(e) => {
          if (
            ["+", "=", "-", "Home", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
              e.key,
            )
          )
            e.preventDefault();
          if (e.key === "Home") fit();
          else if (e.key === "+" || e.key === "=") zoom(1.2, size.w / 2, size.h / 2);
          else if (e.key === "-") zoom(1 / 1.2, size.w / 2, size.h / 2);
          else if (e.key.startsWith("Arrow"))
            setView((v) => ({
              ...v,
              x: v.x + (e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0),
              y: v.y + (e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0),
            }));
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 1) {
            start.current = { x: e.clientX, y: e.clientY };
            moved.current = false;
          } else moved.current = true;
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          const before = [...pointers.current.values()],
            previous = pointers.current.get(e.pointerId)!;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 6)
            moved.current = true;
          const after = [...pointers.current.values()];
          if (after.length === 1)
            setView((v) => ({
              ...v,
              x: v.x + e.clientX - previous.x,
              y: v.y + e.clientY - previous.y,
            }));
          else {
            const a = center(before),
              b = center(after),
              dist = (ps: { x: number; y: number }[]) =>
                Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y),
              factor = dist(after) / Math.max(1, dist(before)),
              rect = root.current!.getBoundingClientRect();
            setView((v) => {
              const scale = Math.min(8, Math.max(0.5, v.scale * factor)),
                f = scale / v.scale;
              return {
                scale,
                x: b.x - rect.left - (a.x - rect.left - v.x) * f,
                y: b.y - rect.top - (a.y - rect.top - v.y) * f,
              };
            });
          }
        }}
        onPointerUp={(e) => {
          if (placing && !moved.current && pointers.current.size === 1) {
            const r = e.currentTarget.getBoundingClientRect(),
              x = (e.clientX - r.left - view.x) / (w * view.scale),
              y = (e.clientY - r.top - view.y) / (h * view.scale);
            if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPlace({ x, y });
          }
          pointers.current.delete(e.pointerId);
        }}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
      >
        <div
          className="map-layer"
          style={{
            width: w,
            height: h,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <img
            draggable={false}
            src={map.image}
            alt={map.name}
            onLoad={(e) => setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          />
          {map.anchors.map((a) => (
            <span
              key={a.locationId}
              className="map-anchor"
              style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }}
              title="Reviewed location"
            >
              ◇
            </span>
          ))}
          {map.markers.map((m) => (
            <span
              key={m.id}
              className="map-pin"
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
              title={m.description}
            >
              ⚑{" "}
              <span>
                {m.label}
                {m.visibility === "dm" ? " (DM)" : ""}
              </span>
            </span>
          ))}
          {entities
            .filter(
              (p, i) =>
                entities.findIndex(
                  (q) => q.point?.x === p.point?.x && q.point?.y === p.point?.y,
                ) === i,
            )
            .map((p) => (
              <span
                key={p.id}
                className="map-pin map-entity"
                style={{ left: `${p.point!.x * 100}%`, top: `${p.point!.y * 100}%` }}
                title={entities
                  .filter((q) => q.point?.x === p.point?.x && q.point?.y === p.point?.y)
                  .map((q) => `${q.kind}: ${q.label}`)
                  .join("; ")}
              >
                ⌂{" "}
                <span>
                  {
                    entities.filter((q) => q.point?.x === p.point?.x && q.point?.y === p.point?.y)
                      .length
                  }{" "}
                  records
                </span>
              </span>
            ))}
          {party && (
            <span
              className="map-pin map-party"
              style={{ left: `${party.x * 100}%`, top: `${party.y * 100}%` }}
            >
              ● <span>Party</span>
            </span>
          )}
          {point && (
            <span
              className="map-pin"
              style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
            >
              ✚
            </span>
          )}
        </div>
      </div>
    </>
  );
}
