// Split view: two screens in one window. Disposable local server only.
// Run with: node --experimental-strip-types scripts/split-view-browser-audit.mjs
import { chromium } from "playwright";
import { expect } from "playwright/test";
import assert from "node:assert/strict";
import { continueIntoApp, openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";
import { buildWayfarers } from "./product-screenshot-fixture.mjs";
import { autoAnswerThemedDialogs } from "./themed-dialogs.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Disposable local server required.");
const started = Date.now();
const hex = () => crypto.randomUUID().slice(0, 4);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: "block",
  extraHTTPHeaders: { "cf-connecting-ip": `2001:db8:${hex()}:${hex()}::1` },
});
await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
const page = await context.newPage();
page.setDefaultTimeout(25000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => void d.accept());
await autoAnswerThemedDialogs(page); // themed confirmations (window.confirm is banned)
const api = [];
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.origin === origin && url.pathname.startsWith("/api/")) api.push(url.pathname);
});

const COPPER = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
const copper = (text) =>
  [...text.matchAll(/(−?\d+)\s*(cp|sp|ep|gp|pp)\b/g)].reduce(
    (sum, [, n, unit]) => sum + Number(n.replace("−", "-")) * COPPER[unit],
    0,
  );
const left = (name) => page.getByRole("region", { name: `Left pane: ${name}`, exact: true });
const right = (name) => page.getByRole("region", { name: `Right pane: ${name}`, exact: true });
const anyRight = page.locator('[data-split-pane="secondary"]');
const layout = page.getByRole("group", { name: "Layout", exact: true });
const search = () => new URL(page.url()).searchParams;
async function noOverflow(label) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${label}: no horizontal page overflow`,
  );
}
async function sameDocument(label) {
  assert.equal(await page.evaluate(() => window.splitAuditMarker), "kept", `${label}: same document`);
  assert.equal(await page.locator(".loot-opening").count(), 0, `${label}: no title replay`);
}
async function idleRequests(ms) {
  await page.waitForTimeout(1500);
  const from = api.length;
  await page.waitForTimeout(ms);
  const counts = {};
  for (const path of api.slice(from)) counts[path] = (counts[path] || 0) + 1;
  return counts;
}

try {
  // A signed-in DM device holding the synthetic Wayfarers campaign.
  const signup = await context.request.post(origin + "/api/account/auth/sign-up/email", {
    headers: { origin },
    data: {
      name: "Split view audit DM",
      email: `split-${crypto.randomUUID()}@example.com`,
      password: "disposable split audit password 2026",
    },
  });
  assert.ok(signup.ok(), `signup ${signup.status()}`);
  await openApplication(page, origin + "/");
  await page.getByText("Campaign control", { exact: true }).waitFor();
  await page.evaluate(async (table) => {
    const economy = await import("/src/lib/quire/economy.ts");
    await economy.applyCloudTable(table);
  }, buildWayfarers());
  await reloadApplication(page);
  await page.getByText("Campaign control", { exact: true }).waitFor();

  // Single screen: character sheet with split controls in the header.
  await page.goto(origin + "/characters?id=party%3Amira");
  await continueIntoApp(page);
  await page.getByRole("heading", { name: "Mira Ashfall", exact: true }).first().waitFor();
  await page.evaluate(() => (window.splitAuditMarker = "kept"));
  await expect(layout).toBeVisible();
  await expect(layout.getByRole("button", { name: "Split view" })).toHaveAttribute("aria-pressed", "false");
  assert.equal(await anyRight.count(), 0);
  const single = await idleRequests(5000);

  // Narrowing the window must not leave split controls in a too-narrow header, not even
  // for the frame before React reacts to the media change (measured immediately).
  await page.setViewportSize({ width: 320, height: 900 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "320px right after narrowing: no horizontal overflow",
  );
  await expect(layout).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(layout).toBeVisible();

  // Open beside → Market. The sheet stays on the left in the same document.
  await page.getByRole("button", { name: "Open beside", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Open beside" });
  await expect(menu.getByRole("menuitem", { name: /^Market/ })).toBeVisible();
  assert.equal(await menu.getByRole("menuitem", { name: /^Character sheet/ }).count(), 0);
  await expect(menu.getByRole("menuitem", { name: /^Open in a separate window/ })).toBeVisible();
  await menu.getByRole("menuitem", { name: /^Market/ }).click();
  await expect(right("Market")).toBeVisible();
  await expect(left("Character sheet")).toBeVisible();
  await expect(layout.getByRole("button", { name: "Split view" })).toHaveAttribute("aria-pressed", "true");
  assert.match(search().get("beside"), /^\/market(\?|$)/);
  assert.equal(new URL(page.url()).pathname, "/characters");
  await sameDocument("open beside");
  await noOverflow("split 1440");
  await right("Market").getByRole("heading", { name: "Market", exact: true }).waitFor();
  const widths = await page.$$eval("[data-split-pane]", (els) => els.map((e) => e.getBoundingClientRect().width));
  assert.ok(widths.every((w) => w >= 380), `pane widths ${widths}`);

  // No duplicated polling: an idle split window makes no more API calls per endpoint than one screen.
  const split = await idleRequests(5000);
  for (const [path, n] of Object.entries(split))
    assert.ok(n <= (single[path] || 0) + 1, `${path}: ${n} requests in split view vs ${single[path] || 0}`);
  console.log(`  idle API requests: single ${JSON.stringify(single)} split ${JSON.stringify(split)}`);

  // The sheet's live campaign ledger in the left pane.
  const sheet = left("Character sheet");
  await sheet.getByRole("button", { name: "Edit sheet", exact: true }).click();
  await sheet.getByRole("tab", { name: "Inventory & currency" }).click();
  const ledger = sheet
    .locator("section.sheet-card")
    .filter({ has: page.getByRole("heading", { name: "Inventory & currency" }) })
    .locator(".sheet-vitals")
    .first();
  await ledger.waitFor();
  const before = copper(await ledger.innerText());

  // Navigate inside the right pane only: Market → The Brass Lantern.
  await right("Market").locator('a[href^="/shop/lantern"]').first().click();
  await expect(right("Shop")).toBeVisible();
  await expect.poll(() => search().get("beside")?.split("?")[0]).toBe("/shop/lantern");
  assert.equal(new URL(page.url()).pathname, "/characters");
  await expect(sheet.getByRole("heading", { name: "Mira Ashfall", exact: true }).first()).toBeVisible();
  await sameDocument("pane navigation");

  // Buy once in the right pane; the purse beside it updates without reload, exactly once.
  const shop = right("Shop");
  await chooseOption(shop.getByLabel("Paying from", { exact: true }), "mira");
  const row = shop.locator("li").filter({ has: page.getByLabel("Quantity of Bedroll", { exact: true }) });
  await expect(row.getByRole("button", { name: /^Buy / })).toBeEnabled();
  // Only the row being edited explains its cost and the balance afterward.
  await row.getByLabel("Quantity of Bedroll", { exact: true }).focus();
  await expect(row).toContainText("afterward");
  const rowText = await row.innerText();
  const stockBefore = Number(/(\d+) left/.exec(rowText)[1]);
  const afterward = copper(/afterward ([^.]+)\./.exec(rowText)[1]);
  assert.ok(afterward < before, `price is charged (${before} → ${afterward})`);
  await row.getByRole("button", { name: /^Buy / }).click();
  await expect(row).toContainText(`${stockBefore - 1} left`);
  await expect.poll(async () => copper(await ledger.innerText()), { timeout: 15000 }).toBe(afterward);
  await page.waitForTimeout(1500);
  assert.equal(copper(await ledger.innerText()), afterward, "charged exactly once");
  await expect(row).toContainText(`${stockBefore - 1} left`);
  await sameDocument("purchase");

  // Swap, and swap back.
  await shop.getByRole("button", { name: "Swap panes", exact: true }).click();
  await expect(left("Shop")).toBeVisible();
  await expect(right("Character sheet")).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/shop/lantern");
  const swapped = new URL(search().get("beside"), origin);
  assert.equal(swapped.pathname, "/characters");
  assert.equal(swapped.searchParams.get("id"), "party:mira");
  await right("Character sheet").getByRole("button", { name: "Swap panes", exact: true }).click();
  await expect(left("Character sheet")).toBeVisible();
  await expect(right("Shop")).toBeVisible();
  await sameDocument("swap");

  // Full width is temporary and keeps the other pane.
  await right("Shop").getByRole("button", { name: "Show this pane full width", exact: true }).click();
  await expect(page.locator('[data-split-pane="primary"]')).toBeHidden();
  await right("Shop").getByRole("button", { name: "Show both panes", exact: true }).click();
  await expect(left("Character sheet")).toBeVisible();

  // Keyboard resizing reaches the 60/40 preset; F6 moves focus and the tab title follows.
  const divider = page.getByRole("separator", { name: /Resize panes/ });
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "60");
  const [leftWidth, rightWidth] = await page.$$eval("[data-split-pane]", (els) =>
    els.map((e) => e.getBoundingClientRect().width),
  );
  assert.ok(Math.abs(leftWidth / (leftWidth + rightWidth) - 0.6) < 0.02, `60/40: ${leftWidth}/${rightWidth}`);
  await page.locator('[data-split-pane="primary"]').focus();
  await page.keyboard.press("F6");
  await expect(page.locator('[data-split-pane="secondary"]')).toHaveAttribute("data-focused", "true");
  await expect(page).toHaveTitle(/^Shop · Lootsplitter/);
  await page.keyboard.press("F6");
  await expect(page.locator('[data-split-pane="primary"]')).toHaveAttribute("data-focused", "true");

  // Reload restores the pane beside and the divider position.
  await reloadApplication(page);
  await expect(right("Shop")).toBeVisible();
  await expect(left("Character sheet")).toBeVisible();
  await expect(page.getByRole("separator", { name: /Resize panes/ })).toHaveAttribute("aria-valuenow", "60");
  await page.evaluate(() => (window.splitAuditMarker = "kept"));
  await page.getByRole("separator", { name: /Resize panes/ }).dblclick();
  await expect(page.getByRole("separator", { name: /Resize panes/ })).toHaveAttribute("aria-valuenow", "50");

  // Tablet landscape width still fits two panes.
  await page.setViewportSize({ width: 1194, height: 834 });
  await expect(right("Shop")).toBeVisible();
  const tablet = await page.$$eval("[data-split-pane]", (els) => els.map((e) => e.getBoundingClientRect().width));
  assert.ok(tablet.every((w) => w >= 380), `tablet pane widths ${tablet}`);
  await noOverflow("split 1194");

  // Phone width: no split controls, only the left screen; the choice returns when wide again.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(anyRight).toHaveCount(0);
  await expect(layout).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open beside" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mira Ashfall", exact: true }).first()).toBeVisible();
  await noOverflow("phone 390");
  assert.ok(search().get("beside"), "phone width keeps the pane choice");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(right("Shop")).toBeVisible();
  await sameDocument("resize");

  // Close the right pane; the toggle restores the last screen used beside.
  await right("Shop").getByRole("button", { name: "Close this pane", exact: true }).click();
  await expect(anyRight).toHaveCount(0);
  await expect.poll(() => search().has("beside")).toBe(false);
  await layout.getByRole("button", { name: "Split view" }).click();
  await expect(right("Shop")).toBeVisible();
  await layout.getByRole("button", { name: "Single screen" }).click();
  await expect(anyRight).toHaveCount(0);
  await sameDocument("toggle");

  // A player seat never gets DM-only screens beside, from the menu or a crafted URL.
  await page.evaluate(async () => {
    const { setSeat, getSeat } = await import("/src/lib/quire/table.ts");
    setSeat({ ...getSeat(), role: "player", purseIds: ["mira"], shopIds: ["lantern", "forge"], openedAt: Date.now() });
  });
  for (const crafted of ["/encounters", "/features/time", "/features/music"]) {
    await page.goto(`${origin}/market?beside=${encodeURIComponent(crafted)}`);
    await continueIntoApp(page);
    await expect(layout).toBeVisible();
    await page.getByRole("heading", { name: "Market", exact: true }).first().waitFor();
    await page.waitForTimeout(500);
    assert.equal(await anyRight.count(), 0, `player cannot open ${crafted} beside`);
  }
  await page.getByRole("button", { name: "Open beside", exact: true }).click();
  const playerMenu = page.getByRole("menu", { name: "Open beside" });
  await expect(playerMenu.getByRole("menuitem", { name: /^Party & inventory/ })).toBeVisible();
  for (const hidden of [/^Encounters/, /^Session Time/, /^Music & Ambience/, /^Review Inbox/, /^Shop Management/])
    assert.equal(await playerMenu.getByRole("menuitem", { name: hidden }).count(), 0, String(hidden));
  await expect(playerMenu.getByRole("menuitem", { name: /^My Finances/ })).toBeVisible();
  await page.keyboard.press("Escape");

  assert.deepEqual(errors, []);
  console.log(`Split view: open beside, shared purchase, pane-only navigation, swap, full width, keyboard resize, F6, reload, 1194/390 widths, toggle and player restrictions passed in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
} finally {
  await browser.close();
}
