// Merchant purses, purchase limits and the off-list buy rate (2026-11-03 comparable-tools research,
// owner queue priority 2): sales paid from a finite shop purse in the same authoritative command,
// refused whole when it is short; purchases paid into it; refills only on restock; replay,
// shared/offline parity, the player projection and old shops unchanged.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { applyCommand, type CommandInput } from "./commands.ts";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { applyBillToTable, emptyCloudTable, readCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { readFinance } from "./finance.ts";
import { fromCopper, toCopper } from "./money.ts";
import { canonicalJson } from "./canonical-json.ts";
import { planSaleSplit, type SaleSplitInput } from "./sale-split.ts";
import { projectRecord } from "./session-records.ts";
import { validateEconomyRows } from "./validation.ts";
import { applyCloudTable, buyFromShop, economySnapshot, executeLocalCommand, sellToShop } from "./economy.ts";
import { DM_SEAT, setSeat, type BillFile } from "./table.ts";
import {
  merchantSaleNotice,
  merchantUnitOffer,
  purchaseLimited,
  projectMerchantPurse,
} from "./merchant.ts";
import type { Holding, Shop } from "./types.ts";

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

const dm: CloudSeat = { id: "local", token: "", name: "Dungeon master", role: "dm", purseIds: [] };
const player: CloudSeat = { id: "p", token: "", name: "Ash", role: "player", purseIds: ["a"] };
type SharedCommand = Parameters<typeof applyCommand>[2];

const item = (id: string, purseId: string, name: string, unitCopper: number, quantity: number, category: string): Holding => ({
  id, purseId, name, kind: "item", quantity, unitCopper, notes: "", category,
});
const marlow = (extra: Partial<Shop> = {}): Shop => ({
  id: "marlow", name: "Marlow's Forge", keeper: "Marlow", place: "Port Ashby", notes: "",
  sellRate: 1, buyRate: 0.5, wealth: "modest", category: "smith", priceScale: 1,
  acceptedCategories: ["smith"],
  merchantPurse: 1230, // 12 gp, 3 sp
  merchantPurseRefill: 10_000,
  ...extra,
});
function campaign(shop: Shop = marlow()): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "a", name: "Ash", kind: "character", coins: fromCopper(5_000) },
      { id: "b", name: "Bryn", kind: "character", coins: fromCopper(500) },
      { id: "hoard", name: "The Hoard", kind: "party", coins: fromCopper(0) },
    ],
    holdings: [
      item("sword", "a", "Longsword", 2_000, 3, "smith"),
      item("potion", "a", "Potion of healing", 1_000, 2, "apothecary"),
      item("axes", "hoard", "Hand axe", 1_000, 4, "smith"),
    ],
    shops: [shop],
    stock: [
      { id: "nails", shopId: "marlow", name: "Nails", copper: 100, baseCopper: 100, rarity: "common", quantity: 10, notes: "", category: "smith" },
    ],
    ledger: [],
    journal: readJournal({ finance: readFinance() }),
  };
}
const act = (t: CloudTable, cmd: CommandInput, id: string, seat: CloudSeat = dm) =>
  applyCommand(t, seat, { ...cmd, id } as SharedCommand);
const copper = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
const sell = (quantity: number, holdingId = "sword"): CommandInput => ({ kind: "sell", holdingId, shopId: "marlow", quantity });

test("old shops without a purse, limit or off-list rate trade exactly as before", () => {
  const old: Shop = marlow();
  delete old.merchantPurse;
  delete old.merchantPurseRefill;
  const t = campaign(old);
  const after = act(t, sell(3), "old-sell");
  assert.equal(copper(after, "a"), 5_000 + 3_000);
  assert.deepEqual(after.shops, t.shops);
  const bought = act(t, { kind: "buy", stockId: "nails", purseId: "a", quantity: 2 }, "old-buy");
  assert.deepEqual(bought.shops, t.shops);
  assert.throws(() => act(t, sell(1, "potion"), "old-potion"), /does not buy that item category/);
  // Old saves still read and validate unchanged.
  assert.deepEqual(readCloudTable(structuredClone(t))?.shops, t.shops);
  validateEconomyRows(t);
});

