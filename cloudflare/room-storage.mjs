/**
 * The one storage API for shared campaign rooms (`campaign_rooms`). Every room read that needs
 * campaign data and every room write goes through this module or through
 * `src/lib/quire/room-store.server.ts`, which is built on it; `scripts/room-storage-guard.test.mjs`
 * fails if any other file reads a room body or writes the table directly. Sectioned storage
 * (owner plan 2026-10-28, step 2b) changes how a room is stored here, in one place.
 *
 * Two forms of a room exist:
 * - **stored**: what the row holds today. Map images, archived session snapshots and resource
 *   packs are references (room-images.mjs, room-reports.mjs, room-resources.mjs). Raw readers
 *   and raw writers (account seat linking, character play, encounters, test mode, recovery) work
 *   on this form and write it back unchanged except for their own edits.
 * - **hydrated**: references restored (`readRoom` in room-store.server.ts).
 *
 * A read returns an opaque **version** token, and guards compare against it (`roomVersionSql`).
 * Today the token is the revision, the `write_id` and the exact stored body, so a version guard
 * is at least as strict as each body or revision comparison it replaced: it also refuses a write
 * in between that restored an identical body. Every write sets a fresh random `write_id`; in 2b,
 * when the row no longer holds the whole campaign, the guard drops the body comparison here.
 * Dependent statements in the same D1 batch guard on the write's `write_id`
 * (`roomCommittedSql`), so they apply only if the room write committed.
 */

/**
 * @typedef {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} Database
 * @typedef {ReturnType<Database["prepare"]>} Statement
 * @typedef {{ meta: { changes: number } }} StatementResult
 * @typedef {{ readonly code: string; readonly revision: number; readonly writeId: string | null; readonly body: string }} RoomVersion
 * @typedef {{ room: any; body: string; version: RoomVersion }} StoredRoom
 * @typedef {{ sql: string; args: unknown[] }} SqlGuard
 */

/** Top-level fields a light read returns (never anything under `$.table`). At least two, so
 * the multi-path json_extract below always returns an array. */
const CORE_FIELDS = /** @type {const} */ ([
  "seats",
  "ownerId",
  "sessionId",
  "closed",
  "testMode",
  "live",
  "viewOnly",
  "campaignName",
]);
/**
 * The light read. `revision` is the row's revision column; it is not a guard version (a light
 * read never guards a write except by revision, `{ revision }`).
 * @typedef {{ code: string; revision: number; seats: any; ownerId?: string; sessionId?: string;
 *   closed?: boolean; testMode?: boolean; live?: boolean; viewOnly?: boolean;
 *   campaignName?: unknown }} RoomCore
 */

/**
 * @param {string} code @param {number} revision @param {string | null | undefined} writeId
 * @param {string} body @returns {RoomVersion}
 */
function version(code, revision, writeId, body) {
  return Object.freeze({ code, revision, writeId: writeId ?? null, body });
}

/** @param {any} row @returns {StoredRoom} */
function storedFromRow(row) {
  return {
    room: JSON.parse(row.body),
    body: row.body,
    version: version(row.code, row.revision, row.write_id, row.body),
  };
}

/**
 * The room exactly as stored (references not hydrated), with its version. `null` when the room
 * does not exist.
 * @param {Database} db @param {string} code @returns {Promise<StoredRoom | null>}
 */
export async function readStoredRoom(db, code) {
  const row = await db
    .prepare("SELECT code,revision,write_id,body FROM campaign_rooms WHERE code=?")
    .bind(code)
    .first();
  return row ? storedFromRow(row) : null;
}

/**
 * Several stored rooms by code (missing rooms are absent from the map). D1 binds at most 100
 * parameters per statement, so codes are read in groups of 90.
 * @param {Database} db @param {string[]} codes @returns {Promise<Map<string, StoredRoom>>}
 */
export async function readStoredRooms(db, codes) {
  /** @type {Map<string, StoredRoom>} */
  const rooms = new Map();
  const wanted = [...new Set(codes)];
  for (let offset = 0; offset < wanted.length; offset += 90) {
    const page = wanted.slice(offset, offset + 90);
    const rows = await db
      .prepare(
        `SELECT code,revision,write_id,body FROM campaign_rooms WHERE code IN (${page.map(() => "?").join(",")})`,
      )
      .bind(...page)
      .all();
    for (const row of rows.results) rooms.set(/** @type {any} */ (row).code, storedFromRow(row));
  }
  return rooms;
}

