import assert from "node:assert/strict";
import { test } from "node:test";
import { goodsFromText, extractLexemes } from "./extract.ts";
import { pricesInText } from "./money.ts";
test("prices support leaders, split units, mixed coins and written denominations", () => {
  const goods = goodsFromText([
    { text: "Rope (50 ft.) .... 1 gp 5 sp\nLamp oil 0.5 gold pieces\nBackpack 2 g p" },
  ]);
  assert.equal(goods.find((g) => g.name === "Rope (50 ft.)")?.copper, 150);
  assert.equal(goods.find((g) => g.name === "Lamp oil")?.copper, 50);
  assert.equal(goods.find((g) => g.name === "Backpack")?.copper, 200);
  assert.equal(pricesInText("Bread 2 cp, cheese 1 sp").length, 2);
});
test("conflicting prices retain both candidates and source context", () => {
  const goods = goodsFromText([
    { title: "Market", pageStart: 3, text: "Longsword 15 gp\nLongsword 20 gp\nLongsword 15 gp" },
  ]);
  assert.equal(goods.length, 2);
  assert.ok(goods.every((g) => g.conflict));
  assert.equal(goods[0]!.source, "Market · p. 3");
  assert.equal(goods[0]!.quote, "Longsword 15 gp");
});
test("name extraction scans beyond the first 1500 characters", () => {
  assert.ok(
    extractLexemes([
      { title: "Notes", text: "An ordinary road. ".repeat(100) + "The city of Brine is nearby." },
    ]).some((n) => n.name === "Brine"),
  );
});
