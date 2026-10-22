// Cloudflare plan usage against the Workers Paid included allowance: allowance constant, UTC
// windows and shares, independent per-dataset failure (never zero), hourly collection into the
// registered `cloudflare-usage` log, the snapshot the widgets read and the daily report section.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import {
  CLOUDFLARE_PAID_ALLOWANCES,
  cloudflareUsage,
  usageWindows,
  usageSummary,
  formatPercent,
  formatUsage,
  USAGE_HOUR,
} from "../cloudflare/cloudflare-usage.mjs";
import {
  BUILTIN_LOGS,
  collectUsage,
  latestUsage,
  initializeMonitor,
  generateReport,
  scheduledMonitor,
  monitorSnapshot,
} from "../cloudflare/monitor-journal.mjs";
import { widgetSnapshot } from "../cloudflare/owner-monitor.mjs";
import { DEFAULT_CONFIG, INTERVAL } from "../cloudflare/monitor-model.mjs";

const now = Date.parse("2026-10-22T12:00:00Z");
const env = (extra = {}) => ({
  OWNER_MONITOR_CLOUDFLARE_TOKEN: "synthetic-read-token",
  OWNER_MONITOR_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  ...extra,
});
const sums = (field, values) =>
  Object.fromEntries(
    Object.entries(values).map(([w, v]) => [w, v === undefined ? [] : [{ sum: { [field]: v } }]]),
  );
/** A synthetic GraphQL endpoint answering each of the four usage queries. */
function provider({ fail = [], requests, cpu, d1, storage } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    assert.equal(url, "https://api.cloudflare.com/client/v4/graphql");
    assert.equal(options.redirect, "manual");
    const { query, variables } = JSON.parse(options.body);
    assert.equal(variables.account, "a".repeat(32));
    const kind = query.includes("cpuTimeUs")
      ? "cpu"
      : query.includes("workersInvocationsAdaptive")
        ? "requests"
        : query.includes("d1AnalyticsAdaptiveGroups")
          ? "d1"
          : "storage";
    calls.push({ kind, query });
    if (fail.includes(kind)) return new Response("{}", { status: 400 });
    const account =
      kind === "requests"
        ? sums("requests", requests ?? { day: 12345, week: 80000, month: 300000 })
        : kind === "cpu"
          ? sums("cpuTimeUs", cpu ?? { day: 2_000_000, week: 9_000_000, month: 40_000_000 })
          : kind === "d1"
            ? Object.fromEntries(
                Object.entries(
                  d1 ?? {
                    day: { rowsRead: 1000, rowsWritten: 10 },
                    week: { rowsRead: 7000, rowsWritten: 70 },
                    month: { rowsRead: 21_000_000_000, rowsWritten: 300 },
                  },
                ).map(([w, sum]) => [w, [{ sum }]]),
              )
            : {
                storage: storage ?? [
                  {
                    max: { databaseSizeBytes: 9_000_000 },
                    dimensions: { date: "2026-10-21", databaseId: "db-1" },
                  },
                  {
                    max: { databaseSizeBytes: 10_000_000 },
                    dimensions: { date: "2026-10-22", databaseId: "db-1" },
                  },
                  {
                    max: { databaseSizeBytes: 2_000_000 },
                    dimensions: { date: "2026-10-22", databaseId: "db-2" },
                  },
                ],
              };
    return Response.json({ data: { viewer: { accounts: [account] } } });
  };
  return { fetcher, calls };
}
const metric = (usage, key) => usage.data.metrics.find((m) => m.key === key);

test("allowances are the verified Workers Paid included usage, kept in one constant", () => {
  assert.equal(CLOUDFLARE_PAID_ALLOWANCES.requests, 10_000_000);
  assert.equal(CLOUDFLARE_PAID_ALLOWANCES.cpuMs, 30_000_000);
  assert.equal(CLOUDFLARE_PAID_ALLOWANCES.d1RowsRead, 25_000_000_000);
  assert.equal(CLOUDFLARE_PAID_ALLOWANCES.d1RowsWritten, 50_000_000);
  assert.equal(CLOUDFLARE_PAID_ALLOWANCES.d1StorageBytes, 5_000_000_000);
  assert.ok(Object.isFrozen(CLOUDFLARE_PAID_ALLOWANCES));
  assert.ok(
    CLOUDFLARE_PAID_ALLOWANCES.sources.every((s) =>
      s.startsWith("https://developers.cloudflare.com/"),
    ),
  );
});

