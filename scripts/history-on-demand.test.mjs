// History on demand (sectioned storage step 4, owner decision 2026-10-28/29): long ledger and chat
// history in immutable pages, archived sessions read only when opened, commands exact on the
// working set, per-seat history reads, old clients, exports and lazy migration. Every case uses a
// disposable local D1 stand-in with every migration applied; never a real campaign or account.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localAccountDb } from "./account-dev-db.mjs";
import { assertAdditiveSql } from "./production-migrations.mjs";

const db = localAccountDb();
globalThis.__env__ = { DB: db };
const { openRoom, joinRoom, roomState, submitCommands, choosePace, readRoomHistory, LEGACY_HISTORY_NOTICE_ID } = await import("../src/lib/quire/cloud.server.ts");
const { readRoom, updateRoom, ROOM_BODY_LIMIT } = await import("../src/lib/quire/room-store.server.ts");
const { readStoredRoom, roomWriteStatements, setRoomSectionLimitsForTests, ROOM_HISTORY_PAGE_ITEMS, ROOM_SECTION_THRESHOLD } = await import("../cloudflare/room-storage.mjs");
const { encodeRoomImages } = await import("../cloudflare/room-images.mjs");
const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
const { canonicalJson } = await import("../src/lib/quire/canonical-json.ts");
const { toCopper } = await import("../src/lib/quire/money.ts");
const { clearViewSectionCacheForTests } = await import("../src/lib/quire/view-sections.server.ts");
const { clearHistoryCachesForTests } = await import("../src/lib/quire/history.server.ts");
const { HISTORY_PROTOCOL } = await import("../src/lib/quire/history-pages.ts");
const { campaignAction } = await import("../cloudflare/account-campaigns.mjs");
const { tradeSeasonFingerprint } = await import("../src/lib/quire/trade-economy.ts");
const { questsOf } = await import("../src/lib/quire/quests.ts");

const NEW = { tabletopProtocol: HISTORY_PROTOCOL };
const OLD = { tabletopProtocol: 11 };
const pageRows = (code) =>
  db.prepare("SELECT hash,part,body FROM campaign_room_sections WHERE code=? ORDER BY hash,part").bind(code).all().then((r) => r.results);
const manifest = async (code) => (await readStoredRoom(db, code)).version.sections ?? [];
const pagesOf = async (code, list) => (await manifest(code)).filter((e) => e.path.join(".") === `$history.table.${list}`);

/** A shop with plenty of rope, so a DM can buy (and Undo) many times. */
function shopTable() {
  const table = tradeFixture();
  table.shops.push({ id: "outfitter", name: "Outfitter", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1 });
  table.stock.push({ id: "rope", shopId: "outfitter", name: "Rope", copper: 100, baseCopper: 100, rarity: "common", quantity: 100000, notes: "50 feet", category: "general" });
  // An NPC whose purchases no player may read (companion funds are not shared by default).
  table.purses.push({ id: "spy", name: "The Spy", kind: "character", control: "npc", coins: { cp: 0, sp: 0, ep: 0, gp: 1000, pp: 0 } });
  table.holdings.push({ id: "potion", purseId: "party", name: "Potion of healing", kind: "item", quantity: 3, unitCopper: 50, notes: "", pool: { at: 1, source: "add-loot" } });
  return table;
}
const buy = (id, purseId = "a") => ({ id, kind: "buy", stockId: "rope", purseId, quantity: 1 });
const message = (id, purseId, text, to = "party") => ({ id, kind: "message", to, purseId, text });
/** Test clock hook: advanced once per batch (so a batch rerun on the whole campaign sees the same time). */
let tick = () => {};
const send = (seat, batchId, commands, extra = {}) => (tick(), submitCommands({ ...seat, ...extra, batchId, commands }));

/** A live shared campaign: DM plus Arden's (a) and Briar's (b) players. */
async function liveRoom(name = "History DM", table = shopTable(), userId = undefined) {
  const dm = await openRoom({ name, table, userId });
  const sessionId = userId ? (await readRoom(dm.code)).sessionId : undefined;
  const a = await joinRoom({ code: dm.code, purseId: "a", name: "Arden", sessionId });
  const b = await joinRoom({ code: dm.code, purseId: "b", name: "Briar", sessionId });
  await choosePace({ ...dm, live: true });
  return { dm, a: { code: dm.code, token: a.token }, b: { code: dm.code, token: b.token } };
}
/** `count` purchases and chat lines, sent in batches (the long history of a session). */
async function history(seats, count, prefix = "h") {
  for (let start = 0; start < count; start += 100) {
    const n = Math.min(100, count - start);
    await send(seats.dm, `${prefix}-buys-${start}`, Array.from({ length: n }, (_, i) => buy(`${prefix}-buy-${start + i}`, i % 4 === 3 ? "spy" : i % 3 ? "a" : "b")));
    await send(seats.a, `${prefix}-chat-a-${start}`, Array.from({ length: Math.min(n, 40) }, (_, i) => message(`${prefix}-a-${start + i}`, "a", i % 5 ? `Arden ${start + i}` : `Arden whispers ${start + i}`, i % 5 ? "party" : "dm")));
    await send(seats.b, `${prefix}-chat-b-${start}`, Array.from({ length: Math.min(n, 40) }, (_, i) => message(`${prefix}-b-${start + i}`, "b", `Briar private ${start + i}`, "dm")));
  }
}
/** Every older page of `list` for a seat, through the history endpoint (newest page first). */
async function allHistory(seat, list, cursor, held = []) {
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
const full = async (seat) => (await roomState({ ...seat, ...OLD })).table;

setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 64 });
test.after(() => setRoomSectionLimitsForTests({}));

