// Settlement tiers, phase S1 (owner design 2026-11-10) in a disposable device campaign: the DM
// gives Port City the size Metropolis with a population and a 1,000 gp merchant purse for new
// shops, from Market → Manage regions, cities, towns and areas. The party's place cards in Market
// show the size (the Docks share their city's); the existing shop keeps its own wealth and purse;
// Create a shop at the Docks starts Princely and says the defaults come from Port City. Switching
// to five steps is refused while Port City is a Metropolis (an eight-size tier). Phase S2 (limits):
// the DM turns the per-item sale cap on (Refuse) and limits a Metropolis's generated stock to
// Uncommon; a player would be refused a 20,000 gp sale there with the 16,000 gp limit named, while
// the DM (exempt, owner decision 2026-11-10) sees the warning in the sell form and sells at the full
// 20,000 gp; the composer at the Docks disables Rare and Magic with the cap's note. No sideways scrolling at 1280, 390 and 320
// px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):/, "Settlement fixtures require a disposable server");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/settlement-tiers", { recursive: true });
const tavern = {
  id: "tavern", name: "Old Tavern", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5,
  wealth: "modest", category: "inn", priceScale: 1, locationId: "docks", merchantPurse: 2_500_000, acceptAnyCategory: true,
};
const snapshot = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return {
      settlements: t.journal?.settlements ?? null,
      shops: t.shops,
      events: (t.journal?.events ?? []).filter((e) => e.summary.startsWith("Settlement")),
      crowns: t.holdings.filter((h) => h.id === "crown").length,
      sales: t.ledger.filter((l) => l.transactionType === "sale").map((l) => l.copper),
    };
  });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
