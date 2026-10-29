// "Ask the DM" movement (map tokens PR 8): on an approval map a player's move waits for the DM;
// the same rules as Automatic apply when asked; approving checks the token hasn't moved; deny,
// withdraw and replace; players see only their own requests; protocol 19.
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "./canonical-json.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, commandSchema } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { projectRecord } from "./session-records.ts";
import { MOVE_APPROVAL_PROTOCOL, tableForProtocol, tabletopResponse } from "./tabletop-protocol.ts";
import { mapGridSchema, type MapToken } from "./world-schema.ts";

const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const mira: CloudSeat = { id: "p1", token: "p1", name: "P1", role: "player", purseIds: ["mira"] };
const bram: CloudSeat = { id: "p2", token: "p2", name: "P2", role: "player", purseIds: ["bram"] };
const grid = mapGridSchema.parse({ columns: 20, rows: 12 });
const g = canonicalJson(grid);
const ch = (id: string, column: number, row: number): MapToken => ({ id: `${id}-token`, kind: "character", entityId: id, label: id, column, row, visibility: "party" });
function fixture(movement: "auto" | "off" | "approval" = "approval"): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: ["mira", "bram"].map((id) => ({ id, kind: "character" as const, name: id, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } })),
    journal: readJournal({
      world: {
        maps: [{ id: "keep", name: "Keep", image: "data:image/png;base64,AAAA", locationId: null, visible: true, anchors: [], markers: [], grid, tokens: [ch("mira", 2, 2), ch("bram", 3, 2)], tabletop: { movement, playerMovement: movement !== "off" } }],
      },
    }),
  };
}
const tokens = (t: CloudTable) => t.journal!.world!.maps[0].tokens!;
let n = 0;
const run = (t: CloudTable, c: object, seat = mira) => applyCommand(t, seat, commandSchema.parse({ ...c, id: `move-${++n}` }));
const ask = (t: CloudTable, after = { column: 6, row: 4 }, seat = mira, token = "mira-token") =>
  run(t, { kind: "map-move-request", requestId: `r-${++n}`, mapId: "keep", grid: g, tokenId: token, before: { column: tokens(t).find((x) => x.id === token)!.column, row: tokens(t).find((x) => x.id === token)!.row }, after }, seat);
const requests = (t: CloudTable) => t.journal!.world!.moveRequests!;

test("on an approval map a player's move waits; direct moves are refused", () => {
  const t = fixture();
  assert.throws(() => run(t, { kind: "map-token-move", mapId: "keep", grid: g, moves: [{ tokenId: "mira-token", before: { column: 2, row: 2 }, after: { column: 6, row: 4 } }] }), /cannot|can't|not allowed|DM/i);
  const next = ask(t);
  assert.equal(requests(next)[0].status, "pending");
  assert.deepEqual([tokens(next)[0].column, tokens(next)[0].row], [2, 2], "nothing moves yet");
  assert.throws(() => ask(t, undefined, mira, "bram-token"), /can't move this token/);
  assert.throws(() => ask(fixture("auto")), /can't move this token/, "Automatic maps move directly");
  assert.throws(() => ask(fixture("off")), /can't move this token/);
  assert.throws(() => ask(t, { column: 25, row: 4 }), /inside the combat grid|Invalid|too_big|Number must/);
});

test("the DM approves (the token moves) or denies; a moved token cancels the request", () => {
  const t = ask(fixture());
  const id = requests(t)[0].id;
  assert.throws(() => run(t, { kind: "map-move-request-review", requestId: id, approve: true }, bram), /Only the DM/);
  const approved = run(t, { kind: "map-move-request-review", requestId: id, approve: true }, dm);
  assert.equal(requests(approved)[0].status, "approved");
  assert.deepEqual([tokens(approved)[0].column, tokens(approved)[0].row], [6, 4]);
  assert.throws(() => run(approved, { kind: "map-move-request-review", requestId: id, approve: true }, dm), /already decided/);
  const denied = run(t, { kind: "map-move-request-review", requestId: id, approve: false, reason: "The bridge is out." }, dm);
  assert.equal(requests(denied)[0].status, "denied");
  assert.equal(requests(denied)[0].reason, "The bridge is out.");
  t.journal!.world!.maps[0].tokens![0].column = 9;
  const stale = run(t, { kind: "map-move-request-review", requestId: id, approve: true }, dm);
  assert.equal(requests(stale)[0].status, "cancelled");
  assert.equal(tokens(stale)[0].column, 9);
});

test("withdraw and replace; players see only their own requests", () => {
  let t = ask(fixture());
  const first = requests(t)[0].id;
  t = ask(t, { column: 7, row: 7 });
  assert.deepEqual(requests(t).map((r) => r.status), ["withdrawn", "pending"]);
  assert.throws(() => run(t, { kind: "map-move-request-withdraw", requestId: requests(t)[1].id }, bram), /Only the player/);
  const withdrawn = run(t, { kind: "map-move-request-withdraw", requestId: requests(t)[1].id });
  assert.equal(requests(withdrawn)[1].status, "withdrawn");
  void first;
  const both = ask(t, { column: 8, row: 8 }, bram, "bram-token");
  assert.deepEqual(projectRecord(both, bram).journal!.world!.moveRequests!.map((r) => r.purseId), ["bram"]);
  assert.equal(projectRecord(both, dm).journal!.world!.moveRequests!.length, 3);
});

test("protocol 19: older clients get no move requests; their drafts are refused", () => {
  const t = ask(fixture());
  assert.equal(MOVE_APPROVAL_PROTOCOL, 19);
  assert.equal(tableForProtocol(t, 18).journal!.world!.moveRequests, undefined);
  assert.throws(() => tabletopResponse({ table: t, draft: JSON.stringify([{ kind: "map-move-request" }]) }, 18), /unfinished map actions/);
});
