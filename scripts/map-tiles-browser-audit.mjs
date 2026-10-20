import { openMapSettings, closeMapSettings, selectWorkspaceMap, selectMapType, openMoreMapTools } from "./map-workspace-browser.mjs";
import { checkConnectedMaps } from "./connected-maps-browser-check.mjs";
import { checkFullscreenMap } from "./fullscreen-map-browser-check.mjs";
import { checkPlayerDisplay } from "./player-display-browser-check.mjs";
import { checkOnlineTabletop } from "./online-tabletop-browser-check.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { blankEncounter, blankCombatant } from "../src/lib/encounters/model.mjs";
import {
  openApplication,
  reloadApplication,
  navigateApplication,
} from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";
import { createAndSaveRoom } from "./browser/account-fixtures.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080",
  output = "test-results/map-tiles",
  started = Date.now(),
  errors = [];
assert.match(
  origin,
  /^http:\/\/(127\.0\.0\.1|localhost):/,
  "Map tile fixtures require a disposable server",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
let current;
async function journal(page) {
  return page.evaluate(async () => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((c) => c.id === active)
          ?.db || "quire",
      db = await new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    try {
      return await new Promise((res, rej) => {
        const r = db.transaction("meta").objectStore("meta").get("journal");
        r.onsuccess = () => res(r.result.value);
        r.onerror = () => rej(r.error);
      });
    } finally {
      db.close();
    }
  });
}
async function fits(page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Tile controls fit the viewport",
  );
}
async function tileForm(page, label) {
  return page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: label, exact: true }) });
}
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      serviceWorkers: "block",
    });
    await context.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (r) => r.abort(),
    );
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    current = page;
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/maps");
    const encounter = {
      id: `local-tiles-${width}`,
      code: "device",
      body: {
        ...blankEncounter(),
        name: "Keep ambush",
        combatants: [{ ...blankCombatant(), id: "guard", name: "Hidden guard" }],
      },
      revision: 0,
      status: "draft",
      updated_at: Date.now(),
      rolls: [],
      award: null,
    };
    await page.evaluate(async (encounter) => {
      const active = localStorage.getItem("quire.campaign.v1"),
        name =
          JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find(
            (c) => c.id === active,
          )?.db || "quire",
        db = await new Promise((res, rej) => {
          const r = indexedDB.open(name);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 600;
      const c = canvas.getContext("2d");
      c.fillStyle = "#d7ceb0";
      c.fillRect(0, 0, 800, 600);
      c.strokeStyle = "#766550";
      c.lineWidth = 8;
      c.strokeRect(70, 70, 660, 460);
      c.font = "30px serif";
      c.fillStyle = "#2b2118";
      c.fillText("KEEP COURTYARD", 230, 140);
      const image = canvas.toDataURL("image/png");
      try {
        await new Promise((res, rej) => {
          const tx = db.transaction(
            ["purses", "holdings", "shops", "stock", "ledger", "meta"],
            "readwrite",
          );
          for (const s of ["purses", "holdings", "shops", "stock", "ledger"])
            tx.objectStore(s).clear();
          tx.objectStore("purses").put({
            id: "hero",
            name: "Tile Hero",
            kind: "character",
            coins: { cp: 10000, sp: 0, ep: 0, gp: 0, pp: 0 },
          });
          tx.objectStore("meta").put({
            id: "journal",
            value: {
              sessions: [],
              events: [],
              requests: [],
              market: {
                currentLocationId: "city",
                locations: [
                  { id: "region", name: "Region", kind: "region", parentId: null, description: "" },
                  { id: "city", name: "City", kind: "city", parentId: "region", description: "" },
                ],
              },
              world: {
                maps: [
                  {
                    id: "city-map",
                    name: "Old city map",
                    locationId: "city",
                    image,
                    visible: true,
                    anchors: [],
                    markers: [],
                  },
                  {
                    id: "keep",
                    name: "Keep map",
                    type: "dungeon",
                    locationId: null,
                    image,
                    visible: true,
                    anchors: [],
                    markers: [],
                  },
                ],
              },
            },
          });
          tx.objectStore("meta").put({ id: "localEncounters", rows: [encounter] });
          for (const id of ["listings", "loans", "sheets", "handouts"])
            tx.objectStore("meta").put({ id, [id]: [] });
          tx.oncomplete = res;
          tx.onerror = () => rej(tx.error);
        });
      } finally {
        db.close();
      }
    }, encounter);
    await reloadApplication(page);
    await selectMapType(page, "city");
    await expect(page.getByRole("img", { name: "Old city map", exact: true })).toBeVisible();
    await selectMapType(page, "dungeon");
    await expect(page.getByRole("img", { name: "Keep map", exact: true })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Interactive campaign map", exact: true }),
    ).toHaveCount(1);
    await openMapSettings(page);
    await page.getByRole("button", { name: "Edit map & anchors", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Map editor", exact: true });
    await chooseOption(editor.getByLabel("Map category", { exact: true }), "property");
    await editor.getByRole("button", { name: "Combat grid settings", exact: true }).click();
    await editor.getByRole("checkbox", { name: "Enable tile grid", exact: true }).check();
    await editor.getByLabel("Grid columns", { exact: true }).fill("10");
    await editor.getByLabel("Grid rows", { exact: true }).fill("10");
    await expect(editor.getByLabel("Feet per tile", { exact: true })).toHaveValue("5");
    await editor.getByRole("button", { name: "Save map", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await selectMapType(page, "property");
    await expect(page.getByRole("img", { name: "Keep map", exact: true })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Interactive campaign map", exact: true }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Place party on map", exact: true }).click();
    const viewport = page.getByRole("region", { name: "Interactive campaign map", exact: true }),
      box = await viewport.boundingBox();
    await viewport.click({ position: { x: box.width / 2, y: box.height / 2 } });
    const travel = await tileForm(page, "Save party travel position");
    await chooseOption(travel.getByLabel("Travel environment", { exact: true }), "Wilderness");
    await chooseOption(travel.getByLabel("Wilderness biome", { exact: true }), "Forest");
    await travel.getByLabel("Travel description", { exact: true }).fill("Road to the keep");
    await travel.getByRole("button", { name: "Save party travel position", exact: true }).click();
    await expect
      .poll(async () => (await journal(page)).world.partyPosition?.environment)
      .toBe("Wilderness");
    await expect(page.locator("#map-settings")).toContainText("Forest");
    // The online workspace starts with its token/grid layer visible; the legacy toggle remains.
    const enterTiles = page.getByRole("button", { name: "Enter tile mode", exact: true });
    if (await enterTiles.count()) await enterTiles.click();
    await expect(page.locator(".map-tile-grid")).toBeVisible();
    const controls = page.getByRole("region", { name: "Combat tile controls", exact: true });
    await chooseOption(
      controls.getByLabel("Character / ship link", { exact: true }),
      "character:hero",
    );
    await controls.getByLabel("Token column", { exact: true }).fill("2");
    await controls.getByLabel("Token row", { exact: true }).fill("3");
    await controls.getByRole("button", { name: "Add combat token", exact: true }).click();
    await expect
      .poll(
        async () => (await journal(page)).world.maps.find((m) => m.id === "keep").tokens?.length,
      )
      .toBe(1);
    const token = (await journal(page)).world.maps.find((m) => m.id === "keep").tokens[0];
    await chooseOption(controls.getByLabel("Combat token", { exact: true }), token.id);
    await controls.getByLabel("Token column", { exact: true }).fill("5");
    await expect(controls.getByRole("status").first()).toContainText("15 ft");
    await controls.getByRole("button", { name: "Save token move", exact: true }).click();
    await expect
      .poll(
        async () => (await journal(page)).world.maps.find((m) => m.id === "keep").tokens[0].column,
      )
      .toBe(4);
    await controls.getByRole("button", { name: "Use encounter roster", exact: true }).click();
    await controls.getByRole("button", { name: "Load campaign encounters", exact: true }).click();
    await chooseOption(controls.getByLabel("Map encounter", { exact: true }), encounter.id);
    await controls.getByRole("button", { name: "Place encounter roster", exact: true }).click();
    await expect
      .poll(async () => (await journal(page)).world.maps.find((m) => m.id === "keep").tokens.length)
      .toBe(2);
    await expect(controls).toContainText("Keep ambush");
    await closeMapSettings(page);
    const heroIcon = page.getByTitle("Combatant: Tile Hero", { exact: true }),
      guardIcon = page.getByTitle("Combatant: Hidden guard", { exact: true });
    await expect(heroIcon).toHaveAttribute("aria-pressed", "true");
    const selectedColor = await heroIcon.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Pan the corner token below the floating navigation, without moving any token.
    await viewport.focus();
    await viewport.press("Alt+ArrowUp");
    await viewport.press("Alt+ArrowUp");
    await guardIcon.click();
    await expect(guardIcon).toHaveAttribute("aria-pressed", "true");
    await expect(heroIcon).toHaveAttribute("aria-pressed", "false");
    assert.notEqual(
      await heroIcon.evaluate((el) => getComputedStyle(el).backgroundColor),
      selectedColor,
    );
    await openMapSettings(page);
    await chooseOption(controls.getByLabel("Combat token", { exact: true }), token.id);
    await closeMapSettings(page);
    await expect(heroIcon).toHaveAttribute("aria-pressed", "true");
    await expect(guardIcon).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('.map-record-icon[aria-pressed="true"]')).toHaveCount(1);
    await closeMapSettings(page);
    await checkFullscreenMap(page, output, width);
    await openMapSettings(page);
    await expect(page.getByRole("button", { name: "Save token move", exact: true })).toBeVisible();
    await fits(page);
    await page.screenshot({ path: `${output}/dm-tiles-${width}.png`, fullPage: true });
    await closeMapSettings(page);
    await reloadApplication(page);
    await selectMapType(page, "property");
    if (await enterTiles.count()) await enterTiles.click();
    await expect(page.getByTitle("Combatant: Tile Hero", { exact: true })).toBeVisible();
    await expect(heroIcon).toHaveAttribute("aria-pressed", "false");
    await closeMapSettings(page);
    await heroIcon.click();
    await expect(heroIcon).toHaveAttribute("aria-pressed", "true");
    await openMapSettings(page);
    await chooseOption(controls.getByLabel("Combat token", { exact: true }), "");
    await closeMapSettings(page);
    await expect(heroIcon).toHaveAttribute("aria-pressed", "false");
    await fits(page);
    const viewer = await checkPlayerDisplay(page, context, width, output);
    await createAndSaveRoom(page, origin, (p, o, path) => navigateApplication(p, o + path));
    await navigateApplication(page, origin + "/share");
    await expect(
      page
        .getByRole("group", { name: "Session mode", exact: true })
        .getByRole("button", { name: "Live", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() =>
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data) => {
          window.tileInvite = data.url;
        },
      }),
    );
    await page.getByRole("button", { name: "Share join link", exact: true }).click();
    const invite = await page.evaluate(() => window.tileInvite);
    const guestContext = await browser.newContext({
      viewport: { width, height: 950 },
      serviceWorkers: "block",
      extraHTTPHeaders: {
        "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`,
      },
    });
    await guestContext.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (r) => r.abort(),
    );
    const guest = await guestContext.newPage();
    current = guest;
    guest.guestAccessAudit = true;
    guest.on("pageerror", (e) => errors.push(e.message));
    await openApplication(guest, invite);
    await guest.getByRole("button", { name: "Find characters", exact: true }).click();
    await guest.getByLabel("Choose your character", { exact: true }).selectOption("hero");
    await guest.getByPlaceholder("What should the party call you?").fill("Tile guest");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(guest.locator(".room-code")).toBeVisible();
    await guest.waitForURL((u) => u.pathname === "/share" && !u.searchParams.has("join"));
    await navigateApplication(guest, origin + "/maps");
    await selectMapType(guest, "property");
    const guestEnterTiles = guest.getByRole("button", { name: "Enter tile mode", exact: true });
    if (await guestEnterTiles.count()) await guestEnterTiles.click();
    await expect(guest.getByTitle("Combatant: Tile Hero", { exact: true })).toBeVisible();
    await expect(
      guest.getByRole("region", { name: "Combat tile controls", exact: true }),
    ).toHaveCount(0);
    await expect(
      guest.getByRole("button", { name: "Place party on map", exact: true }),
    ).toHaveCount(0);
    await expect(guest.locator(".campaign-maps")).not.toContainText("Hidden guard");
    await closeMapSettings(guest);
    const sharedIcon = guest.getByTitle("Combatant: Tile Hero", { exact: true });
    await sharedIcon.click();
    await expect(sharedIcon).toHaveAttribute("aria-pressed", "true");
    await expect(guest.getByRole("complementary", { name: "Map inspector" })).toContainText(
      "Tile Hero",
    );
    await guest.getByRole("button", { name: "Close inspector", exact: true }).click();
    await expect(sharedIcon).toHaveAttribute("aria-pressed", "false");
    await fits(guest);
    await guest.screenshot({ path: `${output}/player-tiles-${width}.png`, fullPage: true });
    assert.equal(
      await guest.evaluate(() =>
        Object.keys(localStorage).some((k) => k.startsWith("quire.cloud.v2.")),
      ),
      false,
      "Guest board stays in memory",
    );
    await checkOnlineTabletop(page, guest, origin, width, output, journal);
    await expect(viewer.getByRole("img")).toHaveCount(0);
    await page.close();
    await expect(
      viewer.getByRole("heading", { name: "Waiting for the DM", exact: true }),
    ).toBeVisible({ timeout: 8000 });
    await viewer.close();
    await guestContext.close();
    await context.close();
  }
  await checkConnectedMaps({ browser, origin, output });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      widths: [1280, 390],
      durationMs: Date.now() - started,
      flows: [
        "connected-navigation-services-placement-encounter-return",
        "legacy-filter",
        "property-grid",
        "free-party-biome",
        "token-distance-move",
        "encounter-roster",
        "fullscreen",
        "reload",
        "shared-player-privacy",
        "player-display-privacy-calibration-fullscreen-reload-blank-campaign-switch",
        "guest-memory",
        "online-assigned-coordinate-keyboard-drag",
        "online-measurement-area-template",
        "explicit-activation-camera",
        "pixel-fog-reveal-conceal-undo-redo-reconnect",
      ],
      errors,
    }),
  );
} catch (e) {
  if (current)
    await current.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify({ error: e.message, stack: e.stack }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
