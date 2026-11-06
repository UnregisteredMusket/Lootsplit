// Factions, renown and favor (owner design 2026-11-05) in a disposable device campaign: the DM
// adds "The Black Hand" controlling Dead Man's Drink on Factions, reveals it, and gives the whole
// party +300 renown in one step (300 Favor each; the party median is Admired). The shop's Why this
// price? shows "The Black Hand: Admired −10%" and buying charges exactly that total. A hidden "Pale
// Court" (party −400, Hated +25%) on the same shop changes the price too: the DM sees it by name,
// a player only as "Local standing". The player's Factions screen shows the Black Hand with their
// own renown, Favor and the party's attitude, never the hidden court or another character's
// standing. No sideways scrolling at 1280, 390 and 320 px. Never targets a real campaign.
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
await mkdir("test-results/factions", { recursive: true });
const snapshot = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const { toCopper } = await import("/src/lib/quire/money.ts");
    const t = await economySnapshot();
    return {
      aria: toCopper(t.purses.find((p) => p.id === "aria").coins),
      ale: t.stock.find((s) => s.id === "ale").copper,
      factions: t.journal?.factions ?? [],
      logs: (t.journal?.events ?? []).filter((e) => /renown with/.test(e.summary)).map((e) => ({ purseId: e.purseId, dmOnly: !!e.dmOnly })),
    };
  });
const seat = (page, role) =>
  page.evaluate(async (role) => {
    const { DM_SEAT, setSeat } = await import("/src/lib/quire/table.ts");
    setSeat(role === "dm" ? DM_SEAT : { ...DM_SEAT, role: "player", purseIds: ["aria"], shopIds: ["drink"] });
  }, role);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
