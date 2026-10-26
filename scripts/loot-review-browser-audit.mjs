// Loot review workflow (design plan D1, QoL Q2 and Q3) in a disposable device campaign: the Desk
// "Ready for loot review" card and its count (zero, one, many), Desk card → transfer in three taps
// with the transfer button in view at 390 × 844, compact rows with gold values, bulk "Assign
// selected to…" and "Send selected to treasure pool", the remembered coin recipient, the
// Encounters tab opening its only loot review, the exactly-once award, and 320 / 1280 layouts.
// Never targets a real campaign.
import { chromium } from "playwright";
import { expect } from "playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { answerThemedDialog } from "./themed-dialogs.mjs";
import { chooseOption } from "./search-select-browser.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = "test-results/loot-review";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const noOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${label}: the page scrolls sideways`,
  );
/** The element is inside the visible viewport right now, without any scrolling. */
const inView = async (locator, label) => {
  const box = await locator.boundingBox();
  const height = await locator.page().evaluate(() => innerHeight);
  assert.ok(box && box.y >= 0 && box.y + box.height <= height, `${label}: not in view (${JSON.stringify(box)}, viewport ${height})`);
};
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return { purses: t.purses, holdings: t.holdings, ledger: t.ledger };
  });
/** Create, save and conclude a device encounter; returns its ID. */
const concluded = (page, body, conclude = true) =>
  page.evaluate(
    async ({ body, conclude }) => {
      const { localEncounterRequest: call } = await import("/src/lib/encounters/local.ts");
      const { blankEncounter, blankLoot } = await import("/src/lib/encounters/model.mjs");
      const { id } = await call("encounters/create", { id: crypto.randomUUID() });
      const e = { ...blankEncounter(), ...body, loot: body.loot.map((l) => ({ ...blankLoot(), ...l })) };
      await call("encounters/save", { id, revision: 0, encounter: e });
      if (conclude) await call("encounters/conclude", { id, revision: 1 });
      return id;
    },
    { body, conclude },
  );
