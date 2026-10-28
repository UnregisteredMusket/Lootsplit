// Simultaneous room writes all land, exactly once (live-campaign load audit F2 and F11, 2026-10-28).
// Six people acting at the same instant used to end with one "The table changed" failure, and joins,
// seat management, pace, naming, pass turn and close had no retry at all.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import {
  openRoom,
  joinRoom,
  roomState,
  submitCommands,
  choosePace,
  manageRoom,
  nameRoom,
  passTurn,
} from "./cloud.server.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { toCopper } from "./money.ts";
import {
  ROOM_WRITE_ATTEMPTS,
  isRoomConflict,
  retryRoomWrite,
  roomWriteDelay,
  setRoomWritePause,
} from "./room-write-retry.ts";

// Disposable in-memory D1 stand-in with every production migration; never a real campaign.
// Every query and batch first yields to the event loop, so concurrent writers really interleave
// between their read and their revision-guarded write, as they do on D1. Yields are event-loop
// turns, not timers, so the interleaving is the same on every machine.
const sql = new DatabaseSync(":memory:");
const migrations = new URL("../../../cloudflare/migrations/", import.meta.url);
for (const file of readdirSync(migrations)
  .filter((f) => f.endsWith(".sql"))
  .sort())
  sql.exec(readFileSync(new URL(file, migrations), "utf8"));
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
let conflicts = 0;
const statement = (query: string) => {
  let values: unknown[] = [];
  const runNow = () => {
    const changes = Number(sql.prepare(query).run(...(values as never[])).changes);
    if (!changes && /^UPDATE campaign_rooms SET revision/.test(query)) conflicts++;
    return { meta: { changes } };
  };
  return {
    runNow,
    bind(...args: unknown[]) {
      values = args;
      return this;
    },
    async all() {
      await turn();
      return { results: sql.prepare(query).all(...(values as never[])) };
    },
    async first() {
      await turn();
      return sql.prepare(query).get(...(values as never[])) ?? null;
    },
    async run() {
      await turn();
      return runNow();
    },
  };
};
(globalThis as any).__env__ = {
  DB: {
    prepare: statement,
    async batch(statements: { runNow: () => unknown }[]) {
      await turn();
      // One transaction, run without yielding (D1 batches are atomic).
      sql.exec("BEGIN");
      try {
        const results = statements.map((s) => s.runNow());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  },
};

// A seeded, growing pause measured in event-loop turns, standing in for the real 20 to 540 ms.
let seed = 7;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
setRoomWritePause(async (attempt) => {
  const turns = Math.round(roomWriteDelay(attempt, random) / 10);
  for (let i = 0; i < turns; i++) await turn();
});

const PLAYERS = ["p1", "p2", "p3", "p4", "p5"];
const gp = (n: number) => ({ cp: 0, sp: 0, ep: 0, gp: n, pp: 0 });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "party", name: "The Hoard", kind: "party", coins: gp(500) },
      ...PLAYERS.map((id) => ({
        id,
        name: id.toUpperCase(),
        kind: "character" as const,
        coins: gp(10),
      })),
    ],
  };
}
const copper = async (seat: { code: string; token: string }) =>
  Object.fromEntries(
    (await roomState(seat)).table.purses.map((p) => [p.id, toCopper(p.coins)]),
  ) as Record<string, number>;
const give = (
  seat: { code: string; token: string },
  id: string,
  fromId: string,
  toId: string,
  amount: number,
) =>
  submitCommands({
    tabletopProtocol: 10,
    code: seat.code,
    token: seat.token,
    batchId: `batch-${id}`,
    commands: [{ id, kind: "give", fromId, toId, copper: amount, holdingId: null, quantity: 0 }],
  });

test("the pause between attempts is 20 to 150 ms at first and grows, within a bounded number of attempts", () => {
  assert.equal(ROOM_WRITE_ATTEMPTS, 5);
  assert.equal(
    roomWriteDelay(0, () => 0),
    20,
  );
  assert.equal(
    roomWriteDelay(0, () => 1),
    150,
  );
  for (let a = 1; a < ROOM_WRITE_ATTEMPTS - 1; a++)
    assert.ok(
      roomWriteDelay(a, () => 1) > roomWriteDelay(a - 1, () => 1),
      `attempt ${a} waits longer`,
    );
  assert.ok(roomWriteDelay(99, () => 1) <= 540, "the pause is capped");
});

test("only revision conflicts are retried, and at most the bounded number of times", async () => {
  let calls = 0;
  await assert.rejects(
    retryRoomWrite(async () => {
      calls++;
      throw Error("Only the DM can manage participants.");
    }),
    /Only the DM/,
  );
  assert.equal(calls, 1, "a permission refusal is never retried");
  calls = 0;
  await assert.rejects(
    retryRoomWrite(async () => {
      calls++;
      throw Error("The table changed. Refresh before sending your turn.");
    }),
    /table changed/,
  );
  assert.equal(calls, ROOM_WRITE_ATTEMPTS);
  calls = 0;
  assert.equal(
    await retryRoomWrite(async (attempt) => {
      calls++;
      if (attempt < 2) throw Error("The table changed. Refresh before sending your turn.");
      return "saved";
    }),
    "saved",
  );
  assert.equal(calls, 3);
  assert.ok(isRoomConflict(Error("The table changed. Refresh before closing it.")));
  assert.ok(!isRoomConflict(Error("It is not your turn.")));
});

