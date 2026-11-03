// Sell and split (prompt 2, phase 4) in a disposable device campaign: open it from the treasure
// pool, choose a shop and three items (a category the shop refuses stays unticked), check the
// proceeds and shares, review, confirm, and verify one atomic sale and split with conserved
// copper and no sideways scrolling at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/sell-and-split", { recursive: true });
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const { toCopper } = await import("/src/lib/quire/money.ts");
    const t = await economySnapshot();
    return {
      copper: Object.fromEntries(t.purses.map((p) => [p.id, toCopper(p.coins)])),
      holdings: t.holdings.map((h) => h.id).sort(),
      ledger: t.ledger,
      events: t.journal?.events ?? [],
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
    await openApplication(page, origin + "/party?section=pool");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      const item = (id, name, unitCopper, quantity, category, pooled) => ({
        id, purseId: "hoard", name, kind: "item", quantity, unitCopper, notes: "", category,
        ...(pooled ? { pool: { at: 1, source: "dm" } } : {}),
      });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ cp: 3 }) },
          { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 1 }) },
          { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 1 }) },
          { id: "cass", name: "Cass of the Reeds", kind: "character", coins: coins({ gp: 1 }) },
        ],
        holdings: [
          item("chalice", "Silver chalice", 2500, 1, "curios", true),
          item("silk", "Bolt of silk", 1000, 2, "cloth", true),
          item("dagger", "Jewelled dagger", 4000, 1, "smith", true),
          item("potion", "Potion of healing", 5000, 3, "apothecary", true),
        ],
        shops: [
          {
            id: "marlow", name: "Marlow's Curios", keeper: "", place: "Port Ashby", notes: "", sellRate: 1,
            buyRate: 0.5, wealth: "modest", category: "curios", priceScale: 1,
            acceptedCategories: ["curios", "cloth", "smith"],
          },
        ],
        stock: [],
        ledger: [],
        listings: [],
        loans: [],
        sheets: [],
        notes: [],
        journal: readJournal({}),
      });
    });
    await reloadApplication(page, origin + "/party?section=pool");
    await page.getByRole("button", { name: "Sell & split…" }).click();
    const form = page.getByRole("form", { name: "Sell and split" });
    await form.waitFor();
    assert.equal(await form.getByLabel("Sell Potion of healing").isDisabled(), true, "the shop refuses potions");
    for (const name of ["Silver chalice", "Bolt of silk", "Jewelled dagger"]) await form.getByLabel(`Sell ${name}`).check();
    // A stack can be sold in part: 1 of 2 silk, then back to both.
    const silk = form.getByLabel("How many Bolt of silk to sell");
    assert.ok((await silk.boundingBox()).width >= 60, `${width}: the quantity box is too narrow`);
    await silk.fill("1");
    await form.getByText("37 gp, 5 sp", { exact: true }).first().waitFor();
    await silk.fill("2");
    await form.getByText("42 gp, 5 sp", { exact: true }).first().waitFor();
    await form.getByText("3 shares of 14 gp, 1 sp, 6 cp").waitFor();
    assert.equal(await sideways(page), false, `${width}: the form scrolls sideways`);
    await form.screenshot({ path: `test-results/sell-and-split/form-${width}.png` });
    await form.getByRole("button", { name: "Review sale & split" }).click();
    await page.getByText("Sell 3 items to Marlow's Curios and split 42 gp, 5 sp?").waitFor();
    assert.equal(await sideways(page), false, `${width}: the review scrolls sideways`);
    await page.getByRole("button", { name: "Sell & split", exact: true }).click();
    await page.getByText("Sold and split.").first().waitFor();
    const after = await books(page);
    assert.deepEqual(after.holdings, ["potion"]);
    for (const id of ["aria", "bram", "cass"]) assert.equal(after.copper[id], 100 + 1416, id);
    assert.equal(after.copper.hoard, 3 + 2, "2 cp leftover stays in the fund");
    assert.equal(after.ledger.filter((l) => l.transactionType === "sale").length, 3);
    assert.equal(after.ledger.filter((l) => l.split).length, 4);
    assert.equal(after.ledger.reduce((sum, l) => sum + l.copper, 0), 4250, "copper is conserved");
    assert.equal(after.events.filter((e) => /^Sold 3 items to Marlow's Curios and split/.test(e.summary)).length, 1);
    await page.screenshot({ path: `test-results/sell-and-split/done-${width}.png`, fullPage: width === 1280 });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Sell and split browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
