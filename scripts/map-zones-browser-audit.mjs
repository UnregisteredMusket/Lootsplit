// Map tokens PR 7A (docs/plans/MAP-TOKENS.md section 6A; mockup docs/previews/map-tokens/zones):
// the DM's Zones editor on a disposable device campaign (Testville from its locations, an added
// sewer map, Party vote, the North Gate adjacency, Save zone) and the split requests in a
// disposable live room: Mira's player opens the forest beyond the North Gate, sees "Asking the
// party…", Torvald's player gets "Mira wants to leave Testville" and lets her go, and Mira is split
// off with "You left Testville". A far map says "This trip takes about 2 days". Never targets a
// real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { continueIntoApp, openApplication } from "./title-screen-navigation.mjs";
import { journalOf, openKeep, seedKeep, settle } from "./map-tokens-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = (process.env.AUDIT_RESULTS_DIR || "test-results") + "/map-zones";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const character = (id, label, column, row) => ({ id: `${id}-token`, kind: "character", entityId: id, label, column, row, visibility: "party" });
const link = (id, targetMapId, label, x, y) => ({ id, targetMapId, label, x, y, visibility: "party" });
const grid = { columns: 20, rows: 12, feetPerTile: 5, diagonal: "equal", x: 0, y: 0, width: 1, height: 1 };
const errors = [];
const look = !!process.env.MOCKUP_LOOK;
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript((look) => {
    localStorage.setItem("quire.guide.offer.v3", "seen");
    localStorage.setItem("lootsplit.map.toolNames.v1", "hidden");
    if (look) localStorage.setItem("quire.prefs.v1", JSON.stringify({ appearance: "dark", accent: "#e0a04a", ground: "#10182c", fantasyBackgrounds: false }));
  }, look);
  return ctx;
}
const seed = (page) =>
  seedKeep(page, {
    tokens: [character("mira", "Mira", 12, 7), character("torvald", "Torvald", 13, 7), character("sela", "Sela", 12, 8), character("bram", "Bram", 13, 8)],
    world: { tabletop: { followView: true }, characterPositions: [{ purseId: "kett", inParty: false, locationId: null, visible: true, sheetVisible: true }] },
    keep: { name: "City-Testville", connected: { links: [link("gate", "forest", "North Gate", 0.5, 0.02)], placements: [] } },
    extraMaps: [
      { id: "commons", name: "City-Testville-The Commons", type: "city", locationId: "testville", visible: true, anchors: [], markers: [], grid, tokens: [] },
      { id: "sewers", name: "Testville Sewers", type: "dungeon", locationId: null, visible: true, anchors: [], markers: [], grid, tokens: [] },
      { id: "forest", name: "Forest outside of Testville", type: "regional", locationId: "greenvale", visible: true, anchors: [], markers: [], grid, tokens: [], connected: { links: [link("back", "keep", "City gate", 0.5, 0.98)], placements: [] } },
      { id: "road", name: "Saltmarsh Road", type: "regional", locationId: null, visible: true, anchors: [], markers: [], grid, tokens: [] },
    ],
  });
