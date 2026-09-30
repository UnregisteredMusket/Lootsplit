import assert from "node:assert/strict";
import test from "node:test";
import { buildArticles, itemsToLines, orderPage, type RawLine } from "./articles.ts";

function line(partial: Partial<RawLine> & Pick<RawLine, "text" | "x" | "y">): RawLine {
  return {
    size: 10,
    width: 160,
    page: 1,
    ...partial,
  };
}

test("reads a title, then the left column, then the right", () => {
  const lines: RawLine[] = [
    line({ text: "Chapter One", size: 28, x: 180, y: 700, width: 250 }),
    line({ text: "W", size: 40, x: 48, y: 640, width: 28 }),
    line({ text: "elcome to the valley.", x: 90, y: 668, width: 170 }),
    line({ text: "The road is long and", x: 50, y: 654, width: 170 }),
    line({ text: "cold.", x: 50, y: 640, width: 40 }),
    line({ text: "A later paragraph.", x: 64, y: 610, width: 160 }),
    line({ text: "Right side opens", x: 340, y: 668, width: 160 }),
    line({ text: "with more news.", x: 340, y: 654, width: 140 }),
    line({ text: "A Side Path", size: 18, x: 340, y: 620, width: 120 }),
    line({ text: "After the side path the trail drops.", x: 340, y: 600, width: 200 }),
    line({ text: "12", size: 9, x: 290, y: 36, width: 14 }),
  ];
  const ordered = orderPage(lines, 600).map((item) => item.text);
  assert.equal(ordered[0], "Chapter One");
  assert.ok(ordered.indexOf("Welcome to the valley.") < ordered.indexOf("Right side opens"));
  assert.ok(ordered.includes("Welcome to the valley."));
  assert.equal(ordered.includes("12"), false);

  const articles = buildArticles([{ width: 600, lines }]);
  assert.equal(articles.length, 2);
  assert.match(articles[0]?.title ?? "", /Chapter One/);
  assert.match(articles[0]?.text ?? "", /Welcome to the valley/);
  assert.match(articles[0]?.text ?? "", /Right side opens/);
  assert.equal(articles[1]?.title, "A Side Path");
  assert.match(articles[1]?.text ?? "", /trail drops/);
});

test("joins words split with a hyphen and groups text items into lines", () => {
  const lines = itemsToLines(
    [
      { str: "North", x: 40, y: 500, width: 36, height: 10 },
      { str: "road", x: 80, y: 500, width: 30, height: 10 },
      { str: "The northern road continues half-", x: 40, y: 486, width: 180, height: 10 },
      { str: "way through the hills until the lanterns thin and the gate is only a rumor told by traders.", x: 40, y: 472, width: 420, height: 10 },
    ],
    2,
  );
  const articles = buildArticles([{ width: 500, lines }]);
  assert.equal(articles.length, 1);
  assert.match(articles[0]?.text ?? "", /North road/);
  assert.match(articles[0]?.text ?? "", /halfway/);
});

test("drops a repeated running header", () => {
  const pages = [1, 2, 3, 4].map((page) => ({
    width: 500,
    lines: [
      line({ text: "Private Ledger", x: 40, y: 760, width: 120, page, size: 9 }),
      line({
        text: `Entry ${page} tells a longer story about the road, the weather, and the people who keep the gate.`,
        x: 40,
        y: 700,
        width: 360,
        page,
      }),
    ],
  }));
  const articles = buildArticles(pages);
  assert.ok(articles.every((article) => !article.text.includes("Private Ledger")));
  assert.equal(articles.length >= 1, true);
});
