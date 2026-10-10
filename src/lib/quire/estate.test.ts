import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { emptyCloudTable, readCloudTable, type CloudTable, type CloudSeat } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readEstate, recipeSchema, type EstateJob } from "./estate-schema.ts";
import { estatePreset } from "./estate-catalogue.ts";
import {
  estateImportSchema,
  estateImportFingerprint,
  previewEstateImport,
} from "./estate-import.ts";
import { characterSheet, editCharacter } from "../characters/campaign-sheet.mjs";
import { readJournal, readArchivedSnapshot, preserveJournalMetadata } from "./journal.ts";
import { readFinance, previewDowntime } from "./finance.ts";
import { projectRecord, archiveSession } from "./session-records.ts";
import {
  blankShop,
  applyCloudTable,
  economySnapshot,
  executeLocalCommand,
  executeFinanceCommand,
  readQuireFile,
  snapshot,
} from "./economy.ts";
import { setSeat, DM_SEAT } from "./table.ts";
import { toCopper } from "./money.ts";
import { canonicalJson } from "./canonical-json.ts";
import { tradeFixture } from "./test-fixtures/trade-economy.ts";
import { exchangeQuoteKey } from "./trade-economy.ts";
import { blankSheet } from "../characters/model.mjs";

const dm: CloudSeat = { id: "dm", name: "DM", token: "dm", role: "dm", purseIds: [] };
const hero: CloudSeat = {
  id: "hero-seat",
  name: "Hero",
  token: "hero",
  role: "player",
  purseIds: ["hero"],
};
let receipt = 0;
const command = (t: CloudTable, input: CommandInput, seat = dm) =>
  applyCommand(t, seat, { ...input, id: `estate-test-${++receipt}` });
