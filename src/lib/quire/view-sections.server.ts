/**
 * Server side of section-aware room sync (tabletop protocol 11; view-sections.ts).
 *
 * - `roomViewResponse` splits a room view's projected table for protocol 11+ clients and sends
 *   only the sections the client does not already hold (up to `VIEW_INLINE_CHARS`).
 * - `readViewSections` serves sections by hash for `readCloudSections`. It authorizes exactly like
 *   a room read (closed room, seat token) and only ever serves hashes of the requesting seat's own
 *   current projection: a hash from another seat's manifest (salted with that seat's ID), from DM
 *   data or from another campaign is simply not in it and is reported missing.
 *
 * Projections are cached per isolate by (room, seat, protocol, revision, write_id): a client
 * loading a large campaign in batches does not make the Worker read and project the room for each
 * batch. A cached projection is used only after a fresh light read shows the same seat token at
 * the same revision and write_id, so a changed room, seat or permission is never served from it.
 */
import {
  HASH_PATTERN,
  VIEW_BATCH_CHARS,
  VIEW_INLINE_CHARS,
  readHashList,
  splitViewTable,
  viewSectionSalt,
  type ViewSections,
} from "./view-sections.ts";
import { VIEW_SECTIONS_PROTOCOL, tabletopResponse } from "./tabletop-protocol.ts";
import type { CloudTable } from "./cloud.ts";

/** Server-only, non-enumerable on a RoomView: the storage version the view was projected from. */
export const VIEW_VERSION_KEY = Symbol.for("lootsplit.room-view-version");
type Version = { revision: number; writeId: string | null };
export function viewVersion(view: object): Version | null {
  return (view as { [VIEW_VERSION_KEY]?: Version })[VIEW_VERSION_KEY] ?? null;
}

/**
 * Projected section texts kept per isolate (UTF-16 code units, all entries together; about 4.5 MB
 * of ASCII text, at most twice that otherwise). Sized for one projection of a campaign at the
 * 4 MB cap: a batched first load is then served from it, while the isolate keeps its memory for
 * concurrent full reads (each needs about 14 bytes of heap per stored byte; three concurrent reads
 * of a 4.3 MB campaign fit 128 MB, measured with this cache in place). LRU; a larger projection
 * is not cached.
 */
export const VIEW_CACHE_CHARS = 4_500_000;
const cache = new Map<string, { texts: Map<string, string>; chars: number }>();
let cachedChars = 0;
const cacheKey = (code: string, seatId: string, protocol: number, version: Version) =>
  JSON.stringify([code, seatId, protocol, version.revision, version.writeId]);
function remember(key: string, texts: Map<string, string>) {
  const chars = [...texts.values()].reduce((sum, text) => sum + text.length, 0);
  if (chars > VIEW_CACHE_CHARS) return;
  const previous = cache.get(key);
  if (previous) {
    cache.delete(key);
    cachedChars -= previous.chars;
  }
  cache.set(key, { texts, chars });
  cachedChars += chars;
  for (const [oldest, entry] of cache) {
    if (cachedChars <= VIEW_CACHE_CHARS) break;
    cache.delete(oldest);
    cachedChars -= entry.chars;
  }
}
/** Test-only: what the cache holds. */
export function viewSectionCacheSizeForTests() {
  return { entries: cache.size, chars: cachedChars };
}
function recall(key: string) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry.texts;
}
/** Test-only: empties the projection cache. */
export function clearViewSectionCacheForTests() {
  cache.clear();
  cachedChars = 0;
}

/**
 * `unsectioned`: the whole projected view in one response, for a client that could not assemble
 * sections (room-sync.ts falls back to it). It is the view of the client's own protocol (since
 * protocol 12 the working set, not the whole campaign).
 */
type SectionRequest = { tabletopProtocol?: number; viewSections?: unknown; unsectioned?: boolean };
type ViewLike = { code: string; seatId: string; table: CloudTable; draft: string };

