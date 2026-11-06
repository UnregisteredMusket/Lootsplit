// The favor market (owner design 2026-11-05, factions PR B) in a disposable device campaign. The
// Black Hand (visible) already knows the party: Aria and Bram 10 renown and 10 Favor each. The DM
// opens its Favor market (no entries by default), adds "A rumour about a rival" from the template
// with a secret to reveal, and a hidden "The vault key". A request for the rumour is recorded for
// Aria (the DM's device records requests; a player-only link can't send them) and the DM approves
// it: 4 Favor spent exactly once. The DM records a safe house for Bram directly. A player seat
// sees the rumour (never the hidden key), Aria's own purchase with the secret, and none of Bram's.
// No sideways scrolling at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/favor-market", { recursive: true });
const SECRET = "The harbourmaster takes bribes.";
const snapshot = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return t.journal?.factions?.find((f) => f.id === "hand");
  });
const seat = (page, role) =>
  page.evaluate(async (role) => {
    const { DM_SEAT, setSeat } = await import("/src/lib/quire/table.ts");
    setSeat(role === "dm" ? DM_SEAT : { ...DM_SEAT, role: "player", purseIds: ["aria"], shopIds: [] });
  }, role);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const openMarket = async (page) => {
  await openApplication(page, origin + "/features/factions");
  const fold = page.getByRole("button", { name: /^Favor market/ }).first();
  // It opens by itself while requests are waiting.
  if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
  await page.getByTestId("favor-market-manager").waitFor();
};
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/market");
    await page.evaluate(async () => {
      const { applyCloudTable, blankPurse } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const { defaultFactionDraft } = await import("/src/lib/quire/factions.ts");
      const pc = (id, name) => ({ ...blankPurse("character"), id, name, coins: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 } });
      const d = defaultFactionDraft();
      await applyCloudTable({
        purses: [pc("aria", "Aria Thorne"), pc("bram", "Bram Ironfoot")],
        holdings: [], shops: [], stock: [], ledger: [], listings: [], loans: [], sheets: [], notes: [],
        journal: readJournal({
          finance: { day: 1 },
          factions: [{
            ...d, id: "hand", name: "The Black Hand", description: "Smugglers of the docks.",
            standing: { aria: [10, 10], bram: [10, 10] }, revision: 0,
          }],
        }),
      });
    });
    await openMarket(page);
    const market = page.getByTestId("favor-market-manager");
    await market.getByText("No entries yet.").waitFor();
    // From the template, edited before saving.
    await market.getByRole("button", { name: "Add an entry" }).click();
    let form = market.getByTestId("favor-entry-form-add");
    await form.getByLabel("Add from template").selectOption({ label: "A rumour about a rival" });
    assert.equal(await form.getByLabel("Entry name").inputValue(), "A rumour about a rival");
    await form.getByLabel("Revealed to the buyer").fill(SECRET);
    await form.getByRole("button", { name: "Add entry" }).click();
    await market.getByTestId("favor-entry").filter({ hasText: "A rumour about a rival" }).waitFor();
    form = market.getByTestId("favor-entry-form-add");
    await form.getByLabel("Entry name").fill("The vault key");
    await form.getByLabel("Cost").fill("9");
    await form.getByLabel("Kind").selectOption("item");
    await form.getByLabel("Shown to players").selectOption("hidden");
    await form.getByRole("button", { name: "Add entry" }).click();
    await market.getByTestId("favor-entry").filter({ hasText: "The vault key" }).waitFor();
    await form.getByLabel("Add from template").selectOption({ label: "Safe house for a night" });
    await form.getByRole("button", { name: "Add entry" }).click();
    await market.getByTestId("favor-entry").filter({ hasText: "Safe house for a night" }).waitFor();
    let hand = await snapshot(page);
    assert.deepEqual(hand.favorMarket.map((e) => [e.name, e.cost, e.hidden]), [
      ["A rumour about a rival", 4, false],
      ["The vault key", 9, true],
      ["Safe house for a night", 3, false],
    ]);
    // Aria's request, recorded on the DM's device, then approved in the market.
    await page.evaluate(async () => {
      const { executeLocalCommand } = await import("/src/lib/quire/economy.ts");
      const t = (await (await import("/src/lib/quire/economy.ts")).economySnapshot()).journal.factions[0];
      const rumour = t.favorMarket[0];
      await executeLocalCommand({ id: "ask-1", kind: "favor-request", factionId: "hand", entryId: rumour.id, characterId: "aria", cost: 4, note: "Who runs the docks?" });
    });
    await openMarket(page);
    const pending = page.getByTestId("favor-pending");
    await pending.getByText("Who runs the docks?").waitFor();
    await pending.getByRole("button", { name: "Approve" }).click();
    await page.getByText("Approved: Aria Thorne spent 4 Favor on A rumour about a rival.").waitFor();
    hand = await snapshot(page);
    assert.deepEqual(hand.standing.aria, [10, 6], `${width}: 4 Favor spent once`);
    assert.equal(hand.favorRequests[0].secret, SECRET);
    // A purchase recorded directly for Bram.
    const safe = page.getByTestId("favor-entry").filter({ hasText: "Safe house for a night" });
    await safe.getByLabel("Record Safe house for a night for").selectOption("bram");
    await safe.getByRole("button", { name: "Record purchase" }).click();
    await safe.getByText("Recorded: Bram Ironfoot spent 3 Favor.").waitFor();
    assert.deepEqual((await snapshot(page)).standing.bram, [10, 7]);
    assert.equal(await sideways(page), false, `${width}: the DM's favor market scrolls sideways`);
    await page.getByTestId("favor-market-manager").screenshot({ path: `test-results/favor-market/dm-${width}.png` });

    // A player seat: visible entries, Aria's own purchase with its secret, nothing of Bram's.
    await seat(page, "player");
    await openApplication(page, origin + "/features/factions");
    await page.getByTestId("player-faction").getByRole("button", { name: /^Favor market/ }).click();
    const mine = page.getByTestId("player-favor-market");
    await mine.getByTestId("favor-entry").filter({ hasText: "A rumour about a rival" }).waitFor();
    await mine.getByTestId("favor-secret").getByText(SECRET).waitFor();
    const text = await page.locator("main").innerText();
    for (const hidden of ["The vault key", "Bram"]) assert.ok(!text.includes(hidden), `${width}: the player sees ${hidden}`);
    assert.equal(await mine.getByTestId("favor-request").count(), 1, `${width}: only Aria's own request`);
    // A player-only device link can't send requests: the reason is shown and nothing changes.
    await mine.getByTestId("favor-entry").filter({ hasText: "Safe house for a night" }).getByRole("button", { name: "Ask for this" }).click();
    await mine.getByText(/Ask the DM to record it/).waitFor();
    assert.equal(await sideways(page), false, `${width}: the player's favor market scrolls sideways`);
    await mine.screenshot({ path: `test-results/favor-market/player-${width}.png` });
    await seat(page, "dm");
    assert.equal((await snapshot(page)).favorRequests.length, 2, "nothing was added by the player link");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Favor market browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
