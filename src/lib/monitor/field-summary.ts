import { diagnosticSeverity, type DiagnosticSeverity } from "./diagnostics-filter.ts";
import type { CloudflareUsage, MonitorDiagnostic } from "./types.ts";

/**
 * The website Field monitor's top section reuses the Android widget's model (design plan M9):
 * the status word, ✕ ! i counts, Needs attention, Recently resolved, the traffic sparkline and the
 * plan-usage gauges. The data comes from `owner/monitor?include=widget-data` (stored rows only).
 */
type Unavailable = { state: "unavailable"; errorCode?: string };
export type MonitorSeries =
  | {
      state: "ready";
      timezone?: string;
      halfHour: {
        intervalMs: number;
        end: number;
        requests: (number | null)[];
        errors: (number | null)[];
        measured: number;
        expected: number;
      };
    }
  | Unavailable;
type ResolvedItem = {
  component: string;
  severity: DiagnosticSeverity | null;
  startedAt: number | null;
  resolvedAt: number | null;
  durationMs: number | null;
  resolution?: string;
  brief?: string;
  symptom?: string;
  impact?: string;
};
export type RecentlyResolved =
  { state: "ready"; total: number; complete: boolean; items: ResolvedItem[] } | Unavailable;

const SEVERITY_ORDER: DiagnosticSeverity[] = ["critical", "warning", "info"];

/** The widget's face word for the status the server computed; "STALE" when the reading is old. */
export function statusWord(
  overall: { color?: string; status?: string } | undefined,
  stale: boolean,
): string {
  if (stale) return "STALE";
  switch (overall?.status) {
    case "healthy":
      return "HEALTHY";
    case "attention":
      return "ATTENTION";
    case "failure":
      return "FAILURE";
    case "unverified":
      return "UNVERIFIED";
  }
  return overall?.color === "red"
    ? "FAILURE"
    : overall?.color === "green"
      ? "HEALTHY"
      : "UNVERIFIED";
}

type Check = MonitorDiagnostic & { severity?: string | null };
export function severityCounts(diagnostics: readonly Check[] | undefined) {
  const counts: Record<DiagnosticSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const check of diagnostics ?? []) {
    const severity = diagnosticSeverity(check);
    if (severity) counts[severity]++;
  }
  return counts;
}

/** Every non-green diagnostic, most severe first, then the longest-running. */
export function needsAttention(diagnostics: readonly Check[] | undefined) {
  return (diagnostics ?? [])
    .map((check) => ({ check, severity: diagnosticSeverity(check) }))
    .filter((item): item is { check: Check; severity: DiagnosticSeverity } => !!item.severity)
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        (b.check.durationMs || 0) - (a.check.durationMs || 0),
    );
}

/**
 * Text that is safe to paste into a bug report or a chat: email addresses (including the private
 * owner address), bearer or session tokens, long secret-looking strings, URL query strings and
 * room join codes are replaced. Only short, human-readable diagnostic text is kept.
 */
