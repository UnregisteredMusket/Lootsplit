import type { CloudTable } from "./cloud.ts";
import type { CampaignMap, MapToken } from "./world-schema.ts";

const commands = new Set(["tabletop-session", "map-tabletop", "map-token-move", "map-fog", "map-template"]);
export function legacyTabletopToken(token: MapToken): MapToken {
  const result = { ...token };
  delete result.locked; delete result.controllerPurseIds; delete result.offsetX;
  delete result.offsetY; delete result.style; delete result.vision;
  return result;
}
export function legacyTabletopMap(map: CampaignMap): CampaignMap {
  const result = { ...map };
  delete result.tabletop;
  if (map.tokens) result.tokens = map.tokens.map(legacyTabletopToken);
  return result;
}
/** Applied after seat/privacy projection. Older APKs have strict map/token schemas. */
export function legacyTabletopTable(table: CloudTable): CloudTable {
  const result = structuredClone(table), world = result.journal?.world;
  if (world) {
    delete world.tabletop;
    world.maps = world.maps.map(legacyTabletopMap);
  }
  for (const report of result.journal?.reports ?? []) {
    if (!report.snapshot.includes('"tabletop"') && !report.snapshot.includes('"controllerPurseIds"')) continue;
    try { report.snapshot = JSON.stringify(legacyTabletopTable(JSON.parse(report.snapshot))); }
    catch { /* Preserve existing unreadable-archive evidence for the recovery reader. */ }
  }
  return result;
}
export function tabletopResponse<T extends { table: CloudTable; draft: string }>(value: T, protocol?: number): T {
  if (protocol === 1) return value;
  const draft: unknown = JSON.parse(value.draft);
  if (Array.isArray(draft) && draft.some(c => c && typeof c === "object" && (commands.has(c.kind) || c.kind === "map-save" && (c.map?.tabletop || c.before?.tabletop) || c.kind === "map-token" && (c.token?.style || c.token?.vision || c.token?.controllerPurseIds))))
    throw Error("This session has unfinished map actions from an updated Lootsplit client. Finish or resolve those actions on the updated website before resuming this older app. Your saved campaign and pending work are retained.");
  return { ...value, table: legacyTabletopTable(value.table) };
}