test("UTC windows: today so far, seven days and calendar month to date with its elapsed share", () => {
  const w = usageWindows(now);
  assert.equal(w.day.start, Date.parse("2026-10-22T00:00:00Z"));
  assert.equal(w.week.start, Date.parse("2026-10-16T00:00:00Z"));
  assert.equal(w.month.start, Date.parse("2026-10-01T00:00:00Z"));
  assert.equal(w.month.days, 31);
  assert.equal(w.month.elapsedPercent, Math.round((21.5 / 31) * 100 * 1000) / 1000);
  assert.equal(usageWindows(Date.parse("2028-02-10T00:00:00Z")).month.days, 29);
});

test("usage is read account-wide and compared with daily, weekly and monthly shares", async () => {
  const { fetcher, calls } = provider();
  const usage = await cloudflareUsage(env(), fetcher, now);
  assert.equal(calls.length, 4);
  // Allowance use is account-wide: no single-script filter.
  assert.ok(calls.every((c) => !c.query.includes("scriptName")));
  assert.match(
    calls.find((c) => c.kind === "requests").query,
    /datetime_geq: "2026-10-16T00:00:00.000Z"/,
  );
  assert.match(
    calls.find((c) => c.kind === "d1").query,
    /date_geq: "2026-10-01", date_leq: "2026-10-22"/,
  );
  assert.equal(usage.state, "ready");
  assert.equal(usage.data.complete, true);
  const requests = metric(usage, "requests");
  const daily = 10_000_000 / 31;
  assert.equal(requests.day.value, 12345);
  assert.equal(requests.day.percent, Math.round((12345 / daily) * 100 * 1000) / 1000);
  assert.equal(requests.week.percent, Math.round((80000 / (daily * 7)) * 100 * 1000) / 1000);
  assert.equal(requests.month.percent, 3);
  assert.equal(requests.level, "ok");
  // CPU arrives in microseconds; the allowance is milliseconds.
  assert.equal(metric(usage, "cpuMs").month.value, 40_000);
  // 21 billion of 25 billion rows read is 84%: amber attention, not a failure.
  assert.equal(metric(usage, "d1RowsRead").month.percent, 84);
  assert.equal(metric(usage, "d1RowsRead").level, "attention");
  // Storage: each database's newest day, summed.
  const storage = metric(usage, "d1StorageBytes");
  assert.equal(storage.current.value, 12_000_000);
  assert.equal(storage.databases, 2);
  assert.equal(storage.current.percent, 0.24);
  assert.match(usageSummary(usage), /Worker requests: today 12,345 \(3\.8% of daily share\)/);
});

test("one failed dataset is an explicit unavailable metric, never zero; the others stay", async () => {
  const usage = await cloudflareUsage(env(), provider({ fail: ["cpu"] }).fetcher, now);
  assert.equal(usage.state, "ready");
  assert.equal(usage.data.complete, false);
  const cpu = metric(usage, "cpuMs");
  assert.equal(cpu.state, "unavailable");
  assert.equal(cpu.errorCode, "HTTP_400");
  assert.equal(cpu.day.value, null);
  assert.equal(cpu.month.percent, null);
  assert.equal(metric(usage, "requests").state, "ready");
  assert.match(usageSummary(usage), /Worker CPU time: unavailable \(HTTP_400\)/);

  const none = await cloudflareUsage(
    env(),
    provider({ fail: ["requests", "cpu", "d1", "storage"] }).fetcher,
    now,
  );
  assert.equal(none.state, "unavailable");
  assert.equal(none.data, null);

  // No storage rows is a missing reading, not 0 bytes.
  const empty = await cloudflareUsage(env(), provider({ storage: [] }).fetcher, now);
  assert.equal(metric(empty, "d1StorageBytes").state, "unavailable");
  assert.equal(metric(empty, "d1StorageBytes").errorCode, "NO_STORAGE_READING");
  assert.equal(metric(empty, "d1StorageBytes").current.value, null);

  // Malformed totals are invalid, not zero; GraphQL errors fail the dataset.
  const bad = await cloudflareUsage(
    env(),
    provider({ requests: { day: -1, week: 1, month: 1 } }).fetcher,
    now,
  );
  assert.equal(metric(bad, "requests").state, "unavailable");

  const disconnected = await cloudflareUsage(
    {},
    () => assert.fail("no request without a token"),
    now,
  );
  assert.equal(disconnected.state, "not-connected");
});