test("0029 (archived sessions in parts) is additive", () => {
  const name = "0029_campaign_room_report_parts.sql";
  assert.equal(assertAdditiveSql(name, readFileSync(new URL(`../cloudflare/migrations/${name}`, import.meta.url), "utf8")), 3);
});

test("an append writes only the newest lines: sealed history pages are never rewritten or re-read", async () => {
  const seats = await liveRoom();
  await history(seats, 400);
  const pages = await pagesOf(seats.dm.code, "ledger");
  assert.ok(pages.length >= 4, `the ledger is paged (${pages.length} pages)`);
  const before = new Map((await pageRows(seats.dm.code)).filter((r) => pages.some((p) => p.hash === r.hash)).map((r) => [`${r.hash}:${r.part}`, r.body]));
  const sectionsBefore = (await pageRows(seats.dm.code)).length;
  await send(seats.dm, "append-1", [buy("append-1")]);
  await send(seats.a, "append-2", [message("append-2", "a", "One more line")]);
  const after = new Map((await pageRows(seats.dm.code)).map((r) => [`${r.hash}:${r.part}`, r.body]));
  for (const [key, body] of before) assert.equal(after.get(key), body, "a sealed page is unchanged");
  assert.deepEqual((await pagesOf(seats.dm.code, "ledger")).slice(0, pages.length), pages, "the same pages, in the same order");
  assert.ok((await pageRows(seats.dm.code)).length <= sectionsBefore + 4, "an append adds no page copies");
  // The whole read is still the whole campaign, and it ends with the appended lines.
  const room = await readRoom(seats.dm.code);
  assert.equal(room.table.ledger.at(-1).id, "append-1");
  assert.equal(room.table.notes.at(-1).id, "append-2");
  assert.equal(room.table.ledger.filter((l) => l.id.startsWith("h-buy-")).length, 400);
});

test("a command on the working set reads no history page; one that needs history reads it inside the same guarded write", async () => {
  const seats = await liveRoom();
  await history(seats, 300);
  const pages = await pagesOf(seats.dm.code, "ledger");
  const pageHashes = new Set(pages.map((p) => p.hash));
  const reads = [];
  const real = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = real(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...args) => {
      reads.push(`${sql} ${JSON.stringify(args)}`);
      return bind(...args);
    };
    return statement;
  };
  try {
    await send(seats.dm, "cheap", [buy("cheap-1"), message("cheap-2", "", "A note from the DM")], NEW);
    // Reads of section bodies (not the write's own existence checks and cleanup).
    const pageReads = () => reads.filter((r) => /^SELECT[^]*\bbody\b[^]*FROM campaign_room_sections/.test(r) && [...pageHashes].some((h) => r.includes(h)));
    assert.deepEqual(pageReads(), [], "no history page was read for a purchase and a message");
    reads.length = 0;
    // Undo of the very first purchase (in the oldest page): the batch reads the history it needs.
    const first = (await readRoom(seats.dm.code)).table.ledger.find((l) => l.id === "h-buy-0");
    await send(seats.dm, "undo-old", [{ id: "undo-old", kind: "ledger-void", target: { kind: "ledger", id: first.id }, before: canonicalJson(first), reason: "Bought by mistake." }], NEW);
    assert.ok(pageReads().some((r) => r.includes(pages[0].hash)), "the oldest page was read for the Undo");
  } finally {
    db.prepare = real;
  }
});

test("Undo of a line in an old page applies exactly once, as in a campaign without pages", async () => {
  const run = async (page) => {
    setRoomSectionLimitsForTests({ threshold: 0, min: 0, page });
    const seats = await liveRoom(`Undo ${page}`);
    await history(seats, 260, "u");
    const t0 = await readRoom(seats.dm.code);
    const line = t0.table.ledger.find((l) => l.id === "u-buy-1");
    const undo = { id: "undo-1", kind: "ledger-void", target: { kind: "ledger", id: line.id }, before: canonicalJson(line), reason: "Wrong rope." };
    await send(seats.dm, "undo-batch", [undo]);
    await send(seats.dm, "undo-batch-lost-response", [undo]); // the same action again: receipt
    await send(seats.dm, "undo-again", [{ ...undo, id: "undo-2" }]); // a second Undo of the same line
    const t = await readRoom(seats.dm.code);
    return {
      pages: (await pagesOf(seats.dm.code, "ledger")).length,
      coins: t.table.purses.map((p) => [p.id, toCopper(p.coins)]),
      rope: t.table.stock.find((s) => s.id === "rope").quantity,
      voids: t.table.ledger.filter((l) => l.reversalOf === "u-buy-1").map((l) => [l.purseId, l.copper]),
      holdings: t.table.holdings.filter((h) => h.id.startsWith("u-buy-1-")).length,
    };
  };
  const paged = await run(16);
  const whole = await run(1_000_000);
  setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 64 });
  assert.ok(paged.pages > 10 && whole.pages === 0);
  const { pages: _p, ...a } = paged;
  const { pages: _w, ...b } = whole;
  assert.deepEqual(a, b);
  assert.equal(a.voids.length, 1, "voided once");
  assert.equal(a.holdings, 0, "the item went back once");
});

