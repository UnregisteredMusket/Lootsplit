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
    await openApplication(page, origin + "/?view=overview");
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
          kind: "item",
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
    const finance = page.locator("#campaign-finance");
    await finance.locator(":scope > summary").click();
    await finance
      .locator("summary")
      .filter({ hasText: /^Loans & repayments/ })
      .click();
    await page.getByLabel("Loan name", { exact: true }).fill("Guild debt");
    await page.getByLabel("Principal (cp)", { exact: true }).fill("1000");
    await page.getByLabel("Interest per period (%)", { exact: true }).fill("10");
    await page.getByLabel("Period (in-game days)", { exact: true }).fill("7");
    await page.getByLabel("Scheduled repayment per period (cp)", { exact: true }).fill("200");
    await page.getByRole("button", { name: "Approve & fund loan", exact: true }).click();
    await finance.getByText("Guild debt · Finance party", { exact: true }).waitFor();
    await finance
      .locator("summary")
      .filter({ hasText: /^Loans & repayments/ })
      .click();
    await finance.locator("summary").filter({ hasText: "Recurring revenue & expenses" }).click();
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
    await finance.locator("summary").filter({ hasText: "Recurring revenue & expenses" }).click();
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
    await reloadApplication(page);
    await finance.locator(":scope > summary").click();
    await finance.getByText(/Outstanding loans 9 gp · In-game day 7/).waitFor();
    await finance
      .locator("summary")
      .filter({ hasText: /^Loans & repayments/ })
      .click();
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
      localStorage.setItem("quire.campaign.v1", "finance-isolation");
      return active;
    });
    await reloadApplication(page);
    await finance.locator(":scope > summary").click();
    await finance.getByText(/Outstanding loans 0 cp · In-game day 0/).waitFor();
    await page.evaluate((active) => localStorage.setItem("quire.campaign.v1", active), original);
    await reloadApplication(page);
    await finance.locator(":scope > summary").click();
    await finance.getByText(/Outstanding loans 8 gp · In-game day 7/).waitFor();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Finance UI: desktop/mobile creation, preview, consent, approval, reload, repayment and campaign isolation passed.",
  );
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
    console.error((await lastPage.locator("#campaign-finance").innerText()).slice(0, 4000));
  }
  throw error;
} finally {
  await browser.close();
}
