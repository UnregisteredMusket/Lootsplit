// Journey planner discoverability steps, run by journey-planner-browser-audit.mjs at every width
// (1280, 390, 320 and 844×390) on its seeded device campaign before the drawing steps:
// - the labelled "Plan journey" control on the map is visible, inside the viewport, not under
//   another control, and still there with the tool hotbar collapsed;
// - the Here sheet at the party's location offers "Plan a journey";
// - the Downtime screen links to the planner (`/maps?map=<party map>&plan=party`) with in-app
//   navigation (no title screen replay).
// Each entry point must open the planner. The planner is closed again before returning.
import assert from "node:assert/strict";
import { expect } from "playwright/test";
import { continueIntoApp } from "./title-screen-navigation.mjs";

const box = (locator) =>
  locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });
const overlaps = (a, b) =>
  a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
/** The control's centre is not covered by anything else (a real tap would reach it). */
const reachable = (locator) =>
  locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === e || e.contains(hit));
  });

export async function checkJourneyDiscoverability(page, { origin, frame, width, height, output }) {
  const planner = frame.getByRole("complementary", { name: "Plan a route", exact: true });
  const label = `${width}x${height}`;
  // 1. A labelled "Plan journey" control on the map, visible on phones.
  const plan = frame.getByRole("button", { name: "Plan journey", exact: true });
  await expect(plan).toBeVisible();
  await expect(plan).toHaveText("Plan journey");
  const planBox = await box(plan);
  assert.ok(
    planBox.left >= 0 && planBox.right <= width && planBox.top >= 0 && planBox.bottom <= height,
    `Plan journey inside the viewport at ${label}`,
  );
  assert.ok(planBox.height >= 44 && planBox.width >= 44, `Plan journey is a 44px target at ${label}`);
  assert.ok(await reachable(plan), `Plan journey is not covered at ${label}`);
  for (const name of [/^Here/, "Map tools hotbar"]) {
    const other = frame.getByRole("button", { name, exact: typeof name === "string" }).first();
    if (await other.isVisible())
      assert.ok(!overlaps(planBox, await box(other)), `Plan journey clear of ${name} at ${label}`);
  }
  // Collapsing the tool hotbar (which also holds the route icon) keeps the labelled control.
  const hotbar = frame.getByRole("button", { name: "Map tools hotbar", exact: true });
  await hotbar.click();
  await expect(hotbar).toHaveAttribute("aria-expanded", "false");
  await expect(plan).toBeVisible();
  assert.ok(await reachable(plan), `Plan journey reachable with the hotbar collapsed at ${label}`);
  await page.screenshot({ path: `${output}/discover-map-${label}.png` });
  await plan.click();
  await expect(planner).toBeVisible();
  await expect(planner.getByText("Plan a journey", { exact: true })).toBeVisible();
  await expect(plan).toHaveCount(0);
  await planner.getByRole("button", { name: "Close route planner", exact: true }).click();
  await expect(planner).toHaveCount(0);
  await hotbar.click();
  await expect(hotbar).toHaveAttribute("aria-expanded", "true");

  // 2. The Here sheet at the party's location.
  await frame.getByRole("button", { name: /^Here/ }).first().click();
  const here = frame.getByRole("region", { name: "Here", exact: true });
  await expect(here).toContainText("Travel from Harrowgate");
  const fromHere = here.getByRole("button", { name: "Plan a journey", exact: true });
  await fromHere.scrollIntoViewIfNeeded();
  const hereBox = await box(fromHere);
  assert.ok(
    hereBox.left >= 0 && hereBox.right <= width && hereBox.bottom <= height,
    `Here sheet's Plan a journey inside the viewport at ${label}`,
  );
  await page.screenshot({ path: `${output}/discover-here-${label}.png` });
  await fromHere.click();
  await expect(planner).toBeVisible();
  await expect(here).toHaveCount(0);
  await planner.getByRole("button", { name: "Close route planner", exact: true }).click();
  await expect(planner).toHaveCount(0);

  // 3. The Downtime screen: an in-app link to the planner on the party's map.
  await page.goto(origin + "/features/downtime");
  await continueIntoApp(page);
  const travel = page.getByRole("region", { name: "Travel", exact: true });
  const link = travel.getByRole("link", { name: "Plan a journey on the map →", exact: true });
  await expect(link).toBeVisible();
  // The party's map (Harrowgate is anchored on Vale of Harrow), once the campaign has loaded.
  await expect(link).toHaveAttribute("href", "/maps?map=vale-map&plan=party");
  // First on the screen: above the fold in portrait; landscape phones are too short for any
  // section to clear the header, so there it only has to come before the other sections.
  if (height >= 600)
    assert.ok((await box(link)).bottom <= height, `Downtime's Plan a journey is above the fold at ${label}`);
  assert.ok(
    await travel.evaluate((e) => !e.previousElementSibling || e.previousElementSibling.tagName === "H1"),
    "Travel is the Downtime screen's first section",
  );
  await page.screenshot({ path: `${output}/discover-downtime-${label}.png` });
  await page.evaluate(() => (window.journeyLinkAudit = "same-document"));
  await link.click();
  await page.waitForURL((url) => url.pathname === "/maps" && url.searchParams.get("plan") === "party");
  assert.equal(await page.evaluate(() => window.journeyLinkAudit), "same-document", "in-app navigation");
  assert.equal(await page.locator(".loot-opening").count(), 0, "no title screen replay");
  await expect(planner).toBeVisible();
  await expect(planner).toContainText("Vale of Harrow");
  await planner.getByRole("button", { name: "Close route planner", exact: true }).click();
  await expect(planner).toHaveCount(0);
  return ["plan-journey-control", "hotbar-collapsed", "here-sheet", "downtime-link"];
}
