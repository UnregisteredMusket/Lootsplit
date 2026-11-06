// Quests and renown (owner decision 2026-11-05 22:35 ET, factions PR C) in a disposable device
// campaign. The Black Hand (visible) and the Pale Court (hidden) exist; "Return the ledger" is
// revealed to the party. The DM sets the Pale Court as the giver and a +100 Black Hand renown
// reward for the party in the quest editor, then completes the quest: renown and Favor apply once,
// automatically. Reopening and completing again changes nothing. A second quest without rewards,
// once completed, offers a renown change pre-filled with its giver faction; nothing changes until
// the DM applies it. A player seat sees the Black Hand reward, never the hidden giver. No sideways
// scrolling at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/quest-renown", { recursive: true });
const standing = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return Object.fromEntries((t.journal?.factions ?? []).map((f) => [f.id, f.standing]));
  });
const seat = (page, role) =>
  page.evaluate(async (role) => {
    const { DM_SEAT, setSeat } = await import("/src/lib/quire/table.ts");
    setSeat(role === "dm" ? DM_SEAT : { ...DM_SEAT, role: "player", purseIds: ["aria"], shopIds: [] });
  }, role);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const editor = (page) => page.getByTestId("quest-renown-editor");
async function complete(page) {
  await page.getByRole("button", { name: "Close quest…" }).click();
  await page.getByRole("button", { name: "Mark completed" }).click();
  await page.getByText("Quest completed.").first().waitFor();
}
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/market");
    await page.evaluate(async () => {
      const { applyCloudTable, blankPurse, executeLocalCommand } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const { defaultFactionDraft } = await import("/src/lib/quire/factions.ts");
      const pc = (id, name) => ({ ...blankPurse("character"), id, name, coins: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 } });
      await applyCloudTable({
        purses: [pc("aria", "Aria Thorne"), pc("bram", "Bram Ironfoot")],
        holdings: [], shops: [], stock: [], ledger: [], listings: [], loans: [], sheets: [], notes: [],
        journal: readJournal({ finance: { day: 1 } }),
      });
      const quest = (title) => ({ title, summary: "", locationIds: [], markers: [], areas: [], objectives: [] });
      for (const cmd of [
        { id: "s1", kind: "faction-save", factionId: "hand", revision: null, faction: { ...defaultFactionDraft(), name: "The Black Hand" } },
        { id: "s2", kind: "faction-save", factionId: "court", revision: null, faction: { ...defaultFactionDraft(), name: "The Pale Court" } },
        { id: "v1", kind: "faction-visibility", factionId: "hand", revision: 0, hidden: false },
        { id: "q1", kind: "quest-save", questId: null, revision: null, quest: quest("Return the ledger") },
        { id: "r1", kind: "quest-reveal", questId: "q1", revision: 0, audience: { kind: "party" } },
        { id: "q2", kind: "quest-save", questId: null, revision: null, quest: quest("Find the courier") },
        { id: "r2", kind: "quest-reveal", questId: "q2", revision: 0, audience: { kind: "party" } },
        { id: "g2", kind: "quest-renown", questId: "q2", revision: 1, giverFactionId: "hand", rewards: [] },
      ])
        await executeLocalCommand(cmd);
    });
    // The DM configures the giver and a party reward, then completes the quest.
    await openApplication(page, origin + "/features/quests?quest=q1");
    await editor(page).waitFor();
    await editor(page).getByLabel("Giver faction").selectOption("court");
    await editor(page).getByRole("button", { name: "Add a renown reward" }).click();
    await editor(page).getByLabel("Reward 1 faction").selectOption("hand");
    await editor(page).getByLabel("Reward 1 renown change").fill("100");
    await editor(page).getByRole("button", { name: "Save renown" }).click();
    await editor(page).getByText("Renown rewards saved.").waitFor();
    assert.equal(await sideways(page), false, `${width}: the quest editor scrolls sideways`);
    await editor(page).screenshot({ path: `test-results/quest-renown/editor-${width}.png` });
    assert.deepEqual((await standing(page)).hand, {}, "nothing changes before completion");
    await page.getByRole("button", { name: "Close quest…" }).click();
    await page.getByTestId("quest-close-renown").waitFor();
    await page.getByRole("button", { name: "Mark completed" }).click();
    await page.getByText("Quest completed.").first().waitFor();
    await editor(page).getByTestId("quest-renown-applied").getByText("The Black Hand +100 renown · the party").waitFor();
    assert.deepEqual((await standing(page)).hand, { aria: [100, 100], bram: [100, 100] }, `${width}: applied once with Favor`);
    // Reopen and complete again: nothing more.
    await page.getByRole("button", { name: "Reopen…" }).click();
    await page.getByRole("button", { name: "Reopen quest" }).click();
    await page.getByText("Quest reopened.").first().waitFor();
    await complete(page);
    assert.deepEqual((await standing(page)).hand, { aria: [100, 100], bram: [100, 100] }, `${width}: never repeated`);

    // A quest without rewards offers a change, pre-filled with its giver faction.
    await openApplication(page, origin + "/features/quests?quest=q2");
    await editor(page).waitFor();
    await complete(page);
    const offer = page.getByTestId("quest-renown-offer");
    await offer.waitFor();
    assert.equal(await offer.getByLabel("Offer faction").inputValue(), "hand");
    assert.deepEqual((await standing(page)).hand, { aria: [100, 100], bram: [100, 100] }, "the offer changes nothing by itself");
    await offer.getByLabel("Offer renown change").fill("25");
    await offer.getByRole("button", { name: "Apply renown" }).click();
    await offer.waitFor({ state: "detached" });
    assert.deepEqual((await standing(page)).hand, { aria: [125, 125], bram: [125, 125] });
    assert.equal(await sideways(page), false, `${width}: the offer scrolls sideways`);

    // A player seat: the visible reward, never the hidden giver faction.
    await seat(page, "player");
    await openApplication(page, origin + "/features/quests?quest=q1");
    const renown = page.getByTestId("player-quest-renown");
    await renown.getByText("The Black Hand +100 renown · the party").waitFor();
    const text = await page.locator("main").innerText();
    assert.ok(!text.includes("Pale Court"), `${width}: the player sees the hidden giver`);
    assert.equal(await sideways(page), false, `${width}: the player's quest scrolls sideways`);
    await renown.screenshot({ path: `test-results/quest-renown/player-${width}.png` });
    await seat(page, "dm");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Quest renown browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
