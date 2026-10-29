/**
 * Lookup keys of archived sessions (storage follow-up, part 3; migration 0030).
 *
 * Commands that read archived sessions (Undo of an archived ledger line, linking a quest reward to
 * an archived receipt) used to load every archived session of the campaign. Each archived
 * session's snapshot is indexed by the keys those commands look up, so the server can load only
 * the sessions that can matter (cloud.server.ts `archiveSelection`). Every other archived session
 * is then provably irrelevant to the batch: it holds no line, reversal, void, receipt or
 * resolution the batch looks for.
 *
 * Keys of one snapshot (`archiveKeys`):
 * - `id:<id>` for each ledger line, `rev:<id>` for each line's `reversalOf`;
 * - `void` when any line's summary contains "(void:" (Undo checks summaries for earlier voids;
 *   such sessions are always loaded for an Undo, whatever the ID);
 * - `trade:<receiptId>`, `award:<receiptId>` for linked ledger lines;
 * - `loot:<id>` for each treasure-pool resolution event;
 * - `*` once the snapshot is completely indexed. A session without `*` (archived before 0030, or
 *   unreadable) makes the server load every session, exactly as before.
 *
 * Keys are derived from immutable snapshots, so they never go stale: written in the same D1 batch
 * as the report (only if that room write committed) or, for older reports, after a command has
 * read them (`backfillArchiveKeys`); removed only with the room.
 */
export const ARCHIVE_INDEXED = "*";
const KEYS_PER_STATEMENT = 2_000;

/** The keys of one archived snapshot, or null when it cannot be read (never indexed). @param {string} text */
export function archiveKeys(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  // Anything not shaped like an archived campaign is never indexed (unindexable: every command
  // that needs archives then loads every session, and meets the same refusal as before).
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.ledger !== undefined && !Array.isArray(raw.ledger)) return null;
  if (raw.journal !== undefined && (!raw.journal || typeof raw.journal !== "object" || Array.isArray(raw.journal))) return null;
  if (raw.journal?.events !== undefined && !Array.isArray(raw.journal.events)) return null;
  const keys = new Set([ARCHIVE_INDEXED]);
  const ledger = raw.ledger ?? [];
  for (const line of ledger) {
    if (!line || typeof line !== "object" || Array.isArray(line)) return null;
    if (typeof line.id === "string") keys.add("id:" + line.id);
    if (typeof line.reversalOf === "string") keys.add("rev:" + line.reversalOf);
    if (typeof line.summary === "string" && line.summary.includes("(void:")) keys.add("void");
    if (line.trade && typeof line.trade.receiptId === "string") keys.add("trade:" + line.trade.receiptId);
    if (line.award && typeof line.award.receiptId === "string") keys.add("award:" + line.award.receiptId);
  }
  for (const event of raw.journal?.events ?? []) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return null;
    if (typeof event.lootResolution?.id === "string") keys.add("loot:" + event.lootResolution.id);
  }
  return [...keys];
}

/**
 * Statements indexing new archived snapshots, each only if the room write `committed` (SQL and
 * args from room-storage.mjs `roomCommittedSql`) committed. An unreadable snapshot is not indexed.
 * @param {any} db @param {string} code @param {{ reference: string; body: string }[]} docs
 * @param {{ sql: string; args: unknown[] }} committed
 */
export function archiveKeyStatements(db, code, docs, committed) {
  const statements = [];
  for (const doc of docs) {
    const keys = archiveKeys(doc.body);
    if (!keys) continue;
    // "*" last: in one batch, so a snapshot is either completely indexed or not at all.
    const ordered = [...keys.filter((k) => k !== ARCHIVE_INDEXED), ARCHIVE_INDEXED];
    for (let at = 0; at < ordered.length; at += KEYS_PER_STATEMENT)
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO campaign_room_archive_keys(code,key,reference) SELECT ?,value,? FROM json_each(?) WHERE ${committed.sql}`,
          )
          .bind(code, doc.reference, JSON.stringify(ordered.slice(at, at + KEYS_PER_STATEMENT)), ...committed.args),
      );
  }
  return statements;
}

/**
 * Of `references` (the room's archived sessions), those holding any of `keys`; null when any of
 * them is not completely indexed (the caller then loads every session).
 * @param {any} db @param {string} code @param {readonly string[]} references @param {readonly string[]} keys
 * @returns {Promise<Set<string> | null>}
 */
export async function archiveReferencesWith(db, code, references, keys) {
  const wanted = [...new Set(references)];
  if (!wanted.length) return new Set();
  const rows = /** @type {{ reference: string; key: string }[]} */ ((
    await db
      .prepare(
        "SELECT reference,key FROM campaign_room_archive_keys WHERE code=?1 AND reference IN (SELECT value FROM json_each(?2)) AND key IN (SELECT value FROM json_each(?3))",
      )
      .bind(code, JSON.stringify(wanted), JSON.stringify([ARCHIVE_INDEXED, ...new Set(keys)]))
      .all()
  ).results);
  const indexed = new Set(rows.filter((r) => r.key === ARCHIVE_INDEXED).map((r) => r.reference));
  if (wanted.some((reference) => !indexed.has(reference))) return null;
  return new Set(rows.filter((r) => r.key !== ARCHIVE_INDEXED).map((r) => r.reference));
}

/**
 * Indexes archived sessions read in full that are not indexed yet (archived before 0030). Keys
 * come from the immutable snapshot named by the reference, so this needs no room write; a failure
 * only means the next command loads every session again.
 * @param {any} db @param {string} code @param {{ reference: string; text: string }[]} entries
 */
export async function backfillArchiveKeys(db, code, entries) {
  if (!entries.length) return;
  try {
    const present = new Set(
      (
        await db
          .prepare("SELECT reference FROM campaign_room_archive_keys WHERE code=?1 AND key=?2 AND reference IN (SELECT value FROM json_each(?3))")
          .bind(code, ARCHIVE_INDEXED, JSON.stringify(entries.map((e) => e.reference)))
          .all()
      ).results.map((/** @type {{ reference: string }} */ r) => r.reference),
    );
    const missing = entries.filter((e) => !present.has(e.reference));
    if (!missing.length) return;
    // Only references this room still stores (a report row is immutable for its reference).
    const guarded = missing.flatMap((e) => {
      const keys = archiveKeys(e.text);
      if (!keys) return [];
      const ordered = [...keys.filter((k) => k !== ARCHIVE_INDEXED), ARCHIVE_INDEXED];
      const parts = [];
      for (let at = 0; at < ordered.length; at += KEYS_PER_STATEMENT)
        parts.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO campaign_room_archive_keys(code,key,reference) SELECT ?,value,? FROM json_each(?) WHERE EXISTS(SELECT 1 FROM campaign_room_reports WHERE code=? AND reference=?)",
            )
            .bind(code, e.reference, JSON.stringify(ordered.slice(at, at + KEYS_PER_STATEMENT)), code, e.reference),
        );
      return parts;
    });
    if (guarded.length) await db.batch(guarded);
  } catch (error) {
    console.warn("Archived sessions could not be indexed; commands keep loading every session.", error);
  }
}
