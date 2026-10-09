import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { tradeFixture } from "../src/lib/quire/test-fixtures/trade-economy.ts";
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
  "Economic fixtures require a disposable server",
);
const output = "test-results/trade-economy",
  started = Date.now(),
  errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
let current;
async function read(page) {
  return page.evaluate(async () => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((c) => c.id === active)
          ?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction("meta").objectStore("meta").get("journal");
        r.onsuccess = () => resolve(r.result.value);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
async function fits(page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Exchange controls fit the viewport",
  );
  assert.equal(await page.locator("[data-title-screen]").count(), 0);
}
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      hasTouch: width === 390,
      serviceWorkers: "block",
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
    await openApplication(page, origin + "/features/economy");
    await page.getByRole("heading", { name: "Trade Exchanges", exact: true }).waitFor();
    await page.evaluate(async (table) => {
      const active = localStorage.getItem("quire.campaign.v1"),
        name =
          JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find(
            (c) => c.id === active,
          )?.db || "quire";
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(
            ["purses", "holdings", "shops", "stock", "ledger", "meta"],
            "readwrite",
          );
          for (const store of ["purses", "holdings", "shops", "stock", "ledger"]) {
            tx.objectStore(store).clear();
            for (const row of table[store]) tx.objectStore(store).put(row);
          }
          tx.objectStore("meta").put({ id: "journal", value: table.journal });
          tx.objectStore("meta").put({ id: "settings", ...table.realm });
          tx.objectStore("meta").put({ id: "listings", listings: [] });
          tx.objectStore("meta").put({ id: "loans", loans: [] });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, tradeFixture());
    await reloadApplication(page);
    const exchange = page.getByRole("region", { name: "Harbor Exchange" });
    await expect(
      exchange.getByRole("heading", { name: "Harbor Exchange", exact: true }),
    ).toBeVisible();
    await exchange.getByLabel("Trading account", { exact: true }).selectOption("a");
    await exchange.getByLabel("Purchase destination", { exact: true }).selectOption("warehouse");
    await exchange.getByLabel("Trade quantity", { exact: true }).fill("10");
    await exchange.getByRole("button", { name: "Buy commodity", exact: true }).click();
    await expect.poll(async () => (await read(page)).tradeEconomy.receipts.length).toBe(1);
    assert.equal((await read(page)).tradeEconomy.exchanges[0].offers[0].askCopper, 100);
    await exchange.getByLabel("Trade direction", { exact: true }).selectOption("sell");
    const lotId = await exchange
      .getByLabel("Commodity lot", { exact: true })
      .locator("option")
      .nth(1)
      .getAttribute("value");
    await exchange.getByLabel("Commodity lot", { exact: true }).selectOption(lotId);
    await exchange.getByLabel("Trade quantity", { exact: true }).fill("2");
    await exchange.getByRole("button", { name: "Sell commodity", exact: true }).click();
    await expect.poll(async () => (await read(page)).tradeEconomy.receipts.length).toBe(2);
    await fits(page);
    await page.screenshot({ path: `${output}/exchange-${width}.png`, fullPage: true });
    // Existing drafts are deliberately retained, so clear the quantity before navigation.
    await exchange.getByLabel("Trade quantity", { exact: true }).fill("1");
    await exchange.getByLabel("Commodity lot", { exact: true }).selectOption("");
    await exchange.getByLabel("Trade direction", { exact: true }).selectOption("buy");
    await exchange.getByLabel("Purchase destination", { exact: true }).selectOption("");
    await navigateApplication(page, origin + "/features/downtime");
    await page.getByText("Set downtime & review calculations", { exact: true }).click();
    await page
      .getByLabel("Downtime description", { exact: true })
      .fill("Session-end economic settlement");
    await page.getByLabel("In-game days", { exact: true }).fill("7");
    await page
      .getByRole("checkbox", {
        name: "Settle one new market season with this downtime",
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "Preview downtime", exact: true }).click();
    await expect(page.getByRole("region", { name: "Seasonal settlement preview" })).toBeVisible();
    const before = await read(page),
      draws = before.tradeEconomy.draws;
    await page.getByRole("button", { name: "Recalculate downtime", exact: true }).click();
    await expect.poll(async () => (await read(page)).finance.downtime.length).toBe(2);
    assert.deepEqual((await read(page)).tradeEconomy.draws, draws);
    await fits(page);
    await page.screenshot({ path: `${output}/downtime-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Approve downtime now", exact: true }).click();
    await expect.poll(async () => (await read(page)).tradeEconomy.epoch).toBe(1);
    assert.equal((await read(page)).finance.day, 7);
    await navigateApplication(page, origin + "/features/economy");
    await page.getByText("Manual season control & DM overrides", { exact: true }).click();
    await page.getByLabel("Next season", { exact: true }).selectOption("0");
    await page.getByRole("button", { name: "Prepare manual season", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Approve manual season", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve manual season", exact: true }).click();
    await expect.poll(async () => (await read(page)).tradeEconomy.epoch).toBe(2);
    assert.equal((await read(page)).finance.day, 7);
    // Exercise real account room persistence and authoritative planning, never a auth bypass.
    await createAndSaveRoom(page, origin, (p, o, path) => navigateApplication(p, o + path));
    await navigateApplication(page, origin + "/share");
    const live = page
      .getByRole("group", { name: "Session mode", exact: true })
      .getByRole("button", { name: "Live", exact: true });
    await expect(live).toHaveAttribute("aria-pressed", "true");
    await navigateApplication(page, origin + "/features/economy");
    // Mobile may open a fresh document when no visible link reaches this screen.
    // Await authoritative room hydration before opening controls: changing room
    // identity deliberately resets the feature screen's drafts.
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Live · Room online · Play active · Saved to room" }),
    ).toBeVisible();
    await page.getByText("Manual season control & DM overrides", { exact: true }).click();
    await page.getByRole("button", { name: "Prepare manual season", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Approve manual season", exact: true }),
    ).toBeVisible();
    const shared = await read(page);
    assert.ok(shared.tradeEconomy.draws.some((d) => d.epoch === 3 && d.source === "server"));
    await page.getByRole("button", { name: "Approve manual season", exact: true }).click();
    await expect.poll(async () => (await read(page)).tradeEconomy.epoch).toBe(3);
    await reloadApplication(page);
    await expect(page.getByRole("heading", { name: "Trade Exchanges", exact: true })).toBeVisible();
    assert.equal((await read(page)).tradeEconomy.epoch, 3);
    await fits(page);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/summary.json`,
    JSON.stringify(
      {
        elapsedMs: Date.now() - started,
        widths: [1440, 390],
        canonicalTrades: true,
        stableRolls: true,
        downtimeApproval: true,
        manualOverride: true,
        sharedPersistence: true,
        runtimeErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(`Trade economy desktop/mobile audit passed (${Date.now() - started} ms).`);
} catch (error) {
  if (current) {
    console.error((await current.locator("body").innerText()).slice(-10000));
    await current.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
