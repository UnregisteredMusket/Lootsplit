import type { CloudTable } from "./cloud.ts";
import type { CampaignMap, MapToken } from "./world-schema.ts";
import { expandTabletopHistory, tabletopHasFogDiffs } from "./fog-history.ts";

/**
 * The current tabletop table shape; 3 added compact fog history, continued brush strokes, fog
 * consolidation and the alternating diagonal (whose pending commands older apps cannot read).
 * Every client at protocol 3 or later reads that shape, so this stays 3.
 */
export const TABLETOP_PROTOCOL = 3;
/**
 * Transport protocol 4 (2026-10-22): the protocol 3 table shape, with each current shared map's
 * stored image sent as its `/art/room-image-<sha256>.webp` reference instead of the inline raster.
 * The client loads references through the seat-authorized GET /api/room-image/CODE/HASH and
 * restores the inline image before the table reaches the app. Protocols 0-3 (older websites and
 * APKs) keep receiving full inline envelopes.
 */
export const IMAGE_REFERENCE_PROTOCOL = 4;
/**
 * Protocol 5 (2026-10-23, Place hub): record placements may carry an optional pin `style`
 * ("icon" | "portrait"). Older clients have a strict placement schema, so protocols 0-4 receive
 * placements without it; their map saves keep the stored styles (world.ts map-save).
 */
export const PLACEMENT_STYLE_PROTOCOL = 5;
/** The protocol current clients declare. */
export const CURRENT_TABLETOP_PROTOCOL = PLACEMENT_STYLE_PROTOCOL;
/** Server-only, non-enumerable: inline image -> its stored reference for this room read. */
export const ROOM_IMAGE_SOURCES_KEY = Symbol.for("lootsplit.room-view-image-sources");

const commands = new Set([
  "tabletop-session",
  "map-tabletop",
  "map-token-move",
  "map-fog",
  "map-template",
  "map-render",
]);
/**
 * Tabletop protocol 2 and older apps (Android 1.10.0 and earlier) have no `alternating` diagonal
 * rule; they see such grids as "One tile per diagonal step" (`equal`). Stored grids are unchanged,
 * and their saves and token moves are accepted against this form (see world.ts / tabletop.ts).
 */
export function legacyDiagonals<T>(value: T): T {
  if (!value || typeof value !== "object" || !JSON.stringify(value).includes('"alternating"'))
    return value;
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (!item || typeof item !== "object") return item;
    const record = Object.fromEntries(
      Object.entries(item).map(([key, entry]) => [key, walk(entry)]),
    );
    if (
      record.diagonal === "alternating" &&
      typeof record.columns === "number" &&
      typeof record.rows === "number"
    )
      record.diagonal = "equal";
    return record;
  };
  return walk(value) as T;
}
export function legacyTabletopToken(token: MapToken): MapToken {
  const result = { ...token };
  delete result.locked;
  delete result.controllerPurseIds;
  delete result.offsetX;
  delete result.offsetY;
  delete result.style;
  delete result.vision;
  return result;
}
/** Protocol 2: fog undo/redo history as full snapshots instead of compact diffs. */
export function fogSnapshotMap(map: CampaignMap): CampaignMap {
  if (!map.tabletop || !tabletopHasFogDiffs(map.tabletop)) return map;
  return { ...map, tabletop: expandTabletopHistory(map.tabletop) };
}
/** A map without placement pin styles (protocols 0-4). The same object when there are none. */
export function withoutPlacementStyles(map: CampaignMap): CampaignMap {
  if (!map.connected?.placements.some((p) => p.style !== undefined)) return map;
  return {
    ...map,
    connected: {
      ...map.connected,
      placements: map.connected.placements.map((p) => {
        const plain = { ...p };
        delete plain.style;
        return plain;
      }),
    },
  };
}
// Token styles are objects; only placement styles are these strings.
const placementStyled = (text: string) =>
  text.includes('"placements"') && /"style":"(icon|portrait)"/.test(text);
