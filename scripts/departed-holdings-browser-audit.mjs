// Return to party (departed characters' holdings) in a disposable device campaign: take Aster out
// of the party, answer the prompt, choose two items (one attuned, part of a stack) and some coins,
// review, confirm, and verify one atomic return into the treasure pool (unclaimed, attunement
// ended, claims withdrawn, copper conserved) with no sideways scrolling at 1280, 390 and 320 px.
// Keep with Aster is checked first: declining moves nothing. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/departed-holdings", { recursive: true });
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const { toCopper } = await import("/src/lib/quire/money.ts");
    const t = await economySnapshot();
    return {
      copper: Object.fromEntries(t.purses.map((p) => [p.id, toCopper(p.coins)])),
      holdings: t.holdings.map((h) => ({ id: h.id, purseId: h.purseId, quantity: h.quantity, pool: !!h.pool, attuned: !!h.attuned })),
      ledger: t.ledger,
      events: t.journal?.events ?? [],
      claims: t.journal?.lootClaims?.claims ?? [],
    };
  });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
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
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      const item = (id, purseId, name, extra = {}) => ({
        id, purseId, name, kind: "item", quantity: 1, unitCopper: 5000, notes: "", ...extra,
      });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ gp: 1 }) },
          { id: "aster", name: "Aster", kind: "character", coins: coins({ gp: 42, sp: 3 }) },
          { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 1 }) },
        ],
        holdings: [
          item("ring", "aster", "Ring of protection", { requiresAttunement: "Requires attunement", attuned: true }),
          item("arrows", "aster", "Arrows", { quantity: 20, unitCopper: 5 }),
          item("lute", "aster", "Lute"),
          item("gem", "hoard", "Ruby", { pool: { at: 1, source: "dm" } }),
        ],
        shops: [],
        stock: [],
        ledger: [],
        listings: [],
        loans: [],
        sheets: [],
        notes: [],
        journal: readJournal({
          lootClaims: { claims: [{ holdingId: "gem", purseId: "aster", choice: "need", at: 1, by: "player", commandId: "c1" }] },
        }),
      });
    });
    await reloadApplication(page, origin + "/party?section=characters");
    const leave = async () => {
      await page.locator("article.party-profile", { hasText: "Aster" }).getByRole("button", { name: "Manage placement & downtime" }).click();
      const panel = page.getByRole("region", { name: "Character locations and downtime" });
      await panel.getByLabel("In party", { exact: true }).uncheck();
      await panel.getByRole("button", { name: "Save character placement", exact: true }).click();
      return panel;
    };
    const panel = await leave();
    const prompt = panel.getByRole("status", { name: "Aster left the party" });
    await prompt.getByText("Aster left with 3 items and 42 gp, 3 sp.").waitFor();
    assert.equal(await sideways(page), false, `${width}: the prompt scrolls sideways`);
    await prompt.screenshot({ path: `test-results/departed-holdings/prompt-${width}.png` });
    // Declining keeps everything with Aster.
    const before = await books(page);
    await prompt.getByRole("button", { name: "Keep with Aster" }).click();
    await prompt.waitFor({ state: "detached" });
    assert.deepEqual(await books(page), before, "declining moves nothing");
    // The form stays available under the placement while Aster is away.
    await panel.getByText(/^Return Aster's items and coins to the party/).click();
    const form = panel.getByRole("form", { name: "Return Aster's items to the party" });
    await form.waitFor();
    await form.getByLabel("Return Lute").uncheck();
    const arrows = form.getByLabel("How many Arrows");
    assert.ok((await arrows.boundingBox()).width >= 60, `${width}: the quantity box is too narrow`);
    await arrows.fill("12");
    await form.getByLabel("Coins to return").fill("40 gp");
    assert.equal(await sideways(page), false, `${width}: the form scrolls sideways`);
    await form.screenshot({ path: `test-results/departed-holdings/form-${width}.png` });
    await form.getByRole("button", { name: "Review return" }).click();
    await panel.getByText("Return to the party?").waitFor();
    await panel.getByText("Ring of protection × 1 · attunement ends").waitFor();
    await panel.getByText("1 open treasure-pool claim withdrawn").waitFor();
    assert.equal(await sideways(page), false, `${width}: the review scrolls sideways`);
    await panel.getByRole("button", { name: "Return to party", exact: true }).click();
    await page.getByText("Returned to the party. The items are in the treasure pool, unclaimed.").first().waitFor();
    const after = await books(page);
    const pooled = after.holdings.filter((h) => h.purseId === "hoard" && h.pool && h.id !== "gem");
    assert.deepEqual(pooled.map((h) => h.quantity).sort(), [1, 12]);
    assert.ok(pooled.every((h) => !h.attuned), "returned items are not attuned");
    assert.equal(after.holdings.find((h) => h.id === "arrows").quantity, 8);
    assert.ok(after.holdings.some((h) => h.id === "lute" && h.purseId === "aster"), "the unticked lute stays");
    assert.equal(after.copper.aster, 230);
    assert.equal(after.copper.hoard, 4100);
    assert.equal(Object.values(after.copper).reduce((a, b) => a + b, 0), Object.values(before.copper).reduce((a, b) => a + b, 0), "copper is conserved");
    assert.equal(after.ledger.filter((l) => /^Returned to the party: /.test(l.summary) && l.purseId === "aster").length, 3);
    assert.equal(after.claims.length, 0, "Aster's claim is withdrawn");
    assert.equal(after.events.filter((e) => /^Withdrawn: Aster's Need claim on Ruby/.test(e.summary)).length, 1);
    assert.equal(after.events.filter((e) => /^Attunement ended: Ring of protection \(Aster\)/.test(e.summary)).length, 1);
    assert.equal(after.events.filter((e) => /^Aster returned to the party:/.test(e.summary)).length, 1);
    await page.screenshot({ path: `test-results/departed-holdings/done-${width}.png`, fullPage: width === 1280 });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Return to party browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
