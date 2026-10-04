import { openApplication, reloadApplication, continueIntoApp } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const origin = process.env.ACCOUNT_AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin))
  throw new Error("Account audit only runs against disposable local servers.");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
await mkdir("test-results", { recursive: true });
const errors = [];
async function visit(page, path) {
  await openApplication(page, origin + path);
  await page.waitForTimeout(1600);
}
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  context.setDefaultTimeout(20000);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  // Warm Vite before checking for module errors.
  await visit(page, "/welcome");
  await page.waitForTimeout(2500);
  errors.length = 0;
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
        path: `test-results/website-${path.slice(1)}-${width}.png`,
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
  console.log("Account audit: sign up");
  const email = `browser-${Date.now()}@example.com`,
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
    path: "test-results/account-library-mobile.png",
    fullPage: true,
  });
  // A second browser/device sees the same private library, with an independent local campaign.
  const second = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  second.setDefaultTimeout(20000);
  const other = await second.newPage();
  other.on("pageerror", (e) => errors.push(e.message));
  await visit(other, "/account");
  await other.getByLabel("Email", { exact: true }).fill(email);
  await other.getByLabel("Password", { exact: true }).fill(password);
  await other.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await other.getByRole("heading", { name: "Browser test hero", exact: true }).waitFor();
  await other.getByRole("button", { name: "Restore as new", exact: true }).waitFor();
  await other.screenshot({
    path: "test-results/account-library-desktop.png",
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
  await reloadApplication(page);
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
  console.log("Account audit: DM reopens two ended campaigns across devices");
  const firstCode = (await (await context.request.get(origin + "/api/account/library")).json())
    .members[0].code;
  async function endSession(p) {
    await visit(p, "/share");
    await p.getByRole("button", { name: "End session", exact: true }).click();
    await p.getByRole("dialog").getByRole("button", { name: "End session", exact: true }).click();
    await p.getByRole("button", { name: "Start a room", exact: true }).waitFor();
  }
  await endSession(page);
  // The other device created the first room; this device now creates and saves the second.
  await page.getByRole("button", { name: "Start a room", exact: true }).click();
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await page.getByRole("button", { name: "Share join link", exact: true }).waitFor();
  await visit(page, "/account");
  await page.getByRole("button", { name: "Save current membership", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "This membership is saved" }).waitFor();
  const saved = (await (await context.request.get(origin + "/api/account/library")).json()).members;
  assert.equal(saved.length, 2);
  const secondCode = saved.find((m) => m.code !== firstCode).code;
  await endSession(page);
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
    await p.screenshot({ path: `test-results/dm-resume-closed-${width}.png`, fullPage: true });
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
  await visit(page, "/account");
  console.log("Account audit: recover and revoke other sessions");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Forgot your password? Use a recovery key" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Recovery key", { exact: true }).fill(key);
  await page.getByLabel("New password", { exact: true }).fill("new browser testing password 2026");
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Password changed" }).waitFor();
  await reloadApplication(other);
  await other.getByRole("button", { name: "Sign in", exact: true }).last().waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Account audit passed: layouts, signup, profiles, cross-device library, restore, recovery, session revocation.",
  );
} finally {
  await browser.close();
}
