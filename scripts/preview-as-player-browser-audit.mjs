// Preview as player in a disposable device campaign: the DM opens Party → Preview as player,
// chooses a character and sees that player's screens (Home, Inventory & purse, Campaign chat)
// under a persistent "Previewing as … — read-only" banner. DM-only records (a hidden NPC and
// its items, a DM-only ledger line, another player's whisper) never appear, a screen outside
// the player's main screens says "Not available in preview", a command attempted during the
// preview is refused and changes nothing, and Stop preview restores the DM view without a
// reload. No sideways scrolling at 1280, 390 and 320 px. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { navigateApplication, openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/preview-as-player", { recursive: true });
const SECRETS = ["Forged seal", "Bribe from the duke", "The Spy", "Bram, the spy is your cousin"];
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const { canonicalJson } = await import("/src/lib/quire/canonical-json.ts");
    return canonicalJson(await economySnapshot());
  });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const noSecrets = async (page, where) => {
  const text = await page.locator("body").innerText();
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${where}: the preview shows DM-only "${secret}"`);
};
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/party");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      const item = (id, purseId, name) => ({ id, purseId, name, kind: "item", quantity: 1, unitCopper: 100, notes: "" });
      await applyCloudTable({
        purses: [
          { id: "fund", name: "Party fund", kind: "party", coins: coins({ gp: 50 }) },
          { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 11 }) },
          { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 22 }) },
          { id: "spy", name: "The Spy", kind: "character", control: "npc", nonParty: true, coins: coins({ gp: 777 }) },
        ],
        holdings: [item("rope", "aria", "Coil of rope"), item("seal", "spy", "Forged seal")],
        shops: [],
        stock: [],
        ledger: [
          { id: "l-aria", at: 1, purseId: "aria", shopId: null, summary: "Advance from the guild", copper: 400 },
          { id: "l-spy", at: 2, purseId: "spy", shopId: null, summary: "Bribe from the duke", copper: 70000 },
        ],
        listings: [],
        loans: [],
        sheets: [],
        notes: [
          { id: "n-party", at: 10, from: "dm", to: "party", purseId: "", text: "Welcome to Harrowgate." },
          { id: "n-bram", at: 11, from: "dm", to: "dm", purseId: "bram", text: "Bram, the spy is your cousin." },
        ],
        journal: readJournal({
          market: {
            currentLocationId: "town",
            locations: [
              { id: "vale", name: "Vale", kind: "region", parentId: null, description: "" },
              { id: "town", name: "Harrowgate", kind: "town", parentId: "vale", description: "" },
            ],
          },
          world: {
            characterPositions: [],
            maps: [],
            npcs: [{ id: "spy", name: "The Spy", description: "", locationId: "town", visible: false, barterAllowed: false, controllerPurseId: null }],
          },
        }),
      });
    });
    await reloadApplication(page, origin + "/party");
    const before = await books(page);
    await page.getByRole("button", { name: "Preview as player" }).click();
    const chooser = page.getByRole("dialog", { name: "Preview as player" });
    await chooser.getByRole("button", { name: "Aria Thorne" }).click();
    const banner = page.locator(".player-preview-banner");
    await banner.getByText("Previewing as Aria Thorne").waitFor();
    await banner.getByText("read-only").waitFor();
    // The Party screen is now the player's Inventory & purse.
    await page.getByRole("heading", { name: "Inventory & purse" }).waitFor();
    await page.getByText("Coil of rope").first().waitFor();
    await noSecrets(page, `${width} party`);
    assert.equal(await sideways(page), false, `${width}: the preview scrolls sideways`);
    await page.screenshot({ path: `test-results/preview-as-player/party-${width}.png` });

    // A command attempted during the preview is refused and changes nothing.
    const refused = await page.evaluate(async () => {
      const { executeLocalCommand } = await import("/src/lib/quire/economy.ts");
      try {
        await executeLocalCommand({ id: "audit-preview-give", kind: "give", fromId: "aria", toId: "bram", copper: 100, holdingId: null, quantity: 0 });
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    assert.match(refused, /Previewing as Aria Thorne — read-only/);

    // Campaign: the app's chat holds the party message, never another player's whisper (a device
    // campaign has no live chat; its message list is the one every chat screen reads).
    await navigateApplication(page, origin + "/share");
    await page.getByRole("tab", { name: /^Chat/ }).click();
    const chat = await page.evaluate(async () =>
      (await import("/src/lib/quire/chat.ts")).getChatSnapshot().map((n) => n.id),
    );
    assert.ok(chat.includes("n-party"), `${width}: the party message is missing from the preview chat`);
    assert.ok(!chat.includes("n-bram"), `${width}: another player's whisper is in the preview chat`);
    await noSecrets(page, `${width} campaign`);
    await banner.getByText("Previewing as Aria Thorne").waitFor();
    assert.equal(await sideways(page), false, `${width}: the chat preview scrolls sideways`);

    // A screen outside the player's main screens shows no data.
    await navigateApplication(page, origin + "/market");
    await page.getByRole("heading", { name: "Not available in preview" }).waitFor();
    assert.equal(await sideways(page), false, `${width}: the unavailable notice scrolls sideways`);

    // Home stays inside the preview (in-app navigation, no reload).
    await navigateApplication(page, origin + "/");
    await banner.getByText("Previewing as Aria Thorne").waitFor();
    await noSecrets(page, `${width} home`);
    await page.screenshot({ path: `test-results/preview-as-player/home-${width}.png` });

    // Stop preview: the DM view returns without reloading the campaign.
    await page.evaluate(() => (window.previewAuditMarker = "same-document"));
    await banner.getByRole("button", { name: "Stop preview" }).click();
    await banner.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.previewAuditMarker), "same-document", "Stop preview reloaded the page");
    await navigateApplication(page, origin + "/party");
    await page.getByRole("heading", { name: "Party", exact: true }).waitFor();
    assert.equal(await page.evaluate(async () => (await import("/src/lib/quire/table.ts")).getSeat().role), "dm");
    assert.equal(await books(page), before, `${width}: the preview changed the campaign`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Preview as player browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
