export type DriveKind = "backup" | "save" | "report";

export function driveFiles(data: unknown): { id: string; name: string }[] {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? ((data as { files?: unknown; results?: unknown; items?: unknown }).files ??
        (data as { results?: unknown }).results ??
        (data as { items?: unknown }).items)
      : [];
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { file_id?: unknown; id?: unknown; folder_id?: unknown; name?: unknown; title?: unknown };
      const id = String(row.file_id ?? row.id ?? row.folder_id ?? "");
      if (!id) return null;
      return { id, name: String(row.name ?? row.title ?? "") };
    })
    .filter((row): row is { id: string; name: string } => row !== null);
}

export function driveFileId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const row = data as { file_id?: unknown; id?: unknown; folder_id?: unknown };
  const id = String(row.file_id ?? row.id ?? row.folder_id ?? "");
  if (id) return id;
  return driveFiles(data)[0]?.id ?? null;
}

export function driveName(kind: DriveKind, name: string): string {
  const clean = name.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || kind;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `${kind}-${clean}-${stamp}.json`;
}
