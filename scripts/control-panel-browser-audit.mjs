import { reloadApplication, navigateApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = "test-results/control-panel";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("response", response => { if (response.status() >= 400) console.error(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("pageerror", (e) => errors.push(e.message));
  async function visit(path) {
    await navigateApplication(page, origin + path);
    await page.locator(".concept-main").waitFor();
    await page.locator(".quire-dawn").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "Dungeon master. Change role." })
      .or(page.getByRole("button", { name: "Player. Change role." }))
      .waitFor();
    const skip = page.getByRole("button", { name: "Not now", exact: true });
    if (await skip.isVisible()) await skip.click();
    await page.evaluate(() => document.fonts.ready);
  }
  async function capture(name) {
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      name + " overflow",
    );
    await page.screenshot({ path: `${output}/${name}.png` });
  }
  const nav = page.locator("nav:visible[aria-label='Sections']");
  await visit("/");
  assert.deepEqual(await nav.locator("a").allTextContents(), [
    "Desk",
    "Encounters",
    "Party",
    "Market",
    "Library",
  ]);
  assert.equal(await page.locator(".shortcut-button").count(), 0, "Main Desk has no shortcut grid");
  await expect(page.getByRole("link", {name:"Multiplayer settings",exact:true})).toHaveCount(1);
  await expect(page.getByRole("link", {name:/Multiplayer · Room, chat & connection status/})).toHaveCount(0);
  await expect(page.getByRole("link", {name:"Open Multiplayer — host or join a room",exact:true})).toHaveCount(0);
  const information = page.getByRole("region", {name:"Campaign information",exact:true});
  await expect(information).toBeVisible();
  assert.equal(await page.locator(".information-panel").count(), 5);
  await page.locator('.information-selectors').getByRole("button", {name:"Funds",exact:true}).click();
  await expect(page.locator('.information-selectors').getByRole("button", {name:"Funds",exact:true})).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", {name:"Next information panel",exact:true}).click();
  await expect(page.locator('.information-selectors').getByRole("button", {name:"Activity",exact:true})).toHaveAttribute("aria-pressed", "true");
  await page.locator('.information-selectors').getByRole("button", {name:"Session",exact:true}).click();
  await expect(page.locator('.information-selectors').getByRole("button", {name:"Session",exact:true})).toHaveAttribute("aria-pressed", "true");
  // Native horizontal input must work too, independent of the jump controls.
  const stripBounds = await page.locator('.information-strip').boundingBox();
  await page.mouse.move(stripBounds.x + stripBounds.width / 2, stripBounds.y + 30);
  await page.mouse.wheel(stripBounds.width, 0);
  await expect(page.locator('.information-selectors').getByRole("button", {name:"Party",exact:true})).toHaveAttribute("aria-pressed", "true");
  await page.locator('.information-selectors').getByRole("button", {name:"Session",exact:true}).click();
  await expect(page.locator('.information-selectors').getByRole("button", {name:"Session",exact:true})).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => { window.multiplayerNavigationMarker = "same-document"; });
  await page.getByRole("link", {name:"Multiplayer settings",exact:true}).click();
  await expect(page.getByRole("tab", {name:"Room",exact:true})).toHaveAttribute("aria-selected", "true");
  assert.equal(await page.evaluate(() => window.multiplayerNavigationMarker), "same-document");
  assert.equal(await page.locator(".loot-opening").count(), 0);
  await nav.getByRole("link", {name:"Desk",exact:true}).click();
  await capture("dm-desk");
  await page.evaluate(() => { window.reviewNavigationMarker = "same-document"; });
  await page.locator(".readout").filter({ hasText: "Pending reviews" }).click();
  await expect(page.getByRole("heading", { name: "Review Inbox", exact: true })).toBeVisible();
  await expect(page.locator("#review-inbox")).toBeVisible();
  await expect(page.locator("#review-inbox summary")).toContainText("Payments & loans awaiting approval");
  await expect(page.getByText("No payments or loans need approval.", {exact:true})).toBeVisible();
  await expect(page.getByLabel("Payment account", {exact:true})).toHaveCount(0);
  await expect(page.getByRole("button", {name:"Submit request",exact:true})).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.reviewNavigationMarker), "same-document");
  assert.equal(await page.locator(".loot-opening").count(), 0);
  await page.getByRole("link", { name: "Return to Desk", exact: true }).click();
  // Both historical entry URLs now expose one DM home without duplicate sections.
  await page.evaluate(() => { window.unifiedHomeMarker = "same-document"; });
  await page.locator(".session-readout").click();
  await expect(page.locator("#sessions").getByLabel("Session name", {exact:true})).toBeVisible();
  assert.equal(await page.locator(".loot-opening").count(), 0);
  assert.equal(await page.evaluate(() => window.unifiedHomeMarker), "same-document");
  await visit("/?view=overview"); // Explicitly open the historical URL; no separate overview link remains.
  await page.evaluate(() => { window.unifiedHomeMarker = "same-document"; });
  await expect(page.getByRole("heading", {name:"Campaign control",exact:true})).toHaveCount(1);
  await expect(page.locator(".feature-cards")).toHaveCount(1);
  await expect(page.locator(".desk-shortcuts")).toHaveCount(0);
  assert.equal(await page.locator(".desk-overview").count(), 0);
  await page.getByRole("button", {name:/^Campaign treasury/}).click();
  await expect(page.getByRole("link", {name:"Add loot",exact:true})).toBeVisible();
  await page.getByRole("link", {name:"Review requests",exact:true}).click();
  await expect(page.getByRole("heading", {name:"Bank",exact:true})).toBeVisible();
  await expect(page.getByRole("heading", {name:"Queue a character payment for approval",exact:true})).toBeVisible();
  await page.getByRole("link", {name:"Return to Desk",exact:true}).click();
  await page.getByRole("button", {name:/^Activity & balances/}).click();
  await expect(page.getByRole("heading", {name:"Recent activity",exact:true})).toHaveCount(1);
  await page.getByRole("button", {name:/^Campaign tools/}).click();
  await expect(page.getByRole("button", {name:"Download copy",exact:true})).toBeVisible();
  await expect(page.getByText("Restore a copy", {exact:true})).toBeVisible();
  assert.equal(await page.evaluate(() => window.unifiedHomeMarker), "same-document");
  assert.equal(await page.locator(".loot-opening").count(), 0);
  await capture("unified-dm-home");
  await visit("/");

  await page.getByRole("button", { name: "Settings & Management", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", {name:"Dashboard",exact:true}).click();
  await page.getByRole("link", {name:"Saved shortcut settings →",exact:true}).click();
  await page.getByLabel("Button 1", { exact: true }).selectOption("chat");
  await page.getByLabel("Label", { exact: true }).first().fill("Party messages");
  await page.getByRole("button", { name: "Move button 1 down", exact: true }).click();
  await page.getByRole("button", { name: "Save shortcuts", exact: true }).click();
  await page.getByRole("dialog", { name: "Customize shortcuts", exact: true }).waitFor({ state: "hidden" }); // Closes only after the account write succeeds.
  let releasePreferences;
  const preferencesReady = new Promise(resolve => { releasePreferences = resolve; });
  await page.route("**/api/account/shortcuts?role=dm", async route => {
    const response = await route.fetch();
    await preferencesReady;
    await route.fulfill({ response });
  });
  await reloadApplication(page); // Explicit reload verifies persisted shortcut edits.
  await expect(page.getByRole("status").filter({ hasText: "Loading your account shortcuts" })).toBeVisible();
  assert.equal(await page.locator(".shortcut-button").count(), 0, "Default destinations cannot be clicked while saved preferences load");
  releasePreferences();
  await page.getByRole("dialog", {name:"Customize shortcuts",exact:true}).getByRole("button",{name:"Close",exact:true}).click();
  await expect(page.locator(".shortcut-button").nth(1)).toHaveText("Party messages");
  await page.unroute("**/api/account/shortcuts?role=dm");
  assert.equal(await page.locator(".shortcut-button").nth(1).getAttribute("href"), "/share?chat=1");
  await page.locator(".shortcut-button").nth(1).click();
  assert.equal(await page.locator(".loot-opening").count(), 0, "Shortcut keeps the app open");
  await page.locator('[role="tab"][aria-selected="true"]').filter({ hasText: "Chat" }).waitFor();
  assert.equal(
    await page.getByRole("tab", { name: "Chat", exact: true }).getAttribute("aria-selected"),
    "true",
  );
  await visit("/");
  await page.getByRole("button", { name: "Settings & Management", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(await dialog.locator(".management-category").count(), 8);
  await dialog.getByRole("button", { name: "Economy", exact: true }).click();
  await dialog.getByRole("link", { name: /Currency, price modifiers/ }).waitFor();
  await dialog.getByRole("button", { name: "Gameplay", exact: true }).click();
  await dialog.getByLabel("Roll mode", { exact: true }).selectOption("manual");
  await capture("dm-settings");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("button", { name: "Settings & Management", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  for (const [name, path] of [
    ["dm-encounters", "/encounters"],
    ["dm-party", "/party"],
    ["dm-market", "/market"],
    ["dm-library", "/library"],
  ]) {
    await visit(path);
    await capture(name);
  }
  // Exercise player presentation using a disposable local seat; server permissions
  // remain covered separately by the character, encounter and account audits.
  await page.evaluate(async () => {
    const e = await import("/src/lib/quire/economy.ts");
    const t = await import("/src/lib/quire/table.ts");
    const purses = await e.listPurses();
    t.setSeat({
      ...t.getSeat(),
      role: "player",
      purseIds: purses
        .filter((p) => p.kind === "character")
        .slice(0, 1)
        .map((p) => p.id),
    });
  });
  await visit("/characters");
  assert.deepEqual(await nav.locator("a").allTextContents(), [
    "Home",
    "Inventory",
    "Campaign",
    "Market",
    "Library",
  ]);
  await capture("player-character");
  await nav.getByRole("link", {name:"Home",exact:true}).click();
  await page.getByRole("link", {name:"Bank",exact:true}).click();
  await expect(page.getByRole("heading", {name:"Request approval to spend coins",exact:true})).toBeVisible();
  const paymentPurse = await page.getByLabel("Payment account", {exact:true}).inputValue();
  assert.ok(paymentPurse, "Player request is assigned to their character");
  await page.getByLabel("Payment amount in copper", {exact:true}).fill("1");
  await page.getByLabel("Payment description", {exact:true}).fill("Review audit inn bill");
  await page.getByRole("button", {name:"Submit request",exact:true}).click();
  await expect(page.locator("#review-inbox .journal-entry").filter({hasText:"Review audit inn bill"})).toContainText("pending");
  await visit("/characters");
  await page.getByRole("button", { name: "Settings & Management", exact: true }).click();
  await dialog.getByRole("button", { name: "Character", exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Economy", exact: true }).count(), 0);
  assert.equal(
    await dialog.getByRole("button", { name: "Players & permissions", exact: true }).count(),
    0,
  );
  await dialog.getByRole("button", { name: "Appearance", exact: true }).click();
  await dialog.getByLabel("Theme", { exact: true }).selectOption("light");
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
    ),
    "#dfcca2",
  );
  await capture("player-settings-light");
  await dialog.getByLabel("Theme", { exact: true }).selectOption("dark");
  await dialog.getByRole("button", { name: "Rolls", exact: true }).click();
  assert.equal(await dialog.getByLabel("Roll mode", { exact: true }).inputValue(), "manual");
  await dialog.getByLabel("Roll mode", { exact: true }).selectOption("virtual");
  await capture("player-settings");
  await page.keyboard.press("Escape");
  for (const [name, path] of [
    ["player-inventory", "/party"],
    ["player-campaign", "/share"],
    ["player-market", "/market"],
    ["player-library", "/library"],
  ]) {
    await visit(path);
    await capture(name);
  }
  await visit("/share");
  await page.getByRole("tab", { name: "Rolls", exact: true }).click();
  await page.getByText(/Join an online campaign to see shared rolls/).waitFor();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/characters", "/party", "/share", "/market", "/library"]) {
      await visit(path);
      await capture(`player-${width}-${path.slice(1)}`);
    }
  }
  await page.evaluate(async () => {
    const t = await import("/src/lib/quire/table.ts");
    t.setSeat({ ...t.getSeat(), role: "dm" });
  });
  await visit("/");
  await page.locator(".readout").filter({hasText:"Pending reviews"}).click();
  const paymentRequest = page.locator("#review-inbox .journal-entry").filter({hasText:"Review audit inn bill"});
  await expect(paymentRequest.getByRole("button", {name:"Approve payment",exact:true})).toBeVisible();
  await paymentRequest.getByRole("button", {name:"Decline",exact:true}).click();
  await expect(paymentRequest).toContainText("denied");
  await expect(page.getByLabel("Payment account", {exact:true})).toHaveCount(0);
  await page.getByRole("link", {name:"Return to Desk",exact:true}).click();
  await page.locator(".information-selectors").getByRole("button",{name:"Rolls",exact:true}).click();
  await expect(page.locator(".information-selectors").getByRole("button",{name:"Rolls",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByRole("button",{name:"Next information panel",exact:true})).toBeDisabled();
  await page.locator(".information-selectors").getByRole("button",{name:"Session",exact:true}).click();
  await expect(page.locator(".information-selectors").getByRole("button",{name:"Session",exact:true})).toHaveAttribute("aria-pressed","true");
  await capture("dm-desktop");
  await page.setViewportSize({ width: 320, height: 740 });
  await visit("/");
  await capture("dm-small");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: swipeable summaries, native horizontal input, jump/arrows, multiplayer Room entry, grouped tools, saved-shortcut persistence, role/settings preservation, 320/390/768/1440 layouts.",
  );
} finally {
  await browser.close();
}
