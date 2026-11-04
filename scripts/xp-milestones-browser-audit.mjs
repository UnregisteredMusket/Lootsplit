// XP and milestones (loot plan phase 6) in a disposable device campaign: the DM opens Party →
// Characters → Award XP or milestones, splits 1,000 XP among three characters (the preview shows
// the 1 XP remainder; it goes to Aria), awards it once, sees Ready to level up on Party and on
// Aria's sheet, and Set level to 3 only changes the draft. No sideways scrolling at 1280, 390 and
// 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/xp-milestones", { recursive: true });
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return {
      sheets: Object.fromEntries(t.purses.map((p) => [p.id, p.sheet ? { xp: p.sheet.xp, level: p.sheet.level } : null])),
      events: (t.journal?.events ?? []).map((e) => e.summary),
      ledger: t.ledger.length,
    };
  });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/party?section=characters");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const { blankSheet } = await import("/src/lib/characters/model.mjs");
      const coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
      const sheet = (name, level, extra = {}) => ({ ...blankSheet(), name, level, ...extra });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins },
          { id: "aria", name: "Aria Thorne", kind: "character", coins, sheet: sheet("Aria Thorne", 2, { xp: 600 }) },
          { id: "bram", name: "Bram Ironfoot", kind: "character", coins, sheet: sheet("Bram Ironfoot", 3) },
          { id: "cass", name: "Cass of the Reeds", kind: "character", coins, sheet: sheet("Cass of the Reeds", 1) },
        ],
        holdings: [],
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
    await reloadApplication(page, origin + "/party?section=characters");
    await page.getByText("600 XP · level 3 at 900").waitFor();
    await page.getByRole("button", { name: "Award XP or milestones" }).click();
    const dialog = page.getByRole("dialog", { name: "Award XP or milestones" });
    await dialog.waitFor();
    await dialog.getByLabel("XP to award").fill("1000");
    const preview = dialog.getByRole("region", { name: "Award preview" });
    await preview.getByText("1 XP is not awarded.").waitFor();
    await dialog.getByLabel("Who gets the remainder").selectOption({ label: "Give it to Aria Thorne" });
    await preview.getByText("+334 XP → 934 XP · ready to level up to 3").waitFor();
    assert.equal(await preview.getByText("1 XP is not awarded.").count(), 0);
    await dialog.getByLabel("What the award is for").fill("Goblin warren");
    assert.equal(await sideways(page), false, `${width}: the award form scrolls sideways`);
    await dialog.screenshot({ path: `test-results/xp-milestones/form-${width}.png` });
    await dialog.getByRole("button", { name: "Award XP" }).click();
    await page.getByText("Award recorded.").first().waitFor();
    const after = await books(page);
    assert.deepEqual(after.sheets.aria, { xp: 934, level: 2 }, "the level is unchanged");
    assert.deepEqual(after.sheets.bram, { xp: 333, level: 3 });
    assert.deepEqual(after.sheets.cass, { xp: 333, level: 1 });
    assert.equal(after.ledger, 0, "XP is not money");
    assert.equal(
      after.events.filter((s) => s === "XP award (Goblin warren): 1,000 XP split among 3: Aria Thorne 334, Bram Ironfoot 333 and Cass of the Reeds 333").length,
      1,
    );
    await page.getByText("Ready to level up: level 3").first().waitFor();
    assert.equal(await sideways(page), false, `${width}: Party scrolls sideways`);
    await page.screenshot({ path: `test-results/xp-milestones/party-${width}.png`, fullPage: width === 1280 });
    // Aria's sheet: the prompt, and Set level only changes the draft.
    await page
      .locator("article.party-profile", { hasText: "Aria Thorne" })
      .getByRole("link", { name: "Open sheet" })
      .click();
    const notice = page.locator(".level-up-notice");
    await notice.getByText("Ready to level up").waitFor();
    assert.equal(await sideways(page), false, `${width}: the sheet scrolls sideways`);
    await notice.getByRole("button", { name: "Set level to 3 (review, then save)" }).click();
    await page.getByLabel("Character level").waitFor();
    assert.equal(await page.getByLabel("Character level").inputValue(), "3");
    await page.getByText("Unsaved changes — save before rolling").waitFor();
    assert.equal((await books(page)).sheets.aria.level, 2, "nothing is saved until the person saves");
    await page.screenshot({ path: `test-results/xp-milestones/sheet-${width}.png` });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("XP and milestones browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
