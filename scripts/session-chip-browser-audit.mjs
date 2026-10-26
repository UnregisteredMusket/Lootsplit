// Session chip, "Since last session", Pin to Desk, quick HP and the phone header (design D5 chip,
// Q7, Q8, Q11, M4) on the synthetic Wayfarers campaign in a disposable signed-in DM device, at
// 1280, 390, 320 and 844×390: the header chip and its sheet, the Desk digest, End & start next
// reaching the session form, pinning a feature screen to the Desk and unpinning it, −1/+1 HP on a
// party card only while an encounter runs (through the sheet save path), Help and the chip in the
// Settings sheet on phones. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { continueIntoApp, openApplication } from "./title-screen-navigation.mjs";
import { buildWayfarers } from "./product-screenshot-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Disposable local server required.");
const output = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/session-chip`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const hex = () => crypto.randomUUID().slice(0, 4);

try {
  for (const [width, height] of [
    [1280, 900],
    [390, 844],
    [320, 640],
    [844, 390],
  ]) {
    const phone = width < 640;
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 900,
      serviceWorkers: "block",
      extraHTTPHeaders: { "cf-connecting-ip": `2001:db8:${hex()}:${hex()}::1` },
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const go = async (path) => {
      await page.goto(origin + path).catch(async (e) => {
        if (!/ERR_ABORTED/.test(e.message)) throw e;
        await page.goto(origin + path);
      });
      await continueIntoApp(page);
      await page.locator(".concept-main").waitFor();
    };
    const noOverflow = async (label) =>
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        `${width}: ${label} scrolls sideways`,
      );
    try {
      // A disposable signed-in DM (Pin to Desk saves to the account) holding the Wayfarers campaign.
      const signup = await context.request.post(origin + "/api/account/auth/sign-up/email", {
        headers: { origin },
        data: {
          name: "Session chip audit DM",
          email: `chip-${crypto.randomUUID()}@example.com`,
          password: "disposable audit password 2026",
        },
      });
      assert.ok(signup.ok(), `signup ${signup.status()}`);
      await openApplication(page, origin + "/");
      await page.evaluate(async (table) => {
        const t = await import("/src/lib/quire/table.ts");
        t.setSeat({ ...t.getSeat(), role: "dm" });
        const economy = await import("/src/lib/quire/economy.ts");
        await economy.applyCloudTable(table);
      }, buildWayfarers());
      await go("/");

      // 1. Header chip (wide) or Settings (phones) opens the session sheet.
      const chip = page.locator("header").getByRole("button", { name: /^Session 12 · day 42\. Session controls$/ });
      const sheet = page.getByRole("dialog", { name: "Session 12 · day 42", exact: true });
      const settings = page.getByRole("dialog", { name: "Settings & Management", exact: true });
      if (phone) {
        await expect(chip).toBeHidden();
        await page.getByRole("button", { name: "Settings & Management", exact: true }).click();
        await expect(settings.getByRole("link", { name: "Help", exact: true })).toBeVisible();
        await settings.getByRole("button", { name: "Session 12 · day 42", exact: true }).click();
      } else {
        await expect(chip).toBeVisible();
        await chip.click();
      }
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText("Running: Session 12 · Smugglers of Gullhaven.");
      await expect(sheet.getByRole("heading", { name: "Since last session", exact: true })).toBeVisible();
      await expect(sheet).toContainText("Loot awarded");
      await expect(sheet).toContainText("Characters away");
      await noOverflow("session sheet");
      await page.screenshot({ path: `${output}/sheet-${width}x${height}.png` });
      await sheet.getByRole("link", { name: "End & start next", exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await expect(page.locator("#sessions").getByLabel("Session name", { exact: true })).toBeVisible();

      // 2. The Desk digest, read-only and above the Information tiles.
      const since = page.getByRole("region", { name: "Since last session", exact: true });
      await expect(since).toContainText("Since Session 11 · The Drowned Archive ended");
      await expect(since).toContainText("Money in");
      await noOverflow("Desk");

      // 3. Quick HP: absent without a running encounter, −1 / +1 through the sheet while one runs.
      const partyTile = page.getByRole("region", { name: "Party information", exact: true });
      await expect(partyTile.getByRole("group", { name: "Mira Ashfall hit points" })).toHaveCount(0);
      await page.evaluate(async () => {
        const { localEncounterRequest: call } = await import("/src/lib/encounters/local.ts");
        const { blankEncounter } = await import("/src/lib/encounters/model.mjs");
        await call("encounters/create", { id: "chip-fight", encounter: { ...blankEncounter(), name: "Chip audit fight" } });
        await call("encounters/start", { id: "local-chip-fight", revision: 0 });
      });
      await go("/");
      const hp = partyTile.getByRole("group", { name: "Mira Ashfall hit points", exact: true });
      if (!(await partyTile.isVisible()))
        await page.locator(".information-selectors").getByRole("button", { name: "Party", exact: true }).click();
      await expect(hp).toBeVisible();
      const reading = partyTile.getByRole("link").filter({ hasText: "Mira Ashfall" });
      await expect(reading).toContainText("38/44 HP");
      await hp.getByRole("button", { name: "Mira Ashfall: 1 damage", exact: true }).click();
      await expect(reading).toContainText("37/44 HP");
      await hp.getByRole("button", { name: "Mira Ashfall: heal 1", exact: true }).click();
      await expect(reading).toContainText("38/44 HP");
      const sheetHp = await page.evaluate(async () => {
        const { economySnapshot } = await import("/src/lib/quire/economy.ts");
        const t = await economySnapshot();
        return { ledger: t.ledger.length, purse: t.purses.find((p) => p.name === "Mira Ashfall")?.coins };
      });
      assert.ok(sheetHp.purse, "Mira still has her purse");
      await page.screenshot({ path: `${output}/desk-${width}x${height}.png`, fullPage: false });

      // 4. Pin to Desk from a feature header, then unpin (wide screens; phones share the code).
      if (width === 1280) {
        const ledgerBefore = sheetHp.ledger;
        await go("/features/quests");
        const pin = page.getByRole("button", { name: "Pin to Desk", exact: true });
        await expect(pin).toHaveAttribute("aria-pressed", "false");
        await pin.click();
        await expect(page.getByRole("button", { name: "Pinned to Desk", exact: true })).toHaveAttribute("aria-pressed", "true");
        await go("/");
        const pinned = page.getByRole("region", { name: "Pinned", exact: true });
        await expect(pinned.getByRole("link", { name: "Quests", exact: true })).toBeVisible();
        await expect(page.locator(".shortcut-button")).toHaveCount(0);
        await pinned.getByRole("link", { name: "Quests", exact: true }).click();
        await expect.poll(() => new URL(page.url()).pathname).toBe("/features/quests");
        await page.getByRole("button", { name: "Pinned to Desk", exact: true }).click();
        await expect(page.getByRole("button", { name: "Pin to Desk", exact: true })).toBeVisible();
        await go("/");
        await expect(pinned.getByRole("link", { name: "Quests", exact: true })).toHaveCount(0);
        const ledgerAfter = await page.evaluate(async () => (await (await import("/src/lib/quire/economy.ts")).economySnapshot()).ledger.length);
        assert.equal(ledgerAfter, ledgerBefore, "pins and HP changes post no ledger lines");
      }
      assert.deepEqual(errors, [], `${width}: no page errors`);
    } catch (error) {
      await page.screenshot({ path: `${output}/failure-${width}x${height}.png` }).catch(() => {});
      throw error;
    }
    await context.close();
    console.log(`PASS ${width}x${height}`);
  }
  console.log(
    "PASS: session chip and sheet, Since last session, End & start next, quick HP during an encounter, Pin to Desk / unpin, Help and chip in Settings on phones, 1280/390/320/844×390.",
  );
} finally {
  await browser.close();
}
