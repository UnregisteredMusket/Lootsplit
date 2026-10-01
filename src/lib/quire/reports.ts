import { getCloudWatch } from "./cloud-turn.ts";
import { APP_VERSION } from "./version.ts";

export type BugReport = {
  id: string;
  at: number;
  version: string;
  message: string;
  stack: string;
  source: "error" | "rejection" | "note";
  href: string;
  mode: string;
  role: string;
};

const KEY = "quire.reports.v1";
const MAX = 20;
let watching = false;

export function listReports(): BugReport[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]") as BugReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordReport(input: { message: string; stack?: string; source: BugReport["source"] }): BugReport {
  const report: BugReport = {
    id: crypto.randomUUID(),
    at: Date.now(),
    version: APP_VERSION,
    message: input.message.slice(0, 500),
    stack: (input.stack ?? "").slice(0, 4000),
    source: input.source,
    href: typeof location === "undefined" ? "" : location.href,
    mode: modeLabel(),
    role: roleLabel(),
  };
  const previous = listReports();
  const latest = previous[0];
  if (latest && latest.message === report.message && report.at - latest.at < 5000) return latest;
  const next = [report, ...previous].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
  return report;
}

export function watchCrashes() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("error", (event) => {
    recordReport({ message: event.message || "Script error", stack: event.error instanceof Error ? event.error.stack : "", source: "error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    recordReport({
      message: reason instanceof Error ? reason.message : "Unhandled rejection",
      stack: reason instanceof Error ? reason.stack : "",
      source: "rejection",
    });
  });
}

function modeLabel(): string {
  const watch = getCloudWatch();
  if (!watch.joined) return "Local Mode";
  return watch.live ? "Live Mode" : "Turn based Mode";
}

function roleLabel(): string {
  if (typeof window === "undefined") return "";
  try {
    const id = window.localStorage.getItem("quire.campaign.v1") || "main";
    const key = id === "main" ? "quire.seat.v1" : `quire.seat.v1.${id}`;
    const parsed = JSON.parse(window.localStorage.getItem(key) || "") as { role?: string };
    return parsed.role === "player" ? "player" : "dungeon master";
  } catch {
    return "";
  }
}