/**
 * Every command family that reads history gives the same campaign on paged storage (tiny pages,
 * so nearly every line is in an older page) as on unpaged storage: Undo of a current and an
 * archived line, coin split, gives, purchases, session end (archiving), "favour whoever is
 * behind" (fairness over every archived session), quest reward links to old receipts, a trade
 * season and downtime that ends a session. Time and randomness are fixed for both runs; each run
 * has its own database.
 */
test("command families that read history give identical campaigns on paged and unpaged storage", async () => {
  const realNow = Date.now,
    realRandom = Math.random,
    realUuid = crypto.randomUUID.bind(crypto),
    realValues = crypto.getRandomValues.bind(crypto);
  const scenario = async (page) => {
    const local = localAccountDb();
    globalThis.__env__ = { DB: local };
    clearViewSectionCacheForTests();
    clearHistoryCachesForTests();
    setRoomSectionLimitsForTests({ threshold: 0, min: 0, page });
    let clock = 1_800_000_000_000,
      seq = 0,
      seed = 1;
    Date.now = () => clock;
    tick = () => (clock += 1000);
    Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
    crypto.getRandomValues = (array) => {
      for (let i = 0; i < array.length; i++) array[i] = (seed = (seed * 48271) % 2147483647) % 4294967296;
      return array;
    };
    try {
      const seats = await liveRoom("Families");
      const { dm, a } = seats;
      await send(dm, "s1", [{ id: "session-1", kind: "session", name: "One", end: false }]);
      await history(seats, 60, "f");
      await send(dm, "split-1", [{ id: "split-1", kind: "coin-split", sourceId: "party", copper: 400, recipientIds: ["a", "b"], remainder: { rule: "party-fund", purseId: "party" }, expect: { share: 200, remainderTo: null } }]);
      await send(dm, "give-1", [{ id: "give-1", kind: "give", fromId: "a", toId: "b", copper: 30, holdingId: null, quantity: 0 }]);
      // Undo of a current line in an old page, then the session ends (archives the ledger).
      let t = await readRoom(dm.code);
      const old = t.table.ledger.find((l) => l.id === "f-buy-2");
      await send(dm, "undo-current", [{ id: "undo-current", kind: "ledger-void", target: { kind: "ledger", id: old.id }, before: canonicalJson(old), reason: "Current." }]);
      await send(dm, "end-1", [{ id: "end-1", kind: "session", name: "One", end: true }]);
      await send(dm, "s2", [{ id: "session-2", kind: "session", name: "Two", end: false }]);
      await history(seats, 30, "g");
      // Undo of a line that is now in the archived session.
      const archived = old.id === "f-buy-2" ? JSON.parse((await readRoom(dm.code)).table.journal.reports[0].snapshot).ledger.find((l) => l.id === "f-buy-5") : null;
      await send(dm, "undo-archived", [{ id: "undo-archived", kind: "ledger-void", target: { kind: "ledger", id: archived.id }, before: canonicalJson(archived), reason: "Archived." }]);
      // Treasure pool, resolved with favour over every archived session.
      await send(a, "claim-a", [{ id: "claim-a", kind: "loot-claim", holdingId: "potion", purseId: "a", choice: "need", before: null }]);
      t = await readRoom(dm.code);
      const { fairnessStandings } = await import("../src/lib/quire/loot-fairness.ts");
      const { lootFingerprint } = await import("../src/lib/quire/loot-claims.ts");
      const lots = [{ holdingId: "potion", quantity: 3 }];
      const totals = fairnessStandings(t.table, "campaign");
      await send(dm, "favour", [{ id: "favour", kind: "loot-resolve", method: "round-robin", lots, favour: { basis: "campaign" }, expect: lootFingerprint(t.table, lots, "round-robin", { basis: "campaign", totals }) }]);
      // A quest whose reward links point at a line in an old page and one in the archived session.
      const draft = { title: "Lost rope", summary: "Find it.", locationIds: [], markers: [], areas: [], objectives: [], rewardText: "Rope", dmNotes: "" };
      await send(dm, "quest-save", [{ id: "q1", kind: "quest-save", questId: null, revision: null, quest: draft }]);
      const rev = async () => questsOf((await readRoom(dm.code)).table).find((q) => q.id === "q1").revision;
      await send(dm, "quest-reveal", [{ id: "q1-reveal", kind: "quest-reveal", questId: "q1", revision: await rev(), audience: { kind: "party" } }]);
      await send(dm, "quest-link-1", [{ id: "q1-link-1", kind: "quest-link-reward", questId: "q1", revision: await rev(), link: { kind: "ledger", id: "g-buy-1" } }]);
      await send(dm, "quest-link-2", [{ id: "q1-link-2", kind: "quest-link-reward", questId: "q1", revision: await rev(), link: { kind: "ledger", id: "f-buy-6" } }]);
      // A trade season, then downtime that settles it and ends the session.
      await send(dm, "season", [{ id: "season", kind: "trade-season-plan", before: tradeSeasonFingerprint((await readRoom(dm.code)).table) }]);
      await send(dm, "season-cancel", [{ id: "season-cancel", kind: "trade-season-cancel", previewId: "season" }]);
      await send(dm, "downtime", [{ id: "downtime", kind: "downtime-plan", name: "Week off", days: 7, advanceSeason: true }]);
      const downtime = (await readRoom(dm.code)).table.journal.finance.downtime.at(-1);
      await send(dm, "downtime-apply", [{ id: "downtime-apply", kind: "downtime-apply", downtimeId: downtime.id, endSession: true }]);
      await history(seats, 20, "k");
      const stored = await readStoredRoom(local, dm.code);
      const pages = (stored.version.sections ?? []).filter((e) => e.path[0] === "$history").length;
      // What each seat sees: the complete (old protocol) view, and the player's quest links.
      const views = {};
      for (const [name, seat] of Object.entries(seats)) views[name] = (await roomState({ ...seat, ...OLD })).table;
      const playerQuest = questsOf((await roomState({ ...a, ...NEW })).table).find((q) => q.id === "q1");
      return { table: stored.room.table, views, playerQuest, pages, code: dm.code };
    } finally {
      tick = () => {};
      Date.now = realNow;
      Math.random = realRandom;
      crypto.randomUUID = realUuid;
      crypto.getRandomValues = realValues;
      globalThis.__env__ = { DB: db };
      setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 64 });
    }
  };
  const paged = await scenario(3);
  const whole = await scenario(1_000_000);
  assert.ok(paged.pages > 5, `paged storage was used (${paged.pages} pages)`);
  assert.equal(whole.pages, 0);
  const same = (x) => JSON.stringify(x).split(paged.code).join("CODE").split(whole.code).join("CODE");
  if (process.env.HISTORY_DEBUG_DIR) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${process.env.HISTORY_DEBUG_DIR}/paged.json`, JSON.stringify(JSON.parse(same(paged.table)), null, 1));
    writeFileSync(`${process.env.HISTORY_DEBUG_DIR}/whole.json`, JSON.stringify(JSON.parse(same(whole.table)), null, 1));
  }
  assert.equal(same(paged.table), same(whole.table), "the stored campaigns are identical");
  for (const seat of ["dm", "a", "b"]) assert.equal(same(paged.views[seat]), same(whole.views[seat]), `${seat}'s complete view is identical`);
  assert.equal(same(paged.playerQuest), same(whole.playerQuest), "the player's quest reward links are identical");
  assert.equal(paged.playerQuest.rewardLinks.length, 2, "both old receipts are linked for the player");
  // Exactly once: one void per Undo (both archived by the session ends since).
  const archived = paged.views.dm.journal.reports.flatMap((r) => JSON.parse(r.snapshot).ledger);
  assert.equal(paged.table.ledger.filter((l) => l.reversalOf).length, 0, "the sessions were archived after the Undos");
  assert.equal(archived.filter((l) => l.reversalOf === "f-buy-2").length, 1);
  assert.equal(archived.filter((l) => l.reversalOf === "f-buy-5").length, 1);
  assert.equal(archived.filter((l) => l.loot?.id === "favour").length, 1, "the favoured resolution once");
});

