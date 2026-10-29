import { canonicalJson } from "./canonical-json.ts";
import type { CloudTable } from "./cloud.ts";
import type { CommandRequest } from "./commands.ts";
import { DEFAULT_FORMATION, planFormation } from "./formation.ts";
import { groupInfo, groupMembers, groupPlace, MAIN_GROUP } from "./party-groups.ts";
import { snapTokenPosition } from "./tabletop-geometry.ts";
import { readMapTabletop, readTabletopSession } from "./tabletop.ts";
import type { CampaignMap, MapToken } from "./world-schema.ts";

/** One "Move party to ▸" destination (map tokens PR 4; mockup context-menu-desktop). */
export type PartyDestination = { mapId: string; name: string; hint: string };

/**
 * "Move party to ▸": this map's submaps (with the entrance that leads there, "via trapdoor"),
 * then the connected maps: the parent map and the maps this map's entrances lead to.
 */
export function partyDestinations(maps: readonly CampaignMap[], map: CampaignMap) {
  const linkTo = (id: string) => map.connected?.links.find((l) => l.targetMapId === id);
  const submaps: PartyDestination[] = maps
    .filter((m) => m.id !== map.id && m.connected?.parentMapId === map.id)
    .map((m) => {
      const link = linkTo(m.id);
      return { mapId: m.id, name: m.name, hint: link ? `via ${link.label}` : "submap" };
    });
  const seen = new Set([map.id, ...submaps.map((d) => d.mapId)]);
  const connected: PartyDestination[] = [];
  const parent = map.connected?.parentMapId ? maps.find((m) => m.id === map.connected!.parentMapId) : undefined;
  if (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    connected.push({ mapId: parent.id, name: parent.name, hint: "parent map" });
  }
  for (const link of map.connected?.links ?? []) {
    const target = maps.find((m) => m.id === link.targetMapId);
    if (!target || seen.has(target.id)) continue;
    seen.add(target.id);
    connected.push({ mapId: target.id, name: target.name, hint: link.label });
  }
  return { submaps, connected };
}

/**
 * Where the party arrives on `to`: its entrance back to `from`, else the entry view of the
 * entrance that leads there, else the map's starting view, else its middle.
 */
export function partyEntry(from: CampaignMap, to: CampaignMap) {
  const back = to.connected?.links.find((l) => l.targetMapId === from.id);
  if (back) return { x: back.x, y: back.y, zoom: back.entry?.zoom ?? 1 };
  const entry = from.connected?.links.find((l) => l.targetMapId === to.id)?.entry;
  if (entry) return entry;
  return readMapTabletop(to).initialView ?? { x: 0.5, y: 0.5, zoom: 1 };
}

export type PartyMoveOptions = {
  follow: boolean;
  placeTokens: boolean;
  /** A split party: the group that moves (absent = the main group, as before). */
  groupId?: string;
};

/**
 * The one batch for "Move party to ▸ <map>" (plan section 3.1), all or nothing, in this order:
 * 1. `party-location` when the destination is somewhere else (its checks refuse pending
 *    downtime and journeys);
 * 2. `tabletop-session`: the players' scene follows to the destination at the entry (on by
 *    default; only for maps players can see);
 * 3. `map-tokens-place`: the main group's character tokens arrive in the party's formation at
 *    the entry, and leave this map.
 */
export function partyMoveCommands(
  table: Pick<CloudTable, "journal" | "purses">,
  from: CampaignMap,
  to: CampaignMap,
  options: PartyMoveOptions,
  newId: () => string = () => crypto.randomUUID(),
): CommandRequest[] {
  const steps: CommandRequest[] = [];
  const group = options.groupId ?? MAIN_GROUP,
    place = groupPlace(table, group);
  if (to.locationId && to.locationId !== place.locationId) {
    steps.push({
      kind: "party-location",
      before: place.locationId,
      locationId: to.locationId,
      ...(place.position ? { beforePosition: canonicalJson(place.position) } : {}),
      ...(group !== MAIN_GROUP ? { groupId: group } : {}),
    });
  }
  const entry = partyEntry(from, to);
  if (options.follow && to.visible) {
    const session = readTabletopSession(table);
    steps.push({
      kind: "tabletop-session",
      before: table.journal?.world?.tabletop ?? null,
      session: {
        ...session,
        activeMapId: to.id,
        activationId: newId(),
        camera: { mapId: to.id, view: entry, nonce: newId() },
      },
    });
  }
  if (options.placeTokens && to.grid) {
    const members = groupMembers(table, group);
    const moving = members.map((person) => {
      const there = to.tokens?.find((t) => t.kind === "character" && t.entityId === person.id);
      const here = from.tokens?.find((t) => t.kind === "character" && t.entityId === person.id);
      const token: MapToken = there ??
        (here ? { ...here } : { id: newId(), kind: "character", entityId: person.id, label: person.name, column: 0, row: 0, visibility: "party" });
      delete token.offsetX;
      delete token.offsetY;
      return { token, before: there ?? null, here };
    });
    const others = (to.tokens ?? []).filter((t) => !moving.some((m) => m.before?.id === t.id));
    const at = snapTokenPosition(to.grid, {}, entry) ?? { column: Math.floor(to.grid.columns / 2), row: Math.floor(to.grid.rows / 2) };
    const plan = planFormation(
      to.grid,
      others,
      moving.map((m) => m.token),
      { column: at.column, row: at.row },
      readTabletopSession(table).partyFormation ?? DEFAULT_FORMATION,
      readMapTabletop(to).walls,
    );
    const place = plan.places.map((p) => {
      const m = moving.find((x) => x.token.id === p.id)!;
      return { tokenId: p.id, before: m.before, token: { ...m.token, column: p.column, row: p.row } };
    });
    const remove = from.grid
      ? moving
          .filter((m) => m.here && plan.places.some((p) => p.id === m.token.id))
          .map((m) => ({ mapId: from.id, grid: from.grid!, tokenId: m.here!.id, before: m.here! }))
      : [];
    if (place.length)
      steps.push({ kind: "map-tokens-place", mapId: to.id, grid: to.grid, place, ...(remove.length ? { remove } : {}) });
  }
  return steps;
}

/**
 * The summary shown before the batch is sent: "The party moves to The Cellar · players' scene
 * switches · 4 tokens placed at the trapdoor".
 */
export function partyMoveSummary(
  table: Pick<CloudTable, "journal" | "purses">,
  from: CampaignMap,
  to: CampaignMap,
  steps: readonly CommandRequest[],
  groupId?: string,
) {
  const who = groupInfo(table, groupId ?? MAIN_GROUP).name;
  const parts = [`${who} moves to ${to.name}`];
  if (steps.some((s) => s.kind === "tabletop-session")) parts.push("players' scene switches");
  const placed = steps.find((s) => s.kind === "map-tokens-place");
  if (placed && placed.kind === "map-tokens-place") {
    const back = to.connected?.links.find((l) => l.targetMapId === from.id);
    const via = from.connected?.links.find((l) => l.targetMapId === to.id);
    const n = placed.place.length;
    parts.push(`${n} ${n === 1 ? "token" : "tokens"} placed at the ${via?.label ?? back?.label ?? "entry"}`);
  }
  return parts.join(" · ");
}
