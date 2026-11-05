// XP from encounters in a disposable device campaign: the loot review's Experience section
// suggests 500 XP from a Goblin (50 XP) and an Ogre (CR 2, no XP value → 450), splits it among
// the three party characters (166 each, the 2 XP remainder unawarded until the DM gives it to
// Aria), and Transfer loot once gives the loot and the XP together, once. An encounter awarded
// without XP (as before this feature) gets XP once from Award XP on its receipt, with each share
// set by hand. No sideways scrolling at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { answerThemedDialog } from "./themed-dialogs.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = "test-results/encounter-xp";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return {
      xp: Object.fromEntries(t.purses.map((p) => [p.id, p.sheet?.xp ?? null])),
      levels: Object.fromEntries(t.purses.map((p) => [p.id, p.sheet?.level ?? null])),
      gold: t.purses.find((p) => p.id === "hoard").coins.gp,
      events: (t.journal?.events ?? []).map((e) => e.summary).filter((s) => s.startsWith("XP award")),
    };
  });
/** A concluded device encounter (optionally awarded the old way, without XP); returns its ID. */
const encounter = (page, name, award) =>
  page.evaluate(
    async ({ name, award }) => {
      const { localEncounterRequest: call } = await import("/src/lib/encounters/local.ts");
      const { blankEncounter, blankCombatant } = await import("/src/lib/encounters/model.mjs");
      const { id } = await call("encounters/create", { id: crypto.randomUUID() });
      const creature = (n, cr, xp) => ({ ...blankCombatant(), id: crypto.randomUUID(), name: n, cr, xp });
      const e = {
        ...blankEncounter(),
        name,
        combatants: [creature("Goblin", 0.25, 50), creature("Ogre", 2, 0)],
        coins: { cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 },
        coinPurseId: "hoard",
      };
      await call("encounters/save", { id, revision: 0, encounter: e });
      await call("encounters/conclude", { id, revision: 1 });
      if (award) await call("encounters/award", { id, revision: 2 });
      return id;
    },
    { name, award },
  );
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
          { id: "bram", name: "Bram Ironfoot", kind: "character", coins, sheet: sheet("Bram Ironfoot", 2, { xp: 300 }) },
          { id: "cass", name: "Cass of the Reeds", kind: "character", coins, sheet: sheet("Cass of the Reeds", 1) },
        ],
        holdings: [], shops: [], stock: [], ledger: [], listings: [], loans: [], sheets: [], notes: [],
        journal: readJournal({}),
      });
    });
    await reloadApplication(page, origin + "/party?section=characters");
    const ambush = await encounter(page, "Goblin ambush", false);
    const crypt = await encounter(page, "Old crypt", true);

    // The loot review: suggestion, split, remainder, then one transfer.
    await openApplication(page, `${origin}/encounters?encounter=${ambush}&review=1`);
    const xp = page.getByRole("region", { name: "Experience from this encounter" }).first();
    await xp.waitFor();
    await xp.getByText("Suggested: 500 XP (Goblin 50, Ogre 450 by CR).").waitFor();
    assert.equal(await xp.getByLabel("Total XP").inputValue(), "500");
    await xp.getByText("2 XP is not awarded.").waitFor();
    await xp.getByLabel("Who gets the XP remainder").selectOption({ label: "Give it to Aria Thorne" });
    await xp.getByText("Aria Thorne +168 XP").waitFor();
    assert.equal(await sideways(page), false, `${width}: the loot review scrolls sideways`);
    await xp.screenshot({ path: `${output}/review-${width}.png` });
    await page.getByRole("button", { name: "Transfer loot once", exact: true }).click();
    await answerThemedDialog(page);
    await page.getByText("Loot transferred. This encounter cannot award loot again.").waitFor();
    let b = await books(page);
    assert.deepEqual(b.xp, { hoard: null, aria: 768, bram: 466, cass: 166 });
    assert.deepEqual([b.levels.aria, b.levels.cass], [2, 1], "levels never change by themselves");
    assert.equal(b.gold, 6, "the loot moved in the same award (3 gp each from both encounters)");
    assert.deepEqual(b.events, [
      "XP award (Goblin ambush): 500 XP split among 3: Aria Thorne 168, Bram Ironfoot 166 and Cass of the Reeds 166",
    ]);
    const receipt = page.getByRole("region", { name: "Experience awarded" });
    await receipt.getByText("500 XP").waitFor();
    assert.equal(await page.getByRole("button", { name: "Award XP", exact: true }).count(), 0, "no second XP award");
    // A repeated request changes nothing.
    await page.evaluate(async (id) => {
      const { localEncounterRequest: call } = await import("/src/lib/encounters/local.ts");
      await call("encounters/award-xp", { id, xp: { unit: "xp", purseIds: ["aria"], total: 1000 } });
    }, ambush);
    assert.deepEqual(await books(page), b, "Award XP after an award with XP gives nothing");
    assert.equal(await sideways(page), false, `${width}: the receipt scrolls sideways`);

    // An encounter awarded without XP: Award XP once, each share set by hand.
    await openApplication(page, `${origin}/encounters?encounter=${crypt}`);
    const later = page.getByRole("region", { name: "Experience from this encounter" });
    await later.waitFor();
    await later.getByRole("button", { name: "Set each share" }).click();
    await later.getByLabel("XP for Aria Thorne").fill("100");
    await later.getByLabel("XP for Bram Ironfoot").fill("250");
    await later.getByLabel("XP for Cass of the Reeds").fill("0");
    await later.getByText("Bram Ironfoot +250 XP").waitFor();
    assert.equal(await sideways(page), false, `${width}: Award XP scrolls sideways`);
    await page.getByRole("button", { name: "Award XP", exact: true }).click();
    await answerThemedDialog(page);
    await page.getByText("XP awarded. This encounter cannot award XP again.").waitFor();
    b = await books(page);
    assert.deepEqual(b.xp, { hoard: null, aria: 868, bram: 716, cass: 166 });
    assert.equal(b.events.length, 2);
    assert.equal(b.events[1], "XP award (Old crypt): 350 XP split among 3: Aria Thorne 100, Bram Ironfoot 250 and Cass of the Reeds 0");
    await page.getByRole("region", { name: "Experience awarded" }).getByText("350 XP").waitFor();
    await page.screenshot({ path: `${output}/award-later-${width}.png`, fullPage: width === 1280 });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("XP from encounters browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
