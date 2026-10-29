// Group placement and group commands (map tokens PR 3): the formation planner, map-tokens-place
// (atomic, before-checked, Send to map), map-tokens-edit, the party formation default, offline
// parity of the shared engine, and protocol 16.
import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, applyCommandBatch, commandSchema, type CommandInput } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { canonicalJson } from "./canonical-json.ts";
import { mapGridSchema, type MapToken } from "./world-schema.ts";
import { DEFAULT_FORMATION, placeUndo, planFormation } from "./formation.ts";
import { readTabletopSession } from "./tabletop.ts";
import { projectRecord } from "./session-records.ts";
import { GROUP_COMMANDS_PROTOCOL, tableForProtocol, tabletopResponse, upgradeOldClientCommands } from "./tabletop-protocol.ts";

const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = { id: "p", token: "p", name: "P", role: "player", purseIds: ["mira"] };
const grid = mapGridSchema.parse({ columns: 20, rows: 12 });
const ch = (id: string, column: number, row: number): MapToken => ({ id: `${id}-token`, kind: "character", entityId: id, label: id, column, row, visibility: "party" });
function fixture(): CloudTable {
  const map = (id: string, tokens: MapToken[]) => ({ id, name: id, image: "data:image/png;base64,AAAA", locationId: null, visible: true, anchors: [], markers: [], grid, tokens });
  return {
    ...emptyCloudTable(),
    purses: ["mira", "torvald", "sela", "bram"].map((id) => ({ id, kind: "character" as const, name: id, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } })),
    journal: readJournal({ world: { maps: [map("keep", [ch("mira", 1, 1), ch("torvald", 2, 1)]), map("cellar", [ch("sela", 4, 4)])] } }),
  };
}
const mapOf = (t: CloudTable, id: string) => t.journal!.world!.maps.find((m) => m.id === id)!;
let seq = 0;
const run = (t: CloudTable, c: object, seat = dm) => applyCommand(t, seat, commandSchema.parse({ ...c, id: `group-${++seq}` }));

test("formations: a 2×2 cluster centred on the anchor, lines, circles, spacing and rotation", () => {
  const members = ["a", "b", "c", "d"].map((id) => ({ id }));
  const cluster = planFormation(grid, [], members, { column: 10, row: 6 }, DEFAULT_FORMATION);
  assert.deepEqual(cluster.places.map((p) => [p.column, p.row]), [[9, 5], [10, 5], [9, 6], [10, 6]]);
  const line = planFormation(grid, [], members, { column: 10, row: 6 }, { shape: "line", spacing: 1, rotation: 0 });
  assert.deepEqual(line.places.map((p) => [p.column, p.row]), [[7, 6], [9, 6], [11, 6], [13, 6]]);
  const turned = planFormation(grid, [], members, { column: 10, row: 6 }, { shape: "line", spacing: 0, rotation: 90 });
  assert.ok(turned.places.every((p) => p.column === 10), "a rotated line is vertical");
  const circle = planFormation(grid, [], members, { column: 10, row: 6 }, { shape: "circle", spacing: 0, rotation: 0 });
  assert.equal(new Set(circle.places.map((p) => `${p.column},${p.row}`)).size, 4);
});

test("formations skip occupied, outside and wall-blocked squares; wide members take whole footprints", () => {
  const plan = planFormation(grid, [{ column: 9, row: 5 }], [{ id: "a" }, { id: "b" }], { column: 9, row: 5 }, DEFAULT_FORMATION);
  assert.ok(plan.places.every((p) => !(p.column === 9 && p.row === 5)));
  assert.equal(plan.displaced >= 1, true);
  const edge = planFormation(grid, [], [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], { column: 19, row: 11 }, DEFAULT_FORMATION);
  assert.ok(edge.places.every((p) => p.column < 20 && p.row < 12));
  const wall = { id: "w", a: { x: 0.5, y: 0 }, b: { x: 0.5, y: 1 }, kind: "wall" as const, open: false, blocksSight: true, blocksMovement: true };
  const walled = planFormation(grid, [], [{ id: "a" }, { id: "b" }], { column: 9, row: 5 }, { shape: "line", spacing: 0, rotation: 0 }, [wall]);
  assert.ok(walled.places.every((p) => p.column < 10), "no member lands behind the wall");
  const large = planFormation(grid, [], [{ id: "ogre", sizeClass: "large", anchor: "corner" }, { id: "b" }], { column: 5, row: 5 }, { shape: "line", spacing: 0, rotation: 0 });
  const [o, b] = large.places;
  assert.ok(b.column >= o.column + 2 || b.row >= o.row + 2 || b.column < o.column, "no overlap with the 2×2");
});

