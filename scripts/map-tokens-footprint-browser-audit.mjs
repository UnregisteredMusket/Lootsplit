// Map tokens PR 1 (docs/plans/MAP-TOKENS.md section 2; mockup docs/previews/map-tokens/grid-snap):
// footprint tokens in a disposable device campaign at 1280 × 800 and 390 × 844. Tiny, Medium,
// Large and Huge tokens are drawn at their footprint with at least a 44 px target; dragging a
// Large token by its lower-right square snaps the square under the grabbed point and keeps the
// footprint inside the grid; the drop label names the squares and distance; the DM changes the
// size in the Inspector; zooming out keeps discs legible; a player cannot drag another token;
// nothing scrolls sideways. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { openApplication } from "./title-screen-navigation.mjs";
import {
  journalOf,
  noSidewaysScroll,
  openKeep,
  seatAs,
  seedKeep,
  settle,
  squarePoint,
} from "./map-tokens-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = (process.env.AUDIT_RESULTS_DIR || "test-results") + "/map-tokens-footprint";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const corner = (id, label, column, row, extra = {}) => ({
  id,
  kind: "other",
  label,
  column,
  row,
  visibility: "party",
  anchor: "corner",
  ...extra,
});
const tokens = [
  { id: "mira-token", kind: "character", entityId: "mira", label: "Mira", column: 11, row: 6, visibility: "party", sizeClass: "medium", anchor: "corner" },
  corner("ogre", "Ogre", 16, 5, { kind: "creature", encounterId: "e1", combatantId: "ogre", sizeClass: "large" }),
  corner("golem", "Wood golem", 13, 10, { sizeClass: "huge", style: { color: "#a9c48f", size: 1, labels: "always" } }),
  ...[
    [-0.25, -0.25],
    [0.25, -0.25],
    [-0.25, 0.25],
  ].map(([x, y], i) => ({
    id: `rat${i}`,
    kind: "creature",
    encounterId: "e1",
    combatantId: `rat${i}`,
    label: "Rat",
    column: 10,
    row: 9,
    offsetX: x,
    offsetY: y,
    visibility: "party",
    sizeClass: "tiny",
    style: { size: 1, labels: "never" },
  })),
];
const token = async (page, id) =>
  (await journalOf(page)).world.maps.find((m) => m.id === "keep").tokens.find((t) => t.id === id);
const box = (page, id) => page.locator(`[data-map-token="${id}"]`).boundingBox();

