// Charges and consumables (loot plan phase 5) in a disposable device campaign: the DM uses a
// rechargeable wand down to 0 (kept, Use disabled), recharges it, uses the last of a consumable
// in a stack (confirm; one fewer, the next full), and turns on tracking for an item in Edit item.
// Each Use and Recharge is one activity event and no ledger line; no sideways scrolling at 1280,
// 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/item-charges", { recursive: true });
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return {
      holdings: Object.fromEntries(t.holdings.map((h) => [h.id, { quantity: h.quantity, uses: h.uses ?? null }])),
      ledger: t.ledger.length,
      events: (t.journal?.events ?? []).map((e) => e.summary).filter((s) => /^(Used|Recharged)/.test(s)),
    };
  });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const menu = async (page, name) => {
  await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).first().click();
};
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/party?section=funds");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
      const item = (id, name, quantity, uses) => ({
        id, purseId: "aria", name, kind: "item", quantity, unitCopper: 5000, notes: "", ...(uses ? { uses } : {}),
      });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins },
          { id: "aria", name: "Aria Thorne", kind: "character", coins },
        ],
        holdings: [
          item("wand", "Wand of magic missiles", 1, { current: 2, max: 3, whenEmpty: "keep" }),
          item("potions", "Potion of healing", 2, { current: 1, max: 1, whenEmpty: "remove" }),
          item("kit", "Healer's kit", 1),
        ],
        shops: [], stock: [], ledger: [], listings: [], loans: [], sheets: [], notes: [],
        journal: readJournal({}),
      });
    });
    await reloadApplication(page, origin + "/party?section=funds");
    await page.getByText("2/3 uses", { exact: true }).waitFor();

    // A rechargeable item: Use twice, it stays at 0 and Use is disabled.
    for (const left of ["1/3 uses", "0/3 uses · used up"]) {
      await menu(page, "Wand of magic missiles");
      await page.getByRole("menuitem", { name: "Use", exact: true }).click();
      await page.getByText(left, { exact: true }).waitFor();
    }
    await menu(page, "Wand of magic missiles");
    assert.equal(await page.getByRole("menuitem", { name: /^Use/ }).getAttribute("aria-disabled"), "true");
    await page.getByRole("menuitem", { name: "Recharge", exact: true }).click();
    const recharge = page.getByRole("dialog", { name: "Recharge Wand of magic missiles" });
    await recharge.getByText("Now 0 of 3 uses.").waitFor();
    assert.equal(await sideways(page), false, `${width}: the recharge dialog scrolls sideways`);
    await recharge.screenshot({ path: `test-results/item-charges/recharge-${width}.png` });
    await recharge.getByRole("button", { name: "Recharge", exact: true }).click();
    await page.getByText("3/3 uses", { exact: true }).waitFor();

    // A consumable in a stack: the last use asks first, then one is removed and the next is full.
    await menu(page, "Potion of healing");
    await page.getByRole("menuitem", { name: "Use", exact: true }).click();
    await page.getByText("Use the last of Potion of healing?").waitFor();
    await page.getByRole("button", { name: "Use", exact: true }).click();
    await page.getByText("Used Potion of healing.").first().waitFor();

    // Edit item: turn on tracking for a kit (10 uses, kept at 0).
    await menu(page, "Healer's kit");
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit Healer's kit" });
    await edit.getByRole("switch", { name: "Track uses" }).click();
    await edit.getByLabel("Maximum uses for Healer's kit").fill("10");
    await edit.getByRole("button", { name: "Keep it at 0" }).click();
    assert.equal(await sideways(page), false, `${width}: Edit item scrolls sideways`);
    await edit.screenshot({ path: `test-results/item-charges/edit-${width}.png` });
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("10/10 uses", { exact: true }).waitFor();

    const after = await books(page);
    assert.deepEqual(after.holdings.wand, { quantity: 1, uses: { current: 3, max: 3, whenEmpty: "keep" } });
    assert.deepEqual(after.holdings.potions, { quantity: 1, uses: { current: 1, max: 1, whenEmpty: "remove" } });
    assert.deepEqual(after.holdings.kit.uses, { current: 10, max: 10, whenEmpty: "keep" });
    assert.equal(after.ledger, 0, "no money moved");
    assert.deepEqual(after.events, [
      "Used Wand of magic missiles (Aria Thorne): 1 of 3 uses left",
      "Used the last use of Wand of magic missiles (Aria Thorne): 0 of 3 left, kept until recharged",
      "Recharged Wand of magic missiles (Aria Thorne): 0 → 3 of 3 uses",
      "Used up one Potion of healing (Aria Thorne): removed; 1 left, the next at 1 of 1 uses",
    ]);
    assert.equal(await sideways(page), false, `${width}: the inventory scrolls sideways`);
    await page.screenshot({ path: `test-results/item-charges/done-${width}.png`, fullPage: width === 1280 });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Item charges browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
