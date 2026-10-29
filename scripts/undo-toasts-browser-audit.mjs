// Result toasts with View receipt and Undo (design plan D9 / dm #15) in a disposable device
// campaign seeded with the synthetic "Wayfarers" fixture, as the DM:
// - Buy at a shop: the toast offers View receipt (a receipt dialog with the purchase line and a
//   link to the item) and Undo, which runs the existing ledger void once: coins and stock come
//   back exactly;
// - Sell: View receipt, no Undo (a shop sale has no reversal command);
// - Give (one entry) and Add loot: View receipt, no Undo;
// - an inline rename shows a "Saved" tick.
// Runs at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { continueIntoApp, openApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";
import { buildWayfarers } from "./product-screenshot-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("The undo toast audit changes a disposable campaign; run it only locally.");
const out = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/undo-toasts`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const table = buildWayfarers();
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const { toCopper } = await import("/src/lib/quire/money.ts");
    const t = await economySnapshot();
    return {
      mira: toCopper(t.purses.find((p) => p.id === "mira").coins),
      rope: t.stock.find((s) => s.id === "lantern-rope").quantity,
      ledger: t.ledger.length,
      ropes: t.holdings.filter((h) => h.purseId === "mira" && h.name === "Hempen rope (50 ft)").reduce((n, h) => n + h.quantity, 0),
    };
  });
const toast = (page, text) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
const noOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
    `${label}: the page scrolls sideways`,
  );
const rowFor = (page, name) =>
  page.getByRole("region", { name: "Shop inventory", exact: true }).locator("li").filter({ hasText: name });

try {
  for (const width of [1280, 390, 320]) {
    const height = width === 1280 ? 900 : width === 390 ? 844 : 700;
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: width < 600,
      hasTouch: width < 600,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/", { waitUntil: "networkidle" });
    await page.evaluate(async (t) => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      await applyCloudTable(t);
    }, table);

    // --- Buy: View receipt.
    await page.goto(origin + "/shop/lantern");
    await continueIntoApp(page);
    await chooseOption(page.getByLabel("Paying from", { exact: true }), "mira");
    const start = await books(page);
    await rowFor(page, "Hempen rope").getByRole("button", { name: /^Buy / }).click();
    let bought = toast(page, "Purchase recorded.");
    await expect(bought.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    await expect(bought.getByRole("button", { name: "View receipt", exact: true })).toBeVisible();
    await noOverflow(page, `buy toast ${width}`);
    await page.screenshot({ path: `${out}/buy-toast-${width}.png` });
    await bought.getByRole("button", { name: "View receipt", exact: true }).click();
    const receipt = page.getByRole("dialog", { name: "Purchase receipt", exact: true });
    await expect(receipt).toContainText("Bought 1 Hempen rope (50 ft) from The Brass Lantern");
    await expect(receipt.getByRole("link", { name: "Show in inventory", exact: true })).toBeVisible();
    await noOverflow(page, `receipt ${width}`);
    await page.screenshot({ path: `${out}/receipt-${width}.png` });
    await receipt.getByRole("button", { name: "Close receipt", exact: true }).click();
    await expect(receipt).toHaveCount(0);
    const once = await books(page);
    assert.deepEqual(
      [once.mira, once.rope, once.ropes],
      [start.mira - 100, start.rope - 1, start.ropes + 1],
      "the purchase is charged once",
    );

    // --- Buy again, then Undo: the existing ledger void restores coins, stock and items once.
    await page.locator("[data-sonner-toast]").evaluateAll((all) => all.forEach((t) => t.remove()));
    await rowFor(page, "Hempen rope").getByRole("button", { name: /^Buy / }).click();
    bought = toast(page, "Purchase recorded.");
    // Rest the pointer on the toast so its 10 s Undo window pauses (as it does for a player
    // reading it) while the ledger check runs; slow runners took longer than 10 s here.
    await bought.hover();
    await expect.poll(async () => (await books(page)).rope).toBe(start.rope - 2);
    await bought.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toast(page, "Purchase undone.")).toBeVisible();
    await expect.poll(async () => (await books(page)).rope).toBe(start.rope - 1);
    const undone = await books(page);
    assert.deepEqual(
      [undone.mira, undone.ropes],
      [start.mira - 100, start.ropes + 1],
      "Undo restores the coins and items of the second purchase only",
    );
    assert.equal(undone.ledger, once.ledger + 2, "the purchase and its void are both recorded");

    // --- Sell: View receipt, no Undo.
    const sell = page.locator("form#sell");
    await sell.scrollIntoViewIfNeeded();
    await sell.getByRole("button", { name: /^Sell/ }).click();
    const sold = toast(page, "Sale recorded.");
    await expect(sold.getByRole("button", { name: "View receipt", exact: true })).toBeVisible();
    await expect(sold.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
    await sold.getByRole("button", { name: "View receipt", exact: true }).click();
    const saleReceipt = page.getByRole("dialog", { name: "Sale receipt", exact: true });
    await expect(saleReceipt).toContainText(/Sold \d+ .+ to The Brass Lantern/);
    await saleReceipt.getByRole("button", { name: "Close receipt", exact: true }).click();

    // --- Party: an inline rename shows a Saved tick.
    await page.goto(origin + "/party?section=funds");
    await continueIntoApp(page);
    await page.locator("#purse-mira > summary").click();
    const nameField = page.locator("#purse-mira").getByLabel("Funds name", { exact: true });
    await nameField.fill("Mira Ashfall the Bold");
    await nameField.press("Tab");
    await expect(page.locator("#purse-mira .saved-tick")).toHaveText(/Name saved/);

    // --- Give one entry: View receipt with both legs, no Undo.
    await page.locator("[data-sonner-toast]").evaluateAll((all) => all.forEach((t) => t.remove()));
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByLabel("Select Dwarven ale (Bram Stoneward)", { exact: true }).check();
    await page.getByRole("region", { name: "Selected items" }).getByRole("button", { name: "Give", exact: true }).click();
    const give = page.getByRole("dialog", { name: "Give selected items", exact: true });
    await give.getByLabel("Give selected items to", { exact: true }).selectOption("tamsin");
    await give.getByRole("button", { name: "Give 1 entry", exact: true }).click();
    const gave = toast(page, "Transfer recorded and added to party messages.");
    await expect(gave.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
    await gave.getByRole("button", { name: "View receipt", exact: true }).click();
    const transfer = page.getByRole("dialog", { name: "Transfer receipt", exact: true });
    await expect(transfer).toContainText("Transfer sent");
    await expect(transfer).toContainText("Transfer received");
    await expect(transfer).toContainText("Dwarven ale");
    await transfer.getByRole("button", { name: "Close receipt", exact: true }).click();

    // --- Add loot: View receipt opens the new item, and its link shows it in the inventory.
    await page.getByRole("button", { name: "+ Add loot" }).first().click();
    await page.getByRole("textbox", { name: "Holding name", exact: true }).fill(`Audit ruby ${width}`);
    await page.getByRole("textbox", { name: "Holding value", exact: true }).fill("12 gp");
    await page.getByRole("button", { name: "Add loot", exact: true }).click();
    const added = toast(page, "Holding added.");
    await added.getByRole("button", { name: "View receipt", exact: true }).click();
    const loot = page.getByRole("dialog", { name: "Loot added", exact: true });
    await expect(loot).toContainText(`Audit ruby ${width} ×1`);
    await loot.getByRole("link", { name: "Show in inventory", exact: true }).click();
    await page.waitForURL((u) => u.hash.startsWith("#holding-"));
    await expect(page.locator(`[id="${new URL(page.url()).hash.slice(1)}"]`)).toBeVisible();
    await noOverflow(page, `party ${width}`);

    assert.deepEqual(errors, [], `no page errors at ${width}`);
    await context.close();
    console.log(`undo-toasts ${width}: ok`);
  }
} finally {
  await browser.close();
}
