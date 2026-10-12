import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { applyCommand, type CommandInput } from "./commands.ts";
import { smithFixture, smithDesign, smithDm, smithPlayer } from "./test-fixtures/blacksmith.ts";
import { smithQuote, smithDescription, previewSmith } from "./blacksmith.ts";
import { previewDowntime } from "./finance.ts";
import { projectRecord } from "./session-records.ts";
import { preserveJournalMetadata, readArchivedSnapshot } from "./journal.ts";
import { readCloudTable, type CloudTable } from "./cloud.ts";
import { toCopper } from "./money.ts";
let seq = 0;
test("smith quote UI module loads without campaign bootstrap or a finance initialization cycle", () => {
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(new URL("./blacksmith.ts", import.meta.url).href)});`,
    ],
    { stdio: "pipe" },
  );
});
const run = (t: CloudTable, c: CommandInput, seat = smithDm) =>
  applyCommand(t, seat, { ...c, id: `smith-test-${++seq}` });
function order(t: CloudTable, design = smithDesign(t)) {
  const q = smithQuote(t, "forge", "hero", design);
  return run(
    t,
    { kind: "smith-order", shopId: "forge", purseId: "hero", design, before: q.before },
    smithPlayer,
  );
}
function downtime(t: CloudTable, days: number) {
  t = run(t, { kind: "downtime-plan", name: "Forge work", days });
  return run(t, {
    kind: "downtime-apply",
    downtimeId: t.journal!.finance!.downtime.at(-1)!.id,
    endSession: false,
  });
}
test("commission preserves every component, engraving, material source, paid terms and actual completion date", () => {
  let t = smithFixture();
  const d = smithDesign(t);
  d.parts[0].holdingId = "steel-lot";
  const q = smithQuote(t, "forge", "hero", d),
    starting = toCopper(t.purses[0].coins);
  t = order(t, d);
  assert.equal(toCopper(t.purses[0].coins), starting - q.terms.costCopper);
  assert.equal(t.holdings[0].quantity, 5);
  assert.equal(t.journal!.blacksmith!.profiles[0].materials[0].quantity, 17);
  assert.equal(t.holdings.filter((h) => h.id.endsWith("-crafted")).length, 0);
  t = downtime(t, 2);
  assert.equal(t.journal!.blacksmith!.orders[0].status, "active");
  t = downtime(t, 5);
  const o = t.journal!.blacksmith!.orders[0];
  assert.equal(o.status, "ready");
  assert.equal(o.completedDay, 4);
  assert.equal(t.journal!.finance!.day, 7);
  t = run(t, { kind: "smith-claim", orderId: o.id, before: o }, smithPlayer);
  const h = t.holdings.find((h) => h.id.endsWith("-crafted"))!;
  assert.equal(h.quantity, 1);
  assert.equal(h.unitCopper, q.terms.valueCopper);
  for (const text of [
    "Blade:",
    "Handle:",
    "Pommel:",
    "Hilt:",
    "Crossguard:",
    "Homeward",
    "Made by Aster",
    "Completed campaign day 4",
    "Commissioned campaign day 0",
  ])
    assert.ok(h.notes.includes(text), text);
  assert.equal(t.ledger.filter((l) => l.shopId === "forge").length, 1);
  assert.throws(
    () =>
      run(
        t,
        { kind: "smith-claim", orderId: o.id, before: t.journal!.blacksmith!.orders[0] },
        smithPlayer,
      ),
    /already been collected/,
  );
});
test("smith uses only spendable carried materials and aggregates a lot shared between components", () => {
  const base = smithFixture();
  for (const patch of [
    { custody: { kind: "property", propertyId: "site" } },
    { custody: { kind: "transit", propertyId: "site" } },
    { reservedFor: "job" },
    { equipped: true },
    { purseId: "other" },
    { materialKey: "wood" },
    { service: true },
  ]) {
    const t = structuredClone(base);
    Object.assign(t.holdings[0], patch);
    const d = smithDesign(t);
    d.parts[0].holdingId = "steel-lot";
    assert.throws(() => order(t, d));
    assert.equal(t.holdings[0].quantity, 6);
  }
  const t = structuredClone(base),
    d = smithDesign(t);
  t.holdings[0].quantity = 3;
  for (const p of d.parts.filter((p) => p.materialKey === "steel")) p.holdingId = "steel-lot";
  assert.throws(() => order(t, d), /all selected components/);
});
test("legendary gate, location, closed shop, funds and forged ownership fail atomically", () => {
  const base = smithFixture();
  for (const modify of [
    (t: CloudTable) => {
      t.journal!.blacksmith!.profiles[0].skill = "legendary";
      t.journal!.world!.npcs[0].blacksmithServices = false;
    },
    (t: CloudTable) => {
      t.journal!.market!.currentLocationId = null;
    },
    (t: CloudTable) => {
      t.journal!.market!.currentLocationId = "far";
    },
    (t: CloudTable) => {
      t.shops[0].closed = true;
    },
    (t: CloudTable) => {
      t.purses[0].coins.cp = 1;
    },
  ]) {
    const t = structuredClone(base);
    modify(t);
    const before = structuredClone(t);
    assert.throws(() => order(t));
    assert.deepEqual(t, before);
  }
  const q = smithQuote(base, "forge", "other", smithDesign(base));
  assert.throws(
    () =>
      run(
        base,
        {
          kind: "smith-order",
          shopId: "forge",
          purseId: "other",
          design: q.terms.design,
          before: q.before,
        },
        smithPlayer,
      ),
    /assigned account/,
  );
  const p = base.journal!.blacksmith!.profiles[0];
  assert.throws(
    () =>
      run(
        base,
        {
          kind: "smith-profile",
          shopId: "forge",
          before: p,
          profile: { ...p, skill: "legendary" },
        },
        smithPlayer,
      ),
    /Only the DM/,
  );
});
test("enchantments require all three gates and player-projected quotes match despite private unapproved definitions", () => {
  let t = smithFixture();
  const p = t.journal!.blacksmith!.profiles[0];
  p.enchantments = [
    {
      key: "light",
      name: "Glow",
      description: "Soft light",
      minimumSkill: "expert",
      approved: true,
      copper: 500,
      days: 2,
      valueCopper: 1000,
    },
    {
      key: "secret",
      name: "Private enchantment",
      description: "secret",
      minimumSkill: "apprentice",
      approved: false,
      copper: 0,
      days: 0,
      valueCopper: 0,
    },
  ];
  const d = smithDesign(t);
  d.enchantmentKey = "light";
  assert.throws(() => order(t, d), /magical forge/);
  p.magicalForge = true;
  assert.throws(() => order(t, d), /sufficient skill/);
  p.skill = "expert";
  const publicT = projectRecord(t, smithPlayer),
    q = smithQuote(publicT, "forge", "hero", d);
  assert.equal(publicT.journal!.blacksmith!.profiles[0].enchantments.length, 1);
  t = run(
    t,
    { kind: "smith-order", shopId: "forge", purseId: "hero", design: d, before: q.before },
    smithPlayer,
  );
  assert.match(t.journal!.blacksmith!.orders[0].terms.description, /Enchantment: Glow/);
  d.enchantmentKey = "secret";
  assert.throws(() => order(t, d), /DM approval/);
});
test("rarity, skill and contribution value scale the reviewed price/value without combat bonuses", () => {
  const t = smithFixture(),
    d = smithDesign(t),
    base = smithQuote(t, "forge", "hero", d);
  const p = t.journal!.blacksmith!.profiles[0];
  p.skill = "legendary";
  p.priceMultiplier = 5;
  p.valueMultiplier = 3;
  p.materials[0].rarity = "legendary";
  p.materials[0].rarityMultiplier = 10;
  const costly = smithQuote(t, "forge", "hero", d);
  assert.ok(costly.terms.costCopper > base.terms.costCopper);
  assert.ok(costly.terms.valueCopper > base.terms.valueCopper);
  d.parts[0].holdingId = "steel-lot";
  const contributed = smithQuote(t, "forge", "hero", d);
  assert.equal(contributed.terms.costCopper, costly.terms.costCopper - 1000);
  assert.equal(contributed.terms.valueCopper, costly.terms.valueCopper);
});
test("stale quotes, malformed parts and changed pending downtime cannot silently apply", () => {
  let t = smithFixture();
  const d = smithDesign(t),
    q = smithQuote(t, "forge", "hero", d);
  t.journal!.blacksmith!.profiles[0].materials[0].quantity = 19;
  assert.throws(
    () =>
      run(
        t,
        { kind: "smith-order", shopId: "forge", purseId: "hero", design: d, before: q.before },
        smithPlayer,
      ),
    /quote changed/,
  );
  assert.throws(() => order(t, { ...d, parts: [d.parts[0]] }), /every configured component/);
  assert.throws(
    () => order(t, { ...d, parts: d.parts.map(() => d.parts[0]) }),
    /Duplicate chosen parts/,
  );
  t = order(t);
  t = run(t, { kind: "downtime-plan", name: "Smith preview", days: 5 });
  assert.equal(t.journal!.blacksmith!.orders[0].status, "active", "preview does not complete work");
  const o = t.journal!.blacksmith!.orders[0];
  assert.throws(
    () =>
      run(t, { kind: "smith-control", orderId: o.id, before: o, action: "pause", reason: "Pause" }),
    /pending downtime/,
  );
  t.journal!.blacksmith!.orders[0].progressDays = 1;
  assert.throws(
    () =>
      run(t, {
        kind: "downtime-apply",
        downtimeId: t.journal!.finance!.downtime.at(-1)!.id,
        endSession: false,
      }),
    /changed after this preview/,
  );
});
test("paused/cancelled work and session hours never advance; accepted specifications survive config/name changes", () => {
  let t = order(smithFixture());
  const o = t.journal!.blacksmith!.orders[0];
  assert.equal(previewSmith(t, 3, true)!.state.orders[0].progressDays, 0);
  assert.equal(
    previewDowntime(t, t.journal!.finance!, 1, {
      minutes: 1440,
      allowCharacterWork: false,
      receiptId: "session",
    }).blacksmith!.state.orders[0].progressDays,
    0,
  );
  t = run(t, {
    kind: "smith-control",
    orderId: o.id,
    before: o,
    action: "pause",
    reason: "Await approval",
  });
  t = downtime(t, 5);
  assert.equal(t.journal!.blacksmith!.orders[0].progressDays, 0);
  let current = t.journal!.blacksmith!.orders[0];
  t = run(t, {
    kind: "smith-control",
    orderId: current.id,
    before: current,
    action: "resume",
    reason: "Proceed",
  });
  t.journal!.world!.npcs[0].name = "New Aster";
  t.purses.find((p) => p.id === "maker")!.name = "New Aster";
  t.journal!.blacksmith!.profiles[0].quality = "Changed quality";
  t = downtime(t, 10);
  current = t.journal!.blacksmith!.orders[0];
  assert.match(smithDescription(current), /Made by Aster/);
  assert.doesNotMatch(smithDescription(current), /Changed quality/);
  assert.equal(current.completedDay, 9);
  t = run(t, {
    kind: "smith-control",
    orderId: current.id,
    before: current,
    action: "cancel",
    reason: "Customer cancellation; salvage manual",
  });
  assert.equal(t.holdings.filter((h) => h.id.endsWith("-crafted")).length, 0);
});
test("collection rechecks presence and assignment while an already paid order remains collectable after services close", () => {
  let t = downtime(order(smithFixture()), 10);
  const o = t.journal!.blacksmith!.orders[0];
  t.journal!.market!.currentLocationId = "far";
  assert.throws(
    () => run(t, { kind: "smith-claim", orderId: o.id, before: o }, smithPlayer),
    /original forge/,
  );
  t.journal!.market!.currentLocationId = "city";
  t.shops[0].closed = true;
  t.journal!.world!.npcs[0].blacksmithServices = false;
  t = run(t, { kind: "smith-claim", orderId: o.id, before: o }, smithPlayer);
  assert.equal(t.journal!.blacksmith!.orders[0].status, "claimed");
});
test("profiles/orders preserve legacy saves and archives; projections disclose only a customer's orders and nearby smiths", () => {
  const t = order(smithFixture());
  assert.ok(readCloudTable(t));
  assert.ok(readArchivedSnapshot(JSON.stringify(t)));
  const current = t.journal!,
    old = { ...current };
  delete old.blacksmith;
  assert.deepEqual(preserveJournalMetadata(old, current).blacksmith, current.blacksmith);
  assert.equal(
    projectRecord(t, { ...smithPlayer, purseIds: ["other"] }).journal!.blacksmith!.orders.length,
    0,
  );
  t.journal!.market!.currentLocationId = "far";
  const away = projectRecord(t, smithPlayer);
  assert.equal(away.journal!.blacksmith!.profiles.length, 0);
  assert.equal(away.journal!.blacksmith!.orders.length, 1);
  assert.ok(away.journal!.market!.locations.some((l) => l.id === "city"));
});