/**
 * The signed-in account's memberships joined with their stored rooms, in one query (memberships
 * whose room is gone are left out, as a JOIN does). `archived: false` limits to active cards and
 * `code` to one campaign. Each entry is `{ member, stored }`; `member` is the library_members row.
 * @param {Database} db @param {string} userId @param {{ code?: string; archived?: false }} [options]
 * @returns {Promise<{ member: any; stored: StoredRoom }[]>}
 */
export async function readMemberRooms(db, userId, options = {}) {
  const where = ["m.user_id=?"],
    args = [userId];
  if (options.code !== undefined) {
    where.push("m.code=?");
    args.push(options.code);
  }
  if (options.archived === false) where.push("m.archived=0");
  const rows = await db
    .prepare(
      `SELECT m.*,r.code AS room_code,r.revision AS room_revision,r.write_id AS room_write_id,r.body AS room_body FROM library_members m JOIN campaign_rooms r ON r.code=m.code WHERE ${where.join(" AND ")}`,
    )
    .bind(...args)
    .all();
  return rows.results.map((/** @type {any} */ row) => {
    const { room_code, room_revision, room_write_id, room_body, ...member } = row;
    return {
      member,
      stored: storedFromRow({ code: room_code, revision: room_revision, write_id: room_write_id, body: room_body }),
    };
  });
}

/**
 * SQL columns of a light read for the `campaign_rooms` row aliased `alias`: one JSON array of the
 * top-level fields (types preserved, so `true` stays `true`), plus revision and write_id.
 * @param {string} alias
 */
export function roomCoreColumnsSql(alias) {
  const paths = CORE_FIELDS.map((field) => `'$.${field}'`).join(",");
  return `${alias}.code AS room_code,${alias}.revision AS room_revision,${alias}.write_id AS room_write_id,json_extract(${alias}.body,${paths}) AS room_core`;
}

/**
 * Parses a row selected with `roomCoreColumnsSql` (`null` when the joined room is absent).
 * Absent and `null` fields are left out, as `JSON.parse` of the whole body would leave them
 * undefined or null; the readers using this treat both alike. `seats` is returned as stored
 * (callers that need an array check it, as they did with the whole body).
 * @param {any} row @returns {RoomCore | null}
 */
export function roomCoreFromRow(row) {
  if (!row || row.room_code == null) return null;
  const values = JSON.parse(row.room_core);
  /** @type {any} */
  const core = {
    code: row.room_code,
    revision: row.room_revision,
  };
  CORE_FIELDS.forEach((field, index) => {
    if (values[index] !== null && values[index] !== undefined) core[field] = values[index];
  });
  return core;
}

/**
 * Light read: seats, owner, session, closed and the other small top-level fields, without the
 * campaign table, media or history.
 * @param {Database} db @param {string} code @returns {Promise<RoomCore | null>}
 */
export async function readRoomCore(db, code) {
  const row = await db
    .prepare(`SELECT ${roomCoreColumnsSql("r")} FROM campaign_rooms r WHERE r.code=?`)
    .bind(code)
    .first();
  return roomCoreFromRow(row);
}

/**
 * A SQL expression for the stored JSON at `path` of the room row aliased `alias` (for statements
 * that must read room data inside their own transaction, such as the deletion recovery copy or
 * the analytics page). Paths are fixed strings in code, never request input.
 * @param {string} alias @param {string} path
 */
export function roomJsonSql(alias, path) {
  if (!/^\w+$/.test(alias) || !/^\$(\.\w+)+$/.test(path)) throw Error("Invalid room JSON path.");
  return `json_extract(${alias}.body,'${path}')`;
}

/** @param {RoomVersion} a @param {RoomVersion} b */
export function sameRoomVersion(a, b) {
  return a.code === b.code && a.revision === b.revision && a.writeId === b.writeId && a.body === b.body;
}

/**
 * True while the room is exactly at `version` (no write since that read).
 * @param {RoomVersion} expected @returns {SqlGuard}
 */
export function roomVersionSql(expected) {
  return {
    sql: "EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND revision=? AND write_id IS ? AND body=?)",
    args: [expected.code, expected.revision, expected.writeId, expected.body],
  };
}

/**
 * True once the room write with `writeId` has committed (and nothing has written since); for
 * statements later in the same batch.
 * @param {string} code @param {string} writeId @returns {SqlGuard}
 */
export function roomCommittedSql(code, writeId) {
  return {
    sql: "EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND write_id=?)",
    args: [code, writeId],
  };
}

