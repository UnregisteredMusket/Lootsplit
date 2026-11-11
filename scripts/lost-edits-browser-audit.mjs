// Lost edits (audit 2026-11-10 D1, D2, D4, D5) in a disposable device campaign owned by a
// disposable signed-in DM. Window focus reloads the campaign; nothing the DM is typing may revert:
// the item edit dialog (D2) and the purse coin inputs (D4). Saving a record-keyed form keeps its
// section open with its notice (D5, NPC barter rules). One failed account check on reload keeps the
// DM's campaign open with a notice and Retry, while a positive "no session" still shows Welcome
// (D1). Never targets a real campaign.
// Run with: node scripts/lost-edits-browser-audit.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { continueIntoApp, openApplication, reloadApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("The lost edits audit changes a disposable campaign; run it only locally.");
const out = "test-results/lost-edits";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return { purses: t.purses, holdings: t.holdings };
  });
/** Poll `check` (async) until it is true, up to `timeout` ms. */
async function until(page, check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw Error(`Timed out: ${label}`);
    await page.waitForTimeout(150);
  }
}
/** The window regains focus: the campaign reloads (economy-context, 100 ms later). */
async function refocus(page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(1500);
}

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await openApplication(page, origin + "/party?section=funds");
  await page.evaluate(async () => {
    const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
    const { readJournal } = await import("/src/lib/quire/journal.ts");
    const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
    await applyCloudTable({
      purses: [{ id: "party", name: "Party fund", kind: "party", coins: coins({ gp: 176 }) }],
      holdings: [
        {
          id: "party-key",
          purseId: "party",
          name: "Tarnished bronze key",
          kind: "item",
          quantity: 1,
          unitCopper: 0,
          weight: 0.1,
          category: "curios",
          notes: "Opens something beneath the lighthouse.",
        },
      ],
      shops: [],
      stock: [],
      ledger: [],
      listings: [],
      loans: [],
      sheets: [],
      notes: [],
      journal: readJournal({}),
    });
  });
  await reloadApplication(page, origin + "/party?section=funds");
  await page.locator(".party-inventory").waitFor();

  // --- D2: the item edit dialog keeps what is typed through a reload.
  await page.getByRole("button", { name: "Actions for Tarnished bronze key", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Edit Tarnished bronze key", exact: true });
  await sheet.getByLabel("Item name", { exact: true }).fill("Bronze lighthouse key");
  await sheet.getByLabel("Item notes", { exact: true }).fill("Typed before the window regained focus.");
  await refocus(page);
  assert.equal(
    await sheet.getByLabel("Item name", { exact: true }).inputValue(),
    "Bronze lighthouse key",
    "D2: a reload put back the item's saved name while the dialog was open",
  );
  assert.equal(
    await sheet.getByLabel("Item notes", { exact: true }).inputValue(),
    "Typed before the window regained focus.",
    "D2: a reload put back the item's saved notes while the dialog was open",
  );
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await until(
    page,
    async () => (await books(page)).holdings.some((h) => h.id === "party-key" && h.name === "Bronze lighthouse key"),
    "the edited item is saved",
  );
  const key = (await books(page)).holdings.find((h) => h.id === "party-key");
  assert.equal(key.notes, "Typed before the window regained focus.");

  // --- D4: the purse's coin inputs keep what is typed through a reload; Set coins saves it.
  const wallets = page.locator("details.inventory-management");
  if ((await wallets.count()) && !(await wallets.first().evaluate((el) => el.open)))
    await wallets.locator("summary").first().click();
  await page.locator("#purse-party > summary").click();
  const purse = page.locator("#purse-party");
  const gold = purse.getByLabel("Gold", { exact: true });
  assert.equal(await gold.inputValue(), "176");
  await gold.fill("4321");
  await refocus(page);
  assert.equal(await gold.inputValue(), "4321", "D4: a reload put back the saved gold before Set coins");
  await purse.getByRole("button", { name: "Set coins", exact: true }).click();
  await until(
    page,
    async () => (await books(page)).purses.find((p) => p.id === "party")?.coins.gp === 4321,
    "Set coins saves the typed gold",
  );
  await refocus(page);
  assert.equal(await gold.inputValue(), "4321", "the saved gold shows after the save");
  await page.screenshot({ path: `${out}/party.png` });

  // --- D5: saving the NPC barter rules keeps the section open with its notice.
  await page.goto(origin + "/features/trading");
  await continueIntoApp(page);
  const fold = page.getByRole("button", { name: /^NPC barter rules/ });
  await fold.click();
  const stance = page.getByLabel("Default haggling stance");
  const current = await stance.inputValue();
  await stance.selectOption(current === "shrewd" ? "generous" : "shrewd");
  await refocus(page);
  assert.notEqual(await stance.inputValue(), current, "D5: a reload put back the saved stance");
  await page.getByRole("button", { name: "Save barter rules", exact: true }).click();
  const recorded = page.locator(".npc-barter-desk").getByRole("status").filter({ hasText: /Recorded|accepted/ });
  await recorded.waitFor();
  await page.waitForTimeout(1500);
  assert.equal(await recorded.isVisible(), true, "D5: saving dropped the notice");
  assert.equal(await fold.getAttribute("aria-expanded"), "true", "D5: saving closed the section");
  assert.notEqual(await stance.inputValue(), current, "the saved stance shows after the save");
  await page.screenshot({ path: `${out}/barter-rules.png` });

  // --- D1: one failed account check on reload keeps the DM's campaign, with a notice and Retry.
  await page.goto(origin + "/party?section=funds");
  await continueIntoApp(page);
  await page.locator(".party-inventory").waitFor();
  const owner = await page.evaluate(() => localStorage.getItem("lootsplit.offline-owner"));
  assert.ok(owner, "the signed-in DM is recorded as this device's offline owner");
  let failures = 1;
  await page.route("**/api/account/auth/get-session", (route) =>
    failures-- > 0 ? route.abort("failed") : route.continue(),
  );
  await reloadApplication(page);
  const notice = page.getByRole("status", { name: "Account check" });
  await notice.waitFor();
  await page.locator(".party-inventory").waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Welcome to Lootsplitter" }).count(),
    0,
    "D1: one failed account check replaced the campaign with Welcome",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("lootsplit.offline-owner")),
    owner,
    "D1: one failed account check deleted the offline-owner marker",
  );
  await page.screenshot({ path: `${out}/account-check-notice.png` });
  await notice.getByRole("button", { name: "Retry", exact: true }).click();
  await notice.waitFor({ state: "detached" });
  await page.unroute("**/api/account/auth/get-session");

  // A positive "no session" still shows Welcome and forgets the marker.
  let signedOut = 1;
  await page.route("**/api/account/auth/get-session", (route) =>
    signedOut-- > 0
      ? route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Sign in" }) })
      : route.continue(),
  );
  await reloadApplication(page);
  await page.getByRole("heading", { name: "Welcome to Lootsplitter" }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("lootsplit.offline-owner")), null);
  await page.unroute("**/api/account/auth/get-session");
  // The account is still signed in: the next check opens the campaign again.
  await reloadApplication(page);
  await page.locator(".party-inventory").waitFor();

  assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
  console.log("Lost edits audit passed: D1, D2, D4 and D5 keep the DM's work.");
} finally {
  await browser.close();
}