test("the working view plus every history page equals the complete view, for the DM and each player", async () => {
  const seats = await liveRoom();
  await history(seats, 500);
  await send(seats.dm, "s1", [{ id: "session-1", kind: "session", name: "One", end: false }]);
  await send(seats.dm, "end-1", [{ id: "end-1", kind: "session", name: "One", end: true }]);
  await history(seats, 300, "n");
  for (const [name, seat] of Object.entries(seats)) {
    const working = await roomState({ ...seat, ...NEW });
    const complete = await full(seat);
    assert.ok(working.history?.ledger && working.history?.notes, `${name}'s view has cursors`);
    assert.ok(working.table.ledger.length < complete.ledger.length);
    const ledger = await allHistory(seat, "ledger", working.history.ledger);
    const notes = await allHistory(seat, "notes", working.history.notes);
    assert.deepEqual([...ledger.items, ...working.table.ledger], complete.ledger, `${name}'s ledger is complete and identical`);
    assert.deepEqual([...notes.items, ...working.table.notes], complete.notes, `${name}'s chat is complete and identical`);
    // Archived sessions: listed without their snapshot, read one at a time when opened.
    const listed = working.table.journal.reports ?? [];
    assert.equal(listed.length, (complete.journal.reports ?? []).length);
    for (const [i, report] of listed.entries()) {
      assert.equal(report.deferred, true);
      assert.equal(report.snapshot, "");
      const opened = await readRoomHistory({ ...seat, ...NEW, report: report.id });
      assert.deepEqual(opened.value, complete.journal.reports[i], `${name}'s archived session ${report.id} is identical`);
      // A client that holds it gets only its hash.
      const again = await readRoomHistory({ ...seat, ...NEW, report: report.id, held: [opened.hash] });
      assert.equal(again.value, undefined);
      assert.equal(again.hash, opened.hash);
    }
    // Everything else in the working view equals the complete view.
    const strip = (t) => ({ ...t, ledger: [], notes: [], journal: { ...t.journal, reports: (t.journal.reports ?? []).map((r) => r.id) } });
    assert.deepEqual(strip(working.table), strip(complete));
    // Held pages are not sent again.
    const first = await readRoomHistory({ ...seat, ...NEW, list: "ledger", before: working.history.ledger });
    const held = await readRoomHistory({ ...seat, ...NEW, list: "ledger", before: working.history.ledger, held: first.pages.map((p) => p.hash) });
    assert.ok(held.pages.every((p) => p.items === undefined));
    assert.deepEqual(held.pages.map((p) => p.hash), first.pages.map((p) => p.hash));
  }
});

