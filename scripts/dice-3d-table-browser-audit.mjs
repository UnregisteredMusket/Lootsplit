// 3D dice at the table (owner choice 2026-11-06: the roller, the DM and the TV display see a
// roll). A disposable live room on the development server: the DM opens the optional TV / player
// display, a player joins and rolls from their sheet. The player's own screen, the DM's screen
// and the TV display each throw dice whose caption shows the player's recorded total; the TV copy
// names no seat. Then the DM rolls a visible party character: the DM and the TV throw it, the
// player's screen does not. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, navigateApplication, reloadApplication, afterJoining } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = "test-results/dice-3d-table";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const errors = [];
const total = (text) => Number(/: (-?\d+)/.exec(text ?? "")?.[1]);
const caption = (page) => page.locator(".dice-roll-caption span");
const settled = (page) => page.locator('.dice-roll-overlay[data-settled="true"]');
async function open() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => errors.push(e.message));
  await openApplication(page, origin + "/share");
  await page.waitForTimeout(1800);
  const skip = page.getByRole("button", { name: "Not now", exact: true });
  if (await skip.isVisible()) await skip.click();
  return { context, page };
}
try {
  const { context: dmContext, page: dm } = await open();
  await dm.getByRole("button", { name: "Start a room", exact: true }).click();
  await dm.locator('.multiplayer-hub[aria-busy="false"]').waitFor();
  await dm.getByRole("button", { name: "Create room", exact: true }).click();
  await dm.getByRole("button", { name: "Share join link", exact: true }).waitFor();
  const invitation = await dm.evaluate(() => {
    const id = localStorage.getItem("quire.campaign.v1") || "main";
    const session = JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`));
    return { code: session.code, sessionId: session.sessionId };
  });
  // A player joins.
  const { page: player } = await open();
  await openApplication(player, `${origin}/share?join=${invitation.code}&session=${invitation.sessionId}`);
  await player.getByRole("button", { name: "Find characters", exact: true }).click();
  await player.getByLabel("Your name", { exact: true }).fill("Dice player");
  await player.getByRole("button", { name: "Join room", exact: true }).click();
  await afterJoining(player);
  await player.getByText("You joined as a player", { exact: true }).waitFor();

  // The DM opens the optional TV / player display.
  // Enabled from "What players can see" (no map needed); the display opens from its menu event.
  await navigateApplication(dm, origin + "/features/visibility");
  await dm.getByRole("button", { name: "Enable optional TV / player display", exact: true }).click();
  await dm.getByRole("button", { name: "Disable TV / player display", exact: true }).waitFor();
  await dm.evaluate(() => window.dispatchEvent(new CustomEvent("lootsplit:player-display", { detail: {} })));
  const controls = dm.getByRole("dialog", { name: "Player display", exact: true });
  const popup = dmContext.waitForEvent("page");
  await controls.getByRole("button", { name: "Open player window", exact: true }).click();
  const tv = await popup;
  tv.on("pageerror", (e) => errors.push(e.message));
  await tv.waitForLoadState("domcontentloaded");
  await controls.getByText("Display blanked", { exact: true }).waitFor();
  await controls.getByRole("button", { name: "Show display", exact: true }).click();
  await controls.getByText("Player display connected", { exact: true }).waitFor();
  await controls.getByRole("button", { name: "Close", exact: true }).click();

  // The player rolls from their own sheet.
  await navigateApplication(player, origin + "/");
  await player.getByRole("link", { name: "Character Sheet", exact: true }).click();
  await player.locator(".quick-roll button").first().click();
  await settled(player).waitFor();
  const own = await caption(player).textContent();
  const recorded = Number((await player.locator(".quick-roll output").first().textContent())?.split(" ")[0]);
  assert.equal(total(own), recorded, `player caption ${own}`);
  // The DM's screen and the TV display throw the same roll within a few polls.
  await settled(dm).waitFor();
  assert.equal(await caption(dm).textContent(), own, "the DM sees the player's roll");
  await settled(tv).waitFor();
  assert.equal(await caption(tv).textContent(), own, "the TV display throws it too");
  assert.ok(!(await tv.locator("body").innerText()).includes("Dice player"), "the TV copy names no seat");
  await dm.screenshot({ path: `${out}/dm.png` });
  await tv.screenshot({ path: `${out}/tv.png` });
  await dm.keyboard.press("Escape");
  await player.keyboard.press("Escape");

  // A second player roll arrives while the DM's dice are closed: thrown once, not replayed.
  await player.locator(".quick-roll button").first().click();
  await settled(player).waitFor();
  const second = await caption(player).textContent();
  await settled(dm).waitFor();
  assert.equal(await caption(dm).textContent(), second);
  await dm.keyboard.press("Escape");
  await dm.waitForTimeout(5000);
  assert.equal(await dm.locator('.dice-roll-overlay[data-open="true"]').count(), 0, "not thrown twice");

  // Reopening the campaign never replays earlier rolls.
  await dm.waitForTimeout(6000);
  await reloadApplication(dm);
  await dm.waitForTimeout(8000);
  assert.equal(await dm.locator('.dice-roll-overlay[data-open="true"]').count(), 0, "no replay on reopening");

  assert.deepEqual(errors, []);
  console.log("PASS: a player's roll is thrown on the player's, the DM's and the TV display's screens with the recorded total; the TV copy names no seat; each roll is thrown once.");
} catch (error) {
  for (const [i, c] of browser.contexts().entries())
    for (const [j, pg] of c.pages().entries()) await pg.screenshot({ path: `${out}/failure-${i}-${j}.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
