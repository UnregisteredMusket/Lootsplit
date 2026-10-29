import { roomCommittedSql } from "./room-storage.mjs";
import { DEFERRED_REPORT_PREFIX } from "../src/lib/quire/history-pages.ts";
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
 * Raw-body writers (character-play, encounters, account link, test mode) read the stored form
 * (room-storage.mjs `readStoredRoom`) and write it back, which keeps the references as they are.
 * They must never parse the journal with the zod journal schema, which requires `snapshot`.
 */
const REFERENCE = /^session-report:[a-f0-9]{64}$/;
/**
 * Archived sessions in parts (step 4, migration 0029). A snapshot above `REPORT_INLINE_BYTES`
 * keeps a marker in its campaign_room_reports row and its JSON in campaign_room_report_parts, in
 * parts of at most `REPORT_PART_BYTES`, never inside a character. The marker names the reference
 * the parts are stored under (an older Worker that re-encodes the marker string writes it under a
 * new reference; the original parts are still found). Reading joins the parts and checks the
 * SHA-256 against that reference, so a damaged or partial snapshot is an error, never history.
 */
export const REPORT_PARTS_KEY = "$reportParts";
export const REPORT_INLINE_BYTES = 1_500_000;
export const REPORT_PART_BYTES = 1_000_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** @param {string} text @returns {string[] | null} */
function reportParts(text) {
  if (text.length <= REPORT_INLINE_BYTES / 3) return null;
  const bytes = encoder.encode(text);
  if (bytes.length <= REPORT_INLINE_BYTES) return null;
  const parts = [];
  for (let start = 0; start < bytes.length; ) {
    let end = Math.min(bytes.length, start + REPORT_PART_BYTES);
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return parts;
}
/** @param {string} body @returns {{ parts: number; bytes: number; reference: string } | null} */
function partsMarker(body) {
  if (!body.startsWith(`{"${REPORT_PARTS_KEY}":`)) return null;
  const marker = JSON.parse(body)[REPORT_PARTS_KEY];
  if (!marker || !Number.isSafeInteger(marker.parts) || marker.parts < 1 || !REFERENCE.test(marker.reference))
    throw Error("An archived session report is damaged. Keep the original recovery export; the campaign was not changed.");
  return marker;
}
/**
 * The snapshot JSON of stored report rows (`reference -> body`): bodies that are part markers are
 * joined from their parts and verified. Only rows of this room code are read.
 * @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {string} code @param {Map<string, string>} bodies @returns {Promise<Map<string, string>>}
 */
async function joinReportParts(db, code, bodies) {
  /** @type {Map<string, { parts: number; bytes: number; reference: string }>} */
  const markers = new Map();
  for (const [reference, body] of bodies) {
    const marker = partsMarker(body);
    if (marker) markers.set(reference, marker);
  }
  if (!markers.size) return bodies;
  const result = new Map(bodies);
  const stored = [...new Set([...markers.values()].map((m) => m.reference))];
  /** @type {Map<string, Map<number, string>>} */
  const parts = new Map();
  for (let offset = 0; offset < stored.length; offset += 80) {
    const page = stored.slice(offset, offset + 80);
    const rows = await db
      .prepare(
        `SELECT reference,part,body FROM campaign_room_report_parts WHERE code=? AND reference IN (${page.map(() => "?").join(",")})`,
      )
      .bind(code, ...page)
      .all();
    for (const row of rows.results) {
      if (!parts.has(row.reference)) parts.set(row.reference, new Map());
      parts.get(row.reference)?.set(Number(row.part), row.body);
    }
  }
  for (const [reference, marker] of markers) {
    const list = [];
    for (let index = 0; index < marker.parts; index++) list.push(parts.get(marker.reference)?.get(index));
    const text = list.every((part) => typeof part === "string") ? list.join("") : undefined;
    if (text === undefined || "session-report:" + (await sha256(text)) !== marker.reference)
      throw Error("An archived session report is incomplete. Keep the original recovery export; the campaign was not changed.");
    result.set(reference, text);
  }
  return result;
}

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
 * `changed` is true when the value was rewritten (a snapshot moved out, or a deferred report
 * turned back into its reference).
 * @returns {Promise<{ value: T; reports: { reference: string; body: string }[]; changed: boolean }>}
 */
export async function encodeRoomReports(value) {
  const documents = new Map();
  if (!reportLists(value).length) return { value, reports: [], changed: false };
  let changed = false;
  const result = structuredClone(value);
  for (const list of reportLists(result))
    for (const [index, report] of list.entries()) {
      if (!report || typeof report.snapshot !== "string") continue;
      const deferred = deferredReportReference(report.snapshot);
      if (deferred !== null) {
        // Never read in this write: it is stored already, under its reference.
        if (!REFERENCE.test(deferred)) throw Error("An archived session report reference is invalid.");
        const { snapshot: _snapshot, ...stored } = report;
        list[index] = { ...stored, snapshotReference: deferred };
        changed = true;
        continue;
      }
      const reference = "session-report:" + (await sha256(report.snapshot));
      documents.set(reference, { reference, body: report.snapshot });
      const { snapshot: _snapshot, ...stored } = report;
      list[index] = { ...stored, snapshotReference: reference };
      changed = true;
    }
  return { value: result, reports: [...documents.values()], changed };
}

/**
 * The snapshot JSON of the given references of this room (joined from parts where stored so), as
 * `reference -> text`; a reference this room does not store is absent. Only rows of the same room
 * code are read; a reference never grants access across campaigns.
 * @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {string} code @param {readonly string[]} references @returns {Promise<Map<string, string>>}
 */
export async function readRoomReportSnapshots(db, code, references) {
  const refs = [...new Set(references)].filter((reference) => REFERENCE.test(reference));
  /** @type {Map<string, string>} */
  const bodies = new Map();
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
  return joinReportParts(db, code, bodies);
}

/** A deferred report's stored reference (history-pages.ts `DEFERRED_REPORT_PREFIX`), else null. @param {unknown} snapshot */
export function deferredReportReference(snapshot) {
  return typeof snapshot === "string" && snapshot.startsWith(DEFERRED_REPORT_PREFIX)
    ? snapshot.slice(DEFERRED_REPORT_PREFIX.length)
    : null;
}

/**
 * Restores every referenced snapshot for this room. Only rows of the same room code are read;
 * a reference never grants access across campaigns.
 *
 * `defer: true` (step 4) reads nothing: each referenced report gets a deferred marker
 * (`DEFERRED_REPORT_PREFIX` + reference) as its snapshot, for reads that only project report names
 * and dates. Inline snapshots (rooms not yet written since 0019) are left as they are.
 * @template T
 * @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {string} code @param {T} value @param {{ defer?: boolean }} [options] @returns {Promise<T>}
 */
export async function hydrateRoomReports(db, code, value, options = {}) {
  const wanted = new Set();
  for (const list of reportLists(value))
    for (const report of list)
      if (report && typeof report.snapshot !== "string" && REFERENCE.test(report.snapshotReference))
        wanted.add(report.snapshotReference);
  if (!wanted.size) return value;
  value = structuredClone(value);
  const bodies = options.defer
    ? new Map([...wanted].map((reference) => [reference, DEFERRED_REPORT_PREFIX + reference]))
    : await readRoomReportSnapshots(db, code, [...wanted]);
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
 * @param {string} writeId the room write (room-storage.mjs) these rows depend on
 */
export async function roomReportStatements(db, room, encoded, writeId) {
  const committed = roomCommittedSql(room.code, writeId);
  if (!encoded.reports?.length) return [];
  const present = await db
    .prepare("SELECT reference FROM campaign_room_reports WHERE code=?")
    .bind(room.code)
    .all();
  const existing = new Set(present.results.map((row) => row.reference));
  return encoded.reports
    .filter((doc) => !existing.has(doc.reference))
    .flatMap((doc) => {
      const parts = reportParts(doc.body);
      const body = parts
        ? JSON.stringify({ [REPORT_PARTS_KEY]: { parts: parts.length, bytes: encoder.encode(doc.body).length, reference: doc.reference } })
        : doc.body;
      return [
        db
          .prepare(
            `INSERT INTO campaign_room_reports(code,reference,body) SELECT ?,?,? WHERE ${committed.sql} ON CONFLICT(code,reference) DO NOTHING`,
          )
          .bind(room.code, doc.reference, body, ...committed.args),
        // Parts only with their report row and only if the room write committed (step 4).
        ...(parts ?? []).map((part, index) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO campaign_room_report_parts(code,reference,part,body) SELECT ?,?,?,? WHERE ${committed.sql} AND EXISTS(SELECT 1 FROM campaign_room_reports WHERE code=? AND reference=?)`,
            )
            .bind(room.code, doc.reference, index, part, ...committed.args, room.code, doc.reference),
        ),
      ];
    });
}