async function switchTo(page, name) {
  const search = page.getByRole("combobox", { name: /Search maps/ }).or(page.getByRole("searchbox", { name: /Search maps/ })).first();
  await search.click();
  await search.fill(name);
  await page.getByRole("option", { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.locator(".map-title-capsule, .map-workspace-chrome").first()).toContainText(name);
  await settle(page);
}

try {
  // 1. The DM's Zones editor.
  const dmCtx = await context();
  const dm = await dmCtx.newPage();
  dm.on("pageerror", (e) => errors.push(e.message));
  await openApplication(dm, origin + "/maps");
  await seed(dm);
  await openKeep(dm, origin);
  await dm.getByRole("button", { name: /All map settings|Map settings/ }).first().click();
  await dm.getByRole("button", { name: /^Zones…/ }).click();
  const editor = dm.getByRole("dialog", { name: "Zones" });
  await expect(editor.getByRole("option", { name: /Testville\s*City · free travel · 2 maps/ })).toHaveAttribute("aria-selected", "true");
  await expect(editor).toContainText("Unzoned maps");
  await editor.getByLabel("Add map…").selectOption({ label: "Testville Sewers" });
  await expect(editor.locator(".map-zones-row").filter({ hasText: "Testville Sewers" })).toContainText("Added");
  await editor.getByRole("radio", { name: "Party vote", exact: true }).click();
  if (process.env.DEBUG_Z) await dm.screenshot({ path: `${out}/debug.png` });
  await expect(editor.getByRole("switch", { name: "Greenvale is adjacent" })).toHaveAttribute("aria-checked", "true");
  await expect(editor.locator(".map-zones-row.adj").filter({ hasText: "Greenvale" })).toContainText("via the North Gate entrance");
  await dm.screenshot({ path: `${out}/zones-editor-1280.png` });
  await editor.getByRole("button", { name: "Save zone" }).click();
  await expect(editor).toHaveCount(0);
  const zones = (await journalOf(dm)).world.zones;
  assert.equal(zones.length, 1);
  assert.deepEqual(zones[0].mapIds, ["sewers"]);
  assert.equal(zones[0].settings.splitRule, "vote");
  await dmCtx.close();

  // 2. A live room: the party vote.
  const roomCtx = await context();
  const host = await roomCtx.newPage();
  host.on("pageerror", (e) => errors.push(e.message));
  await openApplication(host, origin + "/maps");
  await seed(host);
  await host.evaluate(async () => (await import("/src/lib/quire/cloud-client.ts")).chooseTableMode("live"));
  const [code, sessionId] = await host.evaluate(async () => {
    const cloud = await import("/src/lib/quire/cloud-client.ts");
    return [cloud.roomCredentials().code, cloud.getCloudTable().sessionId];
  });
  const join = async (purseId, name) => {
    const ctx = await context();
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/");
    await page.evaluate(async ({ code, purseId, name, sessionId }) => (await import("/src/lib/quire/cloud-client.ts")).joinTable(code, purseId, name, undefined, sessionId), { code, purseId, name, sessionId });
    await page.goto(origin + "/maps?map=keep");
    await continueIntoApp(page);
    await settle(page);
    return { ctx, page };
  };
  const mira = await join("mira", "Mira's player");
  const torv = await join("torvald", "Torvald's player");
  await switchTo(mira.page, "Forest outside of Testville");
  const asking = mira.page.getByRole("status", { name: "Asking the party" });
  await expect(asking).toBeVisible({ timeout: 15000 });
  await expect(asking).toContainText("Going to Forest outside of Testville would split Mira off. Your DM set this to a party vote (majority).");
  await expect(asking).toContainText("1 yes · 0 no · 1 waiting");
  await mira.page.screenshot({ path: `${out}/mover-1280.png` });
  const ballot = torv.page.getByRole("alertdialog", { name: "Party vote" });
  await expect(ballot).toBeVisible({ timeout: 15000 });
  await expect(ballot).toContainText("Mira wants to leave Testville");
  await torv.page.screenshot({ path: `${out}/voter-1280.png` });
  await ballot.getByRole("button", { name: "Let Mira go" }).click();
  await expect(mira.page.locator("[data-sonner-toast]").filter({ hasText: "You left Testville. You're now separate from the party." })).toBeVisible({ timeout: 15000 });
  const groups = (await journalOf(host)).world.groups ?? [];
  await expect.poll(async () => ((await journalOf(host)).world.groups ?? []).filter((g) => g.status === "active").length, { timeout: 15000 }).toBe(1);
  void groups;
  // A far map: a journey.
  await switchTo(torv.page, "Saltmarsh Road");
  await expect(torv.page.locator("[data-sonner-toast]").filter({ hasText: "This trip takes about 2 days. Ask your DM to plan the journey." })).toBeVisible({ timeout: 8000 });
  await torv.page.screenshot({ path: `${out}/journey-1280.png` });
  await mira.ctx.close();
  await torv.ctx.close();
  await roomCtx.close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("map-zones: passed");
} finally {
  await browser.close();
}
