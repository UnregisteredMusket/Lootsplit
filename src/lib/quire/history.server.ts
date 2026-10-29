/**
 * History on demand, Worker side (sectioned storage step 4; history-pages.ts has the overview).
 *
 * - `historyCursors`: where a seat's view of a working read continues (opaque, seat-salted).
 * - `questReceiptResolver`: quest reward receipts resolved over the whole campaign, so a player's
 *   quest log projected from a working read is exactly the one projected from the whole campaign.
 * - `readHistory`: older ledger or chat pages, or one archived session, projected for the seat by
 *   the same rules as the room view, with protocol 11 style hash caching (`readCloudHistory`).
 */
import {
  readRoomSectionTexts,
  roomHistoryPages,
} from "../../../cloudflare/room-storage.mjs";
import { hydrateDeferredReports, database } from "./room-store.server.ts";
import type { CloudRoom, CloudSeat, CloudTable } from "./cloud.ts";
import { HISTORY_LISTS, isDeferredSnapshot, type HistoryCursors, type HistoryList } from "./history-pages.ts";
import { findReceipt, questsOf, type ReceiptLine } from "./quests.ts";
import type { QuestRewardLink } from "./quests-schema.ts";
import { projectArchivedReport } from "./session-records.ts";

type PageEntry = { hash: string; parts: number; items: number; page: number };

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
const CURSOR = /^[0-9a-f]{32}$/;
/** The opaque cursor naming one stored page for one seat (it reveals no count or content). */
async function cursorOf(code: string, seatId: string, list: HistoryList, page: PageEntry) {
  return (await sha256(`lootsplit-history-cursor-v1\n${code}\n${seatId}\n${list}\n${page.hash}`)).slice(0, 32);
}
/** The hash a seat caches a projected page or report under (salted like view sections). */
async function projectedHash(code: string, seatId: string, text: string) {
  return (await sha256(`lootsplit-history-page-v1\n${code}\n${seatId}\n${text}`)).slice(0, 32);
}

/** The stored pages of each paged list of a working read, oldest first. */
export function roomPages(room: CloudRoom): Map<HistoryList, PageEntry[]> {
  const pages = roomHistoryPages(room) as Map<string, PageEntry[]>;
  const result = new Map<HistoryList, PageEntry[]>();
  for (const list of HISTORY_LISTS) {
    const entries = pages.get(`table.${list}`);
    if (entries?.length) result.set(list, entries);
  }
  return result;
}

/** How many older lines of each list a working read does not hold (`runOnWorkingSet`). */
export function historyOffsets(room: CloudRoom): Partial<Record<HistoryList, number>> {
  const offsets: Partial<Record<HistoryList, number>> = {};
  for (const [list, pages] of roomPages(room)) offsets[list] = pages.reduce((sum, page) => sum + page.items, 0);
  return offsets;
}

/** True when a room read holds less than the whole campaign (history pages or deferred sessions). */
export function roomHasHistory(room: CloudRoom): boolean {
  return roomPages(room).size > 0 || (room.table.journal?.reports ?? []).some((r) => isDeferredSnapshot(r.snapshot));
}

/** The view's cursors: for each paged list, the newest stored page this seat does not hold. */
export async function historyCursors(room: CloudRoom, seat: Pick<CloudSeat, "id">): Promise<HistoryCursors | undefined> {
  const pages = roomPages(room);
  if (!pages.size) return undefined;
  const cursors: HistoryCursors = {};
  for (const [list, entries] of pages) cursors[list] = await cursorOf(room.code, seat.id, list, entries.at(-1)!);
  return cursors;
}

/**
 * Isolate cache of receipt lookups in immutable sources (a history page or an archived session,
 * by content hash): `code|source|kind:id` -> lines or null. Small entries only; never campaign text.
 */
const RECEIPT_CACHE_LIMIT = 5_000;
const receiptCache = new Map<string, ReceiptLine[] | null>();
function remember(key: string, value: ReceiptLine[] | null) {
  receiptCache.set(key, value);
  if (receiptCache.size > RECEIPT_CACHE_LIMIT) receiptCache.delete(receiptCache.keys().next().value!);
}
/** Test-only. */
export function clearHistoryCachesForTests() {
  receiptCache.clear();
}

