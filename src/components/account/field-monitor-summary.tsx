import { useState } from "react";
import { Copy } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { DIAGNOSTIC_SEVERITIES, type DiagnosticSeverity } from "@/lib/monitor/diagnostics-filter";
import {
  needsAttention,
  resolvedCopy,
  severityCounts,
  sparkline,
  diagnosticCopy,
  usageGauges,
  type MonitorSeries,
  type RecentlyResolved,
} from "@/lib/monitor/field-summary";
import { formatPercent } from "@/lib/monitor/usage-format";
import type { JournalSnapshot, MonitorDiagnostic } from "@/lib/monitor/types";

/** Like the widget's list: the most serious items first; the rest are a tap away in Diagnostics. */
const ATTENTION_LIMIT = 5;
const GLYPH: Record<DiagnosticSeverity, string> = { critical: "✕", warning: "!", info: "i" };
const WORD: Record<DiagnosticSeverity, string> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};
const LABEL: Record<DiagnosticSeverity, string> = {
  critical: "CRIT",
  warning: "WARN",
  info: "INFO",
};
const clock = (at: number | null | undefined) =>
  at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
const span = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const minutes = Math.max(0, Math.round(ms / 60000));
  return minutes < 60
    ? `${minutes}m`
    : minutes < 2880
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : `${Math.floor(minutes / 1440)}d`;
};

/** Copies a sanitized plain-text summary: never tokens, email addresses or join codes. */
export function CopyDiagnostics({ text, label }: { text: () => string; label: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    const value = text();
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setMessage("Copied a summary without emails, tokens or join codes.");
    } catch {
      // Some browsers block the clipboard API; a selected text field still copies.
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const copied = document.execCommand?.("copy");
      area.remove();
      setMessage(
        copied
          ? "Copied a summary without emails, tokens or join codes."
          : "Copy was blocked by the browser. Select the text above instead.",
      );
    }
  }
  return (
    <span className="field-copy">
      <button type="button" onClick={() => void copy()} aria-label={`Copy diagnostics: ${label}`}>
        <Copy size={15} aria-hidden="true" /> Copy diagnostics
      </button>
      {message && <span role="status">{message}</span>}
    </span>
  );
}

function Sparkline({ series }: { series: MonitorSeries | undefined }) {
  if (!series) return <p className="owner-monitor-note">Traffic chart needs a server update.</p>;
  if (series.state !== "ready")
    return (
      <p className="owner-monitor-note">
        Traffic chart unavailable ({series.errorCode || "unavailable"}); not shown as zero.
      </p>
    );
  const width = 240,
    height = 40;
  const requests = sparkline(series.halfHour.requests, width, height);
  const errors = sparkline(series.halfHour.errors, width, 12);
  const totalRequests = series.halfHour.requests.reduce<number>((a, v) => a + (v ?? 0), 0);
  const totalErrors = series.halfHour.errors.reduce<number>((a, v) => a + (v ?? 0), 0);
  return (
    <figure className="field-sparkline">
      <svg
        viewBox={`0 0 ${width} ${height + 16}`}
        role="img"
        aria-label={`Worker requests over the last 24 hours: ${totalRequests.toLocaleString()} requests and ${totalErrors.toLocaleString()} errors in ${series.halfHour.measured} of ${series.halfHour.expected} half-hour readings.`}
        preserveAspectRatio="none"
      >
        {requests.runs.map((points, i) => (
          <polyline key={`r${i}`} points={points} className="field-sparkline-requests" />
        ))}
        <g transform={`translate(0 ${height + 2})`}>
          <line x1="0" x2={width} y1="12" y2="12" className="field-sparkline-base" />
          {errors.runs.map((points, i) => (
            <polyline key={`e${i}`} points={points} className="field-sparkline-errors" />
          ))}
        </g>
      </svg>
      <figcaption>
        24 h · {totalRequests.toLocaleString()} requests · {totalErrors.toLocaleString()} errors
        {series.halfHour.measured < series.halfHour.expected
          ? ` · ${series.halfHour.measured} of ${series.halfHour.expected} readings (gaps left empty)`
          : ""}
      </figcaption>
    </figure>
  );
}

function Resolved({ resolved, now }: { resolved: RecentlyResolved | undefined; now: number }) {
  if (!resolved) return <p className="owner-monitor-note">Recovery times need a server update.</p>;
  if (resolved.state !== "ready")
    return (
      <p className="owner-monitor-note">
        Recently resolved is unavailable ({resolved.errorCode || "unavailable"}).
      </p>
    );
  if (!resolved.items.length)
    return <p className="owner-monitor-note">No problems ended in the last 24 hours.</p>;
  return (
    <>
      <ul className="field-items">
        {resolved.items.map((item) => (
          <li key={`${item.component}-${item.resolvedAt}`}>
            <details>
              <summary>
                <span className="field-tag" data-severity="resolved">
                  ✓ {item.severity ? LABEL[item.severity] : "OK"}
                </span>{" "}
                {item.component}
                <small>
                  {clock(item.startedAt)}–{clock(item.resolvedAt)} · {span(item.durationMs)}
                </small>
              </summary>
              {item.symptom && <p>{item.symptom}</p>}
              {item.impact && <p>{item.impact}</p>}
              <p className="owner-monitor-note">
                {item.resolution === "retired" ? "Retired (finished branch)" : "Recovered"} ·
                started {item.startedAt ? new Date(item.startedAt).toLocaleString() : "—"} ·
                resolved {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString() : "—"}
              </p>
              <CopyDiagnostics label={item.component} text={() => resolvedCopy(item, now)} />
            </details>
          </li>
        ))}
      </ul>
      {(resolved.total > resolved.items.length || !resolved.complete) && (
        <p className="owner-monitor-note">
          {resolved.total > resolved.items.length
            ? `${resolved.total - resolved.items.length} more resolved in the last 24 hours.`
            : ""}
          {!resolved.complete ? " The scan was bounded, so the list may be incomplete." : ""}
        </p>
      )}
    </>
  );
}

