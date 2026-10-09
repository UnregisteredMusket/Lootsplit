import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand, type CommandInput } from "./commands.ts";
import { emptyCloudTable, readCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal, readArchivedSnapshot, preserveJournalMetadata } from "./journal.ts";
import { projectRecord } from "./session-records.ts";
import { exchangeQuoteKey, previewTradeSeason, tradeSeasonFingerprint } from "./trade-economy.ts";
import { toCopper } from "./money.ts";
import { tradeFixture } from "./test-fixtures/trade-economy.ts";
import {
  applyCloudTable,
  economySnapshot,
  executeFinanceCommand,
  snapshot,
  restore,
} from "./economy.ts";
import { setSeat, DM_SEAT } from "./table.ts";
import { sessionTimeFingerprint } from "./session-time.ts";

const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = { ...dm, id: "player", role: "player", purseIds: ["a"] };
let seq = 0;
const act = (t: CloudTable, command: CommandInput, actor = dm) =>
  applyCommand(
    t,
    actor,
    { ...command, id: `trade-test-${++seq}` },
    { source: "server", random: () => 50 },
  );
const economy = (t: CloudTable) => t.journal!.tradeEconomy!;
const quote = (t: CloudTable) =>
  exchangeQuoteKey(economy(t), economy(t).exchanges[0], economy(t).commodities[0]);
const buy = (t: CloudTable, quantity = 10, propertyId?: string) =>
  act(
    t,
    {
      kind: "trade-buy",
      exchangeId: "harbor",
      commodityId: "timber",
      purseId: "a",
      quantity,
      before: quote(t),
      ...(propertyId ? { propertyId } : {}),
    },
    player,
  );
const season = (t: CloudTable, endSession = false) => {
  const prepared = act(t, {
    kind: "downtime-plan",
    name: "Seasonal downtime",
    days: 1,
    advanceSeason: true,
  });
  return act(prepared, {
    kind: "downtime-apply",
    downtimeId: prepared.journal!.finance!.downtime.at(-1)!.id,
    endSession,
  });
};

test("exchange buy/sell conserves canonical money and goods with fixed seasonal prices", () => {
  const original = tradeFixture(),
    frozen = JSON.stringify(original),
    total = original.purses.reduce((n, p) => n + toCopper(p.coins), 0),
    key = quote(original);
  const bought = buy(original);
  assert.equal(JSON.stringify(original), frozen);
  assert.equal(
    bought.purses.reduce((n, p) => n + toCopper(p.coins), 0),
    total,
  );
  assert.equal(economy(bought).exchanges[0].offers[0].stock, 90);
  assert.equal(quote(bought), key);
  const lot = bought.holdings.find((h) => h.commodityId)!;
  assert.equal(lot.materialKey, "timber");
  assert.equal(lot.weight, 2);
  assert.equal(lot.quantity, 10);
  const sold = act(
    bought,
    {
      kind: "trade-sell",
      exchangeId: "harbor",
      commodityId: "timber",
      holdingId: lot.id,
      quantity: 4,
      before: key,
    },
    player,
  );
  assert.equal(sold.holdings.find((h) => h.id === lot.id)!.quantity, 6);
  assert.equal(economy(sold).exchanges[0].offers[0].stock, 94);
  assert.equal(
    sold.purses.reduce((n, p) => n + toCopper(p.coins), 0),
    total,
  );
  assert.equal(economy(sold).receipts.length, 2);
  assert.deepEqual(
    sold.ledger.map((l) => l.transactionType),
    ["purchase", "transfer", "sale", "transfer"],
  );
});