function fixture(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      {
        id: "party",
        name: "Party treasury",
        kind: "party",
        coins: { cp: 10000, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
      {
        id: "hero",
        name: "Alwen",
        kind: "character",
        coins: { cp: 1000, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
      {
        id: "other",
        name: "Borin",
        kind: "character",
        coins: { cp: 777, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    ],
    holdings: [
      {
        id: "warehouse",
        name: "Party warehouse",
        purseId: "party",
        kind: "property",
        unitCopper: 5000,
        quantity: 1,
        notes: "",
        locationId: "city",
        property: { type: "other", condition: "ready" },
      },
      {
        id: "timber",
        name: "Timber",
        purseId: "hero",
        kind: "item",
        quantity: 10,
        unitCopper: 100,
        weight: 2,
        equipped: true,
        materialKey: "timber",
        notes: "",
      },
      {
        id: "secret",
        name: "Private gem",
        purseId: "other",
        kind: "item",
        quantity: 1,
        unitCopper: 7777,
        notes: "Private",
      },
    ],
    shops: [
      {
        ...blankShop(),
        id: "shop",
        name: "City post office and supplies",
        locationId: "city",
        keeper: "Clerk",
        buyRate: 1,
      },
    ],
    stock: [
      {
        id: "stock",
        shopId: "shop",
        name: "Timber",
        copper: 100,
        quantity: 20,
        notes: "",
        baseCopper: 100,
        rarity: "common",
      },
    ],
    journal: readJournal({
      finance: readFinance(),
      market: {
        currentLocationId: "area",
        locations: [
          { id: "region", name: "Eastmarch", kind: "region", parentId: null, description: "" },
          { id: "city", name: "Brackenport", kind: "city", parentId: "region", description: "" },
          { id: "area", name: "Dock Ward", kind: "area", parentId: "city", description: "" },
          { id: "far", name: "Farvale", kind: "city", parentId: "region", description: "" },
        ],
      },
      propertyOperations: readEstate({
        templates: [
          estatePreset("warehouse"),
          estatePreset("house"),
          {
            ...estatePreset("land"),
            recipes: [
              recipeSchema.parse({
                key: "build",
                name: "Build a house",
                resultTemplateKey: "house",
                laborDays: 2,
                laborCostCopper: 200,
                materials: [{ materialKey: "timber", quantity: 2 }],
              }),
            ],
          },
        ],
        materials: [{ key: "timber", name: "Timber", unit: "bundle" }],
        sites: [
          {
            propertyId: "warehouse",
            templateKey: "warehouse",
            enabled: true,
            access: "party-members",
            accessPurseIds: [],
            capacityWeight: null,
            completedTemplates: [],
            notes: "",
          },
        ],
        postal: { feeCopper: 10, deliveryDays: 2, offices: [{ shopId: "shop", allowTown: false }] },
      }),
    }),
  };
}
function job(t: CloudTable, id = "job", overrides: Partial<EstateJob> = {}): EstateJob {
  const recipe = t.journal!.propertyOperations!.templates.find((x) => x.key === "land")!
    .recipes![0];
  return {
    id,
    propertyId: "warehouse",
    purseId: "party",
    name: recipe.name,
    recipeKey: recipe.key,
    recipe,
    status: "active",
    stage: 0,
    progress: 0,
    paidProgress: 0,
    paidCopper: 0,
    assignments: [{ purseId: "hero", share: 100 }],
    paidWorkers: 0,
    approvedChecks: true,
    checkNotes: "",
    message: "",
    requestedBy: "dm",
    createdDay: 0,
    ...overrides,
  };
}
function stored(t = fixture(), count = 4, donate = false) {
  return command(
    t,
    {
      kind: "estate-storage",
      propertyId: "warehouse",
      holdingId: "timber",
      quantity: count,
      direction: "deposit",
      purseId: "hero",
      override: false,
      donate,
    },
    hero,
  );
}

test("withdrawal approval preserves custody until collection and rechecks location, goods and access", () => {
  let t = stored();
  t.journal!.propertyOperations!.sites[0].withdrawalApproval = true;
  const item = t.holdings.find((h) => h.custody?.kind === "property")!;
  const withdraw = {
    kind: "estate-storage" as const,
    propertyId: "warehouse",
    holdingId: item.id,
    quantity: 2,
    direction: "withdraw" as const,
    purseId: "hero",
    override: false,
  };
  t = command(t, withdraw, hero);
  const request = t.journal!.propertyOperations!.withdrawals[0];
  assert.equal(request.status, "pending");
  assert.equal(t.holdings.find((h) => h.id === item.id)!.quantity, 4);
  assert.throws(
    () =>
      command(
        t,
        {
          kind: "estate-withdrawal-review",
          requestId: request.id,
          before: canonicalJson(request),
          status: "approved",
          reason: "Reviewed",
        },
        hero,
      ),
    /Only the DM/,
  );
  t = command(t, {
    kind: "estate-withdrawal-review",
    requestId: request.id,
    before: canonicalJson(request),
    status: "approved",
    reason: "Approved two bundles",
  });
  const approved = { ...withdraw, approvalId: request.id };
  const away = structuredClone(t);
  away.journal!.market!.currentLocationId = "far";
  assert.throws(() => command(away, approved, hero), /location/);
  const revoked = structuredClone(t);
  revoked.journal!.propertyOperations!.sites[0].access = "owner";
  assert.throws(() => command(revoked, approved, hero), /permission/);
  const changed = structuredClone(t);
  changed.holdings.find((h) => h.id === item.id)!.quantity--;
  assert.throws(() => command(changed, approved, hero), /unchanged/);
  t = command(t, approved, hero);
  assert.equal(t.journal!.propertyOperations!.withdrawals[0].status, "fulfilled");
  assert.equal(t.holdings.find((h) => h.id === item.id)!.quantity, 2);
  assert.throws(() => command(t, approved, hero), /unchanged/);
});
function advance(t: CloudTable, days: number) {
  const planned = command(t, { kind: "downtime-plan", name: "Property downtime", days }),
    pending = planned.journal!.finance!.downtime.find((d) => d.status === "pending")!;
  return command(planned, {
    kind: "session",
    name: "Next session",
    end: false,
    downtimeId: pending.id,
  });
}

test("party storage splits a canonical lot, shares contents and enforces known location", () => {
  let t = stored();
  const lot = t.holdings.find((h) => h.custody)!;
  assert.equal(t.holdings.find((h) => h.id === "timber")!.quantity, 6);
  assert.equal(lot.quantity, 4);
  assert.equal(lot.purseId, "hero");
  assert.equal(lot.equipped, false);
  assert.equal(
    t.holdings.reduce((n, h) => n + h.quantity * h.unitCopper, 0),
    fixture().holdings.reduce((n, h) => n + h.quantity * h.unitCopper, 0),
  );
  const sheet = characterSheet(
    t.purses.find((p) => p.id === "hero")!,
    t.holdings,
  );
  assert.equal(
    sheet.equipment.some((i) => i.id === lot.id),
    false,
  );
  assert.throws(
    () => command(t, { kind: "sell", holdingId: lot.id, shopId: "shop", quantity: 1 }, hero),
    /Retrieve/,
  );
  assert.throws(
    () =>
      command(
        t,
        { kind: "give", fromId: "hero", toId: "other", copper: 0, holdingId: lot.id, quantity: 1 },
        hero,
      ),
    /Retrieve/,
  );
  t = command(t, { kind: "party-location", before: "area", locationId: null });
  assert.throws(
    () =>
      command(
        t,
        {
          kind: "estate-storage",
          propertyId: "warehouse",
          holdingId: lot.id,
          quantity: 1,
          direction: "withdraw",
          purseId: "hero",
          override: false,
        },
        hero,
      ),
    /must be at/,
  );
  t = command(t, {
    kind: "estate-storage",
    propertyId: "warehouse",
    holdingId: lot.id,
    quantity: 1,
    direction: "withdraw",
    purseId: "other",
    override: true,
  });
  assert.equal(t.holdings.find((h) => h.purseId === "other" && h.materialKey)!.quantity, 1);
  assert.match(t.journal!.events.at(-1)!.summary, /DM location override/);
});
test("finite storage refuses unknown weights, excess capacity and unauthorized characters", () => {
  let t = fixture();
  const site = t.journal!.propertyOperations!.sites[0];
  t = command(t, { kind: "estate-site", before: site, site: { ...site, capacityWeight: 5 } });
  assert.throws(() => stored(t), /capacity/);
  delete t.holdings.find((h) => h.id === "timber")!.weight;
  assert.throws(() => stored(t, 1), /missing item weights/);
  assert.throws(
    () =>
      command(
        t,
        {
          kind: "estate-storage",
          propertyId: "warehouse",
          holdingId: "timber",
          quantity: 1,
          direction: "deposit",
          purseId: "hero",
          override: false,
        },
        { ...hero, purseIds: [] },
      ),
    /permission/,
  );
});
test("player sheet editing preserves stored lots and rejects forged carried references", () => {
  const t = stored(),
    p = t.purses.find((p) => p.id === "hero")!;
  p.editingAllowed = true;
  const before = characterSheet(p, t.holdings),
    next = structuredClone(before);
  next.equipment[0].equipped = false;
  editCharacter(t, hero, { purseId: p.id, before, sheet: next }, "sheet", Date.now());
  assert.equal(t.holdings.filter((h) => h.custody).length, 1);
  const forged = structuredClone(characterSheet(p, t.holdings));
  forged.equipment.push({ ...forged.equipment[0], id: t.holdings.find((h) => h.custody)!.id });
  assert.throws(
    () =>
      editCharacter(
        t,
        dm,
        { purseId: p.id, before: characterSheet(p, t.holdings), sheet: forged },
        "forged",
        Date.now(),
      ),
    /Unknown inventory/,
  );
});
test("staged construction reserves and consumes once, attaches a building without another deed", () => {
  let t = stored(fixture(), 4, true);
  t = command(t, { kind: "estate-job", before: null, job: job(t) });
  assert.equal(
    t.holdings.filter((h) => h.reservedFor).reduce((n, h) => n + h.quantity, 0),
    2,
  );
  t = advance(t, 1);
  assert.equal(t.journal!.propertyOperations!.jobs[0].progress, 100);
  t = command(t, { kind: "session", name: "Next session", end: true });
  t = advance(t, 1);
  assert.equal(t.journal!.propertyOperations!.jobs[0].status, "completed");
  assert.deepEqual(t.journal!.propertyOperations!.sites[0].completedTemplates, ["house"]);
  assert.equal(t.holdings.filter((h) => h.kind === "property").length, 1);
  assert.equal(
    t.holdings.filter((h) => h.materialKey).reduce((n, h) => n + h.quantity, 0),
    8,
  );
  assert.equal(
    t.holdings.some((h) => h.reservedFor),
    false,
  );
  assert.equal(toCopper(t.purses[0].coins), 10000);
});
test("labor allocation rejects double booking; cancelled projects release unconsumed inputs", () => {
  let t = stored(fixture(), 4, true);
  t = command(t, { kind: "estate-job", before: null, job: job(t) });
  assert.throws(
    () => command(t, { kind: "estate-job", before: null, job: job(t, "second") }),
    /full downtime day/,
  );
  const prior = t.journal!.propertyOperations!.jobs[0];
  t = command(t, { kind: "estate-job", before: prior, job: { ...prior, status: "cancelled" } });
  assert.equal(
    t.holdings.some((h) => h.reservedFor),
    false,
  );
  assert.equal(
    t.holdings.filter((h) => h.materialKey).reduce((n, h) => n + h.quantity, 0),
    10,
  );
});
test("paid labor uses available funds and stale property quotes cannot be applied", () => {
  let t = stored(fixture(), 4, true);
  t = command(t, {
    kind: "estate-job",
    before: null,
    job: job(t, "paid", { assignments: [], paidWorkers: 1 }),
  });
  t = advance(t, 2);
  assert.equal(t.journal!.propertyOperations!.jobs[0].paidCopper, 200);
  assert.equal(toCopper(t.purses[0].coins), 9800);
  const planned = command(stored(), { kind: "downtime-plan", name: "Review", days: 1 });
  const pending = planned.journal!.finance!.downtime[0];
  planned.holdings[1].quantity--;
  assert.throws(
    () =>
      command(planned, { kind: "session", name: "Session", end: false, downtimeId: pending.id }),
    /Recalculate/,
  );
});
test("players propose known recipes; checks and arbitrary yields require DM approval", () => {
  let t = stored();
  const site = t.journal!.propertyOperations!.sites[0];
  t = command(t, { kind: "estate-site", before: site, site: { ...site, templateKey: "land" } });
  const draft = job(t, "proposal", { purseId: "hero", status: "draft", approvedChecks: false });
  t = command(t, { kind: "estate-job", before: null, job: draft }, hero);
  assert.equal(t.journal!.propertyOperations!.jobs[0].status, "draft");
  assert.throws(
    () =>
      command(
        t,
        {
          kind: "estate-job",
          before: null,
          job: { ...draft, id: "cheat", recipe: { ...draft.recipe, laborDays: 1 } },
        },
        hero,
      ),
    /DM's recipe/,
  );
});
function manager(t: CloudTable) {
  return command(t, {
    kind: "estate-staff",
    before: null,
    staff: {
      id: "manager",
      propertyId: "warehouse",
      name: "Mira",
      role: "manager",
      wageCopper: 10,
      periodDays: 1,
      status: "active",
      manager: true,
      duties: ["deliveries", "supplies", "projects", "rent", "reports", "staff"],
      budgetCopper: 250,
      budgetPeriodDays: 30,
      budgetStartDay: 0,
      budgetSpentCopper: 0,
      notes: "Reviewed contract",
    },
  });
}
test("letters charge postage once, arrive on campaign days and require a real city post office", () => {
  let t = manager(fixture());
  t = command(
    t,
    {
      kind: "estate-letter",
      propertyId: "warehouse",
      senderId: "hero",
      managerId: "manager",
      budgetCopper: 0,
      order: { kind: "report" },
    },
    hero,
  );
  assert.equal(toCopper(t.purses.find((p) => p.id === "hero")!.coins), 990);
  t = advance(t, 1);
  assert.equal(t.journal!.propertyOperations!.letters[0].status, "in-transit");
  t = command(t, { kind: "session", name: "Next", end: true });
  t = advance(t, 1);
  assert.equal(t.journal!.propertyOperations!.letters[0].status, "delivered");
  assert.match(t.journal!.propertyOperations!.letters[0].receipt, /Party warehouse/);
  t = command(t, { kind: "party-location", before: "area", locationId: null });
  assert.throws(
    () =>
      command(
        t,
        {
          kind: "estate-letter",
          propertyId: "warehouse",
          senderId: "hero",
          managerId: "manager",
          budgetCopper: 0,
          order: { kind: "report" },
        },
        hero,
      ),
    /Visit a city/,
  );
});
test("manager supply orders use reviewed stock, budgets and non-carried shipment custody", () => {
  let t = manager(fixture());
  t = command(t, {
    kind: "estate-supplier",
    before: null,
    supplier: {
      id: "supplier",
      propertyId: "warehouse",
      stockId: "stock",
      materialKey: "timber",
      deliveryDays: 1,
      deliveryCopper: 10,
      weight: 2,
    },
  });
  t = command(
    t,
    {
      kind: "estate-letter",
      propertyId: "warehouse",
      senderId: "hero",
      managerId: "manager",
      budgetCopper: 250,
      order: {
        kind: "supply",
        stockId: "stock",
        materialKey: "timber",
        quantity: 2,
        deliveryDays: 1,
        deliveryCopper: 10,
      },
    },
    hero,
  );
  t = command(t, { kind: "party-location", before: "area", locationId: "far" });
  t = advance(t, 2);
  assert.equal(t.stock[0].quantity, 18);
  assert.equal(t.journal!.propertyOperations!.staff[0].budgetSpentCopper, 210);
  assert.equal(t.holdings.find((h) => h.custody?.kind === "transit")!.quantity, 2);
  t = command(t, { kind: "session", name: "Next", end: true });
  t = advance(t, 1);
  assert.equal(t.journal!.propertyOperations!.shipments[0].status, "delivered");
  assert.equal(t.holdings.filter((h) => h.custody?.kind === "property").length, 1);
});

function supplierMarket() {
  const t = fixture(), market = tradeFixture();
  t.realm = market.realm;
  t.purses.push(structuredClone(market.purses.find((p) => p.id === "exchange-treasury")!));
  t.journal!.tradeEconomy = structuredClone(market.journal!.tradeEconomy!);
  t.journal!.tradeEconomy.exchanges[0].locationId = "city";
  t.journal!.tradeEconomy.commodities[0].name = "Construction bundles";
  t.shops[0].sellRate = 1.5;
  t.stock[0].commodityId = "timber";
  t.stock[0].tradeExchangeId = "harbor";
  return command(t, {
    kind: "estate-supplier", before: null,
    supplier: { id: "supplier", propertyId: "warehouse", stockId: "stock",
      materialKey: "timber", deliveryDays: 1, deliveryCopper: 10, weight: 2 },
  });
}
const deliveryOrder = {
  kind: "estate-delivery" as const, propertyId: "warehouse", purseId: "party",
  stockId: "stock", quantity: 2, materialKey: "timber", deliveryDays: 1, deliveryCopper: 10,
};
function settleSupplierDays(t: CloudTable, days: number, advanceSeason = false) {
  const planned = applyCommand(t, dm, { id: `supplier-season-${++receipt}`, kind: "downtime-plan",
    name: "Supplier settlement", days, advanceSeason }, { source: "server", random: () => 50 });
  return command(planned, { kind: "downtime-apply", downtimeId: planned.journal!.finance!.downtime.at(-1)!.id,
    endSession: false });
}
function supplierManager(t = supplierMarket(), budgetCopper = 1000) {
  t = manager(t);
  const staff = t.journal!.propertyOperations!.staff[0];
  return command(t, { kind: "estate-staff", before: staff, staff: { ...staff, budgetCopper } });
}
function standingSupply(t: CloudTable, budgetCopper = 310) {
  return command(t, { kind: "estate-order", before: null,
    order: { id: "supply-order", propertyId: "warehouse", managerId: "manager",
      order: { kind: "supply", stockId: "stock", quantity: 2, materialKey: "timber",
        deliveryDays: 1, deliveryCopper: 10 },
      budgetCopper, periodDays: 30, nextDay: 1, active: true, receipt: "" } });
}

test("supplier purchases keep one canonical commodity lot and goods-only demand through arrival, backup and sale", () => {
  const original = supplierMarket(), before = canonicalJson(original);
  let t = command(original, deliveryOrder);
  assert.equal(canonicalJson(original), before);
  assert.equal(toCopper(t.purses.find((p) => p.id === "party")!.coins), 9690);
  assert.equal(t.stock[0].quantity, 18);
  const lot = t.holdings.find((h) => h.custody?.kind === "transit")!;
  assert.equal(lot.commodityId, "timber");
  assert.equal(lot.materialKey, "timber");
  assert.equal(lot.weight, 2);
  assert.equal(lot.unitCopper, 150);
  assert.equal(lot.quantity, 2);
  const receipt = t.journal!.tradeEconomy!.receipts[0];
  assert.equal(receipt.copper, 300);
  assert.equal(receipt.quantity, 2);
  assert.equal(receipt.propertyId, "warehouse");
  assert.equal(t.ledger.find((l) => l.id === receipt.id)!.copper, -310);
  assert.deepEqual(t.ledger.find((l) => l.id === receipt.id)!.trade, { receiptId: receipt.id, leg: "owner" });
  t = settleSupplierDays(t, 1);
  const restored = readCloudTable(JSON.parse(JSON.stringify(t)));
  assert.ok(restored, "complete delivered campaign remains loadable");
  t = restored;
  assert.equal(t.holdings.find((h) => h.id === lot.id)!.custody?.kind, "property");
  assert.equal(t.holdings.find((h) => h.id === lot.id)!.quantity, 2);
  assert.equal(t.journal!.propertyOperations!.shipments[0].status, "delivered");
  assert.equal(t.journal!.tradeEconomy!.receipts.length, 1);
  assert.equal(t.stock[0].quantity, 18);
  const economy = t.journal!.tradeEconomy!;
  t = command(t, { kind: "trade-sell", exchangeId: "harbor", commodityId: "timber",
    holdingId: lot.id, quantity: 2, before: exchangeQuoteKey(economy, economy.exchanges[0], economy.commodities[0]) });
  assert.equal(t.holdings.some((h) => h.id === lot.id), false);
  assert.equal(toCopper(t.purses.find((p) => p.id === "party")!.coins), 9810);
  assert.equal(toCopper(t.purses.find((p) => p.id === "exchange-treasury")!.coins), 49880);
  assert.equal(t.journal!.tradeEconomy!.exchanges[0].offers[0].stock, 102);
  assert.deepEqual(t.journal!.tradeEconomy!.receipts.map((r) => [r.direction, r.quantity]), [["buy", 2], ["sell", 2]]);
});

test("supplier identity uses reviewed material keys or explicit links, never names or an enabled-economy assumption", () => {
  const unlinked = supplierMarket();
  delete unlinked.stock[0].commodityId;
  delete unlinked.stock[0].tradeExchangeId;
  const identified = command(unlinked, deliveryOrder);
  assert.equal(identified.holdings.find((h) => h.custody)?.commodityId, "timber");
  assert.equal(identified.journal!.tradeEconomy!.receipts.length, 0, "material identity alone does not invent exchange activity");
  const disabled = supplierMarket();
  disabled.journal!.tradeEconomy!.settings.enabled = false;
  const inactive = command(disabled, deliveryOrder);
  assert.equal(inactive.holdings.find((h) => h.custody)?.commodityId, "timber");
  assert.equal(inactive.journal!.tradeEconomy!.receipts.length, 0);
  const named = structuredClone(unlinked);
  delete named.journal!.tradeEconomy!.commodities[0].materialKey;
  named.journal!.tradeEconomy!.commodities[0].name = named.stock[0].name;
  const ordinary = command(named, deliveryOrder);
  assert.equal(ordinary.holdings.find((h) => h.custody)?.commodityId, undefined);
});

test("supplier identity conflicts, funds, stock and player delivery terms reject without partial assets or demand", () => {
  for (const scenario of ["identity", "unit", "funds", "stock", "player"] as const) {
    const t = supplierMarket();
    if (scenario === "identity") {
      t.journal!.tradeEconomy!.commodities.push({ ...t.journal!.tradeEconomy!.commodities[0], id: "other-bundles", materialKey: undefined });
      t.stock[0].commodityId = "other-bundles";
    }
    if (scenario === "unit") {
      delete t.journal!.tradeEconomy!.commodities[0].materialKey;
      t.journal!.tradeEconomy!.commodities[0].unit = "crate";
    }
    if (scenario === "funds") t.purses[0].coins.cp = 309;
    if (scenario === "stock") t.stock[0].quantity = 1;
    const before = canonicalJson(t);
    assert.throws(() => command(t, deliveryOrder, scenario === "player" ? hero : dm),
      scenario === "identity" || scenario === "unit" ? /conflicts/ : scenario === "funds" ? /funds|enough/i : scenario === "stock" ? /quantity/ : /assigned|Only the DM/);
    assert.equal(canonicalJson(t), before, scenario);
  }
});

test("supplier pricing applies the actual shop rate and black-market premium before one Charisma discount", () => {
  let t = supplierMarket();
  t.shops[0].blackMarket = true;
  t.shops[0].blackMarketPremium = 2;
  const sheet = blankSheet();
  sheet.scores.cha = 20;
  t.purses.find((p) => p.id === "hero")!.sheet = sheet;
  assert.throws(() => command(t, { ...deliveryOrder, purseId: "hero" }), /open shop/);
  t = command(t, { kind: "black-market", before: false, active: true });
  t = command(t, { ...deliveryOrder, purseId: "hero" });
  assert.equal(toCopper(t.purses.find((p) => p.id === "hero")!.coins), 450, "2 × (100 × 1.5 × 2 × 90%) + 10 delivery");
  assert.equal(t.holdings.find((h) => h.custody)!.unitCopper, 270);
  assert.equal(t.journal!.tradeEconomy!.receipts[0].copper, 540);
});

test("standing supplier orders budget the full configured price and enter the same seasonal proposal once", () => {
  let t = standingSupply(supplierManager());
  const planned = applyCommand(t, dm, { id: `supplier-season-${++receipt}`, kind: "downtime-plan",
    name: "Supply and season", days: 1, advanceSeason: true }, { source: "server", random: () => 50 });
  const pending = planned.journal!.finance!.downtime.at(-1)!;
  assert.deepEqual(pending.quote.tradeSeason!.feedback, [{ exchangeId: "harbor", commodityId: "timber", bought: 2, sold: 0 }]);
  assert.equal(t.stock[0].quantity, 20, "preview leaves live inventory untouched");
  t = command(planned, { kind: "downtime-apply", downtimeId: pending.id, endSession: false });
  assert.equal(t.journal!.propertyOperations!.staff[0].budgetSpentCopper, 310);
  assert.equal(toCopper(t.purses[0].coins), 9680, "purchase plus one wage payment");
  const tradeReceipt = t.journal!.tradeEconomy!.receipts[0];
  const line = t.ledger.find((l) => l.trade?.receiptId === tradeReceipt.id)!;
  assert.ok(line.id !== tradeReceipt.id, "finance remaps the ledger id without rewriting the market receipt");
  assert.equal(line.copper, -310);
  assert.equal(tradeReceipt.copper, 300);
  assert.equal(t.journal!.tradeEconomy!.epoch, 1);
  t = settleSupplierDays(t, 1, true);
  assert.equal(t.journal!.propertyOperations!.shipments[0].status, "delivered");
  assert.equal(t.journal!.tradeEconomy!.receipts.length, 1);
  assert.deepEqual(t.journal!.tradeEconomy!.history[1].quote.feedback, [{ exchangeId: "harbor", commodityId: "timber", bought: 0, sold: 0 }]);
  assert.ok(readCloudTable(t));
});

test("manager supplier failures retain stock, goods and demand while recording the blocked order and wages", () => {
  for (const scenario of ["order-budget", "manager-budget", "funds", "stock", "identity"] as const) {
    let t = standingSupply(supplierManager(undefined, scenario === "manager-budget" ? 300 : 1000), scenario === "order-budget" ? 300 : 310);
    if (scenario === "funds") t.purses[0].coins.cp = 310;
    if (scenario === "stock") t.stock[0].quantity = 1;
    if (scenario === "identity") {
      delete t.journal!.tradeEconomy!.commodities[0].materialKey;
      t.journal!.tradeEconomy!.commodities[0].unit = "crate";
    }
    const beforeStock = t.stock[0].quantity, beforeMoney = toCopper(t.purses[0].coins);
    t = settleSupplierDays(t, 1);
    assert.match(t.journal!.propertyOperations!.standingOrders[0].receipt, /budget|funds|enough|quantity|conflicts/i, scenario);
    assert.equal(toCopper(t.purses[0].coins), beforeMoney - 10, scenario);
    assert.equal(t.stock[0].quantity, beforeStock, scenario);
    assert.equal(t.holdings.some((h) => h.custody), false, scenario);
    assert.equal(t.journal!.propertyOperations!.shipments.length, 0, scenario);
    assert.equal(t.journal!.propertyOperations!.staff[0].budgetSpentCopper, 0, scenario);
    assert.equal(t.journal!.tradeEconomy!.receipts.length, 0, scenario);
  }
});

test("postal supplier purchases retain the reviewed cost, one postage payment and one demand receipt", () => {
  let t = supplierManager();
  t = command(t, { kind: "estate-letter", propertyId: "warehouse", senderId: "hero", managerId: "manager",
    budgetCopper: 310, order: { kind: "supply", stockId: "stock", quantity: 2, materialKey: "timber",
      deliveryDays: 1, deliveryCopper: 10 } }, hero);
  t = command(t, { kind: "party-location", before: "area", locationId: "far" });
  t = settleSupplierDays(t, 2);
  assert.equal(toCopper(t.purses.find((p) => p.id === "hero")!.coins), 990);
  assert.equal(toCopper(t.purses[0].coins), 9670, "two wages and the purchase");
  assert.equal(t.journal!.propertyOperations!.letters[0].status, "delivered");
  assert.equal(t.journal!.propertyOperations!.staff[0].budgetSpentCopper, 310);
  assert.equal(t.journal!.tradeEconomy!.receipts[0].copper, 300);
  t = settleSupplierDays(t, 1);
  assert.equal(t.journal!.propertyOperations!.shipments[0].status, "delivered");
  assert.equal(t.journal!.tradeEconomy!.receipts.length, 1);
  assert.equal(t.stock[0].quantity, 18);
  assert.equal(t.holdings.filter((h) => h.custody).length, 1);
});

test("blocked arrival and an approved retry move the existing goods without charging or recording demand again", () => {
  let t = supplierMarket();
  t.journal!.propertyOperations!.sites[0].capacityWeight = 3;
  t = command(t, deliveryOrder);
  const lotId = t.holdings.find((h) => h.custody)!.id;
  t = settleSupplierDays(t, 1);
  assert.equal(t.journal!.propertyOperations!.shipments[0].status, "blocked");
  t = readCloudTable(JSON.parse(JSON.stringify(t)))!;
  assert.ok(t);
  const site = t.journal!.propertyOperations!.sites[0];
  t = command(t, { kind: "estate-site", before: site, site: { ...site, capacityWeight: 4 } });
  t = command(t, { kind: "estate-shipment", shipmentId: t.journal!.propertyOperations!.shipments[0].id,
    action: "retry", override: false });
  t = settleSupplierDays(t, 1);
  assert.equal(t.journal!.propertyOperations!.shipments[0].status, "delivered");
  assert.equal(t.holdings.find((h) => h.id === lotId)!.custody?.kind, "property");
  assert.equal(t.holdings.find((h) => h.id === lotId)!.quantity, 2);
  assert.equal(toCopper(t.purses[0].coins), 9690);
  assert.equal(t.stock[0].quantity, 18);
  assert.equal(t.journal!.tradeEconomy!.receipts.length, 1);
});
test("unreviewed remote delivery terms and wage arrears block manager execution", () => {
  let t = manager(fixture());
  t.purses[0].coins.cp = 0;
  t = command(
    t,
    {
      kind: "estate-letter",
      propertyId: "warehouse",
      senderId: "hero",
      managerId: "manager",
      budgetCopper: 1000,
      order: {
        kind: "supply",
        stockId: "stock",
        materialKey: "timber",
        quantity: 1,
        deliveryDays: 0,
        deliveryCopper: 0,
      },
    },
    hero,
  );
  t = advance(t, 2);
  assert.equal(t.journal!.propertyOperations!.letters[0].status, "blocked");
  assert.match(t.journal!.propertyOperations!.letters[0].receipt, /wage/);
  assert.equal(t.stock[0].quantity, 20);
  assert.equal(t.journal!.finance!.rules[0].arrears, 20);
});
test("rental income uses existing schedules and occupancy gates without altering generic income", () => {
  let t = fixture();
  const site = t.journal!.propertyOperations!.sites[0];
  t = command(t, { kind: "estate-site", before: site, site: { ...site, templateKey: "house" } });
  t = command(t, {
    kind: "estate-rent",
    before: null,
    rental: {
      propertyId: "warehouse",
      tenant: "Tenant",
      occupied: false,
      active: true,
      incomeCopper: 300,
      upkeepCopper: 30,
      periodDays: 1,
      notes: "",
    },
  });
  let q = previewDowntime(t, t.journal!.finance!, 1);
  assert.equal(
    q.lines.some((l) => l.kind === "income"),
    false,
  );
  assert.equal(q.lines.find((l) => l.kind === "expense")!.paid, 30);
  const prior = t.journal!.propertyOperations!.rentals[0];
  t = command(t, { kind: "estate-rent", before: prior, rental: { ...prior, occupied: true } });
  q = previewDowntime(t, t.journal!.finance!, 1);
  assert.equal(q.lines.find((l) => l.kind === "income")!.paid, 300);
  t = command(t, {
    kind: "finance-rule",
    rule: {
      id: "old",
      purseId: "party",
      name: "Legacy revenue",
      kind: "income",
      copper: 5,
      periodDays: 1,
      holdingId: "",
      active: true,
    },
  });
  assert.equal(
    previewDowntime(t, t.journal!.finance!, 1).lines.find((l) => l.id === "old")!.paid,
    5,
  );
});
test("shared projections expose authorized stash records and redact unrelated character finances", () => {
  const t = stored();
  t.journal!.events.push({
    id: "private-operation",
    at: 1,
    kind: "request",
    propertyId: "unrelated-property",
    summary: "Private owner's withdrawal request",
  });
  t.journal!.events.push({
    id: "public-event",
    at: 1,
    kind: "management",
    summary: "Campaign announcement",
  });
  const view = projectRecord(t, hero);
  assert.equal(
    view.journal!.events.some((e) => e.id === "private-operation"),
    false,
  );
  assert.equal(
    view.journal!.events.some((e) => e.id === "public-event"),
    true,
  );
  assert.equal(
    view.holdings.some((h) => h.id === "warehouse"),
    true,
  );
  assert.equal(
    view.holdings.some((h) => h.id === "secret"),
    false,
  );
  assert.equal(toCopper(view.purses.find((p) => p.id === "party")!.coins), 0);
  assert.ok(readCloudTable(view));
  assert.ok(
    view.journal!.events.some((e) => e.propertyId === "warehouse" && /stored/.test(e.summary)),
  );
  const unauthorized = projectRecord(t, { ...hero, purseIds: [] });
  assert.equal(unauthorized.holdings.length, 0);
  assert.equal(
    unauthorized.journal!.events.some((e) => e.propertyId),
    false,
  );
  archiveSession(t, "archive", "Session");
  const parsed = readArchivedSnapshot(t.journal!.reports![0].snapshot);
  assert.equal(parsed.holdings.filter((h) => h.custody).length, 1);
  assert.ok(
    preserveJournalMetadata({ sessions: [], events: [], requests: [] }, t.journal!)
      .propertyOperations,
  );
});
test("disposal blocks obligations; explicit DM handover preserves contents and pauses orders", () => {
  let t = manager(stored());
  assert.throws(
    () => command(t, { kind: "sell", holdingId: "warehouse", quantity: 1, shopId: "shop" }),
    /Resolve stored goods/,
  );
  t = command(t, {
    kind: "estate-handover",
    propertyId: "warehouse",
    toId: "other",
    reason: "Reviewed estate transfer",
  });
  assert.equal(t.holdings.find((h) => h.id === "warehouse")!.purseId, "other");
  assert.equal(t.holdings.find((h) => h.custody)!.purseId, "hero");
  assert.equal(t.journal!.finance!.rules[0].purseId, "other");
});
test("strict imports reject invalid references and create reviewed inactive configurations atomically", () => {
  const doc = JSON.parse(
      readFileSync(
        new URL("../../../docs/examples/property-operations.sample.json", import.meta.url),
        "utf8",
      ),
    ),
    t = fixture();
  assert.ok(estateImportSchema.safeParse(doc).success);
  assert.equal(estateImportSchema.safeParse({ ...doc, surprise: true }).success, false);
  const invalid = structuredClone(doc);
  invalid.templates[2].recipes[0].materials[0].materialKey = "missing";
  assert.equal(estateImportSchema.safeParse(invalid).success, false);
  // An existing differently defined template is deliberately never overwritten by an import.
  assert.throws(
    () => previewEstateImport(t, doc, { "party-treasury": "party" }, {}, "import"),
    /already (exists|has)/,
  );
  t.journal!.propertyOperations = readEstate();
  const next = command(t, {
    kind: "estate-import",
    before: estateImportFingerprint(t),
    document: doc,
    owners: { "party-treasury": "party" },
    locations: {},
  });
  assert.equal(next.holdings.length, t.holdings.length + 1);
  assert.equal(next.listings.length, 3);
  assert.equal(next.journal!.propertyOperations!.sites[0].enabled, false);
  assert.equal(next.ledger.length, 0);
  assert.equal(next.holdings.at(-1)!.deed, undefined);
  assert.throws(
    () =>
      command(next, {
        kind: "estate-import",
        before: estateImportFingerprint(t),
        document: doc,
        owners: { "party-treasury": "party" },
        locations: {},
      }),
    /fresh property import preview/,
  );
});
test("offline commands and approved sessions persist consumed materials and retain valid backups", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(stored(fixture(), 4, true));
  const t = await economySnapshot();
  await executeLocalCommand({ kind: "estate-job", before: null, job: job(t) });
  await executeFinanceCommand({ kind: "downtime-plan", name: "Offline work", days: 2 });
  const planned = await economySnapshot();
  await executeFinanceCommand({
    kind: "session",
    name: "Offline next",
    end: false,
    downtimeId: planned.journal!.finance!.downtime.find((d) => d.status === "pending")!.id,
  });
  const result = await economySnapshot();
  assert.equal(result.journal!.propertyOperations!.jobs[0].status, "completed");
  assert.equal(
    result.holdings.some((h) => h.reservedFor),
    false,
  );
  assert.ok(readQuireFile(await snapshot()));
});
