// "What players can see" in a disposable device campaign: the DM opens it from Settings, sees each
// area with its hidden counts (a hidden NPC, a private map, a DM-only marker, a hidden objective),
// flips the black market in place and finds the original control in Market changed too, starts
// "Preview as <player>" from the page, and a player seat gets only "This screen is available to
// the campaign DM." with no counts. No sideways scrolling at 1280, 390 and 320 px. Never targets a
// real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { navigateApplication, openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/visibility-center", { recursive: true });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const blackMarket = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    return (await economySnapshot()).journal?.world?.blackMarketActive === true;
  });
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 760 : 900 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/settings");
    await page.evaluate(async () => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (c) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
      const image = "data:image/png;base64,AAAA";
      await applyCloudTable({
        purses: [
          { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 11 }) },
          { id: "spy", name: "The Spy", kind: "character", control: "npc", nonParty: true, coins: coins({ gp: 777 }) },
        ],
        holdings: [],
        shops: [
          { id: "bm", name: "Back room", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1, blackMarket: true },
        ],
        stock: [],
        ledger: [],
        listings: [],
        loans: [],
        sheets: [],
        notes: [],
        journal: readJournal({
          market: {
            currentLocationId: "town",
            locations: [
              { id: "vale", name: "Vale", kind: "region", parentId: null, description: "" },
              { id: "town", name: "Harrowgate", kind: "town", parentId: "vale", description: "" },
            ],
          },
          quests: {
            quests: [
              {
                id: "q",
                title: "The missing seal",
                status: "active",
                audience: { kind: "party" },
                summary: "",
                createdAt: 1,
                updatedAt: 1,
                revision: 0,
                objectives: [{ id: "o", text: "Find the spy", state: "open", hidden: true }],
              },
            ],
          },
          world: {
            characterPositions: [],
            npcs: [{ id: "spy", name: "The Spy", description: "", locationId: "town", visible: false, barterAllowed: false, controllerPurseId: null }],
            maps: [
              {
                id: "town-map",
                name: "Town map",
                image,
                locationId: "town",
                visible: true,
                anchors: [],
                markers: [{ id: "lair", label: "Lair", description: "", x: 0.5, y: 0.5, visibility: "dm" }],
              },
              { id: "vault", name: "DM vault", image, locationId: null, visible: false, anchors: [], markers: [] },
            ],
          },
        }),
      });
    });
    await reloadApplication(page, origin + "/settings");
    // Settings → What players can see (in-app link, no title-screen replay).
    await page.getByRole("link", { name: /What players can see/ }).first().click();
    await page.getByRole("heading", { name: "What players can see" }).waitFor();
    const center = page.getByTestId("visibility-center");
    await center.waitFor();
    for (const [id, value] of [["hidden-npcs", "1"], ["private-maps", "1"], ["dm-markers", "1"], ["hidden-objectives", "1"], ["black-market-vendors", "1"]])
      assert.equal(
        (await page.getByTestId(`visibility-count-${id}`).locator(".visibility-count").innerText()).trim(),
        value,
        `${width}: count ${id}`,
      );
    assert.equal(await sideways(page), false, `${width}: the page scrolls sideways`);
    await page.screenshot({ path: `test-results/visibility-center/page-${width}.png`, fullPage: true });

    // In place: Reveal black market sends the existing command; the state and Market follow.
    assert.equal(await blackMarket(page), false);
    const row = page.getByTestId("visibility-switch-black-market");
    await row.getByRole("button", { name: "Reveal black market" }).click();
    await row.getByRole("button", { name: "Hide black market" }).waitFor();
    assert.equal((await page.getByTestId("visibility-state-black-market").innerText()).trim(), "Available");
    assert.equal(await blackMarket(page), true);
    await navigateApplication(page, origin + "/market");
    // The original control (Market › Black market) shows the same state.
    await page.getByRole("button", { name: /^Black market.*Reveal or hide/ }).click();
    await page.getByText("Black market is available.").first().waitFor();
    await page.getByRole("button", { name: "Hide black market" }).waitFor();
    await navigateApplication(page, origin + "/features/visibility");
    await page.getByTestId("visibility-center").waitFor();

    // Preview as the player from the page, then stop.
    await page.getByRole("button", { name: "Preview as Aria Thorne" }).click();
    const banner = page.locator(".player-preview-banner");
    await banner.getByText("Previewing as Aria Thorne").waitFor();
    await navigateApplication(page, origin + "/features/visibility");
    await page.getByRole("heading", { name: "Not available in preview" }).waitFor();
    assert.equal(await page.getByTestId("visibility-center").count(), 0, `${width}: the page rendered in a preview`);
    await banner.getByRole("button", { name: "Stop preview" }).click();
    await banner.waitFor({ state: "detached" });

    // A player seat on this device never gets the page or its counts.
    await page.evaluate(async () => {
      const { setSeat } = await import("/src/lib/quire/table.ts");
      setSeat({ role: "player", purseIds: ["aria"], shopIds: [], openedAt: Date.now() });
    });
    await navigateApplication(page, origin + "/features/visibility");
    await page.getByText("This screen is available to the campaign DM.").waitFor();
    assert.equal(await page.getByTestId("visibility-center").count(), 0, `${width}: a player saw the page`);
    const text = await page.locator("body").innerText();
    assert.ok(!/hidden or DM-only records|Hidden NPCs/.test(text), `${width}: a player saw hidden counts`);
    assert.equal(await sideways(page), false, `${width}: the player notice scrolls sideways`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("What players can see browser audit passed at 1280, 390 and 320 px.");
} finally {
  await browser.close();
}
