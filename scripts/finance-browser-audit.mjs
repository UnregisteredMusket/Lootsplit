import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = process.env.FINANCE_SCREENSHOTS || "test-results/finance";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const errors = [];
let lastPage;
try {
  for (const width of [1440, 390]) {
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
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/features/bank");
    await page.locator("#campaign-finance").waitFor();
    const notNow = page.getByRole("button", { name: "Not now", exact: true });
    if (await notNow.isVisible()) await notNow.click();
    await page.evaluate(async () => {
      const rows = JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]");
      const active = localStorage.getItem("quire.campaign.v1");
      const dbName = rows.find((r) => r.id === active)?.db || "quire";
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(dbName);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["purses", "holdings", "ledger", "meta"], "readwrite");
        for (const store of ["purses", "holdings", "ledger"]) tx.objectStore(store).clear();
        tx.objectStore("purses").put({
          id: "finance-party",
          name: "Finance party",
          kind: "party",
          coins: { gp: 10, sp: 0, ep: 0, cp: 0, pp: 0 },
        });
        tx.objectStore("holdings").put({
          id: "inn",
          purseId: "finance-party",
          name: "Campaign inn",
          kind: "property",
          quantity: 1,
          unitCopper: 10000,
          notes: "Keep this inventory unchanged",
        });
        tx.objectStore("meta").put({
          id: "journal",
          value: { sessions: [], requests: [], events: [] },
        });
        tx.objectStore("meta").put({ id: "loans", loans: [] });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await reloadApplication(page);
    async function go(feature){
      await page.locator('nav[aria-label="Sections"]:visible').getByRole("link",{name:"Desk",exact:true}).click();
      if (["financial","bank","shops","properties"].includes(feature)) await page.getByRole("button",{name:/^Economy & properties/}).click();
      await page.locator('.feature-cards').locator(`a[href^="/features/${feature}?"]`).click();
      assert.equal(await page.locator(".loot-opening").count(),0);
    }
    const finance = page.locator("#campaign-finance");
    await page.getByLabel("Loan name", { exact: true }).fill("Guild debt");
    await page.getByLabel("Principal (cp)", { exact: true }).fill("1000");
    await page.getByLabel("Interest per period (%)", { exact: true }).fill("10");
    await page.getByLabel("Period (in-game days)", { exact: true }).fill("7");
    await page.getByLabel("Scheduled repayment per period (cp)", { exact: true }).fill("200");
    await page.getByRole("button", { name: "Approve & fund loan", exact: true }).click();
    await finance.getByText("Guild debt · Finance party", { exact: true }).waitFor();
    await go("financial");
    await page.getByLabel("Schedule name", { exact: true }).fill("Inn revenue");
    await page.getByLabel("Amount per period (cp)", { exact: true }).fill("100");
    await page.getByLabel("Every (in-game days)", { exact: true }).fill("7");
    await page.getByLabel("Optional inventory source", { exact: true }).selectOption("inn");
    await page.getByRole("button", { name: "Save schedule", exact: true }).click();
    await finance.getByText("Inn revenue · Finance party", { exact: true }).waitFor();
    await page.getByLabel("Schedule name", { exact: true }).fill("Upkeep");
    await page.getByLabel("Type", { exact: true }).selectOption("expense");
    await page.getByLabel("Amount per period (cp)", { exact: true }).fill("50");
    await page.getByLabel("Every (in-game days)", { exact: true }).fill("7");
    await page.getByRole("button", { name: "Save schedule", exact: true }).click();
    await finance.getByText("Upkeep · Finance party", { exact: true }).waitFor();
    await go("downtime");
    await finance
      .locator("summary")
      .filter({ hasText: "Set downtime & review calculations" })
      .click();
    await page.getByRole("button", { name: "Preview downtime", exact: true }).click();
    await finance.getByText(/Finance party: 20 gp → 18 gp, 5 sp/).waitFor();
    await finance.scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "No horizontal overflow at " + width,
    );
    await page.screenshot({ path: `${output}/preview-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: /^Play sessions/ }).click();
    await page.getByLabel("Session name", { exact: true }).fill("Return to town");
    const approve = page.getByRole("button", {
      name: "Approve downtime & start session",
      exact: true,
    });
    assert.equal(await approve.isDisabled(), true);
    await page.getByRole("checkbox", { name: /I approve the/ }).check();
    await approve.click();
    await finance.getByText(/In-game day 7/).waitFor();
    await page.getByText(/Received 1 gp · Spent 2 gp, 5 sp · Net/).waitFor();
    await go("bank");
    await reloadApplication(page);
    await finance.getByText(/Outstanding loans 9 gp · In-game day 7/).waitFor();
    await page.getByLabel("Repayment in copper for Guild debt", { exact: true }).fill("100");
    await page.getByRole("button", { name: "Record repayment", exact: true }).click();
    await finance.getByText(/Outstanding loans 8 gp · In-game day 7/).waitFor();
    await finance.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/applied-${width}.png`, fullPage: true });
    assert.equal(await finance.locator('[role="alert"]').count(), 0);
    // Switch to a separate campaign in this disposable browser and ensure no debt follows.
    const original = await page.evaluate(() => {
      const active = localStorage.getItem("quire.campaign.v1") || "main";
      const rows = JSON.parse(
        localStorage.getItem("quire.campaigns.v1") || '[{"id":"main","name":"Main","db":"quire"}]',
      );
      rows.push({
        id: "finance-isolation",
        name: "Other campaign",
        db: "quire-finance-isolation",
        blank: true,
      });
      localStorage.setItem("quire.campaigns.v1", JSON.stringify(rows));
      // This synthetic second campaign belongs to the already authenticated fixture DM.
      localStorage.setItem("quire.owner.finance-isolation", localStorage.getItem(`quire.owner.${active || "main"}`));
      localStorage.setItem("quire.campaign.v1", "finance-isolation");
      return active;
    });
    await reloadApplication(page);
    await finance.getByText(/Outstanding loans 0 cp · In-game day 0/).waitFor();
    await page.evaluate((active) => localStorage.setItem("quire.campaign.v1", active), original);
    await reloadApplication(page);
    await finance.getByText(/Outstanding loans 8 gp · In-game day 7/).waitFor();
    await go("properties");
    const operations = page.locator("#campaign-operations");
    await operations.getByText("Campaign inn · Unmanaged", { exact: true }).click();
    await operations.getByLabel("Property revenue (cp)", { exact: true }).fill("200");
    await operations.getByLabel("Property upkeep (cp)", { exact: true }).fill("40");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await operations.screenshot({ path: `${output}/property-form-${width}.png` });
    await operations.getByRole("button", { name: "Save Campaign inn plan", exact: true }).click();
    await operations.getByText("Campaign inn · Managed", { exact: true }).waitFor();
    await go("shops");
    const shop = operations.locator("details").filter({ hasText: "Hearth & Nail" }).first();
    await shop.locator(":scope > summary").click();
    await shop.getByLabel("Restock every in-game days (0 disables)", { exact: true }).fill("7");
    await shop.getByLabel("Restock each finite item to at least", { exact: true }).fill("8");
    await shop.getByRole("button", { name: "Save Hearth & Nail schedule", exact: true }).click();
    await operations.getByText(/Hearth & Nail · Scheduled/).waitFor();
    await go("downtime");
    await finance.locator("summary").filter({ hasText: "Set downtime & review calculations" }).click();
    await page.getByRole("button", { name: "Preview downtime", exact: true }).click();
    await finance.getByText(/stock lines topped up/).waitFor();
    await page.getByRole("button", { name: /Session · Return to town/ }).click();
    await page.getByLabel("Session name", { exact: true }).fill("Property return");
    await page.getByRole("checkbox", { name: /I approve the/ }).check();
    await page.getByRole("button", { name: "Approve downtime & start session", exact: true }).click();
    await finance.getByText(/In-game day 14/).waitFor();
    await reloadApplication(page);
    await go("shops");
    await operations.getByText(/Campaign day 14/).waitFor();
    await operations.getByText(/Hearth & Nail · Scheduled/).waitFor();
    await go("properties");
    await operations.getByText("Campaign inn · Managed", { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await operations.screenshot({ path: `${output}/operations-${width}.png` });
    // Two local tabs share IndexedDB but have independently rendered forms.
    // Both accepted requests must survive instead of replacing an old snapshot.
    await go("bank");
    const other = await context.newPage();
    other.on("pageerror", (error) => errors.push(error.message));
    await openApplication(other, origin + "/features/bank");
    await other.locator("#campaign-finance").waitFor();
    const drafts = [[page, "First tab expense", "100"], [other, "Second tab expense", "200"]];
    for (const [tab, note, amount] of drafts) {
      await tab.getByPlaceholder("Amount in copper pieces", { exact: true }).fill(amount);
      await tab.getByPlaceholder("What is this payment for?", { exact: true }).fill(note);
    }
    await Promise.all(drafts.map(([tab]) => tab.getByRole("button", { name: "Queue payment", exact: true }).click()));
    await page.waitForFunction(async () => {
      const active = localStorage.getItem("quire.campaign.v1");
      const name = JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((r) => r.id === active)?.db || "quire";
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      try {
        const row = await new Promise((resolve, reject) => {
          const r = db.transaction("meta").objectStore("meta").get("journal");
          r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        return ["First tab expense", "Second tab expense"].every((note) => row?.value?.requests?.some((r) => r.note === note && r.status === "pending"));
      } finally { db.close(); }
    });
    await other.close();
    await reloadApplication(page);
    await page.getByText("First tab expense", { exact: true }).waitFor();
    await page.getByText("Second tab expense", { exact: true }).waitFor();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Finance UI: desktop/mobile creation, preview, consent, approval, reload, repayment, campaign isolation and concurrent local payment forms passed.",
  );
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
    console.error((await lastPage.locator("body").innerText()).slice(-4000));
  }
  throw error;
} finally {
  await browser.close();
}
