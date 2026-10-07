import { readFile } from "node:fs/promises";
import {
  test, expect, visit, signedInDevices, accountPost, createAndSaveRoom, endSession,
} from "./account-fixtures.mjs";

async function session(page) {
  return page.evaluate(() => {
    const id = localStorage.getItem("quire.campaign.v1") || "main";
    return JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`) || "null");
  });
}
async function portraitControl(page, origin) {
  await visit(page, origin, "/party?section=funds");
  const card = page.locator('details[id^="purse-"]').first();
  await card.locator(":scope > summary").click();
  return { card, purseId: (await card.getAttribute("id")).slice(6) };
}
async function image(page, color) {
  return page.evaluate((fill) => {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const context = c.getContext("2d");
    context.fillStyle = fill;
    context.fillRect(0, 0, 16, 16);
    return c.toDataURL("image/png");
  }, color);
}
async function upload(card, data) {
  await card.locator('.portrait-picker input[type="file"]').setInputFiles({
    name: "disposable-resume-portrait.png", mimeType: "image/png",
    buffer: Buffer.from(data.split(",")[1], "base64"),
  });
}
async function turns(page, origin) {
  await visit(page, origin, "/share");
  await page.getByRole("button", { name: "Turn-based", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Change mode", exact: true }).click();
  await expect(page.getByRole("button", { name: "Turn-based", exact: true })).toHaveAttribute("aria-pressed", "true");
}
async function expectDm(page, code) {
  await expect(page.getByRole("button", { name: "Dungeon master. Change role.", exact: true })).toBeVisible();
  await expect.poll(async () => (await session(page))?.code).toBe(code);
  await expect.poll(async () => (await session(page))?.revision || 0).toBeGreaterThan(0);
  await expect(page.locator(".loot-opening")).toHaveCount(0);
  await expect(page.getByText(/This device has an unfinished turn/)).toHaveCount(0);
}

test("resume-recovery", async ({ devices, baseURL: origin }, testInfo) => {
  const desktop = devices.page;
  const { other: phone } = await signedInDevices(devices, origin);
  await phone.setViewportSize({ width: 390, height: 900 });
  const [{ code }] = await createAndSaveRoom(phone, origin);
  const member = await accountPost(phone.context(), origin, "resume", { code });
  const key = `quire.cloud.v2.account-${member.userId}-${code}`;
  const { card, purseId } = await portraitControl(phone, origin);
  const committedPortrait = await image(phone, "#225588");
  let lostQueue;
  let accepted = false;
  const lostResponse = async (route) => {
    if (!lostQueue && route.request().postData()?.includes('"portrait"')) {
      // Send the actual mutation to the disposable server, but lose its response.
      lostQueue = await session(phone);
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      accepted = true;
      return route.abort("failed");
    }
    return route.continue();
  };
  await phone.route("**/_serverFn/**", lostResponse);
  await upload(card, committedPortrait);
  await expect.poll(() => accepted).toBe(true);
  expect(lostQueue.pending.length).toBeGreaterThan(0);
  await phone.unroute("**/_serverFn/**", lostResponse);
  const detail = () => accountPost(phone.context(), origin, "sheets/detail", { id: `campaign:${code}:${purseId}` });
  expect((await detail()).body.portrait).toBe(committedPortrait);
  await endSession(phone, origin);

  // Fresh browser profile: stale target cache must not block the startup chooser.
  await desktop.evaluate(({ key, queue }) => localStorage.setItem(key, JSON.stringify(queue)), { key, queue: lostQueue });
  await visit(desktop, origin, "/");
  await expect(desktop.getByRole("heading", { name: "Choose your campaign", exact: true })).toBeVisible();
  await desktop.screenshot({ path: testInfo.outputPath("startup-resume-desktop.png"), fullPage: true });
  let reopenLost = false;
  await desktop.route("**/api/account/resume", async route => {
    if (!reopenLost) {
      reopenLost = true;
      expect((await route.fetch()).ok()).toBeTruthy();
      return route.abort("failed");
    }
    return route.continue();
  });
  await desktop.getByRole("button", { name: "Reopen as DM", exact: true }).click();
  await expect(desktop.getByRole("alert")).toBeVisible();
  // Catch path refreshed the real library: this room is already reopened.
  await expect(desktop.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await desktop.getByRole("button", { name: "Resume", exact: true }).click();
  await expectDm(desktop, code);
  expect((await session(desktop)).pending).toEqual([]);
  const reopened = await portraitControl(desktop, origin);
  await expect(reopened.card.locator(".portrait-picker img")).toHaveAttribute("src", committedPortrait);

  // My account uses the same reconciliation on the phone's separate device DB.
  await phone.evaluate(({ key, queue }) => localStorage.setItem(key, JSON.stringify(queue)), { key, queue: lostQueue });
  await visit(phone, origin, "/account");
  await phone.locator("article.portal-card").filter({ hasText: code }).getByRole("button", { name: "Resume", exact: true }).click();
  await expectDm(phone, code);
  expect((await session(phone)).pending).toEqual([]);
  expect((await detail()).body.portrait).toBe(committedPortrait);

  // A genuine staged turn must also reopen, without committing or ending it.
  await turns(phone, origin);
  const staged = await portraitControl(phone, origin);
  await upload(staged.card, await image(phone, "#558822"));
  await expect(phone.getByText("Portrait queued for your turn. Submit the turn to sync it.", { exact: true })).toBeVisible();
  const before = await session(phone);
  expect(before.pending.length).toBeGreaterThan(0);
  await visit(phone, origin, "/account");
  await phone.locator("article.portal-card").filter({ hasText: code }).getByRole("button", { name: "Resume", exact: true }).click();
  await expectDm(phone, code);
  const after = await session(phone);
  expect(after.pending).toEqual(before.pending);
  expect(after.batchId).toBe(before.batchId);
  expect((await detail()).body.portrait).toBe(committedPortrait);
  await visit(phone, origin, "/share");
  await phone.getByText("Connection & recovery", { exact: true }).click();
  await expect(phone.getByRole("button", { name: "Export pending actions", exact: true })).toBeVisible();
  await phone.screenshot({ path: testInfo.outputPath("pending-turn-mobile.png"), fullPage: true });
});

test("resume-conflicts", async ({ devices, baseURL: origin }, testInfo) => {
  const desktop = devices.page;
  const { other: phone } = await signedInDevices(devices, origin);
  const [{ code }] = await createAndSaveRoom(phone, origin);
  const member = await accountPost(phone.context(), origin, "resume", { code });
  await turns(phone, origin);
  const staged = await portraitControl(phone, origin);
  await upload(staged.card, await image(phone, "#774488"));
  await expect(phone.getByText("Portrait queued for your turn. Submit the turn to sync it.", { exact: true })).toBeVisible();
  const serverDraft = await session(phone);
  const previousSeat = {
    ...serverDraft, token: "obsolete-test-token", seatId: "obsolete-test-seat", role: "player",
    batchId: "obsolete-test-batch",
    pending: [{ id: "obsolete-test-action", kind: "patch", changes: [] }],
  };
  await desktop.evaluate(({ member, previousSeat }) => {
    localStorage.setItem(`quire.cloud.v2.account-${member.userId}-${member.code}`, JSON.stringify(previousSeat));
  }, { member, previousSeat });
  await visit(desktop, origin, "/account");
  await desktop.locator("article.portal-card").filter({ hasText: code }).getByRole("button", { name: "Resume", exact: true }).click();
  await expectDm(desktop, code);
  expect((await session(desktop)).pending).toEqual(serverDraft.pending);
  await visit(desktop, origin, "/share");
  await desktop.getByText("Connection & recovery", { exact: true }).click();
  const recovery = desktop.getByRole("region", { name: "Unsynced action recovery", exact: true });
  await expect(recovery).toBeVisible();
  await recovery.locator("summary").click();
  const waiting = desktop.waitForEvent("download");
  await recovery.getByRole("button", { name: "Download recovery actions", exact: true }).click();
  const downloaded = await waiting;
  const contents = JSON.parse(await readFile(await downloaded.path(), "utf8"));
  expect(contents.commands).toEqual(previousSeat.pending);
  expect(contents.batchId).toBe(previousSeat.batchId);
  expect(contents.seatId).toBe(previousSeat.seatId);
  expect(contents).not.toHaveProperty("token");
  // Import cannot promote an old player's actions into the DM's authority.
  await desktop.getByText("Pending actions and recovery", { exact: true }).click();
  await desktop.getByLabel("Import recovery file", { exact: true }).setInputFiles({
    name: "disposable-recovery.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(contents)),
  });
  await expect(desktop.getByText(/This recovery copy belongs to a different seat/)).toBeVisible();
  expect((await session(desktop)).pending).toEqual(serverDraft.pending);
  await desktop.screenshot({ path: testInfo.outputPath("preserved-action-recovery.png"), fullPage: true });
});
