import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { applyCloudTable, applyBill, economySnapshot, giveToPlayer, snapshot } from "./economy.ts";
import { emptyCloudTable } from "./cloud.ts";
import { applyCommand } from "./commands.ts";
import { emptyCoins, toCopper } from "./money.ts";
import { buildBill, readShare, setSeat, DM_SEAT } from "./table.ts";
import { loadGifts, saveGifts, saveRoster, readGifts } from "./gift.ts";
const pc = (id: string) => ({
  id,
  name: id,
  kind: "character" as const,
  coins: { ...emptyCoins(), gp: 10 },
});
const item = {
  id: "blade",
  purseId: "A",
  name: " Family blade ",
  kind: "item" as const,
  quantity: 3,
  unitCopper: 400,
  notes: "Family crest; magical light once per day",
  weight: 3,
  image: "/art/rogue.webp",
  category: "Weapons",
  equipped: true,
};
const initial = () => ({
  ...emptyCloudTable(),
  purses: [pc("A"), pc("B")],
  holdings: [{ ...item }],
});
const move = { fromId: "A", toId: "B", copper: 25, holdingId: "blade", quantity: 1 };
function assertItems(table: ReturnType<typeof initial>, received: number) {
  const from = table.holdings.find((h) => h.purseId === "A");
  assert.deepEqual(from, { ...item, quantity: 3 - received });
  const arrivals = table.holdings.filter((h) => h.purseId === "B");
  assert.equal(
    arrivals.reduce((n, h) => n + h.quantity, 0),
    received,
  );
  for (const h of arrivals)
    assert.deepEqual(h, { ...item, id: h.id, purseId: "B", quantity: h.quantity });
  assert.equal(
    table.purses.reduce((n, p) => n + toCopper(p.coins), 0),
    2000,
  );
}
test("local and shared transfers preserve complete item metadata and total assets", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(initial());
  await giveToPlayer(move);
  assertItems((await economySnapshot()) as ReturnType<typeof initial>, 1);
  const actor = { id: "p", token: "t", name: "A", role: "player" as const, purseIds: ["A"] };
  const command = { ...move, id: "give", kind: "give" as const };
  const shared = applyCommand(initial(), actor, command);
  assertItems(shared as ReturnType<typeof initial>, 1);
  assert.throws(
    () => applyCommand(initial(), { ...actor, purseIds: ["B"] }, command),
    /permission/,
  );
  await assert.rejects(giveToPlayer({ ...move, quantity: 99 }), /many/);
  assertItems((await economySnapshot()) as ReturnType<typeof initial>, 1);
});
test("multiple manual transfers survive export/import with metadata and cannot be applied twice", async () => {
  const base = initial();
  await applyCloudTable(base);
  await saveGifts([]);
  await saveRoster(base.purses);
  const seat = { role: "player" as const, purseIds: ["A"], shopIds: [], openedAt: 0 };
  setSeat(seat);
  let bill;
  try {
    await giveToPlayer(move);
    await giveToPlayer(move);
    const pending = await loadGifts();
    assert.equal(pending.length, 2);
    const { id, purseId, ...metadata } = item;
    assert.equal(id, "blade");
    assert.equal(purseId, "A");
    for (const gift of pending) assert.deepEqual(gift.holding, { ...metadata, quantity: 1 });
    const state = await snapshot();
    bill = readShare(
      JSON.parse(
        JSON.stringify(
          buildBill(
            { ...state, shareBase: { purses: base.purses, holdings: base.holdings, stock: [] } },
            seat,
          ),
        ),
      ),
    );
  } finally {
    setSeat(DM_SEAT);
  }
  assert.equal(bill.kind, "quire-bill");
  if (bill.kind !== "quire-bill") throw Error("Wrong report kind");
  await applyCloudTable(base);
  assert.equal(await applyBill(bill), 2);
  const after = await economySnapshot();
  assertItems(after as ReturnType<typeof initial>, 2);
  assert.equal(after.purses.find((p) => p.id === "B")?.coins.gp, 10);
  assert.equal(toCopper(after.purses.find((p) => p.id === "B")!.coins), 1050);
  assert.equal(await applyBill(bill), 0);
  assert.deepEqual(await economySnapshot(), after);
});
test("older manual transfer files remain readable without optional metadata", () => {
  const oldItem = { name: "Sword", kind: "item", quantity: 1, unitCopper: 100 };
  assert.deepEqual(
    readGifts([
      {
        id: "g",
        at: 1,
        fromId: "A",
        fromName: "A",
        toId: "B",
        toName: "B",
        copper: 0,
        holding: oldItem,
      },
    ])[0].holding,
    oldItem,
  );
});
