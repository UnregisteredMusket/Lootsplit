import type { CloudTable } from "./cloud.ts";
import type { CampaignMap, MapToken } from "./world-schema.ts";

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
  if (protocol >= 2) return table;
  const result = structuredClone(table),
    world = result.journal?.world;
  if (world) {
    delete world.combat;
    if (world.tabletop) delete world.tabletop.presentation;
    if (protocol < 1) delete world.tabletop;
    world.maps = world.maps.map(protocol === 1 ? previousTabletopMap : legacyTabletopMap);
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
  if (protocol && protocol >= 2) return value;
  const draft: unknown = JSON.parse(value.draft);
  if (
    Array.isArray(draft) &&
    draft.some((c) => {
      if (!c || typeof c !== "object") return false;
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
      "This session has unfinished map actions from an updated Lootsplit client. Finish or resolve those actions on the updated website before resuming this older app. Your saved campaign and pending work are retained.",
    );
  return { ...value, table: tableForProtocol(value.table, protocol) };
}
