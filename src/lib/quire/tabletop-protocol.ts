import type { CloudTable } from "./cloud.ts";
import type { CampaignMap, MapToken } from "./world-schema.ts";
import { expandTabletopHistory, tabletopHasFogDiffs } from "./fog-history.ts";

/**
 * The current tabletop table shape; 3 added compact fog history and continued brush strokes.
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
  if (protocol >= TABLETOP_PROTOCOL) return table;
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
export function tabletopResponse<T extends { table: CloudTable; draft: string }>(
  value: T,
  protocol?: number,
): T {
  if (protocol && protocol >= IMAGE_REFERENCE_PROTOCOL) return withImageReferences(value);
  if (protocol && protocol >= TABLETOP_PROTOCOL) return value;
  const draft: unknown = JSON.parse(value.draft);
  if (
    Array.isArray(draft) &&
    draft.some((c) => {
      if (!c || typeof c !== "object") return false;
      // Protocol 3 fog forms (compact history, continued strokes) fail older strict schemas.
      if ((c.kind === "map-fog" && c.continued) || JSON.stringify(c).includes('"fog-diff"'))
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
