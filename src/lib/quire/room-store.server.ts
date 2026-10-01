import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CloudRoom } from "./cloud.ts";

type Result = { meta: { changes: number } };
type Statement = { bind: (...values: unknown[]) => Statement; first: <T>() => Promise<T | null>; run: () => Promise<Result> };
type Database = { prepare: (sql: string) => Statement };
function database(): Database | undefined {
  const env = (globalThis as typeof globalThis & { __env__?: { DB?: Database; ASSETS?: unknown } }).__env__;
  if (env?.DB) return env.DB;
  if (env && "ASSETS" in env) {
    throw new Error("Shared tables need a D1 database bound as DB. This deployment does not store rooms in Worker memory or local files.");
  }
  return undefined;
}
const FILE = path.join(process.cwd(), "data", "cloud-rooms.json");
async function localRooms(): Promise<CloudRoom[]> {
  try { const rooms: unknown = JSON.parse(await readFile(FILE, "utf8")); return Array.isArray(rooms) ? rooms : []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
async function localSave(rooms: CloudRoom[]): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(rooms));
}
export async function readRoom(code: string): Promise<CloudRoom | null> {
  const db = database();
  if (db) {
    const row = await db.prepare("SELECT body FROM campaign_rooms WHERE code = ?").bind(code).first<{ body: string }>();
    return row ? JSON.parse(row.body) as CloudRoom : null;
  }
  return (await localRooms()).find((room) => room.code === code) ?? null;
}
export async function createRoom(room: CloudRoom): Promise<void> {
  const db = database();
  if (db) { await db.prepare("INSERT INTO campaign_rooms (code, revision, body) VALUES (?, ?, ?)").bind(room.code, room.revision, JSON.stringify(room)).run(); return; }
  const rooms = await localRooms();
  if (rooms.some((item) => item.code === room.code)) throw new Error("That table code is already used. Try again.");
  await localSave([...rooms, room]);
}
export async function updateRoom(room: CloudRoom, baseRevision: number): Promise<void> {
  const db = database();
  if (db) {
    const result = await db.prepare("UPDATE campaign_rooms SET revision = ?, body = ? WHERE code = ? AND revision = ?").bind(room.revision, JSON.stringify(room), room.code, baseRevision).run();
    if (!result.meta.changes) throw new Error("The table changed. Refresh before sending your turn.");
    return;
  }
  const rooms = await localRooms();
  const current = rooms.find((item) => item.code === room.code);
  if (!current || current.revision !== baseRevision) throw new Error("The table changed. Refresh before sending your turn.");
  await localSave(rooms.map((item) => item.code === room.code ? room : item));
}
export async function deleteRoom(code: string, baseRevision: number): Promise<void> {
  const db = database();
  if (db) {
    const result = await db.prepare("DELETE FROM campaign_rooms WHERE code = ? AND revision = ?").bind(code, baseRevision).run();
    if (!result.meta.changes) throw new Error("The table changed. Refresh before closing it.");
    return;
  }
  await localSave((await localRooms()).filter((room) => room.code !== code));
}
