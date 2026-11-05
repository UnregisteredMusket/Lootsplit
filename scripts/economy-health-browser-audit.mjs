// Economy health (owner-approved 2026-11-05) in a disposable device campaign: Review Reports shows
// the DM-only panel with money in and out per session (an archived session and the live one),
// money moved inside the party apart, an unclassified line listed, the in-game week view, the
// net-worth chart and the advisory wealth note; nothing is stored or changed; a player preview
// never shows it; no sideways scrolling at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/economy-health", { recursive: true });
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return JSON.stringify({ purses: t.purses, holdings: t.holdings, ledger: t.ledger, journal: t.journal });
  });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/features/reports");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (gp, cp = 0) => ({ cp, sp: 0, ep: 0, gp, pp: 0 });
      const purses = (aria, bram, hoard) => [
        { id: "hoard", name: "The Hoard", kind: "party", coins: hoard },
        { id: "aria", name: "Aria Thorne", kind: "character", coins: aria },
        { id: "bram", name: "Bram Ironfoot", kind: "character", coins: bram },
      ];
      const line = (id, at, purseId, copper, summary, extra = {}) => ({ id, at, purseId, shopId: null, summary, copper, ...extra });
      const base = { shops: [], stock: [], listings: [], loans: [], sheets: [], notes: [] };
      const holdings = [
        { id: "rope", purseId: "aria", name: "Coil of rope", kind: "item", quantity: 2, unitCopper: 100, notes: "" },
        { id: "gem", purseId: "bram", name: "Star ruby", kind: "item", quantity: 1, unitCopper: 50000, notes: "", unidentified: { name: "Red stone", value: 1000 } },
      ];
      const old = {
        ...base,
        holdings,
        purses: purses(coins(18, 50), coins(19, 50), coins(10)),
        ledger: [
          line("buy-1", 1100, "aria", -200, "Bought 2 Coil of rope from Marlow's", { transactionType: "purchase" }),
          line("award-1-coins", 1200, "bram", 1000, "Encounter loot: Weir bandits", { transactionType: "adjustment", award: { receiptId: "award-1", role: "coins" } }),
          line("give-1", 1300, "bram", -50, "Transfer sent", { transactionType: "transfer" }),
          line("give-1-received", 1300, "aria", 50, "Transfer received", { transactionType: "transfer" }),
        ],
        journal: { sessions: [{ id: "weir", name: "Tolls of the Weir", startedAt: 1000, endedAt: 2000 }], events: [], requests: [] },
      };
      const now = Date.now() - 60_000;
      await applyCloudTable({
        ...base,
        holdings,
        purses: purses(coins(18, 50), coins(19, 57), coins(15)),
        ledger: [
          line("sale-1", now + 10, "hoard", 500, "Sold 1 Silver chalice to Marlow's", { transactionType: "sale" }),
          line("odd-1", now + 20, "bram", 7, "Mysterious windfall"),
        ],
        journal: readJournal({
          sessions: [
            { id: "weir", name: "Tolls of the Weir", startedAt: 1000, endedAt: 2000 },
            { id: "vault", name: "The Drowned Vault", startedAt: now },
          ],
          reports: [{ id: "weir", name: "Tolls of the Weir", at: 2000, snapshot: JSON.stringify(old) }],
          events: [],
        }),
      });
    });
    await reloadApplication(page, origin + "/features/reports");
    const panel = page.locator("section.economy-health");
    await panel.getByRole("heading", { name: "Economy health" }).waitFor();
    const before = await books(page);
    const summary = panel.locator(".econ-summary");
    await summary.getByText("15 gp", { exact: false }).first().waitFor();
    const text = await summary.innerText();
    assert.match(text, /Money in\s*15 gp/);
    assert.match(text, /Money out\s*2 gp/);
    assert.match(text, /Net\s*\+13 gp/);
    const table = panel.getByRole("table", { name: "Money in and out by session" });
    const one = table.getByRole("row").filter({ hasText: "Session 1 · Tolls of the Weir" });
    assert.match(await one.innerText(), /10 gp[\s\S]*2 gp[\s\S]*\+8 gp[\s\S]*5 sp/);
    const two = table.getByRole("row").filter({ hasText: "Session 2 · The Drowned Vault" });
    assert.match(await two.innerText(), /in progress/);
    assert.match(await two.innerText(), /1 · \+7 cp/, "the unclassified line is counted");
    await panel.getByText("Unclassified: 1 entries").click();
    await panel.getByText("Mysterious windfall").waitFor();
    // Net worth chart and the advisory note.
    await panel.getByRole("img", { name: /Party net worth by session/ }).waitFor();
    await panel.getByRole("note", { name: "Wealth by level (advisory)" }).waitFor();
    assert.equal(await sideways(page), false, `${width}: the panel scrolls sideways`);
    await panel.screenshot({ path: `test-results/economy-health/sessions-${width}.png` });
    // By in-game week: everything on day 0, week 1.
    await panel.getByRole("button", { name: "By in-game week" }).click();
    const weeks = panel.getByRole("table", { name: "Money in and out by in-game week" });
    await weeks.getByRole("row").filter({ hasText: "Week 1 · days 1–7" }).waitFor();
    assert.equal(await sideways(page), false, `${width}: the week view scrolls sideways`);
    // A DM target is kept on this device only; the campaign is unchanged.
    await panel.getByLabel(/Your own target/).fill("10");
    await panel.getByRole("button", { name: "Use target" }).click();
    await panel.getByText(/Your target: 10 gp per character level/).waitFor();
    assert.equal(await books(page), before, `${width}: reading economy health changed the campaign`);
    assert.equal(await page.evaluate(() => localStorage.getItem("quire.economy-health.target.v1")), "10");
    await panel.screenshot({ path: `test-results/economy-health/weeks-${width}.png` });

    // A player seat (Aria) never sees it. (Preview as player cannot open Review Reports: that
    // screen is outside the preview, so a real player seat on this device is used instead.)
    await page.evaluate(async () => {
      const t = await import("/src/lib/quire/table.ts");
      t.setSeat({ ...t.getSeat(), role: "player", purseIds: ["aria"] });
    });
    await reloadApplication(page, origin + "/features/reports");
    await page.locator("main h1").first().waitFor();
    assert.equal(await page.evaluate(async () => (await import("/src/lib/quire/table.ts")).getSeat().role), "player");
    await page.waitForTimeout(500);
    assert.equal(await page.locator("section.economy-health").count(), 0, `${width}: a player preview shows economy health`);
    assert.equal(await page.getByText("Mysterious windfall").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Economy health browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