/**
 * The response for a room view: exactly `tabletopResponse` for protocols up to 10; for protocol
 * 11+ the projected table with its large parts replaced by `null`, and a `viewSections`
 * manifest carrying the texts the client lacks, up to the inline budget.
 */
export async function roomViewResponse<T extends ViewLike>(
  view: T,
  data: SectionRequest,
): Promise<T | (T & { viewSections: ViewSections })> {
  const protocol = data.tabletopProtocol ?? 0;
  const version = viewVersion(view);
  const value = tabletopResponse(view, protocol);
  if (protocol < VIEW_SECTIONS_PROTOCOL || data.unsectioned === true) return value;
  const split = await splitViewTable(
    value.table,
    viewSectionSalt(value.code, value.seatId, protocol),
  );
  if (!split.entries.length) return value;
  if (version) remember(cacheKey(value.code, value.seatId, protocol, version), split.texts);
  const have = new Set(readHashList(data.viewSections));
  const sent: Record<string, string> = {};
  let used = 0;
  for (const entry of split.entries) {
    if (have.has(entry.h) || entry.h in sent) continue;
    const text = split.texts.get(entry.h)!;
    if (used + text.length > VIEW_INLINE_CHARS) continue;
    sent[entry.h] = text;
    used += text.length;
  }
  return {
    ...value,
    table: split.table,
    viewSections: { v: 1, entries: split.entries, data: sent },
  };
}

export type ViewSectionsResult = {
  protocol: "lootsplit.room.sections.v1";
  revision: number;
  /** Requested sections of the seat's current projection, up to the batch budget. */
  sections: Record<string, string>;
  /** Requested hashes that are not in the seat's current projection (the room moved on). */
  missing: string[];
};

/** Sections by hash for one seat (`readCloudSections`). */
export async function readViewSections(input: {
  code: string;
  token: string;
  tabletopProtocol?: number;
  hashes?: unknown;
}): Promise<ViewSectionsResult> {
  const protocol = input.tabletopProtocol ?? 0;
  if (protocol < VIEW_SECTIONS_PROTOCOL) throw Error("Reload Lootsplitter to load this campaign.");
  const hashes = readHashList(input.hashes);
  if (
    !hashes.length ||
    (Array.isArray(input.hashes) &&
      input.hashes.some((h) => typeof h !== "string" || !HASH_PATTERN.test(h)))
  )
    throw Error("Invalid campaign section request.");
  const { readRoomAccess } = await import("./room-store.server.ts");
  const code = input.code.trim().toUpperCase();
  const access = await readRoomAccess(code);
  if (!access) throw Error("No table uses that code.");
  if (access.closed) throw Error("This room is closed.");
  const seat = access.seats.find((s) => s.token === input.token);
  if (!seat) throw Error("This browser is not seated at that table.");
  let revision = access.revision;
  let texts =
    access.writeId !== undefined
      ? recall(
          cacheKey(code, seat.id, protocol, {
            revision: access.revision,
            writeId: access.writeId ?? null,
          }),
        )
      : undefined;
  if (!texts) {
    // A fresh read and projection for this seat, exactly as a room read.
    const { roomState } = await import("./cloud.server.ts");
    const view = await roomState({ code, token: input.token, tabletopProtocol: protocol });
    const version = viewVersion(view);
    const value = tabletopResponse(view, protocol);
    texts = (await splitViewTable(value.table, viewSectionSalt(value.code, value.seatId, protocol)))
      .texts;
    if (version) remember(cacheKey(value.code, value.seatId, protocol, version), texts);
    revision = value.revision;
  }
  const sections: Record<string, string> = {};
  const missing: string[] = [];
  let used = 0;
  for (const hash of hashes) {
    const text = texts.get(hash);
    if (text === undefined) missing.push(hash);
    else if (used === 0 || used + text.length <= VIEW_BATCH_CHARS) {
      sections[hash] = text;
      used += text.length;
    }
  }
  return { protocol: "lootsplit.room.sections.v1", revision, sections, missing };
}
