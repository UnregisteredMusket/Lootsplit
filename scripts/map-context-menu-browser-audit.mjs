// Map tokens PR 4 (docs/plans/MAP-TOKENS.md section 3; mockup docs/previews/map-tokens/
// context-menu-desktop): a disposable device campaign at 1280 × 800. Right-click on the empty map
// opens "Map actions · Col 11 · Row 3" with the mockup's groups; Shift+F10 opens it from the
// keyboard with arrows, Home/End, letters, → / ← for "Move party to" and Esc returning focus to the
// map; items run their flows (Marker here opens the marker form at the point, Place party here
// places the party in one action, Measure from here starts the ruler); the token menu hides,
// resizes and removes (with confirmation); "Move party to ▸ The Cellar" moves the party's tokens
// and the view in one batch; a player's menus never show a DM item. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { openApplication } from "./title-screen-navigation.mjs";
import { journalOf, openKeep, seatAs, seedKeep, settle, squarePoint } from "./map-tokens-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = (process.env.AUDIT_RESULTS_DIR || "test-results") + "/map-context-menu";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const character = (id, label, column, row) => ({ id: `${id}-token`, kind: "character", entityId: id, label, column, row, visibility: "party" });
const link = (id, targetMapId, label, x, y) => ({ id, targetMapId, label, x, y, visibility: "party" });
const grid = { columns: 20, rows: 12, feetPerTile: 5, diagonal: "equal", x: 0, y: 0, width: 1, height: 1 };
const seed = (page) =>
  seedKeep(page, {
    tokens: [
      character("mira", "Mira", 12, 7),
      character("torvald", "Torvald", 13, 7),
      character("sela", "Sela", 12, 8),
      character("bram", "Bram", 13, 8),
      { id: "ogre", kind: "creature", label: "Ogre", encounterId: "fight", combatantId: "ogre", column: 17, row: 9, visibility: "party", sizeClass: "large", anchor: "corner" },
    ],
    world: { characterPositions: [{ purseId: "kett", inParty: false, locationId: null, visible: true, sheetVisible: true }] },
    keep: { connected: { parentMapId: "city", links: [link("l1", "cellar", "trapdoor", 0.2, 0.8), link("l2", "upper", "stairs", 0.3, 0.2), link("l3", "forest", "North Gate", 0.5, 0.02)], placements: [] } },
    extraMaps: [
      { id: "cellar", name: "The Cellar", type: "dungeon", locationId: "testville", visible: true, anchors: [], markers: [], grid, tokens: [], connected: { parentMapId: "keep", links: [link("l4", "keep", "ladder", 0.5, 0.5)], placements: [] } },
      { id: "upper", name: "Keep — Upper floor", type: "dungeon", locationId: "testville", visible: true, anchors: [], markers: [], grid, tokens: [], connected: { parentMapId: "keep", links: [], placements: [] } },
      { id: "city", name: "City-Testville", type: "city", locationId: "testville", visible: true, anchors: [], markers: [] },
      { id: "forest", name: "Forest outside of Testville", type: "regional", locationId: "testville", visible: true, anchors: [], markers: [] },
    ],
  });
