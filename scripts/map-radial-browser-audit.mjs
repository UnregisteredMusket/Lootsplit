// Map tokens PR 5 (docs/plans/MAP-TOKENS.md section 4; mockups docs/previews/map-tokens/
// radial-mobile and radial-mobile-320): a disposable device campaign on touch screens at 390 × 844,
// 320 × 700 and 844 × 390. Pan, pinch and a token drag never open the radial; holding still for
// 500 ms does (with a progress ring and a vibration tick), slide-to-select runs a slice on release,
// releasing in the centre keeps it open for a tap, Move party ▸ opens a second ring with Back,
// More opens the bottom sheet, Android Back closes it, reduced motion drops the animations and the
// tick, and a player's wheel has no DM slice. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { openApplication } from "./title-screen-navigation.mjs";
import { journalOf, noSidewaysScroll, openKeep, seatAs, seedKeep, settle, squarePoint } from "./map-tokens-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = (process.env.AUDIT_RESULTS_DIR || "test-results") + "/map-radial";
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
      { id: "ogre", kind: "creature", label: "Ogre", encounterId: "fight", combatantId: "ogre", column: 15, row: 11, visibility: "party", sizeClass: "large", anchor: "corner" },
    ],
    world: { characterPositions: [{ purseId: "kett", inParty: false, locationId: null, visible: true, sheetVisible: true }] },
    keep: { connected: { parentMapId: "city", links: [link("l1", "cellar", "trapdoor", 0.2, 0.8), link("l2", "upper", "stairs", 0.3, 0.2), link("l3", "forest", "North Gate", 0.5, 0.02)], placements: [] } },
    extraMaps: [
      { id: "cellar", name: "The Cellar", type: "dungeon", locationId: "testville", visible: true, anchors: [], markers: [], grid, tokens: [], connected: { parentMapId: "keep", links: [], placements: [] } },
      { id: "upper", name: "Keep — Upper floor", type: "dungeon", locationId: "testville", visible: true, anchors: [], markers: [], connected: { parentMapId: "keep", links: [], placements: [] } },
      { id: "city", name: "City-Testville", type: "city", locationId: "testville", visible: true, anchors: [], markers: [] },
      { id: "forest", name: "Forest outside of Testville", type: "regional", locationId: "testville", visible: true, anchors: [], markers: [] },
    ],
  });
const keepMap = async (page) => (await journalOf(page)).world.maps.find((m) => m.id === "keep");
const errors = [];

async function open(viewport, { reducedMotion = "no-preference", player = false } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, reducedMotion });
  await context.addInitScript(() => {
    localStorage.setItem("quire.guide.offer.v3", "seen");
    localStorage.setItem("lootsplit.map.toolNames.v1", "hidden");
    window.__vibrations = 0;
    navigator.vibrate = () => (window.__vibrations++, true);
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await openApplication(page, origin + "/maps");
  await seed(page);
  if (player) await seatAs(page, ["mira"]);
  await openKeep(page, origin);
  await settle(page);
  const cdp = await context.newCDPSession(page);
  // A one-pixel contact, so Chrome's touch adjustment doesn't snap the press onto a nearby token.
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p) => ({ radiusX: 1, radiusY: 1, ...p })) });
  return {
    context,
    page,
    down: (x, y) => touch("touchStart", [{ x, y }]),
    move: (x, y) => touch("touchMove", [{ x, y }]),
    // A real tap comes a moment after the lift that left the wheel open.
    up: async () => (await touch("touchEnd", []), await page.waitForTimeout(350)),
    touch,
    hold: async (x, y, ms = 650) => {
      await touch("touchStart", [{ x, y }]);
      await page.waitForTimeout(ms);
    },
  };
}
const radial = (page) => page.locator(".map-radial");
/** A visible empty square well inside the map (the phone's camera differs per size). */
async function freeSpot(page, viewport) {
  const candidates = [];
  for (let c = 0; c < 28; c++) for (let r = 0; r < 18; r++) candidates.push([c + 0.5, r + 0.5]);
  const points = await Promise.all(candidates.map(async ([c, r]) => ({ c, r, ...(await squarePoint(page, c, r)) })));
  const top = viewport.height < 500 ? 70 : 140,
    bottom = viewport.height < 500 ? 70 : 110;
  points.sort((a, b) => Math.hypot(a.x - viewport.width / 2.6, a.y - viewport.height / 2) - Math.hypot(b.x - viewport.width / 2.6, b.y - viewport.height / 2));
  for (const { c, r, ...p } of points) {
    if (p.x < 60 || p.x > viewport.width - 60 || p.y < top || p.y > viewport.height - bottom) continue;
    // Empty, and not next to a token or pin (a finger covers more than a pixel).
    const empty = await page.evaluate(
      ({ x, y }) =>
        !!document.elementFromPoint(x, y)?.closest(".map-viewport") &&
        ![...document.querySelectorAll(".map-viewport button, .map-viewport [data-map-token]")].some((el) => {
          const b = el.getBoundingClientRect();
          return x > b.left - 40 && x < b.right + 40 && y > b.top - 40 && y < b.bottom + 40;
        }),
      p,
    );
    if (empty) return { ...p, column: Math.floor(c) + 1, row: Math.floor(r) + 1 };
  }
  throw Error("no free square visible");
}
const slices = (page) => page.locator(".map-radial [data-slice]").evaluateAll((els) => els.map((e) => e.querySelector("small")?.textContent));

