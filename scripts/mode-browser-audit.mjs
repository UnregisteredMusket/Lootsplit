import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8081";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [];
const contexts = [];
const results = [];
async function open() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await openApplication(page, origin + "/share");
  await page.waitForTimeout(1800);
  const skip = page.getByRole("button", { name: "Not now", exact: true });
  if (await skip.isVisible()) await skip.click();
  return page;
}
try {
  const dm = await open();
  await dm.getByRole("button", { name: "Turn-based Mode", exact: true }).click();
  await dm.getByText(/Code [A-Z2-9]{5}/).waitFor();
  const code = (
    await dm
      .getByText(/Code [A-Z2-9]{5}/)
      .first()
      .innerText()
  ).match(/Code ([A-Z2-9]{5})/)[1];
  const player = await open();
  await player
    .getByRole("button", { name: "Join an existing campaign as a player", exact: true })
    .click();
  await player.getByRole("textbox", { name: "Table code", exact: true }).fill(code);
  await player.getByRole("button", { name: "Find characters", exact: true }).click();
  await player.getByRole("textbox", { name: "Your name", exact: true }).fill("Browser player");
  await player.getByRole("button", { name: "Join campaign", exact: true }).click();
  await player.getByText("Waiting for Dungeon master", { exact: false }).first().waitFor();
  await dm.getByText("Browser player", { exact: true }).waitFor();
  await dm.getByRole("button", { name: "Submit changes and end turn", exact: true }).click();
  await player.getByRole("button", { name: "Submit changes and end turn", exact: true }).waitFor();
  await openApplication(player, origin + "/market");
  await player.getByRole("link").filter({ hasText: "Hearth" }).first().click();
  await player.getByRole("button", { name: /^Buy / }).first().click();
  await player.getByText("1 pending action", { exact: false }).first().waitFor();
  await reloadApplication(player);
  await player.getByText("1 pending action", { exact: false }).first().waitFor();
  results.push("Turn draft survives page reload");
  await openApplication(player, origin + "/settings");
  await player.getByRole("button", { name: "Download backup", exact: true }).click();
  await player
    .getByText(/Submit or resolve your pending actions before saving a campaign backup/)
    .waitFor();
  results.push("Turn backup refuses unsubmitted draft");
  await openApplication(player, origin + "/share");
  await player.getByRole("button", { name: "Submit changes and end turn", exact: true }).click();
  await player.getByText(/Waiting for Dungeon master · Synced/).waitFor();
  results.push("Player purchase submitted and turn returned to DM");
  await openApplication(player, origin + "/settings");
  let downloading = player.waitForEvent("download");
  await player.getByRole("button", { name: "Download backup", exact: true }).click();
  let backup = JSON.parse(await readFile(await (await downloading).path(), "utf8"));
  assert.equal(backup.kind, "quire");
  assert.equal(
    await player.getByRole("button", { name: "Load", exact: true }).first().isDisabled(),
    true,
  );
  results.push("Turn-based player backup downloads without restoring over shared room");
  await openApplication(player, origin + "/share");
  await dm.getByRole("button", { name: "Live Mode", exact: true }).click();
  await dm.getByRole("button", { name: "Change mode", exact: true }).click();
  await player.getByText("Live · Synced", { exact: true }).waitFor();
  await openApplication(player, origin + "/market");
  await player.getByRole("link").filter({ hasText: "Hearth" }).first().click();
  await player.getByRole("button", { name: /^Buy / }).first().click();
  await player.getByText("Live · Synced", { exact: true }).waitFor();
  results.push("Live purchase accepted and synchronized");
  await openApplication(dm, origin + "/settings");
  downloading = dm.waitForEvent("download");
  await dm.getByRole("button", { name: "Download backup", exact: true }).click();
  backup = JSON.parse(await readFile(await (await downloading).path(), "utf8"));
  assert.equal(backup.kind, "quire");
  assert.ok(backup.purses.length > 0);
  results.push("Live DM campaign backup downloads");
  await openApplication(dm, origin + "/share");
  await openApplication(player, origin + "/share");
  await player.getByRole("button", { name: /Messages/ }).click();
  await player.getByRole("textbox", { name: "Message", exact: true }).fill("Browser sync test");
  await player.getByRole("button", { name: "Save message", exact: true }).click();
  await dm.getByRole("button", { name: /Messages/ }).click();
  await dm.getByText("Browser sync test", { exact: true }).waitFor();
  results.push("Player chat reached DM");
  await player.screenshot({ path: "/workspace/screenshots/lootsplit-live-mobile.png" });
  await dm.getByRole("button", { name: "Local Mode", exact: true }).click();
  await dm.getByRole("button", { name: "Change mode", exact: true }).click();
  await player.getByText(/No table uses that code/).waitFor();
  results.push("Closed room produces visible recovery status");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, results }));
} catch (error) {
  console.error(error);
  for (let i = 0; i < contexts.length; i++)
    for (const p of contexts[i].pages()) {
      console.log("PAGE", i, (await p.locator("body").innerText({ timeout: 2000 })).slice(0, 2600));
      await p.screenshot({ path: `/workspace/screenshots/lootsplit-mode-failure-${i}.png` });
    }
  throw error;
} finally {
  await browser.close();
}
