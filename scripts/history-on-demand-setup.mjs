// History on demand (sectioned storage step 4, owner decision 2026-10-28/29): long ledger and chat
// history in immutable pages, archived sessions read only when opened, commands exact on the
// working set, per-seat history reads, old clients, exports and lazy migration. Every case uses a
// disposable local D1 stand-in with every migration applied; never a real campaign or account.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localAccountDb } from "./account-dev-db.mjs";
import { assertAdditiveSql } from "./production-migrations.mjs";

export const db = localAccountDb();
globalThis.__env__ = { DB: db };
export const { openRoom, joinRoom, roomState, submitCommands, choosePace, readRoomHistory, LEGACY_HISTORY_NOTICE_ID } = await import("../src/lib/quire/cloud.server.ts");
export const { readRoom, updateRoom, ROOM_BODY_LIMIT } = await import("../src/lib/quire/room-store.server.ts");
export const { readStoredRoom, roomWriteStatements, setRoomSectionLimitsForTests, ROOM_HISTORY_PAGE_ITEMS, ROOM_SECTION_THRESHOLD } = await import("../cloudflare/room-storage.mjs");
export const { encodeRoomImages } = await import("../cloudflare/room-images.mjs");
export const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
export const { canonicalJson } = await import("../src/lib/quire/canonical-json.ts");
export const { toCopper } = await import("../src/lib/quire/money.ts");
export const { clearViewSectionCacheForTests } = await import("../src/lib/quire/view-sections.server.ts");
export const { clearHistoryCachesForTests } = await import("../src/lib/quire/history.server.ts");
export const { HISTORY_PROTOCOL } = await import("../src/lib/quire/history-pages.ts");
export const { campaignAction } = await import("../cloudflare/account-campaigns.mjs");
export const { tradeSeasonFingerprint } = await import("../src/lib/quire/trade-economy.ts");
export const { questsOf } = await import("../src/lib/quire/quests.ts");

export const NEW = { tabletopProtocol: HISTORY_PROTOCOL };
export const OLD = { tabletopProtocol: 11 };
export const pageRows = (code) =>
  db.prepare("SELECT hash,part,body FROM campaign_room_sections WHERE code=? ORDER BY hash,part").bind(code).all().then((r) => r.results);
export const manifest = async (code) => (await readStoredRoom(db, code)).version.sections ?? [];
export const pagesOf = async (code, list) => (await manifest(code)).filter((e) => e.path.join(".") === `$history.table.${list}`);

/** A shop with plenty of rope, so a DM can buy (and Undo) many times. */
export function shopTable() {
  const table = tradeFixture();
  table.shops.push({ id: "outfitter", name: "Outfitter", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1 });
  table.stock.push({ id: "rope", shopId: "outfitter", name: "Rope", copper: 100, baseCopper: 100, rarity: "common", quantity: 100000, notes: "50 feet", category: "general" });
  // An NPC whose purchases no player may read (companion funds are not shared by default).
  table.purses.push({ id: "spy", name: "The Spy", kind: "character", control: "npc", coins: { cp: 0, sp: 0, ep: 0, gp: 1000, pp: 0 } });
  table.holdings.push({ id: "potion", purseId: "party", name: "Potion of healing", kind: "item", quantity: 3, unitCopper: 50, notes: "", pool: { at: 1, source: "add-loot" } });
  return table;
}
export const buy = (id, purseId = "a") => ({ id, kind: "buy", stockId: "rope", purseId, quantity: 1 });
export const message = (id, purseId, text, to = "party") => ({ id, kind: "message", to, purseId, text });
/** Test clock hook: advanced once per batch (so a batch rerun on the whole campaign sees the same time). */
export let tick = () => {};
export const send = (seat, batchId, commands, extra = {}) => (tick(), submitCommands({ ...seat, ...extra, batchId, commands }));

/** A live shared campaign: DM plus Arden's (a) and Briar's (b) players. */
export async function liveRoom(name = "History DM", table = shopTable(), userId = undefined) {
  const dm = await openRoom({ name, table, userId });
  const sessionId = userId ? (await readRoom(dm.code)).sessionId : undefined;
  const a = await joinRoom({ code: dm.code, purseId: "a", name: "Arden", sessionId });
  const b = await joinRoom({ code: dm.code, purseId: "b", name: "Briar", sessionId });
  await choosePace({ ...dm, live: true });
  return { dm, a: { code: dm.code, token: a.token }, b: { code: dm.code, token: b.token } };
}
/** `count` purchases and chat lines, sent in batches (the long history of a session). */
export async function history(seats, count, prefix = "h") {
  for (let start = 0; start < count; start += 100) {
    const n = Math.min(100, count - start);
    await send(seats.dm, `${prefix}-buys-${start}`, Array.from({ length: n }, (_, i) => buy(`${prefix}-buy-${start + i}`, i % 4 === 3 ? "spy" : i % 3 ? "a" : "b")));
    await send(seats.a, `${prefix}-chat-a-${start}`, Array.from({ length: Math.min(n, 40) }, (_, i) => message(`${prefix}-a-${start + i}`, "a", i % 5 ? `Arden ${start + i}` : `Arden whispers ${start + i}`, i % 5 ? "party" : "dm")));
    await send(seats.b, `${prefix}-chat-b-${start}`, Array.from({ length: Math.min(n, 40) }, (_, i) => message(`${prefix}-b-${start + i}`, "b", `Briar private ${start + i}`, "dm")));
  }
}
/** Every older page of `list` for a seat, through the history endpoint (newest page first). */
export async function allHistory(seat, list, cursor, held = []) {
  const items = [];
  const calls = [];
  while (cursor) {
    const result = await readRoomHistory({ ...seat, ...NEW, list, before: cursor, held });
    calls.push(result);
    assert.ok(!result.missing, "the cursor is in the room");
    items.unshift(...result.pages.flatMap((p) => p.items ?? []));
    cursor = result.next;
  }
  return { items, calls };
}
export const full = async (seat) => (await roomState({ ...seat, ...OLD })).table;

setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 64 });
test.after(() => setRoomSectionLimitsForTests({}));

/** Tests that move the clock replace the hook through this (an imported `let` is read-only). */
export function setTick(next) {
  tick = next;
}
export { readFileSync, localAccountDb, assertAdditiveSql };
