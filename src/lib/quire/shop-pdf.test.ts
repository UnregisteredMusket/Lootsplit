import assert from "node:assert/strict";
import test from "node:test";
import { pdfText, renderShopPdf, shopPdfFilename } from "./shop-pdf.ts";
import type { Shop, StockLine } from "./types.ts";

const shop: Shop = {
  id: "shop-1",
  name: "Hearth & Nail",
  keeper: "Ivo",
  place: "The Landing",
  notes: "Closed on feast days.",
  sellRate: 1,
  buyRate: 0.5,
  wealth: "modest",
  category: "general",
  priceScale: 1,
};

function line(partial: Partial<StockLine> & Pick<StockLine, "name" | "copper">): StockLine {
  return {
    id: partial.name,
    shopId: shop.id,
    quantity: null,
    notes: "",
    baseCopper: partial.copper,
    rarity: "common",
    ...partial,
  };
}

test("writes a shareable shop sheet with asking prices", () => {
  const pdf = renderShopPdf({
    shop,
    lines: [
      line({ name: "Barley loaf", copper: 2 }),
      line({ name: "Mail (shirt)", copper: 7500, rarity: "rare", quantity: 1 }),
    ],
    showDollars: true,
    gpDollars: 250,
    issued: new Date("2026-09-30T12:00:00Z"),
  });
  assert.equal(pdf.startsWith("%PDF-1.4\n"), true);
  assert.match(pdf, /Hearth & Nail/);
  assert.match(pdf, /Ivo/);
  assert.match(pdf, /Pays 50%|pays 50%/);
  assert.match(pdf, /2 cp/);
  assert.match(pdf, /\$5/);
  assert.match(pdf, /75 gp/);
  assert.match(pdf, /Mail \\\(shirt\\\)/);
  assert.match(pdf, /Rare/);
  assert.match(pdf, /1 on hand/);
  assert.match(pdf, /Closed on feast days/);
  const start = pdf.indexOf("startxref\n");
  const at = Number(pdf.slice(start + "startxref\n".length, pdf.indexOf("\n", start + 10)));
  assert.equal(pdf.slice(at, at + 4), "xref");
  assert.equal(shopPdfFilename(shop.name), "hearth-nail.pdf");
});

test("omits the dollar reading when it is turned off", () => {
  const pdf = renderShopPdf({
    shop,
    lines: [line({ name: "Lamp oil", copper: 10 })],
    showDollars: false,
    gpDollars: 250,
  });
  assert.match(pdf, /1 sp/);
  assert.equal(pdf.includes("$"), false);
});

test("paginates a long shelf", () => {
  const lines = Array.from({ length: 60 }, (_, index) => line({ name: `Good ${index + 1}`, copper: 10 + index }));
  const pdf = renderShopPdf({ shop, lines, showDollars: false, gpDollars: 250 });
  assert.match(pdf, /\/Count 2|\/Count [3-9]/);
  assert.match(pdf, /2 \/ /);
});

test("escapes winansi punctuation", () => {
  assert.equal(pdfText("A (fine) dash — quote"), "A \\(fine\\) dash \\227 quote");
});
