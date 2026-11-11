// Audit A2: shared-room receipts were keyed by seat and command ID. A give with command ID X,
// then the session ends (the live ledger is archived and cleared), the player leaves and rejoins
// (a new seat ID) and resubmits X: it applied again. Receipts now dedupe by campaign and command
// ID, and a loan or payment request whose ID already exists is refused (a second seat could push
// a duplicate row that stayed pending for good).
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace, manageRoom } from "./cloud.server.ts";
import { applyCommand } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { readFinance } from "./finance.ts";
import { fromCopper, toCopper } from "./money.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of [
  "0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql",
  "0003_accounts.sql", "0007_character_play.sql", "0008_encounters.sql", "0012_campaign_room_images.sql",
  "0013_campaign_resource_documents.sql", "0019_campaign_room_reports.sql", "0029_campaign_room_report_parts.sql",
  "0030_campaign_room_archive_keys.sql", "0033_campaign_room_receipt_ids.sql",
])
  sql.exec(readFileSync(new URL(`../../../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
(globalThis as any).__env__ = {
  DB: {
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      let values: any[] = [];
      return {
        bind(...args: any[]) {
          values = args;
          return this;
        },
        async all() {
          if (query.includes("FROM play_characters")) return { results: [] };
          return { results: sql.prepare(query).all(...values) };
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
        },
      };
    },
  },
};


function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "aria", name: "Aria Thorne", kind: "character", coins: fromCopper(5_000) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: fromCopper(5_000) },
    ],
    journal: readJournal({ finance: readFinance() }),
  };
}
const wallet = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);

test("a give resubmitted after the session ended and the player rejoined applies once", async () => {
  const dm = await openRoom({ name: "Receipts DM", table: campaign() });
  const first = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  await choosePace({ ...dm, live: true });
  await submitCommands({ ...dm, batchId: "start", commands: [{ id: "start-1", kind: "session", name: "Night one", end: false }] });
  const give = { id: "give-x", kind: "give" as const, fromId: "aria", toId: "bram", copper: 1_000, holdingId: null, quantity: 0 };
  await submitCommands({ code: dm.code, token: first.token, batchId: "b1", commands: [give] });
  const given = (await roomState(dm)).table;
  assert.equal(wallet(given, "bram"), 6_000);
  await submitCommands({ ...dm, batchId: "end", commands: [{ id: "end-1", kind: "session", name: "Night one", end: true }] });
  assert.equal((await roomState(dm)).table.ledger.length, 0, "the ended session's ledger is archived");
  await manageRoom({ code: dm.code, token: first.token, action: "leave", seatId: first.seatId });
  const again = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  assert.notEqual(again.seatId, first.seatId);
  // The same batch and a new batch with the old action: neither applies it again.
  await submitCommands({ code: dm.code, token: again.token, batchId: "b1", commands: [give] });
  await submitCommands({ code: dm.code, token: again.token, batchId: "b2", commands: [give] });
  const after = (await roomState(dm)).table;
  assert.equal(wallet(after, "bram"), 6_000);
  assert.equal(wallet(after, "aria"), 4_000);
  // A different action under a used ID is refused, not applied.
  await assert.rejects(
    submitCommands({ code: dm.code, token: again.token, batchId: "b3", commands: [{ ...give, copper: 5 }] }),
    /conflicting changes/,
  );
  // New actions from the new seat still apply.
  await submitCommands({ code: dm.code, token: again.token, batchId: "b4", commands: [{ ...give, id: "give-y", copper: 10 }] });
  assert.equal(wallet((await roomState(dm)).table, "bram"), 6_010);
});

test("a loan or payment request whose ID already exists is refused; one row stays", async () => {
  const dm = await openRoom({ name: "Requests DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" });
  await choosePace({ ...dm, live: true });
  const loan = { id: "loan-1", kind: "loan" as const, purseId: "aria", copper: 500, note: "Rope" };
  const request = { id: "req-1", kind: "payment-request" as const, purseId: "aria", copper: 200, note: "Inn" };
  await submitCommands({ code: dm.code, token: aria.token, batchId: "a1", commands: [loan, request] });
  await assert.rejects(submitCommands({ code: dm.code, token: bram.token, batchId: "x1", commands: [{ ...loan, purseId: "bram" }] }));
  await assert.rejects(submitCommands({ code: dm.code, token: bram.token, batchId: "x2", commands: [{ ...request, purseId: "bram" }] }));
  const t = (await roomState(dm)).table;
  assert.equal(t.loans.filter((l) => l.id === "loan-1").length, 1);
  assert.equal(t.journal!.requests.filter((r: { id: string }) => r.id === "req-1").length, 1);
  // The engine refuses too (the device runs the same command), whatever the receipts say.
  const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
  assert.throws(() => applyCommand(t, dmSeat, { ...loan, purseId: "bram" }), /already identifies/);
  assert.throws(() => applyCommand(t, dmSeat, { ...request, purseId: "bram" }), /already identifies/);
});

// Review of PR 488: a receipt under another seat counts only for exactly the same action, so a
// seat that commits something else under an ID it predicted cannot block the other seat's action.
test("another seat's different action under the same ID never blocks or replaces this seat's", async () => {
  const dm = await openRoom({ name: "Grief DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" });
  await choosePace({ ...dm, live: true });
  const give = (id: string, copper: number) => ({ id, kind: "give" as const, fromId: "aria", toId: "bram", copper, holdingId: null, quantity: 0 });
  await submitCommands({ code: dm.code, token: aria.token, batchId: "a0", commands: [give("pass-x-0", 10)] });
  // Bram sees X-0 and commits a harmless message under the next ID first.
  await submitCommands({ code: dm.code, token: bram.token, batchId: "b1", commands: [{ id: "pass-x-1", kind: "message", to: "party", purseId: "bram", text: "Mine now" }] });
  await submitCommands({ code: dm.code, token: aria.token, batchId: "a1", commands: [give("pass-x-1", 20)] });
  const t = (await roomState(dm)).table;
  assert.equal(wallet(t, "bram"), 5_030, "Aria's second action applied");
  assert.equal(t.notes.filter((n) => n.id === "pass-x-1").length, 1, "Bram's message stays");
  // Aria's retry of her action is still a no-op under her own receipt.
  await submitCommands({ code: dm.code, token: aria.token, batchId: "a1-retry", commands: [give("pass-x-1", 20)] });
  assert.equal(wallet((await roomState(dm)).table, "bram"), 5_030);
});

// Privacy review of PR 488: adopting another seat's receipt skipped authorization, so a seat could
// confirm a guessed copy of another seat's action (an exact copy succeeded, a wrong one was
// refused). Only a departed seat that held one of the same characters (a leave and rejoin) counts.
test("a present seat's exact copy of another seat's action is refused like any other, and moves nothing", async () => {
  const dm = await openRoom({ name: "Oracle DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" });
  await choosePace({ ...dm, live: true });
  const give = { id: "give-o", kind: "give" as const, fromId: "aria", toId: "bram", copper: 1_234, holdingId: null, quantity: 0 };
  await submitCommands({ code: dm.code, token: aria.token, batchId: "a1", commands: [give] });
  const before = (await roomState(dm)).table;
  const wrong = await submitCommands({ code: dm.code, token: bram.token, batchId: "g1", commands: [{ ...give, copper: 1_000 }] }).then(() => "accepted", (e: Error) => e.message);
  const exact = await submitCommands({ code: dm.code, token: bram.token, batchId: "g2", commands: [give] }).then(() => "accepted", (e: Error) => e.message);
  assert.notEqual(exact, "accepted");
  assert.equal(exact, wrong, "the same answer as a wrong guess");
  const after = await roomState({ code: dm.code, token: bram.token });
  assert.deepEqual(after.table.purses.map((p) => p.coins), before.purses.map((p) => p.coins));
  assert.equal(after.acknowledged.includes("give-o"), false, "no acknowledgement for Bram");
});
