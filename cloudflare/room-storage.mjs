import { createHash } from "node:crypto";
/**
 * The one storage API for shared campaign rooms (`campaign_rooms`, and since step 2b
 * `campaign_room_sections`). Every room read that needs campaign data and every room write goes
 * through this module or through `src/lib/quire/room-store.server.ts`, which is built on it;
 * `scripts/room-storage-guard.test.mjs` fails if any other file reads a room body, writes the
 * table or touches room sections directly.
 *
 * Two forms of a room exist:
 * - **stored**: the campaign as storage holds it. Map images, archived session snapshots and
 *   resource packs are references (room-images.mjs, room-reports.mjs, room-resources.mjs). Raw
 *   readers and raw writers (account seat linking, character play, encounters, test mode,
 *   recovery) work on this form and write it back unchanged except for their own edits.
 * - **hydrated**: references restored (`readRoom` in room-store.server.ts).
 *
 * **Sectioned storage** (owner plan 2026-10-28, step 2b). D1 caps a row at 2 MB. A stored room
 * whose body is at most `ROOM_SECTION_THRESHOLD` bytes is one row, exactly as before ("inline").
 * A larger one is written "sectioned": the row body keeps every small top-level field (seats,
 * owner, session, closed... so light reads and SQL guards are unchanged) and starts with a
 * `"$sections"` manifest; the campaign `table`, a large `testTemplate`/`drafts`, and each large
 * part of the table and of its journal (ledger, messages, report references, trade economy,
 * world...) are replaced by `null` in place and stored in `campaign_room_sections`,
 * content-addressed per room by SHA-256 and split into parts of at most
 * `ROOM_SECTION_PART_BYTES`. Readers always get the assembled stored form, byte-identical to the
 * body that was written. A write uploads only sections whose hash is not already stored, so an
 * unchanged ledger is not re-sent. Code that predates sectioning sees `table: null` in a
 * sectioned row and fails loudly instead of writing a partial campaign back.
 *
 * A read returns an opaque **version** token (revision, `write_id`, and the manifest when
 * sectioned). Every write sets a fresh random `write_id`, so revision plus `write_id` identify one
 * written body; guards (`roomVersionSql`) compare those and no longer the body, which in
 * sectioned form is not the whole campaign. Dependent statements in the same D1 batch guard on
 * the write's `write_id` (`roomCommittedSql`), so they apply only if the room write committed.
 */

/**
 * @typedef {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} Database
 * @typedef {ReturnType<Database["prepare"]>} Statement
 * @typedef {{ meta: { changes: number } }} StatementResult
 * @typedef {{ path: string[]; hash: string; parts: number; bytes: number }} SectionEntry
 * @typedef {{ readonly code: string; readonly revision: number; readonly writeId: string | null;
 *   readonly sections: readonly SectionEntry[] | null }} RoomVersion
 * @typedef {{ room: any; readonly body: string; version: RoomVersion; liveBytes?: number }} StoredRoom
 * @typedef {{ sql: string; args: unknown[] }} SqlGuard
 */

/**
 * A stored body above this many UTF-8 bytes is written sectioned. Below it a room stays one
 * inline row, as before step 2b, so nearly every room is unaffected by sectioning and stays
 * readable by the previous release. The logical size cap (`ROOM_BODY_LIMIT`, 4 MB since step 3,
 * measured on the assembled stored body) lives in src/lib/quire/room-size.ts.
 */
export const ROOM_SECTION_THRESHOLD = 1_500_000;
/** A section's JSON is split into parts of at most this many UTF-8 bytes (D1 row limit: 2 MB). */
export const ROOM_SECTION_PART_BYTES = 1_000_000;
/**
 * In a sectioned room, a part of the table or journal (or a top-level `testTemplate`/`drafts`)
 * gets its own section when its JSON is at least this large; smaller parts stay in their parent.
 */
export const ROOM_SECTION_MIN_BYTES = 32_768;
/**
 * History on demand (step 4, owner decision 2026-10-28/29). In a sectioned room, the long
 * append-only lists below are cut into immutable pages of this many items. All but the newest
 * full page are stored as their own content-addressed sections (manifest entries with
 * `path: ["$history", ...arrayPath]` and a `page` number); the room keeps the newest
 * `ROOM_HISTORY_PAGE_ITEMS`..`2 * ROOM_HISTORY_PAGE_ITEMS - 1` items (the working window). An
 * append changes only the window, so sealed pages are never rewritten; a page is only replaced
 * if a full-history write changes an item in it.
 */
export const ROOM_HISTORY_PAGE_ITEMS = 512;
/** The paged lists: the live ledger and the chat. */
export const ROOM_HISTORY_ARRAYS = /** @type {const} */ ([
  ["table", "ledger"],
  ["table", "notes"],
]);
/**
 * Top-level key of a room read without its history pages (`readStoredRoom(..., { history: false })`):
 * `{ "table.ledger": PageEntry[], ... }`. A room that carries it is written back with those pages
 * in front of its (window) lists; it is never part of the stored body.
 */
export const HISTORY_KEY = "$history";
const SECTIONS_KEY = "$sections";
const SECTIONED_PREFIX = '{"$sections":';
const SECTION_FORMAT = "lootsplit-room-section-v1";

/** @type {{ threshold?: number; min?: number; part?: number; page?: number }} */
const overrides = {};
/**
 * Test-only: overrides the sectioning threshold, section minimum and part size (pass `{}` to
 * reset). Room suites can also run with LOOTSPLIT_TEST_ROOM_SECTION_THRESHOLD and
 * LOOTSPLIT_TEST_ROOM_SECTION_MIN set, so every write takes the sectioned path. Neither is
 * honoured inside a Cloudflare Worker.
 * LOOTSPLIT_TEST_ROOM_HISTORY_PAGE sets the history page size (items), so suites can run with
 * tiny pages and exercise history on demand everywhere.
 * @param {{ threshold?: number; min?: number; part?: number; page?: number }} values
 */
export function setRoomSectionLimitsForTests(values) {
  for (const key of /** @type {const} */ (["threshold", "min", "part", "page"])) {
    const value = values[key];
    if (value === undefined) delete overrides[key];
    else if (Number.isSafeInteger(value) && value >= 0) overrides[key] = value;
    else throw Error("Invalid room section test limit.");
  }
}
const inWorker = () => globalThis.navigator?.userAgent === "Cloudflare-Workers";
/** @param {"threshold"|"min"|"part"|"page"} key @param {string} variable @param {number} fallback */
function limit(key, variable, fallback) {
  if (overrides[key] !== undefined) return overrides[key];
  if (!inWorker()) {
    const value = globalThis.process?.env?.[variable];
    if (value !== undefined && /^\d+$/.test(value)) return Number(value);
  }
  return fallback;
}
const thresholdBytes = () =>
  limit("threshold", "LOOTSPLIT_TEST_ROOM_SECTION_THRESHOLD", ROOM_SECTION_THRESHOLD);
const minBytes = () => limit("min", "LOOTSPLIT_TEST_ROOM_SECTION_MIN", ROOM_SECTION_MIN_BYTES);
const partBytes = () => Math.max(1, limit("part", "LOOTSPLIT_TEST_ROOM_SECTION_PART", ROOM_SECTION_PART_BYTES));
/** History page size in items (see `ROOM_HISTORY_PAGE_ITEMS`). */
export const historyPageItems = () =>
  Math.max(1, limit("page", "LOOTSPLIT_TEST_ROOM_HISTORY_PAGE", ROOM_HISTORY_PAGE_ITEMS));

