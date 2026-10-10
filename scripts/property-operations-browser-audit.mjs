import { chooseOption } from "./search-select-browser.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(
  origin,
  /^http:\/\/(127\.0\.0\.1|localhost):/,
  "Property fixtures require a disposable server",
);
const output = "test-results/property-operations";
await mkdir(output, { recursive: true });
const started = Date.now(),
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ["--no-sandbox"],
  }),
  errors = [];
let currentPage;
async function journal(page) {
  return page.evaluate(async () => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find(
          (row) => row.id === active,
        )?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction("meta").objectStore("meta").get("journal");
        r.onsuccess = () => resolve(r.result?.value);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
async function noOverflow(page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Expanded property controls fit the viewport",
  );
}
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      serviceWorkers: "block",
    });
    await context.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (route) => route.abort(),
    );
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/features/properties");
    await page.getByRole("button", { name: "New property listing", exact: true }).waitFor();
    // Funds, place and physical goods are prerequisites. Import/setup/storage/hiring/work/postage use real controls.
    await page.evaluate(async () => {
      const active = localStorage.getItem("quire.campaign.v1"),
        name =
          JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find(
            (row) => row.id === active,
          )?.db || "quire";
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(
            ["purses", "holdings", "shops", "stock", "ledger", "meta"],
            "readwrite",
          );
          for (const store of ["purses", "holdings", "shops", "stock", "ledger"])
            tx.objectStore(store).clear();
          for (const [id, kind, label] of [
            ["party", "party", "Party treasury"],
            ["hero", "character", "Alwen"],
          ])
            tx.objectStore("purses").put({
              id,
              name: label,
              kind,
              coins: { cp: 500000, sp: 0, ep: 0, gp: 0, pp: 0 },
            });
          tx.objectStore("holdings").put({
            id: "timber-lot",
            purseId: "hero",
            name: "Timber bundle",
            kind: "item",
            quantity: 10,
            unitCopper: 100,
            weight: 2,
            notes: "Material prerequisite",
          });
          tx.objectStore("shops").put({
            id: "post",
            name: "Brackenport Post",
            keeper: "Clerk",
            place: "Brackenport",
            locationId: "city",
            notes: "",
            sellRate: 1,
            buyRate: 1,
            wealth: "modest",
            category: "scribe",
            priceScale: 1,
          });
          tx.objectStore("meta").put({ id: "listings", listings: [] });
          tx.objectStore("meta").put({
            id: "journal",
            value: {
              sessions: [],
              requests: [],
              events: [],
              market: {
                currentLocationId: "area",
                locations: [
                  {
                    id: "region",
                    name: "Eastmarch",
                    kind: "region",
                    parentId: null,
                    description: "",
                  },
                  {
                    id: "city",
                    name: "Brackenport",
                    kind: "city",
                    parentId: "region",
                    description: "",
                  },
                  {
                    id: "area",
                    name: "Dock Ward",
                    kind: "area",
                    parentId: "city",
                    description: "",
                  },
                ],
              },
            },
          });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
    await reloadApplication(page);
    await page.getByRole("button", { name: /^DM estate workshop/ }).click();
    await page.getByRole("button", { name: "Reviewed property import", exact: true }).click();
    await page.getByLabel("Choose a property import JSON file").setInputFiles({
      name: "property-operations.sample.json",
      mimeType: "application/json",
      buffer: await readFile("docs/examples/property-operations.sample.json"),
    });
    await chooseOption(page.getByLabel("Map to the campaign's party treasury"), "party");
    await chooseOption(page.getByLabel(/Eastmarch\s*\(region\)/), "region");
    await chooseOption(page.getByLabel(/Brackenport\s*\(city\)/), "city");
    await chooseOption(page.getByLabel(/Dock Ward\s*\(area\)/), "area");
    await page.getByRole("button", { name: "Review import preview", exact: true }).click();
    await expect(page.getByRole("form", { name: "Commit reviewed property import" })).toContainText(
      "inactive owned holding",
    );
    await page.getByRole("button", { name: "Import reviewed configurations", exact: true }).click();
    const warehouse = page
      .locator("article.journal-entry")
      .filter({ has: page.getByRole("heading", { name: "Harbor Storehouse", exact: true }) })
      .first();
    await expect(warehouse).toBeVisible();
    await expect(page.locator(".property-card")).toHaveCount(3);
    await warehouse
      .getByRole("button", { name: "Property settings & permissions", exact: true })
      .click();
    const settings = warehouse.getByRole("form", { name: "Property settings", exact: true });
    await settings.getByLabel("Enable this property's operations").check();
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(warehouse).toContainText("Operations enabled");
    await warehouse.getByRole("button", { name: /^Storage & material staging/ }).click();
    const movement = warehouse.getByRole("form", { name: "Move stored goods", exact: true });
    await chooseOption(movement.getByLabel("Acting / receiving character"), "hero");
    await movement.getByLabel("Item quantity").fill("4");
    await movement
      .getByLabel("Donate deposited goods to the property owner for shared work")
      .check();
    await movement.getByRole("button", { name: "Deposit items", exact: true }).click();
    await expect(warehouse).toContainText("4 × Timber bundle");
    await expect(warehouse).toContainText("Owned by Party treasury");
    await chooseOption(movement.getByLabel("Storage action"), "withdraw");
    await movement.getByLabel("Item quantity").fill("1");
    await movement.getByRole("button", { name: "Withdraw items", exact: true }).click();
    await expect(warehouse).toContainText("3 × Timber bundle");
    await warehouse.getByRole("button", { name: "Staff & managers", exact: true }).click();
    const hire = warehouse.getByRole("form", { name: "Hire property staff", exact: true });
    await hire.getByLabel("Staff name", { exact: true }).fill("Mira");
    await hire.getByLabel("Staff role", { exact: true }).fill("manager");
    await hire.getByLabel("Wage (copper per period)").fill("50");
    await hire.getByLabel("Manager with delegated duties").check();
    await hire.getByLabel("reports", { exact: true }).check();
    await hire.getByLabel("deliveries", { exact: true }).check();
    await hire.getByLabel("Manager spending cap (copper)").fill("1000");
    await hire.getByRole("button", { name: "Approve contract", exact: true }).click();
    await expect(warehouse).toContainText("Mira · manager · active");
    await page
      .getByRole("button", { name: "City post offices & delivery rules", exact: true })
      .click();
    const postal = page.getByRole("form", { name: "Postal rules", exact: true });
    await postal.getByLabel("Post office: Brackenport Post").check();
    await postal.getByRole("button", { name: "Save", exact: true }).click();
    await warehouse.getByRole("button", { name: "Letters & manager orders", exact: true }).click();
    const letter = warehouse.getByRole("form", { name: "Send a property letter", exact: true });
    await chooseOption(letter.getByLabel("Send as", { exact: true }), "hero");
    await chooseOption(letter.getByLabel("Property manager", { exact: true }), { label: "Mira" });
    await letter.getByRole("button", { name: "Pay postage & send", exact: true }).click();
    await expect(warehouse).toContainText("report order · in-transit");
    await chooseOption(page.getByLabel("Edit a property template"), "warehouse");
    const recipe = page.getByRole("form", {
      name: "Add construction, gathering or production recipe",
      exact: true,
    });
    await recipe.getByLabel("Recipe key", { exact: true }).fill("test-house");
    await recipe.getByLabel("Work name", { exact: true }).fill("Build harbor house");
    await recipe.getByLabel("Required full labor days").fill("2");
    await chooseOption(recipe.getByLabel("Completed building / upgrade template"), "house");
    await recipe.getByLabel("Required Building timber (bundle)").fill("2");
    await recipe.getByRole("button", { name: "Save", exact: true }).click();
    await warehouse
      .locator(".estate-records > li")
      .getByText("DM material & weight review", { exact: true })
      .click();
    const material = warehouse.getByRole("form", {
      name: "Material review: Timber bundle",
      exact: true,
    });
    await material.getByRole("button", { name: "Save", exact: true }).click();
    await warehouse
      .getByRole("button", { name: /^Construction, upgrades & downtime work/ })
      .click();
    const work = warehouse.getByRole("form", { name: "Plan property work", exact: true });
    await work.getByLabel("Alwen: share of downtime day (%)").fill("100");
    await work.getByRole("button", { name: "Approve work plan", exact: true }).click();
    await expect(warehouse).toContainText("Build harbor house · active");
    await noOverflow(page);
    await page.screenshot({ path: `${output}/operations-dark-${width}.png`, fullPage: true });
    const before = await journal(page);
    assert.equal(before.propertyOperations.letters.length, 1);
    assert.equal(before.propertyOperations.staff.length, 1);
    assert.ok(before.propertyOperations.sites[0].enabled);
    // Same-document appearance changes keep every expanded property workflow usable.
    await page.locator(".settings-trigger").click();
    const appearance = page.getByRole("dialog", { name: "Settings & Management", exact: true });
    await appearance.getByRole("button", { name: /^Appearance/ }).click();
    await chooseOption(appearance.getByLabel("Theme", { exact: true }), "light");
    await appearance.getByRole("button", { name: "Close", exact: true }).click();
    await noOverflow(page);
    assert.equal(await page.locator(".loot-opening").count(), 0);
    await page.screenshot({ path: `${output}/operations-light-${width}.png`, fullPage: true });
    await warehouse
      .getByRole("link", { name: "Review and advance campaign downtime", exact: true })
      .click();
    await page.locator("summary").filter({ hasText: "Set downtime & review calculations" }).click();
    await page.getByLabel("In-game days", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Preview downtime", exact: true }).click();
    await expect(
      page.getByText("Build harbor house: completed", { exact: false }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Play sessions/ }).click();
    await page.getByLabel("Session name", { exact: true }).fill("Return to Brackenport");
    await page.getByRole("checkbox", { name: /I approve the downtime plan/ }).check();
    await page
      .getByRole("button", { name: "Approve downtime & start session", exact: true })
      .click();
    await expect
      .poll(async () => (await journal(page)).propertyOperations.jobs[0].status)
      .toBe("completed");
    assert.equal((await journal(page)).propertyOperations.letters[0].status, "delivered");
    await page
      .getByRole("link", { name: /Property Management/ })
      .first()
      .click();
    await page.getByRole("heading", { name: "Harbor Storehouse", exact: true }).first().waitFor();
    await reloadApplication(page);
    await page.getByRole("heading", { name: "Harbor Storehouse", exact: true }).first().waitFor();
    assert.equal((await journal(page)).propertyOperations.letters.length, 1);
    await context.close();
  }
  assert.deepEqual(errors, []);
  const result = {
    status: "passed",
    durationMs: Date.now() - started,
    widths: [1280, 390],
    scenarios: [
      "reviewed-import",
      "location-mapping",
      "activation",
      "storage-donation-withdrawal",
      "staff-manager",
      "city-postage",
      "recipe-project",
      "approved-downtime",
      "reload",
      "dark-light-layout",
    ],
  };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (e) {
  if (currentPage && !currentPage.isClosed())
    await currentPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw e;
} finally {
  await browser.close();
}