/** Whether a table (or a stored backup body) holds placement pin styles. */
export function hasPlacementStyles(table: CloudTable): boolean {
  return (
    !!table.journal?.world?.maps.some((m) => m.connected?.placements.some((p) => p.style)) ||
    !!table.journal?.reports?.some((r) => placementStyled(r.snapshot ?? ""))
  );
}
function styleFreeTable(table: CloudTable): CloudTable {
  if (!hasPlacementStyles(table)) return table;
  const world = table.journal?.world;
  const reports = table.journal?.reports?.map((report) => {
    if (!placementStyled(report.snapshot ?? "")) return report;
    try {
      return {
        ...report,
        snapshot: JSON.stringify(styleFreeTable(JSON.parse(report.snapshot))),
      };
    } catch {
      return report; // Preserve existing unreadable-archive evidence for the recovery reader.
    }
  });
  return {
    ...table,
    journal: {
      ...table.journal!,
      ...(world ? { world: { ...world, maps: world.maps.map(withoutPlacementStyles) } } : {}),
      ...(reports ? { reports } : {}),
    },
  };
}
export function previousTabletopMap(map: CampaignMap): CampaignMap {
  const result = { ...map };
  delete result.connected;
  return result;
}
export function legacyTabletopMap(map: CampaignMap): CampaignMap {
  const result = previousTabletopMap(map);
  delete result.tabletop;
  if (map.tokens) result.tokens = map.tokens.map(legacyTabletopToken);
  return result;
}
/** Applied after seat/privacy projection. Older APKs have strict map/token schemas. */
export function legacyTabletopTable(table: CloudTable): CloudTable {
  return tableForProtocol(table, 0);
}
export function tableForProtocol(table: CloudTable, protocol = 0): CloudTable {
  if (protocol >= PLACEMENT_STYLE_PROTOCOL) return table;
  table = styleFreeTable(table);
  if (protocol >= TABLETOP_PROTOCOL) return table;
  table = legacyDiagonalTable(table);
  if (protocol === 2) {
    if (
      !table.journal?.world?.maps.some(
        (map) => map.tabletop && tabletopHasFogDiffs(map.tabletop),
      ) &&
      !table.journal?.reports?.some((report) => report.snapshot.includes('"fog-diff"'))
    )
      return table;
    const result = structuredClone(table),
      world = result.journal?.world;
    if (world) world.maps = world.maps.map(fogSnapshotMap);
    for (const report of result.journal?.reports ?? []) {
      if (!report.snapshot.includes('"fog-diff"')) continue;
      try {
        report.snapshot = JSON.stringify(tableForProtocol(JSON.parse(report.snapshot), protocol));
      } catch {
        /* Preserve existing unreadable-archive evidence for the recovery reader. */
      }
    }
    return result;
  }
  const result = structuredClone(table),
    world = result.journal?.world;
  if (world) {
    delete world.combat;
    if (world.tabletop) delete world.tabletop.presentation;
    if (protocol < 1) delete world.tabletop;
    world.maps = world.maps
      .map(fogSnapshotMap)
      .map(protocol === 1 ? previousTabletopMap : legacyTabletopMap);
  }
  for (const report of result.journal?.reports ?? []) {
    if (
      !report.snapshot.includes('"tabletop"') &&
      !report.snapshot.includes('"controllerPurseIds"') &&
      !report.snapshot.includes('"connected"') &&
      !report.snapshot.includes('"combat"') &&
      !report.snapshot.includes('"presentation"')
    )
      continue;
    try {
      report.snapshot = JSON.stringify(tableForProtocol(JSON.parse(report.snapshot), protocol));
    } catch {
      /* Preserve existing unreadable-archive evidence for the recovery reader. */
    }
  }
  return result;
}
function legacyDiagonalTable(table: CloudTable): CloudTable {
  const result = legacyDiagonals(table);
  if (result === table) return table;
  for (const report of result.journal?.reports ?? []) {
    if (!report.snapshot.includes('"alternating"')) continue;
    try {
      report.snapshot = JSON.stringify(legacyDiagonals(JSON.parse(report.snapshot)));
    } catch {
      /* Preserve existing unreadable-archive evidence for the recovery reader. */
    }
  }
  return result;
}
export function tabletopResponse<T extends { table: CloudTable; draft: string }>(
  value: T,
  protocol?: number,
): T {
  if (protocol && protocol >= PLACEMENT_STYLE_PROTOCOL) return withImageReferences(value);
  const draft: unknown = JSON.parse(value.draft);
  if (
    Array.isArray(draft) &&
    draft.some((c) => {
      if (!c || typeof c !== "object") return false;
      // Protocol 5: placement pin styles fail older strict placement schemas.
      if (
        c.kind === "map-save" &&
        [c.map, c.before].some((m) => m?.connected?.placements?.some((p: { style?: string }) => p?.style))
      )
        return true;
      if (protocol && protocol >= TABLETOP_PROTOCOL) return false;
      // Protocol 3 forms (compact history, continued strokes, consolidation, the alternating
      // diagonal) fail older strict schemas.
      if (
        (c.kind === "map-fog" && (c.continued || c.action === "consolidate")) ||
        JSON.stringify(c).includes('"fog-diff"') ||
        JSON.stringify(c).includes('"diagonal":"alternating"')
      )
        return true;
      if (protocol === 2) return false;
      if (
        c.kind === "map-combat-transition" ||
        (c.kind === "tabletop-session" && (c.session?.presentation || c.before?.presentation)) ||
        (c.kind === "map-save" && (c.map?.connected || c.before?.connected))
      )
        return true;
      if (protocol === 1) return false;
      return (
        commands.has(c.kind) ||
        (c.kind === "map-save" && (c.map?.tabletop || c.before?.tabletop)) ||
        (c.kind === "map-token" &&
          [c.token, c.before].some(
            (token) =>
              token &&
              ["locked", "controllerPurseIds", "offsetX", "offsetY", "style", "vision"].some(
                (key) => token[key] !== undefined,
              ),
          ))
      );
    })
  )
    throw Error(
      "This session has unfinished map actions from an updated Lootsplitter client. Finish or resolve those actions on the updated website before resuming this older app. Your saved campaign and pending work are retained.",
    );
  if (protocol && protocol >= IMAGE_REFERENCE_PROTOCOL) {
    const referenced = withImageReferences(value);
    return { ...referenced, table: tableForProtocol(referenced.table, protocol) };
  }
  return { ...value, table: tableForProtocol(value.table, protocol) };
}

/**
 * Protocol 4: replace each current map's inline image with the reference it was read from.
 * Only images restored from this room's own stored rows are replaced (the server attached them),
 * so every reference sent is one the seat can load. Images stored inline (shared with portraits,
 * or written in this same request) stay inline.
 */
export function withImageReferences<T extends { table: CloudTable }>(value: T): T {
  const sources = (value as T & { [ROOM_IMAGE_SOURCES_KEY]?: Map<string, string> })[
    ROOM_IMAGE_SOURCES_KEY
  ];
  const world = value.table.journal?.world;
  if (!sources?.size || !world?.maps.some((map) => sources.has(map.image))) return value;
  return {
    ...value,
    table: {
      ...value.table,
      journal: {
        ...value.table.journal!,
        world: {
          ...world,
          maps: world.maps.map((map) =>
            sources.has(map.image) ? { ...map, image: sources.get(map.image)! } : map,
          ),
        },
      },
    },
  };
}
