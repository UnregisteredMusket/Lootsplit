// Differential and replay tests (review P3c): offline buy, sell, give and
// listing purchases must give the same outcome as the shared command engine,
// pass its checks (quantity cap, ship trading position), and apply a retried
// action (same command ID) at most once.
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand, type CommandInput } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import {
  applyCloudTable,
  buyFromShop,
  buyListing,
  economySnapshot,
  executeLocalCommand,
  giveToPlayer,
  postCopper,
  sellToShop,
  setCoins,
} from "./economy.ts";
import { fromCopper, toCopper } from "./money.ts";
import { readJournal } from "./journal.ts";
import { readFinance } from "./finance.ts";
import { defaultShip, type Vessel } from "./ships-schema.ts";
import { shipFingerprint } from "./ships.ts";
import { saveGifts, saveRoster, loadGifts } from "./gift.ts";
import { DM_SEAT, setSeat, type Seat } from "./table.ts";

type SharedCommand = Parameters<typeof applyCommand>[2];
// The device's DM seat, as the shared engine sees it.
const localDm: CloudSeat = { id: "local", token: "", name: "Dungeon master", role: "dm", purseIds: [] };

const shop = {
  id: "s",
  name: "Shop",
  keeper: "",
  place: "",
  notes: "",
  sellRate: 1,
  buyRate: 0.5,
  wealth: "modest" as const,
  category: "mixed" as const,
  priceScale: 1,
};
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      {
        id: "a",
        name: "Ash",
        kind: "character",
        coins: fromCopper(10_000_000),
        sheet: undefined,
      },
      { id: "b", name: "Bryn", kind: "character", coins: fromCopper(500) },
    ],
    holdings: [
      {
        id: "old-rope",
        purseId: "a",
        kind: "item",
        name: "Rope",
        quantity: 5,
        unitCopper: 100,
        notes: "Hemp",
        category: "general",
      },
    ],
    shops: [shop],
    stock: [
      {
        id: "x",
        shopId: "s",
        name: "Rope",
        copper: 100,
        baseCopper: 100,
        rarity: "common",
        quantity: null,
        notes: "new stock",
        category: "general",
      },
    ],
    listings: [
      { id: "plot", name: "Hill plot", kind: "property", copper: 5000, quantity: 2, notes: "View" },
      { id: "cart", name: "Cart", kind: "item", copper: 300, quantity: null, notes: "" },
    ],
    // An existing line with a legacy random ID stays exactly as it was written.
    ledger: [
      {
        id: "3f1a9c52-legacy",
        at: 1,
        purseId: "a",
        shopId: null,
        summary: "Old purchase",
        copper: -10,
        transactionType: "purchase",
      },
    ],
    // Existing chat stays in place when a transfer adds its party message.
    notes: [{ id: "old-note", at: 1, from: "dm", to: "party", purseId: "a", text: "Welcome to the table." }],
    journal: readJournal({ finance: readFinance() }),
  };
}

/** What a money action may change, without wall-clock timestamps. */
function outcome(t: CloudTable) {
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((x, y) => x.id.localeCompare(y.id));
  return {
    purses: byId(t.purses).map((p) => ({ id: p.id, copper: toCopper(p.coins) })),
    holdings: byId(t.holdings).map((h) =>
      h.deed ? { ...h, deed: { ...h.deed, purchasedAt: 0 } } : h,
    ),
    stock: byId(t.stock),
    listings: byId(t.listings),
    ledger: byId(t.ledger).map((l) => ({
      ...l,
      at: 0,
      ...(l.listingPurchase?.holding.deed
        ? {
            listingPurchase: {
              ...l.listingPurchase,
              holding: {
                ...l.listingPurchase.holding,
                deed: { ...l.listingPurchase.holding.deed, purchasedAt: 0 },
              },
            },
          }
        : {}),
    })),
    notes: byId(t.notes).map((n) => ({ ...n, at: 0 })),
    events: (t.journal?.events ?? []).map((e) => ({ ...e, at: 0 })),
  };
}

const cases: Array<[string, CommandInput, (id: string) => Promise<void>]> = [
  [
    "buy",
    { kind: "buy", stockId: "x", purseId: "a", quantity: 3 },
    (id) => buyFromShop({ stockId: "x", purseId: "a", quantity: 3 }, { commandId: id }),
  ],
  [
    "sell",
    { kind: "sell", holdingId: "old-rope", shopId: "s", quantity: 2 },
    (id) => sellToShop({ holdingId: "old-rope", shopId: "s", quantity: 2 }, { commandId: id }),
  ],
  [
    "give (coins and an item)",
    { kind: "give", fromId: "a", toId: "b", copper: 250, holdingId: "old-rope", quantity: 1 },
    (id) =>
      giveToPlayer(
        { fromId: "a", toId: "b", copper: 250, holdingId: "old-rope", quantity: 1 },
        { commandId: id },
      ),
  ],
  [
    "listing (property deed)",
    { kind: "listing", listingId: "plot", purseId: "a", quantity: 1 },
    (id) => buyListing({ listingId: "plot", purseId: "a", quantity: 1 }, { commandId: id }),
  ],
  [
    "listing (item)",
    { kind: "listing", listingId: "cart", purseId: "a", quantity: 2 },
    (id) => buyListing({ listingId: "cart", purseId: "a", quantity: 2 }, { commandId: id }),
  ],
];

