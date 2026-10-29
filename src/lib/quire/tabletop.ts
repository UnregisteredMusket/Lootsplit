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
  shiftToken,
  tokenBox,
  tokenInsideGrid,
  tokenSnapped,
  type VisionSource,
} from "./tabletop-geometry.ts";
import {
  FOG_HISTORY_DEPTH,
  applyFogEntry,
  compactFogHistory,
  compactTabletopHistory,
  expandTabletopHistory,
  fogDiff,
} from "./fog-history.ts";
import { consolidateFog } from "./fog-consolidate.ts";
import { legacyDiagonals } from "./tabletop-protocol.ts";
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
/** How players may move tokens on this map (owner, 2026-10-29). */
export type MovementMode = "auto" | "off" | "approval";
/**
 * The map's player movement: its explicit `movement`, else "auto" for a map without tabletop
 * settings (new maps), else `playerMovement` (maps configured before protocol 15 keep their "off").
 */
export function movementMode(map: Pick<CampaignMap, "tabletop">): MovementMode {
  const settings = map.tabletop;
  if (!settings) return "auto";
  return settings.movement ?? (settings.playerMovement ? "auto" : "off");
}
/** A map whose movement is off only because it predates the choice: the DM's one-tap notice. */
export const legacyMovementOff = (map: Pick<CampaignMap, "tabletop">) =>
  !!map.tabletop && map.tabletop.movement === undefined && !map.tabletop.playerMovement;
/** The seat's characters that the DM has not locked on this map. */
function unlockedPurseIds(map: CampaignMap, seat: Seat) {
  const locked = map.tabletop?.lockedPurseIds ?? [];
  return seat.purseIds.filter((id) => !locked.includes(id));
}
/** Movement rules that hold in and out of combat; the combat turn is checked separately. */
export function canMoveMapToken(table: CloudTable, map: CampaignMap, token: MapToken, seat: Seat) {
  if (seat.role === "dm") return true;
  if (
    !mapAccessible(table, map, seat) ||
    movementMode(map) !== "auto" ||
    token.locked ||
    token.visibility !== "party"
  )
    return false;
  const own = unlockedPurseIds(map, seat);
  if (token.kind === "character") {
    const person = table.purses.find((p) => p.id === token.entityId && p.kind === "character");
    if (!person || !characterVisible(table, person)) return false;
    if (own.includes(person.id)) return true;
    if (seat.purseIds.includes(person.id)) return false;
  }
  return !!token.controllerPurseIds?.some(
    (id) =>
      own.includes(id) &&
      table.purses.some((p) => p.id === id && p.kind === "character" && characterVisible(table, p)),
  );
}
/** The tracker's turn for the encounter bound to a map (read by the server per batch). */
export type MapCombatTurn = { encounterId: string; status: string; activeId: string | null };
/** The active combat binding when it is on this map. */
export function combatOnMap(table: Pick<CloudTable, "journal">, mapId: string) {
  const combat = table.journal?.world?.combat;
  return combat?.phase === "active" && combat.mapId === mapId ? combat : undefined;
}
/** Whether a token is the tracker's active combatant (map-combat.ts uses the same rule). */
export function tokenTakesTurn(
  token: Pick<MapToken, "kind" | "entityId" | "encounterId" | "combatantId">,
  encounterId: string,
  activeId: string | null | undefined,
) {
  if (!activeId) return false;
  return (
    (token.encounterId === encounterId && token.combatantId === activeId) ||
    (token.kind === "character" && token.entityId === activeId && !token.combatantId)
  );
}
/**
 * Turn-based movement during combat (owner, 2026-10-29): while an encounter is active on this
 * map, a player moves only the token whose combatant has the tracker's turn. The DM is never
 * blocked. The server fails closed when it could not read the turn; a device preview, which has
 * no turn, leaves the check to the room.
 */
