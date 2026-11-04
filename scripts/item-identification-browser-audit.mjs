// Item identification (loot plan phase 5) in a disposable device campaign: the DM sees the true
// ring with an Unidentified chip naming what players see, marks a second item unidentified from
// its ⋯ menu, a player seat on the same device sees only the presented records ("unknown value"
// where the DM set none), and the DM identifies the ring once, logged once. No sideways scrolling
// at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const out = "test-results/item-identification";
await mkdir(out, { recursive: true });
const TRUE_NAME = "Ring of Djinni Summoning";
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return { holdings: t.holdings, events: t.journal?.events ?? [] };
  });
const seat = (page, role) =>
  page.evaluate(async (role) => {
    const { DM_SEAT, setSeat } = await import("/src/lib/quire/table.ts");
    setSeat(role === "dm" ? DM_SEAT : { ...DM_SEAT, role: "player", purseIds: ["aria"] });
  }, role);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const menu = async (page, name, item) => {
  await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).first().click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
};
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/party?section=funds");
    await page.evaluate(async (trueName) => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ gp: 5 }) },
          { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 1 }) },
        ],
        holdings: [
          {
            id: "ring", purseId: "aria", name: trueName, kind: "item", quantity: 1, unitCopper: 987653,
            notes: "Summons a djinni once a day.", category: "jewels",
            unidentified: { name: "Plain brass ring", description: "A dull ring, warm to the touch.", value: 2500 },
          },
          { id: "rope", purseId: "aria", name: "Hempen rope", kind: "item", quantity: 1, unitCopper: 100, notes: "", category: "general" },
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
    }, TRUE_NAME);
    await reloadApplication(page, origin + "/party?section=funds");
    await page.locator(".party-inventory").waitFor();

    // DM: the true ring, with what players see on its chip.
    await page.getByText("Unidentified · players see “Plain brass ring”").first().waitFor();
    await page.getByRole("button", { name: `Actions for ${TRUE_NAME}`, exact: true }).first().waitFor();
    assert.equal(await sideways(page), false, `${width}: the inventory scrolls sideways`);

    // DM: mark the rope unidentified without a value.
    await menu(page, "Hempen rope", "Mark unidentified");
    const mark = page.getByRole("dialog", { name: "Mark Hempen rope unidentified", exact: true });
    await mark.getByLabel("Name players see", { exact: true }).fill("Coil of cord");
    assert.equal(await sideways(page), false, `${width}: the dialog scrolls sideways`);
    await mark.screenshot({ path: `${out}/mark-${width}.png` });
    await mark.getByRole("button", { name: "Mark unidentified", exact: true }).click();
    await mark.waitFor({ state: "detached" });
    const marked = await books(page);
    assert.deepEqual(marked.holdings.find((h) => h.id === "rope").unidentified, { name: "Coil of cord" });
    assert.equal(marked.holdings.find((h) => h.id === "rope").name, "Hempen rope", "the true item is kept");

    // A player seat on this device: only the presented records, and "unknown value".
    await seat(page, "player");
    await reloadApplication(page, origin + "/party?section=funds");
    await page.locator(".party-inventory").waitFor();
    await page.getByText("Plain brass ring", { exact: true }).first().waitFor();
    await page.getByText("unknown value", { exact: true }).first().waitFor();
    const text = await page.locator("body").innerText();
    assert.ok(!text.includes(TRUE_NAME) && !text.includes("Hempen rope") && !text.includes("djinni"), `${width}: the player sees a true detail`);
    assert.equal(await sideways(page), false, `${width}: the player's inventory scrolls sideways`);
    await page.screenshot({ path: `${out}/player-${width}.png`, fullPage: width === 1280 });

    // DM: identify the ring once; the reveal is logged once.
    await seat(page, "dm");
    await reloadApplication(page, origin + "/party?section=funds");
    await page.locator(".party-inventory").waitFor();
    await menu(page, TRUE_NAME, "What players see / Identify");
    const dialog = page.getByRole("dialog", { name: `What players see: ${TRUE_NAME}`, exact: true });
    await dialog.getByRole("button", { name: "Identify", exact: true }).click();
    await page.getByRole("button", { name: "Identify", exact: true }).last().click();
    await page.getByText("Identified. Everyone who can see it now sees the true item.").first().waitFor();
    const after = await books(page);
    assert.equal(after.holdings.find((h) => h.id === "ring").unidentified, undefined);
    assert.equal(after.events.filter((e) => e.summary === `Identified: Plain brass ring is ${TRUE_NAME}`).length, 1);
    await page.screenshot({ path: `${out}/done-${width}.png`, fullPage: width === 1280 });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Item identification browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
