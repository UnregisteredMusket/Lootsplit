// Charges and consumables (loot phase 5): the item-use and item-recharge commands in shared rooms
// and on the device: the rules, idempotent retries, server-side permissions, shared/offline
// parity, old-data readback and the player projection.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { lootFingerprint } from "./loot-claims.ts";
import { validateEconomyRows } from "./validation.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { usesLabel, type HoldingUses } from "./item-uses.ts";
import type { Holding } from "./types.ts";

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

const coins = () => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
const item = (id: string, purseId: string, name: string, quantity: number, uses?: HoldingUses, extra: Partial<Holding> = {}): Holding => ({
  id,
  purseId,
  name,
  kind: "item",
  quantity,
  unitCopper: 5000,
  notes: "",
  ...(uses ? { uses } : {}),
  ...extra,
});
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins() },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins() },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins() },
    ],
    holdings: [
      item("wand", "aria", "Wand of magic missiles", 1, { current: 3, max: 7, whenEmpty: "keep" }),
      item("potions", "aria", "Potion of healing", 3, { current: 1, max: 1, whenEmpty: "remove" }),
      item("scroll", "aria", "Spell scroll", 1,{ current: 1, max: 1, whenEmpty: "remove" }),
      item("kit", "bram", "Healer's kit", 1, { current: 10, max: 10, whenEmpty: "keep" }),
      item("staff", "hoard", "Staff of fire", 1, { current: 2, max: 10, whenEmpty: "keep" }, { pool: { at: 1, source: "add-loot" } }),
      item("rope", "aria", "Rope", 1),
    ],
    journal: readJournal({}),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const find = (t: CloudTable, id: string) => t.holdings.find((h) => h.id === id);
const use = (t: CloudTable, id: string, holdingId: string): Command => {
  const h = find(t, holdingId)!;
  return { id, kind: "item-use", holdingId, expect: { current: h.uses?.current ?? 0, quantity: h.quantity } };
};
const recharge = (t: CloudTable, id: string, holdingId: string, current: number): Command => {
  const h = find(t, holdingId)!;
  return { id, kind: "item-recharge", holdingId, current, expect: { current: h.uses!.current, quantity: h.quantity } };
};
const lastEvent = (t: CloudTable) => t.journal!.events.at(-1)!;

test("use: one charge per command, one event keyed by the command ID and no ledger line", () => {
  const t = campaign();
  const after = applyCommand(t, ariaSeat, use(t, "u1", "wand"));
  assert.deepEqual(find(after, "wand")!.uses, { current: 2, max: 7, whenEmpty: "keep" });
  const event = lastEvent(after);
  assert.equal(event.id, "u1-event-0");
  assert.equal(event.purseId, "aria");
  assert.equal(event.summary, "Used Wand of magic missiles (Aria Thorne): 2 of 7 uses left");
  assert.deepEqual(event.change, {
    entity: "holding",
    entityId: "wand",
    before: { current: 3, max: 7, quantity: 1 },
    after: { current: 2, max: 7, quantity: 1 },
  });
  assert.equal(after.ledger.length, 0, "no money moves");
  assert.equal(after.journal!.events.length, 1);
});

test("the last use: keep stays at 0 until recharged; remove drops one of a stack or the item", () => {
  let t = campaign();
  for (const [i] of [1, 2, 3].entries()) t = applyCommand(t, ariaSeat, use(t, `k${i}`, "wand"));
  assert.equal(find(t, "wand")!.uses!.current, 0);
  assert.match(lastEvent(t).summary, /last use of Wand of magic missiles .*kept until recharged/);
  assert.throws(() => applyCommand(t, ariaSeat, use(t, "k4", "wand")), /no uses left/);
  assert.equal(usesLabel(find(t, "wand")!.uses!), "0/7 uses · used up");

  t = applyCommand(t, ariaSeat, use(t, "p1", "potions"));
  assert.equal(find(t, "potions")!.quantity, 2);
  assert.deepEqual(find(t, "potions")!.uses, { current: 1, max: 1, whenEmpty: "remove" }, "the next starts full");
  assert.equal(lastEvent(t).summary, "Used up one Potion of healing (Aria Thorne): removed; 2 left, the next at 1 of 1 uses");
  assert.equal(lastEvent(t).change?.after?.removed, 1);

  t = applyCommand(t, ariaSeat, use(t, "s1", "scroll"));
  assert.equal(find(t, "scroll"), undefined, "a single consumable is removed");
  assert.equal(lastEvent(t).summary, "Used up Spell scroll (Aria Thorne): removed from the inventory");
  assert.equal(lastEvent(t).change?.after, null);
});

