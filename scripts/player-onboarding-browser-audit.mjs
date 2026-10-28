// Player onboarding in a shared room (design plan P2-P5, P8; Q15-Q17, Q21, Q23-Q25), on a disposable
// local server only. A signed-in DM names a campaign "The Wayfarers" and opens a live room; at
// 1280, 390 and 320 px a guest player opens the join link and the audit checks:
// - the join card names the campaign ("Joining The Wayfarers"), and after joining the header
//   switcher, the room card and the tab title ("Mira · The Wayfarers") show the DM's name,
//   never the device default "Party overview";
// - the join link finds its characters by itself, the support panels fold into one group until
//   joining, an empty name is refused inline, "Your name" is remembered, and the player lands on
//   Home with "You're playing <character>" and a dismissible Sheet · Inventory & coins · Chat strip;
// - a healthy room is a "● Live" header pill instead of the status card (the card returns when
//   offline), the phone scene strip is at most 48 px, and Home shows "Since you were away" with
//   the pooled lot waiting for the player's claim;
// - the character sheet opens straight to the sheet with a Home breadcrumb, the DM lock as an
//   icon, no save bar until an edit, quick ±HP that saves, a "Last roll" chip and the shared-room
//   roll-log wording; the character library is folded below the sheet and opens from Sheet tools;
// - Campaign → Chat fills the screen with no Messages fold or recovery panels, keeps its composer
//   above the bottom navigation, and offers "Jump to latest" after scrolling up;
// - on Campaign, players read the room mode ("The DM runs this room in Live mode") and no
//   DM invite instructions;
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
      const { blankSheet } = await import("/src/lib/characters/model.mjs");
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins: coins(40) },
          ...players.map((p) => ({
            id: p.id,
            name: p.name,
            kind: "character",
            coins: coins(12),
            sheet: { ...blankSheet(), name: p.name, hp: 10, maxHp: 12 },
          })),
        ],
        // One pooled lot: "Since you were away" counts it as waiting for the player's claim.
        holdings: [
          {
            id: "pooled-sword",
            purseId: "hoard",
            name: "+1 Longsword",
            kind: "item",
            quantity: 1,
            unitCopper: 50000,
            notes: "",
            pool: { at: Date.now(), source: "add-loot" },
          },
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
    const joinLink = `${origin}/share?join=${room.code}&session=${room.sessionId}`;
    await openApplication(page, joinLink);
    // The link looks up the room's characters by itself (Q15): no "Find characters" tap.
    await expect(page.getByRole("heading", { name: `Joining ${CAMPAIGN}`, exact: true })).toBeVisible();
    const picker = page.getByRole("combobox", { name: "Choose your character", exact: true });
    await expect(picker).toBeVisible();
    // Recovery, backups and manual sharing fold into one group until the player has joined (P3).
    const support = page.getByText("Recovery, backups & manual sharing", { exact: true });
    await expect(support).toBeVisible();
    await expect(page.getByText("Manual sharing & files", { exact: true })).toBeHidden();
    // Inline validation instead of the browser's bubble.
    await page.getByLabel("Your name", { exact: true }).fill("");
    await page.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Enter the name the party should call you." })).toBeVisible();
    await expect(page.getByLabel("Your name", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Your name", { exact: true })).toBeFocused();
    await page.getByLabel("Your name", { exact: true }).fill(`Audit player ${player.width}`);
    await picker.selectOption(player.id);
    await fits(page, `join ${player.width}`);
    await page.screenshot({ path: `${output}/join-${player.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Join room", exact: true }).click();
    // Players land on Home with a toast and the three-tip strip (Q16).
    await page.waitForURL((u) => u.pathname === "/" && u.searchParams.get("view") === "home");
    await expect(page.getByText(`You're playing ${player.name}`, { exact: true })).toBeVisible();
    const tips = page.getByRole("region", { name: "Getting started", exact: true });
    await expect(tips.getByRole("link")).toHaveText(["Sheet", "Inventory & coins", "Chat"]);
    await fits(page, `home tips ${player.width}`);
    await page.screenshot({ path: `${output}/joined-home-${player.width}.png`, fullPage: true });
    await expect(page).toHaveTitle(`${player.name} · ${CAMPAIGN}`);
    // A healthy room is a header pill, not a status card (P4).
    const pill = page.locator(".room-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute("aria-label", /^Live · Room online · Play active · Saved to room/);
    await expect(page.locator(".sync-status")).toHaveCount(0);
    const away = page.getByRole("region", { name: "Since you were away", exact: true });
    await expect(away.getByRole("link", { name: "1 item waiting for your claim →", exact: true })).toBeVisible();
    if (player.width <= 430) {
      const strip = await page
        .locator(".submenu-workspace[data-submenu-scene]")
        .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).paddingTop)));
      assert.ok(strip.every((px) => px <= 48), `${player.width}: the scene strip is at most 48 px (${strip})`);
    }
    if (player.width === 390) {
      await tips.getByRole("button", { name: "Dismiss getting started tips", exact: true }).click();
      await expect(tips).toHaveCount(0);
    }
    if (player.width === 320) {
      // Offline: the pill gives way to the full card that says what needs attention.
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(page.locator(".sync-status")).toContainText("Offline");
      await expect(pill).toHaveCount(0);
      await page.screenshot({ path: `${output}/offline-${player.width}.png`, fullPage: true });
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(pill).toBeVisible();
    }
    await navigateApplication(page, origin + "/share");
    await page.getByText("You joined as a player", { exact: true }).waitFor();
    // Players read the room's mode; only the DM's seat has the switch.
    await expect(page.locator("[data-room-mode]")).toHaveText("The DM runs this room in Live mode.");
    await expect(page.getByRole("group", { name: "Session mode", exact: true })).toHaveCount(0);
    await expect(page.getByText(/to invite players/)).toHaveCount(0);

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
    // The character sheet opens straight to the sheet (P5, Q25).
    await page.getByRole("link", { name: "Open character sheet →", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/characters");
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb", exact: true });
    await expect(breadcrumb).toContainText("Home › Character sheet");
    await expect(page.getByRole("heading", { name: player.name, exact: true, level: 2 })).toBeVisible();
    // Library and import wait below the sheet, folded; the DM lock is an icon beside Edit.
    await expect(page.locator("#character-library")).not.toHaveAttribute("open", "");
    const sheetTop = await page.locator(".play-sheet").evaluate((el) => el.getBoundingClientRect().top);
    const libraryTop = await page.locator("#character-library").evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(libraryTop > sheetTop, `${player.width}: the library sits below the sheet`);
    await expect(page.getByRole("img", { name: /Character editing is locked by the DM/ })).toBeVisible();
    await expect(page.getByText("Saved character", { exact: true })).toBeVisible();
    await expect(page.locator(".character-savebar.is-dirty")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save character", exact: true })).toHaveCount(0);
    // Quick ±HP saves at once.
    await page.getByRole("button", { name: "+1 HP", exact: true }).click();
    await expect(page.locator(".play-vitals")).toContainText("11 / 12");
    await expect(page.getByText("Saved character", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "−1 HP", exact: true }).click();
    await expect(page.locator(".play-vitals")).toContainText("10 / 12");
    await expect(page.getByText("Saved character", { exact: true })).toBeVisible();
    // A roll shows beside the dice button, and the room log says where it is kept.
    await page.getByRole("button", { name: /^Initiative / }).first().click();
    await expect(page.locator(".last-roll-chip")).toContainText(/^Last roll · Initiative -?\d+$/);
    await expect(page.getByText(/Visible to current campaign members\.|Saved with this character in the shared campaign\./)).toBeVisible();
    await expect(page.locator(".roll-log li").first()).toContainText("Initiative");
    await expect(page.getByText(/Saved with this character on this device\./)).toHaveCount(0);
    await fits(page, `sheet ${player.width}`);
    await page.screenshot({ path: `${output}/sheet-${player.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Sheet tools", exact: true }).click();
    await page.getByRole("button", { name: "My characters · choose, create or import", exact: true }).click();
    await expect(page.locator("#character-library")).toHaveAttribute("open", "");
    await expect(page.getByLabel("Choose character", { exact: true })).toBeVisible();
    // Campaign → Chat is the whole tab: no Messages fold, no recovery panels, a pinned composer (P8, Q24).
    await navigateApplication(page, origin + "/share?chat=1");
    const composer = page.locator("#chat-message");
    await expect(composer).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Messages/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Connection & recovery/ })).toBeHidden();
    const history = page.getByRole("log", { name: "Messages", exact: true });
    const historyHeight = await history.evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(historyHeight >= 250, `${player.width}: chat history is ${historyHeight}px tall`);
    if (player.width === 390) {
      for (let i = 1; i <= 8; i++) {
        await composer.fill(`Onboarding check ${i}: the road is long and the night is dark.`);
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(history.getByText(`Onboarding check ${i}:`, { exact: false })).toBeVisible();
      }
      // Once every message is confirmed, no incoming update scrolls the history back down.
      await expect(history.locator(".chat-time").filter({ hasText: "Sent" })).toHaveCount(8);
      await history.evaluate((el) => el.scrollTo({ top: 0 }));
      const jump = page.getByRole("button", { name: "Jump to latest ↓", exact: true });
      await expect(jump).toBeVisible();
      await jump.click();
      await expect(jump).toHaveCount(0);
      await expect(history.getByText("Onboarding check 8:", { exact: false })).toBeInViewport();
    }
    // The composer sits above the bottom navigation, inside the viewport.
    const composerBox = await page.locator(".chat-composer").boundingBox();
    const viewport = page.viewportSize();
    assert.ok(composerBox && composerBox.y + composerBox.height <= viewport.height + 1, `${player.width}: composer is on screen`);
    if (player.width < 1024) {
      const navBox = await page.locator("nav.fixed[aria-label='Sections']").boundingBox();
      assert.ok(composerBox.y + composerBox.height <= navBox.y + 1, `${player.width}: composer clears the bottom nav`);
    }
    await fits(page, `chat ${player.width}`);
    await page.screenshot({ path: `${output}/chat-${player.width}.png` });

    if (player.width === 1280) {
      // "Your name" is remembered on this device for the next join.
      await navigateApplication(page, origin + "/share");
      await page.getByRole("button", { name: "Leave room", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Leave room", exact: true }).click();
      await page.getByRole("button", { name: "Join a room", exact: true }).waitFor();
      await openApplication(page, joinLink);
      await expect(page.getByRole("heading", { name: `Joining ${CAMPAIGN}`, exact: true })).toBeVisible();
      await expect(page.getByLabel("Your name", { exact: true })).toHaveValue(`Audit player ${player.width}`);
    }
    await context.close();
  }
  await dm.context.close();
  assert.deepEqual(errors, []);
  console.log("PASS: player onboarding: campaign name, automatic join lookup, inline validation, remembered name, Home landing with tips and read-only room mode, status pill, scene strip, Since you were away, the character sheet and chat at 1280/390/320.");
} finally {
  await browser.close();
}
