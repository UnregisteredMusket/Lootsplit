// Journey planner phase B browser steps, run by journey-planner-browser-audit.mjs at 1280px on its
// seeded device campaign after the drawing steps: Review journey… (a normal downtime preview with
// the journey), an optional ration line, partial approval (1 day), the on-the-road chip and
// progress panel, the remaining days, and the DM's "Move party here" arrival.
import assert from "node:assert/strict";
import { expect } from "playwright/test";

const snapshot = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return {
      journeys: t.journal.world.journeys ?? [],
      position: t.journal.world.partyPosition ?? null,
      location: t.journal.market.currentLocationId,
      ledger: t.ledger,
      day: t.journal.finance.day,
    };
  });

export async function checkJourneyPhaseB(page, { frame, planner, output }) {
  // Harrowgate → Kestrel Watch: 60.0 mi at 24 mi/day = 3,600 min → 3 downtime days.
  await planner.getByRole("button", { name: "Review journey…", exact: true }).click();
  const review = frame.getByRole("complementary", { name: "Journey review", exact: true });
  await expect(review).toBeVisible();
  await expect(planner).toHaveCount(0);
  await expect(review).toContainText("2.50 days of travel (3,600 min) → 3 days of downtime");
  await expect(review.getByRole("region", { name: "Shops the party leaves behind" })).toContainText(
    "Brass Lantern Outfitters",
  );
  await expect(review).toContainText("Aria Thorne, Bram Ironfoot");
  // Trail rations are off by default; turning the line on re-prices the same preview.
  const rations = review.getByRole("switch", { name: "Trail rations", exact: true });
  await expect(rations).toHaveAttribute("aria-checked", "false");
  await rations.click();
  await expect(rations).toHaveAttribute("aria-checked", "true");
  await expect(review).toContainText("6 × 5 cp");
  // Apply now: 1 day leaves the party on the road.
  await review.getByLabel("Apply now", { exact: true }).selectOption("1");
  await expect(review).toContainText("stops on the road");
  await page.screenshot({ path: `${output}/review-1280.png` });
  await review.getByRole("button", { name: "Approve & depart", exact: true }).click();
  await expect(review.getByRole("status")).toContainText("The party departs");
  let books = await snapshot(page);
  assert.equal(books.journeys[0].status, "active");
  assert.equal(books.journeys[0].elapsedMinutes, 1440);
  assert.equal(books.location, null, "the party left Harrowgate");
  assert.equal(books.position.environment, "Wilderness");
  assert.equal(books.position.biome, "Forest");
  const rationLines = books.ledger.filter((l) => /:journey:rations$/.test(l.id));
  assert.equal(rationLines.length, 1, "charged once");
  assert.equal(rationLines[0].copper, -10, "2 travellers × 1 day × 5 cp");
  await review.getByRole("button", { name: "Close journey review", exact: true }).click();
  // The on-the-road chip opens the progress panel (route locked).
  const chip = frame.locator(".map-journey-chip");
  await expect(chip).toContainText("On the road");
  await expect(chip).toContainText("40%");
  await expect(frame.locator(".map-route-journey .map-route-travelled")).toHaveCount(1);
  await chip.click();
  const progress = frame.getByRole("complementary", { name: "Journey under way", exact: true });
  await expect(progress).toContainText("Route locked while travelling.");
  await page.screenshot({ path: `${output}/progress-1280.png` });
  await progress.getByRole("button", { name: "Prepare remaining 2 days…", exact: true }).click();
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Approve 2 days", exact: true }).click();
  // Arrival waits for the DM.
  const arrival = page.getByRole("dialog", { name: "Move party here?", exact: true });
  await expect(arrival).toBeVisible();
  books = await snapshot(page);
  assert.equal(books.journeys[0].status, "arrived");
  assert.equal(books.location, null, "nothing moves the party in automatically");
  await page.screenshot({ path: `${output}/arrival-1280.png` });
  await arrival.getByRole("button", { name: "Move party here", exact: true }).click();
  await expect(arrival).toHaveCount(0);
  books = await snapshot(page);
  assert.equal(books.journeys[0].status, "completed");
  assert.equal(books.location, "kestrel");
  assert.equal(books.position, null);
  assert.equal(
    books.ledger.filter((l) => /:journey:rations$/.test(l.id)).length >= 1,
    true,
  );
  return ["review", "optional-line", "partial-approval", "progress", "remaining-days", "arrival"];
}
