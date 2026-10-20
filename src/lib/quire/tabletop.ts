import { canonicalJson } from "./canonical-json.ts";
import { characterVisible } from "./character-position.ts";
import { readFleet } from "./ships-schema.ts";
import {
  mapTabletopSchema,
  tabletopSessionSchema,
  type TabletopCommand,
  type MapTabletop,
} from "./tabletop-schema.ts";
import {
  blocked,
  scenePointVisible,
  sceneTokenPoint,
  type VisionSource,
} from "./tabletop-geometry.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { CampaignMap, MapToken } from "./world-schema.ts";

type Seat = Pick<CloudSeat, "role" | "purseIds"> & { id?: string };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
export const readMapTabletop = (map: Pick<CampaignMap, "tabletop">): MapTabletop =>
  mapTabletopSchema.parse(map.tabletop ?? {});
export const readTabletopSession = (table: Pick<CloudTable, "journal">) =>
  tabletopSessionSchema.parse(table.journal?.world?.tabletop ?? {});
export function mapAccessible(table: CloudTable, map: CampaignMap, seat: Seat) {
  const session = readTabletopSession(table);
  return (
    seat.role === "dm" ||
    (map.visible &&
      (session.playerBrowsing || !session.activeMapId || session.activeMapId === map.id))
  );
}
export function canMoveMapToken(table: CloudTable, map: CampaignMap, token: MapToken, seat: Seat) {
  if (seat.role === "dm") return true;
  if (
    !mapAccessible(table, map, seat) ||
    !readMapTabletop(map).playerMovement ||
    token.locked ||
    token.visibility !== "party"
  )
    return false;
  if (token.kind === "character") {
    const person = table.purses.find((p) => p.id === token.entityId && p.kind === "character");
    if (!person || !characterVisible(table, person)) return false;
    if (seat.purseIds.includes(person.id)) return true;
  }
  return !!token.controllerPurseIds?.some(
    (id) =>
      seat.purseIds.includes(id) &&
      table.purses.some((p) => p.id === id && p.kind === "character" && characterVisible(table, p)),
  );
}
export function sceneViewers(
  table: Pick<CloudTable, "journal" | "purses">,
  map: CampaignMap,
  seat: Seat,
  party = false,
): VisionSource[] {
  if (!map.grid) return [];
  const individual = !party && readMapTabletop(map).vision === "individual";
  return (map.tokens ?? [])
    .filter((token) => {
      if (
        token.kind !== "character" ||
        token.visibility !== "party" ||
        token.vision?.enabled === false
      )
        return false;
      const p = table.purses.find((p) => p.id === token.entityId && p.kind === "character");
      return !!p && characterVisible(table, p) && (!individual || seat.purseIds.includes(p.id));
    })
    .map((token) => ({
      point: sceneTokenPoint(map.grid!, token),
      rangeFeet: token.vision?.rangeFeet ?? 60,
      darkvisionFeet: token.vision?.darkvisionFeet ?? 0,
    }));
}
/** Safe fallback until an authorized, visibility-baked render has been published. */
export const concealedMapImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
export function mapNeedsMask(settings: MapTabletop) {
  return (
    settings.vision !== "off" ||
    (settings.fog.enabled &&
      (settings.fog.base === "concealed" || settings.fog.shapes.some((shape) => !shape.reveal)))
  );
}
/** Explicit projection: hidden geometry, edit history and original pixels never reach a player. */
export function projectTabletopMap(
  table: Pick<CloudTable, "journal" | "purses">,
  map: CampaignMap,
  seat: Seat,
  party = false,
): CampaignMap {
  if (!map.tabletop) return map;
  const settings = readMapTabletop(map),
    viewers = sceneViewers(table, map, seat, party);
  const visible = (point: { x: number; y: number }) =>
    scenePointVisible(point, settings, map.grid, viewers);
  const masked = mapNeedsMask(settings);
  const frames = settings.frames.filter(
    (frame) =>
      frame.revision === settings.revision &&
      (party || settings.vision !== "individual"
        ? frame.audience === "party"
        : seat.purseIds.some((id) => frame.audience === "purse:" + id)),
  );
  const projected = mapTabletopSchema.parse({
    revision: settings.revision,
    playerMovement: settings.playerMovement,
    playerTemplates: settings.playerTemplates,
    snap: settings.snap,
    unitLabel: settings.unitLabel,
    unitsPerFoot: settings.unitsPerFoot,
    initialView: settings.initialView,
    media: masked ? frames[0]?.media : settings.media,
    frames: masked ? frames : [],
    vision: settings.vision,
    ambientLight: settings.ambientLight,
    fog: { enabled: settings.fog.enabled, base: "concealed", shapes: [] },
    templates: settings.templates
      .filter((t) => t.visibility === "party" && visible(t.origin))
      .map((t) => ({
        ...t,
        controllerPurseId:
          t.controllerPurseId && seat.purseIds.includes(t.controllerPurseId)
            ? t.controllerPurseId
            : undefined,
      })),
  });
  return {
    ...map,
    image: masked ? concealedMapImage : map.image,
    connected: map.connected ? { ...map.connected,
      placedRecords: map.connected.placements.map(p => p.record),
      links: map.connected.links.filter(l => l.visibility === "party" && visible(l)),
      placements: map.connected.placements.filter(p => p.visibility === "party" && visible(p)),
    } : undefined,
    anchors: map.anchors.filter(visible),
    markers: map.markers.filter((m) => m.visibility === "party" && visible(m)),
    tokens: map.tokens
      ?.filter(
        (t) => t.visibility === "party" && !!map.grid && visible(sceneTokenPoint(map.grid, t)),
      )
      .map((t) => ({
        ...t,
        controllerPurseIds: t.controllerPurseIds?.filter((id) => seat.purseIds.includes(id)),
        vision: t.entityId && seat.purseIds.includes(t.entityId) ? t.vision : undefined,
      })),
    tabletop: projected,
  };
}
function position(token: { column: number; row: number; offsetX?: number; offsetY?: number }) {
  return {
    column: token.column,
    row: token.row,
    offsetX: token.offsetX ?? 0,
    offsetY: token.offsetY ?? 0,
  };
}
export function validateTabletop(table: CloudTable, projected = false) {
  const world = table.journal?.world;
  if (!world) return;
  const session = readTabletopSession(table);
  if (
    session.activeMapId &&
    !world.maps.some((m) => m.id === session.activeMapId && (projected || m.visible))
  )
    throw Error("The active player scene must be a shared map.");
  if (
    session.camera &&
    !world.maps.some((m) => m.id === session.camera!.mapId && (projected || m.visible))
  )
    throw Error("A synchronized camera must refer to a shared map.");
  if (session.presentation && !world.maps.some(m=>m.id===session.presentation!.mapId && (projected||m.visible))) throw Error("Combat presentation requires a shared map.");
  for (const map of world.maps) {
    const settings = readMapTabletop(map);
    for (const [label, values] of [
      ["wall", settings.walls],
      ["light", settings.lights],
      ["template", settings.templates],
      ["fog shape", settings.fog.shapes],
    ] as const)
      if (new Set(values.map((v) => v.id)).size !== values.length)
        throw Error(`Duplicate ${label} IDs.`);
    if (!projected)
      for (const token of map.tokens ?? [])
        if (
          token.controllerPurseIds?.some(
            (id) => !table.purses.some((p) => p.id === id && p.kind === "character"),
          )
        )
          throw Error("Token control must refer to an existing character.");
  }
}
/** Executes inside the existing cloned command batch / CAS / receipt transaction. */
export function applyTabletopCommand(
  table: CloudTable,
  seat: CloudSeat,
  command: TabletopCommand,
  at: number,
) {
  const world = table.journal!.world!;
  const dm = () => {
    if (seat.role !== "dm") throw Error("Only the DM can configure tabletop scenes.");
  };
  const event = (summary: string) =>
    table.journal!.events.push({ id: command.id + "-event", at, kind: "management", summary });
  if (command.kind === "tabletop-session") {
    dm();
    const previousSession = world.tabletop ? {...world.tabletop} : null;
    if (previousSession) delete previousSession.presentation;
    if (!same(world.tabletop ?? null, command.before) && !same(previousSession,command.before))
      throw Error("Tabletop session controls changed. Refresh before saving.");
    const next = {...command.session};
    if (next.presentation === undefined && world.tabletop?.presentation) next.presentation=world.tabletop.presentation;
    if (next.presentation && next.presentation.mapId !== next.activeMapId) next.presentation=null;
    world.tabletop = next;
    validateTabletop(table);
    event("Online tabletop session controls updated");
    return;
  }
  const map = world.maps.find((m) => m.id === command.mapId);
  if (!map || !mapAccessible(table, map, seat)) throw Error("This map is unavailable.");
  const settings = readMapTabletop(map);
  if (command.kind === "map-render") {
    dm();
    if (settings.revision !== command.revision || command.frame.revision !== settings.revision)
      throw Error("Visibility changed while rendering. Refresh the player view.");
    const current = settings.frames.find((frame) => frame.audience === command.frame.audience);
    if ((current?.id ?? null) !== command.beforeFrameId)
      throw Error("This player view was already updated.");
    if (
      command.frame.audience !== "party" &&
      !table.purses.some(
        (p) => p.kind === "character" && command.frame.audience === "purse:" + p.id,
      )
    )
      throw Error("Choose an existing character's view.");
    settings.frames = [
      ...settings.frames.filter((frame) => frame.audience !== command.frame.audience),
      command.frame,
    ];
    if (settings.frames.length > 201) throw Error("Too many player views.");
    map.tabletop = settings;
  } else if (command.kind === "map-tabletop") {
    dm();
    if (!same(map.tabletop ?? null, command.before))
      throw Error("Map configuration changed. Your draft is retained; refresh before saving.");
    map.tabletop = { ...command.settings, revision: settings.revision + 1 };
    event("Map tabletop configuration updated");
  } else if (command.kind === "map-fog") {
    dm();
    if (!same(settings.fog, command.before))
      throw Error("Exploration changed. Refresh before revealing or concealing an area.");
    const prior = structuredClone(settings.fog);
    if (command.action === "undo" || command.action === "redo") {
      const source = command.action === "undo" ? settings.fogUndo : settings.fogRedo;
      const target = command.action === "undo" ? settings.fogRedo : settings.fogUndo;
      const next = source.pop();
      if (!next) throw Error("There is no exploration change to " + command.action + ".");
      target.push(prior);
      if (target.length > 20) target.shift();
      settings.fog = next;
    } else {
      settings.fogUndo = [...settings.fogUndo.slice(-19), prior];
      settings.fogRedo = [];
      if (command.action === "shape") {
        if (
          !command.shape ||
          settings.fog.shapes.length >= 500 ||
          settings.fog.shapes.some((s) => s.id === command.shape!.id)
        )
          throw Error(
            "Choose a new valid exploration shape; consolidate or reset a full fog history.",
          );
        settings.fog.enabled = true;
        settings.fog.shapes.push(command.shape);
      } else if (command.action === "reveal-all" || command.action === "conceal-all") {
        settings.fog = {
          enabled: true,
          base: command.action === "reveal-all" ? "revealed" : "concealed",
          shapes: [],
        };
      } else settings.fog.enabled = command.action === "enable";
    }
    settings.revision++;
    map.tabletop = settings;
    event("Map exploration updated");
  } else if (command.kind === "map-template") {
    const current = settings.templates.find((t) => t.id === command.templateId) ?? null;
    if (!same(current, command.before))
      throw Error("This area template changed. Refresh before saving.");
    if (command.template && command.template.id !== command.templateId)
      throw Error("Template identity cannot change.");
    if (seat.role !== "dm") {
      if (
        !settings.playerTemplates ||
        [current, command.template]
          .filter(Boolean)
          .some(
            (t) =>
              t!.visibility !== "party" ||
              !t!.controllerPurseId ||
              !seat.purseIds.includes(t!.controllerPurseId),
          )
      )
        throw Error("You cannot edit this area template.");
      if (
        command.template &&
        !scenePointVisible(
          command.template.origin,
          settings,
          map.grid,
          sceneViewers(table, map, seat),
        )
      )
        throw Error("Choose a visible template origin.");
    }
    settings.templates = [
      ...settings.templates.filter((t) => t.id !== command.templateId),
      ...(command.template ? [command.template] : []),
    ];
    if (settings.templates.length > 200)
      throw Error("A map supports up to 200 saved area templates.");
    map.tabletop = settings;
    event("Map area template updated");
  } else if (command.kind === "map-token-move") {
    if (!map.grid) throw Error("Configure a combat grid before moving tokens.");
    if (canonicalJson(map.grid) !== command.grid)
      throw Error("The combat grid changed. Refresh before moving tokens.");
    if (command.ignoreWalls && seat.role !== "dm")
      throw Error("Only the DM can override configured map barriers.");
    if (new Set(command.moves.map((m) => m.tokenId)).size !== command.moves.length)
      throw Error("Select each token only once.");
    const next = structuredClone(map.tokens ?? []),
      requested = new Map(command.moves.map((m) => [m.tokenId, m]));
    for (const move of command.moves) {
      const token = next.find((t) => t.id === move.tokenId);
      if (!token || !canMoveMapToken(table, map, token, seat))
        throw Error("You cannot move one of these tokens.");
      if (!same(position(token), position(move.before)))
        throw Error("A selected token moved or changed. Refresh before moving it.");
      if (move.after.column >= map.grid.columns || move.after.row >= map.grid.rows)
        throw Error("Keep tokens inside the combat grid.");
      if (settings.snap && ((move.after.offsetX ?? 0) !== 0 || (move.after.offsetY ?? 0) !== 0))
        throw Error("This map requires movement snapped to the grid.");
      const a = sceneTokenPoint(map.grid, token),
        b = sceneTokenPoint(map.grid, move.after);
      if (
        seat.role !== "dm" &&
        !scenePointVisible(b, settings, map.grid, sceneViewers(table, map, seat))
      )
        throw Error("Choose a visible destination.");
      if (!command.ignoreWalls && blocked(a, b, settings.walls, true))
        throw Error("A configured map barrier blocks this move; the DM can override it.");
      Object.assign(token, move.after);
      if (move.after.offsetX === undefined) delete token.offsetX;
      if (move.after.offsetY === undefined) delete token.offsetY;
    }
    for (const move of command.moves) {
      const ship = map.tokens?.find((t) => t.id === move.tokenId && t.kind === "ship");
      if (!ship) continue;
      const aboard = new Set(
        readFleet(table.journal!.fleet)
          .aboard.filter((a) => a.propertyId === ship.entityId)
          .map((a) => a.purseId),
      );
      for (const crew of next.filter((t) => t.kind === "character" && aboard.has(t.entityId!))) {
        const original = map.tokens!.find((t) => t.id === crew.id)!;
        const x =
          original.column +
          0.5 +
          (original.offsetX ?? 0) +
          move.after.column -
          move.before.column +
          (move.after.offsetX ?? 0) -
          (move.before.offsetX ?? 0);
        const y =
          original.row +
          0.5 +
          (original.offsetY ?? 0) +
          move.after.row -
          move.before.row +
          (move.after.offsetY ?? 0) -
          (move.before.offsetY ?? 0);
        const column = Math.min(map.grid.columns - 1, Math.floor(x)),
          row = Math.min(map.grid.rows - 1, Math.floor(y));
        const carried = { column, row, offsetX: x - column - 0.5, offsetY: y - row - 0.5 };
        if (requested.has(crew.id) && !same(position(crew), carried))
          throw Error("An aboard character must retain its relative ship position.");
        if (x < 0 || y < 0 || x > map.grid.columns || y > map.grid.rows)
          throw Error("Moving this ship would place an aboard character outside the grid.");
        Object.assign(crew, carried);
      }
    }
    map.tokens = next;
    if (map.tabletop && settings.vision !== "off")
      map.tabletop = { ...settings, revision: settings.revision + 1 };
    event("Combat map tokens moved");
  }
  validateTabletop(table);
}
