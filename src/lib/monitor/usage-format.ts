import type { CloudflareUsage, UsageMetric } from "./types";

/** Same rules as cloudflare/cloudflare-usage.mjs: "—" for missing, "<0.01%" for tiny shares. */
export function formatPercent(p: number | null | undefined) {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  if (p === 0) return "0%";
  if (p < 0.01) return "<0.01%";
  return `${p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}
export function formatUsage(value: number | null | undefined, unit: UsageMetric["unit"]) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (unit === "bytes") {
    if (value >= 1e9) return `${value % 1e9 === 0 ? value / 1e9 : (value / 1e9).toFixed(2)} GB`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
    return `${Math.round(value / 1e3).toLocaleString("en-US")} kB`;
  }
  const text = Math.round(value).toLocaleString("en-US");
  return unit === "ms" ? `${text} ms` : text;
}
/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 22nd, 31st. */
export function ordinal(n: number) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
type UsageWindows = NonNullable<CloudflareUsage["data"]>["windows"];
/** "cycle since Oct 11" mid-sentence; "the month" for readings stored before the billing cycle. */
export function cycleName(month: UsageWindows["month"]) {
  return month.label ? month.label.charAt(0).toLowerCase() + month.label.slice(1) : "the month";
}
/** Rows for the owner page: label, then today / 7 days / billing cycle (or current storage) cells. */
export function usageRows(usage: CloudflareUsage | undefined) {
  if (!usage?.data) return [];
  return usage.data.metrics.map((m) => {
    if (m.state !== "ready")
      return {
        key: m.key,
        label: m.label,
        level: m.level,
        unavailable: m.errorCode || "unavailable",
        cells: [],
      };
    if (m.unit === "bytes")
      return {
        key: m.key,
        label: m.label,
        level: m.level,
        unavailable: null,
        cells: [
          {
            window: "Now",
            value: formatUsage(m.current?.value, "bytes"),
            share: `${formatPercent(m.current?.percent)} of ${formatUsage(m.allowance, "bytes")} included`,
          },
        ],
      };
    return {
      key: m.key,
      label: m.label,
      level: m.level,
      unavailable: null,
      cells: [
        {
          window: "Today",
          value: formatUsage(m.day?.value, m.unit),
          share: `${formatPercent(m.day?.percent)} of daily share`,
        },
        {
          window: "7 days",
          value: formatUsage(m.week?.value, m.unit),
          share: `${formatPercent(m.week?.percent)} of weekly share`,
        },
        {
          window: usage.data?.windows.month.label || "Month",
          value: formatUsage(m.month?.value, m.unit),
          share: `${formatPercent(m.month?.percent)} of ${formatUsage(m.monthlyAllowance, m.unit)}`,
        },
      ],
    };
  });
}
export function usageUnavailableText(usage: CloudflareUsage | undefined) {
  if (!usage) return "Not provided by this server version.";
  if (usage.state === "not-connected")
    return "Not connected · a read-only Cloudflare analytics connection is needed.";
  const code = usage.errorCode;
  return code === "NOT_COLLECTED"
    ? "Unavailable · the first hourly reading has not been collected yet."
    : code === "STALE_READING"
      ? "Unavailable · the last hourly reading is more than two hours old."
      : `Unavailable · Cloudflare did not return a usage reading${code ? ` (${code})` : ""}.`;
}