function assertCombatTurn(
  table: CloudTable,
  map: CampaignMap,
  tokens: readonly MapToken[],
  seat: Seat,
  execution: TabletopExecution,
) {
  if (seat.role === "dm") return;
  const combat = combatOnMap(table, map.id);
  if (!combat) return;
  const turn = execution.mapCombat;
  if (!turn && execution.preview) return;
  if (!turn || turn === "unavailable" || turn.encounterId !== combat.encounterId)
    throw Error("The turn order is unavailable — ask the DM.");
  if (turn.status !== "active") return;
  for (const token of tokens) {
    if (tokenTakesTurn(token, combat.encounterId, turn.activeId)) continue;
    // Only a combatant this seat can already see is named.
    const visible = mapPointVisibleTo(table, map, seat);
    const acting = (map.tokens ?? []).find(
      (t) =>
        t.visibility === "party" &&
        tokenTakesTurn(t, combat.encounterId, turn.activeId) &&
        !!map.grid &&
        visible(sceneTokenPoint(map.grid, t)),
    );
    throw Error(`Not your turn — ${acting ? acting.label : "another combatant"} is acting.`);
  }
}
/** What the room server supplies to tabletop commands (cloud.server.ts submitCommands). */
export type TabletopExecution = {
  preview?: boolean;
  /** The bound encounter's turn, or "unavailable" when the server could not read it. */
  mapCombat?: MapCombatTurn | "unavailable";
};
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
/**
 * Whether a point on this map reaches this seat, by the rule pins, links and templates follow
 * (fog first, then vision). Quest radius markers use it for their centre (docs/QUESTS.md).
 */
