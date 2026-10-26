// Quest log (docs/QUESTS.md) in a disposable device campaign: the DM writes a quest with a hidden
// objective and DM notes, reveals it to one character, updates and closes it; the player sees it
// (without the hidden objective, DM notes or DM-only chronicle lines), follows it, writes a private
// note and gets a "Quest updated" toast; another player's log stays empty. Desk card, Home card,
// NPC strip and the Here sheet's "Quests here". At 1280, 390 and 320 px without sideways scrolling.
// Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/quest-log", { recursive: true });
const SECRETS = ["Learn who paid the drover", "Hollin sold her himself", "Hollin is lying about the price"];
const noOverflow = async (page, label) => {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${label}: the page scrolls sideways`,
  );
  const dialog = page.getByRole("dialog");
  if (await dialog.count())
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      false,
      `${label}: the dialog scrolls sideways`,
    );
};
const book = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    return await economySnapshot();
  });
const quests = async (page) => (await book(page)).journal?.quests?.quests ?? [];
const seatAs = (page, purseIds) =>
  page.evaluate(async (ids) => {
    const { setSeat, DM_SEAT } = await import("/src/lib/quire/table.ts");
    setSeat(ids ? { ...DM_SEAT, role: "player", purseIds: ids, shopIds: [], openedAt: Date.now() } : DM_SEAT);
  }, purseIds);
/** A DM change arriving as if synced from another device (the shared engine, then a refresh). */
const dmChange = (page, command) =>
  page.evaluate(async (command) => {
    const { applyCloudTable, economySnapshot } = await import("/src/lib/quire/economy.ts");
    const { applyCommand } = await import("/src/lib/quire/commands.ts");
    const next = applyCommand(await economySnapshot(), { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] }, command);
    await applyCloudTable(next);
    window.dispatchEvent(new Event("focus"));
  }, command);
const visibleText = (page) => page.evaluate(() => document.body.innerText);

try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 780 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/features/quests");
    // Disposable campaign: three player characters and Hollin, a visible livery keeper, in Harrowgate.
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = () => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
      await applyCloudTable({
        purses: [
          { id: "fund", name: "Party fund", kind: "party", coins: coins() },
          { id: "tamsin", name: "Tamsin Reed", kind: "character", coins: coins() },
          { id: "rowan", name: "Rowan Vale", kind: "character", coins: coins() },
          { id: "mira", name: "Mira Ashfall", kind: "character", coins: coins() },
          { id: "hollin", name: "Hollin Marsh", kind: "character", control: "npc", nonParty: true, coins: coins() },
        ],
        holdings: [],
        shops: [],
        stock: [],
        ledger: [{ id: "advance", at: Date.now(), purseId: "tamsin", shopId: null, summary: "Advance from Hollin", copper: 1500 }],
        listings: [],
        loans: [],
        sheets: [],
        notes: [],
        journal: readJournal({
          market: {
            currentLocationId: "harrowgate",
            locations: [
              { id: "vale", name: "Vale of Harrow", kind: "region", parentId: null, description: "" },
              { id: "harrowgate", name: "Harrowgate", kind: "town", parentId: "vale", description: "" },
              { id: "north-road", name: "North Road", kind: "area", parentId: "harrowgate", description: "" },
            ],
          },
          sessions: [{ id: "s12", name: "Session 12", startedAt: Date.now() - 1000 }],
          world: {
            maps: [{ id: "harrowgate-map", name: "Harrowgate", image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", locationId: "harrowgate", visible: true, type: "city", anchors: [], markers: [] }],
            npcs: [{ id: "hollin", name: "Hollin Marsh", description: "Livery keeper", locationId: "harrowgate", visible: true, barterAllowed: false, controllerPurseId: null }],
          },
        }),
      });
    });
    await reloadApplication(page, origin + "/features/quests");
    await page.getByRole("heading", { name: "Quests", exact: true }).waitFor();

    // DM: create a draft with a hidden objective and DM notes.
    await page.getByRole("button", { name: "New quest", exact: true }).click();
    const editor = page.getByRole("article", { name: "New quest" });
    await editor.getByLabel("Quest name").fill("Hollin's Missing Mare");
    await editor.getByLabel("Given by").selectOption("hollin");
    await editor.getByLabel("Where").selectOption("harrowgate");
    await editor.getByLabel("What the players read").fill("Clover vanished from the livery. Bring her home.");
    await editor.getByRole("button", { name: "Add objective" }).click();
    await editor.getByLabel("Objective 1", { exact: true }).fill("Ask at the livery who last rode Clover");
    await editor.getByRole("button", { name: "Add objective" }).click();
    await editor.getByLabel("Objective 2", { exact: true }).fill("Follow the tracks north of Harrowgate");
    await editor.getByLabel("Place for objective 2").selectOption("north-road");
    await editor.getByRole("button", { name: "Add objective" }).click();
    await editor.getByLabel("Objective 3", { exact: true }).fill(SECRETS[0]);
    await editor.getByRole("checkbox", { name: "Hidden from players" }).nth(2).check();
    await editor.getByLabel("Promised reward (players read this)").fill("Free stabling for a season and 15 gp");
    await editor.getByLabel("DM notes").fill(SECRETS[1]);
    await noOverflow(page, `editor ${width}`);
    await page.screenshot({ path: `test-results/quest-log/dm-new-${width}.png`, fullPage: true });
    await editor.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.waitForFunction(async () => {
      const { economySnapshot } = await import("/src/lib/quire/economy.ts");
      return ((await economySnapshot()).journal?.quests?.quests ?? []).length === 1;
    });
    let [quest] = await quests(page);
    assert.equal(quest.audience.kind, "none");
    assert.equal(quest.objectives[2].hidden, true);

    // Reveal to Tamsin only, with a private message.
    const dmEditor = page.getByRole("article", { name: "Edit Hollin's Missing Mare" });
    await dmEditor.waitFor();
    await dmEditor.getByRole("button", { name: "Save & reveal…" }).click();
    const reveal = page.getByRole("dialog", { name: "Who knows about it?" });
    await reveal.getByRole("radio", { name: /Chosen characters/ }).check();
    await reveal.getByRole("checkbox", { name: "Tamsin Reed" }).check();
    await reveal.getByText(/Your DM notes and 1 hidden objective stay with you/).waitFor();
    await noOverflow(page, `reveal ${width}`);
    await page.screenshot({ path: `test-results/quest-log/dm-reveal-${width}.png`, fullPage: true });
    await reveal.getByRole("button", { name: "Reveal to 1 character" }).click();
    await reveal.waitFor({ state: "detached" });
    [quest] = await quests(page);
    assert.deepEqual(quest.audience, { kind: "characters", purseIds: ["tamsin"] });
    assert.equal((await book(page)).notes.filter((n) => n.purseId === "tamsin" && n.text.includes("Hollin's Missing Mare")).length, 1);

    // Update: a DM-only chronicle line, then mark the first objective done.
    await dmEditor.getByRole("button", { name: "Add entry" }).click();
    const entry = page.getByRole("dialog", { name: "Add a chronicle entry" });
    await entry.getByLabel("Entry").fill(SECRETS[2]);
    await entry.getByRole("switch", { name: "Shared with players" }).click();
    await entry.getByRole("button", { name: "Add entry" }).click();
    await entry.waitFor({ state: "detached" });
    await dmEditor.getByRole("button", { name: "Mark done" }).first().click();
    await page.waitForFunction(async () => {
      const { economySnapshot } = await import("/src/lib/quire/economy.ts");
      return (await economySnapshot()).journal?.quests?.quests?.[0]?.objectives?.[0]?.state === "done";
    });
    // View as player: the real projection for Tamsin (no hidden objective, DM notes or DM-only line).
    await dmEditor.getByRole("button", { name: "View as player" }).click();
    const preview = page.getByRole("dialog", { name: "What players see" });
    await preview.getByText("Follow the tracks north of Harrowgate").waitFor();
    const previewText = await preview.innerText();
    for (const secret of SECRETS) assert.equal(previewText.includes(secret), false, `preview shows: ${secret}`);
    await preview.getByRole("button", { name: "Close" }).click();
    await preview.waitFor({ state: "detached" });
    await noOverflow(page, `dm detail ${width}`);
    await page.screenshot({ path: `test-results/quest-log/dm-detail-${width}.png`, fullPage: true });
    // Nothing moved.
    const books = await book(page);
    assert.equal(books.ledger.length, 1);
    assert.deepEqual(books.purses.map((p) => p.coins.gp), [0, 0, 0, 0, 0]);

    // Desk: Current session lists the quest.
    await openApplication(page, origin + "/?view=home");
    await page.getByText("Quests in play").first().waitFor();
    // NPC strip.
    await openApplication(page, origin + "/features/npcs");
    await page.getByRole("region", { name: "Quests from Hollin Marsh" }).getByText("Hollin's Missing Mare").waitFor();

    // Player Tamsin: sees the quest without hidden parts, follows it and writes a private note.
    await seatAs(page, ["tamsin"]);
    await openApplication(page, origin + "/features/quests");
    await page.getByRole("heading", { name: "Quest log", exact: true }).waitFor();
    await page.getByRole("button", { name: /Hollin's Missing Mare/ }).click();
    await page.getByText("Clover vanished from the livery. Bring her home.").waitFor();
    await page.getByText("Follow the tracks north of Harrowgate").waitFor();
    let text = await visibleText(page);
    for (const secret of SECRETS) assert.equal(text.includes(secret), false, `player sees: ${secret}`);
    await page.getByRole("button", { name: "Follow this quest" }).click();
    await page.getByLabel("Add a private note").fill("The drover had a Saltmere accent.");
    await page.getByRole("button", { name: "Save note" }).click();
    await page.getByText("The drover had a Saltmere accent.", { exact: true }).waitFor();
    const note = (await book(page)).journal.entries.find((e) => e.questId === quest.id);
    assert.equal(note.visibility, "player");
    await noOverflow(page, `player detail ${width}`);
    await page.screenshot({ path: `test-results/quest-log/player-detail-${width}.png`, fullPage: true });

    // A DM update arrives: the toast names it.
    [quest] = await quests(page);
    await dmChange(page, { id: `audit-log-${width}`, kind: "quest-log", questId: quest.id, revision: quest.revision, text: "The stable boy saw a drover leading a grey mare north.", shared: true });
    await page.getByText(/Quest updated · Hollin's Missing Mare/).waitFor();
    await page.screenshot({ path: `test-results/quest-log/player-toast-${width}.png` });

    // Home: the Following card and the quest log link.
    await openApplication(page, origin + "/");
    await page.getByRole("region", { name: "Following: Hollin's Missing Mare" }).waitFor();
    await page.getByRole("link", { name: /Quest log/ }).first().waitFor();
    await noOverflow(page, `player home ${width}`);
    await page.screenshot({ path: `test-results/quest-log/player-home-${width}.png`, fullPage: true });

    // Here sheet: the quest is at the party's place (Harrowgate).
    await openApplication(page, origin + "/maps?map=harrowgate-map");
    const frame = page.getByRole("region", { name: "Map workspace", exact: true });
    await frame.getByRole("button", { name: /^Here/ }).click();
    const questsHere = frame.getByRole("region", { name: "Quests here" });
    await questsHere.getByText("Hollin's Missing Mare").waitFor();
    await noOverflow(page, `here ${width}`);
    await page.screenshot({ path: `test-results/quest-log/here-${width}.png` });
    await questsHere.getByRole("button", { name: "Read: Hollin's Missing Mare" }).click();
    await page.getByRole("heading", { name: "Quest log", exact: true }).waitFor();

    // Mira: another player's personal quest is not visible.
    await seatAs(page, ["mira"]);
    await openApplication(page, origin + "/features/quests");
    await page.getByText("No quests yet.", { exact: false }).waitFor();
    text = await visibleText(page);
    assert.equal(text.includes("Hollin's Missing Mare"), false);

    // DM closes it; Done tab.
    await seatAs(page, null);
    await openApplication(page, origin + `/features/quests?quest=${encodeURIComponent(quest.id)}`);
    await page.getByRole("button", { name: "Close quest…" }).click();
    const close = page.getByRole("dialog", { name: "Close this quest" });
    await close.getByLabel("Closing entry (shared with players)").fill("Clover is home.");
    await close.getByRole("button", { name: "Mark completed" }).click();
    await close.waitFor({ state: "detached" });
    [quest] = await quests(page);
    assert.equal(quest.status, "completed");
    await seatAs(page, ["tamsin"]);
    await openApplication(page, origin + "/features/quests");
    await page.getByRole("tab", { name: /Done/ }).click();
    await page.getByRole("button", { name: /Hollin's Missing Mare/ }).waitFor();
    await noOverflow(page, `player done ${width}`);
    await page.screenshot({ path: `test-results/quest-log/player-done-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS quest log: DM draft with hidden objective and DM notes, reveal to one character with a private message, DM-only chronicle line, objective done, Desk card and NPC strip; player view without hidden parts, follow, private note, Quest updated toast, Home card, Here sheet; another player sees nothing; close to Done; nothing moved; 1280/390/320 px without sideways scrolling.",
  );
} finally {
  await browser.close();
}
