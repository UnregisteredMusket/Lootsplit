/**
 * Section-aware room sync (tabletop protocol 11, sectioned storage step 3).
 *
 * The unit of caching is the seat's **projected** view, never stored room sections: a room view
 * is already filtered for the seat that asked (cloud.server.ts `view`), so the server splits that
 * projected `table` into sections and names each by a hash salted with the room code, the seat ID
 * and the protocol. A client keeps the section texts it holds (by hash), tells the server which
 * hashes it has, and receives only the sections it lacks: up to a small inline budget in the same
 * response, the rest from `readCloudSections`, which re-projects for the requesting seat and serves
 * only hashes of that seat's own current projection.
 *
 * Splitting: each top-level part of the table, and each part of its journal, whose JSON is at
 * least `VIEW_SECTION_MIN_CHARS` long becomes a section; its place in the table is `null`. A large
 * array (ledger, messages, report list...) is split by item count into chunks of
 * `VIEW_SECTION_CHUNK_ITEMS`, so appending a line changes only the last chunk. Assembly puts the
 * parsed sections back in place, which gives exactly the projected table the server split.
 *
 * Pure functions, shared by the Worker and the browser (hashing uses Web Crypto).
 */
import type { CloudTable } from "./cloud.ts";

export const VIEW_SECTIONS_VERSION = 1;
/** Parts of the projected table shorter than this (JSON characters) stay in the response's table. */
export const VIEW_SECTION_MIN_CHARS = 16_384;
/** Large arrays are split into chunks of this many items (fixed boundaries: appends change one). */
export const VIEW_SECTION_CHUNK_ITEMS = 512;
/** Section texts a response carries itself, beyond which the client fetches the rest. */
export const VIEW_INLINE_CHARS = 512_000;
/** Section texts one `readCloudSections` response carries at most. */
export const VIEW_BATCH_CHARS = 1_500_000;
/** At most this many hashes per request (`have` and `hashes`). */
export const VIEW_MAX_HASHES = 4_000;

/**
 * One section of a projected table: `p` the path (one or two keys: `[key]` or
 * `["journal", key]`), `h` its hash, `b` its JSON length, and for a chunk of an array `c` (its
 * index) and `n` (the number of chunks).
 */
export type ViewSectionEntry = { p: string[]; h: string; b: number; c?: number; n?: number };
export type ViewSections = {
  v: typeof VIEW_SECTIONS_VERSION;
  entries: ViewSectionEntry[];
  /** Section texts sent with this response, by hash. */
  data: Record<string, string>;
};
export const HASH_PATTERN = /^[0-9a-f]{32}$/;

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes).slice(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** The hash salt: per room, seat and protocol, so a hash only ever names that seat's projection. */
export function viewSectionSalt(code: string, seatId: string, protocol: number) {
  return `lootsplit-view-section-v${VIEW_SECTIONS_VERSION}\n${protocol}\n${code}\n${seatId}`;
}

/**
 * Splits a projected table into sections. Returns the table with `null` in each section's place,
 * the entries in assembly order, and every section's text by hash.
 */
export async function splitViewTable(
  table: CloudTable,
  salt: string,
): Promise<{ table: CloudTable; entries: ViewSectionEntry[]; texts: Map<string, string> }> {
  const entries: ViewSectionEntry[] = [];
  const texts = new Map<string, string>();
  const out: Record<string, unknown> = { ...table };
  const journal = table.journal ? ({ ...table.journal } as Record<string, unknown>) : undefined;
  const take = async (holder: Record<string, unknown>, key: string, path: string[]) => {
    const value = holder[key];
    if (value === null || value === undefined) return;
    if (Array.isArray(value) && value.length > VIEW_SECTION_CHUNK_ITEMS) {
      const chunks: string[] = [];
      for (let start = 0; start < value.length; start += VIEW_SECTION_CHUNK_ITEMS)
        chunks.push(JSON.stringify(value.slice(start, start + VIEW_SECTION_CHUNK_ITEMS)));
      if (chunks.reduce((sum, text) => sum + text.length, 0) < VIEW_SECTION_MIN_CHARS) return;
      for (const [index, text] of chunks.entries()) {
        const h = await digest(`${salt}\n${path.join(".")}\n${index}\n${text}`);
        entries.push({ p: path, h, b: text.length, c: index, n: chunks.length });
        texts.set(h, text);
      }
    } else {
      const text = JSON.stringify(value);
      if (text === undefined || text.length < VIEW_SECTION_MIN_CHARS) return;
      const h = await digest(`${salt}\n${path.join(".")}\n\n${text}`);
      entries.push({ p: path, h, b: text.length });
      texts.set(h, text);
    }
    holder[key] = null;
  };
  if (journal) for (const key of Object.keys(journal)) await take(journal, key, ["journal", key]);
  for (const key of Object.keys(out)) if (key !== "journal") await take(out, key, [key]);
  if (journal) out.journal = journal;
  return { table: out as unknown as CloudTable, entries, texts };
}

/**
 * The table with every section put back from `texts` (hash -> JSON text). Throws when a text is
 * missing or an entry is malformed; never returns a partial table.
 */
export function assembleViewTable(
  table: CloudTable,
  entries: readonly ViewSectionEntry[],
  texts: { get(hash: string): string | undefined },
): CloudTable {
  const out: Record<string, unknown> = { ...table };
  let journal: Record<string, unknown> | undefined;
  const chunks = new Map<string, unknown[][]>();
  for (const entry of entries) {
    const text = texts.get(entry.h);
    if (text === undefined) throw Error("Part of the campaign has not finished loading.");
    const valid =
      Array.isArray(entry.p) &&
      (entry.p.length === 1 || (entry.p.length === 2 && entry.p[0] === "journal")) &&
      entry.p.every(
        (key) =>
          typeof key === "string" &&
          key !== "__proto__" &&
          key !== "constructor" &&
          key !== "prototype",
      );
    if (!valid) throw Error("The campaign's section list is unreadable.");
    const value: unknown = JSON.parse(text);
    const id = entry.p.join(".");
    if (entry.c !== undefined) {
      if (!Array.isArray(value) || !Number.isSafeInteger(entry.c) || !Number.isSafeInteger(entry.n))
        throw Error("The campaign's section list is unreadable.");
      const list =
        chunks.get(id) ?? Array.from({ length: entry.n! }, () => undefined as unknown as unknown[]);
      if (list.length !== entry.n || entry.c! < 0 || entry.c! >= list.length)
        throw Error("The campaign's section list is unreadable.");
      list[entry.c!] = value;
      chunks.set(id, list);
      continue;
    }
    set(entry.p, value);
  }
  for (const [id, list] of chunks) {
    if (list.some((chunk) => !Array.isArray(chunk)))
      throw Error("Part of the campaign has not finished loading.");
    set(id.split("."), list.flat());
  }
  if (journal) out.journal = journal;
  return out as unknown as CloudTable;

  function set(path: string[], value: unknown) {
    if (path.length === 1) out[path[0]!] = value;
    else {
      journal ??= { ...((out.journal as Record<string, unknown> | undefined) ?? {}) };
      journal[path[1]!] = value;
    }
  }
}

/** Reads a client's list of hashes (`have`/`hashes`): only well-formed hashes, bounded. */
export function readHashList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((h): h is string => typeof h === "string" && HASH_PATTERN.test(h))),
  ].slice(0, VIEW_MAX_HASHES);
}
