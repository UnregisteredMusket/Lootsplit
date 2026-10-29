// Map tokens PR 7 (docs/plans/MAP-TOKENS.md section 6; mockup docs/previews/map-tokens/
// player-token-move frame 4): a disposable device campaign at 1280 × 800. The DM turns on
// "Character tokens follow players' map view" (off by default); a player opening The Cellar from
// The Old Keep sees "Your token moved to The Cellar · Still with the party: same zone
// (Testville)" with Undo, and Undo brings the token back; opening a map in another place moves
// nothing ("Viewing only — Mira is in Testville."); "Follow me" off browses without moving; during
// combat the token stays. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { openApplication } from "./title-screen-navigation.mjs";
import { journalOf, openKeep, seatAs, seedKeep, settle } from "./map-tokens-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = (process.env.AUDIT_RESULTS_DIR || "test-results") + "/map-follow-view";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const character = (id, label, column, row) => ({ id: `${id}-token`, kind: "character", entityId: id, label, column, row, visibility: "party" });
const link = (id, targetMapId, label, x, y) => ({ id, targetMapId, label, x, y, visibility: "party" });
const grid = { columns: 20, rows: 12, feetPerTile: 5, diagonal: "equal", x: 0, y: 0, width: 1, height: 1 };
const mapOf = async (page, id) => (await journalOf(page)).world.maps.find((m) => m.id === id);
const errors = [];

async function open(seat) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((look) => {
    localStorage.setItem("quire.guide.offer.v3", "seen");
    localStorage.setItem("lootsplit.map.toolNames.v1", "hidden");
    if (look) localStorage.setItem("quire.prefs.v1", JSON.stringify({ appearance: "dark", accent: "#e0a04a", ground: "#10182c", fantasyBackgrounds: false }));
  }, !!process.env.MOCKUP_LOOK);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await openApplication(page, origin + "/maps");
  await seedKeep(page, {
    tokens: [character("mira", "Mira", 12, 7), character("torvald", "Torvald", 13, 7)],
    keep: { connected: { parentMapId: "city", links: [link("l1", "cellar", "trapdoor", 0.2, 0.8)], placements: [] } },
    extraMaps: [
      { id: "cellar", name: "The Cellar", type: "dungeon", locationId: null, visible: true, anchors: [], markers: [], grid, tokens: [], connected: { parentMapId: "keep", links: [link("l2", "keep", "ladder", 0.5, 0.5)], placements: [] } },
      { id: "city", name: "City-Testville", type: "city", locationId: "testville", visible: true, anchors: [], markers: [] },
      { id: "faraway", name: "Saltmarsh Road", type: "regional", locationId: "greenvale", visible: true, anchors: [], markers: [], grid, tokens: [] },
    ],
  });
  if (seat) await seatAs(page, seat);
  await openKeep(page, origin);
  return { context, page };
}
/** Opens another map inside the app (search), so the view switches without a reload. */
async function switchTo(page, name) {
  const search = page.getByRole("combobox", { name: /Search maps/ }).or(page.getByRole("searchbox", { name: /Search maps/ })).first();
  await search.click();
  await search.fill(name);
  await page.getByRole("option", { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.locator(".map-title-capsule, .map-workspace-chrome").first()).toContainText(name);
  await settle(page);
}

try {
  // The DM's setting: off by default, one switch in Settings › Players & display.
  const dm = await open();
  await dm.page.getByRole("button", { name: /All map settings|Map settings/ }).first().click();
  const setting = dm.page.getByRole("switch", { name: /Character tokens follow players' map view/ });
  await expect(setting).toHaveAttribute("aria-checked", "false");
  await setting.click();
  await expect(setting).toHaveAttribute("aria-checked", "true");
  assert.equal((await journalOf(dm.page)).world.tabletop.followView, true);
  await dm.page.screenshot({ path: `${out}/dm-setting-1280.png` });
  await dm.context.close();

  // A player: the follow, the toast with Undo, other places, Follow me off, combat.
  const p = await open(["mira"]);
  await p.page.evaluate(async () => {
    const economy = await import("/src/lib/quire/economy.ts");
    const table = await economy.economySnapshot();
    // Turned on by the DM (as above) in this device campaign.
    await economy.applyCloudTable({ ...table, journal: { ...table.journal, world: { ...table.journal.world, tabletop: { ...(table.journal.world.tabletop ?? {}), followView: true } } } });
  });
  await openKeep(p.page, origin);
  await switchTo(p.page, "The Cellar");
  const moved = p.page.locator("[data-sonner-toast]").filter({ hasText: "Your token moved to The Cellar" });
  await expect(moved).toBeVisible({ timeout: 8000 });
  await expect(moved).toContainText("Still with the party: same zone (Testville)");
  await moved.hover();
  // The player's switch beside the toast (mockup frame 4).
  await p.page.getByRole("button", { name: /All map settings|Map settings/ }).first().click();
  await p.page.locator("#map-settings-players").scrollIntoViewIfNeeded();
  await expect(p.page.getByRole("switch", { name: /Follow me/ })).toBeVisible();
  await p.page.screenshot({ path: `${out}/followed-1280.png` });
  await p.page.keyboard.press("Escape");
  assert.deepEqual((await mapOf(p.page, "cellar")).tokens.map((t) => t.entityId), ["mira"]);
  assert.equal((await mapOf(p.page, "keep")).tokens.some((t) => t.entityId === "mira"), false);
  await moved.hover();
  await moved.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await mapOf(p.page, "keep")).tokens.find((t) => t.entityId === "mira")?.column).toBe(12);
  assert.equal((await mapOf(p.page, "cellar")).tokens.length, 0);
  // Another place: viewing only.
  await switchTo(p.page, "Saltmarsh Road");
  await expect(p.page.locator("[data-sonner-toast]").filter({ hasText: "Viewing only — Mira is in Testville." })).toBeVisible({ timeout: 8000 });
  assert.equal((await mapOf(p.page, "faraway")).tokens.length, 0);
  // Follow me off: browsing moves nothing.
  await switchTo(p.page, "The Old Keep");
  await p.page.getByRole("button", { name: /All map settings|Map settings/ }).first().click();
  const mine = p.page.getByRole("switch", { name: /Follow me/ });
  await expect(mine).toHaveAttribute("aria-checked", "true");
  await mine.click();
  await expect(mine).toHaveAttribute("aria-checked", "false");
  await p.page.keyboard.press("Escape");
  await switchTo(p.page, "The Cellar");
  await p.page.waitForTimeout(2500);
  assert.equal((await mapOf(p.page, "cellar")).tokens.length, 0, "Follow me off: nothing moves");
  await p.context.close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("map-follow-view: passed");
} finally {
  await browser.close();
}