/**
 * For a player's view of a working read: every quest reward receipt resolved exactly as
 * `findReceipt` resolves it on the whole campaign (the live ledger, history pages first, and its
 * events; then each archived session in order). Lookups in pages and archived sessions are cached
 * per isolate by content hash, so a long campaign is searched once, not on every read. `undefined`
 * when the read is the whole campaign or nothing needs resolving.
 */
export async function questReceiptResolver(
  room: CloudRoom,
  seat: Pick<CloudSeat, "role">,
): Promise<((link: QuestRewardLink) => ReceiptLine[] | null) | undefined> {
  if (seat.role === "dm" || !roomHasHistory(room)) return undefined;
  const links = new Map<string, QuestRewardLink>();
  for (const quest of questsOf(room.table))
    for (const link of quest.rewardLinks ?? []) links.set(`${link.kind}:${link.id}`, link);
  if (!links.size) return undefined;
  const db = database();
  const pages = roomPages(room).get("ledger") ?? [];
  const reports = room.table.journal?.reports ?? [];
  const events = room.table.journal?.events ?? [];
  const resolved = new Map<string, ReceiptLine[] | null>();
  const pageItems = new Map<string, CloudTable["ledger"]>();
  const loadPage = async (page: PageEntry) => {
    if (!pageItems.has(page.hash)) {
      const text = (await readRoomSectionTexts(db!, room.code, [page])).get(page.hash);
      if (text === undefined) throw Error("The table changed. Refresh before sending your turn.");
      pageItems.set(page.hash, JSON.parse(text));
    }
    return pageItems.get(page.hash)!;
  };
  const inPage = async (page: PageEntry, link: QuestRewardLink) => {
    const key = `${room.code}|${page.hash}|${link.kind}:${link.id}`;
    if (!receiptCache.has(key))
      remember(key, findReceipt({ ledger: await loadPage(page), journal: { sessions: [], requests: [], events: [] } }, link));
    return receiptCache.get(key)!;
  };
  for (const [key, link] of links) {
    let lines: ReceiptLine[] | null = null;
    // The live campaign: the whole ledger (pages, then the window) and the events.
    if (link.kind === "ledger") {
      for (const page of pages) if ((lines = await inPage(page, link))) break;
      lines ??= findReceipt({ ledger: room.table.ledger, journal: { sessions: [], requests: [], events: [] } }, link);
    } else if (link.kind === "encounter-award") {
      const found: ReceiptLine[] = [];
      for (const page of pages) found.push(...((await inPage(page, link)) ?? []));
      found.push(...(findReceipt({ ledger: room.table.ledger, journal: { sessions: [], requests: [], events: [] } }, link) ?? []));
      lines = found.length ? found : null;
    } else lines = findReceipt({ ledger: [], journal: { sessions: [], requests: [], events } }, link);
    // Then each archived session in order (a deferred one is read once per isolate).
    for (const report of reports) {
      if (lines) break;
      if (!isDeferredSnapshot(report.snapshot)) {
        lines = findReceipt({ ledger: [], journal: { sessions: [], requests: [], events: [], reports: [report] } }, link);
        continue;
      }
      const cacheKey = `${room.code}|${report.snapshot}|${link.kind}:${link.id}`;
      if (!receiptCache.has(cacheKey)) {
        const [hydrated] = await hydrateDeferredReports(room.code, [report]);
        remember(cacheKey, findReceipt({ ledger: [], journal: { sessions: [], requests: [], events: [], reports: [hydrated!] } }, link));
      }
      lines = receiptCache.get(cacheKey)!;
    }
    resolved.set(key, lines);
  }
  return (link) => resolved.get(`${link.kind}:${link.id}`) ?? null;
}

/** The per-seat projection of history lines, by the same rules as the room view (cloud.server.ts). */
export type HistoryProjector = {
  ledger: (lines: CloudTable["ledger"]) => CloudTable["ledger"];
  notes: (notes: CloudTable["notes"]) => CloudTable["notes"];
};

/** Lines per history response (at least one page is always sent, and pages are never split). */
export const HISTORY_BATCH_ITEMS = 400;
/** Characters of projected history per response. */
export const HISTORY_BATCH_CHARS = 1_500_000;

