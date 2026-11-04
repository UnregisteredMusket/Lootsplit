// Ledger CSV export (loot plan phase 6) in a disposable device campaign: one archived session and
// a live one. Review Reports → Full activity → Download CSV as the DM holds every line of both sessions with formula
// cells neutralised; as a player seat (My Finances → Recorded transactions) it holds only that character's lines (no other player's
// private purse, hidden NPC treasury or DM-only event). No sideways scrolling at 1280, 390 and
// 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/ledger-export", { recursive: true });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
async function download(page, width, who) {
  const button = page.getByTestId("ledger-csv-export");
  await button.scrollIntoViewIfNeeded();
  assert.equal(await sideways(page), false, `${width}: Activity scrolls sideways`);
  const [file] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const path = `test-results/ledger-export/${who}-${width}.csv`;
  await file.saveAs(path);
  return readFile(path, "utf8");
}
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 400 ? 760 : 900 },
      acceptDownloads: true,
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/features/reports");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const { archiveSession } = await import("/src/lib/quire/session-records.ts");
      const coins = (gp) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
      const line = (id, purseId, copper, at, summary) => ({ id, purseId, copper, at, summary, shopId: null });
      const table = {
        purses: [
          { id: "aria", name: "Aria Thorne", kind: "character", coins: coins(5) },
          { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins(5) },
          { id: "vault", name: "Vault Keeper", kind: "character", control: "npc", coins: coins(50) },
        ],
        holdings: [], shops: [], stock: [], listings: [], loans: [], sheets: [], notes: [],
        ledger: [
          line("old-aria", "aria", 300, 2000, "=cmd|' /C calc'!A0"),
          line("old-bram", "bram", -45, 2100, "Bram private bribe"),
          line("old-vault", "vault", 900, 2200, "Vault skim"),
        ],
        journal: readJournal({
          sessions: [{ id: "s1", name: "The Crypt", startedAt: 1000, endedAt: 3000 }],
          events: [{ id: "old-dm", at: 2300, kind: "management", summary: "DM plot twist", dmOnly: true }],
        }),
      };
      archiveSession(table, "s1", "The Crypt", 3000);
      table.journal.sessions.push({ id: "s2", name: "The Market", startedAt: 4000 });
      table.ledger = [
        line("new-aria", "aria", -20, 5000, "Bought rope, 50 ft"),
        line("new-bram", "bram", 60, 5100, "Bram private winnings"),
      ];
      await applyCloudTable(table);
    });
    await reloadApplication(page, origin + "/features/reports");
    await page.getByRole("button", { name: /^Full activity/ }).click();
    const dmCsv = await download(page, width, "dm");
    const dmRows = dmCsv.trim().split("\r\n");
    assert.ok(dmRows[0].startsWith("﻿Date and time,Session,Record,"), "header");
    for (const id of ["old-aria", "old-bram", "old-vault", "old-dm", "new-aria", "new-bram"])
      assert.ok(dmCsv.includes(`,${id},`), `${width}: the DM's file holds ${id}`);
    assert.ok(dmCsv.includes(`"'=cmd|' /C calc'!A0"`) || dmCsv.includes(`'=cmd|' /C calc'!A0`), "formula neutralised");
    assert.ok(dmCsv.includes('"Bought rope, 50 ft"'), "commas are quoted");
    await page.screenshot({ path: `test-results/ledger-export/dm-${width}.png`, fullPage: width === 1280 });

    // The same device as a player seat for Aria.
    await page.evaluate(async () => {
      const { setSeat } = await import("/src/lib/quire/table.ts");
      setSeat({ role: "player", purseIds: ["aria"], shopIds: [], openedAt: Date.now() });
    });
    // A player reads their history in My Finances → Recorded transactions.
    await reloadApplication(page, origin + "/features/finances");
    const playerCsv = await download(page, width, "player");
    for (const id of ["old-aria", "new-aria"])
      assert.ok(playerCsv.includes(`,${id},`), `${width}: Aria's file holds ${id}`);
    for (const secret of ["old-bram", "new-bram", "old-vault", "old-dm", "Bram", "Vault", "DM plot"])
      assert.equal(playerCsv.includes(secret), false, `${width}: Aria's file must not contain ${secret}`);
    assert.equal(await sideways(page), false, `${width}: the player's Activity scrolls sideways`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Ledger export browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