async function manage(page) {
  const fold = page.getByRole("button", { name: /Manage regions, cities, towns and areas/ });
  if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
  await page.getByTestId("settlement-ladder-form").waitFor();
}
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 }, serviceWorkers: "block" });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(25000);
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/market");
    await page.evaluate(async (tavern) => {
      const { applyCloudTable, blankPurse } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const { DM_SEAT, setSeat } = await import("/src/lib/quire/table.ts");
      setSeat(DM_SEAT);
      await applyCloudTable({
        purses: [{ ...blankPurse("character"), id: "aria", name: "Aria Thorne" }],
        // S2: worth 40,000 gp; the tavern's 50% buy rate pays 20,000 gp, above a Metropolis's 16,000 gp.
        holdings: [{ id: "crown", purseId: "aria", name: "Jewelled crown", kind: "item", quantity: 1, unitCopper: 4_000_000, notes: "", category: "general" }],
        shops: [tavern],
        stock: [],
        ledger: [], listings: [], loans: [], sheets: [], notes: [],
        journal: readJournal({
          finance: { day: 1 },
          market: {
            currentLocationId: "docks",
            locations: [
              { id: "coast", kind: "region", parentId: null, name: "The Coast", description: "" },
              { id: "port-city", kind: "city", parentId: "coast", name: "Port City", description: "" },
              { id: "docks", kind: "area", parentId: "port-city", name: "The Docks", description: "" },
            ],
          },
        }),
      });
    }, tavern);
    await openApplication(page, origin + "/market");
    await manage(page);
    await chooseOption(page.getByLabel("Edit location", { exact: true }), "port-city");
    const form = page.getByTestId("settlement-profile-form");
    await form.getByLabel("Settlement size", { exact: true }).selectOption("metropolis");
    await form.getByLabel("Population").fill("about 25,000");
    await form.getByLabel("New shops' merchant purse in gp").fill("1000");
    await form.getByRole("button", { name: "Save size" }).click();
    await form.getByText("Settlement size saved.").waitFor();
    let books = await snapshot(page);
    assert.deepEqual(books.settlements, { places: { "port-city": { tier: "metropolis", population: "about 25,000", purse: 100000 } } });
    assert.deepEqual(books.shops, [tavern], `${width}: the existing shop keeps its wealth and purse`);
    assert.deepEqual(books.events.map((e) => [e.summary, e.dmOnly]), [["Settlement tier saved: Port City · Metropolis", true]]);
    assert.equal(await sideways(page), false, `${width}: the settlement form scrolls sideways`);
    await form.screenshot({ path: `test-results/settlement-tiers/profile-${width}.png` });

    // Five steps would leave Port City without its size: refused, nothing saved.
    const ladder = page.getByTestId("settlement-ladder-form");
    await ladder.getByLabel("Settlement ladder").selectOption("simple");
    await ladder.getByRole("button", { name: "Save sizes" }).click();
    await ladder.getByText(/place uses a tier this ladder doesn't have/).waitFor();
    books = await snapshot(page);
    assert.equal(books.settlements.ladder, undefined);

    // S2: the sale cap (Refuse) and a Metropolis's rarest generated stock, saved by one command;
    // the result is read from the moment of the click, not after a settled state.
    const limits = page.getByTestId("settlement-limits-form");
    await limits.getByLabel("Per-item sale cap").selectOption("refuse");
    await limits.getByLabel("Rarest generated stock in a Metropolis").selectOption("uncommon");
    await limits.getByRole("button", { name: "Save limits" }).click();
    await limits.getByText("Settlement limits saved.").waitFor();
    books = await snapshot(page);
    assert.deepEqual(books.settlements.limits, { sale: "refuse", maxRarity: { metropolis: "uncommon" } });
    assert.deepEqual(books.events.at(-1)?.summary, "Settlement limits saved: sale cap refuse pricier items; rarity cap on");
    assert.deepEqual(books.shops, [tavern], `${width}: limits never change an existing shop`);
    assert.equal(await sideways(page), false, `${width}: the limits form scrolls sideways`);
    await limits.screenshot({ path: `test-results/settlement-tiers/limits-${width}.png` });
    // A player's quote (the pricing every player path charges) is refused with the limit named.
    const playerQuote = await page.evaluate(async () => {
      const { shopSale } = await import("/src/lib/quire/sale-split.ts");
      const { economySnapshot } = await import("/src/lib/quire/economy.ts");
      const t = await economySnapshot();
      return shopSale(t.holdings.find((h) => h.id === "crown"), t.shops.find((s) => s.id === "tavern"), 1, t.journal, t.purses, "player").refused;
    });
    assert.equal(playerQuote, "Shops in Port City pay at most 16,000 gp for one item; this one would fetch 20,000 gp, so this shop won't buy it.");
    // The DM is exempt (owner decision 2026-11-10): the sell form warns, then sells at the full payout.
    await openApplication(page, origin + "/shop/tavern?sell=crown");
    const sellForm = page.locator("form#sell");
    await sellForm.waitFor();
    await sellForm
      .getByTestId("settlement-sale-dm-warning")
      .getByText("Over Port City's limit of 16,000 gp for one item; players would be refused. You're the DM, so this sale goes through at 20,000 gp each.")
      .waitFor();
    assert.equal(await sellForm.getByTestId("settlement-sale-refused").count(), 0, `${width}: the DM is not refused`);
    assert.equal(await sideways(page), false, `${width}: the sell form scrolls sideways`);
    await sellForm.screenshot({ path: `test-results/settlement-tiers/dm-warning-${width}.png` });
    await sellForm.getByRole("button", { name: "Sell", exact: true }).click();
    // Read from the action's own toast: the crown is the DM's only item, so once it sells the
    // sell form gives way to "This account has nothing this shop will buy." and its notice goes too.
    await page.getByText("Sale recorded.").first().waitFor();
    books = await snapshot(page);
    assert.equal(books.crowns, 0, `${width}: the crown was sold`);
    assert.deepEqual(books.sales, [2_000_000], `${width}: one sale at the full 20,000 gp`);
    assert.equal(books.shops[0].merchantPurse, tavern.merchantPurse - 2_000_000, `${width}: the shop's purse paid it`);

    // The party's place cards show the size; the Docks' card is the area, Port City's carries it.
    await openApplication(page, origin + "/market");
    await page.getByTestId("settlement-tier").filter({ hasText: "Metropolis · about 25,000" }).first().waitFor();

    // Create a shop at the Docks starts Princely, with the defaults' source named.
    await page.getByRole("button", { name: /Create a shop/ }).click();
    const note = page.getByTestId("settlement-shop-defaults");
    await note.getByText(/Port City · Metropolis: new shops here start at\s+Princely wealth, with a merchant purse of/).waitFor();
    // S2: generated stock at the Docks stops at Uncommon; Rare and Magic can't be ticked.
    await page.getByTestId("settlement-rarity-cap").getByText(/Port City · Metropolis: generated stock here goes up to\s+uncommon/).waitFor();
    for (const label of ["Rare", "Magic"])
      assert.equal(await page.getByRole("checkbox", { name: label, exact: true }).isDisabled(), true, `${width}: ${label} is above the cap`);
    assert.equal(await sideways(page), false, `${width}: the shop composer scrolls sideways`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Settlement tiers browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
