// Merchant purses (2026-11-03 research queue, priority 2) in a disposable device campaign: the
// sell form refuses a sale the shop's purse can't cover before confirming, a sale that fits is
// paid from it, the DM's Edit tab saves an off-list rate, and Restock refills the purse, with no
// sideways scrolling at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/merchant-purse", { recursive: true });
const failures = process.env.AUDIT_RESULTS_DIR || "test-results/merchant-purse";
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const { toCopper } = await import("/src/lib/quire/money.ts");
    const t = await economySnapshot();
    return {
      copper: Object.fromEntries(t.purses.map((p) => [p.id, toCopper(p.coins)])),
      shop: t.shops.find((s) => s.id === "marlow"),
      swords: t.holdings.find((h) => h.id === "sword")?.quantity ?? 0,
      ledger: t.ledger,
    };
  });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
    await openApplication(page, origin + "/market");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      await applyCloudTable({
        purses: [{ id: "ash", name: "Ash", kind: "character", coins: coins({ gp: 50 }) }],
        holdings: [
          { id: "sword", purseId: "ash", name: "Longsword", kind: "item", quantity: 3, unitCopper: 2000, notes: "", category: "smith" },
          { id: "potion", purseId: "ash", name: "Potion of healing", kind: "item", quantity: 2, unitCopper: 1000, notes: "", category: "apothecary" },
        ],
        shops: [
          {
            id: "marlow", name: "Marlow's Forge", keeper: "Marlow", place: "Port Ashby", notes: "", sellRate: 1,
            buyRate: 0.5, wealth: "modest", category: "smith", priceScale: 1, acceptedCategories: ["smith"],
            merchantPurse: 1230, merchantPurseRefill: 10000,
          },
        ],
        stock: [
          { id: "nails", shopId: "marlow", name: "Nails", copper: 100, baseCopper: 100, rarity: "common", quantity: 10, notes: "", category: "smith" },
        ],
        ledger: [],
        listings: [],
        loans: [],
        sheets: [],
        notes: [],
        journal: readJournal({}),
      });
    });
    await reloadApplication(page);
    await openApplication(page, origin + "/shop/marlow?sell=sword");
    await page.getByText("Purse 12 gp, 3 sp (DM only)").first().waitFor();
    const sellForm = page.locator("form#sell");
    await sellForm.waitFor();
    // Two swords (20 gp) don't fit the purse: refused before confirming.
    await sellForm.getByLabel("Quantity to sell").fill("2");
    await sellForm.getByText("Marlow has only 12 gp, 3 sp to spend. Marlow can buy up to 1.").waitFor();
    assert.equal(await sellForm.getByRole("button", { name: "Sell", exact: true }).isDisabled(), true, `${width}: Sell stays disabled`);
    assert.equal(await sideways(page), false, `${width}: the counter scrolls sideways`);
    await page.screenshot({ path: `test-results/merchant-purse/refused-${width}.png`, fullPage: width === 1280 });
    // One sword fits: paid from the purse.
    await sellForm.getByLabel("Quantity to sell").fill("1");
    await sellForm.getByRole("button", { name: "Sell", exact: true }).click();
    await sellForm.getByText("Sale recorded.").waitFor();
    let after = await books(page);
    assert.equal(after.shop.merchantPurse, 230);
    assert.equal(after.copper.ash, 5000 + 1000);
    assert.equal(after.swords, 2);
    assert.equal(after.ledger.length, 1);
    // DM Edit tab: buy anything else at 40% of the buy rate.
    await page.getByRole("group", { name: "Shop mode" }).getByRole("button", { name: "Edit", exact: true }).click();
    const settings = page.getByRole("group", { name: "Merchant purse and buy list" });
    await settings.waitFor();
    await settings.getByLabel("Buys anything else at").fill("40");
    await settings.getByRole("button", { name: "Apply purse settings" }).click();
    await settings.getByText("Merchant purse settings saved.").waitFor();
    assert.equal(await sideways(page), false, `${width}: the editor scrolls sideways`);
    await page.screenshot({ path: `test-results/merchant-purse/editor-${width}.png`, fullPage: width === 1280 });
    after = await books(page);
    assert.equal(after.shop.offListPercent, 40);
    assert.equal(after.shop.merchantPurse, 230, "editing other fields keeps the purse");
    // Restock refills the purse to 100 gp.
    await openApplication(page, origin + "/market");
    await page.getByRole("button", { name: "Restock" }).first().click();
    await page.getByText("Merchant purse: 2 gp, 3 sp → 100 gp").waitFor();
    assert.equal(await sideways(page), false, `${width}: the restock dialog scrolls sideways`);
    await page.getByRole("button", { name: "Add units & restock" }).click();
    await page.getByText("Manual restock recorded.").first().waitFor();
    after = await books(page);
    assert.equal(after.shop.merchantPurse, 10000);
    assert.deepEqual(errors, []);
    } catch (error) {
      await page.screenshot({ path: `${failures}/failure-${width}.png`, fullPage: true }).catch(() => {});
      throw error;
    }
    await context.close();
  }
  console.log("Merchant purse browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