test("a player can never read another seat's or DM-only history", async () => {
  const seats = await liveRoom();
  await history(seats, 400);
  await send(seats.dm, "s1", [{ id: "session-1", kind: "session", name: "One", end: false }]);
  await send(seats.dm, "end-1", [{ id: "end-1", kind: "session", name: "One", end: true }]);
  await history(seats, 200, "n");
  const dmView = await roomState({ ...seats.dm, ...NEW });
  const aView = await roomState({ ...seats.a, ...NEW });
  // The DM's cursors name nothing for a player (salted per seat): the request finds nothing.
  for (const list of ["ledger", "notes"]) {
    assert.notEqual(dmView.history[list], aView.history[list]);
    assert.equal((await readRoomHistory({ ...seats.a, ...NEW, list, before: dmView.history[list] })).missing, true);
  }
  // Everything Arden can page through: never Briar's private messages to the DM, never the
  // whispers' text of another seat, only lines of purses Arden may read.
  const notes = await allHistory(seats.a, "notes", aView.history.notes);
  assert.ok(notes.items.length > 0);
  assert.ok(!notes.items.some((n) => n.text.startsWith("Briar private")), "no other player's private messages");
  const ledger = await allHistory(seats.a, "ledger", aView.history.ledger);
  const dmLedger = await allHistory(seats.dm, "ledger", dmView.history.ledger);
  assert.ok(ledger.items.length < dmLedger.items.length);
  assert.ok(ledger.items.every((l) => ["a", "b", "party"].includes(l.purseId)));
  assert.ok(dmLedger.items.some((l) => l.purseId === "spy") && !ledger.items.some((l) => l.purseId === "spy"), "never the hidden NPC's lines");
  assert.ok(!JSON.stringify(ledger.items).includes("exchange-treasury"), "never an exchange treasury's lines");
  // An archived session the player was not seated for is reported missing, like one that does not exist.
  const room = await readRoom(seats.dm.code);
  room.table.journal.reports.push({ id: "dm-only", name: "DM prep", at: 1, seatIds: [dmView.seatId], snapshot: JSON.stringify({ ...room.table, journal: { ...room.table.journal, reports: [] }, notes: [{ id: "x", at: 1, from: "dm", to: "dm", purseId: "", text: "DM-SECRET" }] }) });
  const base = room.revision;
  room.revision++;
  await updateRoom(room, base);
  assert.equal((await readRoomHistory({ ...seats.a, ...NEW, report: "dm-only" })).missing, true);
  assert.equal((await readRoomHistory({ ...seats.a, ...NEW, report: "no-such-report" })).missing, true);
  assert.ok(JSON.stringify((await readRoomHistory({ ...seats.dm, ...NEW, report: "dm-only" })).value).includes("DM-SECRET"));
  // A forged token, cursor or list is refused.
  await assert.rejects(readRoomHistory({ code: seats.a.code, token: "forged", ...NEW, list: "ledger", before: aView.history.ledger }), /not seated/);
  await assert.rejects(readRoomHistory({ ...seats.a, ...NEW, list: "seats", before: aView.history.ledger }), /Invalid history request/);
  await assert.rejects(readRoomHistory({ ...seats.a, ...OLD, list: "ledger", before: aView.history.ledger }), /Reload/);
  assert.equal((await readRoomHistory({ ...seats.a, ...NEW, list: "ledger", before: "0".repeat(32) })).missing, true);
});

test("pages a player can read nothing of are never named: no cursor reveals how many there are", async () => {
  const seats = await liveRoom("Quiet pages DM");
  const block = async (prefix, from, to, text) => {
    for (let i = 0; i < 320; i += 80)
      await send(from, `${prefix}-${i}`, Array.from({ length: 80 }, (_, n) => message(`${prefix}-${i + n}`, from === seats.a ? "a" : "b", `${text} ${i + n}`, to)));
  };
  // Briar's private messages to the DM, Arden's party chat, then Briar's again: whole pages Arden
  // can read nothing of, before and after the pages Arden can read.
  await block("b1", seats.b, "dm", "Briar private");
  await block("a1", seats.a, "party", "Arden party");
  await block("b2", seats.b, "dm", "Briar private");
  await block("b3", seats.b, "dm", "Briar private");
  const pages = await pagesOf(seats.dm.code, "notes");
  const readable = pages.filter((page) => page.keys.some((key) => JSON.parse(key)[0] === "party"));
  assert.ok(readable.length > 0 && readable.length < pages.length - 2, "the room has pages Arden can read nothing of");
  const view = await roomState({ ...seats.a, ...NEW });
  const walked = await allHistory(seats.a, "notes", view.history.notes);
  const named = walked.calls.flatMap((call) => call.pages);
  assert.equal(named.length, readable.length, "only pages with a line Arden may read are ever returned");
  assert.ok(named.every((page) => page.items.length > 0), "no empty page reveals a count");
  assert.ok(!walked.items.some((n) => n.text.startsWith("Briar private")));
  const complete = (await full(seats.a)).notes;
  assert.deepEqual([...walked.items, ...view.table.notes], complete, "still exactly the complete view");
  // The DM walks every page (it reads both kinds).
  const dmView = await roomState({ ...seats.dm, ...NEW });
  const dmWalk = await allHistory(seats.dm, "notes", dmView.history.notes);
  assert.equal(dmWalk.calls.flatMap((call) => call.pages).length, pages.length);
});

