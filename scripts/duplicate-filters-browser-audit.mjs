// Duplicate and remembered filters (design plan QoL 9 and 3) in a disposable device campaign
// seeded with the synthetic "Wayfarers" fixture, as the DM:
// - Duplicate shop makes "<name> (copy)" with the same stock lines (prices, quantities) and leaves
//   the original untouched;
// - Duplicate on a saved encounter makes a new draft "<name> (copy)" with its combatants and loot;
// - Duplicate NPC opens a new-NPC editor filled from the original; Create NPC adds a second NPC;
// - Review Inbox's type chip and the inventory's Holder filter come back after a reload.
// Runs at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { continueIntoApp, openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { autoAnswerThemedDialogs } from "./themed-dialogs.mjs";
import { buildWayfarers } from "./product-screenshot-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("The duplicate audit changes a disposable campaign; run it only locally.");
const out = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/duplicate-filters`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const table = buildWayfarers();
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return { shops: t.shops, stock: t.stock };
  });
const noOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
    `${label}: the page scrolls sideways`,
  );

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
    await autoAnswerThemedDialogs(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/", { waitUntil: "networkidle" });
    await page.evaluate(async (t) => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      await applyCloudTable(t);
    }, table);

    // --- Duplicate shop.
    await page.goto(origin + "/shop/lantern");
    await continueIntoApp(page);
    await page.getByRole("group", { name: "Shop mode", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
    const before = await books(page);
    const original = before.stock.filter((s) => s.shopId === "lantern");
    await page.getByRole("button", { name: "Duplicate shop", exact: true }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/shop/") && !u.pathname.endsWith("/lantern"));
    await expect(page.getByRole("heading", { name: "The Brass Lantern (copy)", exact: true })).toBeVisible();
    const after = await books(page);
    const copyId = new URL(page.url()).pathname.split("/").pop();
    const copy = after.stock.filter((s) => s.shopId === copyId);
    assert.deepEqual(
      copy.map((s) => [s.name, s.copper, s.quantity]).sort(),
      original.map((s) => [s.name, s.copper, s.quantity]).sort(),
      "the copy has the same stock lines",
    );
    assert.deepEqual(after.stock.filter((s) => s.shopId === "lantern"), original, "the original is unchanged");
    assert.equal(after.shops.find((s) => s.id === copyId).acceptAnyCategory, true, "settings are copied");
    await noOverflow(page, `shop copy ${width}`);
    await page.screenshot({ path: `${out}/shop-copy-${width}.png` });

    // --- Duplicate encounter.
    await page.goto(origin + "/encounters");
    await continueIntoApp(page);
    await page.getByRole("button", { name: "New encounter", exact: true }).click();
    const tab = (name) => page.getByRole("button", { name, exact: true }).click();
    await tab("Builder & generator");
    await page.getByLabel("Encounter name", { exact: true }).fill(`Bridge ambush ${width}`);
    await tab("Battle tracker");
    await page.getByRole("button", { name: "Add combatant", exact: true }).click();
    await page.locator(".encounter-combatant").last().getByLabel("Name", { exact: true }).fill("Bridge troll");
    const duplicate = page.getByRole("button", { name: "Duplicate", exact: true });
    await expect(duplicate).toBeDisabled(); // unsaved changes: the copy is made from the saved encounter
    await page.getByRole("button", { name: "Save encounter", exact: true }).click();
    await page.getByText("Encounter saved.", { exact: true }).waitFor();
    await duplicate.click();
    await expect(page.locator(".combat-identity strong")).toHaveText(["Bridge troll"]);
    await tab("Builder & generator");
    await expect(page.getByLabel("Encounter name", { exact: true })).toHaveValue(`Bridge ambush ${width} (copy)`);
    await noOverflow(page, `encounter copy ${width}`);

    // --- Duplicate NPC.
    await page.goto(origin + "/features/npcs");
    await continueIntoApp(page);
    // The editor copies the party's current location into its draft when it opens; opening it
    // before the campaign has loaded leaves NPC location on "Choose location" and Create NPC is
    // then held back by the required field (how this audit failed 1 run in 3 on 2026-10-28).
    await expect(page.getByText(/^Meet people at (?!Campaignwide)/)).toBeVisible();
    await page.getByRole("button", { name: "Create non-party NPC", exact: true }).click();
    const editor = page.getByRole("region", { name: "NPC editor", exact: true });
    await expect(editor.getByRole("combobox", { name: "NPC location", exact: true })).not.toHaveText("Choose location");
    await editor.getByRole("textbox").first().fill(`Odile ${width}`);
    await editor.getByRole("button", { name: "Create NPC", exact: true }).click();
    await expect(editor).toHaveCount(0);
    // The record's <summary> has no ARIA role, so it is addressed through its own record: the
    // role-button attempt this used to make waited 45 s per width and its fallback raced the
    // list render on busy runners (main d5cf7a0 and several PRs failed here on 2026-10-28).
    const record = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: `Odile ${width}`, exact: true }) });
    await expect(record).toBeVisible();
    const details = record.locator("details.npc-record-details");
    await details.locator("summary").click();
    await expect(details).toHaveJSProperty("open", true);
    await details.getByRole("button", { name: "Duplicate NPC", exact: true }).click();
    await expect(editor.getByRole("heading")).toHaveText("New non-party NPC (copy)");
    await expect(editor.getByRole("textbox").first()).toHaveValue(`Odile ${width} (copy)`);
    await editor.getByRole("button", { name: "Create NPC", exact: true }).click();
    await expect(editor).toHaveCount(0);
    // The copy is a second NPC record (each NPC has its own quest strip).
    await expect(page.getByRole("region", { name: `Quests from Odile ${width} (copy)`, exact: true })).toHaveCount(1);
    await expect(page.getByRole("region", { name: `Quests from Odile ${width}`, exact: true })).toHaveCount(1);

    // --- Remembered filters: Review Inbox type chip and the inventory Holder.
    await page.goto(origin + "/features/review");
    await continueIntoApp(page);
    const chips = page.getByRole("group", { name: "Show request types", exact: true });
    const typeChip = chips.getByRole("button").nth(1);
    await typeChip.waitFor();
    const chipName = (await typeChip.textContent()).replace(/\d+$/, "").trim();
    await typeChip.click();
    await reloadApplication(page);
    await expect(
      page.getByRole("group", { name: "Show request types", exact: true }).getByRole("button", { name: new RegExp(`^${chipName}`) }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto(origin + "/party?section=funds");
    await continueIntoApp(page);
    await page.getByLabel("Holder", { exact: true }).selectOption("bram");
    await reloadApplication(page);
    await expect(page.getByLabel("Holder", { exact: true })).toHaveValue("bram");
    assert.equal(await page.locator(".inventory-group").count(), 1, "the remembered holder filters the list");
    await page.getByLabel("Holder", { exact: true }).selectOption("");
    await noOverflow(page, `inventory ${width}`);

    assert.deepEqual(errors, [], `no page errors at ${width}`);
    await context.close();
    console.log(`duplicate-filters ${width}: ok`);
  }
} finally {
  await browser.close();
}
