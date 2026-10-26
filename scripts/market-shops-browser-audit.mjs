// Market and shop counter (design plan D6, P7; DM QoL 3 and 14; player QoL 6 and 12) in a
// disposable device campaign at 1280, 390 and 320 px: Market opens with "Shops here" above the
// trade exchange tile (collapsed, remembered per device) and the People & NPCs links; the shop
// header comes first; a sticky "Paying from" bar remembers the last purse per shop; only the
// edited row shows its cost/afterward sentence; DM "Sell to" mode buys exactly once per tap
// (double tap and a reload mid-way); modern "$" prices are on for a fresh DM seat, off for a
// fresh player seat and kept when chosen; Edit renders below its toggle with one Save bar; a
// player's first Buy button is on the first screen at 390×844. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect as baseExpect } from "playwright/test";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";

// Shared CI runners and busy sandboxes can take a while to open a campaign.
const expect = baseExpect.configure({ timeout: 20000 });
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/market-shops`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const noOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
    `${label}: the page scrolls sideways`,
  );
const top = async (locator) => (await locator.boundingBox()).y;

async function rows(page, store) {
  return page.evaluate(async (store) => {
    const active = localStorage.getItem("quire.campaign.v1");
    const name =
      JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((row) => row.id === active)
        ?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, store);
}
const copper = (c) => c.cp + 10 * c.sp + 50 * c.ep + 100 * c.gp + 1000 * c.pp;
/** Purchases of one stock line by one purse: stock fell by exactly the units each was charged. */
async function purchases(page, purseId, name) {
  const [purses, ledger, stock] = await Promise.all(
    ["purses", "ledger", "stock"].map((store) => rows(page, store)),
  );
  return {
    coins: copper(purses.find((p) => p.id === purseId).coins),
    lines: ledger.filter((l) => l.purseId === purseId && l.shopId === "lantern" && l.summary.includes(name))
      .length,
    left: stock.find((s) => s.shopId === "lantern" && s.name.startsWith(name)).quantity,
  };
}

async function seed(page) {
  await page.evaluate(async () => {
    const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
    const { readJournal } = await import("/src/lib/quire/journal.ts");
    const coins = (gp = 0) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
    const goods = [
      ["Rope, hempen (50 ft)", 100, 20],
      ["Lantern, hooded", 500, 6],
      ["Bedroll", 100, 9],
      ["Torch", 1, null],
      ["Rations (1 day)", 50, 30],
      ["Waterskin", 20, 12],
      ["Tinderbox", 50, 5],
      ["Crowbar", 200, 3],
      ["Chalk (1 piece)", 1, 40],
      ["Oil (flask)", 10, 15],
    ];
    const shop = (id, name, extra = {}) => ({
      id,
      name,
      keeper: "Odile Marsh",
      place: "Dock Ward",
      notes: "",
      sellRate: 1,
      buyRate: 0.5,
      wealth: "modest",
      category: "general",
      priceScale: 1,
      ...extra,
    });
    await applyCloudTable({
      purses: [
        { id: "hoard", name: "The Hoard", kind: "party", coins: coins(500) },
        { id: "mira", name: "Mira Ashfall", kind: "character", coins: coins(178) },
        { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins(50) },
      ],
      holdings: [],
      shops: [shop("lantern", "The Brass Lantern"), shop("forge", "Cinder Forge", { category: "smith" })],
      stock: goods.map(([name, copper, quantity], i) => ({
        id: `good-${i}`,
        shopId: "lantern",
        name,
        copper,
        quantity,
        notes: "",
        baseCopper: copper,
        rarity: "common",
      })),
      ledger: [],
      listings: [],
      loans: [],
      sheets: [],
      notes: [],
      journal: readJournal({}),
    });
  });
}
const rowFor = (page, name) =>
  page.getByRole("region", { name: "Shop inventory", exact: true }).locator("li").filter({ hasText: name });

try {
  for (const width of [1280, 390, 320]) {
    const height = width === 390 ? 844 : width === 320 ? 640 : 900;
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => void d.accept());
    await openApplication(page, origin + "/market");
    await seed(page);
    await reloadApplication(page);

    // Market: Shops here first, the exchange a collapsed summary, then the people links.
    const shopsHere = page.getByRole("heading", { name: "Shops here", exact: true });
    const exchange = page.getByRole("region", { name: "Trade exchange", exact: true });
    await expect(exchange).toContainText(/Trade exchange · \d+ goods?/);
    const people = page.locator("#main").getByRole("link", { name: "People & NPCs →", exact: true });
    assert.ok((await top(shopsHere)) < (await top(exchange)), "Shops here comes before the exchange");
    assert.ok((await top(exchange)) < (await top(people)), "The exchange tile comes before People & NPCs");
    const card = page.locator(".shop-tile").filter({ hasText: "The Brass Lantern" });
    for (const name of ["Edit", "Restock", "Close"])
      await expect(card.getByRole(name === "Edit" ? "link" : "button", { name, exact: true })).toBeVisible();
    const board = exchange.locator("details");
    assert.equal(await board.evaluate((d) => d.open), false, "The full board starts collapsed");
    await board.locator("summary").click();
    await expect(page.locator("#global-market")).toBeVisible();
    await reloadApplication(page);
    await expect(page.locator("#global-market")).toBeVisible();
    await page.getByRole("region", { name: "Trade exchange", exact: true }).locator("summary").click();
    await expect(page.locator("#global-market")).toHaveCount(0);
    await noOverflow(page, `market ${width}`);
    await page.screenshot({ path: `${output}/market-dm-${width}.png`, fullPage: true });

    // DM shop: header, then Counter/Edit; $ on for a fresh DM seat, labelled as modern.
    await card.getByRole("link", { name: "Edit", exact: true }).click();
    const title = page.getByRole("heading", { name: "The Brass Lantern", exact: true });
    const modeGroup = page.getByRole("group", { name: "Shop mode", exact: true });
    assert.ok((await top(title)) < (await top(modeGroup)), "The shop name comes before the tabs");
    await expect(page.getByRole("switch", { name: "Open for trading", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(rowFor(page, "Crowbar")).toContainText(/≈ \$[\d,]+ modern/);

    // Only the edited row explains its cost.
    const inventory = page.getByRole("region", { name: "Shop inventory", exact: true });
    await expect(inventory.getByText(/afterward/)).toHaveCount(0);
    await rowFor(page, "Crowbar").getByLabel("Quantity of Crowbar", { exact: true }).focus();
    await expect(inventory.getByText(/afterward/)).toHaveCount(1);
    await expect(rowFor(page, "Crowbar")).toContainText("afterward");
    await rowFor(page, "Bedroll").getByLabel("Quantity of Bedroll", { exact: true }).fill("2");
    await expect(inventory.getByText(/afterward/)).toHaveCount(1);
    await expect(rowFor(page, "Bedroll")).toContainText("2 × 1 gp = 2 gp");

    // Sell to Mira: the buyer once, then one tap per item, exactly once each.
    await page.getByLabel("Sell to a character", { exact: true }).check();
    await chooseOption(page.getByLabel("Sell to", { exact: true }), "mira");
    const start = await purchases(page, "mira", "Rope");
    const sellRope = rowFor(page, "Rope").getByRole("button", { name: /^Sell 1 · / });
    await sellRope.dblclick();
    await expect.poll(async () => (await purchases(page, "mira", "Rope")).lines).toBe(1);
    await page.waitForTimeout(800);
    let now = await purchases(page, "mira", "Rope");
    assert.deepEqual(now, { coins: start.coins - 100, lines: 1, left: start.left - 1 }, "a double tap buys once");
    await expect(rowFor(page, "Rope")).toContainText("Sold 1 to Mira Ashfall");
    // A reload while the next tap is in flight: whatever landed was charged exactly once.
    await sellRope.click();
    await reloadApplication(page);
    now = await purchases(page, "mira", "Rope");
    assert.ok(now.lines === 1 || now.lines === 2, `one tap is at most one purchase (${now.lines})`);
    assert.equal(now.coins, start.coins - 100 * now.lines, "each purchase is charged once");
    assert.equal(now.left, start.left - now.lines, "each purchase takes one unit");

    // The last purse is remembered for this shop after the reload.
    await expect(page.getByLabel("Paying from", { exact: true })).toHaveAttribute("data-value", "mira");
    await noOverflow(page, `shop counter ${width}`);
    for (const tile of await page.locator(".shop-total").all()) {
      const box = await tile.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1, "inventory totals are not clipped");
    }
    await page.screenshot({ path: `${output}/shop-dm-counter-${width}.png`, fullPage: true });

    // Edit: below its own toggle, one Save bar for every drafted part.
    await modeGroup.getByRole("button", { name: "Edit", exact: true }).click();
    const nameField = page.getByLabel("Shop name", { exact: true });
    assert.ok((await top(modeGroup)) < (await top(nameField)), "The edit form renders below its toggle");
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Save shop location|Save black-market/ })).toHaveCount(0);
    await nameField.fill(`The Brass Lantern ${width}`);
    await page.getByLabel("Shopkeeper", { exact: true }).fill("Odile Marsh the Younger");
    await page.getByRole("button", { name: "Black-market vendor rules" }).click();
    await page.getByLabel("Price premium multiplier", { exact: true }).fill("2");
    const bar = page.getByRole("group", { name: "Save shop changes", exact: true });
    await expect(bar).toContainText("Unsaved: Shop details, Black-market rules");
    assert.equal(await bar.evaluate((el) => getComputedStyle(el).position), "sticky");
    await bar.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(bar.getByRole("status")).toContainText("Shop details: Saved.");
    await expect(bar.getByRole("status")).toContainText("Black-market rules:");
    await expect(bar).toContainText("All changes saved");
    const saved = (await rows(page, "shops")).find((s) => s.id === "lantern");
    assert.equal(saved.name, `The Brass Lantern ${width}`);
    assert.equal(saved.keeper, "Odile Marsh the Younger");
    assert.equal(saved.blackMarketPremium, 2);
    await noOverflow(page, `shop edit ${width}`);
    await page.screenshot({ path: `${output}/shop-dm-edit-${width}.png`, fullPage: true });
    // Restore the name so the player steps read the same shop.
    await nameField.fill("The Brass Lantern");
    await bar.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect
      .poll(async () => (await rows(page, "shops")).find((s) => s.id === "lantern").name)
      .toBe("The Brass Lantern");
    await expect(bar).toContainText("All changes saved");

    // A player seat on the same device: $ off by default, Visit, first Buy on the first screen.
    await page.evaluate(async () => {
      const t = await import("/src/lib/quire/table.ts");
      t.setSeat({ role: "player", purseIds: ["mira"], shopIds: ["lantern", "forge"], openedAt: Date.now() });
    });
    await reloadApplication(page);
    await page.locator(".shop-header-back").click();
    await expect(page.getByRole("heading", { name: "Shops here", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Visit The Brass Lantern", exact: true }).click();
    await expect(page.getByRole("heading", { name: "The Brass Lantern", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Shop inventory", exact: true })).not.toContainText("$");
    await expect(page.getByText(/Not on a map yet|Not placed|No map location/)).toHaveCount(0);
    if (width === 390) {
      const buy = page.getByRole("button", { name: /^Buy / }).first();
      const box = await buy.boundingBox();
      const nav = await page.getByRole("navigation", { name: "Sections" }).last().boundingBox();
      assert.ok(box.y + box.height <= Math.min(height, nav.y), `first Buy is on the first screen (${box.y})`);
    }
    // The Paying from bar stays visible while scrolling.
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(300);
    const pay = await page.locator(".shop-paybar").boundingBox();
    assert.ok(pay.y >= 0 && pay.y < height / 3, `Paying from stays on screen (${pay.y})`);
    await expect(page.locator(".shop-paybar")).toContainText("Mira Ashfall");
    await expect(page.getByLabel("Sell to a character")).toHaveCount(0);
    const before = await purchases(page, "mira", "Waterskin");
    await rowFor(page, "Waterskin").getByLabel("Quantity of Waterskin", { exact: true }).focus();
    await expect(rowFor(page, "Waterskin")).toContainText("afterward");
    await rowFor(page, "Waterskin").getByRole("button", { name: /^Buy / }).click();
    await expect.poll(async () => (await purchases(page, "mira", "Waterskin")).lines).toBe(before.lines + 1);
    await noOverflow(page, `player shop ${width}`);
    await page.screenshot({ path: `${output}/shop-player-${width}.png`, fullPage: false });
    // An explicit choice on this device is respected for the player seat.
    await page.evaluate(() => {
      const prefs = JSON.parse(localStorage.getItem("quire.prefs.v1") || "{}");
      localStorage.setItem("quire.prefs.v1", JSON.stringify({ ...prefs, showDollars: true, dollarsChosen: true }));
    });
    await reloadApplication(page);
    await expect(rowFor(page, "Crowbar")).toContainText(/≈ \$[\d,]+ modern/);

    assert.deepEqual(errors, [], `no page errors at ${width}`);
    await context.close();
    console.log(`market-shops ${width}: ok`);
  }
} finally {
  await browser.close();
}
