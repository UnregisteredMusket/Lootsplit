import { useState, useRef, useLayoutEffect } from "react";
import { mapViewStorage } from "@/lib/quire/map-view-state";
import { Pencil, Type, Undo2, Redo2, Eraser } from "lucide-react";
type Point = { x: number; y: number };
type Sketch = { id: string; color: string; points: Point[]; text?: string };
const memory = new Map<string, Sketch[]>();
function read(key: string, ephemeral: boolean): Sketch[] {
  try {
    const value = JSON.parse(mapViewStorage(ephemeral)?.getItem(key) || "null") ?? memory.get(key);
    return Array.isArray(value)
      ? value
          .filter(
            (s) =>
              s &&
              typeof s.id === "string" &&
              /^#[0-9a-f]{6}$/i.test(s.color) &&
              Array.isArray(s.points) &&
              s.points.length <= 1000 &&
              s.points.every(
                (p: Point) =>
                  Number.isFinite(p.x) &&
                  p.x >= 0 &&
                  p.x <= 1 &&
                  Number.isFinite(p.y) &&
                  p.y >= 0 &&
                  p.y <= 1,
              ) &&
              (!s.text || (typeof s.text === "string" && s.text.length <= 160)),
          )
          .slice(-200)
      : [];
  } catch {
    return memory.get(key) || [];
  }
}
/** Personal map annotations; shared campaign notes continue to use canonical map markers. */
export function useMapSketches(scope: { key: string; ephemeral: boolean }, mapId: string) {
  const key = `${scope.key}:sketches:${mapId}`;
  const [state, setState] = useState(() => ({
    key,
    rows: read(key, scope.ephemeral),
    redo: [] as Sketch[],
  }));
  const current =
    state.key === key ? state : { key, rows: read(key, scope.ephemeral), redo: [] as Sketch[] };
  const [active, setActive] = useState(false),
    [mode, setMode] = useState<"pen" | "text">("pen"),
    [color, setColor] = useState("#edc56b"),
    [label, setLabel] = useState(""),
    [draft, setDraft] = useState<Point[]>([]),
    [notice, setNotice] = useState("");
  const drawing = useRef<Point[]>([]);
  useLayoutEffect(() => {
    drawing.current = [];
    setDraft([]);
    setActive(false);
  }, [key]);
  function save(rows: Sketch[], redo: Sketch[] = []) {
    if (rows.length > 200) {
      setNotice("This map has 200 personal annotations. Erase one before adding another.");
      return;
    }
    setNotice("");
    const bounded = rows;
    memory.set(key, bounded);
    try {
      mapViewStorage(scope.ephemeral)?.setItem(key, JSON.stringify(bounded));
    } catch {
      /* In-memory fallback */
    }
    setState({ key, rows: bounded, redo });
  }
  function down(p: Point) {
    drawing.current = [p];
    setDraft([p]);
  }
  function move(p: Point) {
    if (mode !== "pen" || !drawing.current.length || drawing.current.length >= 1000) return;
    const last = drawing.current.at(-1)!;
    if (Math.hypot(last.x - p.x, last.y - p.y) < 0.001) return;
    drawing.current = [...drawing.current, p];
    setDraft(drawing.current);
  }
  function up(p: Point) {
    if (mode === "text" ? label.trim() : drawing.current.length > 1)
      save([
        ...current.rows,
        {
          id: crypto.randomUUID(),
          color,
          points: mode === "text" ? [p] : drawing.current,
          ...(mode === "text" ? { text: label.trim().slice(0, 160) } : {}),
        },
      ]);
    drawing.current = [];
    setDraft([]);
  }
  function cancel() {
    drawing.current = [];
    setDraft([]);
    setActive(false);
  }
  const controls = (
    <>
      <div className="tabletop-tool-row">
        <button
          className="map-icon-button"
          aria-label="Freehand drawing"
          title="Freehand drawing"
          aria-pressed={mode === "pen"}
          onClick={() => setMode("pen")}
        >
          <Pencil size={18} />
        </button>
        <button
          className="map-icon-button"
          aria-label="Text annotation"
          title="Text annotation"
          aria-pressed={mode === "text"}
          onClick={() => setMode("text")}
        >
          <Type size={18} />
        </button>
        <label>
          Ink
          <input
            aria-label="Drawing color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <button
          className="map-icon-button"
          aria-label="Undo drawing"
          title="Undo drawing"
          disabled={!current.rows.length}
          onClick={() => save(current.rows.slice(0, -1), [...current.redo, current.rows.at(-1)!])}
        >
          <Undo2 size={18} />
        </button>
        <button
          className="map-icon-button"
          aria-label="Redo drawing"
          title="Redo drawing"
          disabled={!current.redo.length}
          onClick={() => save([...current.rows, current.redo.at(-1)!], current.redo.slice(0, -1))}
        >
          <Redo2 size={18} />
        </button>
        <button
          className="map-icon-button"
          aria-label="Erase last annotation"
          title="Erase last annotation"
          disabled={!current.rows.length}
          onClick={() => save(current.rows.slice(0, -1), [...current.redo, current.rows.at(-1)!])}
        >
          <Eraser size={18} />
        </button>
      </div>
      {mode === "text" && (
        <label>
          Annotation
          <input
            aria-label="Annotation text"
            value={label}
            maxLength={160}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
      )}
      {notice && <p role="status">{notice}</p>}
      <p className="text-sm text-muted">
        {mode === "pen" ? "Draw on the map." : "Tap the map to place text."} Personal notes on this
        device{scope.ephemeral ? " for this guest session" : ""}. Use a map marker to share a
        campaign note.
      </p>
    </>
  );
  const overlay = (
    <svg
      className="map-personal-sketches"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-label="Personal map annotations"
    >
      {current.rows.map((s) =>
        s.text ? (
          <text key={s.id} x={s.points[0].x * 1000} y={s.points[0].y * 1000} fill={s.color}>
            {s.text}
          </text>
        ) : (
          <polyline
            key={s.id}
            stroke={s.color}
            points={s.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ")}
          />
        ),
      )}
      {draft.length > 1 && (
        <polyline
          stroke={color}
          points={draft.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ")}
        />
      )}
    </svg>
  );
  return { active, setActive, controls, overlay, down, move, up, cancel };
}
