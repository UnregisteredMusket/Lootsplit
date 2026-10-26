// Party treasure pool and item claims (prompt 2, phase 2) in a disposable device campaign:
// Party → Treasure pool, a claim marked for the table (nothing moves), Review Inbox round-robin
// preview, a stale preview refused with the form kept, one atomic resolution with a receipt, a
// device replay of the same command ID applied once, one Activity row, Add loot into the pool and
// an encounter award sent to the pool; at 1280, 390 and 320 px without sideways scrolling.
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
await mkdir("test-results/loot-claims", { recursive: true });
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
const readBooks = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return {
      purses: t.purses,
      holdings: t.holdings,
      ledger: t.ledger,
      notes: t.notes,
      events: t.journal?.events ?? [],
      claims: t.journal?.lootClaims?.claims ?? [],
    };
  });
const claim = (page, holdingId, purseId, choice, before = null) =>
  page.evaluate(
    async ([holdingId, purseId, choice, before]) => {
      const { executeLocalCommand } = await import("/src/lib/quire/economy.ts");
      await executeLocalCommand({ id: crypto.randomUUID(), kind: "loot-claim", holdingId, purseId, choice, before });
    },
    [holdingId, purseId, choice, before],
  );
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await autoAnswerThemedDialogs(page); // themed confirmations (window.confirm is banned)
    await openApplication(page, origin + "/party?section=pool");
    // Disposable campaign: The Hoard with four pooled lots and one ordinary item, three players
    // and a companion NPC.
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c = {}) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      const lot = (id, name, quantity, unitCopper, notes = "") => ({
        id,
        purseId: "hoard",
        name,
        kind: "item",
        quantity,
        unitCopper,
        notes,
        pool: { at: Date.now(), source: "add-loot" },
      });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ gp: 40 }) },
          { id: "aria", name: "Aria Thorne", kind: "character", coins: coins() },
          { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins() },
          { id: "cass", name: "Cass of the Reeds", kind: "character", coins: coins() },
          { id: "dunstan", name: "Dunstan the porter", kind: "character", control: "npc", coins: coins() },
        ],
        holdings: [
          lot("potion", "Potion of healing", 2, 5000),
          lot("scroll", "Spell scroll (Shield)", 1, 2500, "Tucked inside the bandit captain's boot."),
          lot("sword", "+1 Longsword", 1, 50000, "Found in the drowned chapel."),
          lot("shortsword", "Rusted shortsword", 3, 1000),
          { id: "rope", purseId: "hoard", name: "Rope", kind: "item", quantity: 1, unitCopper: 100, notes: "" },
        ],
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
    await reloadApplication(page, origin + "/party?section=pool");
    await page.getByText("Treasure pool · The Hoard", { exact: true }).waitFor();
    await page.getByRole("tab", { name: /Treasure pool/ }).first().waitFor();
    // Design plan P10: the lot count sits inside the Pool tab, and no Party tab label wraps.
    const partyTabs = page.getByRole("tablist", { name: "Party sections", exact: true });
    const poolTab = partyTabs.getByRole("tab", { name: "Treasure pool, 4 lots", exact: true });
    assert.match(await poolTab.innerText(), /^Pool\s*4$/);
    const [tabBox, badgeBox] = [await poolTab.boundingBox(), await poolTab.locator(".loot-count").boundingBox()];
    assert.ok(
      badgeBox.x >= tabBox.x && badgeBox.x + badgeBox.width <= tabBox.x + tabBox.width + 0.5 &&
        badgeBox.y >= tabBox.y && badgeBox.y + badgeBox.height <= tabBox.y + tabBox.height + 0.5,
      `${width}: the pool count sits inside the Pool tab`,
    );
    for (const tab of await partyTabs.getByRole("tab").all())
      assert.equal(await tab.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).whiteSpace === "nowrap"), true, `${width}: a Party tab label wraps or overflows`);
    // A lot nobody has claimed: one line, expandable to the names.
    const scrollLot = page.locator(".loot-lot").filter({ hasText: "Spell scroll (Shield)" });
    await scrollLot.getByText("No claims yet · 3 can claim", { exact: true }).waitFor();
    assert.equal(await scrollLot.locator(".loot-claim-list li").first().isVisible(), false);
    await scrollLot.getByText("No claims yet · 3 can claim", { exact: true }).click();
    await scrollLot.locator(".loot-claim-list li", { hasText: "Cass of the Reeds" }).waitFor();
    const potion = page.locator(".loot-lot").filter({ hasText: "Potion of healing" });
    // The Need button's offset inside its card (the page itself may scroll).
    const needOffset = async () => {
      const [card, need] = [await potion.boundingBox(), await potion.getByRole("radio", { name: /^Need/ }).boundingBox()];
      return need.y - card.y;
    };
    await potion.getByLabel("Claim for", { exact: true }).selectOption("aria");
    const needBefore = await needOffset();
    // The DM marks a claim for the table (one shared device): nothing moves.
    const before = await readBooks(page);
    await potion.getByLabel("Claim for", { exact: true }).selectOption("aria");
    await potion.getByRole("radio", { name: /^Need/ }).click();
    await page.waitForFunction(async () => {
      const { economySnapshot } = await import("/src/lib/quire/economy.ts");
      return ((await economySnapshot()).journal?.lootClaims?.claims ?? []).length === 1;
    });
    await potion.locator(".loot-claim-list").getByText("marked by the DM", { exact: true }).waitFor();
    // Q22: Need / Greed / Pass keep their place while the claims below them update.
    assert.equal(Math.round((await needOffset()) - needBefore), 0, `${width}: Need moved after a claim`);
    const marked = await readBooks(page);
    assert.deepEqual(marked.holdings, before.holdings);
    assert.deepEqual(marked.purses, before.purses);
    assert.deepEqual(marked.ledger, before.ledger);
    assert.deepEqual(marked.claims.map((c) => [c.holdingId, c.purseId, c.choice, c.by]), [["potion", "aria", "need", "dm"]]);
    // The rest of the table's claims.
    await claim(page, "potion", "cass", "need");
    await claim(page, "potion", "bram", "greed");
    await claim(page, "sword", "bram", "need");
    await claim(page, "sword", "aria", "greed");
    await claim(page, "shortsword", "bram", "greed");
    await claim(page, "shortsword", "cass", "greed");
    await reloadApplication(page, origin + "/party?section=pool");
    await page.getByText(/ready to resolve/).first().waitFor();
    await noOverflow(page, `pool ${width}`);
    await page.screenshot({ path: `test-results/loot-claims/pool-${width}.png`, fullPage: true });
    // History tab: per-lot timelines.
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await page.locator(".loot-timeline").first().waitFor();
    await noOverflow(page, `history ${width}`);
    await page.screenshot({ path: `test-results/loot-claims/history-${width}.png`, fullPage: true });

    // Review Inbox: round-robin preview of the three ready lots (the scroll has no claims).
    await openApplication(page, origin + "/features/review");
    const review = page.locator("#treasure-pool-claims");
    await review.getByText("Treasure pool claims", { exact: true }).waitFor();
    await review.getByRole("radio", { name: /^Round-robin/ }).check();
    const preview = review.getByRole("region", { name: "Resolution preview" });
    await preview.getByText(/Rusted shortsword × 3/).waitFor();
    assert.equal(await review.getByRole("checkbox", { name: /Spell scroll \(Shield\)/ }).isChecked(), false);
    await noOverflow(page, `review ${width}`);
    await page.screenshot({ path: `test-results/loot-claims/review-${width}.png`, fullPage: true });
    const resolveButton = review.getByRole("button", { name: /^Resolve 3 items/ });
    if (width === 1280) {
      // A claim changes while the DM reviews: nothing moves, the selections are kept.
      await page.evaluate(async () => {
        const { executeLocalCommand } = await import("/src/lib/quire/economy.ts");
        await executeLocalCommand({ id: "audit-late-claim", kind: "loot-claim", holdingId: "sword", purseId: "cass", choice: "need", before: null });
      });
      await resolveButton.click();
      await review.getByRole("alert").getByText("Claims changed. Nothing moved.", { exact: true }).waitFor();
      assert.equal(await review.getByRole("radio", { name: /^Round-robin/ }).isChecked(), true);
      assert.equal((await readBooks(page)).ledger.filter((l) => l.loot).length, 0);
      await page.screenshot({ path: `test-results/loot-claims/refused-${width}.png`, fullPage: true });
    }
    await resolveButton.click();
    const receipt = review.getByRole("region", { name: "Treasure pool resolution receipt" });
    await receipt.waitFor();
    await noOverflow(page, `receipt ${width}`);
    await page.screenshot({ path: `test-results/loot-claims/receipt-${width}.png`, fullPage: true });
    const books = await readBooks(page);
    const resolution = books.events.filter((e) => e.lootResolution);
    assert.equal(resolution.length, 1);
    const id = resolution[0].lootResolution.id;
    const moved = books.holdings.filter((h) => h.id.startsWith(id + "-"));
    // Potion × 2, sword × 1, shortsword × 3 out of the pool; the scroll stays.
    assert.equal(moved.reduce((s, h) => s + h.quantity, 0), 6);
    assert.equal(moved.some((h) => h.pool), false);
    assert.deepEqual(books.holdings.filter((h) => h.pool).map((h) => h.id), ["scroll"]);
    assert.equal(books.ledger.filter((l) => l.loot?.id === id).every((l) => l.copper === 0), true);
    assert.equal(books.notes.filter((n) => n.id === id + "-note").length, 1);
    // A lost response retried with the same command ID changes nothing on this device.
    const replay = await page.evaluate(async (id) => {
      const { executeLocalCommand, economySnapshot } = await import("/src/lib/quire/economy.ts");
      const before = JSON.stringify((await economySnapshot()).holdings);
      const event = (await economySnapshot()).journal.events.find((e) => e.lootResolution?.id === id);
      await executeLocalCommand({
        id,
        kind: "loot-resolve",
        method: event.lootResolution.method,
        lots: event.lootResolution.lots.map((l) => ({ holdingId: l.holdingId, quantity: l.quantity })),
        expect: "0000000000000000",
      }).catch(() => undefined);
      return before === JSON.stringify((await economySnapshot()).holdings);
    }, id);
    assert.equal(replay, true);
    // Activity: one row for the resolution.
    await openApplication(page, origin + "/features/reports");
    const fold = page.getByRole("button", { name: /Full activity/ });
    if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
    const row = page.locator(".coin-split-entry").filter({ hasText: "Treasure pool resolved" });
    await row.waitFor();
    assert.equal(await row.count(), 1);
    await row.locator("summary").click();
    assert.ok((await row.locator(".coin-split-lines li").count()) >= 3);
    await noOverflow(page, `activity ${width}`);
    await page.screenshot({ path: `test-results/loot-claims/activity-${width}.png`, fullPage: true });

    // Add loot: "Put in the treasure pool" when the owner is a party fund.
    await openApplication(page, origin + "/party?section=funds");
    await page.getByRole("button", { name: "+ Add loot", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Holding owner", { exact: true }).selectOption({ label: "The Hoard" });
    await dialog.getByLabel("Holding name", { exact: true }).fill("Silver holy symbol");
    await dialog.getByLabel("Holding value", { exact: true }).fill("25 gp");
    await dialog.getByRole("checkbox", { name: /Put in the treasure pool/ }).check();
    await noOverflow(page, `add loot ${width}`);
    await page.screenshot({ path: `test-results/loot-claims/add-loot-${width}.png` });
    await dialog.getByRole("button", { name: "Add loot", exact: true }).click();
    await page.waitForFunction(async () => {
      const { economySnapshot } = await import("/src/lib/quire/economy.ts");
      return (await economySnapshot()).holdings.some((h) => h.name === "Silver holy symbol" && h.pool?.source === "add-loot");
    });

    // Encounter award: items sent to the treasure pool, transferred once.
    const encounterId = await page.evaluate(async () => {
      const { localEncounterRequest: call } = await import("/src/lib/encounters/local.ts");
      const { blankEncounter, blankLoot } = await import("/src/lib/encounters/model.mjs");
      const { id } = await call("encounters/create", { id: crypto.randomUUID() });
      const e = blankEncounter();
      e.name = "Goblin ambush at the ford";
      e.loot = [
        { ...blankLoot(), name: "Potion of greater healing", quantity: 2, unitCopper: 15000, purseId: "", pool: true },
        { ...blankLoot(), name: "Captain's iron key", purseId: "aria" },
      ];
      await call("encounters/save", { id, revision: 0, encounter: e });
      await call("encounters/conclude", { id, revision: 1 });
      return id;
    });
    await openApplication(page, `${origin}/encounters?encounter=${encodeURIComponent(encounterId)}&review=1`);
    const award = page.getByRole("region", { name: "Recipient award preview" });
    await award.getByText("Treasure pool · The Hoard", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Send all items to the treasure pool", exact: true }).isEnabled(), true);
    await noOverflow(page, `encounter ${width}`);
    await page.screenshot({ path: `test-results/loot-claims/encounter-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Transfer loot once", exact: true }).click();
    await page.getByRole("region", { name: "Items sent to the treasure pool" }).waitFor();
    const after = await readBooks(page);
    const pooled = after.holdings.filter((h) => h.pool?.source === "encounter");
    assert.deepEqual(pooled.map((h) => [h.purseId, h.name, h.quantity]), [["hoard", "Potion of greater healing", 2]]);
    assert.equal(after.holdings.filter((h) => h.name === "Captain's iron key" && h.purseId === "aria").length, 1);
    await page.screenshot({ path: `test-results/loot-claims/encounter-receipt-${width}.png`, fullPage: true });
    // Q22: Claim all as Pass marks Pass on every lot the chosen character has not marked; nothing moves.
    await openApplication(page, origin + "/party?section=pool");
    const beforePass = await readBooks(page);
    const unmarked = beforePass.holdings.filter(
      (h) => h.pool && !beforePass.claims.some((c) => c.holdingId === h.id && c.purseId === "cass"),
    );
    assert.ok(unmarked.length > 0);
    await page.getByLabel("Pass for", { exact: true }).selectOption("cass");
    await page.getByRole("button", { name: `Claim all as Pass · ${unmarked.length}`, exact: true }).click();
    await page.getByText(`Marked Pass on ${unmarked.length} claim${unmarked.length === 1 ? "" : "s"}.`, { exact: true }).waitFor();
    const afterPass = await readBooks(page);
    assert.deepEqual(
      afterPass.claims.filter((c) => c.purseId === "cass" && c.choice === "pass").map((c) => c.holdingId).sort(),
      unmarked.map((h) => h.id).sort(),
    );
    assert.deepEqual(afterPass.holdings, beforePass.holdings);
    assert.deepEqual(afterPass.purses, beforePass.purses);
    assert.equal(await page.getByRole("button", { name: /^Claim all as Pass/ }).isDisabled(), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS treasure pool: Party tab with its count inside and unwrapped labels, unclaimed lots collapsed, stable claim buttons, Claim all as Pass, claim marked for the table moves nothing, Review Inbox round-robin preview, stale preview refused with the form kept, one atomic resolution and receipt, device replay applied once, one Activity row, Add loot to the pool, encounter award to the pool; 1280/390/320 px without sideways scrolling.",
  );
} finally {
  await browser.close();
}
