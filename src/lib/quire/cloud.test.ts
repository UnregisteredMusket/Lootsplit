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

test("a report's gift is capped at the shared engine's 1e12 copper balance, all or nothing", () => {
  const coins = (copper: number) => ({ ...emptyCoins(), cp: copper });
  const table = {
    purses: [
      { id: "ivo", name: "Ivo", kind: "character" as const, coins: coins(1_000) },
      { id: "sera", name: "Sera", kind: "character" as const, coins: coins(1e12 - 100) },
      { id: "tam", name: "Tam", kind: "character" as const, coins: coins(0) },
    ],
    holdings: [],
    shops: [],
    stock: [],
    ledger: [],
    listings: [],
    loans: [],
    sheets: [],
    notes: [],
  };
  const gift = (id: string, toId: string, copper: number) => ({
    id,
    at: 5,
    fromId: "ivo",
    toId,
    fromName: "Ivo",
    toName: toId,
    copper,
    holding: null,
  });
  const report = (gifts: ReturnType<typeof gift>[]) =>
    ({
      kind: "quire-bill",
      version: 1,
      exportedAt: 10,
      openedAt: 1,
      purseIds: ["ivo"],
      shopIds: [],
      purses: [{ id: "ivo", name: "Ivo", kind: "character" as const, coins: coins(400) }],
      holdings: [],
      stock: [],
      ledger: [],
      gifts,
    }) as BillFile;
  const before = JSON.stringify(table);
  // An old report within limits still imports, up to exactly 1e12 copper.
  const ok = applyBillToTable(table, report([gift("g1", "sera", 100), gift("g2", "tam", 200)]), { gifts: [], sales: [] });
  const total = (id: string, purses = ok.table.purses) => {
    const c = purses.find((p) => p.id === id)!.coins;
    return c.cp + c.sp * 10 + c.ep * 50 + c.gp * 100 + c.pp * 1000;
  };
  assert.equal(total("sera"), 1e12);
  assert.equal(total("tam"), 200);
  assert.deepEqual(ok.seen.gifts, ["g1", "g2"]);
  // One copper more is refused, and the gift before it (to Tam) is not half-applied.
  const over = report([gift("g3", "tam", 200), gift("g4", "sera", 101)]);
  const overBefore = JSON.stringify(over);
  assert.throws(
    () => applyBillToTable(table, over, { gifts: [], sales: [] }),
    /largest supported balance\. No report changes were imported\./,
  );
  assert.equal(JSON.stringify(table), before, "the table is unchanged");
  assert.equal(JSON.stringify(over), overBefore, "the report is unchanged");
  // A gift to a purse the report itself carries is copied, not written into the report.
  const self = report([gift("g5", "ivo", 1e12)]);
  assert.throws(() => applyBillToTable(table, self, { gifts: [], sales: [] }), /No report changes were imported/);
  const selfOk = report([gift("g6", "ivo", 50)]);
  const applied = applyBillToTable(table, selfOk, { gifts: [], sales: [] });
  assert.equal(total("ivo", applied.table.purses), 450);
  assert.equal(selfOk.purses[0]!.coins.cp, 400, "the report's own purse object is not mutated");
});
