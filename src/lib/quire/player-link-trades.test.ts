// Player-link shop trades (audit 2026-11-10, A8): on a device in the player role outside a room
// ("Switch to player", or an old player-link save), Buy and Sell run the shared command engine with
// the device's player seat, exactly as the DM's device and a shared room do. Selling an unidentified
// item names it as presented, never by its true name.
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand, type CommandInput } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCloudTable, buyFromShop, economySnapshot, sellToShop } from "./economy.ts";
import { fromCopper, toCopper } from "./money.ts";
import { readJournal } from "./journal.ts";
import { readFinance } from "./finance.ts";
import { DM_SEAT, setSeat, type Seat } from "./table.ts";

type SharedCommand = Parameters<typeof applyCommand>[2];
// The device's player seat, as the shared engine sees it (economy.ts `localSeat`).
const localPlayer: CloudSeat = { id: "local", token: "", name: "Player", role: "player", purseIds: ["a"] };
const playerLink: Seat = { role: "player", purseIds: ["a"], shopIds: ["s"], openedAt: 0 };

function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "a", name: "Ash", kind: "character", coins: fromCopper(100_000) },
      { id: "b", name: "Bryn", kind: "character", coins: fromCopper(500) },
    ],
    holdings: [
      { id: "rope", purseId: "a", kind: "item", name: "Rope", quantity: 5, unitCopper: 100, notes: "Hemp", category: "general" },
      {
        id: "blade",
        purseId: "a",
        kind: "item",
        name: "Vorpal Sword",
        quantity: 1,
        unitCopper: 2_000_000,
        notes: "Snicker-snack.",
        category: "weapons",
        unidentified: { name: "Old blade", description: "Notched and dull.", value: 400 },
      },
    ],
    shops: [
      {
        id: "s",
        name: "Shop",
        keeper: "",
        place: "",
        notes: "",
        sellRate: 1,
        buyRate: 0.5,
        wealth: "modest",
        category: "mixed",
        priceScale: 1,
      },
    ],
    stock: [
      {
        id: "x",
        shopId: "s",
        name: "Lantern",
        copper: 500,
        baseCopper: 500,
        rarity: "common",
        quantity: 4,
        notes: "Hooded",
        category: "general",
      },
    ],
    journal: readJournal({ finance: readFinance() }),
  };
}

/** What a trade may change, without wall-clock timestamps. */
function outcome(t: CloudTable) {
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => x.id.localeCompare(y.id));
  return {
    purses: byId(t.purses).map((p) => ({ id: p.id, copper: toCopper(p.coins) })),
    holdings: byId(t.holdings),
    shops: byId(t.shops),
    stock: byId(t.stock),
    ledger: byId(t.ledger).map((l) => ({ ...l, at: 0 })),
    events: (t.journal?.events ?? []).map((e) => ({ ...e, at: 0 })),
  };
}

async function asPlayerLink<T>(work: () => Promise<T>): Promise<T> {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  setSeat(playerLink);
  try {
    return await work();
  } finally {
    setSeat(DM_SEAT);
  }
}

test("A8: a player-link sale of an unidentified item names it as presented in the ledger", async () => {
  const after = await asPlayerLink(async () => {
    await sellToShop({ holdingId: "blade", shopId: "s", quantity: 1 }, { commandId: "sell-blade" });
    return economySnapshot();
  });
  const line = after.ledger.find((l) => l.id === "sell-blade");
  assert.ok(line, "the sale is recorded under its command ID");
  assert.doesNotMatch(JSON.stringify(after.ledger), /Vorpal/);
  assert.match(line.summary, /Old blade/);
  // Priced at the presented value (400 cp at buy rate 0.5), never the true one.
  assert.equal(line.copper, 200);
});

const cases: Array<[string, CommandInput, (ID: string) => Promise<void>]> = [
  ["buy", { kind: "buy", stockId: "x", purseId: "a", quantity: 2 }, (ID) => buyFromShop({ stockId: "x", purseId: "a", quantity: 2 }, { commandId: ID })],
  ["sell", { kind: "sell", holdingId: "rope", shopId: "s", quantity: 2 }, (ID) => sellToShop({ holdingId: "rope", shopId: "s", quantity: 2 }, { commandId: ID })],
  ["sell (unidentified)", { kind: "sell", holdingId: "blade", shopId: "s", quantity: 1 }, (ID) => sellToShop({ holdingId: "blade", shopId: "s", quantity: 1 }, { commandId: ID })],
];

for (const [name, input, offline] of cases) {
  test(`A8 parity: player-link ${name} writes what the shared engine writes for a player seat`, async () => {
    const id = "parity-" + name.replace(/\W+/g, "-");
    const shared = applyCommand(campaign(), localPlayer, { ...input, id } as SharedCommand);
    const device = await asPlayerLink(async () => {
      await offline(id);
      // A retry of the same action changes nothing.
      await offline(id);
      return economySnapshot();
    });
    assert.deepEqual(outcome(device), outcome(shared));
  });
}

test("A8 parity: player-link refusals use the shared engine's words and change nothing", async () => {
  const refusals: Array<[CommandInput, () => Promise<void>]> = [
    [{ kind: "buy", stockId: "x", purseId: "a", quantity: 9 }, () => buyFromShop({ stockId: "x", purseId: "a", quantity: 9 })],
    [{ kind: "buy", stockId: "x", purseId: "b", quantity: 1 }, () => buyFromShop({ stockId: "x", purseId: "b", quantity: 1 })],
    [{ kind: "sell", holdingId: "rope", shopId: "s", quantity: 6 }, (ID) => sellToShop({ holdingId: "rope", shopId: "s", quantity: 6 })],
  ];
  const base = campaign();
  base.holdings.push({ id: "b-rope", purseId: "b", kind: "item", name: "Rope", quantity: 1, unitCopper: 100, notes: "", category: "general" });
  for (const [input, offline] of refusals) {
    let sharedError = "";
    try {
      applyCommand(base, localPlayer, { ...input, id: "r" } as SharedCommand);
    } catch (error) {
      sharedError = (error as Error).message;
    }
    assert.ok(sharedError, `the shared engine refuses ${JSON.stringify(input)}`);
    const before = await asPlayerLink(() => economySnapshot());
    const message = await asPlayerLink(() => offline().then(() => "", (e: Error) => e.message));
    assert.equal(message, sharedError);
    const after = await asPlayerLink(() => economySnapshot());
    assert.deepEqual(outcome(after), outcome(before));
  }
  // Selling another character's item is refused on the player link.
  setSeat(DM_SEAT);
  await applyCloudTable(base);
  setSeat(playerLink);
  try {
    await assert.rejects(sellToShop({ holdingId: "b-rope", shopId: "s", quantity: 1 }), /permission/);
  } finally {
    setSeat(DM_SEAT);
  }
});