const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** @param {string} text */
const utf8Bytes = (text) => encoder.encode(text).length;
/** True when `text` is more than `limit` UTF-8 bytes (without encoding when the length decides). */
function exceeds(/** @type {string} */ text, /** @type {number} */ limit) {
  if (text.length > limit) return true; // every UTF-16 unit is at least one byte
  if (text.length * 3 <= limit) return false; // and at most three
  return utf8Bytes(text) > limit;
}

/**
 * Splits `text` into parts of at most `size` UTF-8 bytes, never inside a character.
 * @param {string} text @param {number} size @returns {string[]}
 */
function chunk(text, size) {
  if (!exceeds(text, size)) return [text];
  const bytes = encoder.encode(text);
  const parts = [];
  for (let start = 0; start < bytes.length; ) {
    let end = Math.min(bytes.length, start + size);
    // Back up to a character boundary (UTF-8 continuation bytes are 10xxxxxx).
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
    if (end === start) end = Math.min(bytes.length, start + 4);
    parts.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return parts;
}

/** @param {string} text */
function sectionHash(text) {
  return createHash("sha256").update(`${SECTION_FORMAT}:${partBytes()}\n`).update(text).digest("hex");
}

/** @param {unknown} value */
const plainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * @typedef {{ path: string[]; page: number; items: number; hash: string; parts: number; bytes: number; keys?: string[] }} PageEntry
 * A sealed history page: `path` is `[HISTORY_KEY, ...arrayPath]`, `page` its position (0 first).
 * `keys` (server-side only, never sent to a browser): the distinct visibility keys of its lines
 * (`pageVisibilityKeys`), so a seat's history walk skips pages it can read nothing of without
 * reading them and without telling the seat they exist.
 */
/**
 * The visibility keys of a history page's lines: a ledger line is read by purse (`purseId`), a
 * chat line by its audience (`to`, `purseId`, `recipientId`), exactly the fields the view's
 * projection rules look at (cloud.server.ts `historyProjector`).
 * @param {readonly string[]} path @param {any[]} items @returns {string[]}
 */
export function pageVisibilityKeys(path, items) {
  const keys = new Set();
  const notes = arrayKey(path) === "table.notes";
  for (const item of items)
    keys.add(notes ? JSON.stringify([item?.to ?? "", item?.purseId ?? "", item?.recipientId ?? ""]) : JSON.stringify([item?.purseId ?? ""]));
  return [...keys].sort();
}
/** @param {any} entry @returns {entry is PageEntry} */
export const isPageEntry = (entry) => Array.isArray(entry?.path) && entry.path[0] === HISTORY_KEY;
/** `"table.ledger"`: the descriptor key of a paged list. @param {readonly string[]} path */
const arrayKey = (path) => path.join(".");
/** @param {any} root @param {readonly string[]} path */
function valueAt(root, path) {
  let value = root;
  for (const key of path) value = value?.[key];
  return value;
}
/** @param {any} root @param {readonly string[]} path @param {unknown} value */
function setAt(root, path, value) {
  const parent = valueAt(root, path.slice(0, -1));
  if (!parent || typeof parent !== "object") return false;
  parent[/** @type {string} */ (path.at(-1))] = value;
  return true;
}

/**
 * The history pages a room read without history carries (`HISTORY_KEY`), validated: per paged
 * list, the entries of pages 0..n-1 in order.
 * @param {unknown} descriptor @returns {Map<string, PageEntry[]>}
 */
function historyDescriptor(descriptor) {
  /** @type {Map<string, PageEntry[]>} */
  const pages = new Map();
  if (descriptor === undefined) return pages;
  const broken = () => Error("A shared campaign's history index is unreadable. The campaign was not changed.");
  if (!plainObject(descriptor)) throw broken();
  for (const [key, list] of Object.entries(/** @type {Record<string, unknown>} */ (descriptor))) {
    const path = ROOM_HISTORY_ARRAYS.find((p) => arrayKey(p) === key);
    if (!path || !Array.isArray(list)) throw broken();
    list.forEach((entry, index) => {
      if (
        !isPageEntry(entry) ||
        arrayKey(entry.path.slice(1)) !== key ||
        entry.page !== index ||
        !Number.isSafeInteger(entry.items) ||
        entry.items < 1 ||
        !HASH.test(entry.hash) ||
        !Number.isSafeInteger(entry.parts) ||
        entry.parts < 1 ||
        (entry.keys !== undefined && (!Array.isArray(entry.keys) || entry.keys.some((k) => typeof k !== "string")))
      )
        throw broken();
    });
    if (list.length) pages.set(key, /** @type {PageEntry[]} */ (list));
  }
  return pages;
}

/**
 * The sectioned form of a stored body: `null` when it stays inline (at or below the threshold).
 * A room read without its history (`HISTORY_KEY`) is always written sectioned: its lists are
 * windows that follow pages already stored, which are referenced (`prior`), never re-sent.
 * @param {string} body
 * @returns {{ row: string; manifest: SectionEntry[]; sections: { hash: string; parts: string[] }[];
 *   prior: PageEntry[]; ledgerPages: Set<string>; workingBytes: number; historyBytes: number } | null}
 */
function sectionBody(body) {
  // The size guard and the write call this for the same body: compute it once.
  if (lastSectioned && lastSectioned.body === body && lastSectioned.limits === limitsKey()) return lastSectioned.result;
  const result = sectionBodyOnce(body);
  lastSectioned = { body, limits: limitsKey(), result };
  return result;
}
/** @type {{ body: string; limits: string; result: ReturnType<typeof sectionBodyOnce> } | null} */
let lastSectioned = null;
const limitsKey = () => `${thresholdBytes()}:${minBytes()}:${partBytes()}:${historyPageItems()}`;
/** @param {string} body */
function sectionBodyOnce(body) {
  const windowed = body.includes(`"${HISTORY_KEY}":`);
  if (!windowed && !exceeds(body, thresholdBytes())) return null;
  const room = JSON.parse(body);
  if (!plainObject(room) || !plainObject(room.table) || SECTIONS_KEY in room) return null;
  const known = historyDescriptor(room[HISTORY_KEY]);
  delete room[HISTORY_KEY];
  const min = minBytes(),
    size = partBytes(),
    pageItems = historyPageItems();
  /** @type {SectionEntry[]} */
  const manifest = [];
  /** @type {Map<string, { hash: string; parts: string[] }>} */
  const sections = new Map();
  /** @type {PageEntry[]} */
  const prior = [];
  /** Ledger pages sealed by this write: their line IDs are indexed (campaign_room_history_ids). */
  /** @type {Set<string>} */
  const ledgerPages = new Set();
  let historyBytes = 0;
  // History pages first (step 4): pages already stored stay as they are; the list (a window after
  // them, or the whole list) is sealed while at least two pages' worth remain, so the room keeps
  // between one and two pages of the newest items.
  for (const path of ROOM_HISTORY_ARRAYS) {
    const before = known.get(arrayKey(path)) ?? [];
    const list = valueAt(room, path);
    if (!Array.isArray(list)) {
      if (before.length) throw Error("A shared campaign's history index does not match its records. The campaign was not changed.");
      continue;
    }
    /** @type {PageEntry[]} */
    const pages = [];
    for (const entry of before) {
      pages.push({ ...entry });
      prior.push(entry);
      historyBytes += entry.bytes;
    }
    let start = 0;
    while (list.length - start >= 2 * pageItems) {
      const items = list.slice(start, start + pageItems);
      const text = JSON.stringify(items);
      const hash = sectionHash(text);
      const parts = sections.get(hash)?.parts ?? chunk(text, size);
      sections.set(hash, { hash, parts });
      const bytes = utf8Bytes(text);
      pages.push({ path: [HISTORY_KEY, ...path], page: pages.length, items: pageItems, hash, parts: parts.length, bytes, keys: pageVisibilityKeys(path, items) });
      if (arrayKey(path) === "table.ledger") ledgerPages.add(hash);
      historyBytes += bytes;
      start += pageItems;
    }
    if (start) setAt(room, path, list.slice(start));
    manifest.push(...pages);
  }
  /** @param {any} parent @param {string} key @param {string[]} path @param {boolean} always */
  const move = (parent, key, path, always) => {
    const value = parent[key];
    if (value === undefined || value === null) return;
    const text = JSON.stringify(value);
    if (!always && !exceeds(text, min - 1)) return;
    const hash = sectionHash(text);
    const parts = sections.get(hash)?.parts ?? chunk(text, size);
    sections.set(hash, { hash, parts });
    manifest.push({ path, hash, parts: parts.length, bytes: utf8Bytes(text) });
    parent[key] = null;
  };
  // Deepest first, so each parent's section excludes the parts moved out of it.
  const journal = room.table.journal;
  if (plainObject(journal))
    for (const key of Object.keys(journal)) move(journal, key, ["table", "journal", key], false);
  for (const key of Object.keys(room.table)) move(room.table, key, ["table", key], false);
  move(room, "table", ["table"], true);
  for (const key of ["testTemplate", "drafts"]) move(room, key, [key], false);
  // Assembly sets shallower paths first; history pages come last, in page order.
  manifest.sort((a, b) => {
    const pa = isPageEntry(a), pb = isPageEntry(b);
    if (pa !== pb) return pa ? 1 : -1;
    return pa ? 0 : a.path.length - b.path.length;
  });
  const row = JSON.stringify({ [SECTIONS_KEY]: manifest, ...room });
  const workingBytes =
    utf8Bytes(row) - utf8Bytes(JSON.stringify(manifest)) +
    manifest.reduce((sum, entry) => sum + (isPageEntry(entry) ? 0 : entry.bytes), 0);
  return { row, manifest, sections: [...sections.values()], prior, ledgerPages, workingBytes, historyBytes };
}

/**
 * The stored room (and its exact body) from a row body and the section parts it references.
 * Returns `null` when a referenced part is missing (a concurrent write replaced it; re-read).
 * With `history: false`, history pages are not needed and not assembled: each paged list holds
 * only its window and the room carries `HISTORY_KEY` (the page entries), and `body` is
 * unavailable (the window is not the stored campaign).
 * @param {string} rowBody @param {Map<string, Map<number, string>>} parts hash -> part -> text
 * @param {{ history?: boolean }} [options]
 * @returns {{ room: any; body: () => string; sections: readonly SectionEntry[] | null } | null}
 */
function assemble(rowBody, parts, options = {}) {
  const history = options.history !== false;
  const row = JSON.parse(rowBody);
  if (!plainObject(row) || !(SECTIONS_KEY in row)) return { room: row, body: () => rowBody, sections: null };
  /** @type {SectionEntry[]} */
  const manifest = row[SECTIONS_KEY];
  if (!Array.isArray(manifest)) throw Error("A shared campaign's storage manifest is unreadable. The campaign was not changed.");
  delete row[SECTIONS_KEY];
  /** @type {Map<string, string>} */
  const texts = new Map();
  /** @param {SectionEntry} entry */
  const textOf = (entry) => {
    let text = texts.get(entry.hash);
    if (text === undefined) {
      const stored = parts.get(entry.hash);
      const list = [];
      for (let index = 0; index < entry.parts; index++) {
        const part = stored?.get(index);
        if (part === undefined) return undefined;
        list.push(part);
      }
      text = list.join("");
      texts.set(entry.hash, text);
    }
    return text;
  };
  /** @type {Map<string, PageEntry[]>} */
  const pages = new Map();
  for (const entry of manifest) {
    if (isPageEntry(entry)) {
      const key = arrayKey(entry.path.slice(1));
      if (!ROOM_HISTORY_ARRAYS.some((p) => arrayKey(p) === key) || entry.page !== (pages.get(key)?.length ?? 0))
        throw Error("A shared campaign's storage manifest is unreadable. The campaign was not changed.");
      pages.set(key, [...(pages.get(key) ?? []), entry]);
      continue;
    }
    const text = textOf(entry);
    if (text === undefined) return null;
    let parent = row;
    for (const key of entry.path.slice(0, -1)) parent = parent?.[key];
    if (!parent || typeof parent !== "object")
      throw Error("A shared campaign's storage manifest is unreadable. The campaign was not changed.");
    parent[/** @type {string} */ (entry.path.at(-1))] = JSON.parse(text);
  }
  if (pages.size) {
    if (history) {
      // The whole list: its pages in order, then the window.
      for (const [key, entries] of pages) {
        const path = key.split(".");
        const window = valueAt(row, path);
        if (!Array.isArray(window)) throw Error("A shared campaign's storage manifest is unreadable. The campaign was not changed.");
        const list = [];
        for (const entry of entries) {
          const text = textOf(entry);
          if (text === undefined) return null;
          for (const item of JSON.parse(text)) list.push(item);
        }
        for (const item of window) list.push(item);
        setAt(row, path, list);
      }
    } else row[HISTORY_KEY] = Object.fromEntries(pages);
  }
  // The exact stored body, recomputed from the unchanged texts only when asked for (callers may
  // edit `room` before reading `body`).
  return {
    room: row,
    body: history
      ? () => JSON.stringify(assemble(rowBody, parts)?.room)
      : () => {
          throw Error("A room read without its history has no stored body. Read it with its history.");
        },
    sections: Object.freeze(manifest.map((entry) => Object.freeze(entry))),
  };
}

/** @param {any} rowBody */
const sectionedRow = (rowBody) => typeof rowBody === "string" && rowBody.startsWith(SECTIONED_PREFIX);

/**
 * @param {{ code: string; revision: number; write_id: string | null; body: string }} row
 * @param {Map<string, Map<number, string>>} parts
 * @param {{ history?: boolean }} [options]
 * @returns {StoredRoom | null}
 */
function storedFrom(row, parts, options) {
  const assembled = assemble(row.body, parts, options);
  if (!assembled) return null;
  let body = /** @type {string | undefined} */ (undefined);
  const manifest = /** @type {{ bytes?: number }[] | null} */ (assembled.sections ?? null);
  // The stored live campaign (working set plus history pages), measured as the size guard
  // measures it (`roomStorageSizes`): the row without its manifest, plus every section.
  const liveBytes = manifest
    ? utf8Bytes(row.body) - utf8Bytes(JSON.stringify(manifest)) + manifest.reduce((sum, entry) => sum + Number(entry.bytes ?? 0), 0)
    : utf8Bytes(row.body);
  return {
    room: assembled.room,
    get body() {
      return (body ??= assembled.body());
    },
    version: version(row.code, row.revision, row.write_id, assembled.sections),
    liveBytes,
  };
}

/**
 * Section parts for `hash -> part -> text`, from rows with hash/part/body columns.
 * @param {any[]} rows
 */
function partsFrom(rows) {
  /** @type {Map<string, Map<number, string>>} */
  const parts = new Map();
  for (const row of rows) {
    if (row.hash == null) continue;
    if (!parts.has(row.hash)) parts.set(row.hash, new Map());
    /** @type {Map<number, string>} */ (parts.get(row.hash)).set(Number(row.part), row.body);
  }
  return parts;
}

const missingSection = () =>
  Object.assign(
    Error("Part of this shared campaign could not be read. Nothing was changed; try again in a moment."),
    { status: 503 },
  );

/**
 * Stored rooms for rows read without their sections (several rooms, or a join): sectioned rows
 * load their parts with one query per room. If a concurrent write replaced a part in between,
 * the room is read again in one consistent statement (`readStoredRoom`); a room deleted in
 * between is left out, as if the first read had missed it.
 * @param {Database} db @param {{ code: string; revision: number; write_id: string | null; body: string }[]} rows
 * @returns {Promise<(StoredRoom | null)[]>}
 */
async function storedFromRows(db, rows) {
  return Promise.all(
    rows.map(async (row) => {
      if (!sectionedRow(row.body) && !row.body.includes(`"${SECTIONS_KEY}"`)) return storedFrom(row, new Map());
      const manifest = JSON.parse(row.body)[SECTIONS_KEY];
      if (!Array.isArray(manifest)) return storedFrom(row, new Map());
      const parts = await readParts(db, row.code, manifest.map((entry) => entry.hash));
      return storedFrom(row, parts) ?? (await readStoredRoom(db, row.code));
    }),
  );
}

/** @param {Database} db @param {string} code @param {string[]} hashes */
async function readParts(db, code, hashes) {
  const rows = await db
    .prepare(
      "SELECT hash,part,body FROM campaign_room_sections WHERE code=? AND hash IN (SELECT value FROM json_each(?))",
    )
    .bind(code, JSON.stringify([...new Set(hashes)]))
    .all();
  return partsFrom(rows.results);
}

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
 * @param {readonly SectionEntry[] | null} sections @returns {RoomVersion}
 */
function version(code, revision, writeId, sections) {
  return Object.freeze({ code, revision, writeId: writeId ?? null, sections });
}

/**
 * The row and every section part its manifest references, in one statement (one consistent
 * snapshot). The manifest is only parsed for rows that start with it, so an inline room costs
 * what it did before.
 */
const readRoomSql = (/** @type {boolean} */ history) => `SELECT r.code AS code,r.revision AS revision,r.write_id AS write_id,r.body AS body,NULL AS hash,NULL AS part FROM campaign_rooms r WHERE r.code=?1
UNION ALL
SELECT s.code,NULL,NULL,s.body,s.hash,s.part FROM campaign_room_sections s WHERE s.code=?1 AND s.hash IN (SELECT json_extract(m.value,'$.hash') FROM campaign_rooms r,json_each(r.body,'$."${SECTIONS_KEY}"') m WHERE r.code=?1 AND substr(r.body,1,${SECTIONED_PREFIX.length})='${SECTIONED_PREFIX}'${history ? "" : ` AND json_extract(m.value,'$.path[0]') IS NOT '${HISTORY_KEY}'`})`;
const READ_ROOM_SQL = readRoomSql(true);
/** The same without history pages (step 4): only the working set's sections. */
const READ_WORKING_SQL = readRoomSql(false);

/**
 * The room exactly as stored (references not hydrated, sections assembled), with its version.
 * `null` when the room does not exist.
 *
 * `history: false` (step 4) reads only the working set: history pages are not read, each paged
 * list holds its newest items and the room carries `HISTORY_KEY`, so a write of it keeps the
 * pages in front of the lists. Such a room has no `body`. Its version is the full manifest.
 * @param {Database} db @param {string} code @param {{ history?: boolean }} [options]
 * @returns {Promise<StoredRoom | null>}
 */
export async function readStoredRoom(db, code, options = {}) {
  const history = options.history !== false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = (await db.prepare(history ? READ_ROOM_SQL : READ_WORKING_SQL).bind(code).all()).results;
    const row = /** @type {any} */ (rows.find((/** @type {any} */ r) => r.hash == null));
    if (!row) return null;
    let stored = storedFrom(row, partsFrom(rows), { history });
    // A sectioned row whose manifest is not its first key (never written so by this module):
    // load its parts separately.
    if (!stored && !sectionedRow(row.body)) {
      const manifest = JSON.parse(row.body)[SECTIONS_KEY];
      if (Array.isArray(manifest))
        stored = storedFrom(
          row,
          await readParts(db, code, manifest.filter((entry) => history || !isPageEntry(entry)).map((entry) => entry.hash)),
          { history },
        );
    }
    if (stored) return stored;
  }
  throw missingSection();
}