for (const [name, input, offline] of cases) {
  test(`offline ${name} writes the same records as the shared engine`, async () => {
    setSeat(DM_SEAT);
    await applyCloudTable(campaign());
    const base = await economySnapshot();
    const id = `cmd-${name.replace(/\W+/g, "-")}`;
    const shared = applyCommand(structuredClone(base), localDm, { ...input, id } as SharedCommand);
    await offline(id);
    const device = await economySnapshot();
    assert.deepEqual(outcome(device), outcome(shared));
    // Records are keyed by the command ID, and the legacy line is untouched.
    assert.ok(device.ledger.some((l) => l.id === id));
    assert.deepEqual(
      device.ledger.find((l) => l.id === "3f1a9c52-legacy"),
      campaign().ledger[0],
    );
    assert.ok(device.notes.some((n) => n.id === "old-note"));
  });

  test(`offline ${name} retried with the same command ID is applied once`, async () => {
    setSeat(DM_SEAT);
    await applyCloudTable(campaign());
    const id = `retry-${name.replace(/\W+/g, "-")}`;
    await offline(id);
    const once = outcome(await economySnapshot());
    await offline(id);
    assert.deepEqual(outcome(await economySnapshot()), once);
  });
}

test("a command ID reused for a different action is rejected, offline and in a shared room", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  await buyFromShop({ stockId: "x", purseId: "a", quantity: 1 }, { commandId: "same" });
  const before = outcome(await economySnapshot());
  await assert.rejects(
    buyFromShop({ stockId: "x", purseId: "a", quantity: 2 }, { commandId: "same" }),
    /already used for a different action/,
  );
  await assert.rejects(
    executeLocalCommand({ kind: "listing", listingId: "cart", purseId: "a", quantity: 1, id: "same" }),
    /already used for a different action/,
  );
  assert.deepEqual(outcome(await economySnapshot()), before);
});

test("actions without a caller command ID keep generating fresh IDs", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  await buyFromShop({ stockId: "x", purseId: "a", quantity: 1 });
  await buyFromShop({ stockId: "x", purseId: "a", quantity: 1 });
  const t = await economySnapshot();
  assert.equal(t.ledger.filter((l) => l.summary.startsWith("Bought 1 Rope")).length, 2);
  assert.equal(toCopper(t.purses.find((p) => p.id === "a")!.coins), 10_000_000 - 200);
});

test("the shared 100,000 quantity cap applies offline, for the DM and for a player link", async () => {
  const shared = (input: CommandInput) =>
    applyCommand(campaign(), localDm, { ...input, id: "cap" } as SharedCommand);
  assert.throws(() => shared({ kind: "buy", stockId: "x", purseId: "a", quantity: 200_000 }));
  assert.throws(() => shared({ kind: "listing", listingId: "cart", purseId: "a", quantity: 200_000 }));
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  await assert.rejects(
    buyFromShop({ stockId: "x", purseId: "a", quantity: 200_000 }),
    /at most 100,000/,
  );
  await assert.rejects(
    buyListing({ listingId: "cart", purseId: "a", quantity: 200_000 }),
    /at most 100,000/,
  );
  await assert.rejects(
    sellToShop({ holdingId: "old-rope", shopId: "s", quantity: 200_000 }),
    /at most 100,000/,
  );
  const player: Seat = { role: "player", purseIds: ["a"], shopIds: ["s"], openedAt: 0 };
  setSeat(player);
  try {
    await assert.rejects(
      buyFromShop({ stockId: "x", purseId: "a", quantity: 200_000 }),
      /at most 100,000/,
    );
    await assert.rejects(
      buyListing({ listingId: "cart", purseId: "a", quantity: 200_000 }),
      /at most 100,000/,
    );
  } finally {
    setSeat(DM_SEAT);
  }
  assert.equal(toCopper((await economySnapshot()).purses.find((p) => p.id === "a")!.coins), 10_000_000);
  // 100,000 itself is still accepted.
  await buyFromShop({ stockId: "x", purseId: "a", quantity: 100_000 });
});

