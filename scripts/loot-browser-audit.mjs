// Disposable browser storage only. Open5e fixture exercises cached/offline search,
// while open5e.test.ts verifies remote query/normalization and attribution.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/loot", { recursive: true });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/party?section=funds&action=add");
    const name = page.getByLabel("Holding name", { exact: true });
    await name.waitFor();
    const owner = await page.getByLabel("Holding owner", { exact: true }).inputValue();
    assert.ok(owner);
    await name.fill("Navigation audit custom relic");
    await page.getByLabel("Holding value", { exact: true }).fill("2 gp");
    await page.getByLabel("Holding quantity", { exact: true }).fill("2");
    await page.getByLabel("Holding notes", { exact: true }).fill("Custom loot note");
    await page.getByRole("button", { name: "Add holding", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Holding name"]')?.value === "",
    );
    await page.evaluate(() =>
      localStorage.setItem(
        "lootsplit.open5e.search.v1",
        JSON.stringify([
          {
            key: JSON.stringify({
              kind: "items",
              edition: "srd-2014",
              query: "Longsword",
              page: 1,
            }),
            at: new Date().toISOString(),
            data: {
              count: 1,
              more: false,
              entries: [
                {
                  key: "srd_longsword",
                  kind: "items",
                  edition: "srd-2014",
                  name: "Longsword",
                  category: "smith",
                  copper: 1500,
                  description: "A sword.",
                  facts: ["Weapon"],
                  source: "System Reference Document 5.1",
                  url: "https://open5e.com",
                  attribution: "SRD 5.1 — CC BY 4.0; Wizards of the Coast; Open5e.",
                },
              ],
            },
          },
        ]),
      ),
    );
    await page.route("**/_serverFn/**", (route) => route.abort());
    await page.getByRole("tab", { name: "Open5e loot", exact: true }).click();
    await page.getByLabel("Search by name", { exact: true }).fill("Longsword");
    await page.getByRole("button", { name: "Search Open5e", exact: true }).click();
    await page.getByText("Longsword", { exact: true }).click();
    await page.getByRole("button", { name: "Use this loot", exact: true }).click();
    assert.equal(await name.inputValue(), "Longsword (2014)");
    assert.match(await page.getByLabel("Holding notes", { exact: true }).inputValue(), /CC BY 4.0/);
    await page.getByLabel("Holding quantity", { exact: true }).fill("3");
    await page.screenshot({ path: `test-results/loot/review-${width}.png` });
    await page.getByRole("button", { name: "Add holding", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Holding name"]')?.value === "",
    );
    await page.unroute("**/_serverFn/**");
    await openApplication(page, origin + "/party?section=funds");
    const rows = await page.evaluate(async () => {
      const registry = JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]");
      const active = localStorage.getItem("quire.campaign.v1");
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(registry.find((r) => r.id === active)?.db || "quire");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const rows = await new Promise((resolve, reject) => {
        const r = db.transaction("holdings").objectStore("holdings").getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      db.close();
      return rows;
    });
    const custom = rows.filter((r) => r.name === "Navigation audit custom relic"),
      imported = rows.filter((r) => r.name === "Longsword (2014)");
    assert.equal(custom.length, 1);
    assert.equal(custom[0].quantity, 2);
    assert.equal(custom[0].unitCopper, 200);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].quantity, 3);
    assert.equal(imported[0].unitCopper, 1500);
    assert.equal(imported[0].purseId, owner);
    assert.equal(imported[0].category, "smith");
    assert.match(imported[0].notes, /CC BY 4.0/);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS custom and Open5e loot review, cached search, owner/value/quantity/category/credits, reload persistence, desktop/mobile.",
  );
} finally {
  await browser.close();
}