test("map-tokens-place: one DM action places, moves and sends tokens between maps", () => {
  const t = fixture();
  const keep = mapOf(t, "keep"),
    sela = mapOf(t, "cellar").tokens![0];
  const next = run(t, {
    kind: "map-tokens-place",
    mapId: "keep",
    grid,
    place: [
      { tokenId: "mira-token", before: keep.tokens![0], token: { ...keep.tokens![0], column: 8, row: 5 } },
      { tokenId: "bram-token", before: null, token: ch("bram", 9, 5) },
      { tokenId: "sela-token", before: null, token: { ...sela, column: 8, row: 6 } },
    ],
    remove: [{ mapId: "cellar", grid, tokenId: "sela-token", before: sela }],
  });
  assert.deepEqual(mapOf(next, "keep").tokens!.map((x) => [x.id, x.column]), [["mira-token", 8], ["torvald-token", 2], ["bram-token", 9], ["sela-token", 8]]);
  assert.equal(mapOf(next, "cellar").tokens!.length, 0);
  // Atomic: one stale before refuses everything.
  const stale = () =>
    run(next, { kind: "map-tokens-place", mapId: "keep", grid, place: [{ tokenId: "mira-token", before: keep.tokens![0], token: { ...keep.tokens![0], column: 3 } }, { tokenId: "x", before: null, token: { ...ch("torvald", 0, 0), id: "x" } }] });
  assert.throws(stale, /moved or changed/);
  // Replaying the same placement (a lost response) is refused, not applied twice.
  assert.throws(() => run(next, { kind: "map-tokens-place", mapId: "keep", grid, place: [{ tokenId: "bram-token", before: null, token: ch("bram", 9, 5) }] }), /moved or changed/);
  // A character has one token per map; footprints must fit.
  assert.throws(() => run(next, { kind: "map-tokens-place", mapId: "keep", grid, place: [{ tokenId: "dup", before: null, token: { ...ch("mira", 0, 0), id: "dup" } }] }));
  assert.throws(() => run(t, { kind: "map-tokens-place", mapId: "keep", grid, place: [{ tokenId: "big", before: null, token: { id: "big", kind: "other", label: "Big", column: 19, row: 0, visibility: "dm", sizeClass: "large", anchor: "corner" } }] }), /fit inside/);
  assert.throws(() => run(t, { kind: "map-tokens-place", mapId: "keep", grid, place: [{ tokenId: "bram-token", before: null, token: ch("bram", 9, 5) }] }, player), /Only the DM/);
});

test("map-tokens-edit: hide, lock and size several tokens in one action; identity never changes", () => {
  const t = fixture();
  const [a, b] = mapOf(t, "keep").tokens!;
  const next = run(t, { kind: "map-tokens-edit", mapId: "keep", edits: [a, b].map((x) => ({ tokenId: x.id, before: x, token: { ...x, visibility: "dm", locked: true } })) });
  assert.ok(mapOf(next, "keep").tokens!.every((x) => x.visibility === "dm" && x.locked));
  assert.throws(() => run(t, { kind: "map-tokens-edit", mapId: "keep", edits: [{ tokenId: a.id, before: a, token: { ...a, entityId: "torvald" } }] }), /identity/);
  assert.throws(() => run(next, { kind: "map-tokens-edit", mapId: "keep", edits: [{ tokenId: a.id, before: a, token: a }] }), /moved or changed/);
  assert.throws(() => run(t, { kind: "map-tokens-edit", mapId: "keep", edits: [{ tokenId: a.id, before: a, token: a }] }, player), /Only the DM/);
});

test("the same batch gives the same result on the device and in a room (shared engine)", () => {
  const t = fixture();
  const keep = mapOf(t, "keep");
  const batch = [
    commandSchema.parse({ id: "p1", kind: "map-tokens-place", mapId: "keep", grid, place: [{ tokenId: "bram-token", before: null, token: ch("bram", 9, 5) }] }),
    commandSchema.parse({ id: "e1", kind: "map-tokens-edit", mapId: "keep", edits: [{ tokenId: "mira-token", before: keep.tokens![0], token: { ...keep.tokens![0], locked: true } }] }),
  ];
  const server = applyCommandBatch(t, dm, batch, () => ({ source: "server" })),
    device = applyCommandBatch(t, dm, batch, () => ({ source: "local" }));
  assert.deepEqual(mapOf(server, "keep").tokens, mapOf(device, "keep").tokens);
});