test("when what a player may read changes, every cursor and the projection fingerprint change", async () => {
  const seats = await liveRoom("Projection DM");
  await history(seats, 1500, "pj");
  const setBriarAway = async (away) => {
    const room = await readRoom(seats.dm.code);
    room.table.purses.find((p) => p.id === "b").nonParty = away;
    room.revision++;
    await updateRoom(room, room.revision - 1);
  };
  const walk = async () => {
    const view = await roomState({ ...seats.a, ...NEW });
    const { items } = await allHistory(seats.a, "ledger", view.history.ledger);
    assert.deepEqual([...items, ...view.table.ledger], (await full(seats.a)).ledger, "history plus view is the complete view");
    return { view, items };
  };
  const first = await walk();
  assert.ok(first.items.some((l) => l.purseId === "b"), "Briar travels with the party: Arden reads Briar's lines");
  assert.match(first.view.history.projection, /^[0-9a-f]{32}$/);
  // Access lost: Briar leaves the party.
  await setBriarAway(true);
  const lost = await walk();
  assert.notEqual(lost.view.history.projection, first.view.history.projection);
  assert.notEqual(lost.view.history.ledger, first.view.history.ledger);
  assert.equal((await readRoomHistory({ ...seats.a, ...NEW, list: "ledger", before: first.view.history.ledger })).missing, true, "an old cursor names nothing");
  assert.ok(!lost.items.some((l) => l.purseId === "b"), "no line of Briar's any more");
  // Access gained: Briar is back.
  await setBriarAway(false);
  const gained = await walk();
  assert.notEqual(gained.view.history.projection, lost.view.history.projection);
  assert.ok(gained.items.some((l) => l.purseId === "b"), "Briar's lines again");
  // The DM's projection does not depend on the party.
  const dm = await roomState({ ...seats.dm, ...NEW });
  await setBriarAway(true);
  assert.equal((await roomState({ ...seats.dm, ...NEW })).history.projection, dm.history.projection);
});

test("older clients (protocol 11 and earlier) receive the complete campaign, as before", async () => {
  const seats = await liveRoom();
  await history(seats, 300);
  await send(seats.dm, "s1", [{ id: "session-1", kind: "session", name: "One", end: false }]);
  await send(seats.dm, "end-1", [{ id: "end-1", kind: "session", name: "One", end: true }]);
  await history(seats, 300, "n");
  const room = await readRoom(seats.dm.code);
  for (const protocol of [undefined, 3, 10, 11]) {
    const view = await roomState({ ...seats.dm, tabletopProtocol: protocol });
    assert.equal(view.history, undefined);
    assert.equal(view.table.ledger.length, room.table.ledger.length);
    assert.equal(view.table.notes.length, room.table.notes.length);
    assert.ok(view.table.journal.reports.every((r) => r.snapshot.length > 100 && !r.deferred));
    assert.ok(!view.table.notes.some((n) => n.id === LEGACY_HISTORY_NOTICE_ID));
  }
  // A command from an older client answers with its complete view too.
  const answer = await send(seats.a, "old-client-line", [message("old-client-line", "a", "From an old app")], OLD);
  assert.equal(answer.table.notes.length, room.table.notes.filter((n) => n.to !== "dm" || n.purseId === "a").length + 1);
});

test("an older client of a campaign that has grown past what it could load gets the newest lines and a notice", async () => {
  const seats = await liveRoom();
  const room = await readRoom(seats.dm.code);
  // More current-session history than a whole campaign could hold before step 4 (4 MB).
  room.table.notes = Array.from({ length: Math.ceil(ROOM_BODY_LIMIT / 200) + 2_000 }, (_, i) => ({ id: `bulk-${i}`, at: i, from: "dm", to: "party", purseId: "", text: "x".repeat(200) }));
  room.revision++;
  // Stored below the application guard: a live campaign may only grow this large once the live
  // cap is raised (room-size.ts), which current clients load on demand.
  const encoded = await encodeRoomImages(room);
  const write = roomWriteStatements(db, room, { expect: (await readStoredRoom(db, room.code)).version, body: encoded.body });
  assert.equal(write.changed(await db.batch(write.statements), write.statements), true);
  const old = await roomState({ ...seats.a, ...OLD });
  assert.equal(old.table.notes[0].id, LEGACY_HISTORY_NOTICE_ID);
  assert.match(old.table.notes[0].text, /Update Lootsplitter.*Nothing was deleted/);
  assert.ok(old.table.notes.length < room.table.notes.length / 10);
  assert.deepEqual(old.table.notes.slice(1), (await roomState({ ...seats.a, ...NEW })).table.notes, "the newest lines, as a current client gets them");
  // Nothing was lost: the whole campaign is still stored.
  assert.equal((await readRoom(seats.dm.code)).table.notes.length, room.table.notes.length);
});

