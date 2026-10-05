import assert from "node:assert/strict";
import {
  test,
  expect,
  visit as visitPage,
  credentials,
  signedInDevices,
  accountPost,
  createAndSaveRoom,
  endSession,
} from "./account-fixtures.mjs";
import { continueIntoApp } from "../title-screen-navigation.mjs";

test("layout", async ({ devices, baseURL: origin }, testInfo) => {
  const { page } = devices;
  const visit = (p, path) => visitPage(p, origin, path);
  await visit(page, "/welcome");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/welcome", "/downloads", "/help", "/updates", "/account"]) {
      await visit(page, path);
      assert.ok((await page.locator("body").innerText()).length > 200);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `Overflow ${path} ${width}`,
      );
      await page.screenshot({
        path: testInfo.outputPath(`website-${path.slice(1)}-${width}.png`),
        fullPage: true,
      });
    }
  }
  // Exercise client-side route transitions as well as direct navigation. Providers
  // must stay mounted while the router renders the previous page during a lazy load.
  await page.getByRole("link", { name: "Downloads", exact: true }).first().click();
  await page.getByRole("heading", { name: "One party. Your platform.", exact: true }).waitFor();
  await page.getByRole("link", { name: "My account", exact: true }).first().click();
  await continueIntoApp(page);
  await page.getByRole("heading", { name: "Good to see you again", exact: true }).waitFor();
});

test("library", async ({ devices, baseURL: origin }, testInfo) => {
  const { page } = devices;
  const visit = (p, path) => visitPage(p, origin, path);
  await page.setViewportSize({ width: 390, height: 900 });
  await visit(page, "/account");
  console.log("Account audit: sign up");
  const email = credentials().email,
    password = "browser testing password 2026";
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Display name").fill("Test adventurer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).last().click();
  await page.getByRole("heading", { name: "Test adventurer’s library" }).waitFor();
  await page.getByRole("heading", { name: "Keep this recovery key somewhere safe" }).waitFor();
  const key = await page.locator(".portal-key code").innerText();
  assert.equal(key.length, 64);
  await page.getByRole("button", { name: "I have saved it" }).click();
  console.log("Account audit: character and backup");
  await page.getByLabel("Character name", { exact: true }).fill("Browser test hero");
  await page.getByLabel("Notes", { exact: true }).fill("A reusable hero.");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("heading", { name: "Browser test hero", exact: true }).waitFor();
  await page.getByRole("button", { name: "Add to campaign", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "was added" }).waitFor();
  await page.getByRole("button", { name: "Save current campaign", exact: true }).click();
  await page.getByRole("button", { name: "Restore as new", exact: true }).waitFor();
  await page.screenshot({
    path: testInfo.outputPath("account-library-mobile.png"),
    fullPage: true,
  });
  // A second browser/device sees the same private library, with an independent local campaign.
  const { page: other } = await devices.newDevice();
  await visit(other, "/account");
  await other.getByLabel("Email", { exact: true }).fill(email);
  await other.getByLabel("Password", { exact: true }).fill(password);
  await other.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await other.getByRole("heading", { name: "Browser test hero", exact: true }).waitFor();
  await other.getByRole("button", { name: "Restore as new", exact: true }).waitFor();
  await other.screenshot({
    path: testInfo.outputPath("account-library-desktop.png"),
    fullPage: true,
  });
  console.log("Account audit: restore into new campaign");
  other.on("dialog", (d) => d.accept());
  await other.getByRole("button", { name: "Restore as new", exact: true }).click();
  await other.waitForURL((url) => url.origin === origin && url.pathname === "/");
  await continueIntoApp(other);
  await other.getByText("Campaign control", { exact: true }).waitFor();
  assert.ok(
    await other.evaluate(() => JSON.parse(localStorage.getItem("quire.campaigns.v1")).length >= 2),
  );
  await visit(other, "/account");
  console.log("Account audit: shared membership resumes on another device");
  await visit(other, "/share");
  const skip = other.getByRole("button", { name: "Not now", exact: true });
  if (await skip.isVisible()) await skip.click();
  await other.getByRole("button", { name: "Start a room", exact: true }).click();
  await other.getByRole("button", { name: "Create room", exact: true }).click();
  await other.getByRole("button", { name: "Share join link", exact: true }).waitFor();
  await visit(other, "/account");
  await other.getByRole("button", { name: "Save current membership", exact: true }).click();
  await other.getByRole("button", { name: "Resume", exact: true }).waitFor();
  await visit(page, "/account");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForURL((url) => url.origin === origin && url.pathname === "/");
  await continueIntoApp(page);
  await page.getByText("Campaign control", { exact: true }).waitFor();
  assert.ok(
    await page.evaluate(() => localStorage.getItem("quire.campaign.v1").startsWith("account-")),
  );
  assert.ok(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("quire.campaigns.v1")).some((c) => c.id === "main"),
    ),
  );
});

