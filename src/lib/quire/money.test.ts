import assert from "node:assert/strict";
import test from "node:test";
import { carryToStandard, charismaOffPercent, explainPurse, formatCopper, formatDollars, parsePrice, priceAfterCharisma, pricesInText, spendCoins, toCopper } from "./money.ts";

test("parses mixed coin prices and spends smaller coins first", () => {
  assert.equal(parsePrice("1 gp 5 sp"), 150);
  assert.equal(parsePrice("2 cp"), 2);
  assert.equal(formatCopper(150), "1 gp, 5 sp");
  const left = spendCoins({ cp: 0, sp: 0, ep: 0, gp: 3, pp: 2 }, 1500);
  assert.equal(toCopper(left!), 800);
  assert.equal(left?.pp, 0);
  assert.equal(left?.gp, 8);
});

test("Charisma above 10 takes a flat percent off the price", () => {
  assert.equal(charismaOffPercent(10), 0);
  assert.equal(charismaOffPercent(8), 0);
  assert.equal(charismaOffPercent(16), 6);
  assert.equal(priceAfterCharisma(10000, 16), 9400);
  assert.equal(priceAfterCharisma(10000, null), 10000);
  assert.equal(priceAfterCharisma(10000, 8), 10000);
});

test("counts a purse in gold, silver, and copper", () => {
  assert.deepEqual(carryToStandard({ cp: 30, sp: 18, ep: 0, gp: 45, pp: 0 }), { cp: 0, sp: 1, ep: 0, gp: 47, pp: 0 });
  assert.deepEqual(carryToStandard({ cp: 0, sp: 0, ep: 3, gp: 0, pp: 2 }), { cp: 0, sp: 5, ep: 0, gp: 21, pp: 0 });
  assert.equal(toCopper(carryToStandard({ cp: 30, sp: 18, ep: 1, gp: 1, pp: 1 })), toCopper({ cp: 30, sp: 18, ep: 1, gp: 1, pp: 1 }));
  assert.equal(toCopper({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 1 }), 1000);
  assert.equal(toCopper({ cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 }), 1000);
  assert.equal(explainPurse({ cp: 30, sp: 18, ep: 0, gp: 45, pp: 0 }), "45 gp + 18 sp + 30 cp = 47 gp, 1 sp, at 10 cp = 1 sp, 10 sp = 1 gp, 10 gp = 1 pp.");
  assert.equal(explainPurse({ cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 }), "");
});

test("reads one gold piece as two hundred fifty dollars", () => {
  assert.equal(formatDollars(100, 250), "$250");
  assert.equal(formatDollars(2, 250), "$5");
  assert.equal(formatDollars(1, 250), "$2.50");
});

test("pulls item names that sit in front of a printed price", () => {
  const hits = pricesInText("A flask of lamp oil costs 1 sp.\nHempen rope, 50 ft — 1 gp.");
  assert.equal(hits[0]?.name, "A flask of lamp oil");
  assert.equal(hits[0]?.copper, 10);
  assert.equal(hits[1]?.name, "Hempen rope, 50 ft");
  assert.equal(hits[1]?.copper, 100);
});