test("formatting keeps tiny shares visible and missing values as a dash", () => {
  assert.equal(formatPercent(null), "—");
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(0.004), "<0.01%");
  assert.equal(formatPercent(0.376), "0.38%");
  assert.equal(formatPercent(3.827), "3.8%");
  assert.equal(formatPercent(84), "84%");
  assert.equal(formatUsage(null, "count"), "—");
  assert.equal(formatUsage(12345, "count"), "12,345");
  assert.equal(formatUsage(5_000_000_000, "bytes"), "5 GB");
  assert.equal(formatUsage(12_000_000, "bytes"), "12.0 MB");
});

test("hourly collection is a registered log, once per hour, with explicit gaps and staleness", async () => {
  assert.ok(BUILTIN_LOGS.some(([id]) => id === "cloudflare-usage"));
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, now - 86400000);
    const registry = await DB.prepare(
      "SELECT id FROM owner_monitor_registry WHERE id='cloudflare-usage'",
    ).first();
    assert.ok(registry, "registered before its first entry");
    assert.equal((await latestUsage(DB, now)).errorCode, "NOT_COLLECTED");

    const { fetcher, calls } = provider();
    const first = await collectUsage({ DB, ...env() }, now, cloudflareUsage, fetcher);
    assert.equal(first.state, "ready");
    assert.equal(calls.length, 4);
    // The same UTC hour is not collected again by later minute ticks.
    assert.equal(
      await collectUsage({ DB, ...env() }, now + 59 * 60000, cloudflareUsage, fetcher),
      null,
    );
    assert.equal(calls.length, 4);
    const entry = await DB.prepare(
      "SELECT id,summary,body FROM owner_monitor_logs WHERE source='cloudflare-usage'",
    ).first();
    assert.equal(entry.id, `usage:${Math.floor(now / USAGE_HOUR) * USAGE_HOUR}`);
    assert.match(entry.summary, /Workers Paid|Cloudflare plan usage/);
    assert.equal(JSON.parse(entry.body).coverageGap, null);
    assert.equal((await latestUsage(DB, now + 60000)).state, "ready");
    // Older than two hours: an explicit gap, the old numbers are not presented as current.
    const stale = await latestUsage(DB, now + 3 * USAGE_HOUR);
    assert.equal(stale.state, "unavailable");
    assert.equal(stale.errorCode, "STALE_READING");
    assert.equal(stale.data, null);

    // A partly failed hour is stored with a coverage gap naming the missing metric.
    await collectUsage(
      { DB, ...env() },
      now + USAGE_HOUR,
      cloudflareUsage,
      provider({ fail: ["storage"] }).fetcher,
    );
    // Not connected is stored as a gap, not as data.
    await collectUsage({ DB }, now + 2 * USAGE_HOUR, cloudflareUsage, fetch);
    const gaps = (
      await DB.prepare(
        "SELECT json_extract(body,'$.coverageGap') AS gap FROM owner_monitor_logs WHERE source='cloudflare-usage' ORDER BY observed_at",
      ).all()
    ).results.map((r) => r.gap);
    assert.equal(gaps[0], null);
    assert.match(gaps[1], /D1 storage \(HTTP_400\)/);
    assert.match(gaps[2], /not connected/);
    assert.equal((await latestUsage(DB, now + 2 * USAGE_HOUR)).state, "not-connected");
  } finally {
    DB.close();
  }
});

