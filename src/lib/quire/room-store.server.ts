import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CloudRoom } from "./cloud.ts";

type Result = { meta: { changes: number } };
type Statement = {
  all: <T = any>() => Promise<{ results: T[] }>;
  bind: (...values: unknown[]) => Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<Result>;
};
type Database = { prepare: (sql: string) => Statement; batch: (statements: Statement[]) => Promise<Result[]> };
export function database(): Database | undefined {
  const env = (globalThis as typeof globalThis & { __env__?: { DB?: Database; ASSETS?: unknown } })
    .__env__;
  if (env?.DB) return env.DB;
  if (env && "ASSETS" in env) {
    throw new Error(
      "Shared tables need a D1 database bound as DB. This deployment does not store rooms in Worker memory or local files.",
    );
  }
  return undefined;
}
const FILE = path.join(process.cwd(), "data", "cloud-rooms.json");
export async function manualCharacterRolls(code: string) {
  const db = database();
  if (!db) return false;
  return !!(
    await db
      .prepare("SELECT manual_allowed FROM play_policies WHERE code=?")
      .bind(code)
      .first<{ manual_allowed: number }>()
  )?.manual_allowed;
}
async function localRooms(): Promise<CloudRoom[]> {
  try {
    const rooms: unknown = JSON.parse(await readFile(FILE, "utf8"));
    return Array.isArray(rooms) ? rooms : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function localSave(rooms: CloudRoom[]): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(rooms));
}
export async function readRoom(code: string): Promise<CloudRoom | null> {
  const db = database();
  if (db) {
    const row = await db
      .prepare("SELECT body FROM campaign_rooms WHERE code = ?")
      .bind(code)
      .first<{ body: string }>();
    if (!row) return null;
    const { hydrateCampaignCharacters } =
      await import("../../../cloudflare/campaign-characters.mjs");
    return hydrateCampaignCharacters(db, JSON.parse(row.body) as CloudRoom);
  }
  return (await localRooms()).find((room) => room.code === code) ?? null;
}
export async function createRoom(room: CloudRoom): Promise<void> {
  const db = database();
  if (db) {
    const insert = db.prepare("INSERT INTO campaign_rooms (code, revision, body) VALUES (?, ?, ?)").bind(room.code, room.revision, JSON.stringify(room));
    const members = accountSeats(db, room);
    if (members.length) await db.batch([insert, ...members]);
    else await insert.run();
    return;
  }
  const rooms = await localRooms();
  if (rooms.some((item) => item.code === room.code))
    throw new Error("That table code is already used. Try again.");
  await localSave([...rooms, room]);
}
export async function updateRoom(room: CloudRoom, baseRevision: number): Promise<void> {
  const db = database();
  if (db) {
    const update = db.prepare("UPDATE campaign_rooms SET revision = ?, body = ? WHERE code = ? AND revision = ?")
      .bind(room.revision, JSON.stringify(room), room.code, baseRevision);
    const members = accountSeats(db, room);
    const result = members.length ? (await db.batch([update, ...members]))[0]! : await update.run();
    if (!result.meta.changes)
      throw new Error("The table changed. Refresh before sending your turn.");
    return;
  }
  const rooms = await localRooms();
  const current = rooms.find((item) => item.code === room.code);
  if (!current || current.revision !== baseRevision)
    throw new Error("The table changed. Refresh before sending your turn.");
  await localSave(rooms.map((item) => (item.code === room.code ? room : item)));
}
export async function deleteRoom(code: string, baseRevision: number): Promise<void> {
  const db = database();
  if (db) {
    const result = await db
      .prepare("DELETE FROM campaign_rooms WHERE code = ? AND revision = ?")
      .bind(code, baseRevision)
      .run();
    if (!result.meta.changes) throw new Error("The table changed. Refresh before closing it.");
    return;
  }
  await localSave((await localRooms()).filter((room) => room.code !== code));
}

function accountSeats(db: Database, room: CloudRoom): Statement[] {
  return room.seats.filter(s => s.userId).map(s => db.prepare(
    "INSERT INTO library_members (user_id,code,seat_id,token,name,archived,updated_at) SELECT ?,?,?,?,?,0,? WHERE EXISTS (SELECT 1 FROM campaign_rooms WHERE code=? AND body=?) ON CONFLICT(user_id,code) DO UPDATE SET seat_id=excluded.seat_id,token=excluded.token,updated_at=excluded.updated_at WHERE library_members.seat_id<>excluded.seat_id OR library_members.token<>excluded.token"
  ).bind(s.userId, room.code, s.id, s.token, "Campaign", Date.now(), room.code, JSON.stringify(room)));
}
