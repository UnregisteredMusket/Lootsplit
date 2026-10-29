// Map tokens PR 1b (docs/plans/MAP-TOKENS.md section 2.5; mockup docs/previews/map-tokens/grid-snap
// frame 2): grid mode in a disposable device campaign at 1280 × 800 and 390 × 844. Turning grid
// mode on with tokens between squares opens "Turn on grid mode" (keyboard: radios with arrows,
// Esc cancels and moves nothing); Snap N tokens snaps them in one action and Undo restores them;
// Align the grid keeps every token where it is on the image; turning grid mode off moves nothing;
// an ungridded map gets an automatic hidden grid. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { openApplication } from "./title-screen-navigation.mjs";
import { journalOf, noSidewaysScroll, openKeep, seedKeep } from "./map-tokens-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = (process.env.AUDIT_RESULTS_DIR || "test-results") + "/map-grid-mode";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
// Eleven tokens placed between squares, as in the mockup.
const tokens = Array.from({ length: 11 }, (_, i) => ({
  id: `t${i}`,
  kind: "other",
  label: `Token ${i + 1}`,
  column: 4 + (i % 6) * 3,
  row: 3 + Math.floor(i / 6) * 4,
  offsetX: 0.3,
  offsetY: -0.2,
  visibility: "party",
  ...(i === 0 ? { sizeClass: "large", anchor: "corner" } : {}),
}));
const keep = async (page) => (await journalOf(page)).world.maps.find((m) => m.id === "keep");
const layers = async (page) => {
  const button = page.getByRole("button", { name: "Layers", exact: true });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  return page.locator("#map-layers");
};

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
    await seedKeep(page, {
      tokens,
      tabletop: { snap: false },
      extraMaps: [{ id: "glade", name: "Quiet glade", type: "wilderness", locationId: null, visible: true, anchors: [], markers: [] }],
    });
    await openKeep(page, origin);
    const panel = await layers(page);
    const gridMode = panel.getByRole("button", { name: "Grid mode", exact: true });
    await expect(gridMode).toHaveAttribute("aria-pressed", "false");
    // Esc cancels: nothing changes.
    await gridMode.click();
    const dialog = page.getByRole("dialog", { name: "Turn on grid mode" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("11 tokens sit between squares.");
    await expect(dialog.getByRole("radio", { name: /Snap tokens to the nearest squares/ })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByRole("radio", { name: /Snap tokens/ })).toBeFocused();
    assert.ok(await noSidewaysScroll(page), `${width}: dialog fits`);
    await page.screenshot({ path: `${out}/dialog-${width}.png` });
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("radio", { name: /Align the grid/ })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByRole("button", { name: "Align the grid", exact: true })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    assert.equal((await keep(page)).tabletop.snap, false);
    if (width === 1280) {
      // (a) Snap 11 tokens: one action; Undo puts them back.
      await (await layers(page)).getByRole("button", { name: "Grid mode", exact: true }).click();
      await dialog.getByRole("button", { name: "Snap 11 tokens", exact: true }).click();
      await expect.poll(async () => (await keep(page)).tabletop.snap).toBe(true);
      const snapped = (await keep(page)).tokens;
      assert.ok(snapped.every((t) => t.offsetX === undefined && t.offsetY === undefined), "every token is on a square");
      const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Grid mode on · 11 tokens snapped" });
      await expect(toast).toBeVisible();
      await toast.hover();
      await toast.getByRole("button", { name: "Undo", exact: true }).click();
      await expect.poll(async () => (await keep(page)).tabletop.snap).toBe(false);
      assert.deepEqual(
        (await keep(page)).tokens.map((t) => [t.column, t.row, t.offsetX, t.offsetY]),
        tokens.map((t) => [t.column, t.row, t.offsetX, t.offsetY]),
        "Undo restores every token",
      );
      // (b) Align the grid: the grid shifts, tokens keep their place on the image.
      await (await layers(page)).getByRole("button", { name: "Grid mode", exact: true }).click();
      await dialog.getByRole("radio", { name: /Align the grid/ }).click();
      await dialog.getByRole("button", { name: "Align the grid", exact: true }).click();
      await expect.poll(async () => (await keep(page)).tabletop.snap).toBe(true);
      const aligned = await keep(page);
      assert.notEqual(aligned.grid.x, 0, "the grid moved");
      const centre = (g, t) => g.x + ((t.column + (t.anchor ? 1 : 0.5) + (t.offsetX ?? 0)) / g.columns) * g.width;
      const before = { columns: 28, x: 0, width: 1 };
      for (const t of tokens) {
        const after = aligned.tokens.find((x) => x.id === t.id);
        assert.ok(Math.abs(centre(before, t) - centre(aligned.grid, after)) < 1e-6, `${t.id} stays on the image`);
      }
      // Turning grid mode off never moves a token.
      await (await layers(page)).getByRole("button", { name: "Grid mode", exact: true }).click();
      await expect.poll(async () => (await keep(page)).tabletop.snap).toBe(false);
      assert.deepEqual((await keep(page)).tokens, aligned.tokens);
      await expect(page.getByRole("dialog", { name: "Turn on grid mode" })).toHaveCount(0);
      // An ungridded map gets an automatic hidden grid with grid mode off.
      await openKeep(page, origin, "glade");
      await page.getByRole("toolbar", { name: "Map setup" }).getByRole("button", { name: "Combat token", exact: true }).click();
      await page.getByRole("button", { name: "Add tokens with an automatic grid", exact: true }).click();
      await expect
        .poll(async () => (await journalOf(page)).world.maps.find((m) => m.id === "glade").grid?.columns)
        .toBeGreaterThan(3);
      const glade = (await journalOf(page)).world.maps.find((m) => m.id === "glade");
      assert.equal(glade.tabletop.snap, false);
      assert.equal(glade.tabletop.gridHidden, true);
      await expect(page.locator(".map-view-frame .map-tile-grid")).toHaveCount(0);
    }
    assert.deepEqual(errors, [], `${width}: no page errors`);
    await context.close();
  }
  console.log("map-grid-mode: passed");
} finally {
  await browser.close();
}