export function sanitizeForCopy(text: string | null | undefined): string {
  if (!text) return "";
  return (
    String(text)
      // Email addresses, including any owner or staff address.
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
      // Authorization headers and token-like key/value pairs.
      .replace(/\bbearer\s+\S+/gi, "Bearer [removed]")
      .replace(
        /\b(token|session|secret|api[_-]?key|key|password|cookie|authorization)\s*[:=]\s*\S+/gi,
        "$1=[removed]",
      )
      // Query strings and fragments (join links carry codes and tokens).
      .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/gi, "$1")
      // Join or room codes written out: "join=ABCD2345", "code ABCD2345", "room ABCD2345".
      .replace(/\b(join|code|room)\b(\s*[:=#]?\s*)[A-Z0-9-]{4,}/gi, "$1$2[code removed]")
      // Bare room codes: 6–10 capitals and digits with at least one digit.
      .replace(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,10}\b/g, "[code removed]")
      // Long opaque strings (tokens, keys, hashes).
      .replace(/[A-Za-z0-9_\-+/=]{24,}/g, "[removed]")
  );
}

const time = (at: number | null | undefined) => (at ? new Date(at).toISOString() : "unavailable");
const span = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "unavailable";
  const minutes = Math.max(0, Math.round(ms / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
  critical: "CRIT",
  warning: "WARN",
  info: "INFO",
};

/** A plain-text summary of one current diagnostic for a bug report or chat (sanitized). */
export function diagnosticCopy(check: Check, now = Date.now()): string {
  const severity = diagnosticSeverity(check);
  const lines = [
    `Lootsplitter Field monitor · ${severity ? SEVERITY_LABEL[severity] : "OK"} · ${check.component}`,
    `State: ${check.state || check.color}`,
    `Symptom: ${check.symptom}`,
    check.brief ? `Detail: ${check.brief}` : "",
    `First occurrence: ${time(check.firstOccurredAt)} · latest check: ${time(check.latestCheckAt)} · last success: ${time(check.lastSuccessAt)}`,
    `Duration: ${span(check.durationMs)}`,
    check.errorCode ? `Error code: ${check.errorCode}` : "",
    check.confirmedCause ? `Confirmed cause: ${check.confirmedCause}` : "",
    check.suspectedCause ? `Suspected cause: ${check.suspectedCause}` : "",
    check.impact ? `Impact: ${check.impact}` : "",
    check.action ? `Action: ${check.action}` : "",
    `Copied ${time(now)}`,
  ];
  return lines.filter(Boolean).map(sanitizeForCopy).join("\n");
}

/** A plain-text summary of one recently resolved problem (sanitized). */
export function resolvedCopy(item: ResolvedItem, now = Date.now()): string {
  const lines = [
    `Lootsplitter Field monitor · resolved${item.severity ? ` ${SEVERITY_LABEL[item.severity]}` : ""} · ${item.component}`,
    item.symptom ? `Symptom: ${item.symptom}` : item.brief ? `Detail: ${item.brief}` : "",
    `Started: ${time(item.startedAt)} · resolved: ${time(item.resolvedAt)} · lasted ${span(item.durationMs)}`,
    item.resolution ? `Resolution: ${item.resolution}` : "",
    item.impact ? `Impact: ${item.impact}` : "",
    `Copied ${time(now)}`,
  ];
  return lines.filter(Boolean).map(sanitizeForCopy).join("\n");
}

/**
 * SVG polyline runs for a series with gaps: a missing reading (null) breaks the line instead of
 * dropping to zero. Coordinates fit a width × height box with the top margin left for the peak.
 */
export function sparkline(values: readonly (number | null)[], width: number, height: number) {
  const known = values.filter((v): v is number => typeof v === "number");
  const max = Math.max(1, ...known);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const runs: string[] = [];
  let run: string[] = [];
  values.forEach((value, i) => {
    if (typeof value !== "number") {
      if (run.length) runs.push(run.join(" "));
      run = [];
      return;
    }
    const x = +(i * step).toFixed(1);
    const y = +(height - (value / max) * (height - 2)).toFixed(1);
    run.push(`${x},${y}`);
  });
  if (run.length) runs.push(run.join(" "));
  return { runs, max: known.length ? Math.max(...known) : null, measured: known.length };
}

/** One gauge per plan-usage metric: billing-cycle use (or current storage) against its allowance. */
export function usageGauges(usage: CloudflareUsage | undefined) {
  if (usage?.state !== "ready" || !usage.data) return [];
  return usage.data.metrics.map((m) => {
    const percent =
      m.state !== "ready" ? null : m.unit === "bytes" ? m.current?.percent : m.month?.percent;
    return {
      key: m.key,
      label: m.label,
      level: m.level,
      percent: typeof percent === "number" ? percent : null,
      unavailable: m.state !== "ready" ? m.errorCode || "unavailable" : null,
    };
  });
}