test("a sale is paid from the purse; one the purse can't cover is refused whole with a clear message", () => {
  const t = campaign();
  assert.throws(() => act(t, sell(2), "too-much"), { message: "Marlow has only 12 gp, 3 sp to spend." });
  const once = act(t, sell(1), "one");
  assert.equal(copper(once, "a"), 6_000);
  assert.equal(once.shops[0].merchantPurse, 230);
  assert.equal(once.holdings.find((h) => h.id === "sword")!.quantity, 2);
  // Copper is conserved between the seller and the merchant purse.
  assert.equal(copper(once, "a") + once.shops[0].merchantPurse!, copper(t, "a") + t.shops[0].merchantPurse!);
  // A player sees only that Marlow can't afford it, unless the DM shows the purse.
  assert.throws(() => act(once, sell(1), "player-short", player), { message: "Marlow can't afford that." });
  const shown = structuredClone(once);
  shown.shops[0].showPurse = true;
  assert.throws(() => act(shown, sell(1), "player-shown", player), { message: "Marlow has only 2 gp, 3 sp to spend." });
});

test("buying from the shop pays into its purse", () => {
  const t = campaign();
  const after = act(t, { kind: "buy", stockId: "nails", purseId: "a", quantity: 3 }, "buy-nails");
  assert.equal(copper(after, "a"), 4_700);
  assert.equal(after.shops[0].merchantPurse, 1_530);
});

test("the DM's Restock refills the purse to the refill amount, never reduces it, in a DM-only event", () => {
  const t = campaign();
  const restocked = act(t, { kind: "restock", shopId: "marlow", quantity: 1 }, "restock-1");
  assert.equal(restocked.shops[0].merchantPurse, 10_000);
  const ev = restocked.journal!.events.find((e) => e.id === "restock-1-purse")!;
  assert.equal(ev.dmOnly, true);
  assert.match(ev.summary, /merchant purse refilled 12 gp, 3 sp → 100 gp/);
  assert.equal(projectRecord(restocked, player).journal!.events.some((e) => e.id === "restock-1-purse"), false);
  const rich = campaign(marlow({ merchantPurse: 20_000 }));
  assert.equal(act(rich, { kind: "restock", shopId: "marlow", quantity: 1 }, "restock-2").shops[0].merchantPurse, 20_000);
  // Only the DM restocks.
  assert.throws(() => act(t, { kind: "restock", shopId: "marlow", quantity: 1 }, "restock-p", player), /Only the DM/);
});

test("a scheduled restock refills the purse when downtime is approved, not on its own", () => {
  let t = campaign();
  t = act(t, { kind: "shop-schedule", shopId: "marlow", schedule: { cycleDays: 7, openDays: [0, 1, 2, 3, 4, 5, 6], restockEveryDays: 3, restockQuantity: 5, lastRestockDay: 0 } }, "sched");
  const plan = act(t, { kind: "downtime-plan", days: 2, name: "Short rest" }, "plan-2");
  const short = act(plan, { kind: "session", name: "Back", end: false, downtimeId: plan.journal!.finance!.downtime.at(-1)!.id }, "s-2");
  assert.equal(short.shops[0].merchantPurse, 1230);
  const week = act(t, { kind: "downtime-plan", days: 4, name: "Week" }, "plan-4");
  assert.equal(week.shops[0].merchantPurse, 1230);
  const downtimeId = week.journal!.finance!.downtime.at(-1)!.id;
  // A sale between preview and approval changes the purse: the preview must be recalculated.
  const moved = act(week, sell(1), "between");
  assert.throws(() => act(moved, { kind: "session", name: "Back", end: false, downtimeId }, "s-x"), /changed after this preview/);
  const applied = act(week, { kind: "session", name: "Back", end: false, downtimeId }, "s-4");
  assert.equal(applied.shops[0].merchantPurse, 10_000);
  assert.ok(applied.journal!.events.some((e) => e.dmOnly && /merchant purse refilled .* \(scheduled restock\)/.test(e.summary)));
});

