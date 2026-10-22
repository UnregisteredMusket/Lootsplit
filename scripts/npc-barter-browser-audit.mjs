// NPC barter conversation (docs/NPC-BARTER.md): accept, counter-offer and refusal by real
// clicks and number keys on a disposable device campaign, at desktop, phone and 320px widths.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir } from "node:fs/promises";
import { barterFixture } from "../src/lib/quire/test-fixtures/npc-barter.ts";
import { validateWorld } from "../src/lib/quire/world.ts";
import { openApplication, reloadApplication, navigateApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "NPC barter fixtures require a disposable server");
const output = "test-results/npc-barter",
  started = Date.now(),
  errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});

async function readJournal(page) {
  return page.evaluate(async () => {
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
const attempts = async (page) => (await readJournal(page)).world.npcBarter?.attempts ?? [];
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
const talk = (page) => page.getByRole("region", { name: "Talk to Odile Marsh", exact: true });
// NPC lines keep their full text for screen readers while the visible copy types out.
const said = (page, text) => talk(page).locator(".sr-only").getByText(text, { exact: true }).last();
const reply = (page, text) => talk(page).locator(".npc-talk-reply").filter({ hasText: text });
async function openConversation(page, character) {
  await navigateApplication(page, origin + "/features/npcs?npc=odile");
  await expect(talk(page)).toBeVisible();
  await talk(page).getByLabel("Speaking as").selectOption({ label: character });
  const barter = reply(page, "I'd like to make you an offer.");
  if (!(await barter.isVisible())) await reply(page, "Never mind.").click();
  // Number keys choose replies once focus is in the conversation.
  await barter.focus();
  await page.keyboard.press("1");
  await expect(talk(page).locator(".npc-talk-drawer")).toBeVisible();
}
const giveColumn = (page) => talk(page).locator(".npc-talk-drawer-col").nth(0);
const askColumn = (page) => talk(page).locator(".npc-talk-drawer-col").nth(1);

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
    const fixture = barterFixture();
    validateWorld(fixture);
    await seed(page, fixture);
    await reloadApplication(page);

    // Refuse first (no earlier trade to combine with): unwanted goods count for nothing, no roll,
    // and then the same offer is locked.
    await openConversation(page, "Bram Stoneward");
    await giveColumn(page).getByRole("button", { name: /^Wolf pelt/ }).click();
    await askColumn(page).getByRole("button", { name: /^Hooded lantern/ }).click();
    await expect(talk(page).locator(".npc-talk-note")).toContainText("no interest in Wolf pelt");
    await reply(page, "Take it or leave it.").click();
    await expect(said(page, "I've no use for Wolf pelt.")).toBeAttached();
    await expect.poll(async () => (await attempts(page)).at(-1)?.status).toBe("refused");
    assert.equal((await attempts(page)).at(-1).roll, undefined, "refused without a roll");
    await reply(page, "I've got something you might want").click();
    await giveColumn(page).getByRole("button", { name: /^Wolf pelt/ }).click();
    await askColumn(page).getByRole("button", { name: /^Hooded lantern/ }).click();
    const locked = reply(page, "Make the same offer again.");
    await expect(locked).toBeDisabled();
    await expect(locked).toContainText("Locked · until");
    await fits(page, `${width} refusal`);
    await page.screenshot({ path: `${output}/refused-${width}.png`, fullPage: true });

    // Accept: a generous offer needs no roll; Odile answers in her own voice.
    await openConversation(page, "Mira Ashfall");
    await expect(said(page, "A trade, then. Let's see what you have.")).toBeAttached();
    await askColumn(page).getByRole("button", { name: /^Hooded lantern/ }).click();
    await giveColumn(page).getByLabel("Coins you give (copper)").fill("600");
    const offerReply = reply(page, "Here. Take it, it's a good deal.");
    await expect(offerReply).toContainText("no roll needed");
    await expect(talk(page).locator(".npc-talk-scale").first()).toContainText("generous");
    await fits(page, `${width} offer`);
    await page.screenshot({ path: `${output}/offer-${width}.png`, fullPage: true });
    await offerReply.click();
    await expect(said(page, "Fair enough. We have a deal.")).toBeAttached();
    await expect.poll(async () => (await attempts(page)).at(-1)?.status).toBe("accepted");
    await expect(talk(page).locator(".npc-talk-receipt")).toContainText("Hooded lantern");

    // Counter: Tamsin sends a deal to the DM, the DM counters from the queue, Tamsin accepts.
    await openConversation(page, "Tamsin Reed");
    await askColumn(page).getByRole("button", { name: /^Hooded lantern/ }).click();
    await giveColumn(page).getByLabel("Coins you give (copper)").fill("400");
    // Judged together with Mira's trade today, so the DC reflects the combined deal.
    await expect(reply(page, "Persuasion")).toContainText("DC ");
    await reply(page, "Let the Dungeon Master judge this deal.").click();
    await expect.poll(async () => (await attempts(page)).at(-1)?.status).toBe("queued");
    await navigateApplication(page, origin + "/features/trading");
    const item = page.locator(".npc-barter-item").filter({ hasText: "Tamsin Reed → Odile Marsh" });
    await item.locator("summary").filter({ hasText: "What the player saw" }).click();
    await expect(item).toContainText("Let the Dungeon Master judge this deal.");
    await item.getByLabel("Counter: extra coins (copper)").fill("100");
    await item.getByRole("button", { name: "Send counter-offer", exact: true }).click();
    await expect.poll(async () => (await attempts(page)).at(-1)?.status).toBe("countered");
    await fits(page, `${width} queue`);
    await navigateApplication(page, origin + "/features/npcs?npc=odile");
    await talk(page).getByLabel("Speaking as").selectOption({ label: "Tamsin Reed" });
    await expect(said(page, "Close. Add 1 gp and we have a deal.")).toBeAttached();
    await reply(page, "Deal.").click();
    await expect.poll(async () => (await attempts(page)).at(-1)?.status).toBe("accepted");
    await expect(said(page, "Fair enough. We have a deal.")).toBeAttached();
    await fits(page, `${width} counter`);
    await page.screenshot({ path: `${output}/counter-${width}.png`, fullPage: true });
    await context.close();
  }
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(`NPC barter audit passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await browser.close();
}
