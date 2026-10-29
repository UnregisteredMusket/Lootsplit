import {
  encodeRoomImages,
  encodedRoomBytes,
  hydrateRoomImages,
  roomImageStatements,
  ROOM_BODY_LIMIT,
  ROOM_ROW_LIMIT,
  ROOM_IMAGE_SOURCES,
} from "../../../cloudflare/room-images.mjs";
import {
  readRoomSectionHashes,
  readStoredRoom,
  readStoredRoomWithCombatEncounter,
  roomBodySectioned,
  roomCommittedSql,
  roomDeleteStatement,
  roomSectionsDeletedStatement,
  roomStorageSizes,
  roomWriteStatements,
} from "../../../cloudflare/room-storage.mjs";
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
const READ_VERSION = Symbol("room-read-version");
/**
 * The storage version (revision and `write_id`) a room was read at, or `null` for a derived or
 * local room. Internal and non-enumerable; used only to key the per-seat projected section cache
 * (view-sections.server.ts), never serialized or used as a write guard.
 */
export function roomReadVersion(room: CloudRoom): { revision: number; writeId: string | null } | null {
  return (room as CloudRoom & { [READ_VERSION]?: { revision: number; writeId: string | null } })[READ_VERSION] ?? null;
}
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
  // The descriptor, not the value: a sectioned room's body is assembled only if someone asks.
  const stored = Object.getOwnPropertyDescriptor(source, STORED_BODY);
  if (stored) Object.defineProperty(derived, STORED_BODY, stored);
  const version = Object.getOwnPropertyDescriptor(source, READ_VERSION);
  if (version) Object.defineProperty(derived, READ_VERSION, version);
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
export type RoomAccess = Pick<CloudRoom, "code" | "revision" | "ownerId" | "sessionId" | "closed" | "seats"> & {
  /** The row's write_id (D1 only): with the revision, identifies one written room. */
  writeId?: string | null;
};
/** Read authorization/revision only, without private campaign/media hydration. */
export async function readRoomAccess(code: string): Promise<RoomAccess | null> {
  const canonicalCode = code.trim().toUpperCase(), db = database();
  if (!db) {
    const room = (await localRooms()).find((r) => r.code === canonicalCode);
    if (!room) return null;
    const { revision, ownerId, sessionId, closed, seats } = room;
    return { code: canonicalCode, revision, ownerId, sessionId, closed, seats };
  }
  // Top-level fields only (they stay on the room row in sectioned storage).
  const row = await db.prepare(
    "SELECT revision,write_id AS writeId,json_extract(body,'$.ownerId') AS ownerId,json_extract(body,'$.sessionId') AS sessionId,json_extract(body,'$.closed') AS closed,json_extract(body,'$.seats') AS seats FROM campaign_rooms WHERE code=?",
  ).bind(canonicalCode).first<{ revision: number; writeId: string | null; ownerId: string | null; sessionId: string | null; closed: number | null; seats: string }>();
  if (!row) return null;
  const seats: unknown = JSON.parse(row.seats);
  if (!Array.isArray(seats)) throw Error("The shared campaign's seat records are incomplete.");
  return { code: canonicalCode, revision: row.revision, writeId: row.writeId, ownerId: row.ownerId ?? undefined,
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
    const read = await readStoredRoom(db, code);
    if (!read) return null;
    const { hydrateCampaignCharacters } =
      await import("../../../cloudflare/campaign-characters.mjs");
    const parsed = read.room as CloudRoom, revision = parsed.revision;
    const room = await hydrateCampaignCharacters(db, parsed);
    const upgraded = room.revision === revision ? undefined : JSON.stringify(room);
    const hydrated = await hydrateRoomImages(db, room.code, room, {
      keepMapImageReferences: options.mapImageReferences === true,
    });
    // Lazy: a sectioned room's exact body is only assembled if a caller asks for it.
    Object.defineProperty(hydrated, STORED_BODY, { get: () => upgraded ?? read.body });
    // A read that upgraded the room (campaign characters) is not the stored version.
    if (!upgraded)
      Object.defineProperty(hydrated, READ_VERSION, {
        value: { revision: read.version.revision, writeId: read.version.writeId },
      });
    ensureCityExchanges(hydrated.table);
    return hydrated;
  }
  const room = (await localRooms()).find((room) => room.code === code) ?? null;
  if (room) ensureCityExchanges(room.table);
  return room;
}
export type CombatViewRead = {
  room: CloudRoom;
  /** The bound encounter's row in this campaign, read consistently with the room. */
  encounter: { body: string; status: string } | null;
};
/**
 * Read-only room for the map combat views (`mapCombatOrder`, `mapCombatPresentation`; audit
 * 2026-10-28 F8). The room and the encounter its combat binding names come from one consistent
 * state (one statement for an inline room; room-storage.mjs `readStoredRoomWithCombatEncounter`),
 * so seats, binding, scene and encounter agree. Archived reports
 * are left out (the combat views never project them) and the current maps' image references stay
 * references, so no map rasters or report snapshots are read. Never write this room back,
 * export it or use it as a guard.
 */