/**
 * A stored room and the `dm_encounters` row (`{ body, status }`) that its map combat binding
 * (`table.journal.world.combat.encounterId`) names in this campaign, from one consistent state:
 * an inline room and its encounter are read in one statement, as before step 2b; for a sectioned
 * room (whose binding is in a section) the encounter is read only while the room is still at the
 * version read. For the read-only combat views (room-store.server.ts `readCombatView`), which never
 * need history pages: the room is read without them (step 4).
 * @param {Database} db @param {string} code
 * @returns {Promise<{ stored: StoredRoom; encounter: { body: string; status: string } | null } | null>}
 */
export async function readStoredRoomWithCombatEncounter(db, code) {
  const sql = `${READ_WORKING_SQL}
UNION ALL
SELECT e.code,NULL,e.status,e.body,NULL,-1 FROM dm_encounters e WHERE e.code=?1 AND e.id=(SELECT json_extract(r.body,'$.table.journal.world.combat.encounterId') FROM campaign_rooms r WHERE r.code=?1)`;
  /** @param {any} row */
  const encounterOf = (row) =>
    row && typeof row.body === "string" && typeof row.write_id === "string"
      ? { body: row.body, status: row.write_id }
      : null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = /** @type {any[]} */ ((await db.prepare(sql).bind(code).all()).results);
    const row = rows.find((r) => r.hash == null && r.part == null);
    if (!row) return null;
    const stored =
      storedFrom(row, partsFrom(rows), { history: false }) ??
      (sectionedRow(row.body) ? null : await readStoredRoom(db, code, { history: false }));
    if (!stored) continue;
    if (stored.version.sections === null)
      return { stored, encounter: encounterOf(rows.find((r) => r.part === -1)) };
    const id = stored.room.table?.journal?.world?.combat?.encounterId;
    if (typeof id !== "string") return { stored, encounter: null };
    const same = roomVersionSql(stored.version);
    const found = /** @type {any} */ (
      await db
        .prepare(
          `SELECT ${same.sql} AS same,e.status AS write_id,e.body AS body FROM (SELECT 1) LEFT JOIN dm_encounters e ON e.id=? AND e.code=?`,
        )
        .bind(...same.args, id, code)
        .first()
    );
    if (found?.same) return { stored, encounter: encounterOf(found) };
  }
  throw Error("The table changed. Refresh before sending your turn.");
}

