import { openApplication, navigateApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
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
  assert.equal(await page.locator(".shortcut-button").count(), 6);
  const last = await page.locator(".shortcut-button").last().boundingBox();
  const bar = await nav.boundingBox();
  assert.ok(last.y + last.height <= bar.y, "All six default controls fit above the mobile tabs");
  await capture("dm-desk");
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByLabel("Button 1", { exact: true }).selectOption("chat");
  await page.getByLabel("Label", { exact: true }).first().fill("Party messages");
  await page.getByRole("button", { name: "Move button 1 down", exact: true }).click();
  await page.getByRole("button", { name: "Save shortcuts", exact: true }).click();
  await openApplication(page, origin + "/"); // Explicit reload verifies persisted shortcut edits.
  assert.equal(await page.locator(".shortcut-button").nth(1).innerText(), "Party messages");
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
  await capture("dm-desktop");
  await page.setViewportSize({ width: 320, height: 740 });
  await visit("/");
  await capture("dm-small");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: role navigation, six-button fit, shortcut edit/reorder/persistence, settings scope, light/dark, focus restoration, 320/390/768/1440 layouts.",
  );
} finally {
  await browser.close();
}
