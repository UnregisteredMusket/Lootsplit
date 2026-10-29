// Map tokens PR 2 (docs/plans/MAP-TOKENS.md section 1; mockup docs/previews/map-tokens/
// player-token-move frames 1-3): players move their own tokens. A disposable device campaign
// seated as Mira's player at 1280 × 800: free movement and fog chips, "Mira (you)", the drag card,
// another player's token stays put, Place my token. A disposable shared room (live) with an
// encounter row written to the local development database: the turn strip, "Not your turn", the
// lock and waiting chip, then the player's own turn with the speed guide and a move; the DM's
// "Turn on Automatic" notice on a map configured before this change. Phone width checks no
// sideways scroll. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { expect } from "playwright/test";
import { openApplication, continueIntoApp } from "./title-screen-navigation.mjs";
import {
  KEEP,
  journalOf,
  noSidewaysScroll,
  openKeep,
  seatAs,
  seedKeep,
  settle,
  squarePoint,
} from "./map-tokens-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = (process.env.AUDIT_RESULTS_DIR || "test-results") + "/map-player-move";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const character = (id, label, column, row) => ({ id: `${id}-token`, kind: "character", entityId: id, label, column, row, visibility: "party" });
const party = [character("mira", "Mira", 12, 7), character("torvald", "Torvald", 13, 7), character("sela", "Sela", 12, 8), character("bram", "Bram", 13, 8)];
const fog = { enabled: true, base: "concealed", shapes: [{ id: "lit", kind: "rectangle", reveal: true, a: { x: 0, y: 0 }, b: { x: 20 / KEEP.columns, y: 1 } }] };
const keepMap = async (page) => (await journalOf(page)).world.maps.find((m) => m.id === "keep");
const newContext = async (width, height) => {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript((look) => {
    localStorage.setItem("quire.guide.offer.v3", "seen");
    localStorage.setItem("lootsplit.map.toolNames.v1", "hidden");
    // Screenshots beside the mockups use the Glass look, whose colours the mockups use.
    if (look) localStorage.setItem("quire.prefs.v1", JSON.stringify({ appearance: "dark", accent: "#e0a04a", ground: "#10182c", fantasyBackgrounds: false }));
  }, !!process.env.MOCKUP_LOOK);
  return context;
};
const errors = [];

