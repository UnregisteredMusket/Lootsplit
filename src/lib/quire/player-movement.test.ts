// Player token movement (map tokens PR 2, owner 2026-10-29): free outside combat, turn-based while
// an encounter is active on the map, DM locks, claims, the legacy "off" default, privacy and
// older clients. Engine-level; the room-level checks are in player-movement-room.test.ts.
import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, commandSchema, type CommandInput } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { canonicalJson } from "./canonical-json.ts";
import { mapGridSchema, type MapToken } from "./world-schema.ts";
import { mapTabletopSchema } from "./tabletop-schema.ts";
import { legacyMovementOff, movementMode, readMapTabletop } from "./tabletop.ts";
import { projectRecord } from "./session-records.ts";
import {
  PLAYER_MOVEMENT_PROTOCOL,
  tableForProtocol,
  tabletopResponse,
  upgradeOldClientCommands,
} from "./tabletop-protocol.ts";

const dm: CloudSeat = { id: "dm", token: "dm-token", name: "DM", role: "dm", purseIds: [] };
const mira: CloudSeat = { id: "p1", token: "p1", name: "Mira's player", role: "player", purseIds: ["mira"] };
const grid = mapGridSchema.parse({ columns: 20, rows: 12 });
const tokens: MapToken[] = [
  { id: "mira-token", kind: "character", entityId: "mira", label: "Mira", column: 2, row: 2, visibility: "party" },
  { id: "torvald-token", kind: "character", entityId: "torvald", label: "Torvald", column: 3, row: 2, visibility: "party" },
  { id: "ogre", kind: "creature", label: "Ogre", encounterId: "fight", combatantId: "ogre", column: 8, row: 4, visibility: "party" },
  { id: "lurker", kind: "creature", label: "Lurker", encounterId: "fight", combatantId: "lurker", column: 9, row: 9, visibility: "dm" },
];
function fixture(settings?: object, extra: Partial<CloudTable["journal"]> = {}, list = tokens): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: ["mira", "torvald", "sela"].map((id) => ({
      id,
      kind: "character" as const,
      name: id[0].toUpperCase() + id.slice(1),
      coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    })),
    journal: readJournal({
      world: {
        maps: [
          {
            id: "keep",
            name: "Keep",
            image: "data:image/png;base64,AAAA",
            locationId: null,
            visible: true,
            anchors: [],
            markers: [],
            grid,
            tokens: list,
            ...(settings ? { tabletop: mapTabletopSchema.parse(settings) } : {}),
          },
        ],
      },
      ...extra,
    }),
  };
}
const keep = (t: CloudTable) => t.journal!.world!.maps[0];
const token = (t: CloudTable, id: string) => keep(t).tokens!.find((x) => x.id === id)!;
let seq = 0;
const run = (t: CloudTable, c: object, seat = dm, execution = {}) =>
  applyCommand(t, seat, commandSchema.parse({ ...c, id: `move-${++seq}` }), execution);
const move = (t: CloudTable, id: string, column: number, row: number, seat = mira, execution = {}) => {
  const x = token(t, id);
  return run(
    t,
    {
      kind: "map-token-move",
      mapId: "keep",
      grid: canonicalJson(grid),
      moves: [{ tokenId: id, before: { column: x.column, row: x.row }, after: { column, row } }],
      ignoreWalls: false,
    },
    seat,
    execution,
  );
};
const combat = (t: CloudTable) => {
  t.journal!.world!.combat = {
    id: "binding",
    encounterId: "fight",
    encounterRevision: 0,
    mapId: "keep",
    returnMapId: "keep",
    returnCamera: { x: 0.5, y: 0.5, zoom: 1 },
    mode: "theatre",
    phase: "active",
    scaleConfirmed: true,
    showPlayers: true,
  };
  return t;
};
const turn = (activeId: string | null, status = "active") => ({
  mapCombat: { encounterId: "fight", status, activeId },
});

test("movement mode: new maps default to Automatic; configured maps keep their choice", () => {
  assert.equal(movementMode(keep(fixture())), "auto");
  assert.equal(movementMode(keep(fixture({ playerMovement: true }))), "auto");
  assert.equal(movementMode(keep(fixture({}))), "off");
  assert.equal(legacyMovementOff(keep(fixture({}))), true);
  assert.equal(movementMode(keep(fixture({ movement: "off", playerMovement: false }))), "off");
  assert.equal(legacyMovementOff(keep(fixture({ movement: "off" }))), false);
  assert.equal(movementMode(keep(fixture({ movement: "approval" }))), "approval");
});