test("permissions, physical custody, capacity, finite stock/cash and stale quotes reject atomically", () => {
  let t = tradeFixture();
  const unchanged = JSON.stringify(t);
  assert.throws(() => buy(t, 101), /stock/);
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "trade-buy",
          exchangeId: "harbor",
          commodityId: "timber",
          purseId: "b",
          quantity: 1,
          before: quote(t),
        },
        player,
      ),
    /assigned/,
  );
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "trade-settings",
          before: economy(t).settings,
          settings: economy(t).settings,
          reason: "Forged",
        },
        player,
      ),
    /Only the DM/,
  );
  assert.equal(JSON.stringify(t), unchanged);
  t.journal!.market!.currentLocationId = null;
  assert.throws(() => buy(t), /location/);
  t.journal!.market!.currentLocationId = "dock";
  t.journal!.propertyOperations!.sites[0].capacityWeight = 1;
  assert.throws(() => buy(t, 1, "warehouse"), /capacity/);
  t.journal!.propertyOperations!.sites[0].capacityWeight = 1000;
  t = buy(t, 10, "warehouse");
  const lot = t.holdings.find((h) => h.commodityId)!;
  t.journal!.market!.currentLocationId = "desert";
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "trade-sell",
          exchangeId: "harbor",
          commodityId: "timber",
          holdingId: lot.id,
          quantity: 1,
          before: quote(t),
        },
        player,
      ),
    /location/,
  );
  t.journal!.market!.currentLocationId = "dock";
  lot.reservedFor = "project";
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "trade-sell",
          exchangeId: "harbor",
          commodityId: "timber",
          holdingId: lot.id,
          quantity: 1,
          before: quote(t),
        },
        player,
      ),
    /unreserved/,
  );
  delete lot.reservedFor;
  t.journal!.propertyOperations!.sites[0].withdrawalApproval = true;
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "trade-sell",
          exchangeId: "harbor",
          commodityId: "timber",
          holdingId: lot.id,
          quantity: 1,
          before: quote(t),
        },
        player,
      ),
    /approval/,
  );
  t.journal!.propertyOperations!.sites[0].withdrawalApproval = false;
  t.purses.find((p) => p.id === "exchange-treasury")!.coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "trade-sell",
          exchangeId: "harbor",
          commodityId: "timber",
          holdingId: lot.id,
          quantity: 1,
          before: quote(t),
        },
        player,
      ),
    /treasury/,
  );
  const old = quote(t);
  economy(t).exchanges[0].offers[0].askCopper++;
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "trade-buy",
          exchangeId: "harbor",
          commodityId: "timber",
          purseId: "a",
          quantity: 1,
          before: old,
        },
        player,
      ),
    /quote changed/,
  );
});

test("campaign economies are separate and activity changes only the next automatic season", () => {
  const untouched = tradeFixture(),
    control = season(tradeFixture()),
    withActivity = season(buy(tradeFixture(), 50));
  assert.equal(economy(untouched).epoch, 0);
  assert.equal(economy(untouched).receipts.length, 0);
  const plain = economy(control).exchanges[0].offers[0],
    changed = economy(withActivity).exchanges[0].offers[0];
  assert.ok(changed.demand > plain.demand);
  assert.ok(changed.supply < plain.supply);
  assert.ok(changed.askCopper > plain.askCopper);
  assert.ok(changed.stock < plain.stock);
  assert.equal(economy(withActivity).history[0].quote.feedback[0].bought, 50);
  assert.equal(economy(withActivity).receipts[0].epoch, 0);
  assert.equal(economy(withActivity).epoch, 1);
  assert.equal(withActivity.realm!.season, 2);
  assert.equal(withActivity.journal!.finance!.day, 1);
});

test("classic retains exact DM values and seasonal locks constrain automatic proposals", () => {
  const classic = buy(tradeFixture());
  economy(classic).settings.mode = "classic";
  const before = structuredClone(economy(classic).exchanges),
    after = season(classic);
  assert.deepEqual(economy(after).exchanges, before);
  assert.equal(economy(after).draws.length, 0);
  const locked = buy(tradeFixture(), 50);
  Object.assign(economy(locked).exchanges[0].offers[0], {
    lockPrice: true,
    lockStock: true,
    lockIndices: true,
  });
  assert.deepEqual(economy(season(locked)).exchanges, economy(locked).exchanges);
});

