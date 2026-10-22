import {
  encodeRoomImages,
  encodedRoomBytes,
  hydrateRoomImages,
  roomImageStatements,
  ROOM_BODY_LIMIT,
  ROOM_IMAGE_SOURCES,
} from "../../../cloudflare/room-images.mjs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { CloudRoom } from "./cloud.ts";
import { ensureCityExchanges } from "./city-exchanges.ts";

type Result = { meta: { changes: number } };
type Statement = {
  all: <T = any>() => Promise<{ results: T[] }>;
  bind: (...values: unknown[]) => Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<Result>;
};
type Database = {
  prepare: (sql: string) => Statement;
  batch: (statements: Statement[]) => Promise<Result[]>;
};
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
const STORED_BODY = Symbol("authoritative-room-body");
/** Internal, per-read SQL guard; never serialized or returned as campaign data. */
export function roomStorageBody(room: CloudRoom): string {
  return (room as CloudRoom & { [STORED_BODY]?: string })[STORED_BODY] ?? JSON.stringify(room);
}
/**
 * Derived views of a read room (for example `{ ...room, drafts }`) must keep the authoritative
 * stored body: object spread drops this non-enumerable property, and a guard would otherwise
 * compare against the hydrated JSON (with inline images/resources) and never match.
 */
export function keepStoredBody<T extends CloudRoom>(source: CloudRoom, derived: T): T {
  const stored = (source as CloudRoom & { [STORED_BODY]?: string })[STORED_BODY];
  if (stored !== undefined) Object.defineProperty(derived, STORED_BODY, { value: stored });
  const sources = roomImageSources(source);
  if (sources.size)
    Object.defineProperty(derived, ROOM_IMAGE_SOURCES, { value: sources, configurable: true });
  return derived;
}
/**
 * Reference -> inline image for the map images this read restored from the room's own
 * `campaign_room_images` rows (empty for local rooms and rooms without stored images). Used only
 * to send tabletop protocol 4 clients references instead of rasters; never stored or compared.
 */
