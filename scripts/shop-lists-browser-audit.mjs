// Alternative shop lists (owner request 2026-11-10) in a disposable device campaign: the DM creates
// "Winter goods" in Market → Shop lists, saves the smithy's stock as a list from its Edit mode, and
// swaps Harbor General's stock to Winter goods. The confirmation names the replaced stock and the
// name it is saved under; afterwards the shop sells the list's items, the old stock is a list in the
// library, coins and the merchant purse are untouched, and the history lines are DM-only. A player
// then sees the new stock and no shop lists. Each result is awaited from the click that causes it.
// No sideways scrolling at 1280 and 390 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):/, "Shop list fixtures require a disposable server");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/shop-lists", { recursive: true });
const base = { keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", priceScale: 1 };
const general = { ...base, id: "general", name: "Harbor General", category: "general", merchantPurse: 5000, merchantPurseRefill: 8000 };
const smithy = { ...base, id: "smithy", name: "Anvil and Tongs", category: "smith" };
const line = (id, shopId, name, copper, quantity) => ({ id, shopId, name, copper, baseCopper: copper, quantity, notes: "", rarity: "common" });
const snapshot = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return {
      lists: t.journal?.shopLists?.lists ?? [],
      active: t.journal?.shopLists?.active ?? {},
      stock: t.stock.map((l) => [l.shopId, l.name, l.copper, l.quantity]).sort(),
      shops: t.shops,
      purses: t.purses.map((p) => [p.id, p.coins]),
      events: (t.journal?.events ?? []).filter((e) => /Shop list|stock swapped/.test(e.summary)).map((e) => [e.summary, e.dmOnly === true]),
    };
  });