test("who may use and recharge; stale, untracked and stored items are refused", () => {
  const t = campaign();
  assert.throws(() => applyCommand(t, ariaSeat, use(t, "x1", "kit")), /permission/, "another player's item");
  assert.throws(() => applyCommand(t, ariaSeat, use(t, "x2", "staff")), /Only the DM/, "pooled: DM only");
  assert.equal(find(applyCommand(t, dmSeat, use(t, "x3", "staff")), "staff")!.uses!.current, 1);
  assert.equal(find(applyCommand(t, dmSeat, use(t, "x4", "kit")), "kit")!.uses!.current, 9, "the DM on any item");
  assert.throws(() => applyCommand(t, ariaSeat, use(t, "x5", "rope")), /doesn't track uses/);
  assert.throws(
    () => applyCommand(t, ariaSeat, { ...use(t, "x6", "wand"), expect: { current: 4, quantity: 1 } } as Command),
    /changed/,
    "a stale count is refused",
  );
  const stored = campaign();
  find(stored, "wand")!.reservedFor = "project-1";
  assert.throws(() => applyCommand(stored, ariaSeat, use(stored, "x7", "wand")), /Retrieve this item/);

  assert.throws(() => applyCommand(t, ariaSeat, recharge(t, "r1", "wand", 7)), /Only the DM/);
  const full = applyCommand(t, dmSeat, recharge(t, "r2", "wand", 7));
  assert.equal(find(full, "wand")!.uses!.current, 7);
  assert.equal(lastEvent(full).summary, "Recharged Wand of magic missiles (Aria Thorne): 3 → 7 of 7 uses");
  assert.equal(find(applyCommand(t, dmSeat, recharge(t, "r3", "wand", 0)), "wand")!.uses!.current, 0, "down to 0");
  assert.throws(() => applyCommand(t, dmSeat, recharge(t, "r4", "wand", 8)), /0 to 7/);
  assert.throws(() => applyCommand(t, dmSeat, recharge(t, "r5", "wand", 3)), /already has 3/);
  assert.throws(() => applyCommand(t, dmSeat, recharge(t, "r6", "wand", 1001)), "the schema caps uses at 1000");
});

test("Give and the treasure pool: a moved part of a stack starts full; a whole stack keeps its count", () => {
  const t = campaign();
  find(t, "wand")!.quantity = 2;
  const part = applyCommand(t, ariaSeat, { id: "g1", kind: "give", fromId: "aria", toId: "bram", copper: 0, holdingId: "wand", quantity: 1 });
  assert.equal(find(part, "wand")!.uses!.current, 3, "the current item stays with the giver");
  assert.equal(find(part, "g1-item")!.uses!.current, 7);
  const whole = applyCommand(t, ariaSeat, { id: "g2", kind: "give", fromId: "aria", toId: "bram", copper: 0, holdingId: "wand", quantity: 2 });
  assert.equal(find(whole, "g2-item")!.uses!.current, 3);
  assert.equal(find(whole, "wand"), undefined);

  // A pooled stack of 3 (current item at 2 of 10) shared out by the DM: the first award takes the
  // current item when the whole lot leaves; every other item starts full.
  const pool = campaign();
  find(pool, "staff")!.quantity = 3;
  const lots = [{ holdingId: "staff", quantity: 3, awards: [{ purseId: "aria", quantity: 1 }, { purseId: "bram", quantity: 2 }] }];
  const resolved = applyCommand(pool, dmSeat, {
    id: "res",
    kind: "loot-resolve",
    method: "manual",
    lots,
    expect: lootFingerprint(pool, lots, "manual"),
  });
  assert.equal(find(resolved, "res-0-0")!.uses!.current, 2);
  assert.equal(find(resolved, "res-0-1")!.uses!.current, 10);
  const oneLot = [{ holdingId: "staff", quantity: 1, awards: [{ purseId: "aria", quantity: 1 }] }];
  const some = applyCommand(pool, dmSeat, {
    id: "res2",
    kind: "loot-resolve",
    method: "manual",
    lots: oneLot,
    expect: lootFingerprint(pool, oneLot, "manual"),
  });
  assert.equal(find(some, "staff")!.uses!.current, 2, "the current item stays in the pool");
  assert.equal(find(some, "res2-0-0")!.uses!.current, 10);
});

test("validation: whole numbers to 1000, uses left no more than max, items only; old holdings still load", () => {
  const rows = (holdings: Holding[]) => ({ ...campaign(), holdings });
  validateEconomyRows(campaign());
  validateEconomyRows(rows([item("old", "aria", "Old potion", 2)]));
  assert.throws(() => validateEconomyRows(rows([item("a", "aria", "A", 1, { current: 2, max: 1, whenEmpty: "keep" })])));
  assert.throws(() => validateEconomyRows(rows([item("b", "aria", "B", 1, { current: 1, max: 1001, whenEmpty: "keep" })])));
  assert.throws(() => validateEconomyRows(rows([item("c", "aria", "C", 1, { current: 1.5, max: 3, whenEmpty: "keep" })])));
  assert.throws(() => validateEconomyRows(rows([item("d", "aria", "D", 1, { current: 1, max: 3, whenEmpty: "keep" }, { kind: "property" })])), /Only items/);
});

test("shared rooms: a retry applies once, the server refuses other seats, and players see only their own", async () => {
  const dm = await openRoom({ name: "Uses DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" });
  const AT = { code: dm.code, token: aria.token };
  const BT = { code: dm.code, token: bram.token };
  const DT = { code: dm.code, token: dm.token };
  await choosePace({ ...DT, live: true });
  const state = async () => (await roomState(DT)).table;
  const cmd = use(await state(), "room-1", "wand");
  await submitCommands({ ...AT, batchId: "room-1", commands: [cmd] });
  await submitCommands({ ...AT, batchId: "room-1", commands: [cmd] });
  let table = await state();
  assert.equal(find(table, "wand")!.uses!.current, 2, "a retry changes nothing");
  assert.equal(table.journal!.events.filter((e) => e.id.startsWith("room-1")).length, 1);

  await assert.rejects(submitCommands({ ...BT, batchId: "room-2", commands: [use(table, "room-2", "wand")] }));
  await assert.rejects(submitCommands({ ...AT, batchId: "room-3", commands: [recharge(table, "room-3", "wand", 7)] }));
  await submitCommands({ ...DT, batchId: "room-4", commands: [recharge(table, "room-4", "wand", 7)] });
  table = await state();
  assert.equal(find(table, "wand")!.uses!.current, 7);
  assert.ok(table.journal!.events.find((e) => e.id.startsWith("room-4"))?.change, "the DM sees the recorded change");

  const bramView = (await roomState(BT)).table;
  assert.equal(find(bramView, "wand"), undefined, "Bram doesn't see Aria's items");
  assert.equal(bramView.journal!.events.some((e) => e.summary.includes("Wand")), false);
  assert.deepEqual(find(bramView, "kit")!.uses, { current: 10, max: 10, whenEmpty: "keep" });
  const ariaView = (await roomState(AT)).table;
  assert.deepEqual(find(ariaView, "wand")!.uses, { current: 7, max: 7, whenEmpty: "keep" });
  const ariaEvents = ariaView.journal!.events.filter((e) => e.summary.includes("Wand"));
  assert.equal(ariaEvents.length, 2);
  assert.ok(ariaEvents.every((e) => !("change" in e)), "players never get the DM's recorded change");
});

test("offline: the same commands give the same inventory and activity, and a retry applies once", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  let shared = campaign();
  const steps = [use(shared, "d1", "potions")];
  shared = applyCommand(shared, dmSeat, steps[0]!);
  steps.push(use(shared, "d2", "wand"));
  shared = applyCommand(shared, dmSeat, steps[1]!);
  steps.push(recharge(shared, "d3", "wand", 5));
  shared = applyCommand(shared, dmSeat, steps[2]!);
  for (const step of steps) await executeLocalCommand(step);
  const once = await economySnapshot();
  for (const step of steps) await executeLocalCommand(step);
  const twice = await economySnapshot();
  const byId = (rows: Holding[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(twice.holdings), byId(once.holdings), "retries change nothing");
  assert.deepEqual(byId(once.holdings), byId(shared.holdings));
  const summaries = (t: { journal?: CloudTable["journal"] }) =>
    (t.journal?.events ?? []).filter((e) => /^(Used|Recharged)/.test(e.summary)).map((e) => [e.id, e.summary]);
  assert.deepEqual(summaries(once), summaries(shared));
  assert.equal(summaries(twice).length, 3);
  const stale = await executeLocalCommand({ ...steps[1]!, id: "d4" }).catch((e: Error) => e.message);
  assert.match(String(stale), /changed/);

  setSeat({ role: "player", purseIds: ["aria"], shopIds: [], openedAt: 0 });
  const link = await executeLocalCommand(use(shared, "d5", "wand")).catch((e: Error) => e.message);
  assert.match(String(link), /DM's device or in a shared room/);
  setSeat(DM_SEAT);
});