test("free movement outside combat: own token yes, another player's token and locks no", () => {
  const t = fixture();
  assert.equal(token(move(t, "mira-token", 5, 5), "mira-token").column, 5);
  assert.throws(() => move(t, "torvald-token", 5, 5), /cannot move/);
  assert.throws(() => move(t, "ogre", 5, 5), /cannot move/);
  token(t, "mira-token").locked = true;
  assert.throws(() => move(t, "mira-token", 5, 5), /cannot move/);
  token(t, "mira-token").locked = false;
  // A per-map character lock holds even if the token is removed and placed again.
  const locked = fixture({ movement: "auto", lockedPurseIds: ["mira"] });
  assert.throws(() => move(locked, "mira-token", 5, 5), /cannot move/);
  // Off: DM only. The DM can always move anything.
  const off = fixture({ movement: "off" });
  assert.throws(() => move(off, "mira-token", 5, 5), /cannot move/);
  assert.equal(token(move(off, "ogre", 1, 1, dm), "ogre").column, 1);
});

test("combat: a player moves only on their character's tracker turn; free again when it ends", () => {
  const t = combat(fixture());
  assert.throws(() => move(t, "mira-token", 5, 5, mira, turn("ogre")), /Not your turn — Ogre is acting/);
  assert.equal(token(move(t, "mira-token", 5, 5, mira, turn("mira")), "mira-token").column, 5);
  // A hidden combatant is never named.
  assert.throws(() => move(t, "mira-token", 5, 5, mira, turn("lurker")), /Not your turn — another combatant is acting/);
  // The tracker concluded (or not started): free movement.
  assert.equal(token(move(t, "mira-token", 6, 6, mira, turn("ogre", "concluded")), "mira-token").column, 6);
  // Fail closed when the server could not read the turn.
  assert.throws(() => move(t, "mira-token", 5, 5, mira, { mapCombat: "unavailable" }), /turn order is unavailable/);
  assert.throws(() => move(t, "mira-token", 5, 5, mira, {}), /turn order is unavailable/);
  // A device preview leaves the check to the room.
  assert.equal(token(move(t, "mira-token", 7, 7, mira, { preview: true }), "mira-token").column, 7);
  // The DM is never blocked.
  assert.equal(token(move(t, "ogre", 1, 1, dm, turn("mira")), "ogre").column, 1);
  // A prepared (not yet started) encounter doesn't make the map turn-based.
  t.journal!.world!.combat!.phase = "prepared";
  assert.equal(token(move(t, "mira-token", 5, 5, mira, {}), "mira-token").column, 5);
});

test("a delegated controller moves on the controlled character's turn only", () => {
  const t = combat(fixture());
  token(t, "torvald-token").controllerPurseIds = ["mira"];
  assert.equal(token(move(t, "torvald-token", 5, 5, mira, turn("torvald")), "torvald-token").column, 5);
  assert.throws(() => move(t, "torvald-token", 5, 5, mira, turn("mira")), /Not your turn — Mira is acting/);
});

