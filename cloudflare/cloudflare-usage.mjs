import { json, providerErrorCode } from "./owner-monitor.mjs";

/**
 * Usage included in the Cloudflare Workers Paid plan, verified 2026-10-22. All included usage is
 * monthly; Cloudflare resets it on the account's subscription renewal date.
 *
 * - Workers (Standard usage model): 10 million requests and 30 million CPU milliseconds included
 *   per month. https://developers.cloudflare.com/workers/platform/pricing/
 * - D1 on Workers Paid: first 25 billion rows read and 50 million rows written per month, first
 *   5 GB storage (summed across every database, tables and indexes).
 *   https://developers.cloudflare.com/d1/platform/pricing/
 *
 * 5 GB is taken as 5 × 10^9 bytes, the smaller (conservative) reading of "GB".
 * Change these only after re-checking the pricing pages, and update verifiedOn.
 */
export const CLOUDFLARE_PAID_ALLOWANCES = Object.freeze({
  plan: "Workers Paid",
  verifiedOn: "2026-10-22",
  sources: Object.freeze([
    "https://developers.cloudflare.com/workers/platform/pricing/",
    "https://developers.cloudflare.com/d1/platform/pricing/",
  ]),
  requests: 10_000_000,
  cpuMs: 30_000_000,
  d1RowsRead: 25_000_000_000,
  d1RowsWritten: 50_000_000,
  d1StorageBytes: 5_000_000_000,
});
/** Month-to-date use at or above this share of the monthly allowance is shown amber. */
export const USAGE_ATTENTION_PERCENT = 80;
/** Collected hourly; a reading older than this is an explicit gap, not a current value. */
export const USAGE_STALE_MS = 2 * 3600000 + 5 * 60000;
export const USAGE_HOUR = 3600000;
const DAY = 86400000;

export const USAGE_METRICS = Object.freeze([
  { key: "requests", label: "Worker requests", unit: "count", group: "requests" },
  { key: "cpuMs", label: "Worker CPU time", unit: "ms", group: "cpu" },
  { key: "d1RowsRead", label: "D1 rows read", unit: "count", group: "d1" },
  { key: "d1RowsWritten", label: "D1 rows written", unit: "count", group: "d1" },
  { key: "d1StorageBytes", label: "D1 storage", unit: "bytes", group: "storage" },
]);

/**
 * UTC windows (Cloudflare's analytics and usage pages use UTC):
 * day = today so far, week = today plus the six preceding days, month = calendar month so far.
 * The daily share is the monthly allowance divided by the days in this month, so the daily shares
 * of a month add up to exactly its allowance; the weekly share is seven daily shares.
 */
export function usageWindows(now) {
  const at = new Date(now);
  const year = at.getUTCFullYear(),
    month = at.getUTCMonth();
  const dayStart = Date.UTC(year, month, at.getUTCDate());
  const monthStart = Date.UTC(year, month, 1);
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    timezone: "UTC",
    end: now,
    day: { start: dayStart, end: now },
    week: { start: dayStart - 6 * DAY, end: now, days: 7 },
    month: {
      start: monthStart,
      end: now,
      days,
      // Share of the month already elapsed: the pace month-to-date use can be compared against.
      elapsedPercent: round(((now - monthStart) / (days * DAY)) * 100),
    },
  };
}
const round = (value) => Math.round(value * 1000) / 1000;
const finite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const percent = (value, share) =>
  finite(value) && share > 0 ? round((value / share) * 100) : null;
const iso = (t) => new Date(t).toISOString();
const date = (t) => iso(t).slice(0, 10);
const invalid = () => new Error("Invalid usage analytics");

