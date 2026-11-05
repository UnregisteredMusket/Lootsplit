// Named market events (owner-approved 2026-11-05) in a disposable device campaign: the DM adds
// "Blight in the Riverlands" (provisions ×1.8, 21 days) and a secret "Guild levy" (×1.2, all items)
// under Economic rules → Market events; both list as Active; the baker's Why this price? names the
// blight (+266 cp) and the levy (DM-only), and buying charges exactly the total; the stored stock
// price is unchanged. A player seat sees the blight in Market → Market events and in the
// breakdown, the levy only as "Other adjustments" and never by name. End now moves the blight to
// Ended (kept as history) and the price drops back. No sideways scrolling at 1280, 390 and 320 px.
// Never targets a real campaign.
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
await mkdir("test-results/event-modifiers", { recursive: true });
const snapshot = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const { toCopper } = await import("/src/lib/quire/money.ts");
    const t = await economySnapshot();
    return {
      aria: toCopper(t.purses.find((p) => p.id === "aria").coins),
      grain: t.stock.find((s) => s.id === "grain").copper,
      events: t.journal?.marketEvents ?? [],
      logs: (t.journal?.events ?? []).filter((e) => /^Market event/.test(e.summary)).map((e) => ({ summary: e.summary, dmOnly: e.dmOnly })),
    };
  });
const seat = (page, role) =>
  page.evaluate(async (role) => {
    const { DM_SEAT, setSeat } = await import("/src/lib/quire/table.ts");
    setSeat(role === "dm" ? DM_SEAT : { ...DM_SEAT, role: "player", purseIds: ["aria"], shopIds: ["baker"] });
  }, role);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
async function addEvent(page, { name, items, multiplier, days, secret }) {
  const form = page.getByTestId("market-event-form-add");
  await form.getByLabel("Event name").fill(name);
  await form.getByLabel("Items").selectOption(items);
  await form.getByLabel("Price multiplier").fill(multiplier);
  await form.getByLabel("Lasts (days)").fill(days);
  if (secret) await form.getByRole("checkbox").check();
  const before = (await snapshot(page)).events.length;
  await form.getByRole("button", { name: "Add event" }).click();
  // The list shows the new event (the form may remount while the campaign reloads).
  await page.getByTestId("market-event-row").filter({ hasText: name }).first().waitFor();
  const after = await snapshot(page);
  assert.equal(after.events.length, before + 1, `${name} was added once`);
}
async function breakdown(page) {
  await openApplication(page, origin + "/shop/baker");
  await chooseOption(page.getByLabel("Paying from", { exact: true }), "aria");
  const toggle = page.getByRole("button", { name: "Why this price?" }).first();
  await toggle.click();
  return page.getByRole("region", { name: "Price breakdown" }).first();
}
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
      aria.sheet.scores.cha = 10;
      await applyCloudTable({
        purses: [aria],
        holdings: [],
        shops: [{
          id: "baker", name: "Riverside Baker", keeper: "", place: "", notes: "", sellRate: 1.1, buyRate: 0.5,
          wealth: "modest", category: "provisions", priceScale: 1,
        }],
        stock: [{ id: "grain", shopId: "baker", name: "Sack of grain", copper: 333, baseCopper: 333, rarity: "common", quantity: null, notes: "", category: "provisions" }],
        ledger: [], listings: [], loans: [], sheets: [], notes: [],
        journal: readJournal({ finance: { day: 12 } }),
      });
    });
    // The DM adds two events under Economic rules → Market events.
    await openApplication(page, origin + "/features/financial#market-events");
    const manager = page.getByTestId("market-events-manager");
    await manager.waitFor();
    await manager.getByText("Session Time (today is day 12)", { exact: false }).waitFor();
    await addEvent(page, { name: "Blight in the Riverlands", items: "provisions", multiplier: "1.8", days: "21" });
    await addEvent(page, { name: "Guild levy", items: "", multiplier: "1.2", days: "7", secret: true });
    await manager.getByRole("heading", { name: "Active (2)" }).waitFor();
    await manager.getByText("×1.8 (+80%) · Whole realm · provisions").waitFor();
    assert.equal(await sideways(page), false, `${width}: the market events section scrolls sideways`);
    await manager.screenshot({ path: `test-results/event-modifiers/manager-${width}.png` });
    let books = await snapshot(page);
    assert.deepEqual(books.events.map((e) => [e.name, e.permille, e.startDay, e.endDay, !!e.secret]), [
      ["Blight in the Riverlands", 1800, 12, 33, false],
      ["Guild levy", 1200, 12, 19, true],
    ]);
    assert.ok(books.logs.length === 2 && books.logs.every((l) => l.dmOnly), "one DM-only log line each");

    // DM breakdown: 333 × 1.8 × 1.2 = 719.28 (the two events, in start-day then ID order, add 386);
    // × 1.1 = 791 (+72).
    let region = await breakdown(page);
    for (const text of ["List price", "Market event: Blight in the Riverlands +80%", "Market event: Guild levy (secret: players see Other adjustments) +20%", "Shop sells at 110%", "+72 cp", "791 cp"])
      await region.getByText(text, { exact: false }).first().waitFor();
    assert.equal(await sideways(page), false, `${width}: the breakdown scrolls sideways`);
    await region.screenshot({ path: `test-results/event-modifiers/dm-breakdown-${width}.png` });
    await page.getByRole("button", { name: /^Buy 7 gp/ }).first().click();
    await page.getByText("Purchase recorded.").first().waitFor();
    const bought = await snapshot(page);
    assert.equal(books.aria - bought.aria, 791, `${width}: the charge equals the breakdown total`);
    assert.equal(bought.grain, 333, "the stored stock price is not rewritten");

    // A player seat: the blight by name, the levy only as Other adjustments.
    await seat(page, "player");
    region = await breakdown(page);
    await region.getByText("Market event: Blight in the Riverlands", { exact: false }).waitFor();
    await region.getByText("Other adjustments").waitFor();
    assert.ok(!(await region.innerText()).includes("Guild levy"), `${width}: the player sees the secret event's name`);
    await openApplication(page, origin + "/market");
    const list = page.getByTestId("market-events-list");
    await list.getByText("Blight in the Riverlands").waitFor();
    assert.ok(!(await list.innerText()).includes("Guild levy"), `${width}: the secret event is listed for players`);
    assert.equal(await sideways(page), false, `${width}: the market page scrolls sideways`);
    await list.screenshot({ path: `test-results/event-modifiers/player-list-${width}.png` });

    // End now: the blight moves to Ended, stays as history, and the price drops.
    await seat(page, "dm");
    await openApplication(page, origin + "/features/financial#market-events");
    const blight = page.getByTestId("market-event-row").filter({ hasText: "Blight in the Riverlands" });
    await blight.getByRole("button", { name: "End now" }).click();
    await page.getByTestId("market-events-manager").getByRole("heading", { name: "Ended (1)" }).waitFor();
    books = await snapshot(page);
    assert.equal(books.events.length, 2, "ended events stay as history");
    assert.equal(books.events.find((e) => e.name === "Blight in the Riverlands").endDay, 12);
    region = await breakdown(page);
    await region.getByText("440 cp", { exact: false }).first().waitFor(); // 333 × 1.2 × 1.1 = 439.56
    assert.ok(!(await region.innerText()).includes("Blight"), `${width}: an ended event still prices`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Market events browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
