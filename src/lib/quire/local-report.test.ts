import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { emptyCloudTable } from "./cloud.ts";
import { emptyCoins } from "./money.ts";
import { applyCloudTable, applyBill, economySnapshot, snapshot, restore } from "./economy.ts";
import { buildBill, readShare } from "./table.ts";
const pc = (id: string) => ({
  id,
  name: id,
  kind: "character" as const,
  coins: { ...emptyCoins(), gp: 10 },
});
const initial = () => ({
  ...emptyCloudTable(),
  purses: [pc("A"), pc("B")],
  shops: [{ id: "shop", name: "Fixture shop", keeper: "", place: "", notes: "", sellRate: 1,
    buyRate: 0.5, wealth: "modest" as const, category: "general" as const, priceScale: 1 }],
  stock: [
    {
      id: "last",
      shopId: "shop",
      name: "Last item",
      copper: 100,
      quantity: 1,
      notes: "",
      baseCopper: 100,
      rarity: "common" as const,
    },
  ],
});
function report(id: string) {
  const base = initial();
  return buildBill(
    {
      ...base,
      shareBase: { purses: base.purses, holdings: base.holdings, stock: base.stock },
      purses: [{ ...pc(id), coins: { ...emptyCoins(), gp: 9 } }],
      holdings: [
        {
          id: "item-" + id,
          purseId: id,
          name: "Last item",
          kind: "item",
          quantity: 1,
          unitCopper: 100,
          notes: "",
        },
      ],
      stock: [{ ...base.stock[0], quantity: 0 }],
      ledger: [
        {
          id: "purchase-" + id,
          at: Date.now(),
          purseId: id,
          shopId: "shop",
          summary: "Purchase",
          copper: -100,
        },
      ],
    },
    { role: "player", purseIds: [id], shopIds: ["shop"], openedAt: 1 },
  );
}
test("Local report round-trip retains baseline, imports atomically, and rejects the second buyer", async () => {
  await applyCloudTable(initial());
  const a = readShare(JSON.parse(JSON.stringify(report("A"))));
  assert.equal(a.kind, "quire-bill");
  if (a.kind !== "quire-bill") throw new Error("wrong kind");
  assert.ok(a.base);
  assert.equal(await applyBill(a), 1);
  assert.equal(await applyBill(a), 0);
  const before = await economySnapshot();
  await assert.rejects(applyBill(report("B")), /stock/);
  const after = await economySnapshot();
  assert.deepEqual(after, before);
  assert.equal(after.holdings.length, 1);
});
test("backups preserve report baselines and pending sale/transfer metadata", async () => {
  const file = await snapshot();
  file.shareBase = { purses: initial().purses, holdings: [], stock: initial().stock };
  file.gifts = [
    {
      id: "gift",
      at: 10,
      fromId: "A",
      fromName: "A",
      toId: "B",
      toName: "B",
      copper: 1,
      holding: null,
    },
  ];
  file.sales = [{ id: "sale", at: 10, purseId: "A", listingId: "listing", quantity: 1 }];
  await restore(file);
  const round = await snapshot();
  assert.deepEqual(round.shareBase, file.shareBase);
  assert.equal(round.gifts?.[0]?.id, "gift");
  assert.equal(round.sales?.[0]?.id, "sale");
});

test("manual player reports require explicit DM approval of actual balances and inventory before any writes", async () => {
  await applyCloudTable(initial());
  const file = report("A"),
    before = await economySnapshot();
  const previous = (globalThis as any).window;
  let prompt = "";
  (globalThis as any).window = {
    localStorage: { getItem: () => null },
    confirm: (message: string) => {
      prompt = message;
      return false;
    },
  };
  try {
    await assert.rejects(applyBill(file), /not approved/);
    assert.match(prompt, /10 gp → 9 gp/);
    assert.match(prompt, /1 × Last item/);
    assert.deepEqual(await economySnapshot(), before);
    (globalThis as any).window.confirm = () => true;
    await applyBill(file);
    assert.equal((await economySnapshot()).purses.find((p) => p.id === "A")?.coins.gp, 9);
  } finally {
    if (previous === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previous;
  }
});
