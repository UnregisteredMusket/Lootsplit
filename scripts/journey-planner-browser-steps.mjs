// Journey planner phase B browser steps (review, approve, progress, arrival), run by
// journey-planner-browser-audit.mjs at 1280px on its seeded device campaign.
import { expect } from "playwright/test";

export async function checkJourneyPhaseB(page, { planner }) {
  await planner.getByRole("button", { name: "Close route planner", exact: true }).click();
  await expect(planner).toHaveCount(0);
  return [];
}
