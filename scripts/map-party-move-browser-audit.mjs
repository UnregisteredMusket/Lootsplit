// Map tokens PR 6 (docs/plans/MAP-TOKENS.md section 3.1): the map menu's party and quick flows on
// a disposable device campaign and a disposable live room at 1280 × 800. "Move party to ▸ The
// Cellar" shows its summary first (Cancel changes nothing), then moves the place, the players'
// scene and the tokens in one batch; a split party moves only the chosen group; Add creatures
// here searches the SRD, creates the encounter and places DM-only tokens; Add characters here
// places the ticked characters; Start encounter here opens the encounter controls on this map with
// New encounter…. The room repeats the party move through the server. Never targets a real
// campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { openApplication } from "./title-screen-navigation.mjs";
import { journalOf, openKeep, seedKeep, settle, squarePoint } from "./map-tokens-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = (process.env.AUDIT_RESULTS_DIR || "test-results") + "/map-party-move";
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
    tokens: [character("mira", "Mira", 12, 7), character("torvald", "Torvald", 13, 7), character("sela", "Sela", 12, 8), character("bram", "Bram", 13, 8)],
    world: { characterPositions: [{ purseId: "kett", inParty: false, locationId: null, visible: true, sheetVisible: true }] },
    keep: { connected: { parentMapId: "city", links: [link("l1", "cellar", "trapdoor", 0.2, 0.8)], placements: [] } },
    extraMaps: [
      { id: "cellar", name: "The Cellar", type: "dungeon", locationId: "testville", visible: true, anchors: [], markers: [], grid, tokens: [], connected: { parentMapId: "keep", links: [link("l2", "keep", "ladder", 0.5, 0.5)], placements: [] } },
      { id: "city", name: "City-Testville", type: "city", locationId: "testville", visible: true, anchors: [], markers: [] },
    ],
  });
const mapOf = async (page, id) => (await journalOf(page)).world.maps.find((m) => m.id === id);
const errors = [];
async function dmPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem("quire.guide.offer.v3", "seen");
    localStorage.setItem("lootsplit.map.toolNames.v1", "hidden");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await openApplication(page, origin + "/maps");
  await seed(page);
  return { context, page };
}
async function menuAt(page, column, row) {
  await settle(page);
  const p = await squarePoint(page, column, row);
  await page.mouse.click(p.x, p.y, { button: "right" });
  return page.locator(".map-context-menu");
}
async function moveToCellar(page) {
  const menu = await menuAt(page, 4.5, 3.5);
  await menu.getByRole("menuitem", { name: /Move party to/ }).click();
  await page.locator(".map-context-submenu").getByRole("menuitem", { name: /The Cellar/ }).click();
  return page.getByRole("alertdialog", { name: /Move the party to The Cellar\?/ });
}