export function roomImageSources(room: CloudRoom): Map<string, string> {
  return (room as CloudRoom & { [ROOM_IMAGE_SOURCES]?: Map<string, string> })[ROOM_IMAGE_SOURCES] ?? new Map();
}
export type RoomAccess = Pick<CloudRoom, "code" | "revision" | "ownerId" | "sessionId" | "closed" | "seats">;
/** Read authorization/revision only, without private campaign/media hydration. */
export async function readRoomAccess(code: string): Promise<RoomAccess | null> {
  const canonicalCode = code.trim().toUpperCase(), db = database();
  if (!db) {
    const room = (await localRooms()).find((r) => r.code === canonicalCode);
    if (!room) return null;
    const { revision, ownerId, sessionId, closed, seats } = room;
    return { code: canonicalCode, revision, ownerId, sessionId, closed, seats };
  }
  const row = await db.prepare(
    "SELECT revision,json_extract(body,'$.ownerId') AS ownerId,json_extract(body,'$.sessionId') AS sessionId,json_extract(body,'$.closed') AS closed,json_extract(body,'$.seats') AS seats FROM campaign_rooms WHERE code=?",
  ).bind(canonicalCode).first<{ revision: number; ownerId: string | null; sessionId: string | null; closed: number | null; seats: string }>();
  if (!row) return null;
  const seats: unknown = JSON.parse(row.seats);
  if (!Array.isArray(seats)) throw Error("The shared campaign's seat records are incomplete.");
  return { code: canonicalCode, revision: row.revision, ownerId: row.ownerId ?? undefined,
    sessionId: row.sessionId ?? undefined, closed: row.closed === 1, seats: seats as RoomAccess["seats"] };
}
const FILE = path.join(process.cwd(), "data", "cloud-rooms.json");
let localWrites: Promise<unknown> = Promise.resolve();
function localWrite<T>(work: () => Promise<T>): Promise<T> {
  const next = localWrites.then(async () => {
    await mkdir(path.dirname(FILE), { recursive: true });
    let lock;
    try {
      lock = await open(FILE + ".lock", "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw Error(
          "The local room store is locked by another process. Retry after it finishes. If that process stopped unexpectedly, close all local servers before removing data/cloud-rooms.json.lock; campaign data remains in cloud-rooms.json.",
        );
      throw error;
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid }));
      return await work();
    } finally {
      await lock.close();
      await unlink(FILE + ".lock");
    }
  });
  localWrites = next.catch(() => undefined);
  return next;
}
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
    if (!Array.isArray(rooms))
      throw Error(
        "The local room store is invalid. Restore its recovery copy before saving changes.",
      );
    return rooms;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function localSave(rooms: CloudRoom[]): Promise<void> {
  // Readers see the previous or next complete file, never a partially written
  // snapshot. Abandoned temporary files after a crash do not replace campaigns.
  const temporary = FILE + "." + crypto.randomUUID() + ".tmp";
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(JSON.stringify(rooms));
    await handle.sync();
    await handle.close();
    await rename(temporary, FILE);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
export type ReadRoomOptions = {
  /**
   * Tabletop protocol 4 read-only views: keep the current maps' stored image references instead
   * of reading their rasters. Never pass this for a read that may be written back, exported,
   * backed up or compared; those always need the fully hydrated room.
   */
  mapImageReferences?: boolean;
};
export async function readRoom(code: string, options: ReadRoomOptions = {}): Promise<CloudRoom | null> {
  const db = database();
  if (db) {
    const row = await db
      .prepare("SELECT body FROM campaign_rooms WHERE code = ?")
      .bind(code)
      .first<{ body: string }>();
    if (!row) return null;
    const { hydrateCampaignCharacters } =
      await import("../../../cloudflare/campaign-characters.mjs");
    const parsed = JSON.parse(row.body) as CloudRoom, revision = parsed.revision;
    const room = await hydrateCampaignCharacters(db, parsed);
    const stored = room.revision === revision ? row.body : JSON.stringify(room);
    const hydrated = await hydrateRoomImages(db, room.code, room, {
      keepMapImageReferences: options.mapImageReferences === true,
    });
    Object.defineProperty(hydrated, STORED_BODY, { value: stored });
    ensureCityExchanges(hydrated.table);
    return hydrated;
  }
  const room = (await localRooms()).find((room) => room.code === code) ?? null;
  if (room) ensureCityExchanges(room.table);
  return room;
}
/**
 * D1 rejects rows above 2,000,000 bytes with an opaque error. Room bodies (after images, resource
 * packs and archived session snapshots move to their own tables) and each archived snapshot row are
 * refused below that with a clear message, and the refusal is logged to the owner monitor
 * (`room-storage`, registered in BUILTIN_LOGS). The stored campaign is never changed by a refusal.
 */
export { ROOM_BODY_LIMIT };
type Encoded = Awaited<ReturnType<typeof encodeRoomImages>>;
const utf8 = (text: string) => new TextEncoder().encode(text).length;
async function guardRoomSize(db: Database, room: CloudRoom, encoded: Encoded) {
  const { bytes, largestReport } = encodedRoomBytes(encoded);
  if (bytes <= ROOM_BODY_LIMIT && largestReport <= ROOM_BODY_LIMIT) return;
  const now = Date.now();
  try {
    const stored = JSON.parse(encoded.body) as CloudRoom;
    const size = (value: unknown) => (value === undefined ? 0 : utf8(JSON.stringify(value)));
    const { initializeMonitor, recordLog } = await import("../../../cloudflare/monitor-journal.mjs");
    // Log rows reference the registry; a refusal before the first collection after a deploy
    // must still be recorded, so the built-in sources are registered first (idempotent).
    await initializeMonitor(db, now);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(room.code));
    // A one-way room tag correlates repeated refusals without storing the join code.
    const tag = Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
    await recordLog(
      db,
      {
        id: `room-storage:${tag}:${Math.floor(now / 1_800_000)}`,
        source: "room-storage",
        observedAt: now,
        summary: `A shared room write was refused before reaching D1: ${bytes} bytes (largest archived snapshot ${largestReport} bytes) exceeds the ${ROOM_BODY_LIMIT}-byte budget. The stored campaign was not changed. Later refusals for this room in the same half-hour share this entry.`,
        room: tag,
        revision: room.revision,
        bytes,
        largestReport,
        limit: ROOM_BODY_LIMIT,
        parts: {
          notes: size(stored.table?.notes),
          ledger: size(stored.table?.ledger),
          purses: size(stored.table?.purses),
          holdings: size(stored.table?.holdings),
          journal: size(stored.table?.journal),
          reportReferences: size(stored.table?.journal?.reports),
          receipts:
            size(stored.commands) + size(stored.commandHashes) + size(stored.batches) + size(stored.batchHashes),
          drafts: size(stored.drafts),
        },
      },
      now,
    );
  } catch (error) {
    console.warn("The room size refusal could not be logged to monitoring.", error);
  }
  throw Object.assign(
    Error(
      `This campaign is too large to save online (${(Math.max(bytes, largestReport) / 1e6).toFixed(2)} MB; the limit is ${(ROOM_BODY_LIMIT / 1e6).toFixed(1)} MB). Nothing was changed and pending actions are preserved. The DM can end the session to archive the current messages and ledger, or export the campaign.`,
    ),
    { status: 413 },
  );
}
export async function createRoom(room: CloudRoom): Promise<void> {
  ensureCityExchanges(room.table);
  const db = database();
  if (db) {
    const encoded = await encodeRoomImages(room);
    await guardRoomSize(db, room, encoded);
    const insert = db
      .prepare("INSERT INTO campaign_rooms (code, revision, body) VALUES (?, ?, ?)")
      .bind(room.code, room.revision, encoded.body);
    const members = [...await roomImageStatements(db, room, encoded), ...accountSeats(db, room, encoded.body)];
    if (members.length) await db.batch([insert, ...members]);
    else await insert.run();
    return;
  }
  await localWrite(async () => {
    const rooms = await localRooms();
    if (rooms.some((item) => item.code === room.code))
      throw new Error("That table code is already used. Try again.");
    await localSave([...rooms, room]);
  });
}
export async function updateRoom(room: CloudRoom, baseRevision: number): Promise<void> {
  const db = database();
  if (db) {
    const encoded = await encodeRoomImages(room);
    await guardRoomSize(db, room, encoded);
    const update = db
      .prepare("UPDATE campaign_rooms SET revision = ?, body = ? WHERE code = ? AND revision = ?")
      .bind(room.revision, encoded.body, room.code, baseRevision);
    const members = [...await roomImageStatements(db, room, encoded), ...accountSeats(db, room, encoded.body)];
    const result = members.length ? (await db.batch([update, ...members]))[0]! : await update.run();
    if (!result.meta.changes)
      throw new Error("The table changed. Refresh before sending your turn.");
    return;
  }
  await localWrite(async () => {
    const rooms = await localRooms();
    const current = rooms.find((item) => item.code === room.code);
    if (!current || current.revision !== baseRevision)
      throw new Error("The table changed. Refresh before sending your turn.");
    await localSave(rooms.map((item) => (item.code === room.code ? room : item)));
  });
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
  await localWrite(async () => {
    const rooms = await localRooms();
    if (rooms.find((room) => room.code === code)?.revision !== baseRevision)
      throw Error("The table changed. Refresh before closing it.");
    await localSave(rooms.filter((room) => room.code !== code));
  });
}

function accountSeats(db: Database, room: CloudRoom, body: string): Statement[] {
  return room.seats
    .filter((s) => s.userId)
    .map((s) =>
      db
        .prepare(
          "INSERT INTO library_members (user_id,code,seat_id,token,name,archived,updated_at) SELECT ?,?,?,?,?,0,? WHERE EXISTS (SELECT 1 FROM campaign_rooms WHERE code=? AND body=?) ON CONFLICT(user_id,code) DO UPDATE SET seat_id=excluded.seat_id,token=excluded.token,updated_at=excluded.updated_at WHERE library_members.seat_id<>excluded.seat_id OR library_members.token<>excluded.token",
        )
        .bind(
          s.userId,
          room.code,
          s.id,
          s.token,
          "Campaign",
          Date.now(),
          room.code,
          body,
        ),
    );
}