const seat = (page, role) =>
  page.evaluate(async (role) => {
    const { DM_SEAT, setSeat } = await import("/src/lib/quire/table.ts");
    setSeat(role === "dm" ? DM_SEAT : { ...DM_SEAT, role: "player", purseIds: ["aria"], shopIds: ["general", "smithy"] });
  }, role);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 }, serviceWorkers: "block" });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(25000);
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/market");
    await page.evaluate(
      async ({ general, smithy, stock }) => {
        const { applyCloudTable, blankPurse } = await import("/src/lib/quire/economy.ts");
        const { readJournal } = await import("/src/lib/quire/journal.ts");
        const { DM_SEAT, setSeat } = await import("/src/lib/quire/table.ts");
        setSeat(DM_SEAT);
        await applyCloudTable({
          purses: [{ ...blankPurse("character"), id: "aria", name: "Aria Thorne" }],
          holdings: [],
          shops: [general, smithy],
          stock,
          ledger: [], listings: [], loans: [], sheets: [], notes: [],
          journal: readJournal({ finance: { day: 1 } }),
        });
      },
      {
        general,
        smithy,
        stock: [
          line("rope", "general", "Hempen rope", 100, 6),
          line("torch", "general", "Torch", 1, null),
          line("sword", "smithy", "Longsword", 1500, 3),
        ],
      },
    );
    const start = await snapshot(page);

    // 1. Create a list in Market → Shop lists.
    await openApplication(page, origin + "/market");
    await page.getByRole("button", { name: /^Shop lists/ }).click();
    const panel = page.getByTestId("shop-lists-panel");
    await panel.getByRole("button", { name: "New shop list" }).click();
    const editor = panel.getByTestId("shop-list-editor");
    await editor.getByLabel("List name").fill("Winter goods");
    await editor.getByLabel("Item 1 name").fill("Fur cloak");
    await editor.getByLabel("Item 1 price").fill("8 gp");
    await editor.getByLabel("Item 1 quantity").fill("4");
    await editor.getByRole("button", { name: "Add item" }).click();
    await editor.getByLabel("Item 2 name").fill("Snowshoes");
    await editor.getByLabel("Item 2 price").fill("25 sp");
    await editor.getByLabel("Item 2 quantity").fill("6");
    assert.equal(await sideways(page), false, `${width}: the list editor scrolls sideways`);
    await editor.screenshot({ path: `test-results/shop-lists/editor-${width}.png` });
    await editor.getByRole("button", { name: "Create list" }).click();
    await panel.getByTestId("shop-list").filter({ hasText: "Winter goods" }).waitFor();
    let books = await snapshot(page);
    assert.deepEqual(books.lists.map((l) => [l.name, l.items.map((i) => [i.name, i.copper, i.quantity])]), [
      ["Winter goods", [["Fur cloak", 800, 4], ["Snowshoes", 250, 6]]],
    ]);

    // 2. Save the smithy's stock as a list; the smithy is unchanged.
    await openApplication(page, origin + "/shop/smithy");
    await page.getByRole("group", { name: "Shop mode" }).getByRole("button", { name: "Edit" }).click();
    const smithyLists = page.getByTestId("shop-stock-lists");
    await smithyLists.getByLabel("New list name").fill("Smithy basics");
    await smithyLists.getByRole("button", { name: "Save stock as list" }).click();
    await smithyLists.getByText("Stock saved as Smithy basics.").waitFor();
    books = await snapshot(page);
    assert.deepEqual(books.lists.find((l) => l.name === "Smithy basics")?.items.map((i) => [i.name, i.copper, i.quantity]), [["Longsword", 1500, 3]]);
    assert.deepEqual(books.stock, start.stock, `${width}: saving a list changes no stock`);

    // 3. Swap Harbor General to Winter goods; the confirmation names what is replaced and saved.
    await openApplication(page, origin + "/shop/general");
    await page.getByRole("group", { name: "Shop mode" }).getByRole("button", { name: "Edit" }).click();
    const lists = page.getByTestId("shop-stock-lists");
    await lists.getByText("No shop list swapped in yet.").waitFor();
    await lists.getByLabel("Swap stock to").selectOption({ label: "Winter goods · 2 items" });
    await lists.getByRole("button", { name: "Swap stock" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Swap Harbor General's stock to Winter goods?" });
    const body = await dialog.getByTestId("shop-swap-confirm").innerText();
    assert.match(body, /Replaces the current 2 stock lines \(Hempen rope, Torch\) with the 2 items of Winter goods/);
    const saved = /will be saved as "(Harbor General stock before Winter goods, [^"]+)"/.exec(body)?.[1];
    assert.ok(saved, `${width}: the confirmation names the saved list: ${body}`);
    assert.equal(await sideways(page), false, `${width}: the confirmation scrolls sideways`);
    await dialog.screenshot({ path: `test-results/shop-lists/confirm-${width}.png` });
    await dialog.getByRole("button", { name: "Swap stock" }).click();
    await lists.getByText(`Stock swapped to Winter goods; the previous stock is saved as ${saved}.`).waitFor();
    await lists.getByText("Stock last swapped to Winter goods.").waitFor();
    books = await snapshot(page);
    assert.deepEqual(books.stock, [
      ["general", "Fur cloak", 800, 4],
      ["general", "Snowshoes", 250, 6],
      ["smithy", "Longsword", 1500, 3],
    ]);
    assert.deepEqual(books.lists.find((l) => l.name === saved)?.items.map((i) => [i.name, i.copper, i.quantity]), [["Hempen rope", 100, 6], ["Torch", 1, null]]);
    assert.equal(books.active.general, books.lists.find((l) => l.name === "Winter goods").id);
    assert.deepEqual(books.shops, start.shops, `${width}: merchant purse, refill and buy list unchanged`);
    assert.deepEqual(books.purses, start.purses, `${width}: no coins move`);
    assert.ok(books.events.length === 3 && books.events.every(([, dmOnly]) => dmOnly), `${width}: one DM-only line per change`);
    assert.equal(await sideways(page), false, `${width}: the shop editor scrolls sideways`);
    await lists.screenshot({ path: `test-results/shop-lists/shop-${width}.png` });

    // 4. A player sees the new stock and nothing of the library.
    await seat(page, "player");
    await openApplication(page, origin + "/shop/general");
    await page.getByText("Fur cloak").first().waitFor();
    const text = await page.locator("main").innerText();
    assert.ok(!text.includes("Hempen rope"), `${width}: the old stock is gone for players`);
    assert.ok(!/Winter goods|Shop lists|Swap stock/.test(text), `${width}: players see no shop lists`);
    const projected = await page.evaluate(async () => {
      const { economySnapshot } = await import("/src/lib/quire/economy.ts");
      const { projectRecord } = await import("/src/lib/quire/session-records.ts");
      return projectRecord(await economySnapshot(), { role: "player", purseIds: ["aria"] }).journal;
    });
    assert.equal("shopLists" in projected, false, `${width}: the player projection carries the library`);
    await openApplication(page, origin + "/market");
    await page.getByText("Harbor General").first().waitFor();
    assert.equal(await page.getByRole("button", { name: /^Shop lists/ }).count(), 0, `${width}: players have no Shop lists panel`);
    assert.equal(await sideways(page), false, `${width}: the player's market scrolls sideways`);
    await seat(page, "dm");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Shop lists browser audit passed at 1280 and 390 px.");
} finally {
  await browser.close();
}