test("claiming: a player places their own missing token on a visible square", () => {
  const t = fixture(undefined, {}, tokens.filter((x) => x.id !== "mira-token"));
  const claim = (seat = mira, extra: object = {}, execution = {}, table = t) =>
    run(table, { kind: "map-token-claim", mapId: "keep", grid: canonicalJson(grid), purseId: "mira", tokenId: "new-mira", at: { column: 4, row: 4 }, ...extra }, seat, execution);
  const placed = claim();
  assert.deepEqual(token(placed, "new-mira"), {
    id: "new-mira",
    kind: "character",
    entityId: "mira",
    label: "Mira",
    column: 4,
    row: 4,
    visibility: "party",
  });
  // Replaying it (or a second token) is refused: a character has one token per map.
  assert.throws(() => claim(mira, {}, {}, placed), /can't be placed here right now/);
  assert.throws(() => claim(dm, {}, {}, placed), /already has a token/);
  assert.throws(() => claim(mira, { purseId: "torvald" }), /your own character/);
  assert.throws(() => claim(mira, { at: { column: 4, row: 4, offsetX: 0.3 } }), /snapped/);
  assert.throws(() => claim(mira, { at: { column: 25, row: 4 } }));
  const off = fixture({ movement: "off" }, {}, []);
  assert.throws(() => claim(mira, {}, {}, off), /DM moves the tokens/);
  const fogged = fixture({ movement: "auto", fog: { enabled: true, base: "concealed", shapes: [] } }, {}, []);
  assert.throws(() => claim(mira, {}, {}, fogged), /visible square/);
  // During combat on this map: only on that character's turn.
  const fight = combat(fixture(undefined, {}, tokens.filter((x) => x.id !== "mira-token")));
  assert.throws(() => claim(mira, {}, turn("ogre"), fight), /Not your turn/);
  assert.equal(token(claim(mira, {}, turn("mira"), fight), "new-mira").column, 4);
  // The DM may place it for the player.
  assert.equal(token(claim(dm, {}, {}, off), "new-mira").entityId, "mira");
});

test("settings writes keep the movement choice; a map's first settings keep Automatic", () => {
  // Fog on a map without settings creates them; movement stays Automatic.
  const t = fixture();
  const fogged = run(t, { kind: "map-fog", mapId: "keep", before: readMapTabletop(keep(t)).fog, action: "enable" });
  assert.equal(movementMode(keep(fogged)), "auto");
  assert.equal(keep(fogged).tabletop!.playerMovement, true, "older clients read movement as on");
  // A scene save that leaves movement out keeps it.
  const off = fixture({ movement: "off", lockedPurseIds: ["sela"] });
  const saved = run(off, { kind: "map-tabletop", mapId: "keep", before: keep(off).tabletop!, settings: { ...readMapTabletop(keep(off)), movement: undefined, lockedPurseIds: undefined, playerTemplates: true } });
  assert.equal(keep(saved).tabletop!.movement, "off");
  assert.deepEqual(keep(saved).tabletop!.lockedPurseIds, ["sela"]);
  // Turn on Automatic (the DM's one-tap notice) keeps playerMovement in step.
  const legacy = fixture({});
  const auto = run(legacy, { kind: "map-tabletop", mapId: "keep", before: keep(legacy).tabletop!, settings: { ...readMapTabletop(keep(legacy)), movement: "auto" } });
  assert.equal(movementMode(keep(auto)), "auto");
  assert.equal(keep(auto).tabletop!.playerMovement, true);
});

test("privacy: a player sees the movement choice and only their own locks", () => {
  const t = fixture({ movement: "auto", lockedPurseIds: ["mira", "torvald"] });
  const view = projectRecord(t, mira);
  assert.equal(keep(view).tabletop!.movement, "auto");
  assert.deepEqual(keep(view).tabletop!.lockedPurseIds, ["mira"]);
  const other = projectRecord(t, { ...mira, purseIds: ["sela"] });
  assert.equal(keep(other).tabletop!.lockedPurseIds, undefined);
});

test("protocol 15: older clients see playerMovement only; their toggle sets Automatic or Off", () => {
  assert.equal(PLAYER_MOVEMENT_PROTOCOL, 15);
  const t = fixture({ movement: "auto", playerMovement: true, lockedPurseIds: ["sela"] });
  const old = keep(tableForProtocol(t, 14)).tabletop!;
  assert.equal("movement" in old, false);
  assert.equal("lockedPurseIds" in old, false);
  assert.equal(old.playerMovement, true);
  const save = (settings: object) => {
    const [c] = upgradeOldClientCommands(t, [{ id: "x", kind: "map-tabletop", mapId: "keep", before: old, settings: { ...old, ...settings } }], 14);
    return keep(run(t, c as CommandInput)).tabletop!;
  };
  // Unrelated change: the choice and the locks are kept.
  assert.deepEqual([save({ playerTemplates: true }).movement, save({ playerTemplates: true }).lockedPurseIds], ["auto", ["sela"]]);
  // Unticking "Allow assigned-player token movement": Off.
  assert.equal(save({ playerMovement: false }).movement, "off");
  // Drafts with claims or the new fields ask older clients to update.
  for (const draft of [[{ kind: "map-token-claim" }], [{ kind: "map-tabletop", settings: { movement: "off" } }]])
    assert.throws(() => tabletopResponse({ table: t, draft: JSON.stringify(draft) }, 14), /unfinished map actions/);
  // Older clients can't skip the turn rule: the server checks every protocol.
  const fight = combat(fixture());
  assert.throws(() => move(fight, "mira-token", 5, 5, mira, turn("ogre")), /Not your turn/);
});

// Privacy review 2026-10-29 (finding A4a): a token the DM hid is never revealed by a claim refusal,
// and the claim's activity line reaches only that character's player and the DM.
test("claiming: a DM-hidden token is not revealed; the event stays with the player", () => {
  const hidden = fixture(undefined, {}, [...tokens.filter((x) => x.id !== "mira-token"), { ...tokens[0], visibility: "dm" }]);
  assert.equal(projectRecord(hidden, mira).journal!.world!.maps[0].tokens!.some((x) => x.id === "mira-token"), false);
  assert.throws(
    () => run(hidden, { kind: "map-token-claim", mapId: "keep", grid: canonicalJson(grid), purseId: "mira", tokenId: "n1", at: { column: 4, row: 4 } }, mira),
    (e: Error) => e.message === "That character can't be placed here right now.",
  );
  const placed = run(fixture(undefined, {}, tokens.filter((x) => x.id !== "mira-token")), { kind: "map-token-claim", mapId: "keep", grid: canonicalJson(grid), purseId: "mira", tokenId: "n2", at: { column: 4, row: 4 } }, mira);
  const torvald: CloudSeat = { id: "p2", token: "p2", name: "Torvald's player", role: "player", purseIds: ["torvald"] };
  assert.equal(projectRecord(placed, mira).journal!.events.some((e) => /token placed/.test(e.summary)), true);
  assert.equal(projectRecord(placed, torvald).journal!.events.some((e) => /token placed/.test(e.summary)), false);
});
