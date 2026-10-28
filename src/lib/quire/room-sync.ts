/**
 * Section-aware room sync (tabletop protocol 11, view-sections.ts) for the shared-room client,
 * applied in one place (room-transport.ts binds it to the room server functions):
 *
 * - Every room request from a protocol 11 caller carries the section hashes this tab holds for
 *   that seat (`viewSections`).
 * - A sectioned response is assembled before the caller sees it: texts come from the response,
 *   from this tab's cache, or are fetched with `readCloudSections` in batches (progress in
 *   room-loading.ts). Callers always receive a complete room view, exactly as with protocol 10,
 *   so revision handling, conflicts and offline queueing are unchanged.
 * - If the room moved on while sections were fetched, the room is read again (at most three
 *   times), then once as a protocol 10 client, which receives the full view.
 *
 * The cache holds section texts by hash for one seat (room code + seat token), in memory only: it
 * is replaced when the tab uses another seat or campaign, emptied on account changes, and pruned
 * to the sections of the latest view, so it never holds more than one view's sections.
 */
import { VIEW_MAX_HASHES, assembleViewTable, type ViewSections } from "./view-sections.ts";
import {
  advanceRoomLoading,
  finishRoomLoading,
  startRoomLoading,
  throwIfRoomLoadingCancelled,
} from "./room-loading.ts";
import type { ViewSectionsResult } from "./view-sections.server.ts";

type Fn<I, O> = (options: { data: I }) => Promise<O>;
type Seat = { code: string; token: string; tabletopProtocol?: number };
type SectionServer = Fn<
  { tabletopProtocol: number; code: string; token: string; hashes: string[] },
  ViewSectionsResult
>;
type FullRead = Fn<{ tabletopProtocol: number; code: string; token: string }, unknown>;

export function createRoomSync(servers: { readSections: SectionServer; fullRead: FullRead }) {
  const SECTIONS_PROTOCOL = 11;
  let cacheKey = "";
  let cache = new Map<string, string>();

  /** Forgets every cached section (account, campaign or seat change). */
  function clearViewSectionCache() {
    cacheKey = "";
    cache = new Map();
  }
  /** The cache for this seat; another seat or campaign replaces it. */
  function seatCache(seat: Seat) {
    const key = `${seat.code.trim().toUpperCase()}\n${seat.token}`;
    if (key !== cacheKey) {
      cacheKey = key;
      cache = new Map();
    }
    return cache;
  }
  /** Section hashes held for this seat (sent with every protocol 11 room request). */
  function heldSections(seat: Seat): string[] {
    return [...seatCache(seat).keys()].slice(0, VIEW_MAX_HASHES);
  }
  /** Test-only view of the cache. */
  function viewSectionCacheForTests() {
    return { key: cacheKey, hashes: [...cache.keys()] };
  }

  class SectionsMoved extends Error {}

  type Sectioned = { table: unknown; viewSections?: ViewSections };
  /**
   * Assembles a sectioned response; returns other responses unchanged. Throws `SectionsMoved` when
   * the seat's projection no longer has a listed section (the room changed meanwhile).
   */
  async function assemble<T>(response: T, seat: Seat): Promise<T> {
    const value = response as T & Sectioned;
    if (!value || typeof value !== "object" || !value.viewSections) return response;
    const { entries, data } = value.viewSections;
    const held = seatCache(seat);
    for (const [hash, text] of Object.entries(data ?? {})) held.set(hash, text);
    const wanted = [
      ...new Map(entries.filter((e) => !held.has(e.h)).map((e) => [e.h, e.b])).entries(),
    ];
    if (wanted.length) {
      const code = seat.code.trim().toUpperCase();
      startRoomLoading(
        code,
        wanted.reduce((sum, [, bytes]) => sum + bytes, 0),
        wanted.length,
      );
      try {
        let remaining = wanted.map(([hash]) => hash);
        while (remaining.length) {
          throwIfRoomLoadingCancelled(code);
          const batch = await servers.readSections({
            data: {
              tabletopProtocol: SECTIONS_PROTOCOL,
              code: seat.code,
              token: seat.token,
              hashes: remaining.slice(0, VIEW_MAX_HASHES),
            },
          });
          if (batch.missing.length) throw new SectionsMoved();
          const got = Object.entries(batch.sections);
          if (!got.length) throw new SectionsMoved();
          let bytes = 0;
          for (const [hash, text] of got) {
            held.set(hash, text);
            bytes += text.length;
          }
          advanceRoomLoading(bytes, got.length);
          remaining = remaining.filter((hash) => !held.has(hash));
        }
      } finally {
        finishRoomLoading();
      }
    }
    const table = assembleViewTable(value.table as never, entries, held);
    // Keep only this view's sections: the cache never grows beyond one view.
    const listed = new Set(entries.map((e) => e.h));
    for (const hash of [...held.keys()]) if (!listed.has(hash)) held.delete(hash);
    const { viewSections: _sections, ...rest } = value;
    return { ...rest, table } as T;
  }

  /** A room read: assembled; re-read if the room moved on, then read once in full (protocol 10). */
  function roomRead<I extends Seat, O>(fn: Fn<I & { viewSections?: string[] }, O>): Fn<I, O> {
    return async ({ data }) => {
      if ((data.tabletopProtocol ?? 0) < SECTIONS_PROTOCOL) return fn({ data });
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await assemble(
            await fn({ data: { ...data, viewSections: heldSections(data) } }),
            data,
          );
        } catch (error) {
          if (!(error instanceof SectionsMoved)) throw error;
        }
      }
      return servers.fullRead({
        data: { code: data.code, token: data.token, tabletopProtocol: 10 },
      }) as Promise<O>;
    };
  }
  /**
   * A room write: sent once (never repeated here); its view is assembled, or, if the room moved on
   * meanwhile, replaced by a fresh room read (the write's receipts are in it).
   */
  function roomWrite<I extends Seat, O>(fn: Fn<I & { viewSections?: string[] }, O>): Fn<I, O> {
    return async ({ data }) => {
      if ((data.tabletopProtocol ?? 0) < SECTIONS_PROTOCOL) return fn({ data });
      const response = await fn({ data: { ...data, viewSections: heldSections(data) } });
      try {
        return await assemble(response, data);
      } catch (error) {
        if (!(error instanceof SectionsMoved)) throw error;
        return roomRead(servers.fullRead as Fn<Seat, O>)({
          data: { code: data.code, token: data.token, tabletopProtocol: SECTIONS_PROTOCOL },
        });
      }
    };
  }

  return { roomRead, roomWrite, clearViewSectionCache, heldSections, viewSectionCacheForTests };
}
