import assert from "node:assert/strict";
import test from "node:test";
import { receiptFromBill } from "./receipt.ts";
import { buildBill, encodeLinkPayload, decodeLinkPayload, lesserQuantity, readShare, seatHref, type Seat } from "./table.ts";
import type { LedgerLine, Purse, StockLine } from "./types.ts";

const purse = (id: string): Purse => ({ id, name: id, kind: "character", coins: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 } });

test("a counter file is not a full backup", () => {
  assert.throws(() => readShare({ kind: "quire", version: 2 }), /player file or a bill/);
  const table = readShare({
    kind: "quire-table",
    version: 1,
    exportedAt: 1,
    realm: { inflation: 1, scarcity: 1, gpDollars: 250, season: 1, shortage: 0, war: 0, plague: 0, roads: 1 },
    shops: [{ id: "s", name: "Hearth" }],
    stock: [{ id: "l", shopId: "s", name: "Loaf", copper: 2 }],
    purses: [purse("sera")],
    holdings: [],
  });
  assert.equal(table.kind, "quire-table");
});

test("stock left is the smaller count", () => {
  assert.equal(lesserQuantity(4, 2), 2);
  assert.equal(lesserQuantity(null, 3), 3);
  assert.equal(lesserQuantity(3, null), 3);
});

test("a player link round-trips the counter", async () => {
  const table = readShare({
    kind: "quire-table",
    version: 1,
    exportedAt: 5,
    realm: { inflation: 1, scarcity: 1, gpDollars: 250, season: 1, shortage: 0, war: 0, plague: 0, roads: 1 },
    shops: [{ id: "s", name: "Hearth" }],
    stock: [{ id: "l", shopId: "s", name: "Loaf", copper: 2 }],
    purses: [purse("sera")],
    holdings: [],
  });
  const payload = await encodeLinkPayload(table);
  const url = new URL(seatHref("player", payload, "http://quire.test"));
  assert.equal(url.searchParams.get("as"), "player");
  const again = await decodeLinkPayload(url.hash);
  assert.equal(again?.kind, "quire-table");
  if (again?.kind === "quire-table") assert.equal(again.shops[0]?.name, "Hearth");
});

test("a bill carries purchases made after the counter opened", () => {
  const sitting: Seat = { role: "player", purseIds: ["sera"], shopIds: ["s"], openedAt: 100 };
  const ledger: LedgerLine[] = [
    { id: "old", at: 50, purseId: "sera", shopId: "s", summary: "Bought earlier", copper: -10 },
    { id: "new", at: 150, purseId: "sera", shopId: "s", summary: "Bought a loaf", copper: -2 },
    { id: "other", at: 160, purseId: "ivo", shopId: "s", summary: "Bought a nail", copper: -1 },
  ];
  const stock: StockLine[] = [
    { id: "l", shopId: "s", name: "Loaf", copper: 2, quantity: 3, notes: "", baseCopper: 2, rarity: "common" },
    { id: "n", shopId: "other", name: "Nail", copper: 1, quantity: 9, notes: "", baseCopper: 1, rarity: "common" },
  ];
  const bill = buildBill({ purses: [purse("sera"), purse("ivo")], holdings: [], stock, ledger }, sitting);
  assert.deepEqual(bill.ledger.map((line) => line.id), ["new"]);
  assert.deepEqual(bill.purses.map((row) => row.id), ["sera"]);
  assert.deepEqual(bill.stock, [{ id: "l", quantity: 3 }]);
  const company = { ...purse("company"), kind: "party" as const, name: "The company" };
  const grouped = buildBill(
    {
      purses: [purse("sera"), company],
      holdings: [],
      stock,
      ledger: [
        { id: "sera-buy", at: 200, purseId: "sera", shopId: "s", summary: "Bought 1 loaf from Hearth", copper: -2 },
        { id: "party-buy", at: 210, purseId: "company", shopId: "s", summary: "Bought 1 rope from Hearth", copper: -20 },
      ],
    },
    { role: "player", purseIds: ["sera", "company"], shopIds: ["s"], openedAt: 100 },
  );
  const receipt = receiptFromBill(grouped);
  assert.deepEqual(receipt.bought.map((buyer) => buyer.name), ["sera", "Party · The company"]);
  assert.equal(receipt.bought[1]?.lines[0]?.summary, "Bought 1 rope from Hearth");
});
