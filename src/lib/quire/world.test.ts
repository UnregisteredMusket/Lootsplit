import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable, readCloudTable, type CloudTable, type CloudSeat } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readJournal, readArchivedSnapshot, preserveJournalMetadata } from "./journal.ts";
import { readWorld, type CampaignMap } from "./world-schema.ts";
import {
  anchorFor,
  npcAvailableHere,
  recognizedAnchors,
  worldImportFingerprint,
  shopAsking,
} from "./world.ts";
import { previewSessionTime, sessionTimeFingerprint } from "./session-time.ts";
import { projectRecord, archiveSession } from "./session-records.ts";
import { canonicalJson } from "./canonical-json.ts";
import { fromCopper, toCopper } from "./money.ts";
import { blankSheet } from "../characters/model.mjs";
import { readFinance } from "./finance.ts";
const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] },
  hero: CloudSeat = {
    id: "hero-seat",
    token: "hero",
    name: "Hero",
    role: "player",
    purseIds: ["hero"],
  },
  other: CloudSeat = {
    id: "other-seat",
    token: "other",
    name: "Other",
    role: "player",
    purseIds: ["other"],
  };
let receipt = 0;
const command = (t: CloudTable, input: CommandInput, seat = dm) =>
  applyCommand(t, seat, { ...input, id: `world-test-${++receipt}` });