type SummarySnapshot = JournalSnapshot & {
  series?: MonitorSeries;
  recentlyResolved?: RecentlyResolved;
};

/** The widget's model on the web: counts, Needs attention, Recently resolved, traffic, usage. */
export function FieldMonitorSummary({ data, now }: { data: SummarySnapshot; now: number }) {
  const counts = severityCounts(data.diagnostics);
  const attention = needsAttention(data.diagnostics as MonitorDiagnostic[] | undefined);
  const gauges = usageGauges(data.usage);
  const elapsed = data.usage?.data?.windows.month.elapsedPercent;
  const openDiagnostics = () =>
    // Router navigation changes the hash without a hashchange event; tell the journal to follow.
    setTimeout(() => window.dispatchEvent(new Event("lootsplit-monitor-destination")));
  return (
    <section className="field-summary" aria-label="Field monitor summary">
      <nav className="field-counts" aria-label="Diagnostics by severity">
        {DIAGNOSTIC_SEVERITIES.map((severity) => (
          <AppLink
            key={severity}
            href={`/account#monitor-diagnostics-${severity}`}
            data-severity={severity}
            data-count={counts[severity]}
            onClick={openDiagnostics}
            aria-label={`${counts[severity]} ${WORD[severity]}: open diagnostics showing only ${WORD[severity]}`}
          >
            <b aria-hidden="true">{GLYPH[severity]}</b> {counts[severity]}
            <span aria-hidden="true"> {WORD[severity]}</span>
          </AppLink>
        ))}
      </nav>
      <div className="field-summary-grid">
        <section aria-labelledby="field-attention">
          <h3 id="field-attention">Needs attention</h3>
          {attention.length ? (
            <ul className="field-items">
              {attention.slice(0, ATTENTION_LIMIT).map(({ check, severity }) => (
                <li key={check.component}>
                  <details>
                    <summary>
                      <span className="field-tag" data-severity={severity}>
                        {GLYPH[severity]} {LABEL[severity]}
                      </span>{" "}
                      {check.component}
                      <small>
                        {check.firstOccurredAt
                          ? `since ${clock(check.firstOccurredAt)} · ${span(check.durationMs)}`
                          : check.brief || check.state}
                      </small>
                    </summary>
                    <p>{check.symptom}</p>
                    {(check.impact || check.action) && (
                      <p>
                        {check.impact} {check.action}
                      </p>
                    )}
                    <p className="owner-monitor-note">
                      Latest check {new Date(check.latestCheckAt).toLocaleString()}
                      {check.errorCode ? ` · ${check.errorCode}` : ""}
                    </p>
                    <CopyDiagnostics
                      label={check.component}
                      text={() => diagnosticCopy(check, now)}
                    />
                  </details>
                </li>
              ))}
            </ul>
          ) : null}
          {attention.length > ATTENTION_LIMIT && (
            <p className="owner-monitor-note">
              {attention.length - ATTENTION_LIMIT} more in{" "}
              <AppLink href="/account#monitor-diagnostics" onClick={openDiagnostics}>
                Diagnostics
              </AppLink>
              .
            </p>
          )}
          {!attention.length && (
            <p className="owner-monitor-note">
              Nothing needs attention
              {data.diagnostics?.length ? ` · ${data.diagnostics.length} checks clear` : ""}.
            </p>
          )}
        </section>
        <section aria-labelledby="field-resolved">
          <h3 id="field-resolved">Recently resolved</h3>
          <Resolved resolved={data.recentlyResolved} now={now} />
        </section>
        <section aria-labelledby="field-traffic-chart">
          <h3 id="field-traffic-chart">Traffic</h3>
          <Sparkline series={data.series} />
        </section>
        <section aria-labelledby="field-usage-gauges">
          <h3 id="field-usage-gauges">Plan usage</h3>
          {gauges.length ? (
            <ul className="field-gauges">
              {gauges.map((gauge) => (
                <li key={gauge.key} data-level={gauge.level}>
                  <span>{gauge.label}</span>
                  {gauge.percent === null ? (
                    <small>Unavailable ({gauge.unavailable || "no reading"})</small>
                  ) : (
                    <>
                      <span
                        className="field-gauge"
                        role="meter"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.min(100, Math.round(gauge.percent))}
                        aria-label={`${gauge.label} ${formatPercent(gauge.percent)} used`}
                      >
                        <i style={{ width: `${Math.min(100, Math.max(0, gauge.percent))}%` }} />
                        {gauge.key !== "d1StorageBytes" && typeof elapsed === "number" && (
                          <b style={{ left: `${Math.min(100, Math.max(0, elapsed))}%` }} />
                        )}
                      </span>
                      <small>{formatPercent(gauge.percent)}</small>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="owner-monitor-note">Plan usage unavailable; details below.</p>
          )}
          {typeof elapsed === "number" && gauges.length > 0 && (
            <p className="owner-monitor-note">
              The line marks {formatPercent(elapsed)} of the billing cycle elapsed; 80% or more of
              an allowance turns amber.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
