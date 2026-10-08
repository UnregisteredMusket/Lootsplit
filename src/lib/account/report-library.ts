export type ReportFilters = { search: string; campaign: string; after: string; before: string };

function dayBoundary(value: string, nextDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return undefined;
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.getTime();
}

/** Filtering only the account-authorized records never changes their snapshots. */
export function filterAccountReports<
  T extends { code: string; campaign: string; name: string; at: number },
>(reports: T[], filters: ReportFilters) {
  const query = filters.search.trim().toLowerCase();
  const start = dayBoundary(filters.after),
    end = dayBoundary(filters.before, true);
  return reports.filter(
    (report) =>
      (filters.campaign === "all" || report.code === filters.campaign) &&
      `${report.campaign} ${report.name} ${report.code}`.toLowerCase().includes(query) &&
      (start === undefined || report.at >= start) &&
      (end === undefined || report.at < end),
  );
}