test("dm-resume", async ({ devices, baseURL: origin }, testInfo) => {
  const { page } = devices;
  const visit = (p, path) => visitPage(p, origin, path);
  const { other } = await signedInDevices(devices, origin);
  const firstCode = (await createAndSaveRoom(other, origin))[0].code;
  await visit(page, "/account");
  // Simulate navigation/storage interruption during the first account campaign
  // hydration. Its durable revision must remain old so a reload repairs the copy.
  await page.addInitScript(() => {
    const clear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function (...args) {
      const result = clear.apply(this, args);
      if (
        this.name === "purses" &&
        localStorage.getItem("quire.campaign.v1")?.startsWith("account-") &&
        !sessionStorage.getItem("audit-allow-hydration")
      ) {
        sessionStorage.setItem("audit-interrupted-hydration", "yes");
        queueMicrotask(() => this.transaction.abort());
      }
      return result;
    };
  });
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForFunction(() => sessionStorage.getItem("audit-interrupted-hydration") === "yes");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const id = localStorage.getItem("quire.campaign.v1");
        return JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`)).revision;
      }),
    )
    .toBe(0);
  await page.evaluate(() => sessionStorage.setItem("audit-allow-hydration", "yes"));
  await visit(page, "/share");
  await expect(
    page.getByRole("button", { name: "Dungeon master. Change role.", exact: true }),
  ).toBeVisible();
  await endSession(page, origin);
  const saved = await createAndSaveRoom(page, origin);
  assert.equal(saved.length, 2);
  const secondCode = saved.find((m) => m.code !== firstCode).code;
  await endSession(page, origin);
  for (const [p, width] of [
    [page, 390],
    [other, 1360],
  ]) {
    await p.setViewportSize({ width, height: 900 });
    await visit(p, "/account");
    await p.getByRole("button", { name: "Reopen as DM", exact: true }).nth(1).waitFor();
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await p.screenshot({
      path: testInfo.outputPath(`dm-resume-closed-${width}.png`),
      fullPage: true,
    });
  }
  async function resumeFromAccount(p, code, label) {
    await visit(p, "/account");
    const card = p.locator("article.portal-card").filter({ hasText: code });
    await card.getByRole("button", { name: label, exact: true }).click();
    await p.waitForURL((url) => url.origin === origin && url.pathname === "/");
    await p.getByRole("button", { name: "Dungeon master. Change role.", exact: true }).waitFor();
    assert.equal(
      await p.locator(".loot-opening").count(),
      0,
      "Account resume must not replay startup",
    );
    const active = await p.evaluate(() => {
      const id = localStorage.getItem("quire.campaign.v1");
      const session = JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`));
      return { code: session.code, role: session.role };
    });
    assert.deepEqual(active, { code, role: "dm" });
  }
  await resumeFromAccount(other, secondCode, "Reopen as DM");
  await resumeFromAccount(page, firstCode, "Reopen as DM");
  // Both saved campaigns also remain resumable after the first reopen, on either device.
  await resumeFromAccount(page, secondCode, "Resume");
  await resumeFromAccount(other, firstCode, "Resume");
});

test("recovery", async ({ devices, baseURL: origin }) => {
  const { context, page } = devices;
  const visit = (p, path) => visitPage(p, origin, path);
  const { email, other } = await signedInDevices(devices, origin);
  const { key } = await accountPost(context, origin, "recovery-key", {});
  assert.equal(key.length, 64);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Forgot your password? Use a recovery key" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Recovery key", { exact: true }).fill(key);
  await page.getByLabel("New password", { exact: true }).fill("new browser testing password 2026");
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Password changed" }).waitFor();
  await visit(other, "/account");
  await other.getByRole("button", { name: "Sign in", exact: true }).last().waitFor();
});