const keepMap = async (page) => (await journalOf(page)).world.maps.find((m) => m.id === "keep");
const token = async (page, id) => (await keepMap(page)).tokens.find((t) => t.id === id);
const errors = [];
const DM_ITEMS = ["Start encounter here…", "Place party here", "Move party to", "Marker here", "Reveal around here", "Hide from players", "Remove token…", "Share this view with players"];

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((look) => {
    localStorage.setItem("quire.guide.offer.v3", "seen");
    localStorage.setItem("lootsplit.map.toolNames.v1", "hidden");
    if (look) localStorage.setItem("quire.prefs.v1", JSON.stringify({ appearance: "dark", accent: "#e0a04a", ground: "#10182c", fantasyBackgrounds: false }));
  }, !!process.env.MOCKUP_LOOK);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await openApplication(page, origin + "/maps");
  await seed(page);
  await openKeep(page, origin);
  const region = page.getByRole("region", { name: "Interactive campaign map", exact: true });
  await expect(region).toHaveAttribute("aria-keyshortcuts", /Shift\+F10/);
  const rightClick = async (column, row) => {
    await settle(page);
    const p = await squarePoint(page, column, row);
    await page.mouse.click(p.x, p.y, { button: "right" });
  };
  const menu = page.locator(".map-context-menu");

  // 1. Right-click on the empty map: the mockup's groups, the square, the announcement.
  await rightClick(10.5, 2.5);
  await expect(menu).toHaveAttribute("aria-label", "Map actions · Col 11 · Row 3");
  await expect(page.getByText("Map actions at column 11, row 3", { exact: true })).toBeAttached();
  const groups = await menu.locator(':scope > [role="group"]').evaluateAll((els) => els.map((g) => g.getAttribute("aria-label")));
  assert.deepEqual(groups, ["Encounter", "Party", "Place", "Table", "Reveal"]);
  await expect(menu.getByRole("menuitem", { name: /Place selected here/ })).toHaveAttribute("aria-disabled", "true");
  await expect(menu.getByRole("menuitem", { name: /Place party here/ })).toHaveAttribute("aria-keyshortcuts", "Shift+A");
  await menu.getByRole("menuitem", { name: /Move party to/ }).hover();
  const submenu = page.locator(".map-context-submenu");
  await expect(submenu.getByRole("menuitem", { name: /The Cellar/ })).toContainText("via trapdoor");
  await expect(submenu.getByRole("menuitemcheckbox", { name: "Players' scene follows" })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: `${out}/empty-map-menu.png` });
  // A click elsewhere closes it; focus stays on the map.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // 2. Keyboard only: Shift+F10 at the crosshair, arrows, Home/End, letters, → and ←, Esc.
  await region.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  assert.match(await focused(), /^Start encounter here/);
  await page.keyboard.press("End");
  assert.match(await focused(), /^Add light here/);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  assert.match(await focused(), /^Add creatures here/);
  await page.keyboard.press("m");
  assert.match(await focused(), /^Move party to/);
  await page.keyboard.press("ArrowRight");
  await expect(submenu).toBeVisible();
  await expect.poll(focused).toMatch(/^The Cellar/);
  await expect(menu.getByRole("menuitem", { name: /Move party to/ })).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(submenu).toHaveCount(0);
  await expect.poll(focused).toMatch(/^Move party to/);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Interactive campaign map");

  // 3. Items run their flows at the point.
  await rightClick(4.5, 3.5);
  await menu.getByRole("menuitem", { name: /Marker here/ }).click();
  await expect(page.getByRole("toolbar", { name: "Map setup" }).getByRole("button", { name: "Place marker", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".map-setup-panel input:visible").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await rightClick(20.5, 14.5);
  await menu.getByRole("menuitem", { name: /Place party here/ }).click();
  await expect.poll(async () => (await token(page, "mira-token")).row).toBeGreaterThan(12);
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Placed 4 on The Old Keep" });
  await toast.hover();
  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await token(page, "mira-token")).row).toBe(7);
  await rightClick(6.5, 12.5);
  await menu.getByRole("menuitem", { name: /Measure from here/ }).click();
  await expect(page.getByRole("button", { name: "Measure", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // 4. The token menu: header, Hide, Size ▸, Remove with confirmation; focus returns to the token.
  await rightClick(18, 10);
  await expect(menu).toHaveAttribute("aria-label", "Ogre · Large · DM-only stats");
  await page.screenshot({ path: `${out}/token-menu.png` });
  await menu.getByRole("menuitem", { name: "Hide from players" }).click();
  await expect.poll(async () => (await token(page, "ogre")).visibility).toBe("dm");
  await rightClick(18, 10);
  await expect(menu.getByRole("menuitem", { name: "Show to players" })).toBeVisible();
  await menu.getByRole("menuitem", { name: /^Size/ }).click();
  await submenu.getByRole("menuitemcheckbox", { name: "Huge" }).click();
  await expect.poll(async () => (await token(page, "ogre")).sizeClass).toBe("huge");
  const ogre = page.locator('[data-map-token="ogre"]');
  await ogre.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toHaveAttribute("aria-label", /^Ogre · Huge/);
  await page.keyboard.press("Escape");
  await expect(ogre).toBeFocused();
  await rightClick(18.5, 10.5);
  await menu.getByRole("menuitem", { name: /Remove token/ }).click();
  await page.getByRole("button", { name: "Remove token", exact: true }).click();
  await expect.poll(async () => await token(page, "ogre")).toBe(undefined);

  // 5. Move party to ▸ The Cellar: one batch, the tokens arrive at the trapdoor's ladder.
  await rightClick(4.5, 3.5);
  await menu.getByRole("menuitem", { name: /Move party to/ }).click();
  await submenu.getByRole("menuitem", { name: /The Cellar/ }).click();
  await expect.poll(async () => (await journalOf(page)).world.maps.find((m) => m.id === "cellar").tokens.length).toBe(4);
  assert.equal((await keepMap(page)).tokens.length, 0);
  assert.equal((await journalOf(page)).world.tabletop.activeMapId, "cellar");
  await expect(page.locator(".map-workspace-chrome, .map-title-capsule").first()).toContainText("The Cellar");
  await context.close();

  // 6. A player: the short menus, never a DM item.
  const player = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await player.addInitScript(() => {
    localStorage.setItem("quire.guide.offer.v3", "seen");
    localStorage.setItem("lootsplit.map.toolNames.v1", "hidden");
  });
  const p2 = await player.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await openApplication(p2, origin + "/maps");
  await seed(p2);
  await seatAs(p2, ["mira"]);
  await openKeep(p2, origin);
  const pMenu = p2.locator(".map-context-menu");
  const items = () => pMenu.locator('[role^="menuitem"]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  await settle(p2);
  let at = await squarePoint(p2, 4.5, 3.5);
  await p2.mouse.click(at.x, at.y, { button: "right" });
  await expect(pMenu).toBeVisible();
  const empty = await items();
  assert.deepEqual(empty.map((t) => t.replace(/[PM]$/, "")), ["Ping here", "Measure from here"]);
  await p2.keyboard.press("Escape");
  at = await squarePoint(p2, 12.5, 7.5);
  await p2.mouse.click(at.x, at.y, { button: "right" });
  assert.deepEqual((await items()).map((t) => t.replace(/P$/, "")), ["Open my sheet", "Ping", "Centre"]);
  await p2.screenshot({ path: `${out}/player-token-menu.png` });
  await p2.keyboard.press("Escape");
  at = await squarePoint(p2, 18, 10);
  await p2.mouse.click(at.x, at.y, { button: "right" });
  for (const label of DM_ITEMS) assert.ok(!(await items()).some((t) => t.startsWith(label)), `player sees ${label}`);
  await player.close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("map-context-menu: passed");
} finally {
  await browser.close();
}
