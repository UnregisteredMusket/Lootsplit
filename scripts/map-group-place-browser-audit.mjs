// Map tokens PR 3 (docs/plans/MAP-TOKENS.md section 5; mockup docs/previews/map-tokens/
// group-placement): a disposable device campaign at 1280 × 800 and 390 × 844. Place party (⇧A)
// lists the party by group, ghosts follow the pointer in a cluster with the "Placing 4 at …" hint,
// one click places everyone in one action and Undo restores them; formation, spacing and rotate;
// Shift+drag box selection and Ctrl+A; the group bar hides, locks, sizes, moves and sends the
// selection; phones get a Select toggle. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { openApplication } from "./title-screen-navigation.mjs";
import { journalOf, noSidewaysScroll, openKeep, seedKeep, settle, squarePoint } from "./map-tokens-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = (process.env.AUDIT_RESULTS_DIR || "test-results") + "/map-group-place";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const character = (id, label, column, row) => ({ id: `${id}-token`, kind: "character", entityId: id, label, column, row, visibility: "party" });
const tokens = [
  character("mira", "Mira", 12, 7),
  character("torvald", "Torvald", 13, 7),
  character("sela", "Sela", 12, 8),
  character("bram", "Bram", 13, 8),
  { id: "ogre", kind: "creature", label: "Ogre", encounterId: "fight", combatantId: "ogre", column: 17, row: 10, visibility: "party", sizeClass: "large", anchor: "corner" },
];
const keepMap = async (page) => (await journalOf(page)).world.maps.find((m) => m.id === "keep");
const token = async (page, id) => (await keepMap(page)).tokens.find((t) => t.id === id);
const errors = [];

