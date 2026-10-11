import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, readCloudTable, type CloudTable, type CloudSeat } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readJournal, preserveJournalMetadata, readArchivedSnapshot } from "./journal.ts";
import { defaultShip, shipStatsSchema, type ShipVoyage, type Vessel } from "./ships-schema.ts";
import { shipFingerprint, shipHere } from "./ships.ts";
import { readFinance, previewDowntime } from "./finance.ts";
import { estatePreset } from "./estate-catalogue.ts";
import { projectRecord } from "./session-records.ts";
import { toCopper } from "./money.ts";
const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = {
  id: "player",
  token: "player",
  name: "Hero",
  role: "player",
  purseIds: ["hero"],
};
let sequence = 0;
const run = (t: CloudTable, c: CommandInput, seat = dm) =>
  applyCommand(t, seat, { ...c, id: `ships-${++sequence}` });
function fixture() {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      {
        id: "party",
        name: "Treasury",
        kind: "party",
        coins: { cp: 100000, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
      {
        id: "hero",
        name: "Hero",
        kind: "character",
        coins: { cp: 10000, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
      {
        id: "other",
        name: "Other",
        kind: "character",
        coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    ],
    holdings: [
      {
        id: "ship",
        name: "Dawn Trader",
        kind: "property",
        quantity: 1,
        unitCopper: 10000,
        purseId: "party",
        notes: "",
        locationId: "port",
        property: { type: "other" },
      },
      {
        id: "goods",
        name: "Trade timber",
        kind: "item",
        quantity: 10,
        unitCopper: 100,
        purseId: "hero",
        notes: "",
        weight: 5,
      },
    ],
    journal: readJournal({
      finance: readFinance(),
      market: {
        currentLocationId: "port",
        locations: [
          { id: "region", name: "Coast", kind: "region", parentId: null, description: "" },
          { id: "port", name: "Port", kind: "city", parentId: "region", description: "" },
          { id: "far", name: "Far Port", kind: "city", parentId: "region", description: "" },
        ],
      },
    }),
  };
  const vessel: Vessel = {
    ...defaultShip(),
    propertyId: "ship",
    mode: "docked",
    facilityId: null,
    installed: [],
    arrearsCopper: 0,
    expenseRemainder: 0,
    dmNotes: "secret DM ship notes",
  };
  t = run(t, { kind: "ship-configure", before: null, vessel });
  t = run(t, {
    kind: "ship-facility",
    before: null,
    facility: {
      id: "yard",
      propertyId: null,
      name: "Port Shipyard",
      locationId: "port",
      public: true,
      accessPurseIds: [],
      slots: 2,
      maxLengthFeet: 200,
      maxDimensions: "Large vessels",
      dockCopper: 20,
      dryCopper: 10,
      yardCopper: 30,
      repair: true,
      upgrades: true,
    },
  });
  return t;
}
const vessel = (t: CloudTable) => t.journal!.fleet!.vessels[0];
function aboard(t: CloudTable, id = "hero") {
  return run(t, {
    kind: "ship-board",
    propertyId: "ship",
    purseId: id,
    action: "board",
    before: shipFingerprint(t, "ship"),
  });
}
function voyage(t: CloudTable, duration = 3 * 1440): ShipVoyage {
  return {
    id: `voyage-${++sequence}`,
    propertyId: "ship",
    originId: "port",
    destinationId: "far",
    destinationFacilityId: null,
    durationMinutes: duration,
    elapsedMinutes: 0,
    budgetCopper: 10000,
    spentCopper: 0,
    travelExpenseRemainder: 0,
    payerId: "party",
    captainId: null,
    crewPurseIds: ["hero"],
    status: "proposed",
    message: "",
    requestedBy: "dm",
    routeVersion: 1,
    routeNotes: "Across the bay",
  };
}
function sail(t: CloudTable, duration = 3 * 1440) {
  t = aboard(t);
  const v = voyage(t, duration);
  t = run(t, { kind: "ship-voyage", before: null, voyage: v });
  return run(t, {
    kind: "ship-voyage",
    before: t.journal!.fleet!.voyages[0],
    voyage: { ...t.journal!.fleet!.voyages[0], status: "active" },
  });
}
function days(t: CloudTable, n: number) {
  t = run(t, { kind: "downtime-plan", name: "Ship downtime", days: n });
  return run(t, {
    kind: "downtime-apply",
    endSession: false,
    downtimeId: t.journal!.finance!.downtime.at(-1)!.id,
  });
}
test("ships use three physical abilities and reject mental abilities and invalid component HP", () => {
  const stats = defaultShip().stats;
  assert.equal(shipStatsSchema.safeParse({ ...stats, wis: 0 }).success, false);
  assert.equal(
    shipStatsSchema.safeParse({ ...stats, components: [...stats.components, stats.components[0]] })
      .success,
    false,
  );
  assert.equal(
    shipStatsSchema.safeParse({ ...stats, components: [{ ...stats.components[0], hp: 201 }] })
      .success,
    false,
  );
});
test("ship configuration preserves legacy saves and synchronizes canonical cargo capacity", () => {
  const t = fixture();
  assert.equal(t.journal!.propertyOperations!.sites[0].capacityWeight, 10000);
  assert.ok(readCloudTable(t));
  assert.ok(readCloudTable({ ...emptyCloudTable(), journal: readJournal({}) }));
  assert.deepEqual(preserveJournalMetadata({}, t.journal!).fleet, t.journal!.fleet);
});
test("players cannot configure, damage or teleport ships; failures are atomic", () => {
  const t = fixture(),
    before = JSON.stringify(t);
  assert.throws(
    () => run(t, { kind: "ship-configure", before: vessel(t), vessel: vessel(t) }, player),
    /Only the DM/,
  );
  assert.throws(
    () =>
      run(
        t,
        {
          kind: "ship-damage",
          propertyId: "ship",
          componentId: "hull",
          damage: 30,
          before: shipFingerprint(t, "ship"),
          reason: "",
        },
        player,
      ),
    /Only the DM/,
  );
  assert.throws(
    () =>
      run(
        t,
        {
          kind: "ship-teleport",
          propertyId: "ship",
          destinationId: "far",
          facilityId: null,
          before: shipFingerprint(t, "ship"),
          reason: "",
        },
        player,
      ),
    /Only the DM/,
  );
  assert.equal(JSON.stringify(t), before);
});
test("damage thresholds apply the full qualifying damage and never deduct the threshold", () => {
  let t = fixture();
  t = run(t, {
    kind: "ship-damage",
    propertyId: "ship",
    componentId: "hull",
    damage: 9,
    before: shipFingerprint(t, "ship"),
    reason: "",
  });
  assert.equal(vessel(t).stats.components[0].hp, 200);
  t = run(t, {
    kind: "ship-damage",
    propertyId: "ship",
    componentId: "hull",
    damage: 10,
    before: shipFingerprint(t, "ship"),
    reason: "",
  });
  assert.equal(vessel(t).stats.components[0].hp, 190);
});
test("cargo retains its lot/owner, stays unavailable remotely and cannot exceed ship capacity", () => {
  let t = fixture();
  assert.equal(
    shipHere(t, t.holdings[0], "party"),
    true,
    "The treasury uses the party's port, so a DM can choose the receiving character.",
  );
  t = run(
    t,
    {
      kind: "estate-storage",
      propertyId: "ship",
      holdingId: "goods",
      quantity: 4,
      direction: "deposit",
      purseId: "hero",
      override: false,
      donate: false,
    },
    player,
  );
  const cargo = t.holdings.find((h) => h.custody?.propertyId === "ship")!;
  assert.equal(cargo.purseId, "hero");
  assert.equal(
    t.holdings.filter((h) => h.name === "Trade timber").reduce((n, h) => n + h.quantity, 0),
    10,
  );
  const old = vessel(t);
  assert.throws(
    () =>
      run(t, {
        kind: "ship-configure",
        before: old,
        vessel: { ...old, stats: { ...old.stats, cargoWeight: 19 } },
      }),
    /capacity/,
  );
  t = run(t, { kind: "party-location", before: "port", locationId: "far" });
  assert.throws(
    () =>
      run(
        t,
        {
          kind: "estate-storage",
          propertyId: "ship",
          holdingId: cargo.id,
          quantity: 1,
          direction: "withdraw",
          purseId: "hero",
          override: false,
          donate: false,
        },
        player,
      ),
    /must be/,
  );
});
test("boarding proposals affect only the assigned character and require reviewed current access", () => {
  let t = fixture();
  assert.throws(
    () =>
      run(
        t,
        {
          kind: "ship-board",
          propertyId: "ship",
          purseId: "other",
          action: "board",
          before: shipFingerprint(t, "ship"),
        },
        player,
      ),
    /assigned/,
  );
  t = run(
    t,
    {
      kind: "ship-board",
      propertyId: "ship",
      purseId: "hero",
      action: "board",
      before: shipFingerprint(t, "ship"),
    },
    player,
  );
  assert.equal(t.journal!.world?.characterPositions.length ?? 0, 0);
  const r = t.journal!.fleet!.boarding[0];
  t = run(t, { kind: "ship-board-review", requestId: r.id, before: r, approve: true });
  assert.equal(t.journal!.fleet!.aboard[0].propertyId, "ship");
  assert.equal(t.journal!.world!.characterPositions[0].inParty, false);
  assert.equal(shipHere(t, t.holdings[0], "hero"), true);
  assert.throws(
    () => run(t, { kind: "ship-board-review", requestId: r.id, before: r, approve: true }),
    /already reviewed/,
  );
});
test("aboard characters retain party-ship storage access while another party location changes", () => {
  let t = aboard(fixture());
  t = run(t, { kind: "party-location", before: "port", locationId: "far" });
  t = run(
    t,
    {
      kind: "estate-storage",
      propertyId: "ship",
      holdingId: "goods",
      quantity: 1,
      direction: "deposit",
      purseId: "hero",
      override: false,
      donate: false,
    },
    player,
  );
  assert.ok(t.holdings.some((h) => h.custody?.propertyId === "ship"));
});
test("DM teleport atomically moves ship and aboard characters with cargo unchanged and no time/cost", () => {
  let t = aboard(fixture());
  t = run(
    t,
    {
      kind: "estate-storage",
      propertyId: "ship",
      holdingId: "goods",
      quantity: 10,
      direction: "deposit",
      purseId: "hero",
      override: false,
      donate: false,
    },
    player,
  );
  const goods = t.holdings.filter((h) => h.kind === "item"),
    coins = t.purses.map((p) => p.coins),
    day = t.journal!.finance!.day;
  t = run(t, {
    kind: "ship-teleport",
    propertyId: "ship",
    destinationId: "far",
    facilityId: null,
    before: shipFingerprint(t, "ship"),
    reason: "Magic portal",
  });
  assert.equal(t.holdings[0].locationId, "far");
  assert.equal(t.journal!.world!.characterPositions[0].locationId, "far");
  assert.deepEqual(
    t.holdings.filter((h) => h.kind === "item"),
    goods,
  );
  assert.deepEqual(
    t.purses.map((p) => p.coins),
    coins,
  );
  assert.equal(t.journal!.finance!.day, day);
  assert.ok(t.journal!.events.some((e) => e.summary.includes("Magic portal")));
});
test("travel requires DM approval, minimum crew, an afloat ship and intact critical components", () => {
  let t = fixture();
  const v = voyage(t);
  assert.throws(
    () =>
      run(
        t,
        { kind: "ship-voyage", before: null, voyage: { ...v, status: "active", payerId: "hero" } },
        player,
      ),
    /Propose/,
  );
  assert.throws(
    () => run(t, { kind: "ship-voyage", before: null, voyage: { ...v, status: "active" } }),
    /aboard/,
  );
  t = run(t, {
    kind: "ship-berth",
    propertyId: "ship",
    facilityId: "yard",
    mode: "dry-storage",
    before: shipFingerprint(t, "ship"),
  });
  t = aboard(t);
  assert.throws(
    () => run(t, { kind: "ship-voyage", before: null, voyage: { ...v, status: "active" } }),
    /Launch/,
  );
  t = run(t, {
    kind: "ship-berth",
    propertyId: "ship",
    facilityId: "yard",
    mode: "docked",
    before: shipFingerprint(t, "ship"),
  });
  t = run(t, {
    kind: "ship-damage",
    propertyId: "ship",
    componentId: "hull",
    damage: 1000,
    before: shipFingerprint(t, "ship"),
    reason: "",
  });
  assert.throws(
    () => run(t, { kind: "ship-voyage", before: null, voyage: { ...v, status: "active" } }),
    /Repair/,
  );
});
test("approved downtime advances a partial voyage once and then arrives; ashore characters stay", () => {
  let t = sail(fixture());
  assert.equal(t.holdings[0].locationId, undefined);
  assert.equal(t.journal!.world!.characterPositions[0].locationId, null);
  t = days(t, 1);
  assert.equal(t.journal!.fleet!.voyages[0].elapsedMinutes, 1440);
  assert.equal(vessel(t).mode, "sailing");
  t = days(t, 2);
  assert.equal(vessel(t).mode, "docked");
  assert.equal(t.holdings[0].locationId, "far");
  assert.equal(t.journal!.world!.characterPositions[0].locationId, "far");
  assert.equal(
    t.journal!.world!.characterPositions.some((s) => s.purseId === "other"),
    false,
  );
  assert.throws(
    () =>
      run(t, {
        kind: "downtime-apply",
        endSession: false,
        downtimeId: t.journal!.finance!.downtime.at(-1)!.id,
      }),
    /already/,
  );
});
test("session clock preview cannot progress downtime-only voyages", () => {
  const t = sail(fixture());
  const q = previewDowntime(t, t.journal!.finance!, 1, {
    minutes: 1440,
    allowCharacterWork: false,
    receiptId: "hours",
  });
  assert.equal(q.propertyOperations!.fleet!.voyages[0].elapsedMinutes, 0);
});
test("arrival splits sailing/docked costs within a day and subsequent mooring costs", () => {
  let t = fixture();
  const old = vessel(t);
  t = run(t, {
    kind: "ship-configure",
    before: old,
    vessel: { ...old, sailingCopper: 100, dockedCopper: 20 },
  });
  t = sail(t, 720);
  const before = toCopper(t.purses[0].coins);
  t = days(t, 2);
  assert.equal(before - toCopper(t.purses[0].coins), 80);
  assert.equal(t.journal!.fleet!.voyages[0].spentCopper, 50);
});
test("insufficient travel budget blocks progress and damage can be bypassed by teleport", () => {
  let t = sail(fixture());
  const old = vessel(t);
  t = run(t, { kind: "ship-configure", before: old, vessel: { ...old, sailingCopper: 20000 } });
  t = days(t, 1);
  assert.equal(t.journal!.fleet!.voyages[0].elapsedMinutes, 0);
  assert.match(t.journal!.fleet!.voyages[0].message, /budget/);
  t = run(t, {
    kind: "ship-damage",
    propertyId: "ship",
    componentId: "hull",
    damage: 1000,
    before: shipFingerprint(t, "ship"),
    reason: "",
  });
  const before = toCopper(t.purses[0].coins);
  t = run(t, {
    kind: "ship-teleport",
    propertyId: "ship",
    destinationId: "far",
    facilityId: null,
    before: shipFingerprint(t, "ship"),
    reason: "DM",
  });
  assert.equal(t.journal!.fleet!.voyages[0].status, "dm-overridden");
  assert.equal(toCopper(t.purses[0].coins), before);
  assert.equal(vessel(t).stats.components[0].hp, 0);
});
test("facility capacity and ship length reject incompatible berths and no partial move occurs", () => {
  let t = fixture();
  const yard = t.journal!.fleet!.facilities[0];
  t = run(t, { kind: "ship-facility", before: yard, facility: { ...yard, maxLengthFeet: 30 } });
  assert.throws(
    () =>
      run(t, {
        kind: "ship-berth",
        propertyId: "ship",
        facilityId: "yard",
        mode: "shipyard",
        before: shipFingerprint(t, "ship"),
      }),
    /too long/,
  );
  assert.equal(vessel(t).facilityId, null);
});
test("repair quotes create normal reviewed projects; partial repairs cost money and apply once", () => {
  let t = fixture();
  t = run(t, {
    kind: "ship-damage",
    propertyId: "ship",
    componentId: "hull",
    damage: 40,
    before: shipFingerprint(t, "ship"),
    reason: "",
  });
  t = run(t, {
    kind: "ship-berth",
    propertyId: "ship",
    facilityId: "yard",
    mode: "shipyard",
    before: shipFingerprint(t, "ship"),
  });
  t = run(
    t,
    {
      kind: "ship-work",
      propertyId: "ship",
      before: shipFingerprint(t, "ship"),
      payerId: "hero",
      componentId: "hull",
      hp: 20,
      assignments: [],
      paidWorkers: 1,
    },
    player,
  );
  const job = t.journal!.propertyOperations!.jobs[0];
  assert.equal(job.status, "draft");
  assert.equal(job.recipe.laborCostCopper, 200);
  t = run(t, {
    kind: "estate-job",
    before: job,
    job: { ...job, status: "active" },
  });
  const before = toCopper(t.purses[1].coins);
  const saved = readCloudTable(JSON.parse(JSON.stringify(t)));
  assert.ok(saved);
  t = saved;
  t = run(t, { kind: "downtime-plan", name: "Repair at session start", days: 1 });
  t = run(t, {
    kind: "session",
    name: "Repaired ship",
    end: false,
    downtimeId: t.journal!.finance!.downtime.at(-1)!.id,
  });
  assert.equal(vessel(t).stats.components[0].hp, 180);
  assert.equal(before - toCopper(t.purses[1].coins), 200);
  t = days(t, 1);
  assert.equal(vessel(t).stats.components[0].hp, 180);
  assert.equal(t.journal!.fleet!.work[0].applied, true);
});
test("DM project completion applies ship repairs immediately and only once", () => {
  let t = fixture();
  t = run(t, {
    kind: "ship-damage",
    propertyId: "ship",
    componentId: "hull",
    damage: 40,
    before: shipFingerprint(t, "ship"),
    reason: "",
  });
  t = run(t, {
    kind: "ship-berth",
    propertyId: "ship",
    facilityId: "yard",
    mode: "shipyard",
    before: shipFingerprint(t, "ship"),
  });
  t = run(
    t,
    {
      kind: "ship-work",
      propertyId: "ship",
      before: shipFingerprint(t, "ship"),
      payerId: "hero",
      componentId: "hull",
      hp: 20,
      assignments: [],
      paidWorkers: 1,
    },
    player,
  );
  const job = t.journal!.propertyOperations!.jobs[0];
  t = run(t, {
    kind: "estate-job-resolution",
    jobId: job.id,
    before: job,
    action: "complete",
    stage: 0,
    progress: 0,
    reason: "Repairs completed during play.",
  });
  assert.equal(vessel(t).stats.components[0].hp, 180);
  assert.equal(t.journal!.fleet!.work[0].applied, true);
  t = days(t, 1);
  assert.equal(vessel(t).stats.components[0].hp, 180);
});
test("teleport pauses former-yard repair work and stale ship actions cannot apply", () => {
  let t = fixture();
  t = run(t, {
    kind: "ship-damage",
    propertyId: "ship",
    componentId: "hull",
    damage: 40,
    before: shipFingerprint(t, "ship"),
    reason: "",
  });
  t = run(t, {
    kind: "ship-berth",
    propertyId: "ship",
    facilityId: "yard",
    mode: "shipyard",
    before: shipFingerprint(t, "ship"),
  });
  t = run(
    t,
    {
      kind: "ship-work",
      propertyId: "ship",
      before: shipFingerprint(t, "ship"),
      payerId: "hero",
      componentId: "hull",
      hp: 40,
      assignments: [],
      paidWorkers: 1,
    },
    player,
  );
  const job = t.journal!.propertyOperations!.jobs[0];
  t = run(t, { kind: "estate-job", before: job, job: { ...job, status: "active" } });
  const stale = shipFingerprint(t, "ship");
  t = run(t, {
    kind: "ship-teleport",
    propertyId: "ship",
    destinationId: "far",
    facilityId: null,
    before: stale,
    reason: "",
  });
  assert.equal(t.journal!.propertyOperations!.jobs[0].status, "paused");
  assert.throws(
    () =>
      run(t, {
        kind: "ship-damage",
        propertyId: "ship",
        componentId: "hull",
        damage: 40,
        before: stale,
        reason: "",
      }),
    /changed/,
  );
  t = days(t, 2);
  assert.equal(vessel(t).stats.components[0].hp, 160);
});
test("upgrades preserve existing damage, use reviewed project labor and cannot install twice", () => {
  let t = fixture();
  const old = vessel(t);
  const upgrade = { ...old.upgrades[0], laborDays: 1, laborCopper: 100, hullHp: 50 };
  t = run(t, { kind: "ship-configure", before: old, vessel: { ...old, upgrades: [upgrade] } });
  t = run(t, {
    kind: "ship-damage",
    propertyId: "ship",
    componentId: "hull",
    damage: 40,
    before: shipFingerprint(t, "ship"),
    reason: "",
  });
  t = run(t, {
    kind: "ship-berth",
    propertyId: "ship",
    facilityId: "yard",
    mode: "shipyard",
    before: shipFingerprint(t, "ship"),
  });
  t = run(
    t,
    {
      kind: "ship-work",
      propertyId: "ship",
      before: shipFingerprint(t, "ship"),
      payerId: "hero",
      upgradeKey: upgrade.key,
      assignments: [],
      paidWorkers: 1,
    },
    player,
  );
  const job = t.journal!.propertyOperations!.jobs[0];
  t = run(t, { kind: "estate-job", before: job, job: { ...job, status: "active" } });
  t = days(t, 1);
  const hull = vessel(t).stats.components[0];
  assert.equal(hull.maxHp - hull.hp, 40);
  assert.equal(hull.maxHp, 250);
  assert.equal(vessel(t).stats.cargoWeight, 11000);
  assert.throws(
    () =>
      run(
        t,
        {
          kind: "ship-work",
          propertyId: "ship",
          before: shipFingerprint(t, "ship"),
          payerId: "hero",
          upgradeKey: upgrade.key,
          assignments: [],
          paidWorkers: 1,
        },
        player,
      ),
    /available upgrade/,
  );
});
test("purchased ships and private shipyards use listing/deed flow and rental exemption only for own ships", () => {
  let t = fixture();
  const template = estatePreset("shipyard");
  t = run(t, { kind: "estate-template", before: null, template, materials: [] });
  t.listings.push({
    id: "yard-list",
    name: "Private yard",
    kind: "property",
    quantity: 1,
    copper: 1000,
    notes: "",
    locationId: "port",
    estateTemplateKey: "shipyard",
  });
  t = run(t, { kind: "listing", listingId: "yard-list", purseId: "party", quantity: 1 });
  const yard = t.journal!.fleet!.facilities.find((y) => y.propertyId)!;
  assert.ok(t.holdings.find((h) => h.id === yard.propertyId)?.deed);
  t = run(t, { kind: "ship-facility", before: yard, facility: { ...yard, yardCopper: 100 } });
  t = run(t, {
    kind: "ship-berth",
    propertyId: "ship",
    facilityId: yard.id,
    mode: "shipyard",
    before: shipFingerprint(t, "ship"),
  });
  const before = toCopper(t.purses[0].coins);
  t = days(t, 1);
  assert.equal(toCopper(t.purses[0].coins), before);
  assert.throws(
    () =>
      run(t, {
        kind: "give",
        fromId: "party",
        toId: "hero",
        copper: 0,
        holdingId: yard.propertyId!,
        quantity: 1,
      }),
    /stored vessels/,
  );
});
test("player projections redact private ship notes and private fleets; backups retain the complete fleet", () => {
  const t = fixture(),
    view = projectRecord(t, player);
  assert.equal(view.journal!.fleet!.vessels[0].dmNotes, "");
  assert.ok(readCloudTable(view));
  assert.deepEqual(readArchivedSnapshot(JSON.stringify(t)).journal!.fleet, t.journal!.fleet);
  const site = t.journal!.propertyOperations!.sites[0];
  t.journal!.propertyOperations!.sites[0] = { ...site, access: "owner" };
  assert.equal(projectRecord(t, player).journal!.fleet!.vessels.length, 0);
});
test("pending downtime blocks changes; any changed ship settings makes an existing quote stale", () => {
  let t = fixture();
  t = run(t, { kind: "downtime-plan", days: 1, name: "Preview" });
  assert.throws(
    () =>
      run(t, {
        kind: "ship-teleport",
        propertyId: "ship",
        destinationId: "far",
        facilityId: null,
        before: shipFingerprint(t, "ship"),
        reason: "",
      }),
    /pending downtime/,
  );
  vessel(t).dockedCopper = 10;
  assert.throws(
    () =>
      run(t, {
        kind: "downtime-apply",
        endSession: false,
        downtimeId: t.journal!.finance!.downtime[0].id,
      }),
    /changed/,
  );
});

test("players can name an authorized party ship with stale-name protection", () => {
  let t = fixture();
  t = run(
    t,
    { kind: "ship-name", propertyId: "ship", before: "Dawn Trader", name: "Silver Wake" },
    player,
  );
  assert.equal(t.holdings[0].name, "Silver Wake");
  assert.throws(
    () =>
      run(
        t,
        { kind: "ship-name", propertyId: "ship", before: "Dawn Trader", name: "Stale" },
        player,
      ),
    /changed/,
  );
});
test("boarding stores only legacy-compatible character fields; visibility changes retain ship membership", () => {
  let t = aboard(fixture());
  const stored = t.journal!.world!.characterPositions[0];
  assert.equal("shipId" in stored, false);
  assert.equal("shipReturnInParty" in stored, false);
  t = run(t, {
    kind: "character-position",
    purseId: "hero",
    before: { ...stored, shipId: "ship", shipReturnInParty: true },
    inParty: false,
    locationId: "port",
    visible: false,
    sheetVisible: true,
  });
  assert.equal(t.journal!.fleet!.aboard.length, 1);
  assert.equal(t.journal!.world!.characterPositions[0].visible, false);
});
test("ship upkeep and facility fees preserve unpaid arrears and permit only actual payments", () => {
  let t = fixture();
  const old = vessel(t);
  t = run(t, { kind: "ship-configure", before: old, vessel: { ...old, storedCopper: 100 } });
  t = run(t, {
    kind: "ship-berth",
    propertyId: "ship",
    facilityId: "yard",
    mode: "dry-storage",
    before: shipFingerprint(t, "ship"),
  });
  t.purses[0].coins = { cp: 10, sp: 0, ep: 0, gp: 0, pp: 0 };
  t = days(t, 1);
  assert.equal(vessel(t).arrearsCopper, 100);
  assert.equal(toCopper(t.purses[0].coins), 0);
  assert.throws(
    () => run(t, { kind: "ship-arrears", propertyId: "ship", payerId: "party", copper: 1 }, player),
    /own/,
  );
  t = run(t, { kind: "ship-arrears", propertyId: "ship", payerId: "hero", copper: 100 }, player);
  assert.equal(vessel(t).arrearsCopper, 0);
});
test("unattended voyages require a paid authorized captain, respect wage arrears and budget", () => {
  let t = fixture();
  const c = {
    id: "captain",
    propertyId: "ship",
    name: "Captain",
    role: "captain",
    wageCopper: 100,
    periodDays: 1,
    status: "active" as const,
    manager: true,
    duties: ["supplies" as const],
    budgetCopper: 500,
    budgetPeriodDays: 30,
    budgetStartDay: 0,
    budgetSpentCopper: 0,
    notes: "",
  };
  t = run(t, { kind: "estate-staff", before: null, staff: c });
  const v = { ...voyage(t), captainId: "captain", crewPurseIds: [] };
  t = run(t, { kind: "ship-voyage", before: null, voyage: { ...v, status: "active" } });
  t = days(t, 1);
  assert.equal(t.journal!.fleet!.voyages[0].elapsedMinutes, 1440);
  t.purses[0].coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  t = days(t, 1);
  assert.equal(t.journal!.fleet!.voyages[0].elapsedMinutes, 1440);
  assert.match(t.journal!.fleet!.voyages[0].message, /crew|captain/);
});
test("aboard characters cannot remotely trade at the ashore party's market or disembark underway", () => {
  const t = sail(fixture());
  t.listings.push({
    id: "remote-goods",
    kind: "item",
    name: "Remote goods",
    notes: "",
    quantity: 1,
    copper: 1,
  });
  assert.throws(
    () =>
      run(t, { kind: "listing", listingId: "remote-goods", purseId: "hero", quantity: 1 }, player),
    /aboard a ship/,
  );
  assert.throws(
    () =>
      run(t, {
        kind: "ship-board",
        propertyId: "ship",
        purseId: "hero",
        action: "disembark",
        before: shipFingerprint(t, "ship"),
      }),
    /sailing/,
  );
});
test("property location edits cannot move ships, and account removal cannot orphan aboard characters", () => {
  const t = aboard(fixture()),
    h = t.holdings[0];
  assert.throws(
    () =>
      run(t, {
        kind: "property-profile",
        holdingId: h.id,
        before: { locationId: "port", property: h.property! },
        locationId: "far",
        property: h.property!,
      }),
    /Teleport/,
  );
  assert.throws(
    () =>
      run(t, {
        kind: "patch",
        changes: [{ store: "purses", id: "hero", before: t.purses[1], after: null }],
      }),
    /references|placement|ship/i,
  );
});
test("normal Give transfers clean ship configuration instead of losing the fleet identity", () => {
  let t = fixture();
  t = run(t, {
    kind: "give",
    fromId: "party",
    toId: "hero",
    copper: 0,
    holdingId: "ship",
    quantity: 1,
  });
  const ship = t.holdings.find((h) => h.kind === "property")!;
  assert.equal(ship.purseId, "hero");
  assert.equal(vessel(t).propertyId, ship.id);
  assert.ok(readCloudTable(t));
});
test("purchasing a ship template initializes a single vessel with the normal receipt/deed", () => {
  let t = fixture();
  const template = estatePreset("ship");
  t = run(t, { kind: "estate-template", before: null, template, materials: [] });
  t.listings.push({
    id: "ship-list",
    kind: "property",
    name: "Second ship",
    notes: "",
    quantity: 1,
    copper: 1000,
    locationId: "port",
    estateTemplateKey: "ship",
  });
  t = run(t, { kind: "listing", listingId: "ship-list", purseId: "hero", quantity: 1 }, player);
  assert.equal(t.journal!.fleet!.vessels.length, 2);
  const s = t.journal!.fleet!.vessels.find((s) => s.propertyId !== "ship")!;
  assert.ok(t.holdings.find((h) => h.id === s.propertyId)?.deed);
  assert.equal(toCopper(t.purses[1].coins), 9000);
});

test("mapped ship routes use reviewed anchors and pace; grid movement carries aboard tokens without travel spending", () => {
  let t = aboard(fixture());
  const grid = {
    columns: 10,
    rows: 10,
    feetPerTile: 5280,
    diagonal: "equal" as const,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  };
  const map = {
    id: "sea",
    name: "Sea route",
    image: "data:image/png;base64,aA==",
    locationId: null,
    visible: true,
    type: "ship" as const,
    grid,
    markers: [],
    anchors: [
      { locationId: "port", x: 0.05, y: 0.05 },
      { locationId: "far", x: 0.95, y: 0.05 },
    ],
    tokens: [
      {
        id: "ship-t",
        kind: "ship" as const,
        entityId: "ship",
        label: "Dawn Trader",
        column: 1,
        row: 1,
        visibility: "party" as const,
      },
      {
        id: "hero-t",
        kind: "character" as const,
        entityId: "hero",
        label: "Hero",
        column: 2,
        row: 1,
        visibility: "party" as const,
      },
    ],
  };
  t = run(t, { kind: "map-save", mapId: map.id, before: null, map });
  const before = structuredClone(t),
    token = map.tokens[0];
  t = run(t, {
    kind: "map-token",
    mapId: map.id,
    grid,
    tokenId: token.id,
    before: token,
    token: { ...token, column: 3, row: 4 },
  });
  assert.deepEqual(
    t.journal!.world!.maps[0].tokens!.map((t) => [t.column, t.row]),
    [
      [4, 4],
      [3, 4],
    ],
  );
  assert.deepEqual(t.holdings, before.holdings);
  assert.deepEqual(t.purses, before.purses);
  assert.deepEqual(t.journal!.finance, before.journal!.finance);
  assert.deepEqual(t.journal!.fleet, before.journal!.fleet);
  const shipToken = t.journal!.world!.maps[0].tokens!.find((t) => t.id === "ship-t")!;
  assert.throws(
    () =>
      run(t, {
        kind: "map-token",
        mapId: map.id,
        grid,
        tokenId: shipToken.id,
        before: shipToken,
        token: { ...shipToken, column: 9 },
      }),
    /aboard character outside/,
  );
  const mapRoute = {
      mapId: map.id,
      grid,
      points: [
        { column: 0, row: 0 },
        { column: 9, row: 0 },
      ],
    },
    duration = Math.max(1, Math.ceil((9 / vessel(t).stats.milesPerDay) * 1440));
  const v = { ...voyage(t, duration), mapRoute };
  assert.throws(
    () => run(t, { kind: "ship-voyage", before: null, voyage: { ...v, durationMinutes: 1 } }),
    /duration must match/,
  );
  assert.throws(
    () =>
      run(t, {
        kind: "ship-voyage",
        before: null,
        voyage: {
          ...v,
          mapRoute: {
            ...mapRoute,
            points: [
              { column: 1, row: 0 },
              { column: 9, row: 0 },
            ],
          },
        },
      }),
    /endpoints/,
  );
  t = run(t, { kind: "ship-voyage", before: null, voyage: v });
  const proposed = t.journal!.fleet!.voyages[0];
  t = run(t, { kind: "ship-voyage", before: proposed, voyage: { ...proposed, status: "active" } });
  const active = t.journal!.fleet!.voyages[0];
  assert.throws(
    () =>
      run(t, {
        kind: "ship-voyage",
        before: active,
        voyage: { ...active, durationMinutes: active.durationMinutes + 1 },
      }),
    /underway route/,
  );
  const actual = t.journal!.world!.maps[0];
  assert.throws(
    () => run(t, { kind: "map-save", mapId: map.id, before: actual, map: null }),
    /ongoing ship routes/,
  );
  t = days(t, 1);
  assert.equal(t.journal!.fleet!.voyages[0].status, "arrived");
  assert.equal(t.journal!.fleet!.voyages[0].elapsedMinutes, duration);
  assert.equal(t.holdings.find((h) => h.id === "ship")!.locationId, "far");
  assert.equal(
    t.journal!.world!.characterPositions.find((p) => p.purseId === "hero")!.locationId,
    "far",
  );
});