const copper = (c) => c.cp + c.sp * 10 + c.ep * 50 + c.gp * 100 + c.pp * 1000;
const pendingReviews = (page) => page.locator(".readout").filter({ hasText: "Review Inbox" });
try {
  for (const [width, height] of [[390, 844], [320, 700], [1280, 900]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await openApplication(page, origin + "/party?section=funds");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ gp: 10 }) },
          { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 5 }) },
          { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 3 }) },
        ],
        holdings: [], shops: [], stock: [], ledger: [], listings: [], loans: [], sheets: [], notes: [],
        journal: readJournal({}),
      });
    });
    await reloadApplication(page, origin + "/party?section=funds");

    // Zero loot reviews: no card, and the count says nothing about loot.
    await openApplication(page, origin + "/");
    await pendingReviews(page).waitFor();
    await page.waitForFunction(() => !document.body.innerText.includes("Loading encounter…"));
    assert.equal(await page.locator(".desk-loot-review").count(), 0);
    assert.doesNotMatch(await pendingReviews(page).innerText(), /loot/);

    // One fully assigned review: Desk card (1) → Transfer loot once (2) → confirm (3).
    const toll = await concluded(page, {
      name: "Toll bridge strongbox",
      coins: { cp: 0, sp: 0, ep: 0, gp: 12, pp: 0 },
      coinPurseId: "hoard",
      loot: [{ name: "Iron key", purseId: "bram", unitCopper: 150 }],
    });
    await openApplication(page, origin + "/");
    const card = page.locator(".desk-loot-review").filter({ hasText: "Toll bridge strongbox" });
    await card.waitFor();
    assert.match(await card.innerText(), /Ready for loot review/);
    assert.match(await pendingReviews(page).innerText(), /1 loot review\b/);
    await noOverflow(page, `desk ${width}`);
    await page.screenshot({ path: `${output}/desk-${width}.png` });
    await card.click(); // tap 1
    const transfer = page.getByRole("button", { name: "Transfer loot once", exact: true });
    await transfer.waitFor();
    await page.getByRole("heading", { name: "Review the loot award" }).waitFor();
    await expect(transfer).toBeEnabled();
    await inView(transfer, `Transfer loot once at ${width} × ${height} straight from the Desk`);
    const footer = page.getByRole("region", { name: "Loot transfer" });
    assert.match(await footer.innerText(), /Total 13 gp, 5 sp/);
    assert.match(await footer.innerText(), /Bram Ironfoot/);
    await noOverflow(page, `review ${width}`);
    await page.screenshot({ path: `${output}/review-from-desk-${width}.png` });
    await transfer.click(); // tap 2
    await answerThemedDialog(page); // tap 3
    await page.getByText("Loot transferred. This encounter cannot award loot again.").waitFor();
    let b = await books(page);
    assert.equal(copper(b.purses.find((p) => p.id === "hoard").coins), 2200);
    assert.equal(b.holdings.filter((h) => h.name === "Iron key" && h.purseId === "bram").length, 1);
    // Exactly once: asking for the same award again (refused, or answered from the stored
    // receipt) changes nothing.
    const again = await page.evaluate(async (id) => {
      const { localEncounterRequest: call } = await import("/src/lib/encounters/local.ts");
      const d = await call("encounters/detail", { id });
      return call("encounters/award", { id, revision: d.revision }).then(() => "accepted", (e) => String(e?.message || e));
    }, toll);
    assert.ok(typeof again === "string");
    assert.deepEqual(await books(page), b, "a repeated award changes nothing");

    if (width === 390) {
      // Many items, nothing assigned: compact rows, gold values, bulk assign, pool and Q3 memory.
      const strongroom = await concluded(page, {
        name: "The smugglers' strongroom",
        coins: { cp: 0, sp: 0, ep: 0, gp: 250, pp: 0 },
        loot: [
          { name: "Ruby", unitCopper: 25000 },
          { name: "Silk bolt", quantity: 3, unitCopper: 500 },
          { name: "Map case", unitCopper: 1200, notes: "Sealed with the harbourmaster's wax." },
          { name: "Old lantern", unitCopper: 30 },
          ...Array.from({ length: 8 }, (_, i) => ({ name: `Crate ${i + 1}`, unitCopper: 100 })),
        ],
      });
      const second = await concluded(page, { name: "Ford ambush", coins: { cp: 0, sp: 0, ep: 0, gp: 4, pp: 0 }, loot: [] });
      await openApplication(page, origin + "/");
      await page.locator(".desk-loot-review").nth(1).waitFor();
      assert.equal(await page.locator(".desk-loot-review").count(), 2);
      assert.match(await pendingReviews(page).innerText(), /2 loot reviews/);
      // Two reviews: Encounters keeps the list, loot reviews first with a badge.
      await openApplication(page, origin + "/encounters");
      await page.getByRole("heading", { name: "Set the scene" }).waitFor();
      const rows = page.locator(".encounter-library-row");
      await rows.first().waitFor();
      assert.match(await rows.nth(0).innerText(), /Loot review/);
      assert.match(await rows.nth(1).innerText(), /Loot review/);
      assert.doesNotMatch(await rows.nth(2).innerText(), /Loot review/); // the awarded strongbox
      await page.screenshot({ path: `${output}/encounters-list-${width}.png` });

      await openApplication(page, `${origin}/encounters?encounter=${encodeURIComponent(strongroom)}&review=1`);
      await page.getByRole("heading", { name: "Review the loot award" }).waitFor();
      const row = (name) => page.locator(".loot-review-row").filter({ has: page.locator(`input[value="${name}"]`) });
      const ruby = row("Ruby");
      assert.equal(await ruby.getByLabel("Value each (gp)", { exact: true }).inputValue(), "250");
      assert.match(await ruby.locator(".loot-row-echo").innerText(), /= 250 gp/);
      const rowHeight = (await ruby.boundingBox()).height;
      assert.ok(rowHeight < 240, `compact loot row is ${Math.round(rowHeight)}px tall at 390`);
      await ruby.getByLabel("Value each (gp)", { exact: true }).fill("300");
      await ruby.locator(".loot-row-echo").getByText("= 300 gp").waitFor();
      await ruby.locator("summary").click();
      assert.equal(await ruby.getByLabel("Value each (cp)", { exact: true }).inputValue(), "30000");
      assert.equal(await row("Map case").getByLabel("Notes for item 3").count(), 1); // kept behind Details
      await inView(page.getByRole("button", { name: "Transfer loot once", exact: true }), "Transfer button while editing");
      // Bulk: Ruby + Silk bolt → Aria; Map case + crates → treasure pool.
      await page.getByRole("checkbox", { name: "Select Ruby" }).check();
      await page.getByRole("checkbox", { name: "Select Silk bolt" }).check();
      await chooseOption(page.getByRole("combobox", { name: "Assign selected to…" }), "aria");
      await page.getByText("Assigned 2 items to Aria Thorne.", { exact: false }).waitFor();
      await page.getByRole("checkbox", { name: "Select Map case" }).check();
      for (let i = 1; i <= 8; i++) await page.getByRole("checkbox", { name: `Select Crate ${i}` }).check();
      await page.getByRole("button", { name: "Send selected to treasure pool", exact: true }).click();
      await page.getByText("Sent 9 items to the treasure pool.", { exact: false }).waitFor();
      await chooseOption(page.getByRole("combobox", { name: "Recipient for item 4" }), "bram");
      await chooseOption(page.getByRole("combobox", { name: "Coin recipient" }), "hoard");
      const summary = await page.getByRole("region", { name: "Loot transfer" }).innerText();
      assert.match(summary, /Aria Thorne/);
      assert.match(summary, /9 to the treasure pool/);
      await page.screenshot({ path: `${output}/bulk-assigned-${width}.png` });
      await page.getByRole("button", { name: "Save review", exact: true }).click();
      await page.getByText("Encounter saved.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Transfer loot once", exact: true }).click();
      await answerThemedDialog(page);
      await page.getByText("Loot transferred. This encounter cannot award loot again.").waitFor();
      b = await books(page);
      const held = (name) => b.holdings.filter((h) => h.name === name);
      assert.equal(held("Ruby")[0]?.purseId, "aria");
      assert.equal(held("Ruby")[0]?.unitCopper, 30000);
      assert.equal(held("Silk bolt")[0]?.purseId, "aria");
      assert.equal(held("Silk bolt")[0]?.quantity, 3);
      assert.equal(held("Old lantern")[0]?.purseId, "bram");
      assert.equal(held("Map case")[0]?.purseId, "hoard");
      assert.ok(held("Map case")[0]?.pool, "Map case is open for treasure-pool claims");
      assert.equal(copper(b.purses.find((p) => p.id === "hoard").coins), 2200 + 25000);

      // Q3: the next award offers last time's coin recipient. One review left: Encounters opens it.
      await openApplication(page, origin + "/encounters");
      await page.getByRole("heading", { name: "Review the loot award" }).waitFor();
      assert.match(await page.locator(".encounter-heading h2").first().innerText(), /Ford ambush/);
      await page.getByRole("button", { name: "Coins to The Hoard, as last time" }).click();
      assert.equal(
        await page.getByRole("combobox", { name: "Coin recipient" }).getAttribute("data-value"),
        "hoard",
      );
      void second;
    }
    await noOverflow(page, `end ${width}`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Loot review audit passed: Desk card and count, three-tap transfer, bulk assign, pool, memory, exactly once.");
} finally {
  await browser.close();
}