export function mapPointVisibleTo(
  table: Pick<CloudTable, "journal" | "purses">,
  map: CampaignMap,
  seat: Seat,
): (point: { x: number; y: number }) => boolean {
  if (seat.role === "dm" || !map.tabletop) return () => true;
  const settings = readMapTabletop(map),
    viewers = sceneViewers(table, map, seat, false);
  return (point) => scenePointVisible(point, settings, map.grid, viewers);
}
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
    ...(map.tabletop?.movement ? { movement: map.tabletop.movement } : {}),
    // Only the seat's own characters' locks reach a player.
    ...(settings.lockedPurseIds?.some((id) => seat.purseIds.includes(id))
      ? { lockedPurseIds: settings.lockedPurseIds.filter((id) => seat.purseIds.includes(id)) }
      : {}),
    playerTemplates: settings.playerTemplates,
    snap: settings.snap,
    ...(settings.gridHidden ? { gridHidden: true } : {}),
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
    connected: map.connected
      ? {
          ...map.connected,
          placedRecords: map.connected.placements.map((p) => p.record),
          links: map.connected.links.filter((l) => l.visibility === "party" && visible(l)),
          placements: map.connected.placements.filter(
            (p) => p.visibility === "party" && visible(p),
          ),
        }
      : undefined,
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
  if (
    session.presentation &&
    !world.maps.some((m) => m.id === session.presentation!.mapId && (projected || m.visible))
  )
    throw Error("Combat presentation requires a shared map.");
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
  execution: TabletopExecution = {},
) {
  const world = table.journal!.world!;
  const dm = () => {
    if (seat.role !== "dm") throw Error("Only the DM can configure tabletop scenes.");
  };
  const event = (summary: string) =>
    table.journal!.events.push({ id: command.id + "-event", at, kind: "management", summary });
  if (command.kind === "tabletop-session") {
    dm();
    const previousSession = world.tabletop ? { ...world.tabletop } : null;
    if (previousSession) delete previousSession.presentation;
    if (!same(world.tabletop ?? null, command.before) && !same(previousSession, command.before))
      throw Error("Tabletop session controls changed. Refresh before saving.");
    const next = { ...command.session };
    if (next.presentation === undefined && world.tabletop?.presentation)
      next.presentation = world.tabletop.presentation;
    if (next.presentation && next.presentation.mapId !== next.activeMapId) next.presentation = null;
    world.tabletop = next;
    validateTabletop(table);
    event("Online tabletop session controls updated");
    return;
  }
  const map = world.maps.find((m) => m.id === command.mapId);
  if (!map || !mapAccessible(table, map, seat)) throw Error("This map is unavailable.");
  const previousSettings = map.tabletop;
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
    if (
      !same(map.tabletop ?? null, command.before) &&
      !(map.tabletop && same(expandTabletopHistory(map.tabletop), command.before))
    )
      throw Error("Map configuration changed. Your draft is retained; refresh before saving.");
    // Supplied history was read relative to the fog the client last saw.
    map.tabletop = {
      ...compactTabletopHistory(command.settings, command.before?.fog ?? settings.fog),
      revision: settings.revision + 1,
    };
    event("Map tabletop configuration updated");
  } else if (command.kind === "map-fog") {
    dm();
    if (!same(settings.fog, command.before))
      throw Error("Exploration changed. Refresh before revealing or concealing an area.");
    if (command.result && command.action !== "consolidate")
      throw Error("Only fog consolidation supplies a resulting fog.");
    const prior = structuredClone(settings.fog);
    // Older rooms may hold full-snapshot history; it is converted here, exactly, to diffs.
    settings.fogUndo = compactFogHistory(prior, settings.fogUndo);
    settings.fogRedo = compactFogHistory(prior, settings.fogRedo);
    if (command.action === "undo" || command.action === "redo") {
      const source = command.action === "undo" ? settings.fogUndo : settings.fogRedo;
      const target = command.action === "undo" ? settings.fogRedo : settings.fogUndo;
      const entry = source.pop();
      if (!entry) throw Error("There is no exploration change to " + command.action + ".");
      const next = applyFogEntry(prior, entry);
      target.push(fogDiff(next, prior));
      if (target.length > FOG_HISTORY_DEPTH) target.shift();
      settings.fog = next;
    } else {
      if (command.action === "shape") {
        const shapes = command.shape ? [command.shape, ...(command.continued ?? [])] : [];
        if (
          !shapes.length ||
          settings.fog.shapes.length + shapes.length > 500 ||
          new Set(shapes.map((s) => s.id)).size !== shapes.length ||
          settings.fog.shapes.some((s) => shapes.some((shape) => shape.id === s.id))
        )
          throw Error(
            "Choose a new valid exploration shape; consolidate or reset a full fog history.",
          );
        settings.fog.enabled = true;
        settings.fog.shapes.push(...shapes);
      } else if (command.continued) throw Error("Only a brush stroke can continue across shapes.");
      else if (command.action === "consolidate") {
        // Recomputed here: the stored fog changes only when the server reaches the same result.
        const consolidated = consolidateFog(prior).fog;
        if (same(consolidated, prior)) throw Error("This map's fog is already consolidated.");
        if (!command.result || !same(consolidated, command.result))
          throw Error("Exploration changed. Refresh before consolidating fog.");
        settings.fog = consolidated;
      } else if (command.action === "reveal-all" || command.action === "conceal-all") {
        settings.fog = {
          enabled: true,
          base: command.action === "reveal-all" ? "revealed" : "concealed",
          shapes: [],
        };
      } else settings.fog.enabled = command.action === "enable";
      settings.fogUndo = [
        ...settings.fogUndo.slice(-(FOG_HISTORY_DEPTH - 1)),
        fogDiff(settings.fog, prior),
      ];
      settings.fogRedo = [];
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
  } else if (command.kind === "map-token-claim") {
    if (!map.grid) throw Error("Configure a combat grid before placing tokens.");
    if (
      canonicalJson(map.grid) !== command.grid &&
      canonicalJson(legacyDiagonals(map.grid)) !== command.grid
    )
      throw Error("The combat grid changed. Refresh before placing your token.");
    const person = table.purses.find((p) => p.id === command.purseId && p.kind === "character");
    if (!person || !characterVisible(table, person)) throw Error("This character is unavailable.");
    if (seat.role !== "dm") {
      if (!seat.purseIds.includes(person.id))
        throw Error("You can only place your own character's token.");
      if (movementMode(map) !== "auto") throw Error("The DM moves the tokens on this map.");
      if (settings.lockedPurseIds?.includes(person.id))
        throw Error(`The DM has locked ${person.name}'s movement on this map.`);
    }
    if ((map.tokens ?? []).some((t) => t.kind === "character" && t.entityId === person.id))
      throw Error(`${person.name} already has a token on this map.`);
    if ((map.tokens ?? []).some((t) => t.id === command.tokenId))
      throw Error("Choose a new token. Refresh and try again.");
    const token: MapToken = {
      id: command.tokenId,
      kind: "character",
      entityId: person.id,
      label: person.name,
      column: command.at.column,
      row: command.at.row,
      ...(command.at.offsetX !== undefined ? { offsetX: command.at.offsetX } : {}),
      ...(command.at.offsetY !== undefined ? { offsetY: command.at.offsetY } : {}),
      visibility: "party",
    };
    if (!tokenInsideGrid(map.grid, token)) throw Error("Keep tokens inside the combat grid.");
    if (settings.snap && !tokenSnapped(token))
      throw Error("This map requires movement snapped to the grid.");
    if (
      seat.role !== "dm" &&
      !scenePointVisible(sceneTokenPoint(map.grid, token), settings, map.grid, sceneViewers(table, map, seat))
    )
      throw Error("Choose a visible square.");
    assertCombatTurn(table, map, [token], seat, execution);
    map.tokens = [...(map.tokens ?? []), token];
    if (map.tabletop && settings.vision !== "off")
      map.tabletop = { ...settings, revision: settings.revision + 1 };
    event(`${person.name}'s token placed`);
  } else if (command.kind === "map-grid-snap") {
    dm();
    if (!map.grid) throw Error("Configure a combat grid before turning on grid mode.");
    if (canonicalJson(map.grid) !== command.grid)
      throw Error("The combat grid changed. Refresh before turning on grid mode.");
    if (!same(map.tabletop ?? null, command.before))
      throw Error("Map configuration changed. Refresh before changing grid mode.");
    if (new Set(command.moves.map((m) => m.tokenId)).size !== command.moves.length)
      throw Error("Select each token only once.");
    const next = structuredClone(map.tokens ?? []);
    for (const move of command.moves) {
      const token = next.find((t) => t.id === move.tokenId);
      if (!token || !same(position(token), position(move.before)))
        throw Error("A token moved or changed. Refresh before changing grid mode.");
      const placed = { ...token, ...move.after };
      if (move.after.offsetX === undefined) delete placed.offsetX;
      if (move.after.offsetY === undefined) delete placed.offsetY;
      if (!tokenInsideGrid(map.grid, placed)) throw Error("Keep tokens inside the combat grid.");
      if (command.snap && !tokenSnapped(placed))
        throw Error("Grid mode needs every moved token on a square.");
      Object.assign(token, placed);
      if (move.after.offsetX === undefined) delete token.offsetX;
      if (move.after.offsetY === undefined) delete token.offsetY;
    }
    map.tokens = next;
    map.tabletop = { ...settings, snap: command.snap, revision: settings.revision + 1 };
    event(command.snap ? "Grid mode turned on; tokens snapped" : "Grid mode change undone");
  } else if (command.kind === "map-token-move") {
    if (!map.grid) throw Error("Configure a combat grid before moving tokens.");
    if (
      canonicalJson(map.grid) !== command.grid &&
      canonicalJson(legacyDiagonals(map.grid)) !== command.grid
    )
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
      // Footprints (protocol 13): the whole footprint stays inside the grid, and with grid mode
      // on the position must already be snapped. The server refuses; it never relocates a token.
      const placed = { ...token, ...move.after };
      if (move.after.offsetX === undefined) delete placed.offsetX;
      if (move.after.offsetY === undefined) delete placed.offsetY;
      if (!tokenInsideGrid(map.grid, placed)) throw Error("Keep tokens inside the combat grid.");
      if (settings.snap && !tokenSnapped(placed))
        throw Error("This map requires movement snapped to the grid.");
      const a = sceneTokenPoint(map.grid, token),
        b = sceneTokenPoint(map.grid, placed);
      if (
        seat.role !== "dm" &&
        !scenePointVisible(b, settings, map.grid, sceneViewers(table, map, seat))
      )
        throw Error("Choose a visible destination.");
      if (!command.ignoreWalls && blocked(a, b, settings.walls, true))
        throw Error("A configured map barrier blocks this move; the DM can override it.");
      assertCombatTurn(table, map, [token], seat, execution);
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
      const from = tokenBox({ ...ship, ...move.before }),
        to = tokenBox({ ...ship, ...move.after });
      for (const crew of next.filter((t) => t.kind === "character" && aboard.has(t.entityId!))) {
        const original = map.tokens!.find((t) => t.id === crew.id)!;
        const carried = shiftToken(original, to.left - from.left, to.top - from.top);
        if (requested.has(crew.id) && !same(position(crew), position(carried)))
          throw Error("An aboard character must retain its relative ship position.");
        if (!tokenInsideGrid(map.grid, { ...original, ...carried }))
          throw Error("Moving this ship would place an aboard character outside the grid.");
        Object.assign(crew, carried);
      }
    }
    map.tokens = next;
    if (map.tabletop && settings.vision !== "off")
      map.tabletop = { ...settings, revision: settings.revision + 1 };
    event("Combat map tokens moved");
  }
  keepMovement(map, previousSettings);
  validateTabletop(table);
}
/**
 * After any write to a map's tabletop settings: settings that leave out `movement` or
 * `lockedPurseIds` keep the stored ones (older clients and tools that only change fog, walls or
 * lights), a map getting its first settings keeps the default "auto", and `playerMovement`
 * follows `movement` so older clients read it sensibly. Also used by map saves (world.ts).
 */
export function keepMovement(map: CampaignMap, previous: CampaignMap["tabletop"]) {
  const next = map.tabletop;
  if (!next) return;
  if (next.movement === undefined) {
    if (previous?.movement) next.movement = previous.movement;
    else if (!previous) next.movement = "auto";
  }
  if (next.lockedPurseIds === undefined && previous?.lockedPurseIds?.length)
    next.lockedPurseIds = previous.lockedPurseIds;
  if (next.movement) next.playerMovement = next.movement !== "off";
}