test("the purchase limit caps what the shop pays for one item", () => {
  const t = campaign(marlow({ purchaseLimit: 600, merchantPurse: undefined }));
  const sword = t.holdings[0];
  assert.equal(merchantUnitOffer(sword, t.shops[0]), 600);
  assert.equal(purchaseLimited(sword, t.shops[0]), true);
  assert.equal(copper(act(t, sell(2), "limited"), "a"), 5_000 + 1_200);
});

test("off the buy list: refused unless the shop buys anything else at a penalty", () => {
  assert.throws(() => act(campaign(), sell(1, "potion"), "potion-no"), /does not buy that item category/);
  const t = campaign(marlow({ offListPercent: 40 }));
  // Potion: 1,000 cp × 50% = 500 cp, × 40% = 200 cp. Swords stay at the normal rate.
  assert.equal(merchantUnitOffer(t.holdings[1], t.shops[0]), 200);
  assert.equal(merchantUnitOffer(t.holdings[0], t.shops[0]), 1_000);
  const after = act(t, sell(2, "potion"), "potion-yes");
  assert.equal(copper(after, "a"), 5_400);
  assert.equal(after.shops[0].merchantPurse, 830);
});

const saleInput: SaleSplitInput = {
  fundId: "hoard", shopId: "marlow", lots: [{ holdingId: "axes", quantity: 4 }], recipientIds: ["a", "b"], rule: "party-fund",
};
function saleCommand(t: CloudTable, id: string) {
  const unlimited = structuredClone(t);
  delete unlimited.shops[0].merchantPurse;
  const plan = planSaleSplit(unlimited, saleInput, { actor: "dm" });
  return {
    id, kind: "sale-split" as const, fundId: "hoard", shopId: "marlow", lots: saleInput.lots,
    recipientIds: saleInput.recipientIds, remainder: { rule: "party-fund" as const },
    expect: { proceeds: plan.proceeds, share: plan.split.share, remainderTo: plan.split.remainderTo },
  };
}

test("sell and split against a short purse refuses the whole action: nothing sold, nothing split", () => {
  const t = campaign();
  assert.throws(() => planSaleSplit(t, saleInput, { actor: "dm" }), { message: "Marlow has only 12 gp, 3 sp to spend." });
  assert.throws(() => applyCommand(t, dm, saleCommand(t, "split-short")), { message: "Marlow has only 12 gp, 3 sp to spend." });
  const rich = campaign(marlow({ merchantPurse: 5_000 }));
  const after = applyCommand(rich, dm, saleCommand(rich, "split-ok"));
  assert.equal(after.shops[0].merchantPurse, 3_000);
  assert.equal(after.holdings.some((h) => h.id === "axes"), false);
  const total = (x: CloudTable) => x.purses.reduce((s, p) => s + toCopper(p.coins), 0) + (x.shops[0].merchantPurse ?? 0);
  assert.equal(total(after), total(rich));
});

test("voiding a purchase takes the refund back out of the merchant purse", () => {
  const t = act(campaign(), { kind: "buy", stockId: "nails", purseId: "a", quantity: 2 }, "buy-v");
  const line = t.ledger.find((l) => l.id === "buy-v")!;
  const voided = act(t, { kind: "ledger-void", target: { kind: "ledger", id: line.id }, before: canonicalJson(line), reason: "Mistake" } as CommandInput, "void-1");
  assert.equal(voided.shops[0].merchantPurse, 1230);
  assert.equal(copper(voided, "a"), 5_000);
  const spent = structuredClone(t);
  spent.shops[0].merchantPurse = 100;
  assert.throws(() => act(spent, { kind: "ledger-void", target: { kind: "ledger", id: line.id }, before: canonicalJson(line), reason: "Mistake" } as CommandInput, "void-2"), /already spent this payment/);
});

