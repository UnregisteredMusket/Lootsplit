// Make change (loot phase 4): the coin-exchange command in shared rooms and on the device:
// idempotent retries, server-side permissions, shared/offline parity and the player projection.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { toCopper, exchangeCoins, exchangeSummary, type CoinUnit } from "./money.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import type { Purse } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of [
  "0001_campaign_rooms.sql",
  "0024_campaign_room_receipts.sql",
  "0026_campaign_room_sections.sql",
  "0029_campaign_room_report_parts.sql",
  "0030_campaign_room_archive_keys.sql",
  "0003_accounts.sql",
  "0008_encounters.sql",
])
  sql.exec(
    readFileSync(new URL(`../../../cloudflare/migrations/${file}`, import.meta.url), "utf8"),
  );
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
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ gp: 40 }) },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 25, cp: 7 }) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 12, sp: 4 }) },
    ],
    journal: readJournal({}),
  };
}
const exchange = (
  id: string,
  purseId: string,
  before: Purse["coins"],
  from: CoinUnit,
  count: number,
  to: CoinUnit,
) => {
  const result = exchangeCoins(before, from, count, to);
  assert.ok(result, `${count} ${from} -> ${to}`);
  return { id, kind: "coin-exchange" as const, purseId, before, after: result.after };
};

test("money helpers: break down, consolidate with leftovers, electrum, and refusals", () => {
  const purse = coins({ pp: 1, gp: 3, ep: 1, sp: 17, cp: 4 });
  assert.deepEqual(
    exchangeCoins(purse, "gp", 2, "sp")?.after,
    coins({ pp: 1, gp: 1, ep: 1, sp: 37, cp: 4 }),
  );
  // 17 sp into gold: 1 gp, 7 sp stay; the worth is unchanged.
  const up = exchangeCoins(purse, "sp", 17, "gp");
  assert.deepEqual([up?.used, up?.got], [10, 1]);
  assert.equal(toCopper(up!.after), toCopper(purse));
  // 7 sp into electrum: 1 ep (5 sp), 2 sp stay.
  assert.deepEqual(
    [exchangeCoins(purse, "sp", 7, "ep")?.used, exchangeCoins(purse, "sp", 7, "ep")?.got],
    [5, 1],
  );
  assert.deepEqual(exchangeCoins(purse, "pp", 1, "ep")?.got, 20);
  assert.equal(exchangeCoins(purse, "cp", 4, "sp"), null, "4 cp is not a whole silver");
  assert.equal(exchangeCoins(purse, "gp", 4, "sp"), null, "only 3 gp in the purse");
  assert.equal(exchangeCoins(purse, "gp", 1, "gp"), null);
  assert.equal(exchangeCoins(purse, "gp", 0, "sp"), null);
  assert.equal(exchangeSummary(purse, up!.after), "10 sp → 1 gp");
});

test("the engine: owner and DM may exchange; value, staleness, no-ops and others' purses are refused", () => {
  const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
  const aria: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
  const t = campaign();
  const ok = exchange("x1", "aria", t.purses[1].coins, "gp", 5, "sp");
  const after = applyCommand(t, aria, ok);
  assert.deepEqual(after.purses[1].coins, coins({ gp: 20, sp: 50, cp: 7 }));
  const event = after.journal!.events.at(-1)!;
  assert.equal(event.summary, "Aria Thorne made change: 5 gp → 50 sp");
  assert.equal(event.purseId, "aria");
  assert.equal(after.ledger.length, t.ledger.length, "no ledger line: the worth did not change");
  assert.deepEqual(
    applyCommand(t, dm, { ...ok, id: "x2" }).purses[1].coins,
    after.purses[1].coins,
    "the DM may make change too",
  );
  assert.throws(
    () => applyCommand(t, aria, exchange("x3", "bram", t.purses[2].coins, "gp", 1, "sp")),
    /permission/,
  );
  assert.throws(
    () => applyCommand(t, aria, { ...ok, id: "x4", after: coins({ gp: 21, sp: 50, cp: 7 }) }),
    /worth/,
  );
  assert.throws(
    () => applyCommand(after, aria, { ...ok, id: "x5" }),
    /changed/,
    "a stale before is refused",
  );
  assert.throws(
    () => applyCommand(t, aria, { ...ok, id: "x6", after: t.purses[1].coins }),
    /Choose coins/,
  );
  assert.throws(() =>
    applyCommand(t, aria, { ...ok, id: "x7", after: { ...ok.after, gp: -1, sp: 150 } }),
  );
});

test("shared rooms: retries apply once, the server refuses others' purses, and other players never see it", async () => {
  const dm = await openRoom({ name: "Change DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" });
  const AT = { code: dm.code, token: aria.token };
  const BT = { code: dm.code, token: bram.token };
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const DT = { code: dm.code, token: dm.token };
  const state = async () => (await roomState(DT)).table;
  const start = (await state()).purses.find((p) => p.id === "aria")!.coins;
  const cmd = exchange("room-1", "aria", start, "gp", 3, "sp");
  await submitCommands({ ...AT, batchId: "room-1", commands: [cmd] });
  let table = await state();
  assert.deepEqual(
    table.purses.find((p) => p.id === "aria")!.coins,
    coins({ gp: 22, sp: 30, cp: 7 }),
  );
  const events = table.journal!.events.filter((e) => e.summary.includes("made change")).length;
  await submitCommands({ ...AT, batchId: "room-1", commands: [cmd] });
  table = await state();
  assert.deepEqual(
    table.purses.find((p) => p.id === "aria")!.coins,
    coins({ gp: 22, sp: 30, cp: 7 }),
    "a retry changes nothing",
  );
  assert.equal(
    table.journal!.events.filter((e) => e.summary.includes("made change")).length,
    events,
  );
  const other = exchange(
    "room-2",
    "aria",
    table.purses.find((p) => p.id === "aria")!.coins,
    "gp",
    1,
    "sp",
  );
  await assert.rejects(submitCommands({ ...BT, batchId: "room-2", commands: [other] }));
  const bramView = (await roomState(BT)).table;
  assert.equal(
    bramView.journal!.events.some((e) => e.summary.includes("made change")),
    false,
    "Bram doesn't see Aria's purse activity",
  );
  const ariaView = (await roomState(AT)).table;
  assert.ok(
    ariaView.journal!.events.some((e) => e.summary === "Aria Thorne made change: 3 gp → 30 sp"),
  );
});

test("offline: the same command gives the same purse and activity, and a retry applies once", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const cmd = exchange("device-1", "hoard", coins({ gp: 40 }), "gp", 40, "pp");
  await executeLocalCommand(cmd);
  const once = await economySnapshot();
  await executeLocalCommand(cmd);
  const twice = await economySnapshot();
  assert.deepEqual(twice.purses, once.purses);
  assert.deepEqual(once.purses.find((p) => p.id === "hoard")!.coins, coins({ gp: 0, pp: 4 }));
  const shared = applyCommand(
    campaign(),
    { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] },
    cmd,
  );
  const byId = (rows: Purse[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(once.purses), byId(shared.purses));
  assert.deepEqual(
    once.journal!.events.map((e) => e.summary),
    shared.journal!.events.map((e) => e.summary),
  );
  const stale = await executeLocalCommand({ ...cmd, id: "device-2" }).catch(
    (e: Error) => e.message,
  );
  assert.match(String(stale), /changed/);
});
