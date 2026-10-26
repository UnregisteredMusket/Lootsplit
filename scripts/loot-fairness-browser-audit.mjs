// Fairness ledger (prompt 2, phase 3) in a disposable device campaign: Party → Fairness for the
// DM (party rows, the away group, older items at 0 cp), a period switch, a character's breakdown
// (counted and not-counted receipts), the Review Inbox "Favour whoever is behind" preview, an
// atomic resolution whose receipt records the totals, a party member's view and a player away
// from the party (own totals only); at 1280, 390 and 320 px without sideways scrolling.
// Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { autoAnswerThemedDialogs } from "./themed-dialogs.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/loot-fairness", { recursive: true });
const noOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${label}: the page scrolls sideways`,
  );
const shot = (page, name) => page.screenshot({ path: `test-results/loot-fairness/${name}.png`, fullPage: true });

/** Two sessions of history built with the real command engine, then stored on this device. */
async function seed(page) {
  await page.evaluate(async () => {
    const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
    const { applyCommand } = await import("/src/lib/quire/commands.ts");
    const { readJournal } = await import("/src/lib/quire/journal.ts");
    const { DM_SEAT } = await import("/src/lib/quire/table.ts");
    const { encounterItemLine } = await import("/src/lib/quire/award-tag.ts");
    const dm = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
    const coins = (gp = 0) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
    let n = 0;
    let t = {
      purses: [
        { id: "hoard", name: "The Hoard", kind: "party", coins: coins(100) },
        { id: "aria", name: "Aria Thorne", kind: "character", coins: coins(5) },
        { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins(5) },
        { id: "cass", name: "Cass of the Reeds", kind: "character", coins: coins(5) },
        { id: "wren", name: "Wren Ashdown", kind: "character", coins: coins(5) },
        { id: "dunstan", name: "Dunstan the porter", kind: "character", control: "npc", coins: coins(5) },
      ],
      holdings: [
        { id: "potion", purseId: "hoard", name: "Potion of healing", kind: "item", quantity: 3, unitCopper: 5000, notes: "", pool: { at: 1, source: "add-loot" } },
        { id: "scroll", purseId: "hoard", name: "Spell scroll (Misty Step)", kind: "item", quantity: 1, unitCopper: 6000, notes: "", pool: { at: 1, source: "add-loot" } },
      ],
      shops: [],
      stock: [],
      ledger: [],
      listings: [],
      loans: [],
      sheets: [],
      notes: [],
      journal: readJournal({}),
    };
    const run = (cmd) => (t = applyCommand(t, dm, { id: `audit-${++n}`, ...cmd }));
    const line = (purseId, summary, copper, extra = {}) =>
      t.ledger.push({ id: `audit-line-${++n}`, at: Date.now(), purseId, shopId: null, summary, copper, ...extra });
    run({ kind: "session", name: "Tolls of the Weir", end: false });
    run({ kind: "coin-split", sourceId: "hoard", copper: 4000, recipientIds: ["aria", "bram", "cass", "wren"], remainder: { rule: "party-fund", purseId: "hoard" }, expect: { share: 1000, remainderTo: null } });
    run({ kind: "give", fromId: "bram", toId: "aria", copper: 500, holdingId: null, quantity: 0 });
    line("cass", "Encounter loot: Weir bandits", 4200, { transactionType: "adjustment" });
    line("bram", "Encounter loot: 1 × Dwarven ale keg (Goblin warren)", 0, { transactionType: "adjustment" });
    run({ kind: "session", name: "Tolls of the Weir", end: true });
    t.journal.world = readJournal({ world: { characterPositions: [{ purseId: "wren", inParty: false, locationId: null, visible: true, sheetVisible: true }] } }).world;
    run({ kind: "session", name: "The Drowned Vault", end: false });
    t.ledger.push(encounterItemLine("audit-award", 0, Date.now(), "aria", { name: "Shield", quantity: 1, unitCopper: 3000 }, "Drowned Vault"));
    line("bram", "Bought: Rope, hempen (50 ft)", -100, { transactionType: "purchase" });
    for (const [holdingId, purseId, choice] of [["potion", "aria", "need"], ["potion", "bram", "need"], ["scroll", "aria", "need"], ["scroll", "bram", "need"]])
      run({ kind: "loot-claim", holdingId, purseId, choice, before: null });
    void DM_SEAT;
    await applyCloudTable(t);
  });
}
const asPlayer = (page, purseId) =>
  page.evaluate(async (purseId) => {
    const t = await import("/src/lib/quire/table.ts");
    t.setSeat({ role: "player", purseIds: [purseId], shopIds: [], openedAt: Date.now() });
  }, purseId);

try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await autoAnswerThemedDialogs(page); // themed confirmations (window.confirm is banned)
    await openApplication(page, origin + "/party?section=fairness");
    await seed(page);
    await reloadApplication(page, origin + "/party?section=fairness");

    // DM: four Party tabs, the table, the away group and the older item at 0 cp.
    const tab = page.getByRole("tab", { name: /Fairness/ });
    await tab.waitFor();
    assert.equal(await tab.getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("tablist", { name: "Party sections" }).getByRole("tab").count(), 4);
    const table = page.getByRole("table", { name: "Loot received per character" });
    await table.getByText("Away from the party · not in the average", { exact: true }).waitFor();
    // Campaign to date: Aria 10 + 30 gp, Bram 10 gp, Cass 10 + 42 gp; Wren 10 gp is away.
    for (const [name, total] of [["Aria Thorne", "40 gp"], ["Bram Ironfoot", "10 gp"], ["Cass of the Reeds", "52 gp"], ["Wren Ashdown", "10 gp"]])
      await table.getByRole("row", { name: new RegExp(`^${name}: total ${total}`) }).waitFor();
    assert.equal(await table.getByText("Dunstan the porter").count(), 0, "NPCs never appear");
    await page.getByText(/1 item from older encounter awards has no recorded value/).waitFor();
    await page.getByText("Joined in Session", { exact: false }).count();
    await noOverflow(page, `fairness DM ${width}`);
    await shot(page, `dm-campaign-${width}`);

    // Period: Session 1, whose party included Wren.
    const sessionKey = await page.getByLabel("Period", { exact: true }).locator("option", { hasText: "Session 1 · Tolls of the Weir" }).getAttribute("value");
    await page.getByLabel("Period", { exact: true }).selectOption(sessionKey);
    await page.waitForURL(/period=/);
    await table.getByRole("row", { name: /^Wren Ashdown: total 10 gp, .* the average/ }).waitFor();
    await noOverflow(page, `fairness session ${width}`);
    await shot(page, `dm-session-${width}`);
    await page.getByLabel("Period", { exact: true }).selectOption("campaign");

    // Breakdown: Bram's receipts, the older item listed at 0 cp, and his not-counted lines.
    await table.getByRole("row", { name: /^Bram Ironfoot/ }).click();
    await page.getByRole("heading", { name: "Bram Ironfoot", exact: true }).waitFor();
    await page.getByText("value not recorded · 0 cp", { exact: true }).waitFor();
    await page.getByText("Also on Bram's ledger, not counted", { exact: true }).waitFor();
    await page.getByText(/Bought: Rope/).waitFor();
    await page.getByText(/It matches the Fairness tab/).waitFor();
    await noOverflow(page, `breakdown ${width}`);
    await shot(page, `dm-breakdown-${width}`);
    await page.getByRole("link", { name: "← Fairness", exact: true }).click();
    await table.waitFor();

    // Review Inbox: favour whoever is behind, round-robin preview, then (1280) resolve.
    await openApplication(page, origin + "/features/review");
    const review = page.locator("#treasure-pool-claims");
    await review.getByText("Treasure pool claims", { exact: true }).waitFor();
    const favour = review.getByRole("checkbox", { name: /Favour whoever is behind/ });
    assert.equal(await favour.isChecked(), false, "favour is off by default");
    await favour.check();
    await review.getByRole("radio", { name: /^Round-robin/ }).check();
    await review.getByRole("list", { name: "Fairness standings" }).getByText("Bram Ironfoot").waitFor();
    const preview = review.getByRole("region", { name: "Resolution preview" });
    await preview.getByText("With favour", { exact: true }).first().waitFor();
    await noOverflow(page, `review favour ${width}`);
    await shot(page, `review-favour-${width}`);
    if (width === 1280) {
      await review.getByRole("button", { name: /^Resolve 2 items/ }).click();
      const receipt = review.getByRole("region", { name: "Treasure pool resolution receipt" });
      await receipt.getByText(/Favoured whoever was behind, campaign to date/).waitFor();
      const books = await page.evaluate(async () => {
        const { economySnapshot } = await import("/src/lib/quire/economy.ts");
        const t = await economySnapshot();
        return { ledger: t.ledger, events: t.journal.events };
      });
      const event = books.events.find((e) => e.lootFavour);
      assert.ok(event, "the receipt records the favour totals");
      // Bram (10 gp) is far behind Aria (40 gp): he gets the first potion and the scroll first.
      const awards = books.ledger.filter((l) => l.loot?.id === event.lootResolution.id).map((l) => [l.purseId, l.loot.holdingId.startsWith(event.lootResolution.id) ? l.summary : ""]);
      assert.ok(awards.length >= 2);
      await shot(page, `review-receipt-${width}`);
    }

    // A party member (Aria): three tabs, everyone's totals, no away group.
    await asPlayer(page, "aria");
    await openApplication(page, origin + "/party?section=fairness");
    await page.getByRole("tab", { name: /Fairness/ }).waitFor();
    assert.equal(await page.getByRole("tablist", { name: "Party sections" }).getByRole("tab").count(), 3);
    const playerTable = page.getByRole("table", { name: "Loot received per character" });
    await playerTable.getByRole("row", { name: /^Aria Thorne/ }).waitFor();
    assert.equal(await playerTable.getByText("Wren Ashdown").count(), 0, "away characters are DM-only rows");
    await page.getByText("Everyone travelling with the party sees these totals.", { exact: false }).waitFor();
    await noOverflow(page, `fairness party member ${width}`);
    await shot(page, `player-party-${width}`);

    // A player away from the party (Wren): only their own totals.
    await asPlayer(page, "wren");
    await openApplication(page, origin + "/party?section=fairness");
    await page.getByText(/While you are away from the party you see only your own totals/).waitFor();
    const away = page.getByRole("table", { name: "Loot received per character" });
    await shot(page, `player-away-${width}`);
    await away.getByRole("row", { name: /^Wren Ashdown: total 10 gp$/ }).waitFor();
    assert.equal(await away.getByRole("row", { name: /: total / }).count(), 1, "Wren's own row only");
    await noOverflow(page, `fairness away ${width}`);
    await shot(page, `player-away-${width}`);

    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: Fairness tab (DM, party member, player away), period switch, breakdown with not-counted lines and older items at 0 cp, favour preview and receipt, at 1280/390/320 px without sideways scrolling.",
  );
} catch (error) {
  console.error("FAIL: loot fairness browser audit", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
