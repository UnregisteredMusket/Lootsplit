// Even coin split (prompt 2, phase 1) in a disposable device campaign: Split on a party fund row,
// preview, confirm, busy, a refused split that keeps the form, the one-row Activity entry, and
// no sideways scrolling at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/coin-split", { recursive: true });
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
    return { purses: t.purses, ledger: t.ledger, notes: t.notes, events: t.journal?.events ?? [] };
  });
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/party?section=funds");
    // Disposable campaign: The Hoard {2 pp, 47 gp, 3 ep, 18 sp, 9 cp} = 7,039 cp, three players, one NPC.
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ pp: 2, gp: 47, ep: 3, sp: 18, cp: 9 }) },
          { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 25, cp: 1 }) },
          { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 12, sp: 4 }) },
          { id: "cass", name: "Cass of the Reeds", kind: "character", coins: coins({ gp: 8, sp: 7, cp: 2 }) },
          { id: "dunstan", name: "Dunstan the porter", kind: "character", control: "npc", coins: coins({ gp: 1 }) },
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
    await reloadApplication(page, origin + "/party?section=funds");
    await page.getByRole("button", { name: "Split coins from The Hoard", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("3 shares of 23 gp, 4 sp, 6 cp", { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel("Amount to split", { exact: true }).inputValue(), "70 gp, 3 sp, 9 cp");
    // The companion NPC is offered to the DM but not ticked by default.
    assert.equal(await dialog.getByRole("checkbox", { name: /Dunstan the porter/ }).isChecked(), false);
    await dialog.getByText("3 × 2,346 cp + 1 cp leftover = 7,039 cp", { exact: false }).waitFor();
    await noOverflow(page, `form ${width}`);
    await page.screenshot({ path: `test-results/coin-split/form-${width}.png`, fullPage: true });
    await dialog.getByRole("button", { name: "Review split", exact: true }).click();
    await dialog.getByText("Split 70 gp, 3 sp, 9 cp?", { exact: true }).waitFor();
    await noOverflow(page, `confirm ${width}`);
    await page.screenshot({ path: `test-results/coin-split/confirm-${width}.png` });
    if (width === 1280) {
      // Someone spends from the fund while the DM reviews: the split is refused, nothing moves,
      // and the form keeps every choice for another review.
      await page.evaluate(async () => {
        const { setCoins } = await import("/src/lib/quire/economy.ts");
        await setCoins("hoard", { cp: 9, sp: 1, ep: 0, gp: 52, pp: 0 }, "Audit: spent elsewhere");
      });
      await dialog.getByRole("button", { name: "Split coins", exact: true }).click();
      await dialog.getByRole("alert").getByText("Nothing was split.", { exact: true }).waitFor();
      await dialog.getByRole("alert").getByText(/holds only 52 gp, 1 sp, 9 cp/).waitFor();
      assert.equal(await dialog.getByLabel("Amount to split", { exact: true }).inputValue(), "70 gp, 3 sp, 9 cp");
      assert.equal(await dialog.getByRole("button", { name: "Review split", exact: true }).isDisabled(), true);
      await page.screenshot({ path: `test-results/coin-split/refused-${width}.png` });
      assert.equal((await readBooks(page)).ledger.filter((l) => l.split).length, 0);
      await dialog.getByRole("button", { name: /Use whole balance/ }).click();
      await dialog.getByRole("button", { name: "Review split", exact: true }).click();
    }
    await dialog.getByRole("button", { name: "Split coins", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const books = await readBooks(page);
    const lines = books.ledger.filter((l) => l.split);
    assert.equal(lines.length, 4);
    assert.equal(new Set(lines.map((l) => l.split.id)).size, 1);
    assert.equal(lines.reduce((sum, l) => sum + l.copper, 0), 0);
    const hoard = books.purses.find((p) => p.id === "hoard").coins;
    // 7,039 cp among 3 leaves 1 cp; after the refusal at 1280 the whole 5,219 cp leaves 2 cp.
    assert.equal(hoard.cp + hoard.sp * 10 + hoard.ep * 50 + hoard.gp * 100 + hoard.pp * 1000, width === 1280 ? 2 : 1);
    assert.equal(books.events.filter((e) => e.split).length, 1);
    assert.equal(books.notes.filter((n) => /^Split /.test(n.text)).length, 1);
    // Replaying the same command ID on this device changes nothing.
    const replay = await page.evaluate(async (id) => {
      const { executeLocalCommand, economySnapshot } = await import("/src/lib/quire/economy.ts");
      const before = JSON.stringify((await economySnapshot()).purses);
      const event = (await economySnapshot()).journal.events.find((e) => e.split?.id === id);
      await executeLocalCommand({
        id,
        kind: "coin-split",
        sourceId: "hoard",
        copper: event.split.copper,
        recipientIds: event.split.recipientIds,
        remainder: { rule: event.split.rule },
        expect: { share: event.split.share, remainderTo: event.split.remainderTo },
      }).catch(() => undefined);
      return before === JSON.stringify((await economySnapshot()).purses);
    }, lines[0].split.id);
    assert.equal(replay, true);
    // Activity shows the split as one row that opens to its four lines.
    await openApplication(page, origin + "/features/reports");
    const fold = page.getByRole("button", { name: /Full activity/ });
    if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
    const row = page.locator(".coin-split-entry").filter({ hasText: "Coin split from The Hoard" });
    await row.waitFor();
    assert.equal(await row.count(), 1);
    await row.locator("summary").click();
    assert.equal(await row.locator(".coin-split-lines li").count(), 4);
    await noOverflow(page, `activity ${width}`);
    await page.screenshot({ path: `test-results/coin-split/activity-${width}.png`, fullPage: true });
    // Encounter award: Coins go to → Split evenly among, with the same preview, transferred once.
    page.on("dialog", (d) => d.accept());
    const encounterId = await page.evaluate(async () => {
      const { localEncounterRequest: call } = await import("/src/lib/encounters/local.ts");
      const { blankEncounter, blankLoot } = await import("/src/lib/encounters/model.mjs");
      const { id } = await call("encounters/create", { id: crypto.randomUUID() });
      const e = blankEncounter();
      e.name = "Goblin ambush at the ford";
      e.coins = { cp: 7, sp: 14, ep: 0, gp: 23, pp: 1 };
      e.coinSplit = { purseIds: ["aria", "bram", "cass", "dunstan"], remainderRule: "party-fund" };
      e.loot = [{ ...blankLoot(), name: "Potion of healing", purseId: "hoard" }];
      await call("encounters/save", { id, revision: 0, encounter: e });
      await call("encounters/conclude", { id, revision: 1 });
      return id;
    });
    await openApplication(page, `${origin}/encounters?encounter=${encodeURIComponent(encounterId)}&review=1`);
    await page.getByText("4 shares of 8 gp, 6 sp, 1 cp", { exact: true }).waitFor();
    assert.equal(await page.getByRole("radio", { name: /Split evenly among/ }).isChecked(), true);
    await page.getByText("The 3 cp left over went to The Hoard (party fund).", { exact: true }).first().waitFor();
    await noOverflow(page, `encounter ${width}`);
    await page.screenshot({ path: `test-results/coin-split/encounter-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Transfer loot once", exact: true }).click();
    await page.getByRole("region", { name: "Coins split evenly" }).waitFor();
    const award = await page.evaluate(async (id) => {
      const { localEncounterRequest: call } = await import("/src/lib/encounters/local.ts");
      return (await call("encounters/detail", { id })).award;
    }, encounterId);
    assert.deepEqual(award.coinShares.map((s) => s.copper), [861, 861, 861, 861]);
    assert.deepEqual(award.coinRemainder, { purseId: "hoard", copper: 3, rule: "party-fund" });
    await page.screenshot({ path: `test-results/coin-split/encounter-receipt-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS coin split: fund row Split, preview, confirm, refused split keeps the form, one atomic receipt, device replay applied once, one Activity row; 1280/390/320 px without sideways scrolling.",
  );
} finally {
  await browser.close();
}