try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 700 },
    { width: 844, height: 390 },
  ]) {
    const label = `${viewport.width}x${viewport.height}`;
    const t = await open(viewport);
    const { page } = t;
    const free = await freeSpot(page, viewport);
    const centre = free;
    // Pan: moving more than 6 px before 500 ms pans and never opens the radial.
    const before = await page.locator(".map-view-frame .map-viewport .map-layer").boundingBox();
    await t.down(centre.x, centre.y);
    await page.waitForTimeout(100);
    await t.move(centre.x + 30, centre.y + 10);
    await page.waitForTimeout(600);
    await expect(radial(page)).toHaveCount(0);
    await t.up();
    const after = await page.locator(".map-view-frame .map-viewport .map-layer").boundingBox();
    assert.ok(Math.abs(after.x - before.x) > 20, `${label}: the drag panned`);
    // Pinch: a second finger cancels the hold.
    await t.touch("touchStart", [{ x: centre.x - 30, y: centre.y }]);
    await t.touch("touchStart", [{ x: centre.x - 30, y: centre.y }, { x: centre.x + 30, y: centre.y }]);
    await page.waitForTimeout(650);
    await expect(radial(page)).toHaveCount(0);
    await t.up();
    if (viewport.width === 390) {
      // A token drag stays a drag.
      await settle(page);
      const mira = await squarePoint(page, 12.5, 7.5),
        to = await squarePoint(page, 10.5, 5.5);
      await t.down(mira.x, mira.y);
      await page.waitForTimeout(80);
      for (let i = 1; i <= 6; i++) await t.move(mira.x + ((to.x - mira.x) * i) / 6, mira.y + ((to.y - mira.y) * i) / 6);
      await page.waitForTimeout(600);
      await expect(radial(page)).toHaveCount(0);
      await t.up();
      await expect.poll(async () => (await keepMap(page)).tokens.find((x) => x.id === "mira-token").column).toBe(10);
      await settle(page);
    }
    // Hold still: the progress ring, then the radial with a tick, the square in the hub.
    const at = await freeSpot(page, viewport);
    await t.down(at.x, at.y);
    await page.waitForTimeout(250);
    await expect(page.locator(".map-radial-progress")).toBeVisible();
    await page.waitForTimeout(400);
    await expect(radial(page)).toBeVisible();
    assert.deepEqual(await slices(page), ["Encounter", "Creatures", "Characters", "Place party", "Move party ▸", "Ping", "Reveal", "More"]);
    await expect(page.locator(".map-radial-hubtext")).toContainText(`Col ${at.column} · Row ${at.row}`);
    assert.ok((await page.evaluate(() => window.__vibrations)) >= 1, "a tick when it opens");
    // Every slice is at least 48 px and inside the screen.
    for (const box of await page.locator(".map-radial [data-slice]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON())))
      assert.ok(box.width >= 48 && box.height >= 48 && box.left >= 0 && box.right <= viewport.width && box.top >= 0 && box.bottom <= viewport.height, `${label}: slice inside`);
    // Slide onto Place party and release: the party is placed there in one action.
    const place = page.locator('[data-slice="place-party"]');
    const p = await place.boundingBox();
    await t.move(p.x + p.width / 2, p.y + p.height / 2);
    await expect(page.locator(".map-radial-pill")).toContainText("Place party here · cluster, 4 tokens");
    await page.screenshot({ path: `${out}/slide-${label}.png` });
    await t.up();
    await expect(radial(page)).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Placed 4 on The Old Keep" })).toBeVisible();
    // Tap mode: release in the centre, then tap Move party ▸ → a second ring with Back.
    await settle(page);
    Object.assign(free, await freeSpot(page, viewport));
    await t.hold(free.x, free.y);
    await t.up();
    await expect(radial(page)).toBeVisible();
    await page.locator('[data-slice="move-party"]').tap();
    assert.deepEqual(await slices(page), ["The Cellar", "Upper floor", "Testville", "Forest", "Back"]);
    await expect(page.locator(".map-radial-pill")).toContainText("The Cellar · via trapdoor · players follow");
    await page.screenshot({ path: `${out}/submenu-${label}.png` });
    await page.locator('[data-slice="back"]').tap();
    // More: every item in a bottom sheet; Android Back closes it.
    await page.locator('[data-slice="more"]').tap();
    const sheet = page.locator(".map-action-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("menuitem", { name: /Share this view with players/ })).toBeAttached();
    await expect(sheet.getByText("Table · Reveal", { exact: true })).toBeAttached();
    assert.ok(await noSidewaysScroll(page), `${label}: no sideways scroll`);
    await page.screenshot({ path: `${out}/more-${label}.png` });
    await page.evaluate(async () => (await import("/src/lib/mobile/back-chain.ts")).androidBackStep());
    await expect(sheet).toHaveCount(0);
    // Android Back and the hub close the radial too.
    await t.hold(free.x, free.y);
    await t.up();
    await page.evaluate(async () => (await import("/src/lib/mobile/back-chain.ts")).androidBackStep());
    await expect(radial(page)).toHaveCount(0);
    await t.hold(free.x, free.y);
    await t.up();
    await page.locator(".map-radial-hubtext").tap();
    await expect(radial(page)).toHaveCount(0);
    if (viewport.width === 390) {
      // On a token (DM): the token wheel.
      const ogre = await squarePoint(page, 16, 12);
      await t.hold(ogre.x, ogre.y);
      await t.up();
      assert.deepEqual(await slices(page), ["Tracker", "Hide", "Lock", "Initiative", "Size ▸", "Send to ▸", "Remove", "More"]);
      await expect(page.locator(".map-radial-hubtext")).toContainText("Ogre");
      await page.screenshot({ path: `${out}/token-${label}.png` });
      await page.locator('[data-slice="hide"]').tap();
      await expect.poll(async () => (await keepMap(page)).tokens.find((x) => x.id === "ogre").visibility).toBe("dm");
    }
    await t.context.close();
  }

  // Reduced motion: no fill animation, no vibration.
  const calm = await open({ width: 390, height: 844 }, { reducedMotion: "reduce" });
  const calmAt = await freeSpot(calm.page, { width: 390, height: 844 });
  await calm.down(calmAt.x, calmAt.y);
  await calm.page.waitForTimeout(250);
  assert.equal(await calm.page.locator(".map-radial-progress .fill").evaluate((e) => getComputedStyle(e).animationName), "none");
  await calm.page.waitForTimeout(400);
  await expect(radial(calm.page)).toBeVisible();
  assert.equal(await calm.page.evaluate(() => window.__vibrations), 0);
  await calm.up();
  await calm.context.close();

  // A player: the short wheel, never a DM slice.
  const player = await open({ width: 390, height: 844 }, { player: true });
  const spot = await freeSpot(player.page, { width: 390, height: 844 });
  await player.hold(spot.x, spot.y);
  await player.up();
  assert.deepEqual(await slices(player.page), ["Ping", "Measure", "My sheet"]);
  await player.page.screenshot({ path: `${out}/player-390.png` });
  await player.context.close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("map-radial: passed");
} finally {
  await browser.close();
}