test("an older client of a paged campaign with large resource packs still gets the complete view", async () => {
  const seats = await liveRoom("Packs DM");
  await history(seats, 600, "pk");
  const room = await readRoom(seats.dm.code);
  // About 6 MB of resource packs: stored in their own table, outside every size cap, and restored
  // into older clients' views. They must not count toward what an older client can load.
  room.table.journal.resourceLibrary = {
    packs: Array.from({ length: 5 }, (_, i) => ({
      format: "lootsplit.resource-pack",
      version: 1,
      id: `pack-${i}`,
      revision: "1",
      title: `Pack ${i}`,
      description: "",
      attribution: "",
      entries: Array.from({ length: 100 }, (_, e) => ({ id: `r-${i}-${e}`, name: `Entry ${e}`, text: "p".repeat(12_000), sources: [{ book: "Test book", pdfPage: 1, printedPage: null }], warnings: [], tags: [], kind: "reference" })),
    })),
  };
  room.revision++;
  await updateRoom(room, room.revision - 1);
  assert.ok((await pagesOf(seats.dm.code, "notes")).length > 0, "history is paged");
  for (const seat of [seats.dm, seats.a]) {
    const old = await roomState({ ...seat, ...OLD });
    assert.notEqual(old.table.notes[0]?.id, LEGACY_HISTORY_NOTICE_ID, "no cut");
    const complete = (await readRoom(seats.dm.code)).table;
    if (seat === seats.dm) {
      assert.equal(old.table.notes.length, complete.notes.length, "every chat line");
      assert.equal(old.table.ledger.length, complete.ledger.length, "every ledger line");
      assert.equal(old.table.journal.resourceLibrary.packs.length, 5, "the packs, restored");
    }
  }
});

test("an existing large room migrates to history pages on its next write, keeping every line", async () => {
  // Stored before step 4: sectioned, without history pages.
  setRoomSectionLimitsForTests({ threshold: ROOM_SECTION_THRESHOLD, min: undefined, page: 10_000_000 });
  const seats = await liveRoom("Legacy DM");
  const room = await readRoom(seats.dm.code);
  room.table.ledger = Array.from({ length: 15000 }, (_, i) => ({ id: `old-${i}`, at: i, purseId: "a", shopId: null, summary: `Old purchase ${i} of rope and lantern oil`, copper: -1, transactionType: "purchase" }));
  room.table.notes = Array.from({ length: 4000 }, (_, i) => ({ id: `chat-${i}`, at: i, from: "dm", to: "party", purseId: "", text: `Old chatter line ${i}` }));
  const base = room.revision;
  room.revision++;
  await updateRoom(room, base);
  const legacy = await readStoredRoom(db, seats.dm.code);
  assert.ok(legacy.version.sections.length > 0 && !legacy.version.sections.some((e) => e.path[0] === "$history"), "a step 3 room");
  // The release with step 4: the next write pages it.
  setRoomSectionLimitsForTests({ threshold: ROOM_SECTION_THRESHOLD, min: undefined, page: ROOM_HISTORY_PAGE_ITEMS });
  assert.equal((await roomState({ ...seats.dm, ...NEW })).history, undefined, "read as it is until written");
  await send(seats.dm, "first-after-release", [message("first-after-release", "", "Hello again")]);
  const migrated = await readStoredRoom(db, seats.dm.code);
  const ledgerPages = migrated.version.sections.filter((e) => e.path.join(".") === "$history.table.ledger");
  assert.equal(ledgerPages.length, Math.floor(15000 / ROOM_HISTORY_PAGE_ITEMS) - 1);
  assert.deepEqual(migrated.room.table.ledger, legacy.room.table.ledger, "every ledger line kept, in order");
  assert.deepEqual(migrated.room.table.notes.slice(0, -1), legacy.room.table.notes, "every chat line kept, in order");
  assert.equal(migrated.body, JSON.stringify(migrated.room), "the whole stored body round-trips");
  const view = await roomState({ ...seats.dm, ...NEW });
  assert.ok(view.table.ledger.length < 2 * ROOM_HISTORY_PAGE_ITEMS && view.history.ledger);
  setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 64 });
});