function fixture(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hero", name: "Alwen", kind: "character", coins: fromCopper(10000) },
      { id: "other", name: "Bea", kind: "character", coins: fromCopper(10000) },
      { id: "party", name: "Treasury", kind: "party", coins: fromCopper(10000) },
    ],
    holdings: [
      {
        id: "sword",
        purseId: "hero",
        name: "Sword",
        kind: "item",
        quantity: 2,
        unitCopper: 500,
        notes: "A known lot",
      },
      {
        id: "rope",
        purseId: "other",
        name: "Rope",
        kind: "item",
        quantity: 1,
        unitCopper: 200,
        notes: "Private inventory",
      },
    ],
    journal: readJournal({
      market: {
        currentLocationId: "area",
        locations: [
          { id: "region", name: "Eastmarch", kind: "region", parentId: null, description: "" },
          { id: "city", name: "Port", kind: "city", parentId: "region", description: "" },
          { id: "area", name: "Docks", kind: "area", parentId: "city", description: "" },
          { id: "away", name: "Other City", kind: "city", parentId: "region", description: "" },
        ],
      },
      finance: readFinance(),
      sessions: [{ id: "session", name: "Adventure", startedAt: 1 }],
    }),
  };
}
function withNpc(t = fixture()) {
  return command(t, {
    kind: "npc-create",
    npc: {
      id: "npc",
      name: "Mara",
      description: "Dock broker",
      locationId: "city",
      visible: true,
      barterAllowed: true,
      controllerPurseId: null,
    },
    copper: 10000,
    inventory: [{ name: "Rare gem", quantity: 2, unitCopper: 1000, notes: "" }],
  });
}
const map: CampaignMap = {
  id: "map",
  name: "Port map",
  image: "data:image/png;base64,AAAA",
  locationId: "city",
  visible: true,
  anchors: [{ locationId: "city", x: 0.5, y: 0.3 }],
  markers: [
    {
      id: "secret",
      label: "Secret lair",
      description: "DM knowledge",
      visibility: "dm",
      x: 0.2,
      y: 0.1,
    },
    {
      id: "public",
      label: "Notice",
      description: "Meet here",
      visibility: "party",
      x: 0.4,
      y: 0.5,
    },
  ],
};
const offer = (t: CloudTable, toId = "other") => ({
  kind: "trade-offer" as const,
  tradeId: "trade",
  revision: null,
  actorId: "hero",
  left: {
    purseId: "hero",
    copper: 100,
    items: [
      {
        holdingId: "sword",
        quantity: 1,
        before: canonicalJson(t.holdings.find((h) => h.id === "sword")),
      },
    ],
  },
  right: {
    purseId: toId,
    copper: 50,
    items: [] as import("./world-schema.ts").Trade["right"]["items"],
  },
  note: "Fair exchange",
});
test("maps preserve coordinates and DM-only marker privacy in live and archived projections", () => {
  const t = command(fixture(), { kind: "map-save", mapId: map.id, before: null, map });
  assert.deepEqual(anchorFor(map, t, "area"), map.anchors[0]);
  assert.throws(
    () =>
      command(
        t,
        {
          kind: "map-marker",
          mapId: map.id,
          markerId: "public",
          before: map.markers[1],
          marker: null,
        },
        hero,
      ),
    /Only the DM/,
  );
  const player = projectRecord(t, hero);
  assert.equal(player.journal!.world!.maps[0].markers.length, 1);
  assert.ok(!JSON.stringify(player).includes("Secret lair"));
  archiveSession(t, "archive", "Record");
  const archived = projectRecord(t, hero).journal!.reports![0];
  assert.ok(!archived.snapshot.includes("Secret lair"));
  assert.ok(readArchivedSnapshot(archived.snapshot));
});
test("map edits and marker changes require fresh exact state; locations referenced by maps cannot disappear", () => {
  const t = command(fixture(), { kind: "map-save", mapId: map.id, before: null, map });
  assert.throws(
    () => command(t, { kind: "map-save", mapId: map.id, before: null, map }),
    /changed/,
  );
  assert.throws(
    () =>
      command(t, {
        kind: "market-location",
        locationId: "city",
        before: t.journal!.market!.locations[1],
        after: null,
      }),
    /Move the party/,
  );
  assert.throws(
    () =>
      command(t, {
        kind: "map-save",
        mapId: map.id,
        before: map,
        map: { ...map, anchors: [...map.anchors, ...map.anchors] },
      }),
    /Duplicate/,
  );
});
test("OCR matches unambiguous existing labels only and uses normalized image positions", () => {
  const t = fixture(),
    lines = [
      { text: "Port", x: 10, y: -30, width: 20, size: 10 },
      { text: "Invented land", x: 0, y: 0, width: 2, size: 2 },
    ];
  assert.deepEqual(recognizedAnchors(lines, 100, 100, t), [
    { locationId: "city", x: 0.2, y: 0.35 },
  ]);
  t.journal!.market!.locations.push({
    id: "duplicate",
    name: "Port",
    kind: "city",
    parentId: "region",
    description: "",
  });
  assert.equal(recognizedAnchors(lines, 100, 100, t).length, 0);
});
test("hidden maps and unknown map references are rejected/projected safely", () => {
  const t = command(fixture(), {
    kind: "map-save",
    mapId: map.id,
    before: null,
    map: { ...map, visible: false },
  });
  assert.equal(projectRecord(t, hero).journal!.world!.maps.length, 0);
  assert.throws(
    () =>
      command(fixture(), {
        kind: "map-save",
        mapId: map.id,
        before: null,
        map: { ...map, locationId: "missing" },
      }),
    /location/,
  );
});
test("NPCs use canonical non-party accounts and require known location and DM creation", () => {
  const t = withNpc(),
    npc = t.journal!.world!.npcs[0];
  assert.equal(t.purses.find((p) => p.id === npc.id)!.nonParty, true);
  assert.ok(npcAvailableHere(npc, t));
  assert.equal(
    projectRecord(t, hero).holdings.some((h) => h.purseId === "npc"),
    true,
  );
  assert.equal(toCopper(projectRecord(t, hero).purses.find((p) => p.id === "npc")!.coins), 0);
  assert.throws(
    () =>
      command(
        fixture(),
        { kind: "npc-create", npc: { ...npc, id: "new" }, copper: 0, inventory: [] },
        hero,
      ),
    /Only the DM/,
  );
  const moved = command(t, { kind: "party-location", before: "area", locationId: null });
  assert.equal(projectRecord(moved, hero).journal!.world!.npcs.length, 0);
  assert.throws(
    () =>
      command(
        moved,
        { kind: "npc-message", npcId: "npc", purseId: "hero", asNpc: false, text: "Hello" },
        hero,
      ),
    /not available/,
  );
});
test("NPC conversations are private and only the controller can speak as NPC", () => {
  let t = withNpc();
  t = command(
    t,
    {
      kind: "npc-message",
      npcId: "npc",
      purseId: "hero",
      asNpc: false,
      text: "A private question",
    },
    hero,
  );
  assert.throws(
    () =>
      command(
        t,
        {
          kind: "npc-message",
          npcId: "npc",
          purseId: "hero",
          asNpc: true,
          text: "Forged response",
        },
        other,
      ),
    /controller/,
  );
  assert.equal(projectRecord(t, other).journal!.world!.conversations.length, 0);
  const npc = t.journal!.world!.npcs[0];
  t = command(t, { kind: "npc-save", before: npc, npc: { ...npc, controllerPurseId: "other" } });
  t = command(
    t,
    { kind: "npc-message", npcId: "npc", purseId: "hero", asNpc: true, text: "Delegated response" },
    other,
  );
  assert.equal(projectRecord(t, other).journal!.world!.conversations[0].messages.length, 2);
});
test("NPC import is additive, reviewed, strict and atomic on invalid references", () => {
  const t = fixture(),
    doc = {
      format: "lootsplit.npcs" as const,
      schemaVersion: 1 as const,
      npcs: [
        {
          name: "Seller",
          description: "",
          locationId: "city",
          visible: true,
          barterAllowed: true,
          controllerPurseId: null,
          copper: 100,
          inventory: [{ name: "Goods", quantity: 2, unitCopper: 10, notes: "" }],
        },
      ],
    };
  const imported = command(t, {
    kind: "npc-import",
    before: worldImportFingerprint(t),
    document: doc,
  });
  assert.equal(imported.purses.length, 4);
  assert.equal(t.purses.length, 3);
  assert.throws(
    () =>
      command(t, {
        kind: "npc-import",
        before: worldImportFingerprint(t),
        document: { ...doc, npcs: [...doc.npcs, { ...doc.npcs[0], locationId: "missing" }] },
      }),
    /location/,
  );
  assert.throws(
    () =>
      command(imported, { kind: "npc-import", before: worldImportFingerprint(t), document: doc }),
    /changed/,
  );
});
test("bilateral acceptance moves inventory and coins once, preserves total wealth and hides unrelated offers", () => {
  const before = fixture(),
    t = command(before, offer(before), hero),
    w = t.journal!.world!;
  assert.equal(t.holdings.length, 2);
  assert.equal(w.trades[0].status, "pending");
  assert.throws(
    () =>
      command(
        t,
        {
          kind: "trade-decision",
          tradeId: "trade",
          revision: 0,
          actorId: "hero",
          decision: "accepted",
        },
        hero,
      ),
    /recipient/,
  );
  const accepted = command(
    t,
    {
      kind: "trade-decision",
      tradeId: "trade",
      revision: 0,
      actorId: "other",
      decision: "accepted",
    },
    other,
  );
  assert.equal(toCopper(accepted.purses[0].coins), 9950);
  assert.equal(toCopper(accepted.purses[1].coins), 10050);
  assert.equal(
    accepted.holdings.filter((h) => h.name === "Sword").reduce((n, h) => n + h.quantity, 0),
    2,
  );
  assert.equal(
    accepted.holdings.find((h) => h.name === "Sword" && h.purseId === "other")!.quantity,
    1,
  );
  assert.throws(
    () =>
      command(
        accepted,
        {
          kind: "trade-decision",
          tradeId: "trade",
          revision: 0,
          actorId: "other",
          decision: "accepted",
        },
        other,
      ),
    /already decided/,
  );
  assert.equal(projectRecord(t, { role: "player", purseIds: [] }).journal!.world!.trades.length, 0);
});
test("counteroffers transfer consent to the other side and invalidate old decisions", () => {
  const f = fixture(),
    t = command(f, offer(f), hero),
    o = t.journal!.world!.trades[0],
    counter = command(
      t,
      {
        kind: "trade-offer",
        tradeId: o.id,
        revision: o.revision,
        actorId: "other",
        left: o.left,
        right: {
          ...o.right,
          items: [{ holdingId: "rope", quantity: 1, before: canonicalJson(t.holdings[1]) }],
        },
        note: "With rope",
      },
      other,
    );
  assert.equal(counter.journal!.world!.trades[0].awaitingId, "hero");
  assert.throws(
    () =>
      command(
        counter,
        {
          kind: "trade-decision",
          tradeId: o.id,
          revision: 0,
          actorId: "other",
          decision: "accepted",
        },
        other,
      ),
    /changed/,
  );
  const accepted = command(
    counter,
    { kind: "trade-decision", tradeId: o.id, revision: 1, actorId: "hero", decision: "accepted" },
    hero,
  );
  assert.equal(accepted.holdings.find((h) => h.name === "Rope")!.purseId, "hero");
});
test("trade rejects guessed private inventory, repeated lots, stale lots and insufficient gross funds atomically", () => {
  const f = fixture(),
    proposal = offer(f);
  assert.throws(
    () =>
      command(
        f,
        {
          ...proposal,
          right: {
            ...proposal.right,
            items: [{ holdingId: "rope", quantity: 1, before: canonicalJson(f.holdings[1]) }],
          },
        },
        hero,
      ),
    /own inventory/,
  );
  assert.throws(
    () =>
      command(
        f,
        {
          ...proposal,
          left: { ...proposal.left, items: [...proposal.left.items, ...proposal.left.items] },
        },
        hero,
      ),
    /Duplicate/,
  );
  const pending = command(f, proposal, hero);
  pending.holdings[0].notes = "Changed";
  assert.throws(
    () =>
      command(
        pending,
        {
          kind: "trade-decision",
          tradeId: "trade",
          revision: 0,
          actorId: "other",
          decision: "accepted",
        },
        other,
      ),
    /changed/,
  );
  assert.equal(pending.journal!.world!.trades[0].status, "pending");
  const t = command(
    f,
    {
      ...proposal,
      left: { ...proposal.left, copper: 10001 },
      right: { ...proposal.right, copper: 10000 },
    },
    hero,
  );
  assert.throws(
    () =>
      command(
        t,
        {
          kind: "trade-decision",
          tradeId: "trade",
          revision: 0,
          actorId: "other",
          decision: "accepted",
        },
        other,
      ),
    /afford/,
  );
});
test("stored, reserved and services cannot be offered; barter-disabled or away NPCs cannot accept", () => {
  for (const mutation of [
    { custody: { kind: "transit" as const, propertyId: "property", shipmentId: "shipment" } },
    { reservedFor: "job" },
    { service: true },
  ]) {
    const f = fixture();
    Object.assign(f.holdings[0], mutation);
    assert.throws(() => command(f, offer(f), hero), /stored|transit|reserved|Services/);
  }
  let t = withNpc();
  const o = offer(t, "npc");
  t = command(t, o, hero);
  const npc = t.journal!.world!.npcs[0];
  t = command(t, { kind: "npc-save", before: npc, npc: { ...npc, barterAllowed: false } });
  assert.throws(
    () =>
      command(t, {
        kind: "trade-decision",
        tradeId: "trade",
        revision: 0,
        actorId: "npc",
        decision: "accepted",
      }),
    /not available/,
  );
});
test("NPC barter accepts only through DM or delegated controller", () => {
  const f = withNpc(),
    proposal = offer(f, "npc");
  proposal.right.items = [
    { holdingId: f.holdings[2].id, quantity: 1, before: canonicalJson(f.holdings[2]) },
  ];
  let t = command(f, proposal, hero);
  assert.throws(
    () =>
      command(
        t,
        {
          kind: "trade-decision",
          tradeId: "trade",
          revision: 0,
          actorId: "npc",
          decision: "accepted",
        },
        hero,
      ),
    /participant/,
  );
  t = command(t, {
    kind: "trade-decision",
    tradeId: "trade",
    revision: 0,
    actorId: "npc",
    decision: "accepted",
  });
  assert.equal(t.holdings.find((h) => h.name === "Rare gem" && h.purseId === "hero")!.quantity, 1);
});
test("bartered property deed updates owner and leaves the original purchase receipt intact", () => {
  const f = fixture();
  f.holdings.push({
    id: "home",
    name: "Home",
    purseId: "hero",
    kind: "property",
    quantity: 1,
    unitCopper: 1000,
    notes: "",
    locationId: "city",
    deed: {
      id: "deed",
      transactionId: "purchase",
      listingId: "listing",
      propertyName: "Home",
      location: "Eastmarch / Port",
      buyerId: "hero",
      buyerName: "Alwen",
      ownerId: "hero",
      ownerName: "Alwen",
      purchasedAt: 1,
      campaignDay: 0,
      unitCopper: 1000,
      totalCopper: 1000,
      purchasedQuantity: 1,
    },
  });
  const p = offer(f);
  p.left.items = [{ holdingId: "home", quantity: 1, before: canonicalJson(f.holdings[2]) }];
  const pending = command(f, p, hero),
    t = command(
      pending,
      {
        kind: "trade-decision",
        tradeId: "trade",
        revision: 0,
        actorId: "other",
        decision: "accepted",
      },
      other,
    );
  const home = t.holdings.find((h) => h.name === "Home")!;
  assert.equal(home.deed!.ownerId, "other");
  assert.equal(home.deed!.buyerId, "hero");
  assert.equal(home.deed!.transactionId, "purchase");
  assert.equal(
    t.holdings.some((h) => h.id === "home"),
    false,
  );
});
test("black market visibility and premium are enforced at purchase time and through player projections", () => {
  const f = fixture();
  f.shops = [
    {
      id: "vendor",
      name: "Hidden vendor",
      keeper: "",
      place: "",
      locationId: "city",
      notes: "",
      sellRate: 1,
      buyRate: 0.5,
      wealth: "modest",
      category: "curios",
      priceScale: 1,
      blackMarket: true,
      blackMarketPremium: 2,
    },
  ];
  f.stock = [
    {
      id: "rare",
      shopId: "vendor",
      name: "Contraband",
      quantity: 2,
      copper: 1000,
      baseCopper: 1000,
      rarity: "rare",
      notes: "",
    },
  ];
  assert.equal(projectRecord(f, hero).shops.length, 0);
  assert.throws(
    () => command(f, { kind: "buy", stockId: "rare", purseId: "hero", quantity: 1 }, hero),
    /not available|hidden/,
  );
  assert.throws(
    () => command(f, { kind: "black-market", before: false, active: true }, hero),
    /Only the DM/,
  );
  const open = command(f, { kind: "black-market", before: false, active: true });
  assert.equal(projectRecord(open, hero).stock.length, 1);
  assert.equal(shopAsking(open.shops[0], 1000), 2000);
  const bought = command(
    open,
    { kind: "buy", stockId: "rare", purseId: "hero", quantity: 1 },
    hero,
  );
  assert.equal(toCopper(bought.purses[0].coins), 8000);
  const hidden = command(bought, { kind: "black-market", before: true, active: false });
  assert.throws(
    () => command(hidden, { kind: "buy", stockId: "rare", purseId: "hero", quantity: 1 }, hero),
    /not available|hidden/,
  );
});
test("session advances are DM-only, bound to an active session and stale preview, limited to 24 hours", () => {
  const f = fixture(),
    advance = {
      kind: "session-time" as const,
      before: sessionTimeFingerprint(f),
      hours: 24,
      rest: "none" as const,
      purseIds: [],
      allowDowntime: false,
      note: "Travel",
    };
  assert.throws(() => command(f, advance, hero), /Only the DM/);
  assert.throws(() => command(f, { ...advance, hours: 25 }));
  const t = command(f, advance);
  assert.equal(t.journal!.finance!.day, 1);
  assert.equal(t.journal!.finance!.minuteOfDay, 0);
  assert.throws(() => command(t, advance), /changed/);
  const ended = structuredClone(f);
  ended.journal!.sessions[0].endedAt = 2;
  assert.throws(
    () => command(ended, { ...advance, before: sessionTimeFingerprint(ended) }),
    /Start a recorded/,
  );
});
test("fractional session clock settles finance once at crossed day and preserves old optional fields", () => {
  let t = fixture();
  t.journal!.finance!.rules.push({
    id: "income",
    name: "Rent",
    purseId: "hero",
    kind: "income",
    copper: 100,
    periodDays: 1,
    holdingId: "",
    active: true,
    carryDays: 0,
    arrears: 0,
  });
  for (const hours of [8, 8, 8])
    t = command(t, {
      kind: "session-time",
      before: sessionTimeFingerprint(t),
      hours,
      rest: "none",
      purseIds: [],
      allowDowntime: false,
      note: "",
    });
  assert.equal(t.journal!.finance!.day, 1);
  assert.equal(toCopper(t.purses[0].coins), 10100);
  assert.equal(t.ledger.filter((l) => l.summary.includes("Rent")).length, 1);
  const old = structuredClone(t.journal!);
  delete old.world;
  delete old.finance!.minuteOfDay;
  assert.deepEqual(preserveJournalMetadata(old, t.journal!).world, t.journal!.world);
  assert.equal(preserveJournalMetadata(old, t.journal!).finance!.minuteOfDay, 0);
  assert.ok(readCloudTable(t));
});
test("awarded rests reuse sheet resource policies and do not alter funds, equipment, conditions or manual resources", () => {
  const f = fixture();
  const sheet = blankSheet();
  sheet.maxHp = 20;
  sheet.hp = 2;
  sheet.deathFailures = 2;
  sheet.slots = [{ level: 1, max: 2, used: 2 }];
  sheet.resources = [
    { name: "Short", current: 0, max: 2, recovery: "short" },
    { name: "Long", current: 0, max: 3, recovery: "long" },
    { name: "Manual", current: 0, max: 4, recovery: "manual" },
  ];
  f.purses[0].sheet = sheet;
  const short = command(f, {
    kind: "session-time",
    before: sessionTimeFingerprint(f),
    hours: 1,
    rest: "short",
    purseIds: ["hero"],
    allowDowntime: false,
    note: "",
  });
  assert.equal(short.purses[0].sheet!.hp, 2);
  assert.deepEqual(
    short.purses[0].sheet!.resources.map((r) => r.current),
    [2, 0, 0],
  );
  const long = command(short, {
    kind: "session-time",
    before: sessionTimeFingerprint(short),
    hours: 8,
    rest: "long",
    purseIds: ["hero"],
    allowDowntime: false,
    note: "",
  });
  assert.equal(long.purses[0].sheet!.hp, 20);
  assert.equal(long.purses[0].sheet!.slots[0].used, 0);
  assert.deepEqual(
    long.purses[0].sheet!.resources.map((r) => r.current),
    [2, 3, 0],
  );
  assert.equal(toCopper(long.purses[0].coins), 10000);
  assert.equal(long.holdings.length, f.holdings.length);
});
test("pending downtime remains a required reviewed settlement and cannot be consumed by a session advance", () => {
  const f = fixture();
  const t = command(f, { kind: "downtime-plan", name: "Between sessions", days: 1 });
  assert.throws(() => previewSessionTime(t, 1, false), /pending downtime/);
  assert.throws(
    () =>
      command(t, {
        kind: "session-time",
        before: sessionTimeFingerprint(t),
        hours: 1,
        rest: "none",
        purseIds: [],
        allowDowntime: false,
        note: "",
      }),
    /pending downtime/,
  );
  assert.equal(readWorld(t.journal!.world).timeHistory.length, 0);
});