async function graphql(env, fetcher, body) {
  const response = await json(fetcher, "https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OWNER_MONITOR_CLOUDFLARE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query ($account: string) { viewer { accounts(filter: {accountTag: $account}) { ${body} } } }`,
      variables: { account: env.OWNER_MONITOR_CLOUDFLARE_ACCOUNT_ID },
    }),
  });
  const accounts = response?.data?.viewer?.accounts;
  if (response?.errors?.length || !Array.isArray(accounts) || accounts.length !== 1)
    throw invalid();
  return accounts[0];
}
/** One aggregate row (no dimensions). A valid empty result is zero use; anything else is invalid. */
function total(rows, field) {
  if (!Array.isArray(rows) || rows.length > 1) throw invalid();
  if (!rows.length) return 0;
  const value = rows[0]?.sum?.[field];
  if (!finite(value)) throw invalid();
  return value;
}
const WINDOWS = ["day", "week", "month"];
/** Account-wide Worker sums for the three windows in one request (aliased datasets). */
async function workerSums(env, fetcher, windows, field) {
  const account = await graphql(
    env,
    fetcher,
    WINDOWS.map(
      (w) =>
        `${w}: workersInvocationsAdaptive(limit: 1, filter: {datetime_geq: "${iso(windows[w].start)}", datetime_lt: "${iso(windows.end)}"}) { sum { ${field} } }`,
    ).join(" "),
  );
  return Object.fromEntries(WINDOWS.map((w) => [w, total(account[w], field)]));
}
async function d1Sums(env, fetcher, windows) {
  const account = await graphql(
    env,
    fetcher,
    WINDOWS.map(
      (w) =>
        `${w}: d1AnalyticsAdaptiveGroups(limit: 1, filter: {date_geq: "${date(windows[w].start)}", date_leq: "${date(windows.end)}"}) { sum { rowsRead rowsWritten } }`,
    ).join(" "),
  );
  return {
    d1RowsRead: Object.fromEntries(WINDOWS.map((w) => [w, total(account[w], "rowsRead")])),
    d1RowsWritten: Object.fromEntries(WINDOWS.map((w) => [w, total(account[w], "rowsWritten")])),
  };
}
/** Current storage: each database's newest daily maximum, summed across the account. */
async function d1Storage(env, fetcher, windows) {
  const account = await graphql(
    env,
    fetcher,
    `storage: d1StorageAdaptiveGroups(limit: 1000, filter: {date_geq: "${date(windows.day.start - 2 * DAY)}", date_leq: "${date(windows.end)}"}, orderBy: [date_DESC]) { max { databaseSizeBytes } dimensions { date databaseId } }`,
  );
  const rows = account.storage;
  if (!Array.isArray(rows)) throw invalid();
  // No row means Cloudflare reported no size; storage is never assumed to be zero.
  if (!rows.length) throw Object.assign(invalid(), { providerCode: "NO_STORAGE_READING" });
  const newest = new Map();
  for (const row of rows) {
    const id = row?.dimensions?.databaseId,
      day = row?.dimensions?.date,
      size = row?.max?.databaseSizeBytes;
    if (typeof id !== "string" || typeof day !== "string" || !finite(size)) throw invalid();
    const seen = newest.get(id);
    if (!seen || day > seen.day) newest.set(id, { day, size });
  }
  let bytes = 0;
  for (const { size } of newest.values()) bytes += size;
  return { value: bytes, databases: newest.size };
}
const failure = (error) =>
  error?.providerCode === "NO_STORAGE_READING" ? "NO_STORAGE_READING" : providerErrorCode(error);

/**
 * Builds the usage reading from per-group results ({ status, value | reason } as from
 * Promise.allSettled). Each group fails independently: an unavailable metric has null values and
 * its own error code, and never reads as zero.
 */
export function usageReading(groups, windows, checkedAt, allowances = CLOUDFLARE_PAID_ALLOWANCES) {
  const values = {
    requests: groups.requests,
    cpuMs: groups.cpu,
    d1RowsRead: groups.d1,
    d1RowsWritten: groups.d1,
    d1StorageBytes: groups.storage,
  };
  const metrics = USAGE_METRICS.map((def) => {
    const result = values[def.key];
    const ready = result?.status === "fulfilled";
    const base = {
      key: def.key,
      label: def.label,
      unit: def.unit,
      state: ready ? "ready" : "unavailable",
      errorCode: ready ? null : failure(result?.reason),
    };
    if (def.key === "d1StorageBytes") {
      const value = ready ? result.value.value : null;
      const share = percent(value, allowances.d1StorageBytes);
      return {
        ...base,
        allowance: allowances.d1StorageBytes,
        current: { value, allowance: allowances.d1StorageBytes, percent: share },
        databases: ready ? result.value.databases : null,
        level: !ready
          ? "unavailable"
          : share >= 100
            ? "over"
            : share >= USAGE_ATTENTION_PERCENT
              ? "attention"
              : "ok",
      };
    }
    const sums = ready
      ? def.group === "d1"
        ? result.value[def.key]
        : result.value
      : { day: null, week: null, month: null };
    // CPU is reported in microseconds; the allowance is in milliseconds.
    const scale = (v) => (v === null ? null : def.key === "cpuMs" ? round(v / 1000) : v);
    const monthly = allowances[def.key];
    const daily = monthly / windows.month.days;
    const part = (value, share) => ({ value, share: round(share), percent: percent(value, share) });
    const month = part(scale(sums.month), monthly);
    return {
      ...base,
      monthlyAllowance: monthly,
      day: part(scale(sums.day), daily),
      week: part(scale(sums.week), daily * 7),
      month,
      level: !ready
        ? "unavailable"
        : month.percent >= 100
          ? "over"
          : month.percent >= USAGE_ATTENTION_PERCENT
            ? "attention"
            : "ok",
    };
  });
  const available = metrics.filter((m) => m.state === "ready");
  if (!available.length)
    return {
      state: "unavailable",
      checkedAt,
      data: null,
      errorCode: metrics[0].errorCode,
      unavailable: metrics.map(({ key, errorCode }) => ({ key, errorCode })),
    };
  return {
    state: "ready",
    checkedAt,
    data: {
      scope: "account",
      plan: allowances.plan,
      allowancesVerifiedOn: allowances.verifiedOn,
      sources: [...allowances.sources],
      windows,
      metrics,
      complete: available.length === metrics.length,
    },
  };
}

