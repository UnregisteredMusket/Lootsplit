// NPC services in the conversation hub (docs/SERVICES.md): the Services reply runs the same
// availability check as the order command and lists every provider the NPC runs. Real clicks and
// number keys on a disposable device campaign at 1280, 390 and 320 px.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir } from "node:fs/promises";
import { smithFixture, smithDm } from "../src/lib/quire/test-fixtures/blacksmith.ts";
import { applyCommand } from "../src/lib/quire/commands.ts";
import { defaultSmith } from "../src/lib/quire/blacksmith-schema.ts";
import { validateWorld } from "../src/lib/quire/world.ts";
import { openApplication, reloadApplication, navigateApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "Service fixtures require a disposable server");
const output = "test-results/services",
  started = Date.now(),
  errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});

async function seed(page, table) {
  await page.evaluate(async (data) => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((r) => r.id === active)?.db ||
        "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["purses", "holdings", "shops", "stock", "ledger", "meta"], "readwrite");
        for (const key of ["purses", "holdings", "shops", "stock", "ledger"]) {
          tx.objectStore(key).clear();
          for (const row of data[key]) tx.objectStore(key).put(row);
        }
        for (const key of ["listings", "loans", "sheets", "handouts"])
          tx.objectStore("meta").put({ id: key, [key]: data[key] ?? [] });
        tx.objectStore("meta").put({ id: "journal", value: data.journal });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, table);
}
async function fits(page, label) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${label}: no horizontal scroll`,
  );
}
/** Aster runs two forges: one in the city, one at the region's hall above it. */
function twoForges() {
  let t = smithFixture();
  t = {
    ...t,
    shops: [...t.shops, { ...t.shops[0], id: "hall-forge", name: "Hall Forge", locationId: "region" }],
  };
  return applyCommand(t, smithDm, {
    id: "profile-hall",
    kind: "smith-profile",
    shopId: "hall-forge",
    before: null,
    profile: defaultSmith("hall-forge", "maker"),
  });
}
const talk = (page) => page.getByRole("region", { name: "Talk to Aster", exact: true });
const reply = (page, text) => talk(page).locator(".npc-talk-reply").filter({ hasText: text });
async function open(page, fixture) {
  validateWorld(fixture);
  await seed(page, fixture);
  await reloadApplication(page);
  await navigateApplication(page, origin + "/features/npcs?npc=maker");
  await expect(talk(page)).toBeVisible();
}

try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: "block" });
    await context.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (route) => route.abort(),
    );
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/market");

    // One forge: the Services reply opens it directly.
    await open(page, smithFixture());
    const forge = reply(page, "Do you take commissions?");
    await expect(forge).toContainText("[Services · Blacksmith]");
    await expect(forge).toHaveAttribute("href", /\/shop\/forge$/);
    await fits(page, `${width} single`);
    await page.screenshot({ path: `${output}/hub-single-${width}.png`, fullPage: true });
    await forge.click();
    await expect(page).toHaveURL(/\/shop\/forge$/);

    // The DM switched the NPC's permission off: the hub runs the real check and says why,
    // instead of opening a shop page that then refuses.
    const off = smithFixture();
    off.journal.world.npcs[0].blacksmithServices = false;
    await open(page, off);
    const locked = reply(page, "Do you take commissions?");
    await expect(locked).toBeDisabled();
    await expect(locked).toContainText("The DM has not enabled this NPC's blacksmith services.");
    await fits(page, `${width} locked`);
    await page.screenshot({ path: `${output}/hub-locked-${width}.png`, fullPage: true });

    // Two forges: a sub-list with one numbered reply per provider; Never mind returns.
    await open(page, twoForges());
    const services = reply(page, "Do you offer any services?");
    await expect(services).toContainText("2 services here");
    await services.focus();
    await page.keyboard.press("3");
    await expect(reply(page, "Opens Dawn Forge's commissions.")).toBeVisible();
    await expect(reply(page, "Opens Hall Forge's commissions.")).toBeVisible();
    await fits(page, `${width} sub-list`);
    await page.screenshot({ path: `${output}/hub-list-${width}.png`, fullPage: true });
    await reply(page, "Never mind.").click();
    await expect(reply(page, "Do you offer any services?")).toBeVisible();
    await reply(page, "Do you offer any services?").click();
    await reply(page, "Opens Hall Forge's commissions.").focus();
    await page.keyboard.press("2");
    await expect(page).toHaveURL(/\/shop\/hall-forge$/);
    await context.close();
  }
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(`Services audit passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await browser.close();
}
