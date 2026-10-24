// Journey planner browser audit (docs/MAP-TILES.md "Journey planner") in a disposable device
// campaign: finding the planner (labelled Plan journey control, Here sheet, Downtime link), Plan
// route, scale-bar calibration on an ungridded map, tap-to-draw with snapping, leg
// insert and removal, the typed fallback and keyboard path, at 1280, 390, 320 and 844×390 with
// no sideways scrolling and the planner inside the viewport. Never targets a real campaign.
import { chromium } from "playwright";
import { expect } from "playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { checkJourneyPhaseB } from "./journey-planner-browser-steps.mjs";
import { checkJourneyDiscoverability } from "./journey-discoverability-browser-steps.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = "test-results/journey-planner";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const started = Date.now();
const noSideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const inside = (locator) =>
  locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
  });
/** Seed a disposable campaign: the party in Harrowgate on the ungridded Vale of Harrow. */
async function seedJourneyCampaign(page) {
  await page.evaluate(async () => {
    const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
    const { readJournal } = await import("/src/lib/quire/journal.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const c = canvas.getContext("2d");
    c.fillStyle = "#6b7f55";
    c.fillRect(0, 0, 1200, 800);
    c.fillStyle = "#c8b48a";
    c.fillRect(100, 380, 1000, 40);
    const image = canvas.toDataURL();
    const coins = (x) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...x });
    await applyCloudTable({
      purses: [
        { id: "fund", name: "Party fund", kind: "party", coins: coins({ gp: 20, sp: 3, cp: 7 }) },
        { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 5 }) },
        { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 3 }) },
      ],
      holdings: [],
      shops: [
        {
          id: "lantern",
          name: "Brass Lantern Outfitters",
          keeper: "Tamsin",
          place: "Harrowgate",
          locationId: "harrowgate",
          notes: "",
          sellRate: 1,
          buyRate: 0.5,
          wealth: "modest",
          category: "general",
          priceScale: 1,
        },
      ],
      stock: [],
      ledger: [],
      listings: [],
      loans: [],
      sheets: [],
      notes: [],
      journal: readJournal({
        market: {
          currentLocationId: "harrowgate",
          locations: [
            { id: "vale", name: "Vale of Harrow", kind: "region", parentId: null, description: "" },
            { id: "harrowgate", name: "Harrowgate", kind: "town", parentId: "vale", description: "" },
            { id: "kestrel", name: "Kestrel Watch", kind: "town", parentId: "vale", description: "" },
          ],
        },
        finance: { day: 40 },
        world: {
          maps: [
            {
              id: "vale-map",
              name: "Vale of Harrow",
              type: "regional",
              locationId: "vale",
              image,
              visible: true,
              anchors: [
                { locationId: "harrowgate", x: 0.2, y: 0.5 },
                { locationId: "kestrel", x: 0.8, y: 0.5 },
              ],
              markers: [],
            },
          ],
        },
      }),
    });
  });
}
const results = [];
try {
  for (const [width, height] of [
    [1280, 900],
    [390, 844],
    [320, 700],
    [844, 390],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    await context.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (r) => r.abort(),
    );
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    // Closing a drawn route asks before discarding it; the audit confirms.
    page.on("dialog", (dialog) => void dialog.accept());
    await openApplication(page, origin + "/maps");
    await seedJourneyCampaign(page);
    await reloadApplication(page, origin + "/maps?map=vale-map");
    const frame = page.getByRole("region", { name: "Map workspace", exact: true }),
      viewport = frame.getByRole("region", { name: "Interactive campaign map", exact: true }),
      planner = frame.getByRole("complementary", { name: "Plan a route", exact: true });
    await expect(frame.getByRole("img", { name: "Vale of Harrow", exact: true })).toBeVisible();
    const found = await checkJourneyDiscoverability(page, { origin, frame, width, height, output });
    await expect(frame.getByRole("img", { name: "Vale of Harrow", exact: true })).toBeVisible();
    await frame.getByRole("button", { name: "Fit map", exact: true }).click();
    // Open the planner: the map has no grid or scale yet.
    await frame.getByRole("button", { name: "Plan route", exact: true }).click();
    await expect(planner).toBeVisible();
    await expect(planner).toContainText("Routes need a scale.");
    assert.ok(await noSideways(page), `planner fits at ${width}px`);
    assert.ok(await inside(planner), `planner inside the viewport at ${width}px`);
    // Calibrate: handles at 30% and 70% of the width = 40 mi.
    await planner.getByRole("button", { name: "Set this map's scale", exact: true }).click();
    await expect(frame.getByRole("button", { name: "Scale handle A", exact: true })).toBeVisible();
    await planner.getByLabel("Scale distance", { exact: true }).fill("40");
    await expect(planner).toContainText("1 mile is");
    await page.screenshot({ path: `${output}/calibrate-${width}x${height}.png` });
    await planner.getByRole("button", { name: "Save scale", exact: true }).click();
    await expect(planner).toContainText("scale bar 40 mi");
    const saved = await page.evaluate(async () => {
      const { economySnapshot } = await import("/src/lib/quire/economy.ts");
      return (await economySnapshot()).journal.world.maps[0].scale;
    });
    assert.equal(saved.distance, 40);
    assert.equal(saved.unit, "mi");
    // Draw: the route starts at the party (Harrowgate). Kestrel Watch is added as a place (the
    // typed path); its pin may sit under the tool dock at some widths.
    await expect(frame.getByRole("button", { name: /^Waypoint 1: Harrowgate/ })).toBeVisible();
    await planner.getByRole("button", { name: "Type instead", exact: true }).click();
    await planner.getByLabel("Add an anchored place", { exact: true }).selectOption("kestrel");
    await planner.getByRole("button", { name: "Add place", exact: true }).click();
    const legs = planner.getByRole("list", { name: "Legs", exact: true });
    await expect(legs.getByRole("listitem")).toHaveCount(1);
    await expect(legs).toContainText("Harrowgate → Kestrel Watch");
    await expect(legs).toContainText("60.0 mi");
    // Tap the middle of the leg: a waypoint is inserted there. On phones the planner is a bottom
    // sheet and the map is framed in the band above it (mockup 4), so the route is tappable
    // without panning.
    await planner.getByRole("button", { name: "Tap to add", exact: true }).click();
    await viewport.focus();
    const centre = async (name) => {
      const b = await frame.getByRole("button", { name }).boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const [a, b] = [await centre(/^Waypoint 1: /), await centre(/^Waypoint 2: /)];
    if (width <= 650) {
      const sheet = await planner.boundingBox();
      for (const p of [a, b])
        assert.ok(
          p.y < sheet.y && p.y > 0 && p.x > 0 && p.x < width,
          `waypoint shown above the planner sheet at ${width}px`,
        );
    }
    await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
    await expect(legs.getByRole("listitem")).toHaveCount(2);
    await expect(legs).toContainText("Point ");
    await expect(planner).toContainText(/(59\.9|60\.0|60\.1) mi total/);
    assert.ok(await noSideways(page), `drawn route fits at ${width}px`);
    assert.ok(await inside(planner), `planner with legs inside the viewport at ${width}px`);
    await page.screenshot({ path: `${output}/draw-${width}x${height}.png` });
    // Tap the inserted waypoint to remove it.
    await frame.getByRole("button", { name: /^Waypoint 2: Point / }).click();
    await expect(legs.getByRole("listitem")).toHaveCount(1);
    // Typed fallback: add a free point.
    await planner.getByRole("button", { name: "Type instead", exact: true }).click();
    await planner.getByLabel("Waypoint as x%, y%", { exact: true }).fill("50, 30");
    await planner.getByRole("button", { name: "Add point", exact: true }).click();
    await expect(legs.getByRole("listitem")).toHaveCount(2);
    // Keyboard: Backspace on the map removes the last waypoint.
    await viewport.focus();
    await page.keyboard.press("Backspace");
    await expect(legs.getByRole("listitem")).toHaveCount(1);
    // The leg's terrain is chosen by the planner, never read from the artwork.
    await planner.getByLabel("Leg 1 terrain", { exact: true }).selectOption("Wilderness|Forest");
    const flows = [...found, "calibrate", "draw-snap", "insert-remove", "typed", "keyboard", "terrain"];
    if (width === 1280) flows.push(...(await checkJourneyPhaseB(page, { frame, planner, output })));
    else await planner.getByRole("button", { name: "Close route planner", exact: true }).click();
    await expect(planner).toHaveCount(0);
    assert.deepEqual(errors, []);
    results.push({ width, height, flows });
    await context.close();
  }
  console.log(JSON.stringify({ ok: true, durationMs: Date.now() - started, results }));
} finally {
  await browser.close();
}
