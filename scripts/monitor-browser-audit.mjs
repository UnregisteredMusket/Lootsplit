import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import { expect } from "playwright/test";
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
// Copy diagnostics is checked by reading back what it put on the clipboard.
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
// The website asks for the full snapshot plus the widget model (`?include=widget-data`).
const monitorApi = /\/api\/account\/owner\/monitor(\?[^/]*)?$/;
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
  await openApplication(page, origin + "/account#account-administration");
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
  await page.getByRole("heading", { name: "My account", level: 1 }).waitFor();
  // A moderator keeps Administration (member tools) but not the server monitor.
  await page.getByRole("tab", { name: "Administration", exact: true }).click();
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
  // The owner has a Field monitor section of its own (design plan M9), with a deep link.
  const fieldTab = page.getByRole("tab", { name: "Field monitor", exact: true });
  await fieldTab.click();
  assert.equal(new URL(page.url()).hash, "#field-monitor");
  const overview = page.locator(".owner-monitor");
  await overview.getByText("Monitor Audit", { exact: true }).waitFor();
  await overview.getByText("Owner access", { exact: true }).waitFor();
  await overview.getByLabel("Auto-refresh every minute").uncheck();
  await overview.getByRole("button", { name: "Refresh overview", exact: true }).waitFor();
  await overview
    .getByText("A read-only Cloudflare analytics connection is needed.", { exact: false })
    .first()
    .waitFor();
  // The widget model on the web: status word, ✕ ! i counts, Needs attention, Recently resolved,
  // the traffic chart and plan-usage gauges, all above the full history.
  await expect(overview.getByTestId("field-status-word")).toHaveText(
    /^(HEALTHY|ATTENTION|FAILURE|UNVERIFIED|STALE)$/,
  );
  const counts = overview.getByRole("navigation", { name: "Diagnostics by severity" });
  await expect(counts.getByRole("link")).toHaveCount(3);
  for (const name of ["Needs attention", "Recently resolved", "Traffic", "Plan usage"])
    await overview.getByRole("heading", { name, exact: true }).waitFor();
  assert.ok(
    (await overview.getByRole("heading", { name: "Needs attention", exact: true }).boundingBox())
      .y <
      (await overview.getByRole("navigation", { name: "Monitoring details" }).boundingBox()).y,
    "the summary sits above the full history",
  );
  // New controls use the real disposable owner API and persisted journal, not a response fixture.
  const detailsNav = overview.getByRole("navigation", { name: "Monitoring details" });
  await detailsNav.getByRole("link", { name: "Development task", exact: true }).click();
  await overview
    .getByText("Publish task start, progress, pause or handoff", { exact: true })
    .click();
  await overview.getByLabel("Task identifier", { exact: true }).fill("browser-task");
  await overview.getByLabel("Title", { exact: true }).fill("Verify synchronized widgets");
  await overview
    .getByLabel("Plain-English objective", { exact: true })
    .fill("Keep owner readings consistent across displays");
  await overview
    .getByLabel("Latest meaningful progress", { exact: true })
    .fill("Real owner API task form exercised");
  await overview.locator("#monitor-task form button").click();
  await overview
    .getByText("Task event saved with its persistent timing history.", { exact: true })
    .waitFor();
  const savedTask = await (
    await context.request.get(origin + "/api/account/owner/monitor/task")
  ).json();
  assert.equal(savedTask.task.id, "browser-task");
  await overview.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await overview
    .locator(".monitor-current-task")
    .getByText("Verify synchronized widgets", { exact: true })
    .waitFor();
  const refreshedTask = await (
    await context.request.get(origin + "/api/account/owner/monitor/task")
  ).json();
  assert.equal(refreshedTask.task.startedAt, savedTask.task.startedAt);
  await detailsNav.getByRole("link", { name: "Log registry & settings", exact: true }).click();
  await overview.getByLabel("Report timezone", { exact: true }).waitFor();
  await overview.getByText("Register an external or future log", { exact: true }).click();
  await overview.getByLabel("Stable log ID", { exact: true }).fill("browser-external");
  await overview.getByLabel("Name", { exact: true }).fill("Browser external log");
  await overview
    .getByLabel("Purpose and source", { exact: true })
    .fill("Disposable browser coverage evidence");
  await overview.getByRole("button", { name: "Register log", exact: true }).click();
  await overview
    .getByText(
      "Log registered. It now appears in daily coverage, including when data is missing.",
      { exact: true },
    )
    .waitFor();
  await overview
    .getByText("Record an external log entry or coverage check", { exact: true })
    .click();
  await overview.getByLabel("Registered log", { exact: true }).selectOption("browser-external");
  await overview.getByLabel("Persistent entry ID", { exact: true }).fill("browser-observation");
  await overview
    .getByLabel("Actual observation time", { exact: true })
    .fill(new Date().toISOString().slice(0, 16));
  await overview
    .getByLabel("Plain-English explanation", { exact: true })
    .fill("The browser completed the real registration flow.");
  await overview.getByRole("button", { name: "Record log entry", exact: true }).click();
  await overview.getByText("Entry recorded.", { exact: false }).waitFor();
  await detailsNav.getByRole("link", { name: "Monitoring logs", exact: true }).click();
  await overview
    .getByText("The browser completed the real registration flow.", { exact: true })
    .waitFor();
  await overview.getByLabel("Reduce monitor motion", { exact: true }).check();
  assert.equal(await overview.getAttribute("data-reduced-motion"), "true");
  assert.ok(
    await overview
      .locator(".owner-monitor-scroll")
      .evaluate((el) => el.scrollHeight > el.clientHeight && el.clientHeight <= 640),
  );
  // Retire asks for confirmation, keeps history and can be reinstated (audit M10).
  await detailsNav.getByRole("link", { name: "Log registry & settings", exact: true }).click();
  await overview.getByText("Browser external log · browser-external", { exact: true }).click();
  await overview.getByRole("button", { name: "Retire Browser external log…", exact: true }).click();
  await overview.getByText("Nothing is deleted", { exact: false }).waitFor();
  await overview.getByLabel("Reason (optional)", { exact: true }).fill("Browser audit");
  await overview.getByRole("button", { name: "Retire log", exact: true }).click();
  await overview.getByText("Browser external log retired.", { exact: false }).waitFor();
  const retiredRegistry = await (
    await context.request.get(origin + "/api/account/owner/monitor/registry")
  ).json();
  const retiredLog = retiredRegistry.logs.find((log) => log.id === "browser-external");
  assert.equal(retiredLog.retired.reason, "Browser audit");
  assert.equal(
    retiredRegistry.logs.find((log) => log.id === "monitoring").retired,
    null,
    "built-in logs are untouched",
  );
  await overview
    .getByRole("button", { name: "Reinstate Browser external log", exact: true })
    .click();
  await overview.getByText("Browser external log reinstated.", { exact: false }).waitFor();
  const history = await (
    await context.request.get(origin + "/api/account/owner/monitor/export?source=browser-external")
  ).json();
  assert.ok(history.entries.some((e) => e.id === "external:browser-external:browser-observation"));
  assert.equal(history.entries.filter((e) => e.registryChange).length, 2);
  await detailsNav.getByRole("link", { name: "Daily reports", exact: true }).click();
  await overview.getByRole("button", { name: "Generate previous day", exact: true }).click();
  await overview.locator("#monitor-reports h4").first().waitFor();
  await overview
    .getByText("Monitoring coverage is incomplete.", { exact: false })
    .first()
    .waitFor();
  await overview.screenshot({ path: output + "/daily-report-390.png" });
  await detailsNav.getByRole("link", { name: "Diagnostics", exact: true }).click();
  await overview.locator("#monitor-diagnostics").waitFor();
  // A widget count chip opens #monitor-diagnostics-<severity>: Diagnostics showing only that severity.
  const filters = overview.getByRole("group", { name: "Show diagnostics by severity" });
  await filters.locator('button[aria-pressed="true"]', { hasText: "All" }).waitFor();
  const allDiagnostics = await overview.locator("#monitor-diagnostics article").count();
  for (const [hash, label] of [
    ["monitor-diagnostics-warning", "Warning"],
    ["monitor-diagnostics-critical", "Critical"],
    ["monitor-diagnostics-info", "Info"],
  ]) {
    await page.evaluate((next) => {
      window.location.hash = next;
    }, hash);
    const pressed = filters.locator('button[aria-pressed="true"]', { hasText: label });
    await pressed.waitFor();
    const shown = Number(/\((\d+)\)/.exec(await pressed.innerText())?.[1]);
    assert.equal(await overview.locator("#monitor-diagnostics article").count(), shown, label);
    if (shown === 0)
      await overview.getByText(`No ${label.toLowerCase()} diagnostics in this reading.`).waitFor();
  }
  await filters.getByRole("button", { name: "All", exact: true }).click();
  assert.equal(await overview.locator("#monitor-diagnostics article").count(), allDiagnostics);
  // Tapping a summary count chip opens Diagnostics filtered to that severity, like the widget.
  await counts.locator('[data-severity="warning"]').click();
  await filters.locator('button[aria-pressed="true"]', { hasText: "Warning" }).waitFor();
  expect(new URL(page.url()).hash).toBe("#monitor-diagnostics-warning");
  await expect(fieldTab).toHaveAttribute("aria-selected", "true");
  await filters.getByRole("button", { name: "All", exact: true }).click();
  assert.equal(
    await page.locator(".quire-dawn").count(),
    0,
    "Internal monitoring links must not restart the title screen",
  );
  const snapshot = await (await context.request.get(origin + "/api/account/owner/monitor")).json();
  // Provider fixture exercises UI states only; real provider parsers/permissions have API tests.
  const ownerEmail = "private.owner@example.test";
  const fixture = {
    ...snapshot,
    diagnostics: [
      ...(snapshot.diagnostics || []),
      {
        component: "Audit multiplayer probe",
        color: "red",
        state: "error",
        symptom: `Round trip failed for room QZ7K4M2P (join https://lootsplitter.com/share?join=QZ7K4M2P&t=abc) seen by ${ownerEmail}`,
        impact: "Players could not join.",
        action: "Authorization: Bearer audit.fakecredential.abcdefghijklmnopqrstuvwxyz",
        firstOccurredAt: Date.now() - 31 * 60000,
        latestCheckAt: Date.now(),
        lastSuccessAt: Date.now() - 32 * 60000,
        durationMs: 31 * 60000,
        errorCode: "PROBE_FAILED",
        confirmedCause: null,
        suspectedCause: null,
        retainedFailure: false,
      },
    ],
    recentlyResolved: {
      state: "ready",
      total: 1,
      complete: true,
      items: [
        {
          component: "Audit worker errors",
          severity: "warning",
          startedAt: Date.now() - 3 * 3600000,
          resolvedAt: Date.now() - 2 * 3600000,
          durationMs: 3600000,
          resolution: "recovered",
          symptom: "1 Worker error",
        },
      ],
    },
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
        events: [
          {
            id: "run:2:completed:failure",
            kind: "run-failed",
            state: "fail",
            text: "Verify failed on #123",
            pr: 123,
            title: "Owner overview",
            at: Date.now() - 60000,
            url: "https://github.com/UnregisteredMusket/Lootsplit/actions/runs/2",
          },
          {
            id: "pr:122:merged",
            kind: "pr-merged",
            state: "ok",
            text: "Merged #122",
            pr: 122,
            title:
              "A deliberately long merged change title that must wrap on a narrow phone screen",
            at: Date.now() - 120000,
            url: "https://github.com/UnregisteredMusket/Lootsplit/pull/122",
          },
        ],
      },
    },
  };
  await page.route(monitorApi, (route) => route.fulfill({ json: fixture }));
  await overview.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await overview.getByText("1 active workflow in recent activity", { exact: true }).waitFor();
  // Needs attention lists the critical item first; Copy diagnostics copies a sanitized summary.
  const attention = overview.locator('section[aria-labelledby="field-attention"]');
  const item = attention.locator("details").first();
  await expect(item.locator("summary")).toContainText("Audit multiplayer probe");
  await item.locator("summary").click();
  await item.getByRole("button", { name: "Copy diagnostics: Audit multiplayer probe" }).click();
  await item.getByRole("status").waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /CRIT · Audit multiplayer probe/);
  for (const secret of [ownerEmail, "@", "QZ7K4M2P", "join=", "fakecredential", "abcdefghijklmnop"])
    assert.ok(!copied.includes(secret), `copied diagnostics must not include ${secret}`);
  const resolvedItem = overview
    .locator('section[aria-labelledby="field-resolved"]')
    .locator("details")
    .first();
  await expect(resolvedItem.locator("summary")).toContainText("Audit worker errors");
  // Agent activity companion destination: the same section lists recent GitHub events.
  await overview.getByText("Recent GitHub activity", { exact: true }).waitFor();
  await overview.locator(".owner-monitor-activity li").nth(1).waitFor();
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
  await page.unroute(monitorApi);
  await page.route(monitorApi, (route) =>
    route.fulfill({ status: 503, json: { error: "Temporary outage" } }),
  );
  await overview.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await overview.getByRole("alert").waitFor();
  // The header mirrors the widget: "Last refresh failed: <reason> · Retry", without private data.
  await expect(overview.getByRole("alert")).toContainText("Last refresh failed: Temporary outage");
  await expect(overview.getByTestId("field-status-word")).toHaveText("UNAVAILABLE");
  assert.equal(await overview.getByText("Active accounts · 5m", { exact: true }).count(), 0);
  assert.equal(await overview.getByText("Monitor Audit", { exact: true }).count(), 0);
  await page.unroute(monitorApi);
  await overview.getByRole("alert").getByRole("button", { name: "Retry", exact: true }).click();
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
} catch (error) {
  await page.screenshot({ path: output + "/failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (id) await DB.prepare("DELETE FROM user WHERE id=?").bind(id).run();
  DB.close();
  await browser.close();
}
