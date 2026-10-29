import { SIZE_NAMES, tokenFootprint } from "./tabletop-geometry.ts";
import type { MapToken } from "./world-schema.ts";

/**
 * The map menu's items (map tokens PR 4; mockup docs/previews/map-tokens/context-menu-desktop).
 * Pure: which items a seat gets, in which groups and order, with their labels, shortcuts and
 * disabled states. The desktop right-click menu renders it now; the phone radial and its More
 * sheet (PR 5) render the same list. Each item opens an existing flow or sends one authoritative
 * command, and the server still checks every write: this list only hides what a seat can't do.
 */
export type MapActionId =
  | "start-encounter"
  | "add-creatures"
  | "add-characters"
  | "place-party"
  | "place-selected"
  | "move-party"
  | "party-position"
  | "place-record"
  | "marker"
  | "entrance"
  | "ping"
  | "measure"
  | "share-view"
  | "reveal"
  | "light"
  | "place-mine"
  | "open-tracker"
  | "open-sheet"
  | "move-to"
  | "hide"
  | "show"
  | "lock"
  | "unlock"
  | "add-initiative"
  | "remove-combat"
  | "size"
  | "controllers"
  | "send-to"
  | "remove"
  | "my-sheet"
  | "centre";

export type MapActionSpec = {
  id: MapActionId;
  label: string;
  /** The key hint shown at the right ("⇧A", "P", "Enter", "Del"). */
  shortcut?: string;
  /** Its `aria-keyshortcuts` value. */
  keys?: string;
  /** Muted text at the right ("SRD", "none selected", "Large 2×2"). */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Opens a submenu (Move party to, Size, Send to map). */
  submenu?: boolean;
};
export type MapActionSection = { label?: string; items: MapActionSpec[] };
export type MapActionList = { title: string; subtitle: string; announce: string; sections: MapActionSection[] };

export type MapMenuTarget =
  | { kind: "map"; square?: { column: number; row: number } }
  | { kind: "tokens"; tokens: MapToken[] };

export type MapMenuContext = {
  dm: boolean;
  /** The map has a combat grid (tokens, Place party, squares in the header). */
  grid: boolean;
  /** Tokens selected on this map (Place selected here). */
  selected: number;
  /** The seat's characters (players: Place my token here, their own token's menu). */
  purseIds: readonly string[];
  /** Players may place their own token on this map now (movement on, not locked, no token yet). */
  canPlaceOwn: boolean;
  /** Pings can be sent (not view-only). */
  canPing: boolean;
  /** Combatant ids in the encounter running on this map, when known. */
  combatants?: ReadonlySet<string>;
  /** The encounter running on this map (Add to initiative, Remove from combat). */
  encounterId?: string;
  /** The map is visible to players (Share this view). */
  mapVisible: boolean;
  /** There are maps to send tokens to or move the party to. */
  destinations: boolean;
};

/** The tracker id a token plays as: a character's purse, else its combatant or the token. */
const combatantId = (token: MapToken) =>
  token.kind === "character" && token.entityId ? token.entityId : (token.combatantId ?? token.id);

/** "Large 2×2", "Tiny ¼", "Custom 5×5". */
export function sizeHint(token: MapToken) {
  const n = tokenFootprint(token);
  const name = token.sizeClass ? SIZE_NAMES[token.sizeClass] : token.footprint && token.footprint !== 1 ? "Custom" : "Medium";
  return n < 1 ? `${name} ¼` : `${name} ${n}×${n}`;
}

const squareText = (square?: { column: number; row: number }) =>
  square ? `Col ${square.column + 1} · Row ${square.row + 1}` : "Here";