type HistoryItems = CloudTable["ledger"] | CloudTable["notes"];
type ArchivedReport = NonNullable<NonNullable<CloudTable["journal"]>["reports"]>[number];
/** One older page: its cursor, the cursor of the page before it (null at the start), its hash. */
export type HistoryPage = { cursor: string; prev: string | null; hash: string; items?: HistoryItems };
export type HistoryResult =
  | {
      protocol: "lootsplit.room.history.v1";
      list: HistoryList;
      revision: number;
      /** Oldest first; `items` is omitted for a page the client holds (`held`). */
      pages: HistoryPage[];
      /** Where the list continues further back, or null at its start. */
      next: string | null;
    }
  | {
      protocol: "lootsplit.room.history.v1";
      report: string;
      revision: number;
      hash: string;
      /** The archived session projected for the seat; omitted when the client holds `hash`. */
      value?: ArchivedReport;
    }
  | { protocol: "lootsplit.room.history.v1"; revision: number; missing: true };

/**
 * Older history for one seat of a working read: up to `HISTORY_BATCH_ITEMS` visible lines of
 * `list` from the page `before` names, going back (with `bulk`, up to `HISTORY_BATCH_CHARS`), or
 * the archived session `report`. Pages and
 * sessions are read from this room's own rows only and projected with `project` (the view's own
 * rules) or `projectArchivedReport`. `missing` when the cursor or report is not in the room as it
 * is now (it moved on: the client reads the room again).
 */
export async function readHistory(
  room: CloudRoom,
  seat: CloudSeat,
  project: HistoryProjector,
  input: { list?: unknown; before?: unknown; report?: unknown; held?: unknown; bulk?: unknown },
): Promise<HistoryResult> {
  const db = database();
  const base = { protocol: "lootsplit.room.history.v1" as const, revision: room.revision };
  const held = new Set(Array.isArray(input.held) ? input.held.filter((h): h is string => typeof h === "string" && CURSOR.test(h)).slice(0, 512) : []);
  if (input.report !== undefined) {
    if (typeof input.report !== "string" || input.report.length > 150) throw Error("Invalid history request.");
    const report = (room.table.journal?.reports ?? []).find((r) => r.id === input.report);
    // The view's own rule: a report lists the seats it belongs to (`projectRecord`).
    if (!report || (report.seatIds && !report.seatIds.includes(seat.id))) return { ...base, missing: true };
    const [hydrated] = await hydrateDeferredReports(room.code, [report]);
    const value = projectArchivedReport(hydrated!, room.table, seat);
    const text = JSON.stringify(value);
    const hash = await projectedHash(room.code, seat.id, text);
    return { ...base, report: report.id, hash, ...(held.has(hash) ? {} : { value }) };
  }
  if (!HISTORY_LISTS.includes(input.list as HistoryList) || typeof input.before !== "string" || !CURSOR.test(input.before))
    throw Error("Invalid history request.");
  const list = input.list as HistoryList;
  const pages = roomPages(room).get(list) ?? [];
  let index = -1;
  for (let i = pages.length - 1; i >= 0; i--)
    if ((await cursorOf(room.code, seat.id, list, pages[i]!)) === input.before) {
      index = i;
      break;
    }
  if (index < 0 || !db) return { ...base, missing: true };
  const result: HistoryPage[] = [];
  let lines = 0,
    chars = 0;
  for (; index >= 0; index--) {
    const page = pages[index]!;
    const text = (await readRoomSectionTexts(db, room.code, [page])).get(page.hash);
    if (text === undefined) return { ...base, missing: true };
    // Map images or resource references inside lines are restored as a whole read restores them.
    const { hydrateRoomImages } = await import("../../../cloudflare/room-images.mjs");
    const items = (await hydrateRoomImages(db, room.code, { items: JSON.parse(text) })).items as never[];
    const visible: HistoryItems = list === "ledger" ? project.ledger(items) : project.notes(items);
    const projectedText = JSON.stringify(visible);
    if (result.length && chars + projectedText.length > HISTORY_BATCH_CHARS) break;
    const hash = await projectedHash(room.code, seat.id, `${list}\n${projectedText}`);
    result.unshift({
      cursor: await cursorOf(room.code, seat.id, list, page),
      prev: index > 0 ? await cursorOf(room.code, seat.id, list, pages[index - 1]!) : null,
      hash,
      ...(held.has(hash) ? {} : { items: visible }),
    });
    lines += visible.length;
    chars += projectedText.length;
    // `bulk` (loading the whole history): as many pages as fit the response budget.
    if (input.bulk !== true && lines >= HISTORY_BATCH_ITEMS) {
      index--;
      break;
    }
  }
  return {
    ...base,
    list,
    pages: result,
    next: index >= 0 ? await cursorOf(room.code, seat.id, list, pages[index]!) : null,
  };
}