/**
 * Statements that write `room` (stored form) to its row, for the caller's own `db.batch`.
 *
 * - `expect`: a version from a read (the row must still be at it), `{ revision }` (the revision
 *   column must equal it; for callers whose guard is revision-only), or `null` for no version
 *   guard, which is allowed only with `extraWhere` (for example an encounter award whose receipt
 *   insert, earlier in the batch, carries the version guard).
 * - `create: true`: insert a new row instead (fails on an existing code, as before).
 * - `extraWhere`/`extraArgs`: an additional SQL predicate (hosted-campaign limit, staff guard,
 *   EXISTS(...)) ANDed into the write.
 * - `body`: the exact serialized body, when the caller already encoded it (defaults to
 *   `JSON.stringify(room)`).
 *
 * The write always sets a fresh `write_id`. Statements that must apply only if this write commits
 * go after it in the batch and guard on `committed` (or `roomCommittedSql(code, writeId)`).
 * `changed(results, batch)` tells whether the room write committed.
 *
 * @param {Database} db @param {any} room
 * @param {{ expect?: RoomVersion | { revision: number } | null; create?: boolean; body?: string;
 *   extraWhere?: string; extraArgs?: unknown[]; writeId?: string }} options
 */
export function roomWriteStatements(db, room, options) {
  const code = room.code,
    revision = room.revision;
  if (typeof code !== "string" || !Number.isSafeInteger(revision))
    throw Error("A room write needs the room code and a whole-number revision.");
  const body = options.body ?? JSON.stringify(room);
  const writeId = options.writeId ?? crypto.randomUUID();
  const extra = options.extraWhere ? [`(${options.extraWhere})`] : [];
  const extraArgs = options.extraArgs ?? [];
  /** @type {Statement} */
  let statement;
  if (options.create) {
    statement = extra.length
      ? db
          .prepare(
            `INSERT INTO campaign_rooms (code, revision, body, write_id) SELECT ?, ?, ?, ? WHERE ${extra.join(" AND ")}`,
          )
          .bind(code, revision, body, writeId, ...extraArgs)
      : db
          .prepare("INSERT INTO campaign_rooms (code, revision, body, write_id) VALUES (?, ?, ?, ?)")
          .bind(code, revision, body, writeId);
  } else {
    const expect = options.expect;
    if (expect === undefined) throw Error("A room update must state what it expects.");
    if (expect === null && !extra.length)
      throw Error("An unversioned room update needs another guard.");
    /** @type {string[]} */
    const where = ["code = ?"];
    /** @type {unknown[]} */
    const whereArgs = [code];
    if (expect && "writeId" in expect) {
      if (expect.code !== code) throw Error("The room version belongs to another campaign.");
      where.push("revision = ?", "write_id IS ?", "body = ?");
      whereArgs.push(expect.revision, expect.writeId, expect.body);
    } else if (expect) {
      where.push("revision = ?");
      whereArgs.push(expect.revision);
    }
    statement = db
      .prepare(
        `UPDATE campaign_rooms SET revision = ?, body = ?, write_id = ? WHERE ${[...where, ...extra].join(" AND ")}`,
      )
      .bind(revision, body, writeId, ...whereArgs, ...extraArgs);
  }
  const statements = [statement];
  return {
    statements,
    writeId,
    body,
    /** The room's version once this write commits. */
    version: version(code, revision, writeId, body),
    committed: roomCommittedSql(code, writeId),
    /** @param {StatementResult[]} results @param {Statement[]} batch the array passed to db.batch */
    changed(results, batch) {
      const index = batch.indexOf(statement);
      if (index < 0) throw Error("The room write is not part of this batch.");
      return !!results[index]?.meta.changes;
    },
  };
}

/**
 * Deletes a room row, guarded like a write (`expect` is a read's version or `{ revision }`).
 * @param {Database} db @param {string} code
 * @param {{ expect: RoomVersion | { revision: number }; extraWhere?: string; extraArgs?: unknown[] }} options
 */
export function roomDeleteStatement(db, code, options) {
  const expect = options.expect;
  /** @type {string[]} */
  const where = ["code = ?", "revision = ?"];
  /** @type {unknown[]} */
  const args = [code, expect.revision];
  if ("writeId" in expect) {
    if (expect.code !== code) throw Error("The room version belongs to another campaign.");
    where.push("write_id IS ?", "body = ?");
    args.push(expect.writeId, expect.body);
  }
  if (options.extraWhere) where.push(`(${options.extraWhere})`);
  return db
    .prepare(`DELETE FROM campaign_rooms WHERE ${where.join(" AND ")}`)
    .bind(...args, ...(options.extraArgs ?? []));
}
