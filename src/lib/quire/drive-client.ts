import { checkDrive, uploadDriveFile } from "./drive-api.ts";
import type { DriveKind } from "./drive.ts";
import { listReports, recordReport } from "./reports.ts";
import { APP_VERSION } from "./version.ts";

const SAVES = "quire.drive.saves.v1";

export function driveCopiesSaves(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(SAVES) === "on";
}

export function setDriveCopiesSaves(on: boolean) {
  localStorage.setItem(SAVES, on ? "on" : "off");
}

export async function askDrive(): Promise<{ connected: boolean; loginUrl?: string; error?: string }> {
  return checkDrive();
}

export async function sendToDrive(kind: DriveKind, name: string, body: string): Promise<{ name: string; files: string[] }> {
  const status = await checkDrive();
  if (!status.connected) throw new Error(status.error || "Google Drive is not connected. Open the published app and check Google Drive before copying.");
  return uploadDriveFile({ data: { kind, name, body } });
}

export async function sendBugReport(note?: string): Promise<void> {
  if (note?.trim()) recordReport({ message: note.trim(), source: "note" });
  const reports = listReports();
  if (reports.length === 0) throw new Error("There is no bug report to send yet.");
  await sendToDrive("report", `v${APP_VERSION}`, JSON.stringify({ version: APP_VERSION, reports: reports.slice(0, 8) }));
}
