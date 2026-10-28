import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand, type CommandInput } from "./commands.ts";
import { canonicalJson } from "./canonical-json.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import { tradeFixture } from "./test-fixtures/trade-economy.ts";
import { toCopper } from "./money.ts";
import { applyCloudTable, buyFromShop, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { purchaseUndoable, receiptHolding, receiptLines } from "./action-receipt.ts";

// Undo on a purchase's result toast is the existing DM ledger void with a command ID derived
// from the purchase's (economy-context.tsx `undoPurchase`). These tests pin that it restores
// coins, stock and items exactly once, refuses once anything depends on the purchase, and
// behaves the same in a shared room and on this device.
const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const act = (table: CloudTable, command: CommandInput & { id: string }, seat = dm) =>
  applyCommand(table, seat, command, { source: "server", random: () => 50 });
const wallet = (table: CloudTable, id: string) =>
  toCopper(table.purses.find((p) => p.id === id)!.coins);
function shopFixture() {
  const table = tradeFixture();
  table.shops.push({
    id: "outfitter", name: "Outfitter", keeper: "", place: "", notes: "", sellRate: 1,
    buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1,
  });
  table.stock.push({
    id: "rope", shopId: "outfitter", name: "Rope", copper: 100, baseCopper: 100,
    rarity: "common", quantity: 5, notes: "50 feet", category: "general",
  });
  return table;
}
const undo = (table: CloudTable, commandId: string, seat = dm) => {
  const line = purchaseUndoable(table.ledger, commandId, seat.role)!;
  return act(table, {
    id: commandId + "-undo",
    kind: "ledger-void",
    target: { kind: "ledger", id: line.id },
    before: canonicalJson(line),
    reason: "Purchase undone from its result.",
  }, seat);
};

test("Undo on a DM purchase restores coins, stock and the item once, and its receipt shows both lines", () => {
  const initial = shopFixture();
  const bought = act(initial, { id: "buy-1", kind: "buy", stockId: "rope", purseId: "a", quantity: 2 });
  assert.equal(wallet(bought, "a"), wallet(initial, "a") - 200);
  assert.ok(receiptHolding(bought.holdings, "buy-1-item"));
  assert.deepEqual(receiptLines(bought.ledger, "buy-1").map((l) => l.id), ["buy-1"]);
  // Only the DM is offered Undo; players cannot void (the command refuses them too).
  assert.equal(purchaseUndoable(bought.ledger, "buy-1", "player"), undefined);
  assert.ok(purchaseUndoable(bought.ledger, "buy-1", "dm"));

  const undone = undo(bought, "buy-1");
  assert.equal(wallet(undone, "a"), wallet(initial, "a"));
  assert.equal(undone.stock.find((s) => s.id === "rope")!.quantity, 5);
  assert.equal(receiptHolding(undone.holdings, "buy-1-item"), undefined);
  const lines = receiptLines(undone.ledger, "buy-1");
  assert.deepEqual(lines.map((l) => l.copper), [-200, 200]);
  assert.equal(lines[1].reversalOf, "buy-1");
  // No second Undo is offered, and replaying the same undo command changes nothing.
  assert.equal(purchaseUndoable(undone.ledger, "buy-1", "dm"), undefined);
  const line = bought.ledger.find((l) => l.id === "buy-1")!;
  const replay = act(undone, {
    id: "buy-1-undo", kind: "ledger-void", target: { kind: "ledger", id: line.id },
    before: canonicalJson(line), reason: "Purchase undone from its result.",
  });
  assert.equal(canonicalJson(replay.purses), canonicalJson(undone.purses));
  assert.equal(canonicalJson(replay.ledger), canonicalJson(undone.ledger));
});

test("Undo refuses once something depends on the purchase (the item was given away)", () => {
  const bought = act(shopFixture(), { id: "buy-2", kind: "buy", stockId: "rope", purseId: "a", quantity: 1 });
  const other = bought.purses.find((p) => p.id !== "a" && p.kind === "character" && !p.nonParty);
  assert.ok(other, "fixture has a second character");
  const given = act(bought, {
    id: "give-1", kind: "give", fromId: "a", toId: other!.id, copper: 0, holdingId: "buy-2-item", quantity: 1,
  });
  const before = canonicalJson(given);
  assert.throws(() => undo(given, "buy-2"), /changed or left/);
  assert.equal(canonicalJson(given), before);
  // A give's receipt lists both legs.
  assert.deepEqual(receiptLines(given.ledger, "give-1").map((l) => l.id).sort(), ["give-1", "give-1-received"]);
});

test("Undo behaves the same on this device as in a shared room", async () => {
  setSeat(DM_SEAT);
  const shared = undo(
    act(shopFixture(), { id: "buy-3", kind: "buy", stockId: "rope", purseId: "a", quantity: 3 }),
    "buy-3",
  );
  await applyCloudTable(shopFixture());
  await buyFromShop({ stockId: "rope", purseId: "a", quantity: 3 }, { commandId: "buy-3" });
  const local = await economySnapshot();
  const line = purchaseUndoable(local.ledger, "buy-3", "dm")!;
  const command = {
    id: "buy-3-undo", kind: "ledger-void" as const, target: { kind: "ledger" as const, id: line.id },
    before: canonicalJson(line), reason: "Purchase undone from its result.",
  };
  await executeLocalCommand(command);
  await executeLocalCommand(command); // a repeated Undo applies once
  const after = await economySnapshot();
  assert.equal(wallet(after as CloudTable, "a"), wallet(shared, "a"));
  assert.equal(after.stock.find((s) => s.id === "rope")!.quantity, shared.stock.find((s) => s.id === "rope")!.quantity);
  assert.equal(receiptHolding(after.holdings, "buy-3-item"), undefined);
  assert.deepEqual(
    receiptLines(after.ledger, "buy-3").map((l) => [l.copper, l.reversalOf ?? null]),
    receiptLines(shared.ledger, "buy-3").map((l) => [l.copper, l.reversalOf ?? null]),
  );
});
