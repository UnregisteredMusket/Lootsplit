import assert from "node:assert/strict";
import { expect } from "playwright/test";
import { chooseOption } from "./search-select-browser.mjs";
import { navigateApplication } from "./title-screen-navigation.mjs";

/** Extend the existing world audit using its already authenticated disposable DM/guest pair. */
export async function auditCharacterPlacement(page, guest, origin, npcId, width, output) {
  if (await guest.getByRole("button", { name: "Exit fullscreen", exact: true }).isVisible())
    await guest.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await navigateApplication(page, origin + "/party");
  const panel = page.getByRole("region", { name: "Character locations and downtime" });
  const select = page.getByLabel("Choose a character or NPC", { exact: true });
  await chooseOption(select, npcId);
  await panel.getByLabel("In party", { exact: true }).check();
  await panel.getByLabel("NPC sheet visible to players", { exact: true }).check();
  await panel.getByRole("button", { name: "Save character placement", exact: true }).click();
  await expect(panel.getByText(/^In party ·/)).toBeVisible();
  await navigateApplication(guest, origin + "/library");
  await guest.getByLabel("Search library destinations and catalog", { exact: true }).fill("Mara");
  const records = guest.getByRole("region", { name: "Campaign library records" });
  await expect(records.getByRole("link", { name: "Mara NPC", exact: true }).first()).toBeVisible();
  await records.getByRole("link", { name: "Mara NPC", exact: true }).first().click();
  await expect(guest.getByRole("link", { name: /^Open NPC sheet/ })).toBeVisible();
  const documentMarker = crypto.randomUUID();
  await guest.evaluate((marker) => (window.characterPlacementDocument = marker), documentMarker);
  await guest.getByRole("link", { name: /^Open NPC sheet/ }).click();
  await expect(guest.getByText("DM read-only view", { exact: true })).toBeVisible();
  assert.equal(
    await guest.evaluate(() => window.characterPlacementDocument),
    documentMarker,
    "NPC sheet link stays in the document",
  );
  await expect(guest.getByRole("button", { name: "Save character", exact: true })).toHaveCount(0);
  await panel.getByLabel("NPC sheet visible to players", { exact: true }).uncheck();
  await panel.getByRole("button", { name: "Save character placement", exact: true }).click();
  await expect(panel.getByLabel("NPC sheet visible to players", { exact: true })).not.toBeChecked();
  await navigateApplication(guest, origin + "/library");
  await guest.getByLabel("Search library destinations and catalog", { exact: true }).fill("Mara");
  await records.getByRole("link", { name: "Mara NPC", exact: true }).first().click();
  await expect(guest.getByRole("link", { name: /^Open NPC sheet/ })).toHaveCount(0);
  // Starting an action removes the same NPC from party membership until reviewed game time completes.
  await panel.getByLabel("Character downtime action", { exact: true }).fill("Research the harbor");
  await panel.getByLabel("Character downtime days", { exact: true }).fill("1");
  await chooseOption(panel.getByLabel("Character downtime location", { exact: true }), "city");
  await panel.getByRole("button", { name: "Start character downtime", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Downtime: Research the harbor", exact: true }),
  ).toBeVisible();
  await panel.getByLabel("Visible to players", { exact: true }).uncheck();
  await panel.getByRole("button", { name: "Save character placement", exact: true }).click();
  await expect(panel.getByText(/Hidden from players/)).toBeVisible();
  await navigateApplication(guest, origin + "/library");
  await guest.getByLabel("Search library destinations and catalog", { exact: true }).fill("Mara");
  await expect(records.getByRole("link", { name: "Mara NPC", exact: true })).toHaveCount(0);
  await navigateApplication(page, origin + "/features/time");
  await page.getByLabel("Hours to advance", { exact: true }).fill("24");
  await expect(
    page.getByText("Mara: completes Research the harbor; restores previous placement.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve & advance session time", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve & advance session time", exact: true }),
  ).toBeEnabled();
  page.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /Discard unsaved .*session time/i);
    await dialog.accept();
  });
  await navigateApplication(page, origin + "/party");
  await chooseOption(select, npcId);
  await expect(panel.getByText(/^In party ·/)).toBeVisible();
  await expect(panel.getByRole("heading", { name: /^Downtime:/ })).toHaveCount(0);
  await expect(panel.getByLabel("Visible to players", { exact: true })).not.toBeChecked();
  await panel.getByLabel("In party", { exact: true }).uncheck();
  await chooseOption(panel.getByLabel("Individual character location", { exact: true }), "");
  await panel.getByLabel("Visible to players", { exact: true }).check();
  await panel.getByRole("button", { name: "Save character placement", exact: true }).click();
  await expect(panel.getByText(/^Outside party \/ NPC list ·/)).toBeVisible();
  await chooseOption(panel.getByLabel("Individual character location", { exact: true }), "city");
  await panel.getByRole("button", { name: "Save character placement", exact: true }).click();
  await expect(panel.getByText(/^At a location ·/)).toBeVisible();
  await chooseOption(select, "hero");
  await panel.getByLabel("In party", { exact: true }).uncheck();
  await chooseOption(panel.getByLabel("Individual character location", { exact: true }), "city");
  await panel.getByRole("button", { name: "Save character placement", exact: true }).click();
  await expect(panel.getByText(/^At a location ·/)).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${output}/character-placement-${width}.png`, fullPage: true });
  await panel.getByLabel("In party", { exact: true }).check();
  await panel.getByRole("button", { name: "Save character placement", exact: true }).click();
  await expect(panel.getByText(/^In party ·/)).toBeVisible();
}
