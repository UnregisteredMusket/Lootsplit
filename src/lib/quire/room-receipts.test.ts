// Action receipts live in campaign_room_receipts, not the room body (live-campaign load audit F1,
// 2026-10-28): a campaign can no longer fill up with receipts, a room that already did recovers on
// its next write, and every action stays idempotent for the life of the campaign.
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
  closeRoom,
} from "./cloud.server.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { toCopper } from "./money.ts";
import { ACKNOWLEDGED_LIMIT, database, deleteRoom, readRoom, updateRoom } from "./room-store.server.ts";
import { readStoredRoom } from "../../../cloudflare/room-storage.mjs";
import { ROOM_BODY_LIMIT } from "../../../cloudflare/room-images.mjs";

// Disposable in-memory D1 stand-in with every production migration; never a real campaign.
const sql = new DatabaseSync(":memory:");
const migrations = new URL("../../../cloudflare/migrations/", import.meta.url);
for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort())
  sql.exec(readFileSync(new URL(file, migrations), "utf8"));
const statement = (query: string) => {
  let values: unknown[] = [];
  return {
    bind(...args: unknown[]) {
      values = args;
      return this;
    },
    async all() {
      return { results: sql.prepare(query).all(...(values as never[])) };
    },
    async first() {
      return sql.prepare(query).get(...(values as never[])) ?? null;
    },
    async run() {
      return { meta: { changes: Number(sql.prepare(query).run(...(values as never[])).changes) } };
    },
  };
};
(globalThis as any).__env__ = {
  DB: {
    prepare: statement,
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  },
};

