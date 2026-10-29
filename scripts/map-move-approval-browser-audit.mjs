// Map tokens PR 8 (docs/plans/MAP-TOKENS.md section 1.1, "Ask the DM"): a disposable device
// campaign at 1280 × 800 with player movement set to Ask the DM. A player's drag becomes a request
// ("Move sent to the DM", a dashed ghost "Waiting for the DM", the token stays), Withdraw cancels
// it, and the DM approves the next one from the Review Inbox, which moves the token. Never targets
// a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { continueIntoApp, openApplication } from "./title-screen-navigation.mjs";
import { journalOf, openKeep, seatAs, seedKeep, settle, squarePoint } from "./map-tokens-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = (process.env.AUDIT_RESULTS_DIR || "test-results") + "/map-move-approval";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const character = (id, label, column, row) => ({ id: `${id}-token`, kind: "character", entityId: id, label, column, row, visibility: "party" });
const keep = async (page) => (await journalOf(page)).world;
const errors = [];

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem("quire.guide.offer.v3", "seen");
    localStorage.setItem("lootsplit.map.toolNames.v1", "hidden");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await openApplication(page, origin + "/maps");
  await seedKeep(page, {
    tokens: [character("mira", "Mira", 12, 7), character("torvald", "Torvald", 13, 7)],
    tabletop: { movement: "approval", playerMovement: true },
  });
  await seatAs(page, ["mira"]);
  await openKeep(page, origin);
  const chips = page.getByRole("group", { name: "Your movement" });
  await expect(chips).toContainText("Ask the DM: your moves wait for approval");
  const drag = async (column, row) => {
    await settle(page);
    const from = await squarePoint(page, 12.5, 7.5),
      to = await squarePoint(page, column + 0.5, row + 0.5);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };
  // A drag becomes a request; the token stays.
  await drag(15, 9);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Move sent to the DM" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Mira: move waiting for the DM" })).toBeVisible();
  await expect(chips).toContainText("Mira: waiting for the DM");
  const world = await keep(page);
  assert.equal(world.maps[0].tokens.find((t) => t.id === "mira-token").column, 12);
  assert.equal(world.moveRequests[0].status, "pending");
  await page.screenshot({ path: `${out}/waiting-1280.png` });
  // Withdraw.
  await chips.getByRole("button", { name: "Withdraw" }).click();
  await expect.poll(async () => (await keep(page)).moveRequests[0].status).toBe("withdrawn");
  await expect(page.getByRole("img", { name: "Mira: move waiting for the DM" })).toHaveCount(0);
  // Ask again; the DM approves from the Review Inbox.
  await drag(16, 10);
  await expect.poll(async () => (await keep(page)).moveRequests.filter((r) => r.status === "pending").length).toBe(1);
  await seatAs(page, null);
  await page.goto(origin + "/features/review");
  await continueIntoApp(page);
  const card = page.locator("#review-inbox article, #review-inbox [data-review-card], #review-inbox section").filter({ hasText: "Token move" }).first();
  await expect(card).toContainText("Move Mira on The Old Keep to column 17, row 11");
  await page.screenshot({ path: `${out}/review-1280.png` });
  await card.getByRole("button", { name: "Approve move" }).click();
  await expect.poll(async () => (await keep(page)).maps[0].tokens.find((t) => t.id === "mira-token").column).toBe(16);
  assert.equal((await keep(page)).moveRequests.at(-1).status, "approved");
  await context.close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("map-move-approval: passed");
} finally {
  await browser.close();
}
