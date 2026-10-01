import { listReports, recordReport } from "./reports.ts";
import { APP_VERSION } from "./version.ts";

export async function downloadBugReport(note?: string): Promise<boolean> {
  if (note?.trim()) recordReport({ message: note.trim(), source: "note" });
  const { downloadJson } = await import("./table.ts");
  return downloadJson(`lootsplit-diagnostics-${Date.now()}.json`, {
    version: APP_VERSION,
    exportedAt: Date.now(),
    reports: listReports()
      .slice(-30)
      .map((report) => ({ ...report, href: report.href.split(/[?#]/)[0] })),
  });
}
