import { useState } from "react";
import {
  BoxSelect,
  Check,
  CircleDot,
  EyeOff,
  Eye,
  ListOrdered,
  Lock,
  LockOpen,
  Maximize2,
  Move,
  MoveRight,
  RotateCw,
  Rows3,
  Shapes,
  Users,
  X,
} from "lucide-react";
import type { Formation } from "@/lib/quire/formation";
import type { MapToken } from "@/lib/quire/world-schema";
import { SIZE_NAMES, TOKEN_SIZE_CLASSES } from "@/lib/quire/tabletop-geometry";

export type PartyRow = {
  purseId: string;
  name: string;
  /** "on map · will move", "Group B · Forest", "not on this map". */
  status: string;
  checked: boolean;
  disabled?: boolean;
  /** Sort key: map reading order for characters already on the map. */
  order?: number;
};

/**
 * Place party (map tokens PR 3; mockup group-placement): who is placed, the formation (Cluster,
 * Line, Circle), spacing, rotation and "Make this the party's default". Ghosts follow the pointer
 * and snap square by square; one click places everyone in one action, with Undo.
 */
export function PlacePartyPanel({
  rows,
  toggle,
  formation,
  setFormation,
  makeDefault,
  setMakeDefault,
  close,
}: {
  rows: PartyRow[];
  toggle: (purseId: string) => void;
  formation: Formation;
  setFormation: (formation: Formation) => void;
  makeDefault: boolean;
  setMakeDefault: (value: boolean) => void;
  close: () => void;
}) {
  const shapes = [
    { shape: "cluster", label: "Cluster", Icon: Shapes },
    { shape: "line", label: "Line", Icon: Rows3 },
    { shape: "circle", label: "Circle", Icon: CircleDot },
  ] as const;
  return (
    <aside
      className="map-side-panel map-setup-panel map-place-party map-glass"
      role="dialog"
      aria-modal="false"
      aria-labelledby="map-place-party-heading"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="map-panel-heading">
        <h2 id="map-place-party-heading">Place party</h2>
        <button className="map-icon-button" aria-label="Close Place party" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <p>
        Ghosts follow the pointer and snap square by square. Click once to place. One action, with
        Undo.
      </p>
      <ul className="map-place-party-list" aria-label="Characters to place">
        {rows.map((row) => (
          <li key={row.purseId} className={row.checked ? undefined : "off"}>
            <label>
              <input
                type="checkbox"
                checked={row.checked}
                disabled={row.disabled}
                onChange={() => toggle(row.purseId)}
              />
              <span className="map-place-party-avatar" aria-hidden="true">
                {row.name.slice(0, 1).toUpperCase()}
              </span>
              {row.name}
              <small>{row.status}</small>
            </label>
          </li>
        ))}
      </ul>
      <p className="map-place-party-caption" id="map-formation-label">
        Formation
      </p>
      <div className="map-segmented" role="radiogroup" aria-labelledby="map-formation-label">
        {shapes.map(({ shape, label, Icon }) => (
          <button
            key={shape}
            type="button"
            role="radio"
            aria-checked={formation.shape === shape}
            onClick={() => setFormation({ ...formation, shape })}
          >
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <div className="map-place-party-row">
        <span id="map-spacing-label">Spacing</span>
        <span className="map-place-party-step">
          <button
            type="button"
            aria-label="Less spacing"
            disabled={formation.spacing <= 0}
            onClick={() => setFormation({ ...formation, spacing: formation.spacing - 1 })}
          >
            −
          </button>
          <small aria-labelledby="map-spacing-label">
            {formation.spacing} {formation.spacing === 1 ? "square" : "squares"} · Alt+wheel
          </small>
          <button
            type="button"
            aria-label="More spacing"
            disabled={formation.spacing >= 4}
            onClick={() => setFormation({ ...formation, spacing: formation.spacing + 1 })}
          >
            +
          </button>
        </span>
      </div>
      <div className="map-place-party-row">
        <span>Rotate</span>
        <button
          type="button"
          className="map-place-party-rotate"
          aria-keyshortcuts="R"
          aria-label={`Rotate (now ${formation.rotation}°)`}
          onClick={() =>
            setFormation({
              ...formation,
              rotation: ((formation.rotation + 90) % 360) as Formation["rotation"],
            })
          }
        >
          <RotateCw size={14} aria-hidden="true" /> <kbd>R</kbd>
        </button>
      </div>
      <label className="map-place-party-row map-place-party-check">
        <input
          type="checkbox"
          checked={makeDefault}
          onChange={(e) => setMakeDefault(e.target.checked)}
        />
        Make this the party's default
      </label>
    </aside>
  );
}

/** "Placing 4 at column 14, row 12 · cluster · all squares free · Click to place · Esc cancels". */
export function PlacingHint({
  count,
  at,
  shape,
  displaced,
  unplaced,
}: {
  count: number;
  at?: { column: number; row: number };
  shape: string;
  displaced: number;
  unplaced: number;
}) {
  return (
    <div className="map-placing-hint map-glass" role="status">
      {at ? (
        <>
          Placing {count} at column {at.column + 1}, row {at.row + 1} · {shape} ·{" "}
          {unplaced
            ? `no room for ${unplaced}`
            : displaced
              ? `${displaced} moved to free squares`
              : "all squares free"}{" "}
          · <b>Click to place</b> · Esc cancels
        </>
      ) : (
        <>
          Placing {count} · {shape} · point at a square · <b>Click to place</b> · Esc cancels
        </>
      )}
    </div>
  );
}

type Choice = { id: string; label: string };
/**
 * The group command bar (mockup group-placement): each action is one authoritative command for
 * the whole selection. Phones get a Select toggle that makes taps add or remove tokens.
 */
export function GroupBar({
  tokens,
  placing,
  busy,
  phone,
  selectMode,
  setSelectMode,
  movement,
  maps,
  onPlace,
  onMove,
  onHide,
  onLock,
  onInitiative,
  onSize,
  onSend,
  onMovement,
  onClear,
  raised = false,
}: {
  /** Phones with the inspector sheet open: the bar moves to the top. */
  raised?: boolean;
  tokens: MapToken[];
  placing: boolean;
  busy: boolean;
  phone: boolean;
  selectMode: boolean;
  setSelectMode: (on: boolean) => void;
  movement: "auto" | "off" | "approval";
  maps: Choice[];
  onPlace: () => void;
  onMove: () => void;
  onHide: (hide: boolean) => void;
  onLock: (lock: boolean) => void;
  onInitiative: () => void;
  onSize: (size: MapToken["sizeClass"]) => void;
  onSend: (mapId: string) => void;
  onMovement: (mode: "auto" | "off" | "approval") => void;
  onClear: () => void;
}) {
  const [menu, setMenu] = useState<"" | "size" | "send" | "movement">("");
  const hidden = tokens.length > 0 && tokens.every((t) => t.visibility === "dm"),
    locked = tokens.length > 0 && tokens.every((t) => t.locked);
  const item = (
    label: string,
    Icon: typeof Move,
    onClick: () => void,
    extra: Partial<{ on: boolean; expanded: boolean; small: string }> = {},
  ) => (
    <button
      type="button"
      className={`map-group-action${extra.on ? " on" : ""}`}
      disabled={busy}
      aria-pressed={extra.on}
      aria-expanded={extra.expanded}
      onClick={onClick}
    >
      <Icon size={18} aria-hidden="true" />
      {label}
      {extra.small && <small>{extra.small}</small>}
    </button>
  );
  return (
    <div className={`map-group-dock${raised ? " raised" : ""}`}>
      <div
        className="map-group-bar map-glass"
        role="toolbar"
        aria-label={`${tokens.length} tokens selected`}
      >
        <span className="map-group-count">
          <BoxSelect size={15} aria-hidden="true" /> {tokens.length} selected
        </span>
        {phone && item("Select", Check, () => setSelectMode(!selectMode), { on: selectMode })}
        {item("Place", Shapes, onPlace, { on: placing })}
        {item("Move", Move, onMove)}
        {item(hidden ? "Show" : "Hide", hidden ? Eye : EyeOff, () => onHide(!hidden))}
        {item(locked ? "Unlock" : "Lock", locked ? LockOpen : Lock, () => onLock(!locked))}
        {item("Initiative", ListOrdered, onInitiative)}
        {item("Size", Maximize2, () => setMenu(menu === "size" ? "" : "size"), {
          expanded: menu === "size",
        })}
        {item("Send to", MoveRight, () => setMenu(menu === "send" ? "" : "send"), {
          expanded: menu === "send",
        })}
        {item("Movement", Users, () => setMenu(menu === "movement" ? "" : "movement"), {
          expanded: menu === "movement",
          small: `${movement === "auto" ? "Auto" : movement === "off" ? "Off" : "Ask"} ▾`,
        })}
        {item("Clear", X, onClear)}
      </div>
      {menu && (
        <div
          className="map-group-menu map-glass"
          role="menu"
          aria-label={menu === "size" ? "Size" : menu === "send" ? "Send to" : "Movement"}
        >
          {menu === "size" &&
            TOKEN_SIZE_CLASSES.map((size) => (
              <button
                key={size}
                type="button"
                role="menuitem"
                onClick={() => (setMenu(""), onSize(size))}
              >
                {SIZE_NAMES[size]}
              </button>
            ))}
          {menu === "send" &&
            (maps.length ? (
              maps.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="menuitem"
                  onClick={() => (setMenu(""), onSend(m.id))}
                >
                  {m.label}
                </button>
              ))
            ) : (
              <p>No other map with a grid.</p>
            ))}
          {menu === "movement" &&
            (["auto", "off", "approval"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={movement === mode}
                onClick={() => (setMenu(""), onMovement(mode))}
              >
                {mode === "auto"
                  ? "Automatic: free, taking turns in combat"
                  : mode === "off"
                    ? "Off: the DM moves tokens"
                    : "Ask the DM: moves wait for your approval"}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
