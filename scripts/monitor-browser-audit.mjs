import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin))
  throw Error("Local disposable testing only");
const output = process.env.MONITOR_SCREENSHOTS || "test-results/monitor";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  extraHTTPHeaders: { "cf-connecting-ip": "192.0.2.210" },
});
context.setDefaultTimeout(20000);
const DB = localAccountDb("data/account-dev.sqlite");
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let id;
try {
  const signup = await context.request.post(origin + "/api/account/auth/sign-up/email", {
    headers: { origin },
    data: {
      email: `monitor-${Date.now()}@example.com`,
      name: "Monitor Audit",
      password: "disposable monitor audit password",
    },
  });
  assert.equal(signup.status(), 200);
  id = (await signup.json()).user.id;
  await DB.prepare("INSERT INTO site_roles VALUES (?,'admin',?)").bind(id, Date.now()).run();
  await openApplication(page, origin + "/account");
  assert.equal(await page.locator(".owner-monitor").count(), 0);
  await page.getByRole("button", { name: "Open server monitor", exact: true }).click();
  await page.getByText("Total accounts", { exact: true }).waitFor();
  // Local dev has no ASSETS binding; partial failure must preserve real database counts.
  await page.getByText("Service check needs attention", { exact: true }).waitFor();
  await page.getByLabel("Auto-refresh every 30 seconds").uncheck();
  await page.getByRole("button", { name: "Refresh server status", exact: true }).waitFor();
  await page.locator(".quire-dawn").waitFor({ state: "hidden" });
  await page.locator(".server-monitor").scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + "/desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page
    .getByRole("heading", { name: "Server monitoring", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + "/mobile.png" });
  await DB.prepare("UPDATE site_roles SET role='moderator' WHERE user_id=?").bind(id).run();
  await page.getByRole("button", { name: "Refresh server status", exact: true }).click();
  await page.getByText("Status unavailable", { exact: true }).waitFor();
  assert.equal(await page.getByText("Total accounts", { exact: true }).count(), 0);
  await reloadApplication(page);
  await page.getByRole("heading", { name: "Monitor Audit’s library", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Server monitoring", exact: true }).count(),
    0,
  );
  await DB.prepare("UPDATE site_roles SET role='owner' WHERE user_id=?").bind(id).run();
  await reloadApplication(page);
  await page.getByRole("button", { name: "Open server monitor", exact: true }).click();
  await page.getByText("Total accounts", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close server monitor", exact: true }).click();
  assert.equal(await page.locator("#monitor-panel").count(), 0);
  const overview = page.locator(".owner-monitor");
  await overview.getByText("Monitor Audit", { exact: true }).waitFor();
  await overview.getByText("Owner access", { exact: true }).waitFor();
  await overview.getByLabel("Auto-refresh every minute").uncheck();
  await overview.getByRole("button", { name: "Refresh overview", exact: true }).waitFor();
  await overview
    .getByText("A read-only Cloudflare analytics connection is needed.", { exact: false })
    .waitFor();
  const snapshot = await (await context.request.get(origin + "/api/account/owner/monitor")).json();
  // Provider fixture exercises UI states only; real provider parsers/permissions have API tests.
  const fixture = {
    ...snapshot,
    development: {
      state: "ready",
      checkedAt: Date.now(),
      data: {
        scannedRuns: 100,
        active: [
          {
            id: 1,
            name: "Deploy verified website",
            status: "in_progress",
            conclusion: null,
            branch: "main",
            commit: "a".repeat(40),
            url: "https://github.com/UnregisteredMusket/Lootsplit/actions/runs/1",
            deployment: true,
          },
        ],
        latestDeployment: null,
        openPulls: [
          {
            number: 123,
            title: "Owner overview and a deliberately long change title for mobile wrapping",
            draft: true,
            url: "https://github.com/UnregisteredMusket/Lootsplit/pull/123",
          },
        ],
      },
    },
  };
  await page.route("**/api/account/owner/monitor", (route) => route.fulfill({ json: fixture }));
  await overview.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await overview.getByText("1 active workflow in recent activity", { exact: true }).waitFor();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await overview.scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const box = await overview.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    await overview.screenshot({ path: `${output}/owner-${width}.png` });
  }
  fixture.checkedAt = Date.now() - 120000;
  await overview.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await overview.getByText("Snapshot is stale", { exact: true }).waitFor();
  await page.unroute("**/api/account/owner/monitor");
  await page.route("**/api/account/owner/monitor", (route) =>
    route.fulfill({ status: 503, json: { error: "Temporary outage" } }),
  );
  await overview.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await overview.getByRole("alert").waitFor();
  assert.equal(await overview.getByText("Active accounts · 5m", { exact: true }).count(), 0);
  assert.equal(await overview.getByText("Monitor Audit", { exact: true }).count(), 0);
  await page.unroute("**/api/account/owner/monitor");
  await overview.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await overview.getByText("Monitor Audit", { exact: true }).waitFor();
  await DB.prepare("UPDATE site_roles SET role='admin' WHERE user_id=?").bind(id).run();
  await overview.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await overview.getByRole("alert").waitFor();
  assert.equal(await overview.getByText("Monitor Audit", { exact: true }).count(), 0);
  await reloadApplication(page);
  await page.getByRole("button", { name: "Open server monitor", exact: true }).waitFor();
  assert.equal(await page.locator(".owner-monitor").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: admin/owner monitoring, partial failure, refresh, revoked access clears totals, moderator isolation, desktop/mobile layout.",
  );
} finally {
  if (id) await DB.prepare("DELETE FROM user WHERE id=?").bind(id).run();
  DB.close();
  await browser.close();
}