test("protocol 16: the party formation default is kept from older clients' session saves", () => {
  assert.equal(GROUP_COMMANDS_PROTOCOL, 16);
  const t = fixture();
  const set = run(t, { kind: "tabletop-session", before: null, session: { ...readTabletopSession(t), partyFormation: { shape: "line", spacing: 1, rotation: 90 } } });
  assert.deepEqual(readTabletopSession(set).partyFormation, { shape: "line", spacing: 1, rotation: 90 });
  const old = tableForProtocol(set, 15).journal!.world!.tabletop!;
  assert.equal("partyFormation" in old, false);
  const [c] = upgradeOldClientCommands(set, [{ id: "s", kind: "tabletop-session", before: old, session: { ...old, tvEnabled: true } }], 15);
  const saved = run(set, c as CommandInput);
  assert.equal(readTabletopSession(saved).tvEnabled, true);
  assert.deepEqual(readTabletopSession(saved).partyFormation, { shape: "line", spacing: 1, rotation: 90 });
  for (const draft of [[{ kind: "map-tokens-place" }], [{ kind: "map-tokens-edit" }], [{ kind: "tabletop-session", session: { partyFormation: {} } }]])
    assert.throws(() => tabletopResponse({ table: set, draft: JSON.stringify(draft) }, 15), /unfinished map actions/);
});

// Privacy review 2026-10-29 (finding A1): group placement and edits leave a generic activity line,
// never a map name or a count of tokens players may not see (DM-only maps, hidden tokens).
test("privacy: placing on a DM-only map or hiding tokens names no map and counts nothing", () => {
  const t = fixture();
  t.journal!.world!.maps.push({ id: "lair", name: "Secret Dragon Lair", image: "data:image/png;base64,AAAA", locationId: null, visible: false, anchors: [], markers: [], grid, tokens: [] });
  const ambush: MapToken = { id: "amb", kind: "other", label: "Ambusher", column: 3, row: 3, visibility: "dm" };
  const placed = run(t, { kind: "map-tokens-place", mapId: "lair", grid, place: [{ tokenId: "amb", before: null, token: ambush }] });
  const [a, b] = mapOf(placed, "keep").tokens!;
  const hidden = run(placed, { kind: "map-tokens-edit", mapId: "keep", edits: [a, b].map((x) => ({ tokenId: x.id, before: x, token: { ...x, visibility: "dm" } })) });
  const seen = projectRecord(hidden, player).journal!.events.map((e) => e.summary);
  assert.equal(seen.some((s) => /Lair|keep|\d+ tokens?/.test(s)), false, seen.join(" | "));
  assert.deepEqual(seen.filter((s) => s === "Map tokens updated").length, 2);
});

// Privacy review 2026-10-29 (finding A2): the Place Undo checks every token against the placed
// state, so a move made after the placement is never overwritten.
test("Place Undo: restores only while every token is as placed", () => {
  const t = fixture();
  const keep = mapOf(t, "keep");
  const entries = [
    { tokenId: "mira-token", before: keep.tokens![0], token: { ...keep.tokens![0], column: 8, row: 5 } },
    { tokenId: "bram-token", before: null, token: ch("bram", 9, 5) },
  ];
  const placed = run(t, { kind: "map-tokens-place", mapId: "keep", grid, place: entries });
  const undone = run(placed, placeUndo("keep", grid, entries));
  assert.deepEqual(mapOf(undone, "keep").tokens!.map((x) => [x.id, x.column]), [["mira-token", 1], ["torvald-token", 2]]);
  // Mira moves after the placement: Undo is refused and her move stays.
  const moved = run(placed, { kind: "map-token-move", mapId: "keep", grid: canonicalJson(grid), moves: [{ tokenId: "mira-token", before: { column: 8, row: 5 }, after: { column: 10, row: 5 } }], ignoreWalls: false });
  assert.throws(() => run(moved, placeUndo("keep", grid, entries)), /moved or changed/);
  assert.equal(mapOf(moved, "keep").tokens!.find((x) => x.id === "mira-token")!.column, 10);
});
