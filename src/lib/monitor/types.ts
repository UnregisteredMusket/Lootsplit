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
  /** Registry entries retired for some or all of this day; listed instead of reported as gaps. */
  retiredLogs?: (MonitorRetiredSpan & { id: string; name: string })[];
  evidence?: MonitorEntry[];
  correlations?: { entry: string; related: string[]; statement: string }[];
};
export type JournalSnapshot = {
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