test("seasonal draws persist across cancellation, reload and previews without rerolling", () => {
  const original = tradeFixture();
  let calls = 0;
  const prepared = applyCommand(
    original,
    dm,
    { id: "prepared", kind: "trade-season-plan", before: tradeSeasonFingerprint(original) },
    {
      source: "server",
      random: () => {
        calls++;
        return 20;
      },
    },
  );
  assert.equal(calls, 5);
  const draws = structuredClone(economy(prepared).draws);
  const cancelled = act(prepared, { kind: "trade-season-cancel", previewId: "prepared" });
  const restored = readCloudTable(JSON.parse(JSON.stringify(cancelled)));
  assert.ok(restored);
  const again = applyCommand(
    restored,
    dm,
    { id: "prepared-again", kind: "trade-season-plan", before: tradeSeasonFingerprint(restored) },
    {
      source: "server",
      random: () => {
        throw Error("Rerolled");
      },
    },
  );
  assert.deepEqual(economy(again).draws, draws);
  assert.deepEqual(previewTradeSeason(again, "prepared-again"), economy(again).pendingSeason);
  assert.throws(
    () =>
      applyCommand(original, dm, {
        id: "forged",
        kind: "trade-season-plan",
        before: tradeSeasonFingerprint(original),
        draws,
      } as never),
    /Unrecognized/,
  );
});

test("manual DM override preserves original rolls/receipts and cannot replay or approve stale state", () => {
  let t = buy(tradeFixture());
  t = act(t, { kind: "trade-season-plan", before: tradeSeasonFingerprint(t), season: 0 });
  const preview = economy(t).pendingSeason!,
    exchanges = structuredClone(preview.exchanges);
  exchanges[0].offers[0].askCopper = 777;
  exchanges[0].offers[0].bidCopper = 500;
  const approved = act(t, {
    kind: "trade-season-approve",
    previewId: preview.id,
    reason: "DM winter intervention",
    exchanges,
    realm: { ...preview.realm, war: 0, shortage: 1 },
  });
  assert.equal(economy(approved).exchanges[0].offers[0].askCopper, 777);
  assert.equal(
    economy(approved).history[0].quote.exchanges[0].offers[0].askCopper,
    preview.exchanges[0].offers[0].askCopper,
  );
  assert.equal(economy(approved).receipts.length, 1);
  assert.equal(economy(approved).draws.length, 5);
  assert.equal(approved.journal!.finance!.day, 0);
  assert.throws(
    () => act(approved, { kind: "trade-season-approve", previewId: preview.id, reason: "Again" }),
    /changed/,
  );
  const stale = buy(t, 1);
  assert.throws(
    () => act(stale, { kind: "trade-season-approve", previewId: preview.id, reason: "Stale" }),
    /changed/,
  );
});

test("end-of-session downtime settles atomically once and archives the resulting economy", () => {
  const active = act(tradeFixture(), { kind: "session", name: "Market day", end: false });
  const prepared = act(active, {
      kind: "downtime-plan",
      name: "Session end",
      days: 7,
      advanceSeason: true,
    }),
    id = prepared.journal!.finance!.downtime[0].id;
  const applied = act(prepared, { kind: "downtime-apply", downtimeId: id, endSession: true });
  assert.equal(applied.journal!.finance!.day, 7);
  assert.equal(economy(applied).epoch, 1);
  assert.ok(applied.journal!.sessions[0].endedAt);
  assert.equal(
    readArchivedSnapshot(applied.journal!.reports![0].snapshot).journal!.tradeEconomy!.epoch,
    1,
  );
  assert.throws(
    () => act(applied, { kind: "downtime-apply", downtimeId: id, endSession: false }),
    /already/,
  );
  const stale = buy(prepared);
  assert.throws(
    () => act(stale, { kind: "downtime-apply", downtimeId: id, endSession: false }),
    /changed/,
  );
  assert.equal(economy(stale).epoch, 0);
  const next = act(prepared, { kind: "session", name: "Next session", end: false, downtimeId: id });
  assert.equal(economy(next).epoch, 1);
  const legacy = act(active, { kind: "downtime-plan", name: "Legacy days", days: 1 });
  const legacyApplied = act(legacy, {
    kind: "downtime-apply",
    downtimeId: legacy.journal!.finance!.downtime[0].id,
    endSession: false,
  });
  assert.equal(economy(legacyApplied).epoch, 0);
});

