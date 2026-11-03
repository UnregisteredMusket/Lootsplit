// DM coin postings and direct coin edits in shared rooms (audit 2026-10-21, finding 3): one
// authoritative command each, applied once per command ID, DM-only on the server, a stale coin
// edit refused, and the same coins and ledger line as the device's receipt-guarded writes.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { applyCloudTable, economySnapshot, postCopper, setCoins } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import type { Purse } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql", "0029_campaign_room_report_parts.sql", "0030_campaign_room_archive_keys.sql", "0003_accounts.sql", "0008_encounters.sql"])
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

const coins = (c: Partial<Purse["coins"]>) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ pp: 1, gp: 12, sp: 3, cp: 7 }) },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 5, cp: 4 }) },
    ],
    journal: readJournal({}),
  };
}
async function room() {
  const dm = await openRoom({ name: "Coins DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  await choosePace({ ...dm, live: true });
  return { dm, aria };
}
const purse = (t: CloudTable, id: string) => t.purses.find((p) => p.id === id)!;
const line = (t: CloudTable, id: string) => {
  const l = t.ledger.find((x) => x.id === id);
  return l ? { ...l, at: 0 } : null;
};

test("shared DM posting and coin edit: a retried command ID (lost response) applies once", async () => {
  const { dm } = await room();
  const post = { id: "post-1", kind: "post" as const, purseId: "hoard", copper: -250, summary: "Paid the ferryman" };
  await submitCommands({ ...dm, batchId: "post-first", commands: [post] });
  await submitCommands({ ...dm, batchId: "post-retry", commands: [post] });
  let t = (await roomState(dm)).table;
  assert.equal(t.ledger.filter((l) => l.id === "post-1").length, 1);
  assert.deepEqual(line(t, "post-1"), { id: "post-1", at: 0, purseId: "hoard", shopId: null, summary: "Paid the ferryman", copper: -250, transactionType: "payment" });
  const before = purse(t, "aria").coins;
  const edit = { id: "edit-1", kind: "set-coins" as const, purseId: "aria", before, coins: coins({ gp: 9 }) };
  await submitCommands({ ...dm, batchId: "edit-first", commands: [edit] });
  await submitCommands({ ...dm, batchId: "edit-retry", commands: [edit] });
  t = (await roomState(dm)).table;
  assert.deepEqual(purse(t, "aria").coins, coins({ gp: 9 }));
  assert.equal(t.ledger.filter((l) => l.id === "edit-1").length, 1);
  assert.equal(line(t, "edit-1")!.copper, 900 - 504);
  assert.equal(line(t, "edit-1")!.summary, "Adjusted coin in Aria Thorne");
  // A second press after the purse changed (a new ID, the old coins) is refused, not applied again.
  await assert.rejects(
    submitCommands({ ...dm, batchId: "edit-again", commands: [{ ...edit, id: "edit-2" }] }),
    /These coins changed/,
  );
  assert.deepEqual(purse((await roomState(dm)).table, "aria").coins, coins({ gp: 9 }));
});

test("shared DM posting and coin edit: the server refuses players, overdrafts and invalid input", async () => {
  const { dm, aria } = await room();
  const host = (await roomState(dm)).table;
  await assert.rejects(
    submitCommands({ code: dm.code, token: aria.token, batchId: "p1", commands: [{ id: "p1", kind: "post", purseId: "aria", copper: 1000, summary: "Gift to me" }] }),
    /Only the DM/,
  );
  await assert.rejects(
    submitCommands({ code: dm.code, token: aria.token, batchId: "p2", commands: [{ id: "p2", kind: "set-coins", purseId: "aria", before: purse(host, "aria").coins, coins: coins({ pp: 99 }) }] }),
    /Only the DM/,
  );
  await assert.rejects(
    submitCommands({ ...dm, batchId: "p3", commands: [{ id: "p3", kind: "post", purseId: "aria", copper: -100000, summary: "Too much" }] }),
    /Insufficient funds/,
  );
  await assert.rejects(
    submitCommands({ ...dm, batchId: "p4", commands: [{ id: "p4", kind: "post", purseId: "aria", copper: 5, summary: "  " }] }),
  );
  const after = (await roomState(dm)).table;
  assert.deepEqual(after.purses, host.purses);
  assert.deepEqual(after.ledger, host.ledger);
});

test("differential: the device's receipt-guarded writes match the shared commands", async () => {
  const { dm } = await room();
  setSeat(DM_SEAT);
  await applyCloudTable((await roomState(dm)).table);
  const cases: Array<[string, () => Promise<void>, Record<string, unknown>]> = [
    ["d-pay", () => postCopper("hoard", -1234, "Bridge toll", { commandId: "d-pay" }), { kind: "post", purseId: "hoard", copper: -1234, summary: "Bridge toll" }],
    ["d-gain", () => postCopper("aria", 2057, "Reward", { commandId: "d-gain" }), { kind: "post", purseId: "aria", copper: 2057, summary: "Reward" }],
    ["d-set", () => setCoins("hoard", coins({ gp: 3, ep: 2, cp: 11 }), undefined, { commandId: "d-set" }), { kind: "set-coins", purseId: "hoard", coins: coins({ gp: 3, ep: 2, cp: 11 }) }],
  ];
  for (const [id, device, shared] of cases) {
    const host = (await roomState(dm)).table;
    const command = { id, ...shared, ...(shared.kind === "set-coins" ? { before: purse(host, "hoard").coins } : {}) } as never;
    await submitCommands({ ...dm, batchId: id, commands: [command] });
    await device();
    const roomTable = (await roomState(dm)).table;
    const deviceTable = await economySnapshot();
    for (const p of ["hoard", "aria"]) assert.deepEqual(purse(deviceTable, p).coins, purse(roomTable, p).coins, `${id}: ${p}`);
    assert.deepEqual(line(deviceTable, id), line(roomTable, id), id);
  }
});
