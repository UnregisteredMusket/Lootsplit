import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand } from "./commands.ts";
import { emptyCloudTable, readCloudTable, type CloudSeat } from "./cloud.ts";
import {
  applyCloudTable,
  snapshot,
  readQuireFile,
  restore,
  economySnapshot,
  buyListing,
  giveToPlayer,
  sellToShop,
  blankShop,
} from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { readJournal, readArchivedSnapshot } from "./journal.ts";
import { projectRecord, archiveSession } from "./session-records.ts";
import { readListings } from "./market.ts";
import { propertyAvailableHere } from "./property.ts";
import { propertyDeedSvg, propertyDeedImage } from "./property-deed.ts";
import { toCopper } from "./money.ts";

const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = {
  id: "player",
  token: "player",
  name: "Player",
  role: "player",
  purseIds: ["hero"],
};
function fixture() {
  return {
    ...emptyCloudTable(),
    purses: [
      {
        id: "hero",
        name: "Álwen & Oak",
        kind: "character" as const,
        coins: { cp: 0, sp: 0, ep: 0, gp: 1000, pp: 0 },
      },
      {
        id: "other",
        name: "Borin",
        kind: "character" as const,
        coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    ],
    shops: [
      {
        ...blankShop(),
        id: "broker",
        name: "Estate broker",
        category: "mixed" as const,
        buyRate: 0.5,
      },
    ],
    journal: readJournal({
      market: {
        currentLocationId: "area",
        locations: [
          {
            id: "region",
            kind: "region",
            parentId: null,
            name: "Green Coast",
            description: "Coastal roads",
          },
          { id: "city", kind: "city", parentId: "region", name: "Port", description: "A harbor" },
          { id: "area", kind: "area", parentId: "city", name: "Docks", description: "Quays" },
          { id: "far", kind: "region", parentId: null, name: "Ashlands", description: "Distant" },
        ],
      },
    }),
    listings: [
      {
        id: "inn",
        name: "Lantern & Oak",
        kind: "property" as const,
        copper: 50000,
        quantity: 2,
        notes: "Inn with a cellar",
        locationId: "area",
        property: {
          type: "inn" as const,
          condition: "maintained" as const,
          rooms: 8,
          features: ["Stable", "Cellar"],
          images: ["/art/property-default.webp"],
        },
      },
    ],
  };
}
const purchase = {
  id: "purchase",
  kind: "listing" as const,
  listingId: "inn",
  purseId: "hero",
  quantity: 1,
};

test("property locations inherit the existing shop hierarchy and legacy listings remain lossless", () => {
  const table = fixture(),
    market = table.journal.market!;
  assert.deepEqual(
    [undefined, "region", "city", "area", "far"].map((locationId) =>
      propertyAvailableHere({ locationId }, market),
    ),
    [true, true, true, true, false],
  );
  assert.equal(
    propertyAvailableHere({ locationId: "far" }, { ...market, currentLocationId: null }),
    true,
  );
  const legacy = {
    id: "old",
    name: "Old mill",
    kind: "property" as const,
    copper: 100,
    quantity: null,
    notes: "Old notes",
  };
  assert.deepEqual(readListings([legacy]), [legacy]);
  assert.ok(readCloudTable({ ...emptyCloudTable(), listings: [legacy] }));
});
test("DM listing edits are stale-safe, validate locations/images and never modify existing finance or ownership", () => {
  const table = fixture(),
    before = table.listings[0];
  const command = {
    id: "edit",
    kind: "listing-edit" as const,
    listingId: before.id,
    before,
    after: { ...before, copper: 51000, status: "reserved" as const },
  };
  assert.throws(() => applyCommand(table, player, command), /Only the DM/);
  const changed = applyCommand(table, dm, command);
  assert.equal(changed.listings[0].status, "reserved");
  assert.throws(() => applyCommand(changed, dm, { ...command, id: "stale" }), /changed elsewhere/);
  assert.deepEqual(changed.purses, table.purses);
  assert.deepEqual(changed.holdings, table.holdings);
  assert.throws(
    () => applyCommand(table, dm, { ...command, after: { ...before, locationId: "missing" } }),
    /missing location/,
  );
  assert.equal(
    readCloudTable({
      ...table,
      listings: [
        { ...before, property: { ...before.property, images: ["data:image/svg+xml;base64,YQ=="] } },
      ],
    }),
    null,
  );
  assert.throws(
    () =>
      applyCommand(table, dm, {
        id: "remove-place",
        kind: "market-location",
        locationId: "area",
        before: table.journal.market!.locations[2],
        after: null,
      }),
    /assigned shops and properties/,
  );
  assert.deepEqual(table, fixture());
});
test("purchase copies location and particulars, debits once and issues a transaction-backed deed without creating extra wealth", () => {
  const table = fixture(),
    bought = applyCommand(table, player, { ...purchase, before: table.listings[0] });
  const holding = bought.holdings[0],
    receipt = bought.ledger[0];
  assert.equal(bought.listings[0].quantity, 1);
  assert.equal(toCopper(bought.purses[0].coins), 50000);
  assert.equal(holding.locationId, "area");
  assert.deepEqual(holding.property, table.listings[0].property);
  assert.equal(holding.deed!.transactionId, receipt.id);
  assert.equal(holding.deed!.totalCopper, -receipt.copper);
  assert.equal(holding.deed!.buyerName, "Álwen & Oak");
  assert.equal(holding.deed!.location, "Green Coast / Port / Docks");
  assert.equal(holding.deed!.ownerId, holding.purseId);
  assert.equal(bought.holdings.length, 1);
  assert.deepEqual(receipt.listingPurchase!.holding, holding);
  assert.notEqual(
    holding.property,
    table.listings[0].property,
    "Owned details are a separate snapshot",
  );
  assert.deepEqual(table, fixture(), "Input remains immutable");
});
test("unavailable, reserved, withdrawn, stale, foreign-owner and unaffordable purchases fail atomically", () => {
  const table = fixture();
  for (const change of [
    { locationId: "far" },
    { status: "reserved" as const },
    { status: "withdrawn" as const },
    { quantity: 0 },
    { copper: 100001 },
  ]) {
    const source = { ...table, listings: [{ ...table.listings[0], ...change }] },
      original = structuredClone(source);
    assert.throws(() => applyCommand(source, player, purchase));
    assert.deepEqual(source, original);
  }
  assert.throws(() => applyCommand(table, player, { ...purchase, purseId: "other" }), /permission/);
  assert.throws(
    () => applyCommand(table, player, { ...purchase, before: { ...table.listings[0], copper: 1 } }),
    /listing changed/,
  );
});
test("transferring a deed moves the property, preserves its original purchase and selling removes only the current inventory deed", () => {
  const table = applyCommand(fixture(), player, purchase),
    originalDeed = structuredClone(table.holdings[0].deed!);
  const transferred = applyCommand(table, player, {
    id: "transfer",
    kind: "give",
    fromId: "hero",
    toId: "other",
    copper: 0,
    holdingId: table.holdings[0].id,
    quantity: 1,
  });
  assert.equal(transferred.holdings.length, 1);
  const h = transferred.holdings[0];
  assert.equal(h.purseId, "other");
  assert.equal(h.deed!.ownerName, "Borin");
  assert.equal(h.deed!.previousDeedId, originalDeed.id);
  assert.equal(h.deed!.transactionId, originalDeed.transactionId);
  assert.equal(h.deed!.buyerName, originalDeed.buyerName);
  assert.deepEqual(h.property, table.holdings[0].property);
  const recipient = { ...player, purseIds: ["other"] };
  assert.throws(
    () =>
      applyCommand(transferred, player, {
        id: "steal",
        kind: "sell",
        holdingId: h.id,
        shopId: "broker",
        quantity: 1,
      }),
    /permission/,
  );
  const sold = applyCommand(transferred, recipient, {
    id: "sale",
    kind: "sell",
    holdingId: h.id,
    shopId: "broker",
    quantity: 1,
  });
  assert.equal(sold.holdings.length, 0);
  assert.equal(toCopper(sold.purses[1].coins), 25000);
  assert.equal(
    sold.ledger[0].listingPurchase!.holding.deed!.ownerName,
    originalDeed.ownerName,
    "Original receipt remains intact",
  );
});
test("partial property lots retain the remaining deed and transfer an independently identified deed for moved units", () => {
  const purchased = applyCommand(fixture(), player, { ...purchase, quantity: 2 });
  const moved = applyCommand(purchased, player, {
    id: "split",
    kind: "give",
    fromId: "hero",
    toId: "other",
    copper: 0,
    holdingId: purchased.holdings[0].id,
    quantity: 1,
  });
  assert.equal(moved.holdings.length, 2);
  assert.ok(moved.holdings.every((h) => h.quantity === 1));
  assert.equal(new Set(moved.holdings.map((h) => h.deed!.id)).size, 2);
  const sold = applyCommand(moved, player, {
    id: "partial-sale",
    kind: "sell",
    holdingId: moved.holdings[0].id,
    shopId: "broker",
    quantity: 1,
  });
  assert.equal(sold.holdings.length, 1);
  assert.equal(sold.holdings[0].purseId, "other");
});
test("players keep their owned property's location after moving, without seeing unrelated market listings; archives and backups preserve the deed", async () => {
  setSeat(DM_SEAT);
  let table = applyCommand(fixture(), player, purchase);
  table = applyCommand(table, dm, {
    id: "move",
    kind: "party-location",
    before: "area",
    locationId: "far",
  });
  archiveSession(table, "record", "Property session");
  const projected = projectRecord(table, player);
  assert.equal(projected.listings.length, 0);
  assert.deepEqual(
    projected.journal!.market!.locations.map((l) => l.id),
    ["region", "city", "area", "far"],
  );
  assert.ok(readCloudTable(projected));
  const archive = readArchivedSnapshot(projected.journal!.reports![0].snapshot);
  assert.equal(archive.holdings[0].deed!.buyerName, "Álwen & Oak");
  await applyCloudTable(table);
  const backup = readQuireFile(await snapshot());
  await applyCloudTable(emptyCloudTable());
  await restore(backup);
  assert.deepEqual((await economySnapshot()).holdings, table.holdings);
  const malformed = {
    ...backup,
    holdings: [{ ...backup.holdings[0], deed: { ...backup.holdings[0].deed!, ownerId: "other" } }],
  };
  await assert.rejects(restore(malformed), /property owner/);
  assert.deepEqual((await economySnapshot()).holdings, table.holdings);
});
test("device purchases, gifts and sales preserve the same deed lifecycle and never strip property metadata", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(fixture());
  await buyListing({ listingId: "inn", purseId: "hero", quantity: 1 });
  const bought = await economySnapshot(),
    h = bought.holdings[0];
  assert.equal(h.deed!.transactionId, bought.ledger[0].id);
  await giveToPlayer({ fromId: "hero", toId: "other", copper: 0, holdingId: h.id, quantity: 1 });
  const moved = (await economySnapshot()).holdings[0];
  assert.equal(moved.deed!.ownerName, "Borin");
  assert.deepEqual(moved.property, h.property);
  assert.equal(moved.locationId, h.locationId);
  await sellToShop({ holdingId: moved.id, shopId: "broker", quantity: 1 });
  assert.equal((await economySnapshot()).holdings.length, 0);
});
test("deed artwork contains complete escaped transaction/character/location text and cannot embed supplied markup", () => {
  const h = applyCommand(fixture(), player, purchase).holdings[0],
    deed = {
      ...h.deed!,
      propertyName: '<script>alert("x")</script>',
      location: "Port & Coast",
      ownerName: "A".repeat(170),
    };
  const svg = propertyDeedSvg(deed, 1);
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("Port &amp; Coast"));
  assert.ok(svg.includes("500 gp"));
  assert.ok(svg.includes(deed.transactionId));
  assert.ok(svg.includes("Álwen &amp; Oak"));
  assert.match(propertyDeedImage(deed), /^data:image\/svg\+xml;charset=utf-8,/);
  assert.ok(!svg.includes("https://"));
});