test("manager orders buy and sell stored lots using actual treasury, budgets and stable units before season settlement", () => {
  const t = tradeFixture();
  t.journal!.market!.currentLocationId = "desert";
  t.journal!.propertyOperations!.standingOrders.push({
    id: "stock-up",
    propertyId: "warehouse",
    managerId: "manager",
    budgetCopper: 1000,
    periodDays: 30,
    nextDay: 1,
    active: true,
    receipt: "",
    order: {
      kind: "market",
      exchangeId: "harbor",
      commodityId: "timber",
      direction: "buy",
      quantity: 5,
      limitCopper: 100,
    },
  });
  const applied = season(t),
    lot = applied.holdings.find((h) => h.commodityId)!;
  assert.equal(lot.quantity, 5);
  assert.equal(lot.custody!.propertyId, "warehouse");
  assert.equal(toCopper(applied.purses[0].coins), 99500);
  assert.equal(applied.journal!.propertyOperations!.staff[0].budgetSpentCopper, 500);
  assert.equal(economy(applied).history[0].quote.feedback[0].bought, 5);
  assert.equal(economy(applied).receipts[0].origin, "manager");
  assert.ok(economy(applied).receipts[0].at > 0);
  const order = applied.journal!.propertyOperations!.standingOrders[0];
  order.nextDay = 2;
  order.order = {
    kind: "market",
    exchangeId: "harbor",
    commodityId: "timber",
    direction: "sell",
    quantity: 3,
    limitCopper: 0,
  };
  const sold = season(applied);
  assert.equal(sold.holdings.find((h) => h.id === lot.id)!.quantity, 2);
  assert.equal(economy(sold).history[1].quote.feedback[0].sold, 3);
  const blocked = tradeFixture();
  blocked.journal!.propertyOperations!.standingOrders = structuredClone(
    t.journal!.propertyOperations!.standingOrders,
  );
  blocked.journal!.propertyOperations!.standingOrders[0].order = {
    kind: "market",
    exchangeId: "harbor",
    commodityId: "timber",
    direction: "buy",
    quantity: 5,
    limitCopper: 99,
  };
  const result = season(blocked);
  assert.equal(economy(result).receipts.length, 0);
  assert.equal(toCopper(result.purses[0].coins), 100000);
  assert.match(result.journal!.propertyOperations!.standingOrders[0].receipt, /price/);
});

test("player projections hide private exchanges, rolls, other trades and pending quotes; old journal writes retain the economy", () => {
  let t = buy(tradeFixture());
  t = act(t, { kind: "trade-season-plan", before: tradeSeasonFingerprint(t) });
  const view = projectRecord(t, player);
  assert.equal(economy(view).draws.length, 0);
  assert.equal(economy(view).history.length, 0);
  assert.equal(economy(view).pendingSeason, undefined);
  assert.equal(economy(view).receipts.length, 1);
  economy(t).exchanges[0].visible = false;
  assert.equal(economy(projectRecord(t, player)).exchanges.length, 0);
  const old = readJournal({ events: [], requests: [], sessions: [] });
  assert.deepEqual(preserveJournalMetadata(old, t.journal!).tradeEconomy, economy(t));
  const legacy = readCloudTable({ ...emptyCloudTable(), journal: old });
  assert.ok(legacy);
  assert.equal(legacy.journal!.tradeEconomy, undefined);
});

