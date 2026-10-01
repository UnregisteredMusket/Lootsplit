import assert from "node:assert/strict";
import test from "node:test";
import { applyBillToTable, endPlayerTurn, nextTurn, setRoomLive, type CloudRoom } from "./cloud.ts";
import type { BillFile } from "./table.ts";
import { emptyCoins } from "./money.ts";

test("the turn moves to the next seat and wraps", () => {
  assert.equal(nextTurn(0, 3), 1);
  assert.equal(nextTurn(2, 3), 0);
  assert.equal(nextTurn(0, 1), 0);
});

test("a player's turn updates only their purse", () => {
  const ivo = { id: "ivo", name: "Ivo", kind: "character" as const, coins: { ...emptyCoins(), gp: 10 } };
  const sera = { id: "sera", name: "Sera", kind: "character" as const, coins: { ...emptyCoins(), gp: 4 } };
  const room: CloudRoom = {
    code: "ABCDE",
    revision: 1,
    turn: 1,
    live: false,
    seats: [
      { id: "dm", token: "dm-token", name: "Dungeon master", role: "dm", purseIds: [] },
      { id: "seat", token: "player-token", name: "Ivo", role: "player", purseIds: ["ivo"] },
    ],
    seen: { gifts: [], sales: [] },
    table: {
      purses: [ivo, sera],
      holdings: [],
      shops: [],
      stock: [],
      ledger: [],
      listings: [{ id: "mill", name: "Old mill", kind: "property", copper: 500, quantity: 1, notes: "" }],
      loans: [],
      sheets: [],
      notes: [],
    },
  };
  const bill = {
    kind: "quire-bill",
    version: 1,
    exportedAt: 10,
    openedAt: 1,
    purseIds: ["ivo", "sera"],
    shopIds: [],
    purses: [{ ...ivo, coins: { ...emptyCoins(), gp: 5 } }],
    holdings: [],
    stock: [],
    ledger: [{ id: "buy", at: 5, purseId: "ivo", shopId: null, summary: "Bought a cloak", copper: -500 }],
    sales: [{ id: "sale", at: 5, listingId: "mill", quantity: 1, purseId: "ivo" }],
  } as BillFile;
  const next = endPlayerTurn(room, "player-token", bill);
  assert.equal(next.turn, 0);
  assert.equal(next.table.purses.find((purse) => purse.id === "ivo")?.coins.gp, 5);
  assert.equal(next.table.purses.find((purse) => purse.id === "sera")?.coins.gp, 4);
  assert.equal(next.table.listings[0]?.quantity, 0);
  assert.equal(next.table.ledger.length, 1);
  const again = applyBillToTable(next.table, bill, next.seen);
  assert.equal(again.table.listings[0]?.quantity, 0);
});

test("a live table lets a player act when it is not their turn", () => {
  const room: CloudRoom = {
    code: "ABCDE",
    revision: 2,
    turn: 0,
    live: false,
    seats: [
      { id: "dm", token: "dm-token", name: "Dungeon master", role: "dm", purseIds: [] },
      { id: "seat", token: "player-token", name: "Ivo", role: "player", purseIds: ["ivo"] },
    ],
    seen: { gifts: [], sales: [] },
    table: {
      purses: [{ id: "ivo", name: "Ivo", kind: "character", coins: { ...emptyCoins(), gp: 3 } }],
      holdings: [],
      shops: [],
      stock: [],
      ledger: [],
      listings: [],
      loans: [],
      sheets: [],
      notes: [],
    },
  };
  const opened = setRoomLive(room, "dm-token", true);
  assert.equal(opened.live, true);
  const bill = {
    kind: "quire-bill",
    version: 1,
    exportedAt: 10,
    openedAt: 1,
    purseIds: ["ivo"],
    shopIds: [],
    purses: [{ id: "ivo", name: "Ivo", kind: "character" as const, coins: emptyCoins() }],
    holdings: [],
    stock: [],
    ledger: [],
  } as BillFile;
  const next = endPlayerTurn(opened, "player-token", bill, opened.revision);
  assert.equal(next.turn, 0);
  assert.equal(next.table.purses[0]?.coins.gp, 0);
  assert.throws(() => endPlayerTurn(room, "player-token", bill), /not your turn/);
});
