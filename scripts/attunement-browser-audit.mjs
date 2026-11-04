// Attunement (loot plan phase 5) in a disposable device campaign: the DM attunes a character to
// three items, attunes a fourth only after confirming the override, ends one attunement, gives an
// attuned item away (the attunement ends; the receiver is not attuned) and marks an item as
// requiring attunement in Edit item. Each change is one activity event and no ledger line; no
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
await mkdir("test-results/attunement", { recursive: true });
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return {
      holdings: Object.fromEntries(
        t.holdings.map((h) => [h.id, { purseId: h.purseId, attuned: !!h.attuned, requires: h.requiresAttunement ?? null }]),
      ),
      ledger: t.ledger.filter((l) => l.copper !== 0).length,
      events: (t.journal?.events ?? []).map((e) => e.summary).filter((s) => /attun/i.test(s)),
    };
  });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const menu = async (page, name) => {
  await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).first().click();
};
const choose = async (page, name, action) => {
  await menu(page, name);
  await page.getByRole("menuitem", { name: action, exact: true }).click();
};
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/party?section=funds");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
      const REQ = "Requires attunement";
      const item = (id, name, extra = {}) => ({
        id, purseId: "aria", name, kind: "item", quantity: 1, unitCopper: 5000, notes: "", ...extra,
      });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins },
          { id: "aria", name: "Aria Thorne", kind: "character", coins },
          { id: "bram", name: "Bram Ironfoot", kind: "character", coins },
        ],
        holdings: [
          item("ring", "Ring of protection", { requiresAttunement: REQ }),
          item("cloak", "Cloak of elvenkind", { requiresAttunement: REQ }),
          item("amulet", "Amulet of health", { requiresAttunement: REQ }),
          item("staff", "Staff of power", { requiresAttunement: `${REQ}: by a wizard` }),
          item("rope", "Rope of climbing"),
        ],
        shops: [], stock: [], ledger: [], listings: [], loans: [], sheets: [], notes: [],
        journal: readJournal({}),
      });
    });
    await reloadApplication(page, origin + "/party?section=funds");
    await page.getByText("Ring of protection", { exact: true }).first().waitFor();

    for (const name of ["Ring of protection", "Cloak of elvenkind", "Amulet of health"]) {
      await choose(page, name, "Attune");
      await page.getByText(`Attuned to ${name}.`).first().waitFor();
    }
    // The fourth: the DM confirms the override.
    await choose(page, "Staff of power", "Attune");
    await page.getByText("Aria Thorne is attuned to 3 of 3 items.", { exact: false }).waitFor();
    assert.equal(await sideways(page), false, `${width}: the override dialog scrolls sideways`);
    await page.screenshot({ path: `test-results/attunement/override-${width}.png` });
    await page.getByRole("button", { name: "Attune past the limit", exact: true }).click();
    await page.getByText("Attuned to Staff of power.").first().waitFor();

    await choose(page, "Ring of protection", "End attunement");
    await page.getByText("Attunement to Ring of protection ended.").first().waitFor();

    // Give an attuned item away: the attunement ends and Bram is not attuned.
    await page.evaluate(async () => {
      const { executeLocalCommand } = await import("/src/lib/quire/economy.ts");
      await executeLocalCommand({ id: "audit-give", kind: "give", fromId: "aria", toId: "bram", copper: 0, holdingId: "cloak", quantity: 1 });
    });
    await reloadApplication(page, origin + "/party?section=funds");
    await page.getByText("Rope of climbing", { exact: true }).first().waitFor();

    // Edit item: mark the rope as requiring attunement.
    await choose(page, "Rope of climbing", "Edit");
    const edit = page.getByRole("dialog", { name: "Edit Rope of climbing" });
    await edit.getByRole("switch", { name: "Requires attunement" }).click();
    await edit.getByLabel("Attunement requirement for Rope of climbing").fill("Requires attunement: by a ranger");
    assert.equal(await sideways(page), false, `${width}: Edit item scrolls sideways`);
    await edit.screenshot({ path: `test-results/attunement/edit-${width}.png` });
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved Rope of climbing.").first().waitFor();

    const after = await books(page);
    assert.deepEqual(
      Object.fromEntries(Object.entries(after.holdings).map(([id, h]) => [id, h.attuned])),
      { ring: false, amulet: true, staff: true, rope: false, "audit-give-item": false },
    );
    assert.equal(after.holdings["audit-give-item"].purseId, "bram");
    assert.equal(after.holdings.rope.requires, "Requires attunement: by a ranger");
    assert.equal(after.ledger, 0, "no money moved");
    assert.deepEqual(after.events, [
      "Attuned Aria Thorne to Ring of protection: attuned 1/3",
      "Attuned Aria Thorne to Cloak of elvenkind: attuned 2/3",
      "Attuned Aria Thorne to Amulet of health: attuned 3/3",
      "Attuned Aria Thorne to Staff of power: attuned 4/3 (DM override past the limit of 3)",
      "Ended attunement to Ring of protection (Aria Thorne): attuned 3/3",
      "Attunement ended: Cloak of elvenkind (Aria Thorne) left the character; attuned 2/3",
    ]);
    assert.ok((await page.getByText("Attuned", { exact: true }).count()) >= 2, "attuned rows show a chip");
    assert.equal(await sideways(page), false, `${width}: the inventory scrolls sideways`);
    await page.screenshot({ path: `test-results/attunement/done-${width}.png`, fullPage: width === 1280 });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Attunement browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