test("exports and deletion copies hold the complete history, byte for byte as without pages", async () => {
  const userId = "history-user";
  const actor = { id: "history-session" };
  await db.prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?, 'H', 'history@example.com', 1, null, 0, 0)`).bind(userId).run();
  await db.prepare(`INSERT INTO "session"(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,'history-session-token',0,0,?)`).bind(actor.id, new Date(Date.now() + 86_400_000).toISOString(), userId).run();
  const payloads = [];
  for (const page of [16, 1_000_000]) {
    setRoomSectionLimitsForTests({ threshold: 0, min: 0, page });
    const seats = await liveRoom("Export DM", shopTable(), userId);
    const { dm } = seats;
    await history(seats, 200, "x");
    await send(dm, "s1", [{ id: "session-1", kind: "session", name: "One", end: false }]);
    await send(dm, "end-1", [{ id: "end-1", kind: "session", name: "One", end: true }]);
    await history(seats, 120, "y");
    const exported = await (await campaignAction(db, userId, { action: "export", code: dm.code }, actor)).json();
    const normalize = (value) => JSON.parse(JSON.stringify(value).split(dm.code).join("CODE"));
    payloads.push({ page, exported: normalize(exported.payload), pages: (await manifest(dm.code)).filter((e) => e.path[0] === "$history").length });
    // The deletion copy: the same file plus its recovery records.
    const revision = (await readStoredRoom(db, dm.code)).version.revision;
    const deleted = await campaignAction(db, userId, { action: "delete", code: dm.code, confirm: dm.code, revision }, actor);
    assert.equal(deleted.ok, true);
    const { readBackupPayload } = await import("../cloudflare/backup-parts.mjs");
    const backup = await db.prepare("SELECT body FROM library_backups WHERE id=?").bind(deleted.backupId).first();
    const payload = await readBackupPayload(db, deleted.backupId, backup.body);
    assert.equal(payload.ledger.length, exported.payload.ledger.length);
    assert.equal(payload.notes.length, exported.payload.notes.length);
  }
  setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 64 });
  assert.ok(payloads[0].pages > 10 && payloads[1].pages === 0);
  // Room codes, seat IDs and clock times differ between the two campaigns; nothing else may.
  const strip = (p) => JSON.stringify(p.exported).replace(/[0-9a-f-]{36}/g, "ID").replace(/\b1[6-9]\d{11}\b/g, "T");
  assert.ok(strip(payloads[0]) === strip(payloads[1]), "the exported campaign is the same with and without history pages");
  assert.ok(payloads[0].exported.ledger.length >= 120 && payloads[0].exported.journal.reports.length === 1);
  assert.ok(JSON.parse(payloads[0].exported.journal.reports[0].snapshot).ledger.length >= 200, "the archived session is complete");
});

test("past the total-size warning threshold a session still ends; the owner is warned and the DM gets a notice", async () => {
  const { ROOM_TOTAL_LIMIT } = await import("../src/lib/quire/room-size.ts");
  const seats = await liveRoom("Total warning DM");
  await send(seats.dm, "cap-s1", [{ id: "cap-s1", kind: "session", name: "One", end: false }]);
  await history(seats, 100, "cap");
  // Archived sessions already stored up to the threshold (a stand-in row: only its size counts here).
  await db.prepare("INSERT INTO campaign_room_reports(code,reference,body) VALUES (?,?,?)").bind(seats.dm.code, "session-report:padding", "x".repeat(ROOM_TOTAL_LIMIT)).run();
  const logsBefore = (await db.prepare("SELECT COUNT(*) AS n FROM owner_monitor_logs WHERE source='room-storage'").first()).n;
  // Never refused: the session is archived as always.
  await send(seats.dm, "cap-e1", [{ id: "cap-e1", kind: "session", name: "One", end: true }]);
  assert.ok((await readRoom(seats.dm.code)).table.journal.reports.some((r) => r.name === "One"), "the session was archived");
  const logs = await db.prepare("SELECT body FROM owner_monitor_logs WHERE source='room-storage'").all();
  assert.equal(logs.results.length, logsBefore + 1, "one owner-monitor entry");
  const body = JSON.parse(logs.results.at(-1).body);
  assert.equal(body.warning, "total");
  assert.equal(body.refusal, undefined, "a warning, not a refusal");
  assert.equal(body.totalLimit, ROOM_TOTAL_LIMIT);
  assert.ok(body.totalBytes > ROOM_TOTAL_LIMIT);
  // The DM's view carries the notice (old and new protocols); players never see it.
  for (const protocol of [NEW, OLD]) {
    const dm = await roomState({ ...seats.dm, ...protocol });
    assert.ok(dm.storageWarning.totalBytes > ROOM_TOTAL_LIMIT && dm.storageWarning.limit === ROOM_TOTAL_LIMIT);
    assert.equal((await roomState({ ...seats.a, ...protocol })).storageWarning, undefined);
  }
  // Play goes on, and the notice stays until an archive finds the total below the threshold.
  await send(seats.dm, "cap-more", [buy("cap-more-buy"), message("cap-more-msg", "a", "Still playing")]);
  assert.ok((await roomState({ ...seats.dm, ...NEW })).storageWarning);
  await db.prepare("DELETE FROM campaign_room_reports WHERE reference='session-report:padding'").run();
  await send(seats.dm, "cap-s2", [{ id: "cap-s2", kind: "session", name: "Two", end: false }]);
  await send(seats.dm, "cap-e2", [{ id: "cap-e2", kind: "session", name: "Two", end: true }]);
  assert.equal((await roomState({ ...seats.dm, ...NEW })).storageWarning, undefined, "cleared below the threshold");
});

test("a table whose archived sessions are not loaded is never uploaded as a campaign", async () => {
  const { readJournal } = await import("../src/lib/quire/journal.ts");
  const table = shopTable();
  table.journal = readJournal({ ...(table.journal ?? {}), reports: [{ id: "r1", name: "One", at: 1, snapshot: "", deferred: true }] });
  await assert.rejects(openRoom({ name: "Rehost DM", table }), /not loaded on this device.*Nothing was changed/);
  table.journal.reports = [{ id: "r1", name: "One", at: 1, snapshot: "\u0000lootsplit-deferred-report:session-report:abc" }];
  await assert.rejects(openRoom({ name: "Rehost DM", table }), /not loaded on this device/);
});