try {
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript((look) => {
      localStorage.setItem("quire.guide.offer.v3", "seen");
      localStorage.setItem("lootsplit.map.toolNames.v1", "hidden");
      if (look) localStorage.setItem("quire.prefs.v1", JSON.stringify({ appearance: "dark", accent: "#e0a04a", ground: "#10182c", fantasyBackgrounds: false }));
    }, !!process.env.MOCKUP_LOOK);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/maps");
    await seedKeep(page, {
      tokens,
      // Kett is away from the party, so Place party lists the four.
      world: { characterPositions: [{ purseId: "kett", inParty: false, locationId: null, visible: true, sheetVisible: true }] },
      extraMaps: [{ id: "cellar", name: "The Cellar", type: "dungeon", locationId: "testville", visible: true, anchors: [], markers: [], grid: { columns: 20, rows: 12, feetPerTile: 5, diagonal: "equal", x: 0, y: 0, width: 1, height: 1 }, tokens: [] }],
    });
    await openKeep(page, origin);
    if (width === 1280) {
      // Place party: the panel lists the party; ghosts follow the pointer as a cluster.
      await page.getByRole("toolbar", { name: "Map setup" }).getByRole("button", { name: "Place party", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "Place party" });
      await expect(panel).toContainText("Ghosts follow the pointer and snap square by square.");
      await expect(panel.getByRole("checkbox", { name: /Mira/ })).toBeChecked();
      await expect(panel).toContainText("on map · will move");
      await expect(panel.getByRole("radio", { name: "Cluster" })).toHaveAttribute("aria-checked", "true");
      const target = await squarePoint(page, 14.5, 12.5);
      await page.mouse.move(target.x, target.y, { steps: 4 });
      await expect(page.getByRole("status").filter({ hasText: /^Placing 4 at column 14, row 12 · cluster · all squares free/ })).toBeVisible();
      await expect(page.locator(".map-token.ghost.preview")).toHaveCount(4);
      await page.screenshot({ path: `${out}/place-party-${width}.png` });
      await page.mouse.click(target.x, target.y);
      await expect.poll(async () => [(await token(page, "mira-token")).column, (await token(page, "mira-token")).row]).toEqual([13, 11]);
      assert.deepEqual([(await token(page, "bram-token")).column, (await token(page, "bram-token")).row], [14, 12]);
      // One action with Undo: everyone goes back.
      const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Placed 4 on The Old Keep" });
      await toast.hover();
      await toast.getByRole("button", { name: "Undo", exact: true }).click();
      await expect.poll(async () => (await token(page, "mira-token")).column).toBe(12);
      // Line with spacing, rotated: a vertical line.
      await page.getByRole("toolbar", { name: "Map setup" }).getByRole("button", { name: "Place party", exact: true }).click();
      await panel.getByRole("radio", { name: "Line" }).click();
      await panel.getByRole("button", { name: "More spacing", exact: true }).click();
      await panel.getByRole("button", { name: /^Rotate/ }).click();
      const spot = await squarePoint(page, 20.5, 8.5);
      await page.mouse.move(spot.x, spot.y, { steps: 3 });
      await page.mouse.click(spot.x, spot.y);
      await expect.poll(async () => (await keepMap(page)).tokens.filter((t) => t.kind === "character").every((t) => t.column === 20)).toBe(true);
      await expect(panel).toHaveCount(0);
      // Shift+drag draws a selection box; the group bar acts on the whole selection.
      await settle(page);
      const a = await squarePoint(page, 19.2, 2.2),
        b = await squarePoint(page, 21.8, 16.8);
      await page.keyboard.down("Shift");
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      const bar = page.getByRole("toolbar", { name: "4 tokens selected" });
      await expect(bar).toBeVisible();
      await bar.getByRole("button", { name: "Hide", exact: true }).click();
      await expect.poll(async () => (await keepMap(page)).tokens.filter((t) => t.visibility === "dm").length).toBe(4);
      await bar.getByRole("button", { name: "Show", exact: true }).click();
      await expect.poll(async () => (await keepMap(page)).tokens.filter((t) => t.visibility === "dm").length).toBe(0);
      await bar.getByRole("button", { name: "Lock", exact: true }).click();
      await expect.poll(async () => (await keepMap(page)).tokens.filter((t) => t.locked).length).toBe(4);
      await bar.getByRole("button", { name: "Size", exact: true }).click();
      await page.getByRole("menuitem", { name: "Small", exact: true }).click();
      await expect.poll(async () => (await keepMap(page)).tokens.filter((t) => t.sizeClass === "small").length).toBe(4);
      await bar.getByRole("button", { name: /^Movement/ }).click();
      await page.getByRole("menuitemradio", { name: /^Off/ }).click();
      await expect.poll(async () => (await keepMap(page)).tabletop?.movement).toBe("off");
      await page.screenshot({ path: `${out}/group-bar-${width}.png` });
      // Send to map: the four leave this map and arrive on The Cellar in one action.
      await bar.getByRole("button", { name: "Send to", exact: true }).click();
      await page.getByRole("menuitem", { name: "The Cellar", exact: true }).click();
      await expect.poll(async () => (await journalOf(page)).world.maps.find((m) => m.id === "cellar").tokens.length).toBe(4);
      assert.equal((await keepMap(page)).tokens.length, 1);
      // Ctrl+A selects every token.
      await page.getByRole("region", { name: "Interactive campaign map", exact: true }).focus();
      await page.keyboard.press("Control+a");
      await expect(page.locator('.map-token[aria-pressed="true"]')).toHaveCount(1);
    } else {
      // Phones: "Select more tokens" returns to the map in Select mode; taps then add tokens.
      await page.locator('[data-map-token="mira-token"]').click();
      await page.getByRole("button", { name: "Select more tokens", exact: true }).click();
      const bar = page.getByRole("toolbar", { name: /tokens selected/ });
      await expect(bar.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.locator('[data-map-token="bram-token"]').click();
      await expect(page.getByRole("toolbar", { name: "2 tokens selected" })).toBeVisible();
      assert.ok(await noSidewaysScroll(page), "390: no sideways scroll");
      await page.screenshot({ path: `${out}/phone-select-${width}.png` });
    }
    await context.close();
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("map-group-place: passed");
} finally {
  await browser.close();
}
