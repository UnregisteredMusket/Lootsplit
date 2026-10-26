// Player onboarding in a shared room (design plan P2-P5, P8; Q15-Q17, Q21, Q23-Q25), on a disposable
// local server only. A signed-in DM names a campaign "The Wayfarers" and opens a live room; at
// 1280, 390 and 320 px a guest player opens the join link and the audit checks:
// - the join card names the campaign ("Joining The Wayfarers"), and after joining the header
//   switcher, the room card and the tab title ("Mira · The Wayfarers") show the DM's name,
//   never the device default "Party overview";
// - no screen scrolls sideways.
// Never targets a real campaign.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir } from "node:fs/promises";
import { openApplication, navigateApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "Onboarding fixtures require a disposable server");
const output = "test-results/player-onboarding";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const errors = [];
const ip = () => `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
const CAMPAIGN = "The Wayfarers";
const players = [
  { width: 1280, id: "mira", name: "Mira" },
  { width: 390, id: "kael", name: "Kael" },
  { width: 320, id: "tamsin", name: "Tamsin Reed" },
];

async function device(label, width) {
  const context = await browser.newContext({
    viewport: { width, height: width < 400 ? 780 : 900 },
    serviceWorkers: "block",
    extraHTTPHeaders: { "cf-connecting-ip": ip() },
  });
  await context.route(
    (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
    (route) => route.abort(),
  );
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  return { context, page };
}
async function fits(page, label) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${label}: the page scrolls sideways`,
  );
}

try {
  // The DM: a signed-in device campaign with three player characters, named and shared live.
  const dm = await device("dm", 1280);
  dm.page.setDefaultTimeout(90000); // The first visit compiles the development server's modules.
  await openApplication(dm.page, origin + "/party");
  dm.page.setDefaultTimeout(25000);
  await dm.page.evaluate(
    async ({ campaign, players }) => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const coins = (gp) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins: coins(40) },
          ...players.map((p) => ({ id: p.id, name: p.name, kind: "character", coins: coins(12) })),
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
      const { getCampaigns, renameCampaign } = await import("/src/lib/quire/campaigns.ts");
      renameCampaign(getCampaigns().activeId, campaign);
      const c = await import("/src/lib/quire/cloud-client.ts");
      await c.chooseTableMode("live");
    },
    { campaign: CAMPAIGN, players },
  );
  const room = await dm.page.evaluate(async () => {
    const { getCloudTable } = await import("/src/lib/quire/cloud-client.ts");
    const view = getCloudTable();
    return { code: view.code, sessionId: view.sessionId };
  });
  assert.match(room.code, /^[A-Z0-9]{4,12}$/);
  await navigateApplication(dm.page, origin + "/share");
  await expect(dm.page.getByRole("button", { name: `Select campaign: ${CAMPAIGN}`, exact: true })).toBeVisible();

  for (const player of players) {
    const { context, page } = await device(`player ${player.width}`, player.width);
    await openApplication(page, `${origin}/share?join=${room.code}&session=${room.sessionId}`);
    await page.getByRole("button", { name: "Find characters", exact: true }).click();
    await expect(page.getByRole("heading", { name: `Joining ${CAMPAIGN}`, exact: true })).toBeVisible();
    await page.getByLabel("Your name", { exact: true }).fill(`Audit player ${player.width}`);
    await page.getByRole("combobox", { name: "Choose your character", exact: true }).selectOption(player.id);
    await fits(page, `join ${player.width}`);
    await page.screenshot({ path: `${output}/join-${player.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Join room", exact: true }).click();
    await page.getByText("You joined as a player", { exact: true }).waitFor();

    // The DM's name everywhere a player looks for it; never the device default.
    const switcher = page.getByRole("button", { name: `Select campaign: ${CAMPAIGN}`, exact: true });
    await expect(switcher).toBeVisible();
    await expect(page.locator("[data-campaign-name]")).toHaveText(CAMPAIGN);
    await expect(page.getByText("Party overview", { exact: true })).toHaveCount(0);
    await expect(page).toHaveTitle(`Campaign · ${player.name} · ${CAMPAIGN}`);
    await fits(page, `room ${player.width}`);
    await page.screenshot({ path: `${output}/room-${player.width}.png`, fullPage: true });
    await navigateApplication(page, origin + "/?view=home");
    await expect(page).toHaveTitle(`${player.name} · ${CAMPAIGN}`);
    await switcher.click();
    await expect(page.getByRole("dialog")).toContainText(CAMPAIGN);
    await page.keyboard.press("Escape");
    await fits(page, `home ${player.width}`);
    await page.screenshot({ path: `${output}/home-${player.width}.png`, fullPage: true });
    await context.close();
  }
  await dm.context.close();
  assert.deepEqual(errors, []);
  console.log("PASS: player onboarding: campaign name on the join card, header, room card and tab title at 1280/390/320.");
} finally {
  await browser.close();
}