export async function readCombatView(code: string): Promise<CombatViewRead | null> {
  const db = database();
  if (!db) {
    const room = await readRoom(code);
    return room ? { room, encounter: null } : null;
  }
  const read = await readStoredRoomWithCombatEncounter(db, code);
  if (!read) return null;
  const parsed = read.stored.room as CloudRoom;
  if (parsed.table?.journal) parsed.table.journal.reports = [];
  const { hydrateCampaignCharacters } =
    await import("../../../cloudflare/campaign-characters.mjs");
  const room = await hydrateRoomImages(db, parsed.code, await hydrateCampaignCharacters(db, parsed), {
    keepMapImageReferences: true,
  });
  ensureCityExchanges(room.table);
  return { room, encounter: read.encounter };
}
/**
 * A room write above the campaign cap (`ROOM_BODY_LIMIT`, the assembled stored room after images,
 * resource packs and archived session snapshots move to their own tables), or one that would store
 * a single row above `ROOM_ROW_LIMIT` (an archived snapshot, or a sectioned room's own row; D1
 * rejects rows above 2,000,000 bytes with an opaque error), is refused with a clear message and
 * logged to the owner monitor (`room-storage`, registered in BUILTIN_LOGS). The stored campaign is
 * never changed by a refusal. Limits: src/lib/quire/room-size.ts.
 */
export { ROOM_BODY_LIMIT, ROOM_ROW_LIMIT };
type Encoded = Awaited<ReturnType<typeof encodeRoomImages>>;
const utf8 = (text: string) => new TextEncoder().encode(text).length;
async function guardRoomSize(db: Database, room: CloudRoom, encoded: Encoded) {
  const { bytes, largestReport } = encodedRoomBytes(encoded);
  // Only a room above the inline threshold has a separate row size (sectioned storage).
  const storage = bytes <= ROOM_ROW_LIMIT ? null : roomStorageSizes(encoded.body);
  const rowBytes = storage?.rowBytes ?? bytes;
  if (bytes <= ROOM_BODY_LIMIT && largestReport <= ROOM_ROW_LIMIT && rowBytes <= ROOM_ROW_LIMIT) return;
  const now = Date.now();
  try {
    // `bytes` is the assembled stored room (the logical cap); `storage` is what the row and its
    // sections would hold (sectioned storage, step 2b).
    const sizes = storage ?? roomStorageSizes(encoded.body);
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
        summary: `A shared room write was refused before reaching D1: ${bytes} bytes (largest archived snapshot ${largestReport} bytes, room row ${rowBytes} bytes) exceeds the ${ROOM_BODY_LIMIT}-byte campaign budget or the ${ROOM_ROW_LIMIT}-byte row budget. The stored campaign was not changed. Later refusals for this room in the same half-hour share this entry.`,
        room: tag,
        revision: room.revision,
        bytes,
        largestReport,
        limit: ROOM_BODY_LIMIT,
        rowLimit: ROOM_ROW_LIMIT,
        storage: {
          sectioned: sizes.sectioned,
          rowBytes: sizes.rowBytes,
          sectionBytes: sizes.sectionBytes,
          sections: sizes.sections,
        },
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
      bytes > ROOM_BODY_LIMIT
        ? `This campaign is too large to save online (${(bytes / 1e6).toFixed(2)} MB; the limit is ${(ROOM_BODY_LIMIT / 1e6).toFixed(1)} MB). Nothing was changed and pending actions are preserved. The DM can end the session to archive the current messages and ledger, or export the campaign.`
        : `Part of this campaign is too large to save online (${(Math.max(largestReport, rowBytes) / 1e6).toFixed(2)} MB in one piece; the limit is ${(ROOM_ROW_LIMIT / 1e6).toFixed(1)} MB). Nothing was changed and pending actions are preserved. The DM can end the session to archive the current messages and ledger, or export the campaign.`,
    ),
    { status: 413 },
  );
}
/**
 * `hostLimit` (set by every account hosting path) makes the insert itself conditional on the
 * online campaign limit (cloudflare/hosted-campaigns.mjs), so concurrent opens cannot both pass.
 */
