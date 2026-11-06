// Award item details (item-details.ts) in a disposable device campaign: Party → Add loot sets an
// item's charges, attunement requirement and "award unidentified" record in the same save. The
// new holding carries all three, the events a player could read name it as presented, and the form
// has no sideways scrolling at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/award-item-details", { recursive: true });
const TRUE_NAME = "Staff of Qorvath";
const SHOWN_NAME = "Gnarled walking stick";
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return { holdings: t.holdings, events: t.journal?.events ?? [] };
  });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/party");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      await applyCloudTable({
        purses: [
          { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 1 }) },
          { id: "hoard", name: "The Hoard", kind: "party", coins: coins({}) },
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
    await page.getByRole("button", { name: "+ Add loot", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Holding owner", { exact: true }).selectOption({ label: "Aria Thorne" });
    await dialog.getByLabel("Holding name", { exact: true }).fill(TRUE_NAME);
    await dialog.getByLabel("Holding value", { exact: true }).fill("500 gp");
    await dialog.getByRole("switch", { name: "Track uses" }).click();
    await dialog.getByLabel(`Maximum uses for ${TRUE_NAME}`).fill("7");
    await dialog.getByLabel(`Uses left for ${TRUE_NAME}`).fill("5");
    await dialog.getByRole("group", { name: `When the last use of ${TRUE_NAME} is spent` }).getByRole("button", { name: "Keep it at 0" }).click();
    await dialog.getByRole("switch", { name: "Requires attunement" }).click();
    await dialog.getByLabel(`Attunement requirement for ${TRUE_NAME}`).fill("Requires attunement: by a wizard");
    await dialog.getByRole("switch", { name: "Award unidentified" }).click();
    await dialog.getByLabel(`Name players see for ${TRUE_NAME}`).fill(SHOWN_NAME);
    await dialog.getByLabel(`Value players see for ${TRUE_NAME}`).fill("3 gp");
    assert.equal(await sideways(page), false, `${width}: the form scrolls sideways`);
    await dialog.screenshot({ path: `test-results/award-item-details/form-${width}.png` });
    await dialog.getByRole("button", { name: "Add loot", exact: true }).click();
    await page.waitForFunction(async () => {
      const { economySnapshot } = await import("/src/lib/quire/economy.ts");
      return (await economySnapshot()).holdings.length === 1;
    });
    const after = await books(page);
    assert.equal(after.holdings.length, 1);
    const [staff] = after.holdings;
    assert.deepEqual(
      [staff.purseId, staff.name, staff.uses, staff.requiresAttunement, staff.unidentified],
      ["aria", TRUE_NAME, { current: 5, max: 7, whenEmpty: "keep" }, "Requires attunement: by a wizard", { name: SHOWN_NAME, value: 300 }],
    );
    // Events a player could read name the item as presented; the DM keeps a DM-only record.
    const readable = after.events.filter((e) => !e.dmOnly);
    assert.equal(JSON.stringify(readable).includes(TRUE_NAME), false, "a readable event names the true item");
    assert.ok(readable.some((e) => e.summary.includes(SHOWN_NAME)));
    assert.ok(after.events.some((e) => e.dmOnly && e.summary.includes(TRUE_NAME)));
    await page.screenshot({ path: `test-results/award-item-details/done-${width}.png`, fullPage: width === 1280 });
    assert.equal(await sideways(page), false, `${width}: the page scrolls sideways`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Award item details browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
