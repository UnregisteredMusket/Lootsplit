export type Evidence = { label: string; url: string };
export type MonitorTask = {
  id: string;
  revision: number;
  title: string;
  objective: string;
  state: string;
  phase: string;
  progress: string;
  startedAt: number;
  heartbeatAt: number;
  progressAt: number;
  completedAt: number | null;
  expectedUntil: number | null;
  timings: Record<string, number>;
  unobservedMs: number;
  totalElapsedMs: number;
  active: boolean;
  blocker: string;
  nextAction: string;
  branch: string;
  commit: string;
  links: Evidence[];
};
export type MonitorDiagnostic = {
  component: string;
  color: string;
  state: string;
  symptom: string;
  impact: string;
  action: string;
  firstOccurredAt: number | null;
  latestCheckAt: number;
  lastSuccessAt: number | null;
  durationMs: number;
  errorCode: string | null;
  confirmedCause: string | null;
  suspectedCause: string | null;
  retainedFailure: boolean;
  /** false: a coverage limit that never decides the overall status (still listed). */
  required?: boolean;
  coverageLimit?: boolean;
  /** Short face text (no times) and the instant it refers to, formatted locally. */
  brief?: string;
  lastAt?: number | null;
};
export type MonitorEntry = {
  id: string;
  sequence: number;
  source: string;
  observedAt: number;
  collectedAt: number;
  summary: string;
  outcome?: string;
  evidence?: Evidence[];
  sources?: Record<string, { state: string; checkedAt: number | null; errorCode?: string }>;
  comparisons?: {
    key: string;
    label: string;
    previous: number | null;
    current: number | null;
    change: number | null;
    percent: number | null;
    unit: string;
    kind: string;
    windowMs: number | null;
    reason: string | null;
  }[];
};
export type MonitorSettings = {
  timezone: string;
  reportTime: string;
  heartbeatMs: number;
  progressMs: number;
  deviceFreshMs: number;
};
export type MonitorRetiredSpan = {
  retiredAt: number;
  retiredBy?: { id: string; name: string };
  reason?: string;
  reinstatedAt: number | null;
  reinstatedBy?: { id: string; name: string } | null;
};
export type MonitorReport = {
  id: string;
  day: string;
  timezone: string;
  generatedAt: number;
  summary: string;
  gaps: string[];
  recommendations: string[];
  /** Placeholder stored after repeated generation failures; contains no measurements. */
  failed?: boolean;
  /** Present when long lists were summarized to fit storage; totals are never reduced. */
  summarized?: {
    budgetBytes: number;
    sections: Record<string, { shown: number; total: number }>;
    note: string;
  };
  unresolved?: (MonitorDiagnostic & { entryId: string; asOf: number })[];
  trends?: {
    scheduledAt: number;
    collectedAt?: number;
    recovered?: boolean;
    comparisons: MonitorEntry["comparisons"];
  }[];
  development?: {
    task: MonitorTask;
    warning: { message: string; nextAction: string; blocker: string } | null;
  }[];
  coverage?: {
    id: string;
    name: string;
    mode: string;
    entries: number;
    gap: string | null;
    lastObservationAt: number | null;
    /** Retired spans overlapping this day; that time is not counted as missing data. */
    retiredSpans?: MonitorRetiredSpan[];
  }[];
  /** Workers Paid allowance use for the day; absent on reports generated before it existed. */
  cloudflareUsage?: {
    readings: number;
    available: number;
    latest: { observedAt: number; summary: string; usage: CloudflareUsage } | null;
    latestAttempt: { observedAt: number; state: string; errorCode: string | null } | null;
    lines: string[];
  };
  /** Registry entries retired for some or all of this day; listed instead of reported as gaps. */
  retiredLogs?: (MonitorRetiredSpan & { id: string; name: string })[];
  evidence?: MonitorEntry[];
  correlations?: { entry: string; related: string[]; statement: string }[];
};
/** One usage window: the value (null when unavailable), its allowance share and the percentage. */
export type UsagePart = { value: number | null; share: number; percent: number | null };
export type UsageMetric = {
  key: "requests" | "cpuMs" | "d1RowsRead" | "d1RowsWritten" | "d1StorageBytes";
  label: string;
  unit: "count" | "ms" | "bytes";
  state: "ready" | "unavailable";
  errorCode: string | null;
  /** ok, attention (billing cycle to date at or above 80% of the allowance), over, unavailable. */
  level: "ok" | "attention" | "over" | "unavailable";
  monthlyAllowance?: number;
  day?: UsagePart;
  week?: UsagePart;
  month?: UsagePart;
  allowance?: number;
  current?: { value: number | null; allowance: number; percent: number | null };
  databases?: number | null;
};
/** Hourly Cloudflare plan usage against the Workers Paid included allowance (account-wide, UTC). */
export type CloudflareUsage = {
  state: "ready" | "unavailable" | "not-connected";
  checkedAt: number | null;
  errorCode?: string | null;
  data: {
    scope: "account";
    plan: string;
    allowancesVerifiedOn: string;
    sources: string[];
    windows: {
      timezone: "UTC";
      end: number;
      day: { start: number; end: number };
      week: { start: number; end: number; days: number };
      /** The current billing cycle so far (from the renewal day); older readings lack basis/label. */
      month: {
        start: number;
        end: number;
        days: number;
        elapsedPercent: number;
        basis?: "billing-cycle";
        renewalDay?: number;
        resetsAt?: number;
        label?: string;
      };
    };
    metrics: UsageMetric[];
    complete: boolean;
  } | null;
};
export type JournalSnapshot = {
  /** Newest hourly Cloudflare plan usage reading; older servers omit it. */
  usage?: CloudflareUsage;
  schemaVersion?: number;
  snapshotId?: number;
  checkedAt: number;
  servedAt?: number;
  overall?: {
    color: string;
    label: string;
    reason: string;
    /** healthy | attention (recent, not current) | unverified | failure; absent on older snapshots. */
    status?: string;
    /** Coverage limits named for information; they never decide the status. */
    notes?: string[];
  };
  diagnostics?: MonitorDiagnostic[];
  developmentStatus?: {
    task: MonitorTask | null;
    label: string;
    warning: {
      kind: string;
      message: string;
      progressAt: number;
      heartbeatAt: number;
      nextAction: string;
      blocker: string;
    } | null;
  };
  monitoring?: {
    scheduledAt: number;
    collectedAt: number | null;
    outcome: string;
    summary: string;
    comparisons?: MonitorEntry["comparisons"];
  } | null;
  dailyReport?: MonitorReport | null;
  recentEntries?: MonitorEntry[];
  settings?: MonitorSettings;
  devices?: {
    id: string;
    lastReportedAt: number;
    snapshotId: number;
    version: string;
    delivery: string;
  }[];
};
export const duration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
};
export const dated = (at: number | null | undefined) =>
  at ? new Date(at).toLocaleString() : "Unavailable";
