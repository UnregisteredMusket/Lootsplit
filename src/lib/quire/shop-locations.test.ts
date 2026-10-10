import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand, type CommandInput } from "./commands.ts";
import { emptyCloudTable, readCloudTable, type CloudSeat } from "./cloud.ts";
import {
  applyCloudTable,
  blankShop,
  snapshot,
  readQuireFile,
  restore,
  economySnapshot,
} from "./economy.ts";
import { preserveJournalMetadata, readArchivedSnapshot, readJournal } from "./journal.ts";
import { projectRecord, archiveSession } from "./session-records.ts";
import {
  globalMarketCity,
  readMarketLocations,
  shopAvailableHere,
  type MarketLocations,
} from "./shop-locations.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { toCopper } from "./money.ts";

export const marketFixture: MarketLocations = {
  currentLocationId: "area",
  locations: [
    {
      id: "region",
      kind: "region",
      parentId: null,
      name: "Green Coast",
      description: "Coastal roads",
      image: "/art/shop-default.webp",
    },
    {
      id: "city",
      kind: "city",
      parentId: "region",
      name: "Port",
      description: "A harbor",
      image: "/art/shop-default.webp",
    },
    {
      id: "area",
      kind: "area",
      parentId: "city",
      name: "Docks",
      description: "Quays",
      image: "/art/shop-default.webp",
    },
    { id: "sibling", kind: "area", parentId: "city", name: "Hill", description: "Uptown" },
    { id: "town", kind: "town", parentId: "region", name: "Village", description: "Rural" },
    { id: "other", kind: "region", parentId: null, name: "Desert", description: "Dunes" },
  ],
};
test("global market access needs a city or city area, never a town, region or unknown location", () => {
  assert.equal(globalMarketCity(marketFixture)?.id, "city");
  assert.equal(globalMarketCity({ ...marketFixture, currentLocationId: "city" })?.id, "city");
  for (const currentLocationId of [null, "region", "town", "other", "missing"])
    assert.equal(globalMarketCity({ ...marketFixture, currentLocationId }), undefined);
  assert.equal(
    globalMarketCity({
      ...marketFixture,
      currentLocationId: "town-area",
      locations: [
        ...marketFixture.locations,
        { id: "town-area", kind: "area", parentId: "town", name: "Town square", description: "" },
      ],
    }),
    undefined,
  );
});
const dm: CloudSeat = { id: "dm", name: "DM", token: "dm", role: "dm", purseIds: [] };
const player: CloudSeat = {
  id: "player",
  name: "Hero",
  token: "player",
  role: "player",
  purseIds: ["hero"],
};
function fixture() {
  const shops = [undefined, ...marketFixture.locations.map((location) => location.id)].map(
    (locationId, i) => ({
      ...blankShop(),
      id: `shop-${i}`,
      name: `Shop ${i}`,
      ...(locationId ? { locationId } : {}),
      image: "/art/shop-default.webp",
      place: "Preserved street address",
      keeper: "Keeper",
      notes: "Custom notes",
      sellRate: 1.2,
      buyRate: 0.7,
      priceScale: 1.4,
      acceptedCategories: ["general"],
      schedule: {
        cycleDays: 7,
        openDays: [0, 1, 2],
        restockEveryDays: 7,
        restockQuantity: 3,
        lastRestockDay: 0,
      },
    }),
  );
  return {
    ...emptyCloudTable(),
    journal: readJournal({ market: structuredClone(marketFixture) }),
    shops,
    stock: shops.map((shop) => ({
      id: `${shop.id}-stock`,
      shopId: shop.id,
      name: "Item",
      copper: 10,
      baseCopper: 10,
      quantity: 5,
      rarity: "common" as const,
      notes: "Stock notes",
      category: "general",
    })),
    purses: [
      {
        id: "hero",
        name: "Hero",
        kind: "character" as const,
        coins: { cp: 0, sp: 0, ep: 0, gp: 20, pp: 0 },
      },
    ],
    holdings: [
      {
        id: "item",
        purseId: "hero",
        name: "Item",
        kind: "item" as const,
        quantity: 3,
        unitCopper: 10,
        notes: "Personal equipment",
        category: "general",
      },
    ],
  };
}
test("areas inherit only their region and settlement shops; old campaigns and unset locations retain all shops", () => {
  const table = fixture(),
    market = table.journal.market!;
  assert.deepEqual(
    table.shops.filter((shop) => shopAvailableHere(shop, market)).map((shop) => shop.id),
    ["shop-0", "shop-1", "shop-2", "shop-3"],
  );
  assert.deepEqual(
    table.shops
      .filter((shop) => shopAvailableHere(shop, { ...market, currentLocationId: "region" }))
      .map((shop) => shop.id),
    ["shop-0", "shop-1"],
  );
  assert.equal(
    table.shops.filter((shop) => shopAvailableHere(shop, { ...market, currentLocationId: null }))
      .length,
    table.shops.length,
  );
  const legacy = { ...emptyCloudTable(), shops: [{ ...blankShop(), place: "Docks" }] };
  assert.ok(readCloudTable(legacy));
  assert.equal(projectRecord(legacy, player).shops.length, 1);
  assert.equal(readJournal({}).market, undefined);
});
test("only the DM manages locations, party movement and shop images; stale changes never overwrite newer values", () => {
  const table = fixture(),
    place = table.journal.market!.locations[0];
  const changes = [
    {
      kind: "market-location",
      locationId: place.id,
      before: place,
      after: { ...place, name: "New region" },
    },
    { kind: "party-location", before: "area", locationId: "other" },
    {
      kind: "shop-location",
      shopId: "shop-3",
      before: { locationId: "area", image: "/art/shop-default.webp" },
      locationId: "other",
      image: null,
    },
  ] satisfies CommandInput[];
  for (const command of changes)
    assert.throws(
      () => applyCommand(table, player, { ...command, id: "unauthorized" }),
      /Only the DM/,
    );
  const changed = applyCommand(table, dm, { ...changes[0], id: "rename" });
  assert.throws(
    () => applyCommand(changed, dm, { ...changes[0], id: "stale" }),
    /changed elsewhere/,
  );
  assert.equal(
    changed.journal!.market!.locations.find((location) => location.id === "region")?.name,
    "New region",
  );
  const moved = applyCommand(table, dm, { ...changes[1], id: "move" });
  assert.throws(() => applyCommand(moved, dm, { ...changes[1], id: "stale-move" }), /party moved/);
  const assigned = applyCommand(table, dm, { ...changes[2], id: "assign" });
  assert.throws(
    () => applyCommand(assigned, dm, { ...changes[2], id: "stale-shop" }),
    /changed elsewhere/,
  );
  assert.deepEqual(assigned.stock, table.stock);
  const { image: _image, locationId: _locationId, ...before } = table.shops[3];
  const { locationId: _newLocationId, ...after } = assigned.shops[3];
  assert.deepEqual(
    after,
    before,
    "Assignment preserves every other shop control, including schedule and rates",
  );
  assert.deepEqual(table, fixture(), "Command input is immutable");
});
test("hierarchy and image validation reject dangling parents, cycles, duplicate IDs, unsafe images and missing assignments", () => {
  for (const locations of [
    [{ ...marketFixture.locations[0], parentId: "area" }],
    [{ ...marketFixture.locations[1], parentId: "missing" }],
    [{ ...marketFixture.locations[0], image: "data:image/svg+xml;base64,YQ==" }],
    [marketFixture.locations[0], marketFixture.locations[0]],
  ])
    assert.throws(() => readMarketLocations({ locations, currentLocationId: null }));
  assert.equal(
    readCloudTable({ ...fixture(), shops: [{ ...fixture().shops[0], locationId: "missing" }] }),
    null,
  );
  assert.throws(() =>
    applyCommand(fixture(), dm, {
      id: "missing",
      kind: "party-location",
      before: "area",
      locationId: "missing",
    }),
  );
});
test("location removal requires explicitly moving child places, assigned shops and the party first", () => {
  const table = fixture();
  for (const location of table.journal.market!.locations)
    assert.throws(
      () =>
        applyCommand(table, dm, {
          id: "remove",
          kind: "market-location",
          locationId: location.id,
          before: location,
          after: null,
        }),
      /Move the party/,
    );
  const unused = {
    id: "unused",
    kind: "region" as const,
    name: "Unused",
    parentId: null,
    description: "",
  };
  const added = applyCommand(table, dm, {
    id: "create",
    kind: "market-location",
    locationId: unused.id,
    before: null,
    after: unused,
  });
  const removed = applyCommand(added, dm, {
    id: "remove",
    kind: "market-location",
    locationId: unused.id,
    before: unused,
    after: null,
  });
  assert.deepEqual(removed.journal!.market, table.journal.market);
  assert.deepEqual(removed.shops, table.shops);
});
test("server purchase and sale reject shops outside the location atomically; valid trades and DM controls remain available", () => {
  const table = fixture(),
    original = structuredClone(table);
  for (const shopId of ["shop-4", "shop-5", "shop-6"]) {
    assert.throws(
      () =>
        applyCommand(table, player, {
          id: "buy",
          kind: "buy",
          stockId: `${shopId}-stock`,
          purseId: "hero",
          quantity: 1,
        }),
      /not available/,
    );
    assert.throws(
      () =>
        applyCommand(table, player, {
          id: "sell",
          kind: "sell",
          shopId,
          holdingId: "item",
          quantity: 1,
        }),
      /not available/,
    );
  }
  assert.deepEqual(table, original);
  const bought = applyCommand(table, player, {
    id: "buy",
    kind: "buy",
    stockId: "shop-3-stock",
    purseId: "hero",
    quantity: 1,
  });
  assert.equal(bought.stock[3].quantity, 4);
  assert.equal(toCopper(bought.purses[0].coins), 1988);
  assert.equal(bought.ledger[0].copper, -12);
  assert.equal(
    applyCommand(table, player, {
      id: "sell",
      kind: "sell",
      shopId: "shop-2",
      holdingId: "item",
      quantity: 1,
    }).ledger[0].copper,
    7,
  );
  assert.equal(
    applyCommand(table, dm, {
      id: "dm-buy",
      kind: "buy",
      stockId: "shop-6-stock",
      purseId: "hero",
      quantity: 1,
    }).stock[6].quantity,
    4,
  );
});
test("player projections and archived sessions retain shared path/shop images while excluding unrelated locations and stock", () => {
  const table = fixture();
  archiveSession(table, "session", "Session");
  const projected = projectRecord(table, player);
  assert.deepEqual(
    projected.journal!.market!.locations.map((location) => location.id),
    ["region", "city", "area"],
  );
  assert.equal(projected.journal!.market!.locations.filter((location) => location.image).length, 3);
  assert.deepEqual(
    projected.shops.map((shop) => shop.id),
    ["shop-0", "shop-1", "shop-2", "shop-3"],
  );
  assert.ok(projected.shops.every((shop) => shop.image));
  assert.equal(projected.stock.length, 4);
  const archived = readArchivedSnapshot(projected.journal!.reports![0].snapshot);
  assert.equal(archived.shops.length, 4);
  assert.equal(archived.journal!.market!.locations.length, 3);
  assert.equal(projectRecord(table, dm).shops.length, 7);
  assert.deepEqual(preserveJournalMetadata({}, table.journal).market, table.journal.market);
});
test("complete backup/restore preserves location images and configured shops; malformed references fail before replacement", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(fixture());
  const backup = readQuireFile(await snapshot());
  assert.deepEqual(backup.journal!.market, marketFixture);
  await applyCloudTable(emptyCloudTable());
  await restore(backup);
  const restored = await economySnapshot();
  assert.deepEqual(restored.journal!.market, marketFixture);
  assert.deepEqual(restored.shops, fixture().shops);
  const malformed = { ...backup, shops: [{ ...backup.shops[0], locationId: "missing" }] };
  await assert.rejects(restore(malformed), /missing location/);
  assert.deepEqual((await economySnapshot()).shops, restored.shops);
});