async function table() {
  const dm = await openRoom({ name: "Load DM", table: campaign() });
  const before = conflicts;
  // F11: five players join at the same moment.
  const joined = await Promise.all(
    PLAYERS.map((purseId) => joinRoom({ code: dm.code, purseId, name: purseId.toUpperCase() })),
  );
  return {
    dm,
    players: joined.map((j) => ({ ...j, code: dm.code })),
    joinConflicts: conflicts - before,
  };
}

test("five players joining at the same moment all get their own seat", async () => {
  const { dm, players, joinConflicts } = await table();
  assert.ok(joinConflicts > 0, "the joins really collided");
  assert.deepEqual(new Set(players.map((p) => p.purseIds[0])), new Set(PLAYERS));
  assert.equal(new Set(players.map((p) => p.seatId)).size, PLAYERS.length);
  const view = await roomState(dm);
  assert.equal(view.seats.filter((s) => s.role === "player").length, PLAYERS.length);
});

test("two people claiming one character at the same moment: one seat, the other is refused on the fresh room", async () => {
  const dm = await openRoom({ name: "Claim DM", table: campaign() });
  const results = await Promise.allSettled([
    joinRoom({ code: dm.code, purseId: "p1", name: "First" }),
    joinRoom({ code: dm.code, purseId: "p1", name: "Second" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.match(refused.reason.message, /already seated/);
  assert.equal((await roomState(dm)).seats.length, 2);
});

test("six simultaneous actions all succeed and each moves coins exactly once", async () => {
  const { dm, players } = await table();
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const start = await copper(dm);
  const before = conflicts;
  const burst = () => [
    give(dm, "dm-gift", "party", "p1", 700),
    ...players.map((p, i) => give(p, `gift-${i}`, p.purseIds[0]!, "party", 100 + i)),
  ];
  const results = await Promise.allSettled(burst());
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  assert.deepEqual(
    failed.map((r) => r.reason.message),
    [],
    "no simultaneous action failed",
  );
  assert.ok(
    conflicts - before >= 5,
    `the writes really collided (${conflicts - before} conflicts)`,
  );
  const expected = { ...start };
  expected.party += -700 + 100 + 101 + 102 + 103 + 104;
  expected.p1 += 700 - 100;
  for (let i = 1; i < PLAYERS.length; i++) expected[PLAYERS[i]!] -= 100 + i;
  assert.deepEqual(await copper(dm), expected);
  // Everyone resends the same batch (a lost response, or the client's automatic retry): nothing twice.
  const again = await Promise.allSettled(burst());
  assert.deepEqual(
    again.filter((r) => r.status === "rejected"),
    [],
  );
  assert.deepEqual(await copper(dm), expected);
});

test("joins, pace, naming, seat management and pass turn retry while the table is busy", async () => {
  const { dm, players } = await table();
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const chat = (p: (typeof players)[number], i: number) =>
    submitCommands({
      tabletopProtocol: 10,
      code: p.code,
      token: p.token,
      batchId: `chat-${i}`,
      commands: [
        { id: `chat-${i}`, kind: "message", to: "party", purseId: p.purseIds[0]!, text: `hi ${i}` },
      ],
    });
  const before = conflicts;
  const results = await Promise.allSettled([
    ...players.map(chat),
    nameRoom({ code: dm.code, token: dm.token, campaignName: "Busy Table" }),
    manageRoom({
      code: dm.code,
      token: dm.token,
      action: "permission",
      seatId: players[0]!.seatId,
      allowParty: true,
    }),
    choosePace({ code: dm.code, token: dm.token, live: false }),
  ]);
  assert.deepEqual(
    (results.filter((r) => r.status === "rejected") as PromiseRejectedResult[]).map(
      (r) => r.reason.message,
    ),
    [],
  );
  assert.ok(conflicts - before > 0, "the writes really collided");
  const view = await roomState(dm);
  assert.equal(view.campaignName, "Busy Table");
  assert.equal(view.live, false);
  assert.equal(view.table.notes.filter((n) => n.text?.startsWith("hi ")).length, PLAYERS.length);
  // Pass turn re-runs its checks on the fresh room: with the DM's turn current it moves on once.
  const turnBefore = view.turn;
  const passed = await Promise.all([passTurn(dm), chat(players[1]!, 99)]);
  assert.equal(passed[0].turn, (turnBefore + 1) % view.seats.length);
});

test("a retry re-checks permission on the fresh room: a player still cannot manage seats", async () => {
  const { dm, players } = await table();
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const results = await Promise.allSettled([
    manageRoom({
      code: dm.code,
      token: players[0]!.token,
      action: "kick",
      seatId: players[1]!.seatId,
    }),
    ...players.map((p, i) => give(p, `perm-${i}`, p.purseIds[0]!, "party", 1)),
  ]);
  assert.equal(results[0]!.status, "rejected");
  assert.match((results[0] as PromiseRejectedResult).reason.message, /Only the DM/);
  assert.equal((await roomState(dm)).seats.length, PLAYERS.length + 1);
});