try {
  // A · exploring on the device, seated as Mira's player.
  {
    const context = await newContext(1280, 800),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/maps");
    await seedKeep(page, { tokens: party, tabletop: { movement: "auto", playerMovement: true, fog } });
    await seatAs(page, ["mira"]);
    await openKeep(page, origin);
    const chips = page.getByRole("group", { name: "Your movement" });
    await expect(chips).toContainText("Free movement: no combat");
    await expect(chips).toContainText("Fog: you can only move into what you can see");
    await expect(page.locator('[data-map-token="mira-token"] .map-token-label')).toHaveText("Mira (you)");
    const from = await squarePoint(page, 12.5, 7.5),
      to = await squarePoint(page, 16.5, 10.5);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    const card = page.locator(".map-token-drop-card");
    await expect(card).toContainText("col 17, row 11");
    await expect(card).toContainText("Release to move");
    await page.screenshot({ path: `${out}/exploring-drag-1280.png` });
    await page.mouse.up();
    await expect.poll(async () => (await keepMap(page)).tokens.find((t) => t.id === "mira-token").column).toBe(16);
    // Another player's token doesn't move.
    await settle(page);
    const t = await page.locator('[data-map-token="torvald-token"]').boundingBox();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + 120, t.y + 60, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal((await keepMap(page)).tokens.find((x) => x.id === "torvald-token").column, 13);
    // Place my token, for a character without one on this map.
    await seedKeep(page, { tokens: party.slice(1), tabletop: { movement: "auto", playerMovement: true } });
    await openKeep(page, origin);
    await page.getByRole("button", { name: "Place my token", exact: true }).click();
    await expect(page.getByText("Tap a square to place Mira.")).toBeVisible();
    const square = await squarePoint(page, 6.5, 5.5);
    await page.mouse.click(square.x, square.y);
    await expect
      .poll(async () => (await keepMap(page)).tokens.find((x) => x.entityId === "mira"))
      .toMatchObject({ column: 6, row: 5, visibility: "party" });
    await context.close();
  }

  // B · a shared room in combat: the player waits, then moves on their turn.
  {
    const dmContext = await newContext(1280, 800),
      dm = await dmContext.newPage();
    dm.on("pageerror", (e) => errors.push(e.message));
    await openApplication(dm, origin + "/maps");
    const grid = { columns: KEEP.columns, rows: KEEP.rows, feetPerTile: 5, diagonal: "equal", x: 0, y: 0, width: 1, height: 1 };
    await seedKeep(dm, {
      tokens: [
        ...party,
        { id: "ogre", kind: "creature", label: "Ogre", encounterId: "keep-fight", combatantId: "ogre", column: 16, row: 9, visibility: "party", sizeClass: "large", anchor: "corner" },
        { id: "goblin", kind: "creature", label: "Goblin 1", encounterId: "keep-fight", combatantId: "goblin", column: 15, row: 4, visibility: "party", sizeClass: "small" },
      ],
      tabletop: { movement: "auto", playerMovement: true },
      sheets: [{ purseId: "mira", edition: "2014", importedAt: 1, name: "Mira", speed: "30 ft." }],
    });
    await dm.evaluate(async () => {
      const { chooseTableMode } = await import("/src/lib/quire/cloud-client.ts");
      await chooseTableMode("live");
    });
    const [code, sessionId] = await dm.evaluate(async () => {
      const cloud = await import("/src/lib/quire/cloud-client.ts");
      return [cloud.roomCredentials().code, cloud.getCloudTable().sessionId];
    });
    assert.ok(code, "the DM opened a room");
    // The encounter row, in the local development database the dev server uses.
    const db = new DatabaseSync(process.env.ACCOUNT_DEV_DB || "data/account-dev.sqlite");
    db.exec("PRAGMA foreign_keys=OFF");
    const body = (activeId) =>
      JSON.stringify({ name: "Keep fight", round: 2, activeId, combatants: ["mira", "ogre", "torvald", "goblin", "sela", "bram"].map((id) => ({ id, name: id, side: id === "ogre" || id === "goblin" ? "enemy" : "ally", hp: 10, maxHp: 10, ac: 12, initiative: 10, initiativeBonus: 0, conditions: "", notes: "", cr: 0, xp: 0, source: "", sourceKey: "" })) });
    db.prepare("INSERT OR REPLACE INTO dm_encounters(id,user_id,code,body,status,revision,created_at,updated_at) VALUES (?,?,?,?,'active',1,1,1)").run("keep-fight", "audit-owner", code, body("ogre"));
    await dm.evaluate(
      async ({ grid }) => {
        const { queueCommand } = await import("/src/lib/quire/cloud-client.ts");
        const { canonicalJson } = await import("/src/lib/quire/canonical-json.ts");
        await queueCommand({
          kind: "map-combat-transition",
          before: null,
          beforeSession: null,
          binding: { id: "keep-binding", encounterId: "keep-fight", encounterRevision: 1, mapId: "keep", mode: "grid", phase: "active", gridFingerprint: canonicalJson(grid), scaleConfirmed: true, showPlayers: true, returnMapId: "keep", returnCamera: { x: 0.5, y: 0.5, zoom: 1 } },
        });
      },
      { grid },
    );
    const playerContext = await newContext(1280, 800),
      player = await playerContext.newPage();
    player.on("pageerror", (e) => errors.push(e.message));
    await openApplication(player, origin + "/");
    await player.evaluate(
      async ({ code, sessionId }) => {
        const { joinTable } = await import("/src/lib/quire/cloud-client.ts");
        await joinTable(code, "mira", "Mira's player", undefined, sessionId);
      },
      { code, sessionId },
    );
    await player.goto(origin + "/maps?map=keep");
    await continueIntoApp(player);
    await settle(player);
    const strip = player.getByRole("status", { name: "Map combat status" });
    await expect(strip).toContainText("Round 2");
    await expect(strip).toContainText("The Ogre is acting");
    await expect(player.locator(".map-title-context")).toHaveText(/Combat/);
    await expect(player.getByRole("group", { name: "Your movement" })).toContainText("Waiting: Mira is next after");
    await expect(player.locator('[data-map-token="mira-token"] .map-token-lock')).toHaveCount(1);
    await expect(player.locator('[data-map-token="mira-token"] .map-token-label')).toHaveText("You");
    // Pressing your token says whose turn it is; nothing moves.
    const mine = await player.locator('[data-map-token="mira-token"]').boundingBox();
    await player.mouse.move(mine.x + mine.width / 2, mine.y + mine.height / 2);
    await player.mouse.down();
    await player.mouse.move(mine.x + 140, mine.y + 80, { steps: 6 });
    await player.mouse.up();
    await expect(player.locator(".map-not-turn")).toContainText("Not your turn. The Ogre is acting.");
    await player.screenshot({ path: `${out}/not-your-turn-1280.png` });
    assert.equal((await keepMap(dm)).tokens.find((t) => t.id === "mira-token").column, 12);
    // Mira's turn: the speed guide shows, and the move is saved.
    db.prepare("UPDATE dm_encounters SET body=? WHERE id=?").run(body("mira"), "keep-fight");
    await expect(strip).toContainText("Your turn: Mira", { timeout: 15000 });
    await expect(player.getByRole("group", { name: "Your movement" })).toContainText("Combat: turn-based movement");
    await expect(player.getByRole("group", { name: "Your movement" })).toContainText("Speed 30 ft (from your sheet, shown as a guide)");
    await expect(player.locator(".map-token-reach rect").first()).toBeAttached();
    await expect(player.locator(".map-not-turn")).toHaveCount(0);
    await player.screenshot({ path: `${out}/your-turn-1280.png` });
    await settle(player);
    const a = await squarePoint(player, 12.5, 7.5),
      b = await squarePoint(player, 10.5, 6.5);
    await player.mouse.move(a.x, a.y);
    await player.mouse.down();
    await player.mouse.move(b.x, b.y, { steps: 6 });
    await player.mouse.up();
    await expect
      .poll(async () => (await keepMap(player)).tokens.find((t) => t.id === "mira-token").column, { timeout: 15000 })
      .toBe(10);
    // Phone width: the strip and chips fit.
    await player.setViewportSize({ width: 390, height: 844 });
    await settle(player);
    assert.ok(await noSidewaysScroll(player), "390: no sideways scroll");
    await player.screenshot({ path: `${out}/your-turn-390.png` });
    db.close();
    await playerContext.close();
    await dmContext.close();
  }

  // C · the DM's one-tap notice on a map configured before player movement was a choice.
  {
    const context = await newContext(1280, 800),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/maps");
    await seedKeep(page, { tokens: party, tabletop: { snap: true } });
    await openKeep(page, origin);
    await page.getByRole("button", { name: "Map settings", exact: true }).click();
    const notice = page.getByRole("note").filter({ hasText: "New: let players move their own tokens" });
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Turn on Automatic", exact: true }).click();
    await expect.poll(async () => (await keepMap(page)).tabletop.movement).toBe("auto");
    await expect(notice).toHaveCount(0);
    await context.close();
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("map-player-move: passed");
} finally {
  await browser.close();
}