/** The menu for a seat at a point or on tokens. */
export function mapActions(target: MapMenuTarget, c: MapMenuContext): MapActionList {
  if (target.kind === "tokens" && target.tokens.length) return tokenActions(target.tokens, c);
  const square = target.kind === "map" ? target.square : undefined;
  const announce = square
    ? `Map actions at column ${square.column + 1}, row ${square.row + 1}`
    : "Map actions here";
  if (!c.dm) {
    const items: MapActionSpec[] = [];
    if (c.grid && c.canPlaceOwn) items.push({ id: "place-mine", label: "Place my token here" });
    if (c.canPing) items.push({ id: "ping", label: "Ping here", shortcut: "P", keys: "P" });
    items.push({ id: "measure", label: "Measure from here", shortcut: "M", keys: "M" });
    return { title: "Map actions", subtitle: squareText(square), announce, sections: [{ items }] };
  }
  const noGrid = c.grid ? {} : { disabled: true, hint: "no grid" };
  return {
    title: "Map actions",
    subtitle: squareText(square),
    announce,
    sections: [
      {
        label: "Encounter",
        items: [
          { id: "start-encounter", label: "Start encounter here…" },
          { id: "add-creatures", label: "Add creatures here…", hint: "SRD" },
          { id: "add-characters", label: "Add characters here…", ...noGrid },
        ],
      },
      {
        label: "Party",
        items: [
          { id: "place-party", label: "Place party here", shortcut: "⇧A", keys: "Shift+A", ...noGrid },
          {
            id: "place-selected",
            label: "Place selected here",
            ...(c.selected && c.grid ? {} : { disabled: true, hint: c.grid ? "none selected" : "no grid" }),
          },
          { id: "move-party", label: "Move party to", submenu: true, ...(c.destinations ? {} : { disabled: true, hint: "no other maps" }) },
          { id: "party-position", label: "Set party position here" },
        ],
      },
      {
        label: "Place",
        items: [
          { id: "place-record", label: "Place record here…", shortcut: "⇧R", keys: "Shift+R" },
          { id: "marker", label: "Marker here", shortcut: "⇧M", keys: "Shift+M" },
          { id: "entrance", label: "Entrance here", shortcut: "⇧E", keys: "Shift+E" },
        ],
      },
      {
        label: "Table",
        items: [
          { id: "ping", label: "Ping here", shortcut: "P", keys: "P", ...(c.canPing ? {} : { disabled: true }) },
          { id: "measure", label: "Measure from here", shortcut: "M", keys: "M" },
          { id: "share-view", label: "Share this view with players", ...(c.mapVisible ? {} : { disabled: true, hint: "map hidden" }) },
        ],
      },
      {
        label: "Reveal",
        items: [
          { id: "reveal", label: "Reveal around here" },
          { id: "light", label: "Add light here", shortcut: "⇧I", keys: "Shift+I" },
        ],
      },
    ],
  };
}

function tokenActions(tokens: MapToken[], c: MapMenuContext): MapActionList {
  const one = tokens.length === 1 ? tokens[0] : undefined;
  if (!c.dm) {
    // Players: their own token only (another token's menu is the map's).
    const mine = one?.kind === "character" && one.entityId && c.purseIds.includes(one.entityId);
    const items: MapActionSpec[] = [
      ...(mine ? [{ id: "my-sheet" as const, label: "Open my sheet" }] : []),
      ...(c.canPing ? [{ id: "ping" as const, label: "Ping", shortcut: "P", keys: "P" }] : []),
      { id: "centre", label: "Centre" },
    ];
    return { title: one?.label ?? "Token", subtitle: "Your character", announce: `${one?.label ?? "Token"} actions`, sections: [{ items }] };
  }
  const hidden = tokens.every((t) => t.visibility === "dm"),
    locked = tokens.every((t) => t.locked);
  const known = c.combatants;
  const inCombat = (t: MapToken) =>
    known ? known.has(combatantId(t)) : !!c.encounterId && t.encounterId === c.encounterId && !!t.combatantId;
  const anyIn = tokens.some(inCombat),
    anyOut = tokens.some((t) => !inCombat(t));
  const title = one ? one.label : `${tokens.length} tokens`;
  const subtitle = one
    ? [
        sizeHint(one).split(" ")[0],
        one.kind === "creature" ? "DM-only stats" : one.kind === "character" ? "Character" : one.kind === "ship" ? "Ship" : "Token",
        ...(one.visibility === "dm" ? ["Hidden"] : []),
      ].join(" · ")
    : "Applies to the selection";
  const open: MapActionSpec[] = one
    ? one.kind === "character"
      ? [{ id: "open-sheet", label: "Open sheet" }]
      : one.encounterId || one.kind === "creature"
        ? [{ id: "open-tracker", label: "Open in tracker" }]
        : []
    : [];
  return {
    title,
    subtitle,
    announce: `${title} actions`,
    sections: [
      {
        items: [
          ...open,
          { id: "move-to", label: "Move to…", shortcut: "Enter", keys: "Enter", ...(c.grid ? {} : { disabled: true }) },
          hidden ? { id: "show", label: "Show to players" } : { id: "hide", label: "Hide from players" },
          locked ? { id: "unlock", label: "Unlock movement" } : { id: "lock", label: "Lock movement" },
        ],
      },
      {
        items: [
          { id: "add-initiative", label: "Add to initiative", ...(c.encounterId && anyOut ? {} : { disabled: true, ...(c.encounterId ? {} : { hint: "no encounter" }) }) },
          { id: "remove-combat", label: "Remove from combat", ...(c.encounterId && anyIn ? {} : { disabled: true }) },
          { id: "size", label: "Size", submenu: true, hint: one ? sizeHint(one) : undefined },
          ...(one ? [{ id: "controllers" as const, label: "Controllers…" }] : []),
          { id: "send-to", label: "Send to map", submenu: true, ...(c.destinations ? {} : { disabled: true, hint: "no other maps" }) },
        ],
      },
      {
        items: [{ id: "remove", label: one ? "Remove token…" : `Remove ${tokens.length} tokens…`, shortcut: "Del", keys: "Delete", danger: true }],
      },
    ],
  };
}

/** Every enabled item, in menu order (tests, the radial's More sheet). */
export const enabledActions = (list: MapActionList) =>
  list.sections.flatMap((s) => s.items).filter((i) => !i.disabled);