try {
  // Device campaign.
  const { context, page } = await dmPage();
  await openKeep(page, origin);
  // The summary first; Cancel changes nothing.
  let dialog = await moveToCellar(page);
  await expect(dialog).toContainText("The party moves to The Cellar · players' scene switches · 4 tokens placed at the trapdoor");
  await page.screenshot({ path: `${out}/summary-1280.png` });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  assert.equal((await mapOf(page, "keep")).tokens.length, 4);
  // Move party: one batch; the view opens the destination.
  dialog = await moveToCellar(page);
  await dialog.getByRole("button", { name: "Move party" }).click();
  await expect.poll(async () => (await mapOf(page, "cellar")).tokens.length).toBe(4);
  assert.equal((await mapOf(page, "keep")).tokens.length, 0);
  assert.equal((await journalOf(page)).world.tabletop.activeMapId, "cellar");
  await expect(page.locator(".map-title-capsule, .map-workspace-chrome").first()).toContainText("The Cellar");

  // Add characters here (on The Cellar): Kett, who isn't in the party.
  let menu = await menuAt(page, 3.5, 3.5);
  await menu.getByRole("menuitem", { name: /Add characters here/ }).click();
  const characters = page.getByRole("dialog", { name: "Add characters here" });
  await characters.getByRole("checkbox", { name: /Kett/ }).check();
  await expect(characters).toContainText("not in the party");
  await characters.getByRole("button", { name: "Place 1 here" }).click();
  await expect.poll(async () => (await mapOf(page, "cellar")).tokens.some((t) => t.entityId === "kett")).toBe(true);

  // Add creatures here: SRD search, a new encounter, DM-only tokens at the point.
  // The Open5e index is stubbed (as in local-encounter-browser-audit): no network in the audit.
  await page.route("https://api.open5e.com/v2/creatures/**", (route) =>
    route.fulfill({
      json: {
        results: [
          { key: "srd-2014_goblin", name: "Goblin", size: { key: "small" }, document: { key: "srd-2014" }, hit_points: 7, armor_class: 15, challenge_rating: 0.25, experience_points: 50, initiative_bonus: 2, type: { name: "Humanoid" }, environments: [{ name: "Forest" }], traits: [], actions: [] },
        ],
        next: null,
      },
    }),
  );
  menu = await menuAt(page, 15.5, 3.5);
  await menu.getByRole("menuitem", { name: /Add creatures here/ }).click();
  const creatures = page.getByRole("dialog", { name: "Add creatures here" });
  await creatures.getByRole("searchbox", { name: "Search SRD creatures" }).fill("goblin");
  await creatures.getByRole("button", { name: "Search", exact: true }).click();
  await creatures.getByRole("button", { name: "Add Goblin", exact: true }).click();
  await creatures.getByRole("button", { name: "Add Goblin", exact: true }).click();
  await page.screenshot({ path: `${out}/add-creatures-1280.png` });
  await creatures.getByRole("button", { name: "Add 2 creatures here" }).click();
  await expect.poll(async () => (await mapOf(page, "cellar")).tokens.filter((t) => t.kind === "creature" && t.visibility === "dm").length).toBe(2);
  const goblins = (await mapOf(page, "cellar")).tokens.filter((t) => t.kind === "creature");
  assert.deepEqual(goblins.map((t) => t.label).sort(), ["Goblin 1", "Goblin 2"]);
  assert.ok(goblins.every((t) => t.encounterId && t.combatantId), "linked to the tracker");

  // Start encounter here: this map is the encounter map; New encounter… creates and selects one.
  menu = await menuAt(page, 8.5, 8.5);
  await menu.getByRole("menuitem", { name: /Start encounter here/ }).click();
  const workspace = page.getByRole("region", { name: "Encounter map workspace" });
  await expect(workspace.getByRole("combobox", { name: "Encounter map" })).toContainText("The Cellar");
  await workspace.getByRole("button", { name: "New encounter…" }).click();
  await page.getByLabel("Encounter name").fill("Cellar ambush");
  await page.getByRole("button", { name: "Create encounter" }).click();
  await expect(workspace).toContainText("Created Cellar ambush.");
  await context.close();

  // A split party: only the chosen group moves.
  const split = await dmPage();
  await split.page.evaluate(async () => {
    const economy = await import("/src/lib/quire/economy.ts");
    const { partyGroupsFingerprint } = await import("/src/lib/quire/party-groups.ts");
    const table = await economy.economySnapshot();
    await economy.executeFinanceBatch(crypto.randomUUID(), [
      { id: crypto.randomUUID(), kind: "party-split", before: partyGroupsFingerprint(table), groups: [{ id: "b", name: "Bram's band", colour: "blue", locationId: "testville", memberIds: ["bram"] }] },
    ]);
  });
  await openKeep(split.page, origin);
  menu = await menuAt(split.page, 4.5, 3.5);
  await menu.getByRole("menuitem", { name: /Move party to/ }).click();
  const sub = split.page.locator(".map-context-submenu");
  await sub.getByRole("menuitemcheckbox", { name: "Bram's band" }).click();
  await expect(sub.getByRole("menuitemcheckbox", { name: "Bram's band" })).toHaveAttribute("aria-checked", "true");
  await sub.getByRole("menuitemcheckbox", { name: "Players' scene follows" }).click();
  await sub.getByRole("menuitem", { name: /The Cellar/ }).click();
  dialog = split.page.getByRole("alertdialog", { name: /Move Bram's band to The Cellar\?/ });
  await expect(dialog).toContainText("Bram's band moves to The Cellar · 1 token placed at the trapdoor");
  await dialog.getByRole("button", { name: "Move party" }).click();
  await expect.poll(async () => (await mapOf(split.page, "cellar")).tokens.map((t) => t.entityId)).toEqual(["bram"]);
  assert.equal((await mapOf(split.page, "keep")).tokens.length, 3);
  await split.context.close();

  // A live room: the same batch through the server.
  const room = await dmPage();
  await room.page.evaluate(async () => {
    const { chooseTableMode } = await import("/src/lib/quire/cloud-client.ts");
    await chooseTableMode("live");
  });
  await openKeep(room.page, origin);
  dialog = await moveToCellar(room.page);
  await dialog.getByRole("button", { name: "Move party" }).click();
  await expect.poll(async () => (await mapOf(room.page, "cellar")).tokens.length, { timeout: 15000 }).toBe(4);
  assert.equal((await mapOf(room.page, "keep")).tokens.length, 0);
  assert.equal((await journalOf(room.page)).world.tabletop.activeMapId, "cellar");
  await room.context.close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("map-party-move: passed");
} finally {
  await browser.close();
}