export async function createRoom(
  room: CloudRoom,
  options: { hostLimit?: { userId: string; limit: number; path: string } } = {},
): Promise<void> {
  ensureCityExchanges(room.table);
  const db = database();
  const host = options.hostLimit;
  if (db) {
    const hosting = host ? await import("../../../cloudflare/hosted-campaigns.mjs") : null;
    // Friendly pre-check: refuses before encoding images or writing anything.
    if (host && hosting) await hosting.assertCanHost(db, host.userId, host.path, host.limit);
    const encoded = await encodeRoomImages(room);
    await guardRoomSize(db, room, encoded);
    const write = roomWriteStatements(db, room, {
      create: true,
      body: encoded.body,
      ...(host && hosting
        ? { extraWhere: hosting.hostedCampaignGuardSql, extraArgs: hosting.hostedCampaignGuardArgs(host.userId, host.limit) }
        : {}),
    });
    const statements = [...(write.statements as Statement[]), ...await roomImageStatements(db, room, encoded, write.writeId), ...accountSeats(db, room, write.writeId)];
    const result = statements.length > 1 ? (await db.batch(statements))[0]! : await statements[0]!.run();
    if (host && hosting && !result.meta.changes) {
      // A concurrent open filled the last slot between the pre-check and this write.
      await hosting.assertCanHost(db, host.userId, host.path, host.limit);
      throw hosting.hostedCampaignLimitError(host.limit);
    }
    return;
  }
  await localWrite(async () => {
    const rooms = await localRooms();
    if (rooms.some((item) => item.code === room.code))
      throw new Error("That table code is already used. Try again.");
    if (host) {
      const hosted = rooms.filter((item) => item.ownerId === host.userId && !item.closed).length;
      if (hosted >= host.limit) {
        const { hostedCampaignLimitError } = await import("../../../cloudflare/hosted-campaigns.mjs");
        throw hostedCampaignLimitError(host.limit);
      }
    }
    await localSave([...rooms, room]);
  });
}
/**
 * An action or batch receipt: `key` is `<seatId>:<command or batch id>`. Receipts make every action
 * idempotent for the life of the campaign, so they are never pruned. In D1 they live in
 * `campaign_room_receipts` (migration 0024), not in the room body, so they never count toward the
 * room budget (live-campaign load audit F1, 2026-10-28). Rooms written earlier still carry them in
 * the body (`commands`, `commandHashes`, `batches`, `batchHashes`) until their next write moves them.
 */
