/**
 * Archived session snapshots (`table.journal.reports[].snapshot`) live in campaign_room_reports,
 * not in the room row. The stored room keeps each report's id, name, time and seat list plus a
 * `snapshotReference`; every reader that hydrates a room (hydrateRoomImages) restores the exact
 * original `snapshot` string, so projection, exports and records behave as before.
 *
 * Old rooms that still carry inline snapshots are read unchanged and move their snapshots out on
 * their next authoritative write (encodeRoomReports in updateRoom). Nothing is bulk rewritten,
 * and no snapshot is ever dropped: a missing row stops the read instead of degrading the room.
 *
 * Raw-body writers (character-play, encounters, account link, test mode) parse and re-serialize
 * the stored body, which keeps the references as they are. They must never parse the journal
 * with the zod journal schema, which requires `snapshot`.
 */
const REFERENCE = /^session-report:[a-f0-9]{64}$/;

/** @param {any} value */
function reportLists(value) {
  return [value?.table?.journal?.reports, value?.journal?.reports].filter(Array.isArray);
}
/** @param {string} text */
async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Replaces inline snapshots with references. Returns a new value; the input is not changed.
 * @template T @param {T} value
 * @returns {Promise<{ value: T; reports: { reference: string; body: string }[] }>}
 */
export async function encodeRoomReports(value) {
  const documents = new Map();
  if (!reportLists(value).length) return { value, reports: [] };
  const result = structuredClone(value);
  for (const list of reportLists(result))
    for (const [index, report] of list.entries()) {
      if (!report || typeof report.snapshot !== "string") continue;
      const reference = "session-report:" + (await sha256(report.snapshot));
      documents.set(reference, { reference, body: report.snapshot });
      const { snapshot: _snapshot, ...stored } = report;
      list[index] = { ...stored, snapshotReference: reference };
    }
  return { value: result, reports: [...documents.values()] };
}

/**
 * Restores every referenced snapshot for this room. Only rows of the same room code are read;
 * a reference never grants access across campaigns.
 * @template T
 * @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {string} code @param {T} value @returns {Promise<T>}
 */
export async function hydrateRoomReports(db, code, value) {
  const wanted = new Set();
  for (const list of reportLists(value))
    for (const report of list)
      if (report && typeof report.snapshot !== "string" && REFERENCE.test(report.snapshotReference))
        wanted.add(report.snapshotReference);
  if (!wanted.size) return value;
  value = structuredClone(value);
  const refs = [...wanted],
    bodies = new Map();
  for (let offset = 0; offset < refs.length; offset += 80) {
    const page = refs.slice(offset, offset + 80);
    const rows = await db
      .prepare(
        `SELECT reference,body FROM campaign_room_reports WHERE code=? AND reference IN (${page.map(() => "?").join(",")})`,
      )
      .bind(code, ...page)
      .all();
    for (const row of rows.results) bodies.set(row.reference, row.body);
  }
  for (const list of reportLists(value))
    for (const [index, report] of list.entries()) {
      if (!report || typeof report.snapshot === "string" || !REFERENCE.test(report.snapshotReference))
        continue;
      const body = bodies.get(report.snapshotReference);
      if (typeof body !== "string")
        throw Error(
          "An archived session report is missing. Keep the original recovery export; the campaign was not changed.",
        );
      const { snapshotReference: _reference, ...rest } = report;
      list[index] = { ...rest, snapshot: body };
    }
  return value;
}

/**
 * Inserts only snapshots this room does not already store, guarded by the room write in the same
 * D1 batch (a losing writer stores nothing). Existing rows are immutable and never deleted here.
 * @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {{code:string;revision:number}} room
 * @param {{body:string;reports?:{reference:string;body:string}[]}} encoded
 */
export async function roomReportStatements(db, room, encoded) {
  if (!encoded.reports?.length) return [];
  const present = await db
    .prepare("SELECT reference FROM campaign_room_reports WHERE code=?")
    .bind(room.code)
    .all();
  const existing = new Set(present.results.map((row) => row.reference));
  return encoded.reports
    .filter((doc) => !existing.has(doc.reference))
    .map((doc) =>
      db
        .prepare(
          "INSERT INTO campaign_room_reports(code,reference,body) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND revision=? AND body=?) ON CONFLICT(code,reference) DO NOTHING",
        )
        .bind(room.code, doc.reference, doc.body, room.code, room.revision, encoded.body),
    );
}