test("hourly downtime reuses estate reservations and carries fractional labor without granting travel work", async () => {
  const { readEstate, recipeSchema } = await import("./estate-schema.ts"),
    { estatePreset } = await import("./estate-catalogue.ts");
  const f = fixture(),
    recipe = recipeSchema.parse({
      key: "build",
      name: "Build house",
      laborDays: 2,
      laborCostCopper: 200,
      materials: [],
      resultTemplateKey: "house",
    });
  f.holdings.push({
    id: "warehouse",
    name: "Warehouse",
    purseId: "party",
    kind: "property",
    quantity: 1,
    unitCopper: 1000,
    notes: "",
    locationId: "city",
  });
  f.journal!.propertyOperations = readEstate({
    templates: [{ ...estatePreset("warehouse"), recipes: [recipe] }, estatePreset("house")],
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
    jobs: [
      {
        id: "job",
        propertyId: "warehouse",
        purseId: "party",
        name: "Build house",
        recipeKey: "build",
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
      },
    ],
  });
  const advance = (t: CloudTable, hours: number, work: boolean) =>
    command(t, {
      kind: "session-time",
      before: sessionTimeFingerprint(t),
      hours,
      rest: "none",
      purseIds: [],
      allowDowntime: work,
      note: "",
    });
  const travel = advance(f, 8, false);
  assert.equal(travel.journal!.propertyOperations!.jobs[0].progress, 0);
  let hourly = f;
  for (let hour = 0; hour < 24; hour++) hourly = advance(hourly, 1, true);
  assert.equal(hourly.journal!.propertyOperations!.jobs[0].progress, 100);
  assert.equal(hourly.journal!.propertyOperations!.jobs[0].characterWorkRemainder, 0);
  const daily = advance(f, 24, true);
  assert.equal(daily.journal!.propertyOperations!.jobs[0].progress, 100);
  const away = command(f, { kind: "party-location", before: "area", locationId: "away" });
  assert.equal(advance(away, 24, true).journal!.propertyOperations!.jobs[0].progress, 0);
  const finished = advance(hourly, 24, true);
  assert.equal(finished.journal!.propertyOperations!.jobs[0].status, "completed");
  assert.ok(finished.journal!.propertyOperations!.sites[0].completedTemplates.includes("house"));
});
