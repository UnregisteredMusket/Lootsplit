import type { MonitorDiagnostic } from "./types.ts";

/**
 * Severity of a component diagnostic, the same rule as the Android widgets' ✕ ! i counts
 * (`widgetSeverity` in cloudflare/monitor-model.mjs): a confirmed failure is critical, a coverage
 * limit or optional check is info, any other non-green state is a warning, green has none.
 */
export type DiagnosticSeverity = "critical" | "warning" | "info";
export const DIAGNOSTIC_SEVERITIES: readonly DiagnosticSeverity[] = ["critical", "warning", "info"];

export function diagnosticSeverity(
  check: Pick<MonitorDiagnostic, "color" | "required" | "coverageLimit"> & {
    severity?: string | null;
    confirmedFailure?: boolean;
  },
): DiagnosticSeverity | null {
  if (!check) return null;
  if (DIAGNOSTIC_SEVERITIES.includes(check.severity as DiagnosticSeverity))
    return check.severity as DiagnosticSeverity;
  if (check.color === "green") return null;
  if (check.color === "red" || check.confirmedFailure === true) return "critical";
  if (check.required === false || check.coverageLimit === true) return "info";
  return "warning";
}

export type MonitorTab = "history" | "reports" | "task" | "diagnostics" | "registry";
const TABS: readonly MonitorTab[] = ["history", "reports", "task", "diagnostics", "registry"];

/**
 * Reads a My account monitor link: `#monitor-<tab>`, or `#monitor-diagnostics-<severity>` from a
 * widget count chip, which opens Diagnostics showing only that severity.
 */
export function monitorHash(hash: string): {
  tab: MonitorTab | null;
  severity: DiagnosticSeverity | null;
} {
  const id = hash.replace(/^#/, "").replace(/^monitor-/, "");
  const match = /^diagnostics-(critical|warning|info)$/.exec(id);
  if (match) return { tab: "diagnostics", severity: match[1] as DiagnosticSeverity };
  return { tab: TABS.includes(id as MonitorTab) ? (id as MonitorTab) : null, severity: null };
}