/**
 * The texts of this room's sections or history pages, by hash (only rows of this room code; a
 * hash never reaches another campaign). An entry whose parts are not all stored is left out.
 * @param {Database} db @param {string} code @param {readonly { hash: string; parts: number }[]} entries
 * @returns {Promise<Map<string, string>>}
 */
export async function readRoomSectionTexts(db, code, entries) {
  for (const entry of entries) if (!HASH.test(entry.hash)) throw Error("Invalid room section.");
  /** @type {Map<string, string>} */
  const texts = new Map();
  if (!entries.length) return texts;
  const parts = await readParts(db, code, entries.map((entry) => entry.hash));
  for (const entry of entries) {
    const stored = parts.get(entry.hash);
    const list = [];
    for (let index = 0; index < entry.parts; index++) {
      const part = stored?.get(index);
      if (part === undefined) break;
      list.push(part);
    }
    if (list.length === entry.parts) texts.set(entry.hash, list.join(""));
  }
  return texts;
}

/**
 * Whether any of `ids` is already the ID of a ledger line in this room's sealed history pages
 * (`pageHashes`, from the room as read). Answered from the page ID index
 * (campaign_room_history_ids) without reading the pages; a page missing from the index counts as
 * "maybe", so the caller reads the history instead of trusting it.
 * @param {Database} db @param {string} code @param {readonly string[]} pageHashes @param {readonly string[]} ids
 * @returns {Promise<boolean>}
 */