test("Session Time and property production reuse existing days and units without automatic seasonal settlement", () => {
  let t = act(tradeFixture(), { kind: "session", name: "Working day", end: false });
  const clock = act(t, {
    kind: "session-time",
    before: sessionTimeFingerprint(t),
    hours: 24,
    rest: "none",
    purseIds: [],
    allowDowntime: false,
    note: "One day travel",
  });
  assert.equal(clock.journal!.finance!.day, 1);
  assert.equal(economy(clock).epoch, 0);
  assert.equal(economy(clock).draws.length, 0);
  t.journal!.propertyOperations!.jobs.push({
    id: "mill",
    propertyId: "warehouse",
    purseId: "a",
    name: "Cut timber",
    recipeKey: "cut-timber",
    recipe: {
      key: "cut-timber",
      name: "Cut timber",
      laborDays: 1,
      laborCostCopper: 0,
      materials: [],
      output: {
        name: "Fresh timber",
        quantity: 10,
        unitCopper: 100,
        weight: 2,
        materialKey: "timber",
      },
    },
    status: "active",
    stage: 0,
    progress: 0,
    paidProgress: 0,
    paidCopper: 0,
    assignments: [{ purseId: "a", share: 100 }],
    paidWorkers: 0,
    approvedChecks: true,
    checkNotes: "",
    message: "",
    requestedBy: "dm",
    createdDay: 0,
  });
  const produced = season(t),
    lot = produced.holdings.find((h) => h.id === "mill-output")!;
  assert.equal(lot.quantity, 10);
  assert.equal(lot.commodityId, "timber");
  assert.equal(lot.materialKey, "timber");
  assert.equal(lot.custody!.kind, "property");
  assert.equal(produced.journal!.propertyOperations!.jobs[0].status, "completed");
});

test("traded identity, property material units and explicit treasury edits are guarded", () => {
  const t = buy(tradeFixture()),
    commodity = economy(t).commodities[0];
  assert.throws(
    () =>
      act(t, {
        kind: "trade-commodity",
        before: commodity,
        commodity: { ...commodity, unit: "crate" },
        reason: "Change physical units",
      }),
    /permanent/,
  );
  const original = tradeFixture();
  assert.throws(
    () =>
      act(original, {
        kind: "trade-commodity",
        before: null,
        commodity: { ...commodity, id: "fake", materialKey: "missing" },
        reason: "Missing material",
      }),
    /material/,
  );
  const adjusted = act(t, {
    kind: "trade-funding",
    exchangeId: "harbor",
    beforeCopper: 51000,
    copper: 12345,
    reason: "DM confirmed liquidity",
  });
  assert.equal(toCopper(adjusted.purses.find((p) => p.id === "exchange-treasury")!.coins), 12345);
  assert.equal(adjusted.ledger.at(-1)!.transactionType, "adjustment");
  assert.throws(
    () =>
      act(adjusted, {
        kind: "trade-funding",
        exchangeId: "harbor",
        beforeCopper: 51000,
        copper: 1,
        reason: "Stale",
      }),
    /changed/,
  );
});

test("local IndexedDB settlement and backup restore retain generated goods, time, quotes and history", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(tradeFixture());
  await executeFinanceCommand({
    kind: "downtime-plan",
    name: "Local season",
    days: 1,
    advanceSeason: true,
  });
  const prepared = await economySnapshot();
  assert.equal(economy(prepared).draws[0].source, "local");
  await executeFinanceCommand({
    kind: "downtime-apply",
    downtimeId: prepared.journal!.finance!.downtime[0].id,
    endSession: false,
  });
  const settled = await economySnapshot();
  assert.equal(economy(settled).epoch, 1);
  assert.equal(settled.realm!.season, 2);
  const backup = await snapshot();
  await restore(backup);
  assert.deepEqual(economy(await economySnapshot()), economy(settled));
});