test("the dispatcher collects usage hourly and the snapshot and widget view carry it", async () => {
  const DB = localAccountDb();
  try {
    await DB.prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('owner','Owner','test@example.com',1,?,?)",
    )
      .bind(now, now)
      .run();
    await DB.prepare("INSERT INTO site_roles VALUES('owner','owner',?)").bind(now).run();
    await DB.prepare(
      "INSERT OR IGNORE INTO member_access(user_id,status) VALUES('owner','active')",
    ).run();
    await initializeMonitor(DB, now - INTERVAL);
    const reading = async () => ({
      checkedAt: now,
      health: { status: "healthy", checks: [], stats: {} },
      analytics: { state: "unavailable", checkedAt: now, data: null },
      development: { state: "not-connected", checkedAt: null, data: null },
      traffic: { state: "not-connected", checkedAt: null, data: null },
      release: { state: "unavailable", checkedAt: now, data: null },
    });
    let reads = 0;
    const reader = async (_env, _fetcher, at) => {
      reads++;
      return cloudflareUsage(env(), provider().fetcher, at);
    };
    for (const at of [now, now + 60000, now + 120000])
      await scheduledMonitor({ DB }, at, {
        now: at,
        integrations: true,
        collector: reading,
        cloudflareUsage: reader,
        fetcher: async () => new Response("", { status: 503 }),
      });
    assert.equal(reads, 1, "one reading per hour across minute ticks");
    const snapshot = await monitorSnapshot({ DB }, "owner", {
      force: true,
      now: now + 180000,
      collector: reading,
    });
    assert.equal(snapshot.usage.state, "ready");
    assert.equal(metric(snapshot.usage, "requests").day.value, 12345);
    assert.deepEqual(widgetSnapshot(snapshot).usage, snapshot.usage);
    // Turning integrations off (tests and tools) never calls the reader.
    await scheduledMonitor({ DB }, now + USAGE_HOUR, {
      now: now + USAGE_HOUR,
      integrations: false,
      collector: reading,
      cloudflareUsage: reader,
    });
    assert.equal(reads, 1);
  } finally {
    DB.close();
  }
});

test("daily report includes the day's usage, an 80% recommendation and a gap without readings", async () => {
  const DB = localAccountDb();
  try {
    const day = "2026-10-21";
    await initializeMonitor(DB, Date.parse("2026-10-20T00:00:00Z"));
    const at = Date.parse("2026-10-21T18:00:00Z");
    await collectUsage({ DB, ...env() }, at, cloudflareUsage, provider().fetcher);
    const report = await generateReport(
      DB,
      day,
      DEFAULT_CONFIG,
      Date.parse("2026-10-22T05:00:00Z"),
    );
    assert.equal(report.cloudflareUsage.readings, 1);
    assert.equal(report.cloudflareUsage.available, 1);
    assert.equal(report.cloudflareUsage.latest.observedAt, at);
    assert.ok(
      report.cloudflareUsage.lines.some((l) => /^D1 rows read: .*84% of 25,000,000,000/.test(l)),
    );
    assert.ok(report.recommendations.some((r) => /D1 rows read is at 84%/.test(r)));
    assert.match(report.summary, /Cloudflare plan usage: 1 of 1 hourly readings available/);
    const coverage = report.coverage.find((c) => c.id === "cloudflare-usage");
    assert.equal(coverage.entries, 1);
    assert.match(coverage.gap, /missing or stale/, "one reading in a day leaves hourly gaps");

    const empty = await generateReport(
      DB,
      "2026-10-20",
      DEFAULT_CONFIG,
      Date.parse("2026-10-22T05:00:00Z"),
    );
    assert.equal(empty.cloudflareUsage.latest, null);
    assert.match(empty.summary, /no available reading/);
    assert.ok(empty.gaps.some((g) => g.startsWith("Cloudflare plan usage:")));
  } finally {
    DB.close();
  }
});