export async function roomHistoryIdsTaken(db, code, pageHashes, ids) {
  if (!pageHashes.length || !ids.length) return false;
  const pages = JSON.stringify([...new Set(pageHashes)]);
  const row = /** @type {any} */ (
    await db
      .prepare(
        "SELECT (SELECT COUNT(DISTINCT hash) FROM campaign_room_history_ids WHERE code=?1 AND hash IN (SELECT value FROM json_each(?2))) AS indexed,EXISTS(SELECT 1 FROM campaign_room_history_ids WHERE code=?1 AND id IN (SELECT value FROM json_each(?3)) AND hash IN (SELECT value FROM json_each(?2))) AS taken",
      )
      .bind(code, pages, JSON.stringify([...new Set(ids)]))
      .first()
  );
  return !row || Number(row.indexed) !== new Set(pageHashes).size || !!row.taken;
}

/**
 * The paged history of a room read without it (`HISTORY_KEY`), as page entries per list
 * (`"table.ledger"` → pages 0..n-1). Empty for a room read whole.
 * @param {any} room @returns {Map<string, PageEntry[]>}
 */
export function roomHistoryPages(room) {
  return historyDescriptor(room?.[HISTORY_KEY]);
}

/**
 * Puts a room read without its history back together, in place: each paged list gets its pages in
 * front of its window, and `HISTORY_KEY` is removed, so the room is the whole stored campaign.
 * Pages are content-addressed and immutable; one that is gone means a later write replaced that
 * history, so this throws the usual conflict ("The table changed") and the caller re-reads.
 * @template T @param {Database} db @param {T} room @returns {Promise<T>}
 */
