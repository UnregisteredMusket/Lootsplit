import { createHash } from "node:crypto";
/**
 * Chunked library backups (sectioned storage step 3). `library_backups.body` is one D1 row (2 MB
 * limit). A backup whose campaign JSON is larger keeps, in that row, a marker
 * `{"$backupParts":{"parts","bytes","sha256"}}` (plus whatever the writer adds to it, such as the
 * deletion recovery records), and stores the campaign JSON in `library_backup_parts` (migration
 * 0027), split into parts of at most `BACKUP_PART_BYTES` UTF-8 bytes, never inside a character.
 * Reading joins the parts, checks their length and SHA-256 against the marker (a mismatch is an
 * error, never a partial backup), and returns the same payload object an inline backup would
 * parse to: the campaign with the row's other fields (`campaignRecovery`) added after it.
 */

export const BACKUP_PARTS_KEY = "$backupParts";
/** Campaign JSON above this many bytes is stored in parts (the row keeps room for recovery records). */
export const BACKUP_INLINE_BYTES = 1_500_000;
export const BACKUP_PART_BYTES = 1_000_000;
/**
 * An account's backup storage (account backups and deletion backups, parts included): the
 * account library limit (accounts.mjs `LIBRARY_LIMITS.backupBytes`).
 */
export const ACCOUNT_BACKUP_BYTES = 60_000_000;
/** The largest backup stored in parts: 32 parts. */
export const BACKUP_MAX_BYTES = 32_000_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The parts for a backup's campaign JSON, or `null` when it fits inline.
 * @param {string} text
 * @returns {{ marker: { parts: number; bytes: number; sha256: string }; parts: string[] } | null}
 */
export function backupParts(text) {
  if (text.length <= BACKUP_INLINE_BYTES / 3) return null;
  const bytes = encoder.encode(text);
  if (bytes.length <= BACKUP_INLINE_BYTES) return null;
  const parts = [];
  for (let start = 0; start < bytes.length; ) {
    let end = Math.min(bytes.length, start + BACKUP_PART_BYTES);
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return {
    marker: { parts: parts.length, bytes: bytes.length, sha256: createHash("sha256").update(text).digest("hex") },
    parts,
  };
}

/**
 * Statements inserting a backup's parts, each only if its backup row exists for that account
 * (for the batch that inserts the row, after it).
 * @param {any} db @param {string} backupId @param {string} userId @param {string[]} parts
 */
export function backupPartStatements(db, backupId, userId, parts) {
  return parts.map((body, part) =>
    db
      .prepare(
        "INSERT INTO library_backup_parts(backup_id,part,body) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM library_backups WHERE id=? AND user_id=?)",
      )
      .bind(backupId, part, body, backupId, userId),
  );
}

/** SQL true when all `count` parts of backup `?` are stored (bind the backup id, then the count). */
export const backupPartsCompleteSql = "(SELECT COUNT(*) FROM library_backup_parts WHERE backup_id=?)=?";

/**
 * The payload of a library backup row: its parsed body, or for a chunked backup the campaign
 * read back from its parts (verified) with the row's other fields added after it.
 * @param {any} db @param {string} backupId @param {string} body the row's body
 */
export async function readBackupPayload(db, backupId, body) {
  const row = JSON.parse(body);
  const marker = row && typeof row === "object" ? row[BACKUP_PARTS_KEY] : undefined;
  if (marker === undefined) return row;
  const rows = (
    await db.prepare("SELECT part,body FROM library_backup_parts WHERE backup_id=? ORDER BY part").bind(backupId).all()
  ).results;
  const text = rows.map((r) => r.body).join("");
  if (
    rows.length !== marker.parts ||
    rows.some((r, i) => Number(r.part) !== i) ||
    encoder.encode(text).length !== marker.bytes ||
    createHash("sha256").update(text).digest("hex") !== marker.sha256
  )
    throw Object.assign(Error("This backup is incomplete in cloud storage and cannot be read."), { status: 409 });
  const payload = JSON.parse(text);
  delete row[BACKUP_PARTS_KEY];
  return Object.assign(payload, row);
}

/** SQL for an account's stored backup bytes, parts included (bind the user id twice). */
export const accountBackupBytesSql =
  "(SELECT COALESCE(SUM(LENGTH(body)),0) FROM library_backups WHERE user_id=?)+(SELECT COALESCE(SUM(LENGTH(p.body)),0) FROM library_backup_parts p JOIN library_backups b ON b.id=p.backup_id WHERE b.user_id=?)";

/**
 * `backupParts` for a campaign JSON produced as a sequence of text chunks (campaign-file-stream.mjs),
 * without ever holding it as one string when it is stored in parts: the same parts, marker and
 * inline decision as `backupParts(chunks.join(""))`. Returns `{ text }` when it fits inline, else
 * `{ chunked }`.
 * @param {AsyncIterable<string>} chunks
 * @returns {Promise<{ text: string; chunked: null } | { text: null; chunked: { marker: { parts: number; bytes: number; sha256: string }; parts: string[] } }>}
 */
export async function backupPartsFromChunks(chunks) {
  const hash = createHash("sha256");
  /** @type {string[] | null} text while it may still fit inline */
  let small = [];
  let bytes = 0;
  /** @type {string[]} */
  const parts = [];
  // Encoded bytes not yet cut into parts, kept as pieces and joined only when a part is cut.
  /** @type {Uint8Array[]} */
  let pieces = [];
  let pendingBytes = 0;
  const cut = (/** @type {boolean} */ final) => {
    if (!(pendingBytes > BACKUP_PART_BYTES || (final && pendingBytes))) return;
    let pending = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const piece of pieces) {
      pending.set(piece, offset);
      offset += piece.length;
    }
    while (pending.length > BACKUP_PART_BYTES || (final && pending.length)) {
      let end = Math.min(pending.length, BACKUP_PART_BYTES);
      while (end < pending.length && end > 0 && (pending[end] & 0xc0) === 0x80) end--;
      parts.push(decoder.decode(pending.subarray(0, end)));
      pending = pending.subarray(end);
    }
    pieces = pending.length ? [pending.slice()] : [];
    pendingBytes = pending.length;
  };
  for await (const chunk of chunks) {
    hash.update(chunk);
    const encoded = encoder.encode(chunk);
    bytes += encoded.length;
    if (small) {
      small.push(chunk);
      if (bytes > BACKUP_INLINE_BYTES) small = null;
    }
    pieces.push(encoded);
    pendingBytes += encoded.length;
    cut(false);
  }
  if (small) return { text: small.join(""), chunked: null };
  cut(true);
  return { text: null, chunked: { marker: { parts: parts.length, bytes, sha256: hash.digest("hex") }, parts } };
}