test("player projection: the purse stays DM-only unless shown; players see what Marlow can afford", () => {
  const t = campaign();
  const shop = projectRecord(t, player).shops[0];
  assert.equal("merchantPurse" in shop, false);
  assert.equal("merchantPurseRefill" in shop, false);
  assert.equal(shop.purseLimited, true);
  // One sword (1,000 cp) fits 1,230 cp, three don't; the potion is not on the buy list.
  assert.deepEqual(shop.merchantAffords, { sword: "some" });
  assert.equal(merchantSaleNotice(shop, { id: "sword", quantity: 3 }, 3_000, 3, "player"), "Marlow may not afford all of them. If not, nothing is sold.");
  assert.equal(merchantSaleNotice(shop, { id: "sword", quantity: 3 }, 1_000, 1, "player"), null);
  // The DM's notice names the amount before confirming.
  assert.equal(merchantSaleNotice(t.shops[0], { id: "sword", quantity: 3 }, 2_000, 2, "dm"), "Marlow has only 12 gp, 3 sp to spend.");
  const shown = campaign(marlow({ showPurse: true }));
  assert.equal(projectRecord(shown, player).shops[0].merchantPurse, 1230);
  // A shop without a purse projects unchanged.
  const plain = marlow();
  delete plain.merchantPurse;
  assert.deepEqual(projectMerchantPurse(plain, t.holdings), plain);
});

test("shared room: the purse moves once per command ID, refusals change nothing, players never read it", async () => {
  const host = await openRoom({ name: "Merchant DM", table: campaign() });
  const joined = await joinRoom({ code: host.code, purseId: "a", name: "Ash" });
  const ash = { code: host.code, token: joined.token };
  await choosePace({ ...host, live: true });
  const cmd = { id: "room-sell", kind: "sell" as const, holdingId: "sword", shopId: "marlow", quantity: 1 };
  await submitCommands({ ...ash, batchId: "sell-1", commands: [cmd] });
  await submitCommands({ ...ash, batchId: "sell-1-retry", commands: [cmd] });
  const once = (await roomState(host)).table;
  assert.equal(once.shops[0].merchantPurse, 230);
  assert.equal(copper(once, "a"), 6_000);
  assert.equal(once.ledger.filter((l) => l.id === "room-sell").length, 1);
  await assert.rejects(
    submitCommands({ ...ash, batchId: "sell-2", commands: [{ ...cmd, id: "room-sell-2" }] }),
    /Marlow can't afford that\./,
  );
  assert.deepEqual((await roomState(host)).table.shops, once.shops);
  const seen = (await roomState(ash)).table;
  assert.equal(JSON.stringify(seen).includes("merchantPurse"), false);
  assert.equal(seen.shops[0].purseLimited, true);
  // Players cannot edit the purse: shop patches are DM-only on the server.
  const before = once.shops[0];
  await assert.rejects(
    submitCommands({ ...ash, batchId: "forge", commands: [{ id: "forge", kind: "patch", changes: [{ store: "shops", id: "marlow", before, after: { ...before, merchantPurse: 1e9 } }] }] }),
    /Only the DM/,
  );
});

function outcome(t: CloudTable) {
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => x.id.localeCompare(y.id));
  return {
    purses: byId(t.purses).map((p) => ({ id: p.id, copper: toCopper(p.coins) })),
    holdings: byId(t.holdings),
    shops: byId(t.shops),
    stock: byId(t.stock),
    ledger: byId(t.ledger).map((l) => ({ ...l, at: 0 })),
    events: (t.journal?.events ?? []).map((e) => ({ ...e, at: 0 })),
  };
}