export async function restoreRoomHistory(db, room) {
  const value = /** @type {any} */ (room);
  const known = historyDescriptor(value[HISTORY_KEY]);
  delete value[HISTORY_KEY];
  if (!known.size) return room;
  const entries = [...known.values()].flat();
  const texts = await readRoomSectionTexts(db, value.code, entries);
  for (const [key, pages] of known) {
    const path = key.split(".");
    const window = valueAt(value, path);
    const list = [];
    for (const entry of pages) {
      const text = texts.get(entry.hash);
      if (text === undefined) throw Error("The table changed. Refresh before sending your turn.");
      for (const item of JSON.parse(text)) list.push(item);
    }
    if (!Array.isArray(window)) throw Error("A shared campaign's history index does not match its records. The campaign was not changed.");
    for (const item of window) list.push(item);
    setAt(value, path, list);
  }
  return room;
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
    const stored = await storedFromRows(db, /** @type {any[]} */ (rows.results));
    for (const room of stored) if (room) rooms.set(room.version.code, room);
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
  const entries = rows.results.map((/** @type {any} */ row) => {
    const { room_code, room_revision, room_write_id, room_body, ...member } = row;
    return { member, row: { code: room_code, revision: room_revision, write_id: room_write_id, body: room_body } };
  });
  const stored = await storedFromRows(db, entries.map((entry) => entry.row));
  return entries.flatMap((entry, index) => {
    const room = stored[index];
    return room ? [{ member: entry.member, stored: room }] : [];
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

/** @param {RoomVersion} a @param {RoomVersion} b */
export function sameRoomVersion(a, b) {
  return a.code === b.code && a.revision === b.revision && a.writeId === b.writeId;
}

/**
 * True while the room is exactly at `version` (no write since that read). Every write sets a
 * fresh `write_id`, so revision plus `write_id` identify one written body; the body itself is no
 * longer compared (in sectioned form the row is not the whole campaign).
 * @param {RoomVersion} expected @returns {SqlGuard}
 */
export function roomVersionSql(expected) {
  return {
    sql: "EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND revision=? AND write_id IS ?)",
    args: [expected.code, expected.revision, expected.writeId],
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
 * Statements that write `room` (stored form) to storage, for the caller's own `db.batch`. The
 * room row statement is always `statements[0]`; pass all of `statements` to the batch.
 *
 * - `expect`: a version from a read (the row must still be at it), `{ revision }` (the revision
 *   column must equal it; for callers whose guard is revision-only), or `null` for no version
 *   guard, which is allowed only with `extraWhere` (for example an encounter award whose receipt
 *   insert, earlier in the batch, carries the version guard).
 * - `create: true`: insert a new row instead (fails on an existing code, as before).
 * - `extraWhere`/`extraArgs`: an additional SQL predicate (hosted-campaign limit, staff guard,
 *   EXISTS(...)) ANDed into the write.
 * - `body`: the exact serialized stored body, when the caller already encoded it (defaults to
 *   `JSON.stringify(room)`).
 * - `present`: section hashes (with their part counts) the caller read as stored for this room,
 *   so they are not uploaded again (`readRoomSectionHashes`). A version `expect` supplies its own.
 *
 * Sectioned writes (body above `ROOM_SECTION_THRESHOLD`): the row statement also requires every
 * section it reuses without uploading to be stored, so a stale `present` makes the write fail
 * like a changed room instead of referencing a missing part. New sections are inserted after
 * the row, only if it committed (`INSERT OR IGNORE`: content-addressed rows are immutable), and
 * the room's sections that the new manifest no longer references are deleted, also only if it
 * committed. An inline write that may replace a sectioned room runs the same cleanup.
 *
 * The write always sets a fresh `write_id`. Statements that must apply only if this write commits
 * go after it in the batch and guard on `committed` (or `roomCommittedSql(code, writeId)`).
 * `changed(results, batch)` tells whether the room write committed.
 *
 * @param {Database} db @param {any} room
 * @param {{ expect?: RoomVersion | { revision: number } | null; create?: boolean; body?: string;
 *   extraWhere?: string; extraArgs?: unknown[]; writeId?: string;
 *   present?: Map<string, number> }} options
 */
export function roomWriteStatements(db, room, options) {
  const code = room.code,
    revision = room.revision;
  if (typeof code !== "string" || !Number.isSafeInteger(revision))
    throw Error("A room write needs the room code and a whole-number revision.");
  const body = options.body ?? JSON.stringify(room);
  const writeId = options.writeId ?? crypto.randomUUID();
  const extra = options.extraWhere ? [`(${options.extraWhere})`] : [];
  const extraArgs = [...(options.extraArgs ?? [])];
  const expect = options.expect;
  if (!options.create) {
    if (expect === undefined) throw Error("A room update must state what it expects.");
    if (expect === null && !extra.length)
      throw Error("An unversioned room update needs another guard.");
    if (expect && "writeId" in expect && expect.code !== code)
      throw Error("The room version belongs to another campaign.");
  }
  const sectioned = sectionBody(body);
  lastSectioned = null; // never keep a campaign's text in the isolate between requests
  const rowBody = sectioned ? sectioned.row : body;
  const committed = roomCommittedSql(code, writeId);
  /** Sections believed stored for this room: hash -> parts. */
  const present = new Map(options.present ?? []);
  if (!options.create && expect && "writeId" in expect)
    for (const entry of expect.sections ?? []) present.set(entry.hash, entry.parts);
  // History pages a room read without its history refers to (step 4): stored already, never
  // re-sent (the writer does not hold their text), so they are required like reused sections.
  /** @type {Map<string, number>} */
  const prior = new Map((sectioned?.prior ?? []).map((entry) => [entry.hash, entry.parts]));
  if (options.create && prior.size) throw Error("A new room cannot refer to stored history pages.");
  const reused = options.create
    ? []
    : (sectioned?.sections ?? []).filter((s) => prior.has(s.hash) || present.get(s.hash) === s.parts.length);
  const upload = (sectioned?.sections ?? []).filter((s) => !reused.includes(s));
  /** @type {Map<string, number>} */
  const required = new Map([...prior, ...reused.map((s) => /** @type {[string, number]} */ ([s.hash, s.parts.length]))]);
  if (required.size) {
    // Every reused section and referenced history page must still be stored when this row is written.
    extra.push(
      "(SELECT COUNT(*) FROM campaign_room_sections s WHERE s.code=? AND s.hash IN (SELECT value FROM json_each(?)))=?",
    );
    extraArgs.push(
      code,
      JSON.stringify([...required.keys()]),
      [...required.values()].reduce((sum, parts) => sum + parts, 0),
    );
  }
  /** @type {Statement} */
  let statement;
  if (options.create) {
    statement = extra.length
      ? db
          .prepare(
            `INSERT INTO campaign_rooms (code, revision, body, write_id) SELECT ?, ?, ?, ? WHERE ${extra.join(" AND ")}`,
          )
          .bind(code, revision, rowBody, writeId, ...extraArgs)
      : db
          .prepare("INSERT INTO campaign_rooms (code, revision, body, write_id) VALUES (?, ?, ?, ?)")
          .bind(code, revision, rowBody, writeId);
  } else {
    /** @type {string[]} */
    const where = ["code = ?"];
    /** @type {unknown[]} */
    const whereArgs = [code];
    if (expect && "writeId" in expect) {
      where.push("revision = ?", "write_id IS ?");
      whereArgs.push(expect.revision, expect.writeId);
    } else if (expect) {
      where.push("revision = ?");
      whereArgs.push(expect.revision);
    }
    statement = db
      .prepare(
        `UPDATE campaign_rooms SET revision = ?, body = ?, write_id = ? WHERE ${[...where, ...extra].join(" AND ")}`,
      )
      .bind(revision, rowBody, writeId, ...whereArgs, ...extraArgs);
  }
  const statements = [statement];
  for (const section of upload)
    section.parts.forEach((part, index) =>
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO campaign_room_sections (code, hash, part, body) SELECT ?, ?, ?, ? WHERE ${committed.sql}`,
          )
          .bind(code, section.hash, index, part, ...committed.args),
      ),
    );
  // The line IDs of ledger pages this write uploads (step 4), for `roomHistoryIdsTaken`.
  for (const section of upload)
    if (sectioned?.ledgerPages.has(section.hash))
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO campaign_room_history_ids (code, hash, id) SELECT ?, ?, json_extract(j.value,'$.id') FROM json_each(?) j WHERE json_type(j.value,'$.id')='text' AND ${committed.sql}`,
          )
          .bind(code, section.hash, section.parts.join(""), ...committed.args),
      );
  // Sections this write no longer references, on every update (step 3): a version read that saw
  // an inline row does not prove the room has no section rows (a previous-release Worker may have
  // written an inline body over a sectioned room), so orphans are always removed with the next
  // committed write. Guarded on this write's write_id, so a write that lost its race deletes
  // nothing, and the new manifest's hashes are never deleted. A create has nothing to replace.
  if (!options.create) {
    const kept = JSON.stringify([...new Set((sectioned?.manifest ?? []).map((s) => s.hash))]);
    statements.push(
      db
        .prepare(
          `DELETE FROM campaign_room_sections WHERE code = ? AND hash NOT IN (SELECT value FROM json_each(?)) AND ${committed.sql}`,
        )
        .bind(code, kept, ...committed.args),
    );
    // With them, the line IDs of history pages it no longer references. Only paged rooms have
    // any, and only this release writes paged rooms, so an update of a room read inline skips it.
    const inlineRead = !!expect && "writeId" in expect && expect.sections === null;
    if (sectioned || !inlineRead)
      statements.push(
        db
          .prepare(
            `DELETE FROM campaign_room_history_ids WHERE code = ? AND hash NOT IN (SELECT value FROM json_each(?)) AND ${committed.sql}`,
          )
          .bind(code, kept, ...committed.args),
      );
  }
  return {
    statements,
    writeId,
    body,
    /** The room's version once this write commits. */
    version: version(code, revision, writeId, sectioned ? Object.freeze(sectioned.manifest) : null),
    committed,
    /** @param {StatementResult[]} results @param {Statement[]} batch the array passed to db.batch */
    changed(results, batch) {
      const index = batch.indexOf(statement);
      if (index < 0) throw Error("The room write is not part of this batch.");
      return !!results[index]?.meta.changes;
    },
  };
}

/**
 * The section hashes stored for a room, with their part counts (hashes and part numbers only,
 * never bodies), for `roomWriteStatements(..., { present })` when the caller's guard is not a
 * version read.
 * @param {Database} db @param {string} code @returns {Promise<Map<string, number>>}
 */
export async function readRoomSectionHashes(db, code) {
  const rows = await db
    .prepare("SELECT hash,COUNT(*) AS parts FROM campaign_room_sections WHERE code=? GROUP BY hash")
    .bind(code)
    .all();
  return new Map(rows.results.map((/** @type {any} */ row) => [row.hash, Number(row.parts)]));
}

/**
 * True when a stored body is written sectioned: above the inline threshold, or a room read without
 * its history (its pages stay sectioned). @param {string} body
 */
export function roomBodySectioned(body) {
  return exceeds(body, thresholdBytes()) || body.includes(`"${HISTORY_KEY}":`);
}

/**
 * Whether a stored body would be written sectioned, and its sizes in UTF-8 bytes:
 * - `bytes`: the body as given (for a room read without history, its working form);
 * - `workingBytes`: what a read without history loads (row and sections, not history pages);
 *   this is what `ROOM_BODY_LIMIT` caps since step 4;
 * - `historyBytes`: the sealed history pages (stored before or sealed by this write);
 * - `liveBytes`: working set plus history pages, the whole live campaign;
 * - `rowBytes` what the `campaign_rooms` row holds and `sectionBytes` the section parts this
 *   write would store or reuse (each content-addressed section counted once).
 * @param {string} body
 */
export function roomStorageSizes(body) {
  const sectioned = sectionBody(body);
  const bytes = utf8Bytes(body);
  if (!sectioned)
    return { sectioned: false, bytes, workingBytes: bytes, historyBytes: 0, liveBytes: bytes, rowBytes: bytes, sectionBytes: 0, sections: 0, pages: 0 };
  return {
    sectioned: true,
    bytes,
    workingBytes: sectioned.workingBytes,
    historyBytes: sectioned.historyBytes,
    liveBytes: sectioned.workingBytes + sectioned.historyBytes,
    rowBytes: utf8Bytes(sectioned.row),
    sectionBytes: sectioned.sections.reduce((sum, s) => sum + utf8Bytes(s.parts.join("")), 0),
    sections: sectioned.sections.length,
    pages: sectioned.manifest.filter(isPageEntry).length,
  };
}

/**
 * Deletes a room row, guarded like a write (`expect` is a read's version or `{ revision }`).
 * Follow it in the same batch with `roomSectionsDeletedStatement`.
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
    where.push("write_id IS ?");
    args.push(expect.writeId);
  }
  if (options.extraWhere) where.push(`(${options.extraWhere})`);
  return db
    .prepare(`DELETE FROM campaign_rooms WHERE ${where.join(" AND ")}`)
    .bind(...args, ...(options.extraArgs ?? []));
}

/**
 * Removes a room's sections once its row is gone (only then), for the batch that deletes it.
 * @param {Database} db @param {string} code
 */
export function roomSectionsDeletedStatement(db, code) {
  return db
    .prepare(
      "DELETE FROM campaign_room_sections WHERE code = ? AND NOT EXISTS (SELECT 1 FROM campaign_rooms WHERE code = ?)",
    )
    .bind(code, code);
}

/**
 * One value a partial read returns (`readRoomPaths`): the JSON value at `path` (keys, each a
 * plain identifier) of the assembled stored room. With `sql`, SQLite computes the result instead:
 * `sql(source, at, arg)` returns an SQL expression yielding JSON text, where `source` is an SQL
 * expression of JSON text containing the value, `at` the JSON path literal of the value inside it,
 * and `arg(i)` the placeholder of the caller's `args[i]`. For example, one map without its art
 * (map signals) or a projection of purses, so the Worker never receives the rest.
 * @typedef {{ path: string[]; sql?: (source: string, at: string, arg: (index: number) => string) => string }} RoomPathRead
 */
const PATH_KEY = /^\w+$/;
const HASH = /^[0-9a-f]{64}$/;
/** @param {string[]} path */
const jsonPathLiteral = (path) => `'$${path.map((key) => `.${key}`).join("")}'`;
/** @param {readonly string[]} prefix @param {readonly string[]} path */
const startsWith = (prefix, path) => prefix.length <= path.length && prefix.every((key, i) => path[i] === key);

/**
 * Partial read: only the requested values of a room, with its version, without assembling it.
 * An inline room is read in one statement (SQLite extracts the values from the row). For a
 * sectioned room only the sections that hold the requested values are touched: a value inside a
 * single-part section is extracted by SQLite from that part, so the Worker never receives (or
 * parses) the rest of it; a value whose section has several parts, or with larger parts split
 * out below it, is assembled from just those sections. Everything comes from one consistent
 * state: the section statement also re-reads the row's `write_id` and the read is retried if a
 * write landed in between. Never reads seats or tokens unless asked for them.
 * `null` when the room does not exist; a missing value is `null`.
 * @param {Database} db @param {string} code @param {RoomPathRead[]} reads @param {unknown[]} [args]
 * @returns {Promise<{ version: RoomVersion; values: unknown[] } | null>}
 */
export async function readRoomPaths(db, code, reads, args = []) {
  for (const read of reads)
    if (!read.path.length || !read.path.every((key) => PATH_KEY.test(key))) throw Error("Invalid room path.");
  // ?1 is the code; caller arguments follow.
  const arg = (/** @type {number} */ index) => `?${index + 2}`;
  /** @param {RoomPathRead} read @param {string} source @param {string} at */
  const expression = (read, source, at) =>
    read.sql ? `(${read.sql(source, at, arg)})` : `json_extract(${source},${at},'$."$none"')`;
  /** @param {RoomPathRead} read @param {unknown} result */
  const valueOf = (read, result) => {
    if (result === null || result === undefined) return null;
    const parsed = JSON.parse(/** @type {string} */ (result));
    return read.sql ? parsed : parsed[0];
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    // The row: version, manifest (only for sectioned rows) and every value as stored in the row
    // (a value under a section is its `null` placeholder there; replaced below).
    const row = /** @type {any} */ (
      await db
        .prepare(
          `SELECT revision,write_id,CASE WHEN substr(body,1,${SECTIONED_PREFIX.length})='${SECTIONED_PREFIX}' THEN json_extract(body,'$."${SECTIONS_KEY}"') END AS manifest${reads
            .map((read, i) => `,${expression(read, "body", jsonPathLiteral(read.path))} AS v${i}`)
            .join("")} FROM campaign_rooms WHERE code=?1`,
        )
        .bind(code, ...args)
        .first()
    );
    if (!row) return null;
    /** @type {SectionEntry[] | null} */
    const manifest = row.manifest ? JSON.parse(row.manifest) : null;
    const values = reads.map((read, i) => valueOf(read, row[`v${i}`]));
    if (!manifest) return { version: version(code, row.revision, row.write_id, null), values };
    for (const entry of manifest)
      if (!HASH.test(entry.hash) || !(isPageEntry(entry) ? entry.path.slice(1) : entry.path).every((key) => PATH_KEY.test(key)))
        throw Error("A shared campaign's storage manifest is unreadable. The campaign was not changed.");
    const sectionEntries = manifest.filter((e) => !isPageEntry(e));
    const pageEntries = /** @type {PageEntry[]} */ (manifest.filter(isPageEntry));
    /**
     * Per read: the deepest section holding it, the sections split out below it, and the history
     * pages of paged lists at or below it (step 4: the whole list is returned, as stored).
     */
    const plans = reads.map((read) => {
      const covering = sectionEntries.filter((e) => startsWith(e.path, read.path)).sort((a, b) => b.path.length - a.path.length)[0];
      const below = sectionEntries.filter((e) => e.path.length > read.path.length && startsWith(read.path, e.path));
      const pages = pageEntries.filter((e) => startsWith(read.path, e.path.slice(1)));
      if (pageEntries.some((e) => e.path.length - 1 < read.path.length && startsWith(e.path.slice(1), read.path)))
        throw Error("Invalid room path: a partial read cannot start inside a paged history list.");
      if (pages.length && !covering) throw Error("A shared campaign's storage manifest is unreadable. The campaign was not changed.");
      return { covering, below, pages, extract: !!covering && covering.parts === 1 && !below.length && !pages.length };
    });
    /** Hashes whose whole text is needed (assembled in the Worker). */
    const whole = new Set(
      plans.flatMap((plan) => (plan.covering && !plan.extract ? [plan.covering, ...plan.below, ...plan.pages] : [])).map((e) => e.hash),
    );
    const selects = [`SELECT 'v' AS k,NULL AS i,NULL AS hash,NULL AS part,write_id AS body FROM campaign_rooms WHERE code=?1`];
    plans.forEach((plan, i) => {
      if (!plan.extract || !plan.covering) return;
      const at = jsonPathLiteral(reads[i].path.slice(plan.covering.path.length));
      selects.push(
        `SELECT 'x',${i},s.hash,s.part,${expression(reads[i], "s.body", at)} FROM campaign_room_sections s WHERE s.code=?1 AND s.hash='${plan.covering.hash}' AND s.part=0`,
      );
    });
    if (whole.size)
      selects.push(
        `SELECT 'p',NULL,s.hash,s.part,s.body FROM campaign_room_sections s WHERE s.code=?1 AND s.hash IN (${[...whole].map((h) => `'${h}'`).join(",")})`,
      );
    const rows = /** @type {any[]} */ ((await db.prepare(selects.join("\nUNION ALL\n")).bind(code, ...args).all()).results);
    const current = rows.find((r) => r.k === "v");
    if (!current) return null; // deleted in between
    if (current.body !== row.write_id) continue;
    const parts = partsFrom(rows.filter((r) => r.k === "p"));
    /** @param {SectionEntry} entry */
    const textOf = (entry) => {
      const stored = parts.get(entry.hash);
      const list = [];
      for (let index = 0; index < entry.parts; index++) {
        const part = stored?.get(index);
        if (part === undefined) return undefined;
        list.push(part);
      }
      return list.join("");
    };
    let complete = true;
    for (const [i, plan] of plans.entries()) {
      if (!plan.covering) continue;
      if (plan.extract) {
        const found = rows.find((r) => r.k === "x" && r.i === i);
        if (!found) complete = false;
        else values[i] = valueOf(reads[i], found.body);
        continue;
      }
      // Assemble just this value: its section, walked down to the value, with the sections
      // below it put back into their placeholders (shallower first).
      const text = textOf(plan.covering);
      if (text === undefined) {
        complete = false;
        continue;
      }
      const holder = { value: JSON.parse(text) };
      let value = holder.value;
      for (const key of reads[i].path.slice(plan.covering.path.length)) value = value?.[key];
      const target = { value };
      for (const entry of [...plan.below].sort((a, b) => a.path.length - b.path.length)) {
        const below = textOf(entry);
        if (below === undefined) {
          complete = false;
          break;
        }
        /** @type {any} */
        let parent = target;
        const rest = ["value", ...entry.path.slice(reads[i].path.length)];
        for (const key of rest.slice(0, -1)) parent = parent?.[key];
        if (parent && typeof parent === "object") parent[/** @type {string} */ (rest.at(-1))] = JSON.parse(below);
      }
      // History pages go in front of their (window) lists, in page order.
      /** @type {Map<string, PageEntry[]>} */
      const lists = new Map();
      for (const entry of plan.pages) lists.set(arrayKey(entry.path.slice(1)), [...(lists.get(arrayKey(entry.path.slice(1))) ?? []), entry]);
      for (const [key, entries] of lists) {
        if (!complete) break;
        const rest = ["value", ...key.split(".").slice(reads[i].path.length)];
        const window = valueAt(target, rest);
        if (!Array.isArray(window)) {
          complete = false;
          break;
        }
        const list = [];
        for (const entry of [...entries].sort((a, b) => a.page - b.page)) {
          const page = textOf(entry);
          if (page === undefined) {
            complete = false;
            break;
          }
          for (const item of JSON.parse(page)) list.push(item);
        }
        for (const item of window) list.push(item);
        setAt(target, rest, list);
      }
      if (!complete) continue;
      if (target.value === undefined) values[i] = null;
      else if (reads[i].sql) {
        // The caller's projection, computed by SQLite on just this assembled value.
        const projected = /** @type {any} */ (
          await db.prepare(`SELECT ${expression(reads[i], "?1", "'$'")} AS v`).bind(JSON.stringify(target.value), ...args).first()
        );
        values[i] = valueOf(reads[i], projected?.v);
      } else values[i] = target.value;
    }
    if (complete) return { version: version(code, row.revision, row.write_id, Object.freeze(manifest)), values };
  }
  throw missingSection();
}

/**
 * Stored table parts (`fields` of `room.table`, as JSON text or null) of every room matching
 * `where` (a SQL predicate on top-level fields of `campaign_rooms`, such as
 * `json_extract(body,'$.testMode')`), one room at a time, keyset-paginated by code. Inline rooms
 * are projected in SQL, a page at a time; a sectioned room is read with `readRoomPaths`, only the
 * sections holding those fields, and only when the caller asks for it, so at most one sectioned
 * room's fields are in memory. Seats, tokens and chat are never read. For site-wide aggregates
 * (game analytics).
 * @param {Database} db @param {readonly string[]} fields
 * @param {{ where?: string; whereArgs?: unknown[]; pageSize?: number }} [options]
 * @returns {AsyncGenerator<{ code: string; fields: Record<string, string | null> }>}
 */
export async function* readRoomTables(db, fields, options = {}) {
  for (const field of fields) if (!PATH_KEY.test(field)) throw Error("Invalid room table field.");
  const limit = options.pageSize ?? 100;
  const columns = fields
    .map((field, index) => `CASE WHEN sectioned THEN NULL ELSE json_extract(body,'$.table.${field}') END AS f${index}`)
    .join(",");
  for (let after = ""; ; ) {
    const rows = await db
      .prepare(
        `SELECT code,sectioned,${columns} FROM (SELECT code,body,json_type(body,'$."${SECTIONS_KEY}"') IS NOT NULL AS sectioned FROM campaign_rooms WHERE code > ?${options.where ? ` AND (${options.where})` : ""} ORDER BY code LIMIT ?) ORDER BY code`,
      )
      .bind(after, ...(options.whereArgs ?? []), limit)
      .all();
    for (const row of /** @type {any[]} */ (rows.results)) {
      /** @type {Record<string, string | null>} */
      const values = {};
      if (row.sectioned) {
        const read = await readRoomPaths(db, row.code, fields.map((field) => ({ path: ["table", field] })));
        if (read)
          fields.forEach((field, index) => {
            const value = read.values[index];
            values[field] = value === null || value === undefined ? null : JSON.stringify(value);
          });
        else for (const field of fields) values[field] = null;
      } else fields.forEach((field, index) => (values[field] = row[`f${index}`] ?? null));
      yield { code: row.code, fields: values };
      after = row.code;
    }
    if (rows.results.length < limit) return;
  }
}
