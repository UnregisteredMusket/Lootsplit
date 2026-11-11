// Audit 2026-11-10 D3: a shop left on Edit while a potion sold (7 → 6) and was repriced (50 → 60 gp)
// wrote 7 and 50 gp back when the DM tabbed through the row. The row now sends one field with the
// value its box showed when typing started; the device and the room refuse a stale edit with the
// same words and change nothing.
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { applyCloudTable, economySnapshot, editStockLine } from "./economy.ts";
import { applyCommand, commandSchema, tablePatch, type Command } from "./commands.ts";
import { STOCK_REMOVED, type StockEdit } from "./stock-edit.ts";

const dm = { id: "dm", token: "", name: "DM", role: "dm" as const, purseIds: [] };
const potion = { id: "potion", shopId: "s", name: "Potion of healing", baseCopper: 5000, rarity: "common" as const, notes: "" };
const table = (quantity: number, copper: number, name = potion.name): CloudTable => ({
  ...emptyCloudTable(),
  shops: [
    { id: "s", name: "Apothecary", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "mixed", priceScale: 1 },
  ],
  stock: [{ ...potion, name, quantity, copper }],
});
const stockOf = (t: CloudTable) => t.stock.map(({ name, copper, quantity }) => ({ name, copper, quantity }));
// The values the DM's boxes showed before the sale and the reprice.
const staleEdits: [string, StockEdit][] = [
  ["quantity", { field: "quantity", shown: 7, value: 9 }],
  ["price", { field: "copper", shown: 5000, value: 5500 }],
  ["name", { field: "name", shown: "Healing draught", value: "Potion of greater healing" }],
];
const room = table(6, 6000);

/** The shared path (runSharedMutation): snapshot, edit the device copy, send the difference. */
async function shared(mirror: CloudTable, edit: StockEdit): Promise<Command | null> {
  await applyCloudTable(mirror);
  const before = await economySnapshot();
  await editStockLine("potion", edit);
  const patch = tablePatch(before, await economySnapshot());
  return patch.kind === "patch" && patch.changes.length ? commandSchema.parse({ ...patch, id: crypto.randomUUID() }) : null;
}

test("device: a stale quantity, price or name edit is refused and changes nothing", async () => {
  for (const [label, edit] of staleEdits) {
    await applyCloudTable(table(6, 6000, "Potion of healing"));
    const start = await economySnapshot();
    await assert.rejects(editStockLine("potion", edit), (error: Error) => {
      assert.match(error.message, /^(Potion of healing|Healing draught) changed while you were editing: /, label);
      assert.match(error.message, /Nothing was saved/, label);
      return true;
    });
    const after = await economySnapshot();
    assert.deepEqual(stockOf(after), stockOf(start), `${label}: stock unchanged`);
    assert.deepEqual(after.journal?.events, start.journal?.events, `${label}: no history line`);
  }
});

test("device: the refusal says what the line is now", async () => {
  await applyCloudTable(room);
  await assert.rejects(editStockLine("potion", staleEdits[0][1]), /quantity is now 6\./);
  await assert.rejects(editStockLine("potion", staleEdits[1][1]), /price is now 60 gp\./);
  await assert.rejects(
    editStockLine("potion", staleEdits[2][1]),
    /Healing draught changed while you were editing: it is now named Potion of healing\./,
  );
  await applyCloudTable({ ...room, stock: [] });
  await assert.rejects(editStockLine("potion", staleEdits[0][1]), /removed from the shop elsewhere/);
});

test("device: an edit made against the current value changes only its own field", async () => {
  await applyCloudTable(room);
  await editStockLine("potion", { field: "copper", shown: 6000, value: 6500 });
  await editStockLine("potion", { field: "quantity", shown: 6, value: null });
  await editStockLine("potion", { field: "name", shown: "Potion of healing", value: "Red draught" });
  const after = await economySnapshot();
  assert.deepEqual(stockOf(after), [{ name: "Red draught", copper: 6500, quantity: null }]);
  assert.equal(after.stock[0].baseCopper, 5000, "base price kept");
  assert.equal(after.journal?.events.filter((e: { summary: string }) => e.summary.includes("6000 cp → 6500 cp")).length, 1);
});

test("room: a stale edit is refused on the refreshed copy, so nothing is sent", async () => {
  for (const [label, edit] of staleEdits) {
    await assert.rejects(shared(room, edit), /changed while you were editing/, label);
    assert.deepEqual(stockOf(await economySnapshot()), stockOf(room), `${label}: device copy restored`);
  }
});

test("room: a stale edit from an out-of-date copy is refused by the room, with the same words", async () => {
  // The DM's copy still has 7 and 50 gp (pending actions skip the refresh); the room has 6 and 60 gp.
  for (const [label, edit] of staleEdits) {
    const mirror = table(7, 5000, edit.field === "name" ? "Healing draught" : potion.name);
    const command = await shared(mirror, edit);
    assert.ok(command, `${label}: the out-of-date copy accepted it, as it should locally`);
    let roomError = "";
    const server = structuredClone(room);
    assert.throws(
      () => applyCommand(server, dm, command),
      (error: Error) => ((roomError = error.message), true),
    );
    assert.deepEqual(stockOf(server), stockOf(room), `${label}: the room is unchanged`);
    // Parity: the device refuses the same edit against the room's line with the same message.
    await applyCloudTable(room);
    await assert.rejects(editStockLine("potion", edit), (error: Error) => error.message === roomError);
    assert.match(roomError, /changed while you were editing/, label);
  }
});

test("room: an edit against the current line is accepted and keeps other fields", async () => {
  const command = await shared(room, { field: "copper", shown: 6000, value: 6500 });
  assert.ok(command);
  const next = applyCommand(room, dm, command);
  assert.deepEqual(stockOf(next), [{ name: "Potion of healing", copper: 6500, quantity: 6 }]);
});

test("room: an older client's whole-line stock patch still applies when its baseline matches", () => {
  const line = room.stock[0];
  const next = applyCommand(room, dm, {
    id: "old-client",
    kind: "patch",
    changes: [{ store: "stock", id: "potion", before: line, after: { ...line, quantity: 4 } }],
  });
  assert.equal(next.stock[0].quantity, 4);
  // ...and one with an out-of-date baseline is refused with the clear message.
  assert.throws(
    () =>
      applyCommand(room, dm, {
        id: "old-client-stale",
        kind: "patch",
        changes: [{ store: "stock", id: "potion", before: { ...line, quantity: 7, copper: 5000 }, after: { ...line, quantity: 7, copper: 5000 } }],
      }),
    /Potion of healing changed while you were editing: quantity is now 6\./,
  );
});

test("room: an edit to a line removed elsewhere is refused with the device's words", async () => {
  const line = room.stock[0];
  const gone = { ...room, stock: [] };
  assert.throws(
    () => applyCommand(gone, dm, { id: "removed", kind: "patch", changes: [{ store: "stock", id: "potion", before: line, after: { ...line, quantity: 9 } }] }),
    (error: Error) => error.message === STOCK_REMOVED,
  );
  await applyCloudTable(gone);
  await assert.rejects(editStockLine("potion", staleEdits[0][1]), (error: Error) => error.message === STOCK_REMOVED);
});