async function addFaction(page, name) {
  const form = page.getByTestId("faction-form-add");
  await form.getByLabel("Faction name").fill(name);
  await form.getByRole("checkbox", { name: "Dead Man's Drink" }).check();
  const before = (await snapshot(page)).factions.length;
  await form.getByRole("button", { name: "Add faction" }).click();
  await page.getByTestId("faction-card").filter({ hasText: name }).first().waitFor();
  assert.equal((await snapshot(page)).factions.length, before + 1, `${name} was added once`);
}
async function partyRenown(page, name, amount, reason) {
  const card = page.getByTestId("faction-card").filter({ hasText: name });
  const form = card.getByTestId("faction-renown-form");
  await form.getByLabel("Amount").fill(amount);
  await form.getByLabel("Reason").fill(reason);
  await form.getByRole("button", { name: "Change renown" }).click();
  await card.getByText("Renown changed.").waitFor();
}
async function breakdown(page) {
  await openApplication(page, origin + "/shop/drink");
  await chooseOption(page.getByLabel("Paying from", { exact: true }), "aria");
  await page.getByRole("button", { name: "Why this price?" }).first().click();
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
      const pc = (id, name) => {
        const p = { ...blankPurse("character"), id, name, coins: coins({ gp: 500 }) };
        p.sheet.scores.cha = 10;
        return p;
      };
      await applyCloudTable({
        purses: [pc("aria", "Aria Thorne"), pc("bram", "Bram Ironfoot"), pc("cora", "Cora Vale")],
        holdings: [],
        shops: [{
          id: "drink", name: "Dead Man's Drink", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5,
          wealth: "modest", category: "inn", priceScale: 1,
        }],
        stock: [{ id: "ale", shopId: "drink", name: "Cask of ale", copper: 1000, baseCopper: 1000, rarity: "common", quantity: null, notes: "", category: "inn" }],
        ledger: [], listings: [], loans: [], sheets: [], notes: [],
        journal: readJournal({ finance: { day: 1 } }),
      });
    });
    // The DM adds the Black Hand, reveals it and gives the whole party +300 renown.
    await openApplication(page, origin + "/features/factions");
    await page.getByTestId("factions-manager").waitFor();
    await addFaction(page, "The Black Hand");
    const hand = page.getByTestId("faction-card").filter({ hasText: "The Black Hand" });
    await hand.getByText("Hidden from players").waitFor();
    await hand.getByRole("button", { name: "Reveal to players" }).click();
    await hand.getByRole("button", { name: "Hide from players" }).waitFor();
    await partyRenown(page, "The Black Hand", "300", "Saved the boss");
    await hand.getByTestId("faction-prices").getByText("Dead Man's Drink −10%").waitFor();
    let books = await snapshot(page);
    const bh = books.factions.find((f) => f.name === "The Black Hand");
    assert.deepEqual(bh.standing, { aria: [300, 300], bram: [300, 300], cora: [300, 300] }, "one party command, 300 Favor each");
    assert.equal(bh.hidden, undefined);
    assert.deepEqual(books.logs, ["aria", "bram", "cora"].map((purseId) => ({ purseId, dmOnly: false })));
    assert.equal(await sideways(page), false, `${width}: the factions page scrolls sideways`);
    await page.getByTestId("factions-manager").screenshot({ path: `test-results/factions/manager-${width}.png` });

    // Why this price? names the faction, and buying charges exactly that total.
    let region = await breakdown(page);
    for (const text of ["List price", "The Black Hand: Admired −10%", "900 cp"]) await region.getByText(text, { exact: false }).first().waitFor();
    assert.equal(await sideways(page), false, `${width}: the breakdown scrolls sideways`);
    await page.getByRole("button", { name: /^Buy / }).first().click();
    await page.getByText("Purchase recorded.").first().waitFor();
    let bought = await snapshot(page);
    assert.equal(books.aria - bought.aria, 900, `${width}: the charge equals the breakdown total`);
    assert.equal(bought.ale, 1000, "the stored stock price is not rewritten");

    // A hidden Pale Court on the same shop: 1000 × 0.9 × 1.25 = 1125.
    await openApplication(page, origin + "/features/factions");
    await addFaction(page, "The Pale Court");
    await partyRenown(page, "The Pale Court", "-400", "Insulted the court");
    region = await breakdown(page);
    for (const text of ["The Black Hand: Admired −10%", "The Pale Court: Hated +25% (hidden", "1,125 cp"])
      await region.getByText(text, { exact: false }).first().waitFor();
    await region.screenshot({ path: `test-results/factions/dm-breakdown-${width}.png` });
    books = await snapshot(page);
    await page.getByRole("button", { name: /^Buy / }).first().click();
    await page.getByText("Purchase recorded.").first().waitFor();
    bought = await snapshot(page);
    assert.equal(books.aria - bought.aria, 1125, `${width}: the hidden faction is charged as shown`);

    // A player seat: the court only as Local standing; the Factions screen shows only their own standing.
    await seat(page, "player");
    region = await breakdown(page);
    await region.getByText("The Black Hand: Admired −10%", { exact: false }).waitFor();
    await region.getByText("Local standing").waitFor();
    await region.getByText("1,125 cp", { exact: false }).first().waitFor();
    assert.ok(!(await region.innerText()).includes("Pale"), `${width}: the player sees the hidden faction's name`);
    await openApplication(page, origin + "/features/factions");
    const mine = page.getByTestId("player-faction");
    await mine.first().waitFor();
    assert.equal(await mine.count(), 1, `${width}: only the visible faction`);
    const own = mine.getByTestId("faction-own-meter");
    await own.getByText("Admired, 300 · 300 Favor").waitFor();
    await mine.getByTestId("faction-party-meter").getByText("Admired", { exact: true }).waitFor();
    const text = await page.locator("main").innerText();
    for (const secret of ["Pale", "Bram", "Cora"]) assert.ok(!text.includes(secret), `${width}: the player's Factions screen shows ${secret}`);
    assert.equal(await sideways(page), false, `${width}: the player's factions page scrolls sideways`);
    await mine.first().screenshot({ path: `test-results/factions/player-${width}.png` });
    await seat(page, "dm");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Factions browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