try {
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(() => {
      localStorage.setItem("quire.guide.offer.v3", "seen");
      localStorage.setItem("lootsplit.map.toolNames.v1", "hidden");
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/maps");
    await seedKeep(page, { tokens, tabletop: { playerMovement: true } });
    await openKeep(page, origin);
    // Footprints: Huge > Large > Medium > Tiny, each disc inside its footprint.
    const [mira, ogre, golem, rat] = await Promise.all(
      ["mira-token", "ogre", "golem", "rat0"].map((id) => box(page, id)),
    );
    assert.ok(golem.width > ogre.width && ogre.width > mira.width && mira.width > rat.width, "discs follow footprints");
    assert.ok(Math.abs(ogre.width / mira.width - 2) < 0.6, `a Large disc is about twice a Medium one (${ogre.width} vs ${mira.width})`);
    // Every token has at least a 44 px target, even the Tiny ones.
    for (const id of ["mira-token", "ogre", "rat1"]) {
      const target = await page
        .locator(`[data-map-token="${id}"]`)
        .evaluate((el) => parseFloat(getComputedStyle(el, "::after").width));
      assert.ok(target >= 44, `${id} has a 44 px target (${target})`);
    }
    // Names below the discs; the Tiny rats' labels are hidden by their style.
    await expect(page.locator('[data-map-token="golem"] .map-token-label')).toHaveText("Wood golem");
    await expect(page.locator('[data-map-token="rat0"] .map-token-label')).toHaveCount(0);
    // Four footprint squares are drawn for the sized tokens.
    assert.ok((await page.locator(".map-token-foot").count()) >= 4);
    assert.ok(await noSidewaysScroll(page), `${width}: no sideways scroll`);
    await page.screenshot({ path: `${out}/footprints-${width}.png` });

    if (width === 1280) {
      // Drag the Ogre by its lower-right square: the square under the pointer becomes its
      // lower-right square, so the top-left lands one square up and left of the drop square.
      const from = await squarePoint(page, 17.4, 6.4),
        to = await squarePoint(page, 19.4, 9.4);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await expect(page.locator(".map-token-drop")).toHaveText(/^Drop: col 19–20, row 9–10 · \d+ ft$/);
      await expect(page.locator(".map-token-foot.target")).toHaveCount(1);
      await expect(page.locator('[data-map-token="ogre"]')).toHaveClass(/ghost/);
      await page.screenshot({ path: `${out}/drag-large-${width}.png` });
      await page.mouse.up();
      await expect.poll(async () => [(await token(page, "ogre")).column, (await token(page, "ogre")).row]).toEqual([18, 8]);
      assert.equal((await token(page, "ogre")).offsetX, undefined, "a snapped move has no offset");
      // Off the right edge: the footprint stays inside the grid (column 26 of 28 for 2×2).
      await settle(page);
      const o = await squarePoint(page, 18.5, 8.5),
        edge = await squarePoint(page, 27.8, 8.5);
      await page.mouse.move(o.x, o.y);
      await page.mouse.down();
      await page.mouse.move(edge.x, edge.y, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => (await token(page, "ogre")).column).toBe(26);
      // The DM changes the size in the Inspector: Huge, saved as one token command.
      await settle(page);
      // Keyboard selection: the token sits under the tools rail at the grid's right edge.
      await page.locator('[data-map-token="ogre"]').focus();
      await page.keyboard.press("Enter");
      const inspector = page.getByRole("complementary", { name: "Map inspector" });
      await expect(inspector.getByLabel("Size", { exact: true })).toHaveValue("large");
      await expect(inspector).toContainText("Top-left square · col 27, row 9");
      await inspector.getByLabel("Size", { exact: true }).selectOption("huge");
      await inspector.getByRole("button", { name: "Save token controls", exact: true }).click();
      await expect.poll(async () => (await token(page, "ogre")).sizeClass).toBe("huge");
      // Kept inside the 28-column grid: a 3×3 token starts at column 25 at most.
      assert.equal((await token(page, "ogre")).column, 25);
      await inspector.getByLabel("Custom squares", { exact: true }).selectOption("5");
      await inspector.getByRole("button", { name: "Save token controls", exact: true }).click();
      await expect.poll(async () => (await token(page, "ogre")).footprint).toBe(5);
      await page.getByRole("button", { name: "Close inspector", exact: true }).click();
      // Zoomed far out the discs keep a legible minimum.
      for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Zoom out", exact: true }).click();
      await settle(page);
      assert.ok((await box(page, "mira-token")).width >= 27.5, "discs keep 28 px when zoomed out");
      await page.screenshot({ path: `${out}/zoomed-out-${width}.png` });
    } else {
      // A player cannot drag a token they don't control.
      await seatAs(page, ["mira"]);
      await openKeep(page, origin);
      const before = await token(page, "golem");
      const g = await box(page, "golem");
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2 + 60, g.y + g.height / 2 + 60, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      assert.deepEqual(await token(page, "golem"), before, "a player can't move another token");
      assert.ok(await noSidewaysScroll(page), `${width}: no sideways scroll as a player`);
      await page.screenshot({ path: `${out}/player-${width}.png` });
    }
    assert.deepEqual(errors, [], `${width}: no page errors`);
    await context.close();
  }
  console.log("map-tokens-footprint: passed");
} finally {
  await browser.close();
}
