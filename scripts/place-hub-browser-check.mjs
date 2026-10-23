// Place hub browser steps (docs/MAP-TILES.md "Place hub"), run inside the connected-maps audit
// on its seeded device campaign: pin → place card, NPC pin → conversation hub, "Show on map"
// from a record screen, `record=` deep links and the neutral failure message.
import assert from "node:assert/strict";
import { expect } from "playwright/test";
import { navigateApplication, openApplication } from "./title-screen-navigation.mjs";

const UNAVAILABLE = "That place isn't on a map you can open.";
export const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
/** The element's centre is not covered by anything else (a sheet over the dock, for example). */
const reachable = (locator) =>
  locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return (
      r.left >= 0 &&
      r.right <= innerWidth + 1 &&
      e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    );
  });

export async function checkPlaceHub(page, origin, width) {
  const frame = page.getByRole("region", { name: "Map workspace", exact: true }),
    card = frame.getByRole("region", { name: "Map record details", exact: true });
  const flows = [];
  // An NPC pin opens NpcConversation directly; Farewell (key 5) returns to the map.
  await frame.getByRole("button", { name: "Fit map", exact: true }).click();
  await frame.locator('button[title="NPC: Mara"]').click();
  await expect(card.getByRole("heading", { name: "Mara", exact: true })).toBeVisible();
  const talk = card.getByRole("region", { name: "Talk to Mara", exact: true });
  await expect(talk).toBeVisible();
  await expect(card.getByRole("button", { name: "More about Mara", exact: true })).toBeVisible();
  assert.ok(await noHorizontalScroll(page), `NPC card fits at ${width}px`);
  assert.ok(
    await reachable(card.getByRole("button", { name: "Close details", exact: true })),
    `NPC card close is reachable at ${width}px`,
  );
  await talk.getByRole("button", { name: "Farewell.", exact: true }).focus();
  await page.keyboard.press("5");
  await expect(card).toHaveCount(0);
  flows.push("npc-pin-hub");

  // "Show on map" on the shop screen opens the map on that pin without replaying startup.
  await navigateApplication(page, origin + "/shop/forge");
  const strip = page.getByRole("group", { name: "Map", exact: true });
  // Exact on Brackenford, approximate at the town's anchor on the regional map.
  await expect(strip).toContainText("On 2 maps");
  await expect(strip).toContainText("Brackenford (exact)");
  assert.ok(await noHorizontalScroll(page), `Shop strip fits at ${width}px`);
  await strip.getByRole("link", { name: "Show on map", exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/maps" && u.searchParams.get("record") === "shop:forge");
  assert.equal(await page.locator(".loot-opening").count(), 0, "Show on map kept the app open");
  await expect(frame.locator(".map-record-highlight")).toHaveCount(1);
  await expect(card.getByRole("heading", { name: "Ash & Anvil", exact: true })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Ash & Anvil", exact: true })).toBeFocused();
  await expect(frame.getByRole("img", { name: "Brackenford", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: /^Buy / }).first()).toBeVisible();
  assert.ok(await noHorizontalScroll(page), `Deep-linked card fits at ${width}px`);
  await card.getByRole("button", { name: "Close details", exact: true }).click();
  await expect(frame.locator(".map-record-highlight")).toHaveCount(0);
  flows.push("show-on-map");

  // The inn has no exact pin: its strip says it is shown at its location's anchor.
  await navigateApplication(page, origin + "/shop/inn");
  await expect(page.getByRole("group", { name: "Map", exact: true })).toContainText("On 2 maps");

  // A pasted link opens the card; a link to something unavailable gets one neutral message.
  await openApplication(page, origin + "/maps?map=town-map&record=npc%3Amara");
  await expect(card.getByRole("region", { name: "Talk to Mara", exact: true })).toBeVisible();
  for (const record of ["shop%3Amissing", "dragon%3Ax"]) {
    await openApplication(page, `${origin}/maps?map=town-map&record=${record}`);
    await expect(frame.getByText(UNAVAILABLE, { exact: false })).toBeVisible();
    await expect(card).toHaveCount(0);
  }
  assert.ok(await noHorizontalScroll(page), `Neutral message fits at ${width}px`);
  await frame.locator(".map-place-notice").getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(frame.getByText(UNAVAILABLE, { exact: false })).toHaveCount(0);
  flows.push("record-deep-link", "neutral-unavailable");

  // Here: what the party can use at its location; each row opens the same place card.
  await frame.getByRole("button", { name: /^Here/ }).click();
  const here = frame.getByRole("region", { name: "Here", exact: true });
  await expect(here).toContainText("Party is in Brackenford");
  await expect(here).toContainText("Ash & Anvil");
  assert.ok(await noHorizontalScroll(page), `Here sheet fits at ${width}px`);
  assert.ok(
    await reachable(here.getByRole("button", { name: "Close Here", exact: true })),
    `Here close is reachable at ${width}px`,
  );
  await here.getByRole("button", { name: "Talk: Mara", exact: true }).click();
  await expect(card.getByRole("region", { name: "Talk to Mara", exact: true })).toBeVisible();
  // DM: switch Mara to an opt-in portrait pin (she has no picture, so her initial shows).
  await card.getByRole("button", { name: "Use portrait pin", exact: true }).click();
  await expect(frame.locator('button[title="NPC: Mara"] .map-portrait-initial')).toHaveText("M");
  await card.getByRole("button", { name: "Close details", exact: true }).click();
  flows.push("here-sheet", "portrait-pin");

  // DM "Place on map": the record is already chosen; tap, choose DM only, save.
  await openApplication(page, `${origin}/maps?map=region-map&place=shop%3Ainn`);
  const bar = frame.getByRole("region", { name: "Place on map", exact: true });
  await expect(bar).toContainText("Placing The Lantern Inn");
  assert.ok(await noHorizontalScroll(page), `Placement bar fits at ${width}px`);
  // Keyboard path: Enter places the pin at the crosshair (the centre of the view).
  await frame.getByRole("region", { name: "Interactive campaign map", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(bar).toContainText("Pin at");
  await bar.getByRole("radio", { name: "DM only", exact: true }).check();
  await bar.getByRole("button", { name: "Save pin", exact: true }).click();
  await page.waitForURL((u) => u.searchParams.get("record") === "shop:inn");
  await expect(card.getByRole("heading", { name: "The Lantern Inn", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Let the party see this pin", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Close details", exact: true }).click();
  flows.push("place-on-map");
  // Hand back on Brackenford, where the connected-maps check continues.
  await openApplication(page, `${origin}/maps?map=town-map`);
  await expect(frame.getByRole("img", { name: "Brackenford", exact: true })).toBeVisible();
  return flows;
}
