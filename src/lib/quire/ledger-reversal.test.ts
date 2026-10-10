import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand, tablePatch, type CommandInput } from "./commands.ts";
import { canonicalJson } from "./canonical-json.ts";
import { readCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { tradeFixture } from "./test-fixtures/trade-economy.ts";
import { exchangeQuoteKey, previewTradeSeason, tradeSeasonFingerprint } from "./trade-economy.ts";
import { archiveSession, projectRecord } from "./session-records.ts";
import { preserveJournalMetadata } from "./journal.ts";
import { readTradeSettlementHolding, tradeReversalGuidance } from "./ledger-reversal.ts";
import { fromCopper, toCopper } from "./money.ts";
import { applyCloudTable, buyFromShop, economySnapshot, executeLocalCommand, restore, snapshot, voidLedgerLine } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import type { Holding } from "./types.ts";

const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = { ...dm, id: "player", role: "player", purseIds: ["a"] };
let sequence = 0;
const act = (table: CloudTable, command: CommandInput, seat = dm) => applyCommand(
  table, seat, { ...command, id: "reversal-test-" + ++sequence },
  { source: "server", random: () => 50 },
);
const economy = (table: CloudTable) => table.journal!.tradeEconomy!;
const quote = (table: CloudTable) => {
  const e = economy(table);
  return exchangeQuoteKey(e, e.exchanges[0], e.commodities[0]);
};
const wallet = (table: CloudTable, id: string) => toCopper(table.purses.find(p => p.id === id)!.coins);
const total = (table: CloudTable) => table.purses.reduce((sum, p) => sum + toCopper(p.coins), 0);
const buy = (table: CloudTable, quantity = 10, propertyId?: string) => act(table, {
  kind: "trade-buy", exchangeId: "harbor", commodityId: "timber", purseId: "a", quantity,
  before: quote(table), ...(propertyId ? { propertyId } : {}),
}, player);
const sell = (table: CloudTable, holdingId: string, quantity: number) => act(table, {
  kind: "trade-sell", exchangeId: "harbor", commodityId: "timber", holdingId, quantity, before: quote(table),
}, player);
const reverse = (table: CloudTable, receipt = economy(table).receipts.at(-1)!, seat = dm) => act(table, {
  kind: "ledger-void", target: { kind: "trade", id: receipt.id },
  before: canonicalJson(receipt), reason: "Correct the reviewed mistaken transaction.",
}, seat);
const plan = (table: CloudTable) => act(table, { kind: "trade-season-plan", before: tradeSeasonFingerprint(table) });
function downtime(table: CloudTable, advanceSeason: boolean) {
  const prepared = act(table, { kind: "downtime-plan", name: "Reviewed downtime", days: 1, advanceSeason });
  return act(prepared, {
    kind: "downtime-apply", downtimeId: prepared.journal!.finance!.downtime.at(-1)!.id, endSession: false,
  });
}
function shopFixture() {
  const table = tradeFixture();
  table.shops.push({
    id: "supplier", name: "Timber Shop", keeper: "", place: "", notes: "", sellRate: 1,
    buyRate: 0.5, wealth: "modest", category: "mixed", priceScale: 1, locationId: "port",
  });
  table.stock.push({
    id: "timber-stock", shopId: "supplier", name: "Timber bundle", copper: 100, baseCopper: 100,
    rarity: "common", quantity: 100, notes: "Reviewed timber", category: "general",
    commodityId: "timber", tradeExchangeId: "harbor",
  });
  return table;
}
function detailedLot(id: string, quantity: number, stored = false): Holding & { futureMetadata: unknown } {
  return {
    id, purseId: "a", kind: "item", name: "Inherited timber", quantity, unitCopper: 41,
    notes: "Keep the original provenance and description.", weight: 2, category: "general",
    commodityId: "timber", materialKey: "timber", image: "/art/shop-default.webp", equipped: false,
    futureMetadata: { source: "Family inventory", nested: { approved: true } },
    ...(stored ? { custody: { kind: "property" as const, propertyId: "warehouse" } } : {}),
  };
}

test("reversing either exchange cash leg restores both purses, exact goods and stock once at the original price", () => {
  for (const leg of ["owner", "treasury"] as const) {
    const initial = tradeFixture(), bought = buy(initial), receipt = economy(bought).receipts[0];
    const originalReceipt = canonicalJson(receipt);
    assert.deepEqual(bought.ledger.map(line => line.trade), [
      { receiptId: receipt.id, leg: "owner" }, { receiptId: receipt.id, leg: "treasury" },
    ]);
    const offer = economy(bought).exchanges[0].offers[0];
    offer.askCopper = 300; offer.bidCopper = 20;
    economy(bought).exchanges[0].open = false;
    economy(bought).commodities[0].active = false;
    const line = bought.ledger.find(row => row.trade?.leg === leg)!;
    const before = canonicalJson(bought);
    const corrected = act(bought, {
      kind: "ledger-void", target: { kind: "ledger", id: line.id }, before: canonicalJson(line), reason: "Wrong purchase.",
    });
    assert.equal(canonicalJson(bought), before);
    assert.equal(total(corrected), total(initial));
    assert.equal(wallet(corrected, "a"), wallet(initial, "a"));
    assert.equal(wallet(corrected, "exchange-treasury"), wallet(initial, "exchange-treasury"));
    assert.deepEqual(corrected.holdings, initial.holdings);
    assert.equal(economy(corrected).exchanges[0].offers[0].stock, 100);
    assert.equal(economy(corrected).exchanges[0].offers[0].askCopper, 300);
    assert.equal(canonicalJson(economy(corrected).receipts[0]), originalReceipt);
    const correction = economy(corrected).receipts[1];
    assert.equal(correction.reversalOf, receipt.id);
    assert.equal(correction.copper, 1000);
    assert.equal(correction.direction, "sell");
    assert.equal(correction.settlement, undefined);
    assert.deepEqual(corrected.ledger.slice(2).map(row => row.reversalOf).sort(), bought.ledger.map(row => row.id).sort());
    assert.ok(corrected.ledger.slice(2).every(row => row.trade?.receiptId === correction.id));
    assert.deepEqual(reverse(corrected, receipt), corrected);
  }
});

test("partial, complete and zero-copper exchange sales restore one complete snapshot with all asset metadata", () => {
  for (const [quantity, bid] of [[4, 60], [10, 60], [10, 0]]) {
    const initial = tradeFixture(), original = detailedLot("inherited", 10);
    initial.holdings.push(original);
    economy(initial).exchanges[0].offers[0].bidCopper = bid;
    const sold = sell(initial, original.id, quantity), receipt = economy(sold).receipts[0];
    assert.deepEqual(JSON.parse(receipt.settlement!.holding), original);
    assert.deepEqual(Object.keys(receipt.settlement!).sort(), ["holding", "treasuryPurseId", "version"]);
    assert.equal(sold.ledger.length, bid ? 2 : 0);
    const restored = readCloudTable(JSON.parse(JSON.stringify(sold)))!;
    assert.ok(restored);
    const corrected = reverse(restored);
    assert.deepEqual(corrected.holdings.find(h => h.id === original.id), original);
    assert.equal(wallet(corrected, "a"), wallet(initial, "a"));
    assert.equal(wallet(corrected, "exchange-treasury"), wallet(initial, "exchange-treasury"));
    assert.equal(total(corrected), total(initial));
    assert.equal(economy(corrected).exchanges[0].offers[0].stock, 100);
    assert.equal(economy(corrected).receipts[1].copper, quantity * bid);
    assert.equal(corrected.ledger.length, bid ? 4 : 0);
    assert.equal(economy(corrected).receipts[1].direction, "buy");
  }
});

test("authority, stale review, changed custody, exhausted cash, capacity and incomplete ledger evidence reject atomically", () => {
  const bought = buy(tradeFixture()), receipt = economy(bought).receipts[0];
  const unchanged = canonicalJson(bought);
  assert.throws(() => reverse(bought, receipt, player), /Only the DM/);
  assert.throws(() => act(bought, {
    kind: "ledger-void", target: { kind: "trade", id: receipt.id }, before: "{}", reason: "Stale review",
  }), /receipt changed/);
  assert.equal(canonicalJson(bought), unchanged);
  const mutations: ((table: CloudTable) => void)[] = [
    table => { table.holdings.find(h => h.commodityId)!.quantity--; },
    table => { table.holdings.find(h => h.commodityId)!.notes += " changed"; },
    table => { table.holdings.find(h => h.commodityId)!.purseId = "b"; },
    table => { table.holdings.find(h => h.commodityId)!.reservedFor = "pending-project"; },
    table => { table.holdings.find(h => h.commodityId)!.custody = { kind: "property", propertyId: "warehouse" }; },
    table => { table.purses.find(p => p.id === "exchange-treasury")!.coins = fromCopper(0); },
    table => { table.purses.find(p => p.id === "a")!.coins = fromCopper(1e12); },
    table => { economy(table).exchanges[0].offers[0].capacity = 95; },
    table => { table.ledger.pop(); },
    table => { table.ledger.push({ ...structuredClone(table.ledger[0]), id: "contradictory-leg" }); },
    table => {
      table.purses.push({ ...structuredClone(table.purses.find(p => p.id === "exchange-treasury")!), id: "replacement-treasury" });
      economy(table).exchanges[0].purseId = "replacement-treasury";
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(bought);
    mutate(changed);
    const before = canonicalJson(changed);
    assert.throws(() => reverse(changed, receipt), /changed|cannot|missing|matching|capacity/);
    assert.equal(canonicalJson(changed), before);
  }
  const initial = tradeFixture(); initial.holdings.push(detailedLot("original", 10, true));
  const sold = sell(initial, "original", 4), sale = economy(sold).receipts[0];
  sold.purses.find(p => p.id === "a")!.coins = fromCopper(0);
  const before = canonicalJson(sold);
  assert.throws(() => reverse(sold, sale), /cannot cover/);
  assert.equal(canonicalJson(sold), before);
  sold.purses.find(p => p.id === "a")!.coins = fromCopper(100000);
  sold.journal!.propertyOperations!.sites[0].capacityWeight = 15;
  assert.throws(() => reverse(sold, sale), /storage capacity/);
  sold.journal!.propertyOperations!.sites[0].capacityWeight = 1000;
  sold.holdings.find(h => h.id === "warehouse")!.purseId = "b";
  assert.throws(() => reverse(sold, sale), /owner changed/);
});

test("stored-sale corrections need usable current storage while DM accounting corrections need no travel or player access", () => {
  const initial = tradeFixture(); initial.holdings.push(detailedLot("stored-original", 10, true));
  const sold = sell(initial, "stored-original", 4), receipt = economy(sold).receipts[0];
  for (const mutate of [
    (table: CloudTable) => { table.journal!.propertyOperations!.sites[0].enabled = false; },
    (table: CloudTable) => { table.holdings.find(h => h.id === "warehouse")!.property!.condition = "ruin"; },
    (table: CloudTable) => { table.journal!.propertyOperations!.templates[0].capabilities = ["crafting"]; },
  ]) {
    const changed = structuredClone(sold); mutate(changed);
    const before = canonicalJson(changed);
    assert.throws(() => reverse(changed, receipt), /active usable property storage/);
    assert.equal(canonicalJson(changed), before);
  }
  sold.journal!.market!.currentLocationId = "desert";
  sold.journal!.propertyOperations!.sites[0].access = "selected";
  sold.journal!.propertyOperations!.sites[0].accessPurseIds = ["b"];
  sold.journal!.propertyOperations!.sites[0].withdrawalApproval = true;
  assert.deepEqual(reverse(sold, receipt).holdings.find(h => h.id === "stored-original"), initial.holdings[1]);
  const bought = buy(tradeFixture(), 10, "warehouse");
  bought.journal!.market!.currentLocationId = "desert";
  bought.journal!.propertyOperations!.sites[0].enabled = false;
  assert.deepEqual(reverse(bought).holdings, tradeFixture().holdings);
});

test("ordinary linked shop purchases and free services correct cash, shelf and seasonal feedback together", () => {
  for (const service of [false, true]) {
    const initial = shopFixture();
    if (service) { initial.stock[0].service = true; initial.stock[0].copper = 0; }
    const bought = act(initial, { kind: "buy", stockId: "timber-stock", purseId: "a", quantity: 3 }, player);
    const receipt = economy(bought).receipts[0], originalLine = bought.ledger[0];
    assert.deepEqual(originalLine.trade, { receiptId: receipt.id, leg: "owner" });
    assert.equal(originalLine.purchase?.stockId, "timber-stock");
    assert.equal(originalLine.purchase?.holding === null, service);
    const prepared = plan(bought), oldFingerprint = tradeSeasonFingerprint(prepared);
    const corrected = reverse(prepared, receipt);
    assert.equal(wallet(corrected, "a"), wallet(initial, "a"));
    assert.equal(corrected.stock[0].quantity, 100);
    assert.deepEqual(corrected.holdings, initial.holdings);
    assert.equal(corrected.ledger.length, 2);
    assert.equal(corrected.ledger[1].copper, -originalLine.copper);
    assert.notEqual(tradeSeasonFingerprint(corrected), oldFingerprint);
    assert.deepEqual(previewTradeSeason(corrected, "review-again").feedback, [
      { exchangeId: "harbor", commodityId: "timber", bought: 3, sold: 3 },
    ]);
    assert.deepEqual(economy(corrected).draws, economy(prepared).draws);
    const legacy = structuredClone(bought);
    delete legacy.ledger[0].trade;
    assert.equal(economy(reverse(legacy)).receipts.length, 2);
  }
});

test("legacy exchange receipts, supplier deliveries and old generic half-void patches require complete compensation", () => {
  const bought = buy(tradeFixture()), receipt = economy(bought).receipts[0];
  const legacy = structuredClone(bought);
  delete economy(legacy).receipts[0].settlement;
  for (const line of legacy.ledger) delete line.trade;
  assert.match(tradeReversalGuidance(economy(legacy).receipts[0])!, /older exchange.*compensating/);
  assert.throws(() => reverse(legacy), /compensating payment/);
  assert.throws(() => act(legacy, {
    kind: "ledger-void", target: { kind: "ledger", id: legacy.ledger[0].id },
    before: canonicalJson(legacy.ledger[0]), reason: "Legacy half reversal",
  }), /compensating payment/);
  for (const copper of [100, 0]) {
    const table = shopFixture(); table.stock[0].copper = copper;
    const delivery = act(table, { kind: "buy", stockId: "timber-stock", purseId: "a", quantity: 1 });
    economy(delivery).receipts[0].propertyId = "warehouse";
    assert.throws(() => reverse(delivery), /transport obligations.*compensating/);
  }
  const shop = act(shopFixture(), { kind: "buy", stockId: "timber-stock", purseId: "a", quantity: 3 });
  for (const original of [shop, bought]) {
    const before = canonicalJson(original), corrected = reverse(original);
    assert.throws(() => act(original, tablePatch(original, corrected)), /money, goods and seasonal activity/);
    assert.equal(canonicalJson(original), before);
    const staleJournal = structuredClone(corrected.journal!);
    assert.deepEqual(preserveJournalMetadata(staleJournal, original.journal!).tradeEconomy, economy(original));
  }
  const altered = structuredClone(receipt);
  altered.settlement!.holding = JSON.stringify({ ...readTradeSettlementHolding(receipt), purseId: "b" });
  const corrupt = structuredClone(bought);
  economy(corrupt).receipts[0] = altered;
  assert.equal(readCloudTable(corrupt), null);
});

test("a correction after settlement affects the new season while preserving history and recorded draws", () => {
  const bought = buy(tradeFixture(), 5), original = economy(bought).receipts[0];
  const settled = downtime(bought, true), prepared = plan(settled);
  const history = canonicalJson(economy(prepared).history), draws = canonicalJson(economy(prepared).draws);
  const pending = economy(prepared).pendingSeason!;
  const corrected = reverse(prepared, original);
  assert.equal(economy(corrected).receipts[1].epoch, 1);
  assert.equal(economy(corrected).epoch, 1);
  assert.equal(canonicalJson(economy(corrected).history), history);
  assert.equal(canonicalJson(economy(corrected).draws), draws);
  assert.equal(economy(corrected).history[0].quote.feedback[0].bought, 5);
  assert.deepEqual(previewTradeSeason(corrected, "next-review").feedback, [
    { exchangeId: "harbor", commodityId: "timber", bought: 0, sold: 5 },
  ]);
  assert.throws(() => act(corrected, {
    kind: "trade-season-approve", previewId: pending.id, reason: "Use the stale plan",
  }), /changed|stale/);
  const canceled = act(corrected, { kind: "trade-season-cancel", previewId: pending.id });
  assert.equal(canonicalJson(economy(plan(canceled)).draws), draws);
});

test("archived exchange ledger legs authorize a complete correction without modifying immutable archives", () => {
  const bought = buy(tradeFixture()), original = economy(bought).receipts[0];
  const archived = structuredClone(bought);
  archiveSession(archived, "archive", "Session with a mistaken buy", 100);
  const report = archived.journal!.reports![0];
  report.seatIds = [dm.id];
  assert.equal(archived.ledger.length, 0);
  const bytes = report.snapshot;
  const clearedViaPatch = act(bought, tablePatch(bought, archived));
  assert.equal(clearedViaPatch.ledger.length, 0);
  assert.equal(clearedViaPatch.journal!.reports![0].snapshot, bytes);
  assert.equal(economy(reverse(clearedViaPatch, original)).receipts.length, 2);
  const corrected = reverse(archived, original);
  assert.equal(corrected.journal!.reports![0].snapshot, bytes);
  assert.equal(corrected.ledger.length, 2);
  assert.equal(economy(corrected).receipts.length, 2);
  assert.equal(wallet(corrected, "a"), 100000);
  assert.deepEqual(reverse(corrected, original), corrected);
  const duplicated = structuredClone(archived);
  duplicated.ledger = structuredClone(bought.ledger);
  assert.equal(economy(reverse(duplicated, original)).receipts.length, 2);
  duplicated.ledger[0].summary += " contradictory";
  assert.throws(() => reverse(duplicated, original), /archive disagree/);
  const restricted = structuredClone(archived);
  restricted.journal!.reports![0].seatIds = ["previous-dm"];
  const before = canonicalJson(restricted);
  assert.throws(() => reverse(restricted, original), /missing complete matching/);
  assert.equal(canonicalJson(restricted), before);
});

test("a manager sale reverses all linked lots through final finance ledger IDs and retains the executed order and budget history", () => {
  const initial = tradeFixture(), first = detailedLot("first-lot", 3, true), second = detailedLot("second-lot", 4, true);
  initial.holdings.push(first, second);
  initial.journal!.market!.currentLocationId = "desert";
  initial.journal!.propertyOperations!.standingOrders.push({
    id: "sell-stored", propertyId: "warehouse", managerId: "manager", budgetCopper: 1000,
    periodDays: 30, nextDay: 1, active: true, receipt: "",
    order: { kind: "market", exchangeId: "harbor", commodityId: "timber", direction: "sell", quantity: 5, limitCopper: 0 },
  });
  const sold = downtime(initial, false), originals = economy(sold).receipts;
  assert.equal(originals.length, 2);
  assert.ok(originals[0].operationId);
  assert.equal(originals[0].operationId, originals[1].operationId);
  assert.ok(originals.every(r => r.origin === "manager" && r.at > 0));
  assert.equal(sold.ledger.filter(line => line.trade).length, 4);
  for (const line of sold.ledger.filter(line => line.trade)) {
    assert.ok(originals.some(r => r.id === line.trade!.receiptId));
    assert.notEqual(line.id, line.trade!.receiptId + "-" + line.trade!.leg);
  }
  const operation = canonicalJson(sold.journal!.propertyOperations), finance = canonicalJson(sold.journal!.finance);
  const before = canonicalJson(sold), corrected = reverse(sold, originals[0]);
  assert.equal(canonicalJson(sold), before);
  assert.equal(wallet(corrected, "a"), wallet(initial, "a"));
  assert.equal(wallet(corrected, "exchange-treasury"), wallet(initial, "exchange-treasury"));
  assert.equal(total(corrected), total(initial));
  assert.deepEqual(corrected.holdings.find(h => h.id === first.id), first);
  assert.deepEqual(corrected.holdings.find(h => h.id === second.id), second);
  assert.equal(economy(corrected).exchanges[0].offers[0].stock, 100);
  assert.equal(economy(corrected).receipts.length, 4);
  assert.deepEqual(economy(corrected).receipts.slice(2).map(r => r.reversalOf), [originals[1].id, originals[0].id]);
  assert.equal(canonicalJson(corrected.journal!.propertyOperations), operation);
  assert.equal(canonicalJson(corrected.journal!.finance), finance);
  assert.deepEqual(reverse(corrected, originals[1]), corrected);
  const occupied = structuredClone(sold);
  occupied.holdings.push({ ...first, notes: "A different lot now uses this identity." });
  const occupiedBefore = canonicalJson(occupied);
  assert.throws(() => reverse(occupied, originals[0]), /changed or left/);
  assert.equal(canonicalJson(occupied), occupiedBefore);
});

test("local shop correction, exact exchange snapshots and counterreceipts survive full backup and recovery", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(shopFixture());
  await buyFromShop({ stockId: "timber-stock", purseId: "a", quantity: 3 });
  const shop = await economySnapshot(), line = shop.ledger[0];
  assert.ok(line.trade);
  await Promise.all([voidLedgerLine(line.id), voidLedgerLine(line.id)]);
  const correctedShop = await economySnapshot();
  assert.equal(economy(correctedShop).receipts.length, 2);
  assert.equal(correctedShop.ledger.length, 2);
  assert.equal(wallet(correctedShop, "a"), 100000);
  const initial = tradeFixture(); initial.holdings.push(detailedLot("backed-up-lot", 10));
  const sold = sell(initial, "backed-up-lot", 4), original = economy(sold).receipts[0];
  await applyCloudTable(sold);
  const backup = await snapshot();
  await applyCloudTable(tradeFixture());
  await restore(backup);
  assert.equal(economy(await economySnapshot()).receipts[0].settlement!.holding, original.settlement!.holding);
  await executeLocalCommand({
    kind: "ledger-void", target: { kind: "trade", id: original.id },
    before: canonicalJson(original), reason: "Correction after recovery",
  });
  const corrected = await economySnapshot();
  assert.deepEqual(corrected.holdings.find(h => h.id === "backed-up-lot"), initial.holdings[1]);
  const finalBackup = await snapshot();
  await applyCloudTable(tradeFixture());
  await restore(finalBackup);
  assert.deepEqual(economy(await economySnapshot()).receipts, economy(corrected).receipts);
});

test("player projections exclude complete settlement snapshots and private manager grouping but retain visible corrections", () => {
  const bought = buy(tradeFixture()), original = economy(bought).receipts[0];
  original.operationId = "private-order-reference";
  const corrected = reverse(bought, original), projected = projectRecord(corrected, player);
  assert.equal(economy(projected).receipts.length, 2);
  for (const receipt of economy(projected).receipts) {
    assert.equal(receipt.settlement, undefined);
    assert.equal(receipt.operationId, undefined);
  }
  assert.equal(economy(projected).receipts[1].reversalOf, original.id);
  assert.equal(projected.journal!.events.filter(event => event.summary.startsWith("Ledger correction:")).length, 0);
  const other = projectRecord(corrected, { ...player, id: "other", purseIds: ["b"] });
  assert.equal(economy(other).receipts.length, 0);
});

test("unlinked cash corrections preserve existing coin denominations", () => {
  const table = tradeFixture();
  table.purses[0].coins = { cp: 101, sp: 3, ep: 2, gp: 5, pp: 1 };
  table.ledger.push({ id: "cash-payment", purseId: "a", shopId: null, copper: -100, at: 1, summary: "Expense", transactionType: "payment" });
  const line = table.ledger[0];
  const corrected = act(table, { kind: "ledger-void", target: { kind: "ledger", id: line.id }, before: canonicalJson(line), reason: "Wrong expense" });
  assert.deepEqual(corrected.purses[0].coins, { cp: 101, sp: 3, ep: 2, gp: 6, pp: 1 });
  assert.equal(economy(corrected).receipts.length, 0);
  assert.equal(corrected.ledger[1].trade, undefined);
});
