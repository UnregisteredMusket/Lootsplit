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
