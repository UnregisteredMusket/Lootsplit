import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { callTool } from "../app-data/client.server.ts";
import { ConnectorType, GoogleDriveTools } from "../app-data/types.ts";
import { driveFileId, driveFiles, driveName, type DriveKind } from "./drive.ts";

const FOLDER = "Lootsplit";
const CHILDREN: Record<DriveKind, string> = { backup: "Backups", save: "Saves", report: "Reports" };
const ids = new Map<string, string>();

export async function driveStatus(): Promise<{ connected: boolean; loginUrl?: string; error?: string }> {
  const found = await callTool(GoogleDriveTools.search, { exact_name: FOLDER, mime_type_filter: "application/vnd.google-apps.folder", max_results: 1 }, { connectorType: ConnectorType.GoogleDrive });
  if (found.loginRequired) return { connected: false, loginUrl: found.loginUrl };
  if (!found.ok) return { connected: false, error: friendly(found.errorMessage) };
  return { connected: true };
}

export async function putDriveFile(input: { kind: DriveKind; name: string; body: string }): Promise<{ name: string; files: string[] }> {
  if (input.body.length > 1_500_000) throw new Error("That file is too large for Google Drive from this app.");
  const folderId = await folder(CHILDREN[input.kind], await folder(FOLDER));
  const name = driveName(input.kind, input.name);
  const relative = path.posix.join("/lootsplit", name);
  await mkdir(path.join(process.cwd(), "artifacts", "lootsplit"), { recursive: true });
  await writeFile(path.join(process.cwd(), "artifacts", "lootsplit", name), input.body);
  const uploaded = await callTool(
    "google_drive_upload_artifact",
    { artifact_path: relative, file_name: name, folder_id: folderId, mime_type: "application/json" },
    { connectorType: ConnectorType.GoogleDrive },
  );
  if (uploaded.loginRequired) throw new Error("Connect Google Drive first.");
  if (!uploaded.ok) throw new Error(friendly(uploaded.errorMessage));
  const listed = await callTool(GoogleDriveTools.search, { folder_id: folderId, max_results: 8 }, { connectorType: ConnectorType.GoogleDrive });
  return { name, files: listed.ok ? driveFiles(listed.data).map((item) => item.name) : [name] };
}

async function folder(name: string, parent?: string): Promise<string> {
  const cache = `${parent ?? "root"}:${name}`;
  const known = ids.get(cache);
  if (known) return known;
  const found = await callTool(
    GoogleDriveTools.search,
    { exact_name: name, mime_type_filter: "application/vnd.google-apps.folder", folder_id: parent, max_results: 5 },
    { connectorType: ConnectorType.GoogleDrive },
  );
  if (found.loginRequired) throw new Error("Connect Google Drive first.");
  if (!found.ok) throw new Error(friendly(found.errorMessage));
  const existing = driveFiles(found.data).find((item) => item.name === name);
  if (existing) {
    ids.set(cache, existing.id);
    return existing.id;
  }
  const created = await callTool(GoogleDriveTools.createFolder, { folder_name: name, parent_folder_id: parent }, { connectorType: ConnectorType.GoogleDrive });
  if (!created.ok) throw new Error(friendly(created.errorMessage));
  const id = driveFileId(created.data);
  if (!id) throw new Error("Google Drive did not return a folder.");
  ids.set(cache, id);
  return id;
}

function friendly(message: string | undefined): string {
  if (!message) return "Google Drive could not be reached.";
  if (message.includes("cannot resolve gate host") || message.includes("gated public URL")) {
    return "Google Drive connects from the published app, not this local preview.";
  }
  return message;
}