const parityCases: Array<[string, CommandInput, (id: string) => Promise<unknown>]> = [
  ["sell", sell(1), (id) => sellToShop({ holdingId: "sword", shopId: "marlow", quantity: 1 }, { commandId: id })],
  ["buy", { kind: "buy", stockId: "nails", purseId: "a", quantity: 2 }, (id) => buyFromShop({ stockId: "nails", purseId: "a", quantity: 2 }, { commandId: id })],
  ["restock", { kind: "restock", shopId: "marlow", quantity: 1 }, (id) => executeLocalCommand({ kind: "restock", shopId: "marlow", quantity: 1, id })],
];
for (const [name, input, offline] of parityCases)
  test(`device ${name} moves the merchant purse exactly as the shared engine, once per command ID`, async () => {
    setSeat(DM_SEAT);
    await applyCloudTable(campaign());
    const base = await economySnapshot();
    const shared = applyCommand(structuredClone(base), dm, { ...input, id: `p-${name}` } as SharedCommand);
    await offline(`p-${name}`);
    await offline(`p-${name}`);
    assert.deepEqual(outcome(await economySnapshot()), outcome(shared));
  });

test("device refusals match the shared engine and change nothing, for the DM and a player link", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const before = outcome(await economySnapshot());
  await assert.rejects(sellToShop({ holdingId: "sword", shopId: "marlow", quantity: 2 }), { message: "Marlow has only 12 gp, 3 sp to spend." });
  setSeat({ role: "player", purseIds: ["a"], shopIds: ["marlow"], openedAt: 0 });
  try {
    await assert.rejects(sellToShop({ holdingId: "sword", shopId: "marlow", quantity: 2 }), { message: "Marlow can't afford that." });
    assert.deepEqual(outcome(await economySnapshot()), before);
    // A player-link sale and purchase move the purse as the shared command does.
    await sellToShop({ holdingId: "sword", shopId: "marlow", quantity: 1 }, { commandId: "pl-sell" });
    await sellToShop({ holdingId: "sword", shopId: "marlow", quantity: 1 }, { commandId: "pl-sell" });
    await buyFromShop({ stockId: "nails", purseId: "a", quantity: 1 }, { commandId: "pl-buy" });
    const after = await economySnapshot();
    assert.equal(after.shops[0].merchantPurse, 1230 - 1000 + 100);
    assert.equal(copper(after, "a"), 5_000 + 1_000 - 100);
  } finally {
    setSeat(DM_SEAT);
  }
});

test("device sell and split refuses atomically against a short purse", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const base = await economySnapshot();
  await assert.rejects(executeLocalCommand(saleCommand(base, "dev-split")), { message: "Marlow has only 12 gp, 3 sp to spend." });
  assert.deepEqual(outcome(await economySnapshot()), outcome(base));
});

test("manual player reports pay their shop sales from the merchant purse, or are refused whole", () => {
  const t = campaign();
  const bill = (copperPaid: number): BillFile => ({
    kind: "quire-bill", version: 1, exportedAt: 1, purseIds: ["a"],
    purses: t.purses.filter((p) => p.id === "a"), holdings: t.holdings.filter((h) => h.purseId === "a"), stock: t.stock,
    ledger: [{ id: "bill-sale", at: 1, purseId: "a", shopId: "marlow", summary: "Sold 1 Longsword to Marlow's Forge", copper: copperPaid, transactionType: "sale" }],
  } as unknown as BillFile);
  const seen = { gifts: [], sales: [] };
  assert.equal(applyBillToTable(t, bill(1_000), seen).table.shops[0].merchantPurse, 230);
  assert.throws(() => applyBillToTable(t, bill(2_000), seen), /can't afford the sales in this report/);
});

test("purse fields are whole copper; invalid values are refused", () => {
  for (const bad of [{ merchantPurse: -1 }, { merchantPurse: 1.5 }, { purchaseLimit: -5 }, { offListPercent: 101 }, { offListPercent: 2.5 }])
    assert.throws(() => validateEconomyRows(campaign(marlow(bad as Partial<Shop>))), /invalid or missing data/);
});
