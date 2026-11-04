// "Why this price?" (comparable-tools research, priority 2) in a disposable device campaign: a
// black-market shop with a markup sells to Aria (Charisma 16). The row's disclosure is a button
// with an expanded region that lists the markup, the black-market premium (the device is the DM),
// Aria's Charisma and the total; buying charges exactly that total; the sale box explains its
// payout. No sideways scrolling at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/price-breakdown", { recursive: true });
const copperOf = (page, id) =>
  page.evaluate(async (id) => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const { toCopper } = await import("/src/lib/quire/money.ts");
    return toCopper((await economySnapshot()).purses.find((p) => p.id === id).coins);
  }, id);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/market");
    await page.evaluate(async () => {
      const { applyCloudTable, blankPurse } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      const aria = { ...blankPurse("character"), id: "aria", name: "Aria Thorne", coins: coins({ gp: 500 }) };
      aria.sheet.scores.cha = 16;
      await applyCloudTable({
        purses: [{ id: "fund", name: "Party fund", kind: "party", coins: coins({ gp: 5 }) }, aria],
        holdings: [{ id: "ring", purseId: "aria", name: "Old ring", kind: "item", quantity: 2, unitCopper: 777, notes: "", category: "jewels" }],
        shops: [{
          id: "backroom", name: "The Back Room", keeper: "", place: "", notes: "", sellRate: 1.15, buyRate: 0.33,
          wealth: "modest", category: "mixed", priceScale: 1, blackMarket: true, blackMarketPremium: 1.37,
        }],
        stock: [{ id: "blade", shopId: "backroom", name: "Smuggled blade", copper: 1337, baseCopper: 1337, rarity: "common", quantity: 5, notes: "", category: "smith" }],
        ledger: [], listings: [], loans: [], sheets: [], notes: [],
        journal: readJournal({ world: { blackMarketActive: true } }),
      });
    });
    await openApplication(page, origin + "/shop/backroom");
    await chooseOption(page.getByLabel("Paying from", { exact: true }), "aria");
    // 1337 × 1.15 = 1538 (markup); × 1.37 → 2106 (premium); Charisma 16 takes 6% → 1980.
    const toggle = page.getByRole("button", { name: "Why this price?" }).first();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    const region = page.getByRole("region", { name: "Price breakdown" }).first();
    for (const text of ["List price", "1,337 cp", "Shop sells at 115%", "+201 cp", "Black-market premium", "+568 cp", "Aria Thorne negotiates: Charisma 16, 6% off", "−126 cp", "1,980 cp"])
      await region.getByText(text, { exact: false }).first().waitFor();
    assert.equal(await toggle.getAttribute("aria-controls"), await region.getAttribute("id"));
    assert.equal(await sideways(page), false, `${width}: the breakdown scrolls sideways`);
    await region.screenshot({ path: `test-results/price-breakdown/shop-${width}.png` });
    const before = await copperOf(page, "aria");
    await page.getByRole("button", { name: /^Buy 1 gp|^Buy 19 gp/ }).first().click();
    await page.getByText("Purchase recorded.").first().waitFor();
    assert.equal(before - (await copperOf(page, "aria")), 1980, `${width}: the charge equals the breakdown total`);
    // Selling: the payout disclosure explains the shop's buy rate.
    const why = page.getByRole("button", { name: "Why this payout?" });
    await why.click();
    const sale = page.getByRole("region", { name: "Price breakdown" }).last();
    for (const text of ["Lot value", "777 cp", "Shop buys at 33%", "−521 cp", "256 cp"]) await sale.getByText(text).first().waitFor();
    assert.equal(await sideways(page), false, `${width}: the sale breakdown scrolls sideways`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Price breakdown browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
