// Property-based checks (fast-check) for the money rules in CLAUDE.md: amounts are whole copper,
// nothing is created or lost, and the offline engine behaves exactly like the shared one.
// Each property runs many generated cases; a failure prints the smallest counterexample found.
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import fc from "fast-check";
import { applyCommand } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCloudTable, economySnapshot, giveToPlayer, buyFromShop } from "./economy.ts";
import {
  carryToStandard,
  carryUpTo,
  fromCopper,
  priceAfterCharisma,
  spendCoins,
  toCopper,
} from "./money.ts";
import { readJournal } from "./journal.ts";
import { readFinance } from "./finance.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import type { Coins } from "./types.ts";

type SharedCommand = Parameters<typeof applyCommand>[2];

const coinsArb: fc.Arbitrary<Coins> = fc.record({
  cp: fc.nat({ max: 1_000_000 }),
  sp: fc.nat({ max: 1_000_000 }),
  ep: fc.nat({ max: 1_000_000 }),
  gp: fc.nat({ max: 1_000_000 }),
  pp: fc.nat({ max: 1_000_000 }),
});
const isWholeCoins = (coins: Coins) =>
  Object.values(coins).every((value) => Number.isSafeInteger(value) && value >= 0);

test("copper converts to coins and back without gaining or losing any", () => {
  fc.assert(
    fc.property(fc.nat({ max: 1_000_000_000_000 }), (copper) => {
      const coins = fromCopper(copper);
      assert.ok(isWholeCoins(coins));
      assert.equal(toCopper(coins), copper);
    }),
  );
});

test("paying from a purse removes exactly the cost and leaves whole, non-negative coins", () => {
  fc.assert(
    fc.property(coinsArb, fc.nat({ max: 2_000_000_000 }), (coins, cost) => {
      const total = toCopper(coins);
      const after = spendCoins(coins, cost);
      if (cost > total) {
        assert.equal(after, null);
        return;
      }
      assert.ok(after, `spendCoins refused an affordable cost ${cost} from ${total}`);
      assert.ok(isWholeCoins(after));
      assert.equal(toCopper(after), total - cost);
    }),
  );
});

test("carrying coins up keeps the purse's value", () => {
  fc.assert(
    fc.property(coinsArb, fc.constantFrom("sp", "gp", "pp") as fc.Arbitrary<"sp" | "gp" | "pp">, (coins, stop) => {
      const carried = carryUpTo(coins, stop);
      assert.ok(isWholeCoins(carried));
      assert.equal(toCopper(carried), toCopper(coins));
      const standard = carryToStandard(coins);
      assert.ok(isWholeCoins(standard));
      assert.equal(toCopper(standard), toCopper(coins));
    }),
  );
});

test("a Charisma discount is whole copper, never above the asking price, and never grows as Charisma drops", () => {
  fc.assert(
    fc.property(fc.nat({ max: 10_000_000 }), fc.integer({ min: 1, max: 30 }), (asking, score) => {
      const price = priceAfterCharisma(asking, score);
      assert.ok(Number.isSafeInteger(price) && price >= 0 && price <= asking);
      assert.ok(priceAfterCharisma(asking, score - 1) >= price);
    }),
  );
});

// --- Engine parity: the same generated actions through the shared and offline engines. ---

const localDm: CloudSeat = { id: "local", token: "", name: "Dungeon master", role: "dm", purseIds: [] };
const PURSES = ["a", "b", "c"] as const;

function campaign(start: number[]): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: PURSES.map((id, index) => ({
      id,
      name: `Hero ${id}`,
      kind: "character" as const,
      coins: fromCopper(start[index] ?? 0),
    })),
    shops: [
      {
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
      },
    ],
    stock: [
      {
        id: "x",
        shopId: "s",
        name: "Rope",
        copper: 137,
        baseCopper: 137,
        rarity: "common" as const,
        quantity: null,
        notes: "",
        category: "general" as const,
      },
    ],
    journal: readJournal({ finance: readFinance() }),
  };
}

type Action =
  | { kind: "give"; from: number; to: number; copper: number }
  | { kind: "buy"; purse: number; quantity: number };
const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    kind: fc.constant("give" as const),
    from: fc.nat({ max: 2 }),
    to: fc.nat({ max: 2 }),
    copper: fc.nat({ max: 60_000 }),
  }),
  fc.record({
    kind: fc.constant("buy" as const),
    purse: fc.nat({ max: 2 }),
    quantity: fc.integer({ min: 1, max: 40 }),
  }),
);

/** Balances only: what a sequence of money actions may change. */
// Command IDs must be unique across generated runs: offline dedupes on IDs it has already applied.
let runCounter = 0;
const balances = (table: CloudTable) =>
  PURSES.map((id) => toCopper(table.purses.find((p) => p.id === id)!.coins));

test("random give/buy sequences: offline matches the shared engine, and gives conserve copper", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.nat({ max: 50_000 }), { minLength: 3, maxLength: 3 }),
      fc.array(actionArb, { minLength: 1, maxLength: 6 }),
      async (start, actions) => {
        setSeat(DM_SEAT);
        await applyCloudTable(campaign(start));
        let shared = structuredClone(await economySnapshot());
        let spentAtShop = 0;
        const run = ++runCounter;
        for (const [index, action] of actions.entries()) {
          const id = `prop-${run}-${index}`;
          const input =
            action.kind === "give"
              ? {
                  kind: "give",
                  fromId: PURSES[action.from],
                  toId: PURSES[action.to],
                  copper: action.copper,
                  holdingId: null,
                  quantity: 1,
                }
              : { kind: "buy", stockId: "x", purseId: PURSES[action.purse], quantity: action.quantity };
          let sharedError: string | null = null;
          try {
            shared = applyCommand(structuredClone(shared), localDm, { ...input, id } as SharedCommand);
          } catch (error) {
            sharedError = error instanceof Error ? error.message : String(error);
          }
          let offlineError: string | null = null;
          try {
            if (action.kind === "give")
              await giveToPlayer(
                {
                  fromId: PURSES[action.from],
                  toId: PURSES[action.to],
                  copper: action.copper,
                  holdingId: null,
                  quantity: 1,
                },
                { commandId: id },
              );
            else
              await buyFromShop(
                { stockId: "x", purseId: PURSES[action.purse], quantity: action.quantity },
                { commandId: id },
              );
          } catch (error) {
            offlineError = error instanceof Error ? error.message : String(error);
          }
          assert.equal(
            offlineError === null,
            sharedError === null,
            `action ${index} ${JSON.stringify(action)}: shared ${sharedError ?? "ok"}, offline ${offlineError ?? "ok"}`,
          );
          if (!sharedError && action.kind === "buy") spentAtShop += 137 * action.quantity;
          assert.deepEqual(balances(await economySnapshot()), balances(shared), `after action ${index}`);
        }
        const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
        assert.equal(total(balances(shared)), total(start) - spentAtShop, "copper was created or lost");
      },
    ),
    { numRuns: 40 },
  );
});
