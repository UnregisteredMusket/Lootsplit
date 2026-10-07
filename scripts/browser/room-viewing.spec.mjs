import {
  test,
  expect,
  visit,
  credentials,
  signedInDevices,
  accountPost,
  createAndSaveRoom,
} from "./account-fixtures.mjs";
import { continueIntoApp } from "../title-screen-navigation.mjs";

test("post-session viewing", async ({ devices, baseURL: origin }, testInfo) => {
  const dm = devices.page;
  // This suite tests permissions and navigation; opening-animation coverage remains in the existing title audits.
  await dm.emulateMedia({ reducedMotion: "reduce" });
  const { other: dmReturn } = await signedInDevices(devices, origin);
  await dmReturn.emulateMedia({ reducedMotion: "reduce" });
  console.log("Viewing audit: create room");
  const code = (await createAndSaveRoom(dm, origin))[0].code;
  await visit(dm, origin, "/share");
  // Read the invitation the real copy control produces, not an invented link.
  const ticket = await dm.evaluate(() => {
    const key = `quire.cloud.v2.${localStorage.getItem("quire.campaign.v1") || "main"}`;
    return JSON.parse(localStorage.getItem(key));
  });
  // Session generation is rendered in the real Copy session code button's output.
  await dm.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.auditCopied = text;
    };
  });
  await dm.getByRole("button", { name: "Copy session code", exact: true }).click();
  await dm.waitForFunction(() => !!window.auditCopied);
  const sessionCode = await dm.evaluate(() => window.auditCopied);
  expect(sessionCode.split(".")[0]).toBe(code);
  const invite = `/share?join=${encodeURIComponent(code)}&session=${encodeURIComponent(sessionCode.slice(code.length + 1))}`;
  const member = await devices.newDevice(390);
  const playerAccount = credentials();
  await accountPost(member.context, origin, "auth/sign-up/email", playerAccount);
  const guest = await devices.newDevice(1280);
  for (const [client, name] of [
    [member, "Viewer with account"],
    [guest, "Guest viewer"],
  ]) {
    console.log("Viewing audit: join", name);
    client.page.guestAccessAudit = true;
    await client.page.emulateMedia({ reducedMotion: "reduce" });
    // Guide onboarding is unrelated; set only its existing device preference before rendering.
    await client.context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    await visit(client.page, origin, invite);
    await client.page.getByRole("button", { name: "Find characters", exact: true }).click();
    await client.page.getByLabel("Your name", { exact: true }).fill(name);
    await client.page.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(
      client.page.getByRole("status").filter({ hasText: "Connected · All changes saved" }),
    ).toBeVisible();
    await expect(
      client.page.getByRole("button", { name: "Leave room", exact: true }),
    ).toBeVisible();
    await visit(client.page, origin, "/?view=sheet");
    const guide = client.page.getByRole("button", { name: "Not now", exact: true });
    if (await guide.isVisible()) await guide.click();
    await expect(
      client.page.getByRole("heading", {
        name: "Campaign inventory & imported sheet",
        exact: true,
      }),
    ).toBeVisible();
    // Force initial interactive sheet to finish loading before closing remotely.
    await expect(client.page.getByRole("button", { name: /^Initiative / }).first()).toBeVisible();
  }
  console.log("Viewing audit: end play");
  const playerTicket = await member.page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("lootsplit.player.reconnect.v1")),
  );
  expect(playerTicket.role).toBe("player");
  const before = await member.context.request.post(`${origin}/api/account/sheets/detail`, {
    headers: { origin },
    data: { id: `campaign:${code}:${playerTicket.purseIds[0]}` },
  });
  expect(before.ok()).toBeTruthy();
  const savedSheet = (await before.json()).body;
  await dm.getByRole("button", { name: "End session and keep room viewable", exact: true }).click();
  await expect(dm.getByRole("alertdialog")).toContainText("Existing players");
  await dm.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dm.getByRole("button", { name: "Share join link", exact: true })).toBeEnabled();
  await dm.getByRole("button", { name: "End session and keep room viewable", exact: true }).click();
  await dm
    .getByRole("alertdialog")
    .getByRole("button", { name: "End session and keep room viewable", exact: true })
    .click();
  await dm.waitForURL((u) => u.pathname === "/account");
  expect(await dm.locator(".loot-opening").count()).toBe(0);
  const card = dm.locator("article.portal-card").filter({ hasText: code });
  await expect(
    card.getByRole("button", { name: "Close player viewing", exact: true }),
  ).toBeVisible();
  expect(
    await dm.evaluate(
      (key) => localStorage.getItem(key),
      `quire.cloud.v2.${await dm.evaluate(() => localStorage.getItem("quire.campaign.v1") || "main")}`,
    ),
  ).toBeNull();
  await dm.close(); // A real disconnected DM, not merely a hidden tab.
  for (const [client, width] of [
    [member, 390],
    [guest, 1280],
  ]) {
    await expect(
      client.page.getByText("Session ended · View only", { exact: false }).first(),
    ).toBeVisible();
    await expect(client.page.getByRole("button", { name: /^Initiative / }).first()).toBeDisabled();
    await expect(client.page.getByLabel("Import into this character", { exact: true })).toBeDisabled();
    await expect(client.page.getByRole("button", { name: "Use default artwork", exact: true })).toBeDisabled();
    await expect(
      client.page.getByRole("heading", {
        name: "Campaign inventory & imported sheet",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await client.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBe(true);
    await client.page.screenshot({
      path: testInfo.outputPath(`viewing-sheet-${width}.png`),
      fullPage: true,
    });
    await client.page.reload();
    await continueIntoApp(client.page);
    await expect(
      client.page.getByText("Session ended · View only", { exact: false }).first(),
    ).toBeVisible();
    await expect(client.page.getByRole("button", { name: /^Initiative / }).first()).toBeDisabled();
    await expect(client.page.getByLabel("Import into this character", { exact: true })).toBeDisabled();
    await expect(client.page.getByRole("button", { name: "Use default artwork", exact: true })).toBeDisabled();
    expect(await client.page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
    expect(
      await client.page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith("quire.cloud.v2.")),
      ),
    ).toEqual([]);
  }
  console.log("Viewing audit: account return");
  const secondPlayer = await devices.newDevice(390);
  secondPlayer.page.guestAccessAudit = true;
  await secondPlayer.page.emulateMedia({ reducedMotion: "reduce" });
  await accountPost(secondPlayer.context, origin, "auth/sign-in/email", playerAccount);
  // Both My account and a fresh startup chooser open the same existing viewer seat.
  await visit(secondPlayer.page, origin, "/account");
  const secondCard = secondPlayer.page.locator("article.portal-card").filter({ hasText: code });
  await secondPlayer.page.evaluate(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  await secondCard.getByRole("button", { name: "View campaign", exact: true }).click();
  await secondPlayer.page.waitForURL((u) => u.pathname === "/");
  expect(await secondPlayer.page.locator(".loot-opening").count()).toBe(0);
  await expect(
    secondPlayer.page.getByText("Session ended · View only", { exact: false }).first(),
  ).toBeVisible();
  console.log("Viewing audit: startup return");
  const startupPlayer = await devices.newDevice(1280);
  startupPlayer.page.guestAccessAudit = true;
  await startupPlayer.page.emulateMedia({ reducedMotion: "reduce" });
  await accountPost(startupPlayer.context, origin, "auth/sign-in/email", playerAccount);
  await visit(startupPlayer.page, origin, "/");
  await expect(
    startupPlayer.page.getByRole("heading", { name: "Choose your campaign", exact: true }),
  ).toBeVisible();
  await startupPlayer.page.evaluate(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  await startupPlayer.page.getByRole("button", { name: "View campaign", exact: true }).click();
  await expect(
    startupPlayer.page.getByText("Session ended · View only", { exact: false }).first(),
  ).toBeVisible();
  expect(await startupPlayer.page.locator(".loot-opening").count()).toBe(0);
  const detail = await accountPost(member.context, origin, "sheets/detail", {
    id: `campaign:${code}:${playerTicket.purseIds[0]}`,
  });
  expect(detail.campaign.readOnly).toBe(true);
  expect(detail.body).toEqual(savedSheet);
  const write = await member.context.request.post(`${origin}/api/account/sheets/save`, {
    headers: { origin },
    data: { id: detail.id, sheet: detail.body, before: detail.body, revision: detail.revision },
  });
  expect(write.status()).toBe(403);
  await visit(member.page, origin, "/share");
  await expect(
    member.page.getByRole("button", { name: "Share join link", exact: true }),
  ).toBeDisabled();
  await member.page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(member.page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await member.page.getByRole("tab", { name: "Room", exact: true }).click();
  await guest.page.getByRole("link", { name: "Multiplayer", exact: true }).first().click();
  expect(await guest.page.locator(".loot-opening").count()).toBe(0);
  await guest.page.getByRole("button", { name: "Leave room", exact: true }).click();
  await guest.page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Leave room", exact: true })
    .click();
  await expect(guest.page.getByRole("button", { name: "Join a room", exact: true })).toBeVisible();
  // DM returns on another device and revokes only viewing without deleting the room.
  console.log("Viewing audit: close viewing and reopen");
  await visit(dmReturn, origin, "/account");
  dmReturn.on("dialog", (d) => d.accept());
  const returned = dmReturn.locator("article.portal-card").filter({ hasText: code });
  await returned.getByRole("button", { name: "Close player viewing", exact: true }).click();
  await expect(
    dmReturn.getByRole("status").filter({ hasText: "Player viewing closed" }),
  ).toBeVisible();
  await expect(returned.getByRole("button", { name: "Reopen as DM", exact: true })).toBeVisible();
  await expect(member.page.getByRole("button", { name: "Join a room", exact: true })).toBeVisible();
  const denied = await member.context.request.post(`${origin}/api/account/resume`, {
    headers: { origin },
    data: { code },
  });
  expect(denied.status()).toBe(403);
  await returned.getByRole("button", { name: "Reopen as DM", exact: true }).click();
  await dmReturn.waitForURL((u) => u.pathname === "/");
  expect(await dmReturn.locator(".loot-opening").count()).toBe(0);
  await expect(dmReturn.getByText("Campaign control", { exact: true })).toBeVisible();
  await visit(dmReturn, origin, "/share");
  await expect(
    dmReturn.getByRole("status").filter({ hasText: "Connected · All changes saved" }),
  ).toBeVisible();
  expect(
    await dmReturn.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(`quire.cloud.v2.${localStorage.getItem("quire.campaign.v1")}`),
        ).code,
    ),
  ).toBe(ticket.code);
});
