import { auditCharacterPlacement } from "./character-placement-browser.mjs";
import { chooseOption } from "./search-select-browser.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  openApplication,
  reloadApplication,
  navigateApplication,
} from "./title-screen-navigation.mjs";
import { createAndSaveRoom } from "./browser/account-fixtures.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(
  origin,
  /^http:\/\/(127\.0\.0\.1|localhost):/,
  "World fixtures require a disposable server",
);
const output = "test-results/world-features";
await mkdir(output, { recursive: true });
const started = Date.now(),
  errors = [],
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ["--no-sandbox"],
  });
let current;
async function holdMapDecode(page) {
  // Hold actual image decoding so edits made during import/OCR are deterministic.
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    let release;
    const ready = new Promise((resolve) => (release = resolve));
    window.mapDecodeGate = { started: false, release: () => release() };
    window.createImageBitmap = async (...args) => {
      window.createImageBitmap = original;
      window.mapDecodeGate.started = true;
      await ready;
      return original(...args);
    };
  });
}
async function dbRead(page, store) {
  return page.evaluate(async (store) => {
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
        const r =
          store === "journal"
            ? db.transaction("meta").objectStore("meta").get("journal")
            : db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => res(store === "journal" ? r.result.value : r.result);
        r.onerror = () => rej(r.error);
      });
    } finally {
      db.close();
    }
  }, store);
}
async function fits(page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "World controls fit the viewport",
  );
  assert.equal(await page.locator("[data-title-screen]").count(), 0);
}
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      hasTouch: true,
      serviceWorkers: "block",
      extraHTTPHeaders: {
        "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`,
      },
    });
    await context.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (route) => route.abort(),
    );
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    current = page;
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/maps");
    await page.evaluate(async () => {
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
      try {
        await new Promise((res, rej) => {
          const tx = db.transaction(
            ["purses", "holdings", "shops", "stock", "ledger", "meta"],
            "readwrite",
          );
          for (const s of ["purses", "holdings", "shops", "stock", "ledger"])
            tx.objectStore(s).clear();
          for (const [id, label] of [
            ["hero", "Alwen"],
            ["other", "Bea"],
          ])
            tx.objectStore("purses").put({
              id,
              name: label,
              kind: "character",
              coins: { cp: 100000, sp: 0, ep: 0, gp: 0, pp: 0 },
            });
          tx.objectStore("holdings").put({
            id: "sword",
            purseId: "hero",
            name: "Iron sword",
            kind: "item",
            quantity: 2,
            unitCopper: 500,
            notes: "Barter fixture",
          });
          tx.objectStore("holdings").put({
            id: "home",
            purseId: "hero",
            name: "Dock house",
            kind: "property",
            quantity: 1,
            unitCopper: 1000,
            notes: "Map fixture",
            locationId: "city",
          });
          tx.objectStore("shops").put({
            id: "vendor",
            name: "Moonlit broker",
            keeper: "Clerk",
            place: "Port",
            locationId: "city",
            notes: "",
            sellRate: 1,
            buyRate: 0.5,
            wealth: "modest",
            category: "curios",
            priceScale: 1,
            blackMarket: true,
            blackMarketPremium: 2,
          });
          tx.objectStore("stock").put({
            id: "rare",
            shopId: "vendor",
            name: "Rare dust",
            quantity: 2,
            copper: 1000,
            baseCopper: 1000,
            rarity: "rare",
            notes: "",
          });
          tx.objectStore("meta").put({ id: "listings", listings: [] });
          tx.objectStore("meta").put({
            id: "journal",
            value: {
              sessions: [{ id: "session", name: "Dockside", startedAt: 1 }],
              requests: [],
              events: [],
              finance: { day: 0, loans: [], rules: [], downtime: [] },
              market: {
                currentLocationId: "area",
                locations: [
                  {
                    id: "region",
                    name: "Eastmarch",
                    kind: "region",
                    parentId: null,
                    description: "",
                  },
                  { id: "city", name: "Port", kind: "city", parentId: "region", description: "" },
                  { id: "area", name: "Docks", kind: "area", parentId: "city", description: "" },
                ],
              },
            },
          });
          tx.oncomplete = res;
          tx.onerror = () => rej(tx.error);
        });
      } finally {
        db.close();
      }
    });
    await reloadApplication(page);
    await page.getByRole("button", { name: "Import map", exact: true }).click();
    await page.getByLabel("Map name", { exact: true }).fill("Retained draft");
    await page.getByRole("button", { name: "Save map", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Choose a map image before saving");
    await expect(page.getByLabel("Map name", { exact: true })).toHaveValue("Retained draft");
    await page.getByLabel("Map name", { exact: true }).fill("");
    await holdMapDecode(page);
    const image = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1000;
      c.height = 650;
      const x = c.getContext("2d");
      x.fillStyle = "#e8d7a6";
      x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = "#000";
      x.font = "bold 48px Arial";
      x.fillText("Port", 250, 200);
      x.fillText("Docks", 700, 450);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page.getByLabel("Map image", { exact: true }).setInputFiles({
      name: "port.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
    await page.waitForFunction(() => window.mapDecodeGate.started);
    await expect(page.getByRole("button", { name: "Save map", exact: true })).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: "Preparing map image" })).toBeVisible();
    await page.getByLabel("Map name", { exact: true }).fill("Port atlas");
    await chooseOption(page.getByLabel("Map location", { exact: true }), "city");
    await page.getByLabel("Share this map image with players", { exact: true }).uncheck();
    await page.evaluate(() => window.mapDecodeGate.release());
    await page.getByAltText("Imported map preview").waitFor();
    await expect(page.getByLabel("Map name", { exact: true })).toHaveValue("Port atlas");
    await expect(page.getByLabel("Map location", { exact: true })).toHaveAttribute(
      "data-value",
      "city",
    );
    await expect(
      page.getByLabel("Share this map image with players", { exact: true }),
    ).not.toBeChecked();
    if (width === 1280) {
      await holdMapDecode(page);
      await page.getByRole("button", { name: "Read location labels", exact: true }).click();
      await page.waitForFunction(() => window.mapDecodeGate.started);
      await expect(page.getByRole("button", { name: "Save map", exact: true })).toBeDisabled();
      await page.getByLabel("Map name", { exact: true }).fill("Port atlas reviewed");
      await chooseOption(page.getByLabel("Map location", { exact: true }), "area");
      await page.getByLabel("Share this map image with players", { exact: true }).check();
      await page.evaluate(() => window.mapDecodeGate.release());
      await expect(
        page.getByRole("status").filter({ hasText: "unique location labels matched" }),
      ).toBeVisible({ timeout: 110000 });
      assert.match(
        await page
          .getByRole("status")
          .filter({ hasText: "unique location labels matched" })
          .innerText(),
        /2 unique/,
      );
      await expect(page.getByLabel("Map name", { exact: true })).toHaveValue("Port atlas reviewed");
      await expect(page.getByLabel("Map location", { exact: true })).toHaveAttribute(
        "data-value",
        "area",
      );
      await expect(
        page.getByLabel("Share this map image with players", { exact: true }),
      ).toBeChecked();
    }
    await page.getByLabel("Map name", { exact: true }).fill("Port atlas");
    await chooseOption(page.getByLabel("Map location", { exact: true }), "city");
    await page.getByLabel("Share this map image with players", { exact: true }).check();
    await page.getByRole("button", { name: "Save map", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Import a map", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Interactive campaign map" })).toBeVisible();
    await reloadApplication(page);
    await expect(page.getByRole("region", { name: "Interactive campaign map" })).toBeVisible();
    const savedMap = (await dbRead(page, "journal")).world.maps[0];
    assert.equal(savedMap.name, "Port atlas");
    assert.equal(savedMap.locationId, "city");
    assert.equal(savedMap.visible, true);
    assert.match(savedMap.image, /^data:image\/webp;base64,/);
    await page.getByRole("button", { name: "Edit map & anchors", exact: true }).click();
    await page.getByRole("button", { name: "Fullscreen editor", exact: true }).click();
    await expect(page.locator(".map-editor-frame")).toHaveClass(/map-fullscreen/);
    await page.getByLabel("Map name", { exact: true }).fill("Port atlas revised");
    await page.screenshot({ path: `${output}/fullscreen-editor-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(page.locator(".map-editor-frame")).not.toHaveClass(/map-fullscreen/);
    await expect(page.getByLabel("Map name", { exact: true })).toHaveValue("Port atlas revised");
    await page.getByRole("button", { name: "Save map", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit map", exact: true })).toHaveCount(0);
    await reloadApplication(page);
    const revisedMap = (await dbRead(page, "journal")).world.maps[0];
    assert.equal(revisedMap.id, savedMap.id);
    assert.equal(revisedMap.name, "Port atlas revised");
    assert.equal(revisedMap.image, savedMap.image);
    assert.deepEqual(revisedMap.anchors, savedMap.anchors);
    await expect(page.getByRole("region", { name: "Interactive campaign map" })).toBeVisible();
    if (width === 390) {
      await page.getByRole("button", { name: "Link location", exact: true }).click();
      const r = await page.getByRole("region", { name: "Interactive campaign map" }).boundingBox();
      await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
      await chooseOption(page.getByLabel("Linked location", { exact: true }), "city");
      await page.getByRole("button", { name: "Save location anchor", exact: true }).click();
    }
    await page.getByRole("button", { name: "Fit map", exact: true }).click();
    await page.getByRole("button", { name: "Place marker", exact: true }).click();
    const region = page.getByRole("region", { name: "Interactive campaign map" });
    await region.scrollIntoViewIfNeeded();
    let r = await region.boundingBox();
    await page.mouse.click(r.x + r.width * 0.6, r.y + r.height * 0.5);
    await page.getByLabel("Marker name", { exact: true }).fill("Rendezvous");
    await page.getByLabel("Details", { exact: true }).fill("Meet at the quay");
    await page.getByRole("button", { name: "Save live marker", exact: true }).click();
    const marker = page.getByRole("button", { name: "Marker: 1 record", exact: true });
    await expect(marker).toBeVisible();
    await marker.click();
    await expect(page.getByRole("region", { name: "Map record details" })).toContainText(
      "Rendezvous",
    );
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("Marker", { exact: true }).uncheck();
    await expect(marker).toHaveCount(0);
    await page.getByLabel("Marker", { exact: true }).check();
    await page.getByRole("button", { name: "Hide all", exact: true }).click();
    await expect(page.locator(".map-record-icon")).toHaveCount(0);
    await page.getByRole("button", { name: "Show all", exact: true }).click();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("button", { name: "Fullscreen map", exact: true }).click();
    await expect(page.locator(".map-view-frame")).toHaveClass(/map-fullscreen/);
    const full = await page.locator(".map-view-frame").boundingBox();
    assert.ok(full.height >= 949 && full.width >= width - 1);
    await chooseOption(page.getByLabel("Ping color", { exact: true }), "red");
    await page.getByRole("button", { name: "Ping", exact: true }).click();
    await region.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("img", { name: "red map ping", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "red map ping", exact: true })).toHaveCount(0, {
      timeout: 7000,
    });
    await page.getByRole("button", { name: "Ping", exact: true }).click();
    await page.screenshot({ path: `${output}/fullscreen-map-${width}.png` });
    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    await region.hover();
    await page.mouse.wheel(0, -250);
    await expect(page.locator(".world-toolbar [aria-live=polite]")).not.toHaveText("100%");
    await page.getByRole("button", { name: "Fit map", exact: true }).click();
    await expect(page.locator(".world-toolbar [aria-live=polite]")).toHaveText("100%");
    await region.scrollIntoViewIfNeeded();
    r = await region.boundingBox();
    const layer = page.locator(".map-layer"),
      before = await layer.getAttribute("style");
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + 50, r.y + r.height / 2 + 30, { steps: 4 });
    await page.mouse.up();
    assert.notEqual(await layer.getAttribute("style"), before);
    // Two-touch pinch uses native pointer events in Chromium, with touch-action:none.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: r.x + r.width * 0.35, y: r.y + r.height * 0.5 },
        { x: r.x + r.width * 0.65, y: r.y + r.height * 0.5 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: r.x + r.width * 0.25, y: r.y + r.height * 0.5 },
        { x: r.x + r.width * 0.75, y: r.y + r.height * 0.5 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator(".world-toolbar [aria-live=polite]")).not.toHaveText("100%");
    await page.getByRole("button", { name: "Fit map", exact: true }).click();
    await fits(page);
    await page.screenshot({ path: `${output}/maps-${width}.png`, fullPage: true });
    await page
      .getByRole("link", { name: "People & NPCs", exact: false })
      .filter({ visible: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Create non-party NPC", exact: true }).click();
    await page.getByLabel("NPC name", { exact: true }).fill("Mara");
    await page.getByLabel("Description", { exact: true }).fill("Dock broker");
    await chooseOption(page.getByLabel("NPC location", { exact: true }), "city");
    await page.getByLabel("Bartering allowed", { exact: true }).check();
    await page.getByLabel("Starting funds (copper)", { exact: true }).fill("5000");
    await page.getByRole("button", { name: "Create NPC", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Mara", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View & interact", exact: true }).click();
    await page.getByText("Configure NPC inventory & funds", { exact: true }).click();
    await page.getByLabel("Item name", { exact: true }).fill("Trade gem");
    await page.getByLabel("Quantity", { exact: true }).fill("2");
    await page.getByLabel("Value per item (copper)", { exact: true }).fill("1000");
    await page.getByRole("button", { name: "Add NPC inventory lot", exact: true }).click();
    await expect(page.getByText("2 × Trade gem", { exact: false })).toBeVisible();
    await page.getByLabel("Message", { exact: true }).fill("Welcome to Port.");
    await page.getByRole("button", { name: "Send NPC response", exact: true }).click();
    await expect(page.getByText("Welcome to Port.", { exact: false })).toBeVisible();
    await fits(page);
    await page.getByRole("link", { name: "Open Trading & Barter", exact: false }).click();
    await page.getByRole("button", { name: "New barter offer", exact: true }).click();
    await chooseOption(page.getByLabel("Your offering account", { exact: true }), "hero");
    const npc = (await dbRead(page, "journal")).world.npcs[0];
    await chooseOption(page.getByLabel("Other participant", { exact: true }), npc.id);
    await page.getByLabel("First side: Iron sword quantity", { exact: true }).fill("1");
    await page.getByLabel("Second side: Trade gem quantity", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Send barter offer", exact: true }).click();
    await page.getByRole("button", { name: "Counteroffer", exact: true }).click();
    await page.getByLabel("Second side coins (copper)", { exact: true }).fill("50");
    await page.getByRole("button", { name: "Send counteroffer", exact: true }).click();
    await page.getByRole("button", { name: "Accept barter", exact: true }).click();
    await expect(page.getByText("No pending barter offers.", { exact: true })).toBeVisible();
    const lots = await dbRead(page, "holdings");
    assert.equal(
      lots
        .filter((h) => h.name === "Trade gem" && h.purseId === "hero")
        .reduce((s, h) => s + h.quantity, 0),
      1,
    );
    assert.equal(
      lots
        .filter((h) => h.name === "Iron sword" && h.purseId === npc.id)
        .reduce((s, h) => s + h.quantity, 0),
      1,
    );
    await fits(page);
    await page
      .getByRole("link", { name: "Market", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page.getByText("Black market", { exact: true }).click();
    await page.getByRole("button", { name: "Reveal black market", exact: true }).click();
    await expect(page.getByText("Black market is available.", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: /Moonlit broker/ }).click();
    await page.getByText("Black-market vendor rules", { exact: true }).click();
    await page.getByLabel("Price premium multiplier", { exact: true }).fill("2.5");
    await page.getByRole("button", { name: "Save black-market vendor", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await dbRead(page, "shops")).find((shop) => shop.id === "vendor")?.blackMarketPremium,
      )
      .toBe(2.5);
    await fits(page);
    await page
      .getByRole("link", { name: "Market", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page
      .getByRole("link", { name: "Session Time", exact: false })
      .filter({ visible: true })
      .first()
      .click();
    await page.getByLabel("Hours to advance", { exact: true }).fill("8");
    await chooseOption(page.getByLabel("Award rest", { exact: true }), "long");
    await page.getByLabel("Alwen", { exact: true }).check();
    await page.getByLabel("Time advance note", { exact: true }).fill("Rest at the docks");
    await page.getByRole("button", { name: "Approve & advance session time", exact: true }).click();
    await expect(page.getByText("Campaign day 0 · 08:00", { exact: true })).toBeVisible();
    await page.getByLabel("Hours to advance", { exact: true }).fill("16");
    await chooseOption(page.getByLabel("Award rest", { exact: true }), "none");
    await page.getByRole("button", { name: "Approve & advance session time", exact: true }).click();
    await expect(page.getByText("Campaign day 1 · 00:00", { exact: true })).toBeVisible();
    assert.equal((await dbRead(page, "journal")).world.timeHistory.length, 2);
    await fits(page);
    await page.screenshot({ path: `${output}/time-${width}.png`, fullPage: true });
    await navigateApplication(page, origin + "/features/npcs");
    await page.getByRole("button", { name: "Create non-party NPC", exact: true }).click();
    await page.getByLabel("NPC name", { exact: true }).fill("Sera");
    await chooseOption(page.getByLabel("NPC location", { exact: true }), "city");
    await page.getByRole("button", { name: "Create NPC", exact: true }).click();
    await navigateApplication(page, origin + "/maps");
    const npcIcon = page.getByRole("button", { name: "NPC: 2 records", exact: true });
    await expect(npcIcon).toBeVisible();
    await expect(npcIcon.locator(".map-count")).toHaveText("2");
    const iconBefore = await npcIcon.boundingBox();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    const iconAfter = await npcIcon.boundingBox();
    assert.equal(
      iconBefore.width,
      iconAfter.width,
      "record icons remain screen-sized while zooming",
    );
    await page.getByRole("button", { name: "Fit map", exact: true }).click();
    await npcIcon.click();
    await expect(page.getByRole("region", { name: "Map record details" })).toContainText("Mara");
    await expect(page.getByRole("region", { name: "Map record details" })).toContainText("Sera");
    await page.evaluate(() => (window.mapRecordDocument = "same-document"));
    await page
      .getByRole("region", { name: "Map record details" })
      .getByRole("link", { name: "Mara →", exact: true })
      .click();
    const libraryEntry = page.getByRole("article", { name: "Library entry", exact: true });
    await expect(libraryEntry.getByRole("heading", { name: "Mara", exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.mapRecordDocument), "same-document");
    assert.equal(await page.locator(".loot-opening").count(), 0);
    await libraryEntry.getByRole("link", { name: "Interact with this NPC →", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Mara · interaction", exact: true }),
    ).toBeVisible();
    await navigateApplication(page, origin + "/maps");
    // Keep the existing offline gameplay audit, then verify real shared map writes.
    await createAndSaveRoom(page, origin, (p, o, path) => navigateApplication(p, o + path));
    await navigateApplication(page, origin + "/maps");
    await page.getByRole("button", { name: "Import map", exact: true }).click();
    await holdMapDecode(page);
    await page.getByLabel("Map image", { exact: true }).setInputFiles({
      name: "shared-port.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
    await page.waitForFunction(() => window.mapDecodeGate.started);
    await page.getByLabel("Map name", { exact: true }).fill("Shared Port atlas");
    await chooseOption(page.getByLabel("Map location", { exact: true }), "area");
    await page.evaluate(() => window.mapDecodeGate.release());
    await expect(page.getByLabel("Map name", { exact: true })).toHaveValue("Shared Port atlas");
    await expect(page.getByRole("button", { name: "Save map", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Save map", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Import a map", exact: true })).toHaveCount(0);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Room online.*Play active.*Saved to room/ })
        .first(),
    ).toBeVisible();
    await reloadApplication(page);
    const sharedMap = (await dbRead(page, "journal")).world.maps.find(
      (map) => map.name === "Shared Port atlas",
    );
    assert.ok(sharedMap, "Shared map survives reload from the server");
    assert.equal(sharedMap.locationId, "area");
    assert.equal(sharedMap.visible, true);
    assert.equal(sharedMap.image, savedMap.image);
    await chooseOption(page.getByLabel("Map", { exact: true }), sharedMap.id);
    await page.getByRole("button", { name: "Edit map & anchors", exact: true }).click();
    await page.getByLabel("Map name", { exact: true }).fill("Shared Port atlas revised");
    await page.getByRole("button", { name: "Save map", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit map", exact: true })).toHaveCount(0);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Room online.*Play active.*Saved to room/ })
        .first(),
    ).toBeVisible();
    await reloadApplication(page);
    const sharedRevision = (await dbRead(page, "journal")).world.maps.find(
      (map) => map.id === sharedMap.id,
    );
    assert.equal(sharedRevision.name, "Shared Port atlas revised");
    assert.equal(sharedRevision.image, sharedMap.image);
    await expect(page.getByRole("region", { name: "Interactive campaign map" })).toBeVisible();
    await fits(page);
    await page.screenshot({ path: `${output}/shared-maps-${width}.png`, fullPage: true });
    await navigateApplication(page, origin + "/share");
    await page.evaluate(() =>
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data) => {
          window.mapInvite = data.url;
        },
      }),
    );
    await page.getByRole("button", { name: "Share join link", exact: true }).click();
    const invite = await page.evaluate(() => window.mapInvite);
    const guestContext = await browser.newContext({
      viewport: { width: 390, height: 950 },
      hasTouch: true,
      serviceWorkers: "block",
      extraHTTPHeaders: {
        "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`,
      },
    });
    await guestContext.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (route) => route.abort(),
    );
    const guest = await guestContext.newPage();
    guest.guestAccessAudit = true;
    guest.on("pageerror", (e) => errors.push(e.message));
    await openApplication(guest, invite);
    await guest.getByRole("button", { name: "Find characters", exact: true }).click();
    await guest.getByPlaceholder("What should the party call you?").fill("Map guest");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(guest.locator(".room-code")).toBeVisible();
    await navigateApplication(guest, origin + "/maps");
    await chooseOption(guest.getByLabel("Map", { exact: true }), sharedMap.id);
    await navigateApplication(page, origin + "/maps");
    await chooseOption(page.getByLabel("Map", { exact: true }), sharedMap.id);
    await guest.getByRole("button", { name: "Fullscreen map", exact: true }).click();
    await guest.getByRole("button", { name: "Ping", exact: true }).click();
    await chooseOption(guest.getByLabel("Ping color", { exact: true }), "violet");
    const guestMap = guest.getByRole("region", { name: "Interactive campaign map" });
    await guestMap.scrollIntoViewIfNeeded();
    const touchBox = await guestMap.boundingBox();
    await guest.touchscreen.tap(
      touchBox.x + touchBox.width * 0.5,
      touchBox.y + touchBox.height * 0.5,
    );
    await expect(guest.getByRole("img", { name: "violet map ping", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "violet map ping", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "violet map ping", exact: true })).toHaveCount(0, {
      timeout: 7000,
    });
    await page.getByRole("button", { name: "Ping", exact: true }).click();
    await chooseOption(page.getByLabel("Ping color", { exact: true }), "green");
    await page.getByRole("region", { name: "Interactive campaign map" }).focus();
    await page.keyboard.press("Enter");
    await expect(guest.getByRole("img", { name: "green map ping", exact: true })).toBeVisible();
    await expect(guest.getByRole("img", { name: "green map ping", exact: true })).toHaveCount(0, {
      timeout: 7000,
    });
    assert.equal(
      await guest.evaluate(() =>
        Object.keys(localStorage).some((k) => k.startsWith("quire.cloud")),
      ),
      false,
      "pings never persist guest campaigns",
    );
    await guest.screenshot({ path: `${output}/guest-fullscreen-map-${width}.png` });
    await auditCharacterPlacement(page, guest, origin, npc.id, width, output);
    await guestContext.close();
    await context.close();
  }
  assert.deepEqual(errors, []);
  const finished = Date.now();
  await writeFile(
    `${output}/summary.json`,
    JSON.stringify(
      {
        status: "passed",
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - started,
        widths: [1280, 390],
        checks: [
          "image import and OCR",
          "details retained during image processing and OCR",
          "save waits for processing; missing-image draft retained",
          "saved maps and edits survive reload",
          "real shared-room saves",
          "location anchors",
          "live markers",
          "compact icons, filter hide/show and record details",
          "fullscreen map and editor preserve draft",
          "colored transient local ping and keyboard placement",
          "NPC count badge and constant icon size across zoom",
          "DM/player pings cross devices and expire outside turns",
          "wheel and pinch zoom/pan",
          "NPC inventory and dialogue",
          "barter/counter/accept",
          "vendor premiums",
          "within-session rest and midnight",
        ],
      },
      null,
      2,
    ),
  );
  console.log(`World features desktop/mobile PASS (${Date.now() - started}ms)`);
} catch (e) {
  if (current)
    await current.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw e;
} finally {
  await browser.close();
}