export type RoomReceipt = { kind: "command" | "batch"; key: string; hash?: string };
const RECEIPT_FIELDS = ["commands", "commandHashes", "batches", "batchHashes"] as const;
/** Receipts still stored in a room body (rooms written before migration 0024, or local rooms). */
function bodyReceipts(room: CloudRoom): RoomReceipt[] {
  const commands = (room.commands ?? []).map((key) => ({ kind: "command" as const, key, hash: room.commandHashes?.[key] }));
  const batches = (room.batches ?? []).map((key) => ({ kind: "batch" as const, key, hash: room.batchHashes?.[key] }));
  return [...commands, ...batches];
}
/** Known receipts among `keys`, with their hash when one was recorded (absent = not committed). */
export async function lookupReceipts(
  room: CloudRoom,
  kind: RoomReceipt["kind"],
  keys: string[],
): Promise<Map<string, string | undefined>> {
  const found = new Map<string, string | undefined>();
  const wanted = new Set(keys);
  for (const r of bodyReceipts(room)) if (r.kind === kind && wanted.has(r.key)) found.set(r.key, r.hash);
  const db = database();
  const missing = [...wanted].filter((key) => !found.has(key));
  // D1 binds at most 100 parameters per query: code + kind + up to 90 keys per lookup.
  for (let i = 0; db && i < missing.length; i += 90) {
    const chunk = missing.slice(i, i + 90);
    const rows = await db
      .prepare(
        `SELECT key, hash FROM campaign_room_receipts WHERE code=? AND kind=? AND key IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(room.code, kind, ...chunk)
      .all<{ key: string; hash: string | null }>();
    for (const row of rows.results) found.set(row.key, row.hash ?? undefined);
  }
  return found;
}
/** How many of a seat's latest action IDs each view acknowledges (a device holds at most 100 pending). */
export const ACKNOWLEDGED_LIMIT = 500;
/** The seat's most recent committed action IDs, newest first (without the seat prefix). */
export async function recentAcknowledged(room: CloudRoom, seatId: string): Promise<string[]> {
  const prefix = seatId + ":";
  const ids: string[] = [];
  const db = database();
  if (db) {
    const rows = await db
      .prepare(
        "SELECT key FROM campaign_room_receipts WHERE code=? AND seat_id=? AND kind='command' ORDER BY seq DESC LIMIT ?",
      )
      .bind(room.code, seatId, ACKNOWLEDGED_LIMIT)
      .all<{ key: string }>();
    for (const row of rows.results) ids.push(row.key.slice(prefix.length));
  }
  // A write that just moved body receipts into the table would list them twice.
  const seen = new Set(ids);
  const legacy = (room.commands ?? []).filter((key) => key.startsWith(prefix));
  for (let i = legacy.length - 1; i >= 0 && ids.length < ACKNOWLEDGED_LIMIT; i--) {
    const id = legacy[i]!.slice(prefix.length);
    if (!seen.has(id)) ids.push(id);
    seen.add(id);
  }
  return ids;
}
/** The room body without receipt fields (receipts are stored in their own table in D1). */
function withoutReceipts(room: CloudRoom): CloudRoom {
  if (!RECEIPT_FIELDS.some((field) => field in room)) return room;
  const next = { ...room };
  for (const field of RECEIPT_FIELDS) delete next[field];
  return keepStoredBody(room, next);
}
/** Inserts receipts only if the room write with `writeId` committed in the same batch. */
function receiptStatement(db: Database, code: string, receipts: RoomReceipt[], writeId: string): Statement {
  const committed = roomCommittedSql(code, writeId);
  const rows = JSON.stringify(receipts.map((r) => [r.key, r.hash ?? null, r.kind]));
  return db
    .prepare(
      `INSERT OR IGNORE INTO campaign_room_receipts (code, seat_id, kind, key, hash, created_at)
       SELECT ?, substr(json_extract(j.value,'$[0]'), 1, instr(json_extract(j.value,'$[0]'), ':') - 1),
         json_extract(j.value,'$[2]'), json_extract(j.value,'$[0]'), json_extract(j.value,'$[1]'), ?
       FROM json_each(?) AS j
       WHERE ${committed.sql}
       ORDER BY j.key`,
    )
    .bind(code, Date.now(), rows, ...committed.args);
}
export async function updateRoom(
  room: CloudRoom,
  baseRevision: number,
  options: { receipts?: RoomReceipt[] } = {},
): Promise<void> {
  const db = database();
  if (db) {
    // Body receipts (older rooms) move to their table with this write, oldest first, then the new ones.
    const receipts = [...bodyReceipts(room), ...(options.receipts ?? [])];
    const stored = withoutReceipts(room);
    const encoded = await encodeRoomImages(stored);
    await guardRoomSize(db, stored, encoded);
    // A sectioned write re-sends only sections that are not stored yet (hashes only are read).
    const present = roomBodySectioned(encoded.body) ? await readRoomSectionHashes(db, room.code) : undefined;
    const write = roomWriteStatements(db, room, {
      expect: { revision: baseRevision },
      body: encoded.body,
      ...(present ? { present } : {}),
    });
    const writeId = write.writeId;
    const statements = [
      ...(write.statements as Statement[]),
      ...await roomImageStatements(db, stored, encoded, writeId),
      ...accountSeats(db, stored, writeId),
      ...(receipts.length ? [receiptStatement(db, room.code, receipts, writeId)] : []),
    ];
    const result = statements.length > 1 ? (await db.batch(statements))[0]! : await statements[0]!.run();
    if (!result.meta.changes)
      throw new Error("The table changed. Refresh before sending your turn.");
    return;
  }
  await localWrite(async () => {
    const rooms = await localRooms();
    const current = rooms.find((item) => item.code === room.code);
    if (!current || current.revision !== baseRevision)
      throw new Error("The table changed. Refresh before sending your turn.");
    // Local development rooms (no D1) keep receipts in the body, as before.
    const next = { ...room };
    for (const r of options.receipts ?? []) {
      if (r.kind === "command") {
        next.commands = [...(next.commands ?? []), r.key];
        if (r.hash) next.commandHashes = { ...(next.commandHashes ?? {}), [r.key]: r.hash };
      } else {
        next.batches = [...(next.batches ?? []), r.key];
        if (r.hash) next.batchHashes = { ...(next.batchHashes ?? {}), [r.key]: r.hash };
      }
    }
    await localSave(rooms.map((item) => (item.code === room.code ? next : item)));
  });
}
export async function deleteRoom(code: string, baseRevision: number): Promise<void> {
  const db = database();
  if (db) {
    // A deleted room's receipts go with it, in the same transaction (only once the room is gone).
    const [result] = await db.batch([
      roomDeleteStatement(db, code, { expect: { revision: baseRevision } }) as Statement,
      db
        .prepare(
          "DELETE FROM campaign_room_receipts WHERE code = ? AND NOT EXISTS (SELECT 1 FROM campaign_rooms WHERE code = ?)",
        )
        .bind(code, code),
      roomSectionsDeletedStatement(db, code) as Statement,
    ]);
    if (!result!.meta.changes) throw new Error("The table changed. Refresh before closing it.");
    return;
  }
  await localWrite(async () => {
    const rooms = await localRooms();
    if (rooms.find((room) => room.code === code)?.revision !== baseRevision)
      throw Error("The table changed. Refresh before closing it.");
    await localSave(rooms.filter((room) => room.code !== code));
  });
}

/**
 * Library membership for account seats, written only if the room write with `writeId` committed in
 * the same batch. (It used to compare the whole room body, sending it to D1 once per account seat on
 * every write: load audit F14, 2026-10-28.)
 */
function accountSeats(db: Database, room: CloudRoom, writeId: string): Statement[] {
  return room.seats
    .filter((s) => s.userId)
    .map((s) =>
      db
        .prepare(
          `INSERT INTO library_members (user_id,code,seat_id,token,name,archived,updated_at) SELECT ?,?,?,?,?,0,? WHERE ${roomCommittedSql(room.code, writeId).sql} ON CONFLICT(user_id,code) DO UPDATE SET seat_id=excluded.seat_id,token=excluded.token,updated_at=excluded.updated_at WHERE library_members.seat_id<>excluded.seat_id OR library_members.token<>excluded.token`,
        )
        .bind(
          s.userId,
          room.code,
          s.id,
          s.token,
          "Campaign",
          Date.now(),
          ...roomCommittedSql(room.code, writeId).args,
        ),
    );
}
