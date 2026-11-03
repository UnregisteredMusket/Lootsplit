// Make change (prompt 2, phase 4) in a disposable device campaign: the form's preview, a whole-coin
// remainder, one exchange recorded once with no ledger line, and no sideways scrolling at 1280, 390
// and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/make-change", { recursive: true });
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return { purses: t.purses, ledger: t.ledger, events: t.journal?.events ?? [] };
  });
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 400 ? 760 : 900 },
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/party?section=funds");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      await applyCloudTable({
        purses: [
          { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 25, cp: 7 }) },
        ],
        holdings: [],
        shops: [],
        stock: [],
        ledger: [],
        listings: [],
        loans: [],
        sheets: [],
        notes: [],
        journal: readJournal({}),
      });
    });
    await reloadApplication(page, origin + "/party?section=funds");
    const wallets = page.locator("details.inventory-management");
    if (!(await wallets.evaluate((el) => el.open)))
      await wallets.locator("summary").first().click();
    await page.locator("#purse-aria > summary").click();
    const form = page.getByRole("form", { name: "Make change for Aria Thorne" });
    await form.scrollIntoViewIfNeeded();
    // 3 gp → 30 sp.
    await form.getByLabel("Coins to exchange").fill("3");
    await form.getByText("Gives 3 gp, gets 30 sp.", { exact: true }).waitFor();
    // 7 cp are too few for a whole silver piece: nothing to exchange.
    await form.getByLabel("Exchange from").selectOption("cp");
    await form.getByLabel("Coins to exchange").fill("7");
    await form.getByText("Not enough cp for a whole sp.", { exact: true }).waitFor();
    assert.equal(await form.getByRole("button", { name: "Exchange" }).isDisabled(), true);
    await form.getByLabel("Exchange from").selectOption("gp");
    await form.getByLabel("Coins to exchange").fill("3");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `${width}: the page scrolls sideways`,
    );
    await form.screenshot({ path: `test-results/make-change/form-${width}.png` });
    await form.getByRole("button", { name: "Exchange" }).click();
    await page.getByText("Change made.").first().waitFor();
    const after = await books(page);
    const aria = after.purses.find((p) => p.id === "aria").coins;
    assert.deepEqual(aria, { cp: 7, sp: 30, ep: 0, gp: 22, pp: 0 });
    assert.equal(after.ledger.length, 0, "making change writes no ledger line");
    assert.equal(after.events.filter((e) => /made change: 3 gp → 30 sp/.test(e.summary)).length, 1);
    await page.screenshot({
      path: `test-results/make-change/done-${width}.png`,
      fullPage: width === 1280,
    });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Make change browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
