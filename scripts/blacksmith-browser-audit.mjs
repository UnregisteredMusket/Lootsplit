import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { smithFixture } from "../src/lib/quire/test-fixtures/blacksmith.ts";
import { validateWorld } from "../src/lib/quire/world.ts";
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
  "Smith fixtures require a disposable server",
);
const output = "test-results/blacksmith",
  started = Date.now(),
  errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
let currentPage;
async function readJournal(page) {
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
async function submit(form, button, accepted) {
  await form.getByRole("button", { name: button, exact: true }).click();
  await Promise.race([
    accepted(),
    form
      .getByRole("alert")
      .waitFor({ state: "visible", timeout: 20000 })
      .then(async () => {
        throw Error(await form.getByRole("alert").innerText());
      }),
  ]);
  await form.getByRole("button", { name: button, exact: true }).waitFor({ state: "visible" });
  await expect(form.getByRole("alert")).toHaveCount(0);
}
const formFor = (page, label) =>
  page.locator("form").filter({ has: page.getByRole("button", { name: label, exact: true }) });
async function fits(page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Smith controls fit the viewport",
  );
}
async function advance(page, days, status) {
  await navigateApplication(page, origin + "/features/downtime");
  // The feature's room/session key changes during a cold shared-room restore.
  // Wait for the authoritative room before opening/filling its remountable form.
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Room online.*Play active.*Saved to room/ })
      .first(),
  ).toBeVisible();
  const summary = page.locator("summary").filter({ hasText: "Set downtime & review calculations" });
  if (!(await summary.locator("..").evaluate((el) => el.open))) await summary.click();
  await page.getByLabel("In-game days", { exact: true }).fill(String(days));
  await expect(page.getByLabel("In-game days", { exact: true })).toHaveValue(String(days));
  await page.getByRole("button", { name: /^(Preview|Recalculate) downtime$/ }).click();
  await expect
    .poll(async () => {
      const d = (await readJournal(page)).finance.downtime.at(-1);
      return d?.status === "pending" && d.days === days;
    })
    .toBe(true);
  await expect(page.locator("main")).toContainText("Blacksmith commissions");
  await page.getByRole("button", { name: /^(Play sessions|Session ·)/ }).click();
  await page.getByLabel("Session name", { exact: true }).fill("Approved smith work");
  await page.getByRole("checkbox", { name: /I approve the downtime plan/ }).check();
  await page.getByRole("button", { name: "Approve downtime & start session", exact: true }).click();
  await expect.poll(async () => (await readJournal(page)).blacksmith.orders[0].status).toBe(status);
  await navigateApplication(page, origin + "/shop/forge");
}
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      serviceWorkers: "block",
    });
    await context.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (route) => route.abort(),
    );
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/market");
    const fixture = smithFixture();
    fixture.journal.world.npcs[0].blacksmithServices = false;
    fixture.purses = fixture.purses.filter((p) => p.id !== "other");
    validateWorld(fixture);
    await page.evaluate(async (table) => {
      const active = localStorage.getItem("quire.campaign.v1"),
        name =
          JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find(
            (r) => r.id === active,
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
    }, fixture);
    await reloadApplication(page);
    await navigateApplication(page, origin + "/shop/forge");
    await chooseOption(page.getByLabel("Paying from", { exact: true }), "hero");
    const section = page.getByRole("region", { name: "Blacksmith services", exact: true });
    await expect(section).toContainText("The DM has not enabled");
    await section
      .getByRole("button", { name: "Configure blacksmith services", exact: true })
      .click();
    const config = formFor(page, "Save blacksmith services");
    await config.getByLabel("Blacksmith skill", { exact: true }).selectOption("legendary");
    await config.getByLabel("Magical forge", { exact: true }).check();
    await config.getByLabel("Steel rarity", { exact: true }).selectOption("rare");
    await config.getByLabel("Steel rarity multiplier", { exact: true }).fill("2");
    await config.getByLabel("New enchantment name", { exact: true }).fill("Moonlight");
    await config.getByRole("button", { name: "Add enchantment", exact: true }).click();
    await config.getByLabel("Approve Moonlight", { exact: true }).check();
    await config.getByLabel("Moonlight minimum skill", { exact: true }).selectOption("master");
    await config
      .getByLabel("Moonlight effect description", { exact: true })
      .fill("A faint silver glow; effects approved by the DM.");
    await submit(config, "Save blacksmith services", async () =>
      expect
        .poll(async () => (await readJournal(page)).blacksmith.profiles[0].skill)
        .toBe("legendary"),
    );
    const p = (await readJournal(page)).blacksmith.profiles[0];
    p.items[0].parts.push({
      key: "scabbard",
      name: "Scabbard",
      quantity: 1,
      materialKeys: ["wood"],
      options: [
        { key: "plain", name: "Plain", description: "Custom carved sheath", copper: 0, days: 0 },
      ],
    });
    await config.locator("summary").filter({ hasText: "Advanced parts" }).click();
    await config
      .getByRole("button", { name: "Edit full forge configuration", exact: true })
      .click();
    await config
      .getByLabel("Full forge configuration JSON", { exact: true })
      .fill(JSON.stringify(p));
    await submit(config, "Save blacksmith services", async () =>
      expect
        .poll(async () => (await readJournal(page)).blacksmith.profiles[0].items[0].parts.length)
        .toBe(6),
    );
    await section.getByRole("link", { name: /People & NPCs/ }).click();
    await expect(page.locator(".loot-opening")).toHaveCount(0);
    const permission = formFor(page, "Save Aster smith permission");
    await permission.getByLabel("Offers blacksmith services · Aster", { exact: true }).check();
    await submit(permission, "Save Aster smith permission", async () =>
      expect
        .poll(async () => (await readJournal(page)).world.npcs[0].blacksmithServices)
        .toBe(true),
    );
    await createAndSaveRoom(page, origin, (p, o, path) => navigateApplication(p, o + path));
    await navigateApplication(page, origin + "/share");
    await page.evaluate(() =>
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data) => {
          window.smithInvite = data.url;
        },
      }),
    );
    await page.getByRole("button", { name: "Share join link", exact: true }).click();
    const invite = await page.evaluate(() => window.smithInvite);
    const guestContext = await browser.newContext({
      viewport: { width, height: 950 },
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
    currentPage = guest;
    guest.guestAccessAudit = true;
    guest.setDefaultTimeout(20000);
    guest.on("pageerror", (e) => errors.push(e.message));
    await openApplication(guest, invite);
    await guest.getByRole("button", { name: "Find characters", exact: true }).click();
    const characterPicker = guest
      .locator("form")
      .filter({ has: guest.getByRole("button", { name: "Join room", exact: true }) })
      .getByRole("combobox");
    await characterPicker.selectOption("hero");
    await expect(characterPicker).toHaveValue("hero");
    await guest.getByPlaceholder("What should the party call you?").fill("Smith guest");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(guest.locator(".room-code")).toBeVisible();
    await navigateApplication(guest, origin + "/shop/forge");
    const gs = guest.getByRole("region", { name: "Blacksmith services", exact: true });
    await expect(
      gs.getByRole("button", { name: "Configure blacksmith services", exact: true }),
    ).toHaveCount(0);
    await gs.getByRole("button", { name: "Design a custom item", exact: true }).click();
    const design = formFor(guest, "Place paid commission");
    await chooseOption(design.getByLabel("Item design", { exact: true }), "armor");
    await expect(design.getByLabel("Plates style", { exact: true })).toBeVisible();
    await chooseOption(design.getByLabel("Item design", { exact: true }), "sword");
    await expect(design.getByLabel("Scabbard style", { exact: true })).toBeVisible();
    await design.getByLabel("Unique item name", { exact: true }).fill("Moonward");
    await design.getByLabel("Engraving", { exact: true }).fill("Until dawn");
    await chooseOption(design.getByLabel("Blade material source", { exact: true }), "steel-lot");
    await chooseOption(design.getByLabel("Enchantment", { exact: true }), p.enchantments[0].key);
    await design.getByRole("button", { name: "Review commission", exact: true }).click();
    const review = design.getByRole("region", { name: "Commission review", exact: true });
    await expect(review).toContainText("Maker: Aster");
    await expect(review).toContainText("Enchantment: Moonlight");
    await expect(review).toContainText("Scabbard: Plain in Timber");
    await fits(guest);
    await guest.screenshot({ path: `${output}/player-design-${width}.png`, fullPage: true });
    await submit(design, "Place paid commission", async () =>
      expect(gs.getByRole("heading", { name: "Moonward · active", exact: true })).toBeVisible(),
    );
    await expect.poll(async () => (await readJournal(page)).blacksmith.orders.length).toBe(1);
    await navigateApplication(page, origin + "/shop/forge");
    const saved = (await readJournal(page)).blacksmith.orders[0];
    currentPage = page;
    assert.equal(saved.progressDays, 0);
    assert.equal(saved.terms.skill, "legendary");
    const controls = formFor(page, "Record commission control");
    await controls
      .getByLabel("Reason for commission control", { exact: true })
      .fill("Pause for DM inspection");
    await submit(controls, "Record commission control", async () =>
      expect.poll(async () => (await readJournal(page)).blacksmith.orders[0].status).toBe("paused"),
    );
    await controls
      .getByLabel("Reason for commission control", { exact: true })
      .fill("DM inspection complete");
    await submit(controls, "Record commission control", async () =>
      expect.poll(async () => (await readJournal(page)).blacksmith.orders[0].status).toBe("active"),
    );
    await advance(page, 2, "active");
    await expect
      .poll(async () => (await readJournal(page)).blacksmith.orders[0].progressDays)
      .toBe(2);
    await advance(page, saved.terms.workDays - 2, "ready");
    currentPage = guest;
    await expect(
      gs.getByRole("button", { name: "Collect crafted item", exact: true }),
    ).toBeVisible();
    await gs.getByRole("button", { name: "Collect crafted item", exact: true }).click();
    await expect(
      gs.getByRole("heading", { name: "Moonward · claimed", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await readJournal(page)).blacksmith.orders[0].status)
      .toBe("claimed");
    await reloadApplication(guest);
    await expect(
      gs.getByRole("heading", { name: "Moonward · claimed", exact: true }),
    ).toBeVisible();
    await gs.locator("summary").filter({ hasText: "Commission specifications" }).click();
    await expect(gs).toContainText("Made by Aster");
    await expect(gs).toContainText(`Completed campaign day ${saved.terms.workDays}`);
    assert.equal(
      await guest.evaluate(() =>
        Object.keys(localStorage).some((k) => k.startsWith("quire.cloud.v2.")),
      ),
      false,
      "Guest smith work remains in memory",
    );
    await fits(guest);
    await guest.screenshot({ path: `${output}/player-order-${width}.png`, fullPage: true });
    await fits(page);
    await page.screenshot({ path: `${output}/dm-order-${width}.png`, fullPage: true });
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
        "dm-skill-rarity",
        "magical-forge-approved-list",
        "npc-service-gate",
        "custom-extra-part",
        "armor-and-weapon",
        "guest-inventory-contribution",
        "review-and-pay",
        "partial-approved-downtime",
        "completion-date",
        "one-time-collection",
        "reload-provenance",
        "guest-memory",
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
