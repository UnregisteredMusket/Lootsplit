import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { smithFixture } from "../src/lib/quire/test-fixtures/blacksmith.ts";
import { blankSheet } from "../src/lib/characters/model.mjs";
import {
  openApplication,
  reloadApplication,
  navigateApplication,
} from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";
import { createAndSaveRoom } from "./browser/account-fixtures.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(
  origin,
  /^http:\/\/(127\.0\.0\.1|localhost):\d+$/,
  "Training fixtures require a disposable server",
);
const output = "test-results/downtime",
  started = Date.now(),
  errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
let currentPage;
const formFor = (page, label) =>
  page.locator("form").filter({ has: page.getByRole("button", { name: label, exact: true }) });
async function journal(page) {
  return page.evaluate(async () => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((r) => r.id === active)
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
async function submit(form, label, check) {
  await form.getByRole("button", { name: label, exact: true }).click();
  await Promise.race([
    check(),
    form
      .getByRole("alert")
      .waitFor({ state: "visible", timeout: 20000 })
      .then(async () => {
        throw Error(await form.getByRole("alert").innerText());
      }),
  ]);
  await expect(form.getByRole("alert")).toHaveCount(0);
}
async function fits(page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Training controls fit viewport",
  );
}
async function seed(page, table) {
  await page.evaluate(async (table) => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((r) => r.id === active)
          ?.db || "quire";
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
        for (const key of ["purses", "holdings", "shops", "stock", "ledger"]) {
          tx.objectStore(key).clear();
          for (const row of table[key]) tx.objectStore(key).put(row);
        }
        for (const key of ["listings", "loans", "sheets", "handouts"])
          tx.objectStore("meta").put({ id: key, [key]: table[key] ?? [] });
        tx.objectStore("meta").put({ id: "journal", value: table.journal });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, table);
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
    currentPage = page;
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/features/downtime");
    const fixture = smithFixture();
    fixture.purses.find((p) => p.id === "hero").sheet = {
      ...blankSheet(),
      name: "Hero",
      level: 5,
      classes: "Fighter 5",
    };
    await seed(page, fixture);
    await reloadApplication(page);
    await createAndSaveRoom(page, origin, (p, o, path) => navigateApplication(p, o + path));
    await navigateApplication(page, origin + "/features/downtime");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Room online.*Play active.*Saved to room/ })
        .first(),
    ).toBeVisible();
    await page.locator("summary").filter({ hasText: "Set downtime & review calculations" }).click();
    await page.getByLabel("In-game days", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Preview downtime", exact: true }).click();
    await expect
      .poll(async () => (await journal(page)).finance.downtime.at(-1)?.status)
      .toBe("pending");
    await expect(page.locator("main")).toContainText("Hourly activity resources");
    await page.getByRole("button", { name: "Approve downtime now", exact: true }).click();
    await expect.poll(async () => (await journal(page)).downtimeActivities?.windows.length).toBe(1);
    await expect(page.locator("#hourly-downtime")).toContainText("hero: 16 hours available");
    await navigateApplication(page, origin + "/share");
    await page.evaluate(() =>
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data) => {
          window.trainingInvite = data.url;
        },
      }),
    );
    await page.getByRole("button", { name: "Share join link", exact: true }).click();
    const invite = await page.evaluate(() => window.trainingInvite);
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
    currentPage = guest;
    guest.guestAccessAudit = true;
    guest.setDefaultTimeout(20000);
    guest.on("pageerror", (e) => errors.push(e.message));
    await openApplication(guest, invite);
    await guest.getByRole("button", { name: "Find characters", exact: true }).click();
    await guest
      .locator("form")
      .filter({ has: guest.getByRole("button", { name: "Join room", exact: true }) })
      .getByRole("combobox")
      .selectOption("hero");
    await guest.getByPlaceholder("What should the party call you?").fill("Training guest");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(guest.locator(".room-code")).toBeVisible();
    await navigateApplication(guest, origin + "/?view=home");
    const marker = crypto.randomUUID();
    await guest.evaluate((value) => {
      window.trainingDocument = value;
    }, marker);
    await guest.getByRole("link", { name: "Downtime & NPC training →", exact: true }).click();
    assert.equal(await guest.evaluate(() => window.trainingDocument), marker);
    await expect(guest.locator(".loot-opening")).toHaveCount(0);
    await expect(
      guest.getByRole("button", { name: "Save downtime hour settings", exact: true }),
    ).toHaveCount(0);
    const request = formFor(guest, "Request NPC training");
    await chooseOption(request.getByLabel("NPC receiving training", { exact: true }), "maker");
    await request.getByLabel("Training subject", { exact: true }).fill("Sword drills");
    await request
      .getByLabel("Training description", { exact: true })
      .fill("Footwork, guard and maintenance aboard or at camp.");
    await submit(request, "Request NPC training", async () =>
      expect(guest.locator("#hourly-downtime")).toContainText(
        "Martial · Sword drills · 8 hours · pending",
      ),
    );
    await navigateApplication(page, origin + "/features/downtime");
    await expect.poll(async () => (await journal(page)).downtimeActivities.requests.length).toBe(1);
    const decision = formFor(page, "Record training decision");
    await decision.getByRole("button", { name: "Record training decision", exact: true }).click();
    await expect(decision.getByRole("alert")).toContainText("DM confirmation");
    await decision
      .getByLabel("Training review note", { exact: true })
      .fill(
        "Sheetless NPC confirmed level 3, below trainer level 5; time and local conditions verified.",
      );
    await submit(decision, "Record training decision", async () =>
      expect
        .poll(async () => (await journal(page)).downtimeActivities.requests[0].status)
        .toBe("approved"),
    );
    await expect(guest.locator("#hourly-downtime")).toContainText(
      "Since reset: 8 hours · 1 training days",
    );
    await expect(
      guest.getByRole("button", { name: "Reset training counter", exact: true }),
    ).toHaveCount(0);
    await fits(guest);
    await guest.screenshot({ path: `${output}/player-training-${width}.png`, fullPage: true });
    await page.locator("summary").filter({ hasText: "DM milestone & reset" }).click();
    const reset = formFor(page, "Reset training counter");
    await reset
      .getByLabel("Manual milestone / reward note", { exact: true })
      .fill("DM manually applies the agreed martial milestone.");
    await submit(reset, "Reset training counter", async () =>
      expect.poll(async () => (await journal(page)).downtimeActivities.resets.length).toBe(1),
    );
    await expect(guest.locator("#hourly-downtime")).toContainText(
      "Since reset: 0 hours · 0 training days",
    );
    await expect(guest.locator("#hourly-downtime")).toContainText(
      "Lifetime: 8 hours · 1 training days",
    );
    await expect(guest.locator("#hourly-downtime")).toContainText("hero: 8 hours available");
    await fits(page);
    await page.screenshot({ path: `${output}/dm-reset-${width}.png`, fullPage: true });
    await reloadApplication(guest);
    await expect(guest.locator("#hourly-downtime")).toContainText(
      "Lifetime: 8 hours · 1 training days",
    );
    assert.equal(
      await guest.evaluate(() =>
        Object.keys(localStorage).some((k) => k.startsWith("quire.cloud.v2.")),
      ),
      false,
      "Guest training stays in memory",
    );
    await guestContext.close();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      widths: [1280, 390],
      durationMs: Date.now() - started,
      errors,
      flows: [
        "hourly-preview-approval",
        "guest-home-link-no-title-replay",
        "private-resource-projection",
        "player-training-description",
        "sheetless-dm-review",
        "category-time-counter",
        "manual-milestone-reset",
        "lifetime-preservation",
        "guest-reconnect-memory",
      ],
    }),
  );
} catch (e) {
  if (currentPage)
    await currentPage.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/failure.txt`, String(e.stack || e));
  throw e;
} finally {
  await browser.close();
}
