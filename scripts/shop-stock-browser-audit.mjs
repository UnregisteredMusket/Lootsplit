import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(
  origin,
  /^http:\/\/(127\.0\.0\.1|localhost):/,
  "Shop fixtures require a disposable local server",
);
const output = process.env.SHOP_SCREENSHOTS || "test-results/shop-stock";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const errors = [];
let lastPage;

async function readRows(page, store) {
  return page.evaluate(async (store) => {
    const active = localStorage.getItem("quire.campaign.v1");
    const name =
      JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find(
        (row) => row.id === active,
      )?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  }, store);
}

async function waitStock(page, test) {
  const deadline = Date.now() + 10000;
  while (true) {
    const rows = await readRows(page, "stock");
    if (test(rows)) return rows;
    if (Date.now() > deadline) throw new Error("Expected saved stock did not become ready");
    await page.waitForTimeout(50);
  }
}

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      serviceWorkers: "block",
    });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === origin || ["data:", "blob:"].includes(url.protocol)
        ? route.continue()
        : route.abort();
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    lastPage = page;
    page.on("pageerror", (error) => errors.push(error.message));
    await openApplication(page, origin + "/market");
    await page.getByRole("button", { name: /^Create a shop/ }).click();
    await page.getByRole("heading", { name: "Create a shop", exact: true }).waitFor();
    await page.evaluate(async () => {
      const active = localStorage.getItem("quire.campaign.v1");
      const name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find(
          (row) => row.id === active,
        )?.db || "quire";
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["catalog", "purses", "holdings"], "readwrite");
        for (let i = 0; i < 80; i++)
          tx.objectStore("catalog").put({
            id: `audit-${i}`,
            name: `Audit good ${String(i).padStart(3, "0")}`,
            category: "general",
            rarity: "common",
            baseCopper: 100,
            notes: "Synthetic shop audit item",
            origin: "hand",
            service: false,
          });
        tx.objectStore("purses").put({
          id: "audit-buyer",
          name: "Audit shared funds",
          kind: "party",
          coins: { cp: 0, sp: 0, ep: 0, gp: 10000, pp: 0 },
        });
        // A same-name personal lot must survive buying differently valued stock.
        tx.objectStore("holdings").put({
          id: "audit-personal-lot", purseId: "audit-buyer", name: "Audit good 000",
          kind: "item", quantity: 100, unitCopper: 1,
          notes: "Existing personal equipment", equipped: true,
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await reloadApplication(page);
    await page.getByRole("button", { name: /^Create a shop/ }).click();
    const expected = (await readRows(page, "catalog")).filter(
      (row) => row.category === "general" && ["common", "uncommon"].includes(row.rarity),
    ).length;
    await page.getByLabel("Shop", { exact: true }).fill(`Audit Trading Hall ${width}`);
    await page.getByLabel("Item variety", { exact: true }).selectOption("count");
    await page.getByLabel("Number of item types", { exact: true }).fill("60");
    await page.getByRole("heading", { name: "Stock · 60", exact: true }).waitFor();
    await page.getByLabel("Stock quantities", { exact: true }).selectOption("fixed");
    await page.getByLabel("Units per item", { exact: true }).fill("3");
    await page.getByRole("heading", { name: "Stock · 60", exact: true }).waitFor();
    await page.getByLabel("Item variety", { exact: true }).selectOption("all");
    await page.getByRole("heading", { name: `Stock · ${expected}`, exact: true }).waitFor();
    await page.getByRole("button", { name: "Open this shop", exact: true }).click();
    await page.getByRole("heading", { name: `Audit Trading Hall ${width}`, exact: true }).waitFor();
    const shopId = new URL(page.url()).pathname.split("/").at(-1);
    let rows = await waitStock(
      page,
      (rows) => rows.filter((row) => row.shopId === shopId).length === expected,
    );
    assert.equal(rows.filter((row) => row.shopId === shopId).length, expected);
    assert.ok(rows.filter((row) => row.shopId === shopId).every((row) => row.quantity === 3));
    await page.getByLabel("Paying from", { exact: false }).selectOption("audit-buyer");
    const inventory = page.getByRole("region", { name: "Shop inventory", exact: true });
    await inventory.getByLabel("Search shop inventory", { exact: true }).fill("Audit good 000");
    const beforePrice = rows.find(
      (row) => row.shopId === shopId && row.name === "Audit good 000",
    ).copper;
    await inventory.getByRole("button", { name: /^Buy / }).click();
    await waitStock(page, (rows) =>
      rows.some(
        (row) => row.shopId === shopId && row.name === "Audit good 000" && row.quantity === 2,
      ),
    );
    const buyer = (await readRows(page, "purses")).find((row) => row.id === "audit-buyer");
    assert.equal(
      buyer.coins.cp +
        10 * buyer.coins.sp +
        50 * buyer.coins.ep +
        100 * buyer.coins.gp +
        1000 * buyer.coins.pp,
      1000000 - beforePrice,
    );
    assert.equal((await readRows(page, "ledger")).filter((row) => row.shopId === shopId).length, 1);
    const lots = (await readRows(page, "holdings")).filter(
      (row) => row.purseId === "audit-buyer" && row.name === "Audit good 000",
    );
    assert.equal(lots.length, 2, "Purchasing must retain separate same-name lots");
    const personal = lots.find((row) => row.id === "audit-personal-lot");
    assert.equal(personal.quantity, 100);
    assert.equal(personal.unitCopper, 1);
    assert.equal(personal.notes, "Existing personal equipment");
    assert.equal(personal.equipped, true);
    assert.equal(lots.find((row) => row.id !== personal.id).quantity, 1);
    await page.getByRole("tab", { name: "Edit", exact: true }).click();
    const row = inventory.locator("li").first();
    await row.getByLabel("Price", { exact: true }).fill("17 cp");
    await row.getByLabel("Price", { exact: true }).press("Tab");
    await waitStock(page, (rows) =>
      rows.some(
        (row) => row.shopId === shopId && row.name === "Audit good 000" && row.copper === 17,
      ),
    );
    await inventory.getByLabel("Search shop inventory", { exact: true }).fill("");
    assert.equal(await inventory.locator("li").count(), 25);
    await inventory
      .getByRole("navigation", { name: "Shop inventory pages" })
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await inventory
      .getByRole("navigation", { name: "Shop inventory pages" })
      .getByText(`26–50 of ${expected}`)
      .waitFor();
    await page.locator("summary").filter({ hasText: "Add from catalog" }).click();
    const picker = page
      .locator("details")
      .filter({ has: page.locator("summary").filter({ hasText: "Add from catalog" }) });
    await picker.getByLabel("Search catalog for stock", { exact: true }).fill("Spyglass");
    await picker.getByRole("checkbox", { name: "Stock Spyglass", exact: true }).check();
    await picker
      .getByLabel("Search catalog for stock", { exact: true })
      .fill("Night in the common room");
    await picker.getByRole("button", { name: "Select all 1 matching item", exact: true }).click();
    await picker.getByText("2 item types selected", { exact: true }).waitFor();
    await picker.getByLabel("Catalog stock quantity", { exact: true }).fill("1.5");
    await picker.getByRole("button", { name: "Add 2 selected items", exact: true }).click();
    await picker.getByRole("alert").getByText(/whole quantity/).waitFor();
    await picker.getByText("2 item types selected", { exact: true }).waitFor();
    assert.equal((await readRows(page, "stock")).filter(row => row.shopId === shopId).length, expected);
    await picker.getByLabel("Catalog stock quantity", { exact: true }).fill("7");
    await picker.getByRole("button", { name: "Add 2 selected items", exact: true }).click();
    rows = await waitStock(
      page,
      (rows) => rows.filter((row) => row.shopId === shopId).length === expected + 2,
    );
    assert.equal(rows.find((row) => row.shopId === shopId && row.name === "Spyglass").quantity, 7);
    assert.equal(
      rows.find((row) => row.shopId === shopId && row.name === "Night in the common room").quantity,
      null,
    );
    assert.equal(
      rows.find((row) => row.shopId === shopId && row.name === "Audit good 000").copper,
      17,
    );
    assert.equal(
      rows.find((row) => row.shopId === shopId && row.name === "Audit good 000").quantity,
      2,
    );
    await picker.getByLabel("Search catalog for stock", { exact: true }).fill("Spyglass");
    assert.equal(
      await picker.getByRole("checkbox", { name: "Stock Spyglass", exact: true }).isDisabled(),
      true,
    );
    await inventory.getByLabel("Inventory stock filter", { exact: true }).selectOption("unlimited");
    assert.equal(await inventory.locator("li").count(), 1);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    await picker.getByLabel("Search catalog for stock", { exact: true }).fill("Mail shirt");
    await page.screenshot({ path: `${output}/management-${width}.png`, fullPage: true });
    await reloadApplication(page);
    const restored = (await readRows(page, "stock")).filter((row) => row.shopId === shopId);
    assert.equal(restored.length, expected + 2);
    assert.equal(restored.find((row) => row.name === "Audit good 000").copper, 17);
    assert.equal(restored.find((row) => row.name === "Spyglass").quantity, 7);
    await page.getByRole("link", { name: "Market", exact: true }).first().click();
    await page.getByRole("button", { name: /^Create a shop/ }).click();
    await page.getByRole("heading", { name: "Create a shop", exact: true }).waitFor();
    assert.equal(await page.locator(".loot-opening").count(), 0);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile large shop generation, separate quantities, real purchase and price edit, bulk catalog/service selection, duplicates, filters/pages, reload persistence and router navigation.",
  );
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    console.error((await lastPage.locator("main").innerText()).slice(-3500));
    await lastPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
  }
  throw error;
} finally {
  await browser.close();
}
