// Session recap (loot plan phase 6) in a disposable device campaign: open "Recap" on the live
// session and on an archived one, check the computed sections (no NPC in the party draft), edit
// the draft, share it once, and verify one party journal entry and nothing else stored, with no
// sideways scrolling at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/session-recap", { recursive: true });
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return { journal: t.journal, ledger: t.ledger, purses: t.purses };
  });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/features/downtime");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      const purses = [
        { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ gp: 100 }) },
        { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 30 }) },
        { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 30 }) },
        { id: "dunstan", name: "Dunstan the porter", kind: "character", control: "npc", coins: coins({ gp: 10 }) },
      ];
      const shops = [
        { id: "marlow", name: "Marlow's Curios", keeper: "", place: "Port Ashby", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "curios", priceScale: 1 },
      ];
      const base = { holdings: [], shops, stock: [], listings: [], loans: [], sheets: [], notes: [] };
      const old = {
        ...base,
        purses,
        ledger: [{ id: "old-buy", at: 1000, purseId: "hoard", shopId: "marlow", summary: "Bought 2 Rope from Marlow's Curios", copper: -200, transactionType: "purchase" }],
        journal: { sessions: [{ id: "old", name: "The Old Road", startedAt: 900, endedAt: 2000 }], events: [], requests: [] },
      };
      const now = Date.now() - 60_000;
      const line = (id, purseId, copper, summary, extra = {}) => ({ id, at: now + 10, purseId, shopId: null, summary, copper, transactionType: "transfer", ...extra });
      await applyCloudTable({
        ...base,
        purses,
        ledger: [
          line("sp-source", "hoard", -3000, "Coin split", { split: { id: "sp", role: "source" } }),
          line("sp-share-0", "aria", 1000, "Split share from The Hoard", { split: { id: "sp", role: "share" } }),
          line("sp-share-1", "bram", 1000, "Split share from The Hoard", { split: { id: "sp", role: "share" } }),
          line("sp-share-2", "dunstan", 1000, "Split share from The Hoard", { split: { id: "sp", role: "share" } }),
          { ...line("award-coins", "aria", 1234, "Encounter loot: Goblin camp"), transactionType: "adjustment", award: { receiptId: "award", role: "coins" } },
          { ...line("buy-1", "hoard", -1500, "Bought 1 Longsword from Marlow's Curios"), shopId: "marlow", transactionType: "purchase" },
          // A character's own purchase is private to its player: DM records only.
          { ...line("buy-2", "bram", -700, "Bought 1 Lantern from Marlow's Curios"), shopId: "marlow", transactionType: "purchase" },
        ],
        journal: readJournal({
          sessions: [
            { id: "old", name: "The Old Road", startedAt: 900, endedAt: 2000 },
            { id: "vault", name: "The Drowned Vault", startedAt: now },
          ],
          reports: [{ id: "old", name: "The Old Road", at: 2000, snapshot: JSON.stringify(old) }],
          events: [
            { id: "npc-split", at: now + 10, kind: "management", dmOnly: true, purseId: "hoard", summary: "Coin split from The Hoard: 30 gp among 3",
              split: { id: "sp", sourceId: "hoard", copper: 3000, share: 1000, n: 3, remainder: 0, remainderTo: null, rule: "party-fund", recipientIds: ["aria", "bram", "dunstan"] } },
            { id: "j1", at: now + 11, kind: "session", summary: "Departed: Road to the coast · 0% of the route" },
          ],
          downtimePrompt: { enabled: false, days: 0 },
        }),
      });
    });
    await reloadApplication(page, origin + "/features/downtime");
    await page.getByRole("button", { name: /^Session · The Drowned Vault/ }).click();
    const live = page.locator(".journal-entry").filter({ hasText: "The Drowned Vault" });
    await live.getByRole("button", { name: "Recap", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Recap · The Drowned Vault" });
    await dialog.waitFor();
    const draft = dialog.getByLabel("Recap text");
    const words = await draft.inputValue();
    assert.match(words, /Loot and coin awarded/);
    assert.match(words, /Coin split from The Hoard: 10 gp to Aria Thorne, 10 gp to Bram Ironfoot\./);
    assert.match(words, /Encounter loot: Goblin camp: 12 gp, 3 sp, 4 cp to Aria Thorne\./);
    assert.match(words, /Marlow's Curios: bought 1 time for 15 gp\./, "only the fund's purchase is in the party draft");
    assert.match(words, /Set out: Road to the coast\./);
    assert.ok(!words.includes("Dunstan"), `${width}: the party draft names an NPC`);
    // The DM's own records keep the NPC split.
    await dialog.getByText("Your full records (DM only)").click();
    await dialog.getByText("Coin split from The Hoard: 30 gp among 3.").waitFor();
    await dialog.getByText("Marlow's Curios: bought 2 times for 22 gp.").waitFor();
    assert.equal(await sideways(page), false, `${width}: the recap scrolls sideways`);
    await dialog.screenshot({ path: `test-results/session-recap/draft-${width}.png` });
    await draft.fill(words + "\n\nThe vault door still hums.");
    await dialog.getByRole("button", { name: "Share with the party" }).click();
    await page.getByText("Recap shared with the party in the journal.").first().waitFor();
    await dialog.getByText(/^Shared with the party on /).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Share with the party" }).count(), 0, "shared once");
    const after = await books(page);
    const entries = (after.journal.entries ?? []).filter((e) => e.id === "recap:vault");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].visibility, "party");
    assert.match(entries[0].text, /The vault door still hums\.$/);
    assert.equal(after.ledger.length, 7, "sharing moves nothing");
    await page.keyboard.press("Escape");
    // An archived session reads its report.
    await page.getByRole("button", { name: /^Session · The Drowned Vault/ }).waitFor();
    const archived = page.locator(".journal-entry").filter({ hasText: "The Old Road" });
    await archived.getByRole("button", { name: "Recap", exact: true }).click();
    const oldDialog = page.getByRole("dialog", { name: "Recap · The Old Road" });
    await oldDialog.waitFor();
    assert.match(await oldDialog.getByLabel("Recap text").inputValue(), /Marlow's Curios: bought 1 time for 2 gp\./);
    assert.equal(await sideways(page), false, `${width}: the archived recap scrolls sideways`);
    await page.screenshot({ path: `test-results/session-recap/archived-${width}.png`, fullPage: width === 1280 });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Session recap browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