/**
 * Reads account-wide Worker requests and CPU time and D1 rows read/written and storage from the
 * Cloudflare GraphQL Analytics API with the existing Account Analytics Read token. Four bounded
 * requests (requests, CPU, D1 rows, D1 storage), each failing independently, so one dataset
 * cannot blank the others.
 */
export async function cloudflareUsage(env, fetcher = fetch, now = Date.now()) {
  if (
    !env.OWNER_MONITOR_CLOUDFLARE_TOKEN ||
    !/^[a-f0-9]{32}$/.test(env.OWNER_MONITOR_CLOUDFLARE_ACCOUNT_ID || "")
  )
    return { state: "not-connected", checkedAt: null, data: null };
  const windows = usageWindows(now);
  const [requests, cpu, d1, storage] = await Promise.allSettled([
    workerSums(env, fetcher, windows, "requests"),
    workerSums(env, fetcher, windows, "cpuTimeUs"),
    d1Sums(env, fetcher, windows),
    d1Storage(env, fetcher, windows),
  ]);
  return usageReading({ requests, cpu, d1, storage }, windows, now);
}

const grouped = (n) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export function formatPercent(p) {
  if (p === null || p === undefined) return "—";
  if (p === 0) return "0%";
  if (p < 0.01) return "<0.01%";
  return `${p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}
export function formatUsage(value, unit) {
  if (value === null || value === undefined) return "—";
  if (unit === "bytes") {
    if (value >= 1e9) return `${value % 1e9 === 0 ? value / 1e9 : (value / 1e9).toFixed(2)} GB`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
    return `${grouped(value / 1e3)} kB`;
  }
  return unit === "ms" ? `${grouped(value)} ms` : grouped(value);
}
/** One line per metric, e.g. "Worker requests: today 12,345 (3.8% of daily share) · …". */
export function usageLines(usage) {
  if (usage?.state !== "ready")
    return [
      usage?.state === "not-connected"
        ? "Cloudflare usage is not connected."
        : `Cloudflare usage unavailable${usage?.errorCode ? ` (${usage.errorCode})` : ""}.`,
    ];
  return usage.data.metrics.map((m) => {
    if (m.state !== "ready") return `${m.label}: unavailable (${m.errorCode}).`;
    if (m.unit === "bytes")
      return `${m.label}: ${formatUsage(m.current.value, "bytes")} (${formatPercent(m.current.percent)} of ${formatUsage(m.allowance, "bytes")} included).`;
    return `${m.label}: today ${formatUsage(m.day.value, m.unit)} (${formatPercent(m.day.percent)} of daily share) · 7 days ${formatUsage(m.week.value, m.unit)} (${formatPercent(m.week.percent)} of weekly share) · month ${formatUsage(m.month.value, m.unit)} (${formatPercent(m.month.percent)} of ${formatUsage(m.monthlyAllowance, m.unit)}).`;
  });
}
export function usageSummary(usage) {
  const lines = usageLines(usage);
  if (usage?.state !== "ready") return lines[0];
  const pace = usage.data.windows.month.elapsedPercent;
  return `Cloudflare plan usage (account-wide, UTC; ${formatPercent(pace)} of the month elapsed): ${lines.join(" ")}`;
}