const coins = (gp: number) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "party", name: "The Hoard", kind: "party", coins: coins(500) },
      { id: "aria", name: "Aria", kind: "character", coins: coins(10) },
    ],
  };
}
async function room() {
  const dm = await openRoom({ name: "Receipts DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  await choosePace({ ...dm, live: true });
  return { dm, aria: { ...aria, code: dm.code } };
}
const say = (who: { code: string; token: string }, id: string, purseId = "aria") =>
  submitCommands({
    code: who.code,
    token: who.token,
    batchId: `batch-${id}`,
    commands: [{ id, kind: "message", to: "party", purseId, text: `line ${id}` }],
  });
const receiptRows = (code: string) =>
  (sql.prepare("SELECT COUNT(*) AS n FROM campaign_room_receipts WHERE code=?").get(code) as { n: number }).n;
const storedBody = (code: string) =>
  (sql.prepare("SELECT body FROM campaign_rooms WHERE code=?").get(code) as { body: string }).body;

test("receipts are stored in their own table, never in the room body", async () => {
  const { dm, aria } = await room();
  await say(aria, "hello");
  const body = JSON.parse(storedBody(dm.code));
  for (const field of ["commands", "commandHashes", "batches", "batchHashes"])
    assert.equal(body[field], undefined, field);
  const rows = sql
    .prepare("SELECT seat_id, kind, key, hash FROM campaign_room_receipts WHERE code=? ORDER BY seq")
    .all(dm.code) as { seat_id: string; kind: string; key: string; hash: string }[];
  assert.deepEqual(
    rows.map((r) => [r.seat_id, r.kind, r.key]),
    [
      [aria.seatId, "command", `${aria.seatId}:hello`],
      [aria.seatId, "batch", `${aria.seatId}:batch-hello`],
    ],
  );
  assert.ok(rows.every((r) => r.hash.startsWith("v2:")));
});

test("a campaign full of older body receipts saves again, can end its session and stays idempotent", async () => {
  const { dm, aria } = await room();
  // An action committed by an older server: its receipt lives in the body.
  const gift = { id: "old-gift", kind: "give" as const, fromId: "party", toId: "aria", copper: 100, holdingId: null, quantity: 0 };
  // The stored form (assembled if this room is sectioned), written back below as one inline row,
  // exactly as an older server stored it.
  const stored = (await readStoredRoom(database()!, dm.code))!.room;
  const hash = "a".repeat(64);
  stored.commands = [];
  stored.commandHashes = {};
  stored.batches = [];
  stored.batchHashes = {};
  // Thousands of earlier actions: enough receipts alone to exceed the room budget.
  const count = Math.ceil(ROOM_BODY_LIMIT / 300);
  for (let i = 0; i < count; i++) {
    stored.commands.push(`${aria.seatId}:old-${i}`);
    stored.commandHashes[`${aria.seatId}:old-${i}`] = hash;
    stored.batches.push(`${aria.seatId}:old-batch-${i}`);
    stored.batchHashes[`${aria.seatId}:old-batch-${i}`] = hash;
  }
  // The earlier gift really happened: its coins and its receipt (unversioned, as old servers wrote).
  stored.table.purses = stored.table.purses.map((p: { id: string; coins: unknown }) =>
    p.id === "party" ? { ...p, coins: coins(499) } : p.id === "aria" ? { ...p, coins: coins(11) } : p,
  );
  stored.commands.push(`${dm.seatId}:old-gift`);
  stored.batches.push(`${dm.seatId}:batch-old-gift`);
  sql.prepare("UPDATE campaign_rooms SET body=? WHERE code=?").run(JSON.stringify(stored), dm.code);
  assert.ok(Buffer.byteLength(storedBody(dm.code)) > ROOM_BODY_LIMIT, "the fixture starts over the room budget");

  await say(aria, "still-here");
  assert.ok(Buffer.byteLength(storedBody(dm.code)) < 50_000, "the next write moved the receipts out");
  assert.equal(receiptRows(dm.code), 2 * count + 2 + 2);
  // The DM can end the session (this used to be refused as "too large") and resume.
  await closeRoom({ ...dm, keepOnline: true });
  // The DM resumes play by starting the next session.
  await submitCommands({ ...dm, batchId: "next-session", commands: [{ id: "next-session", kind: "session", name: "Session 2", end: false }] });
  await say(aria, "after-resume");
  // Replaying the earlier gift, from before the move, still applies nothing.
  await submitCommands({ ...dm, batchId: "batch-old-gift", commands: [gift] });
  await submitCommands({ ...dm, batchId: "a-new-batch-same-action", commands: [gift] });
  const purses = (await roomState(dm)).table.purses;
  assert.equal(toCopper(purses.find((p) => p.id === "aria")!.coins), 1100);
  assert.equal(toCopper(purses.find((p) => p.id === "party")!.coins), 49900);
});

test("a write that loses the revision race leaves no receipts", async () => {
  const { dm, aria } = await room();
  const current = (await readRoom(dm.code))!;
  const before = receiptRows(dm.code);
  await assert.rejects(
    updateRoom({ ...current, revision: current.revision + 1 }, current.revision - 1, {
      receipts: [{ kind: "command", key: `${aria.seatId}:lost`, hash: "v2:x" }],
    }),
    /table changed/,
  );
  assert.equal(receiptRows(dm.code), before);
  // The same receipts commit with a write that wins.
  await updateRoom({ ...current, revision: current.revision + 1 }, current.revision, {
    receipts: [{ kind: "command", key: `${aria.seatId}:won`, hash: "v2:y" }],
  });
  assert.equal(receiptRows(dm.code), before + 1);
});

test("each view acknowledges only the seat's latest actions, newest first", async () => {
  const { dm, aria } = await room();
  const total = ACKNOWLEDGED_LIMIT + 20;
  sql.exec("BEGIN");
  const insert = sql.prepare(
    "INSERT INTO campaign_room_receipts (code, seat_id, kind, key, hash, created_at) VALUES (?,?,?,?,?,?)",
  );
  for (let i = 0; i < total; i++) insert.run(dm.code, aria.seatId, "command", `${aria.seatId}:m-${i}`, "v2:x", i);
  insert.run(dm.code, dm.seatId, "command", `${dm.seatId}:dm-only`, "v2:x", total);
  sql.exec("COMMIT");
  const view = await roomState({ code: dm.code, token: aria.token });
  assert.equal(view.acknowledged.length, ACKNOWLEDGED_LIMIT);
  assert.equal(view.acknowledged[0], `m-${total - 1}`);
  assert.ok(!view.acknowledged.includes("dm-only"), "never another seat's actions");
  // A just-sent action is acknowledged in its own response.
  const sent = await say(aria, "fresh");
  assert.equal(sent.acknowledged[0], "fresh");
});

test("deleting a room deletes its receipts", async () => {
  const { dm, aria } = await room();
  await say(aria, "bye");
  assert.ok(receiptRows(dm.code) > 0);
  const current = (await readRoom(dm.code))!;
  await deleteRoom(dm.code, current.revision);
  assert.equal(receiptRows(dm.code), 0);
});