test("player-link purchases, sales and gifts dedupe a retried command ID", async () => {
  setSeat(DM_SEAT);
  const t = campaign();
  await applyCloudTable(t);
  await saveGifts([]);
  await saveRoster(t.purses);
  setSeat({ role: "player", purseIds: ["a"], shopIds: ["s"], openedAt: 0 });
  try {
    for (let i = 0; i < 2; i++) {
      await buyFromShop({ stockId: "x", purseId: "a", quantity: 2 }, { commandId: "p-buy" });
      await sellToShop({ holdingId: "old-rope", shopId: "s", quantity: 1 }, { commandId: "p-sell" });
      await buyListing({ listingId: "cart", purseId: "a", quantity: 1 }, { commandId: "p-list" });
      await giveToPlayer(
        { fromId: "a", toId: "b", copper: 10, holdingId: null, quantity: 0 },
        { commandId: "p-give" },
      );
    }
    const after = await economySnapshot();
    assert.equal(toCopper(after.purses.find((p) => p.id === "a")!.coins), 10_000_000 - 200 + 50 - 300 - 10);
    for (const id of ["p-buy", "p-sell", "p-list", "p-give"])
      assert.equal(after.ledger.filter((l) => l.id === id).length, 1, id);
    assert.equal(after.holdings.find((h) => h.id === "old-rope")!.quantity, 4);
    assert.ok(after.holdings.some((h) => h.id === "p-buy-item"));
    assert.ok(after.holdings.some((h) => h.id === "p-list-item"));
    assert.deepEqual((await loadGifts()).map((g) => g.id), ["p-give"]);
  } finally {
    setSeat(DM_SEAT);
  }
});

test("DM coin postings and balance edits dedupe a retried command ID", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  await postCopper("b", 40, "Bounty", { commandId: "post-1" });
  await postCopper("b", 40, "Bounty", { commandId: "post-1" });
  await setCoins("b", fromCopper(1000), undefined, { commandId: "set-1" });
  await setCoins("b", fromCopper(1000), undefined, { commandId: "set-1" });
  await assert.rejects(postCopper("b", 41, "Bounty", { commandId: "post-1" }), /different action/);
  const t = await economySnapshot();
  assert.equal(toCopper(t.purses.find((p) => p.id === "b")!.coins), 1000);
  assert.deepEqual(
    t.ledger.filter((l) => l.purseId === "b").map((l) => [l.id, l.copper]).sort(),
    [["post-1", 40], ["set-1", 460]],
  );
});

// --- Ship trading position (assertShipTradingHere) ---------------------------
const dmSeat: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
function shipCampaign(): CloudTable {
  let t: CloudTable = {
    ...campaign(),
    holdings: [
      ...campaign().holdings,
      {
        id: "ship",
        name: "Dawn Trader",
        kind: "property",
        quantity: 1,
        unitCopper: 10000,
        purseId: "b",
        notes: "",
        locationId: "port",
        property: { type: "other" },
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
    dmNotes: "",
  };
  t = applyCommand(t, dmSeat, { kind: "ship-configure", id: "cfg", before: null, vessel });
  t = applyCommand(t, dmSeat, {
    kind: "ship-board",
    id: "board",
    propertyId: "ship",
    purseId: "a",
    action: "board",
    before: shipFingerprint(t, "ship"),
  });
  // The party moves on; the aboard character stays at the ship's port.
  t.journal!.market!.currentLocationId = "far";
  return t;
}

test("a player-link character aboard a ship away from the party cannot trade offline, as in a shared room", async () => {
  const t = shipCampaign();
  const player: CloudSeat = { id: "p", token: "p", name: "Ash", role: "player", purseIds: ["a"] };
  const inputs: CommandInput[] = [
    { kind: "buy", stockId: "x", purseId: "a", quantity: 1 },
    { kind: "sell", holdingId: "old-rope", shopId: "s", quantity: 1 },
    { kind: "listing", listingId: "cart", purseId: "a", quantity: 1 },
  ];
  for (const input of inputs)
    assert.throws(
      () => applyCommand(t, player, { ...input, id: "ship-" + input.kind } as SharedCommand),
      /aboard a ship/,
    );
  setSeat(DM_SEAT);
  await applyCloudTable(t);
  setSeat({ role: "player", purseIds: ["a"], shopIds: ["s"], openedAt: 0 });
  try {
    await assert.rejects(buyFromShop({ stockId: "x", purseId: "a", quantity: 1 }), /aboard a ship/);
    await assert.rejects(
      sellToShop({ holdingId: "old-rope", shopId: "s", quantity: 1 }),
      /aboard a ship/,
    );
    await assert.rejects(buyListing({ listingId: "cart", purseId: "a", quantity: 1 }), /aboard a ship/);
  } finally {
    setSeat(DM_SEAT);
  }
  // The DM can still trade on the character's behalf, as in a shared room.
  await buyFromShop({ stockId: "x", purseId: "a", quantity: 1 });
});
