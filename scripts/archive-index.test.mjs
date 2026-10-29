// Archived-session lookup keys (storage follow-up part 3, migration 0030). Undo of an archived
// ledger line and quest reward links load only the archived sessions that can matter; the result
// is byte for byte the same as loading every session (each scenario runs twice on its own
// database, with selections on and off, fixed time, IDs and randomness), nothing applies twice,
// and whenever the keys cannot answer (a session not indexed, a trade-linked line, an unplanned
// command) every session is loaded as before. Disposable local D1 stand-ins; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localAccountDb } from "./account-dev-db.mjs";
import { assertAdditiveSql } from "./production-migrations.mjs";

const { submitCommands, openRoom, joinRoom, choosePace, roomState, historyEngineStats, setArchiveSelectionForTests } = await import("../src/lib/quire/cloud.server.ts");
const { readRoom, updateRoom } = await import("../src/lib/quire/room-store.server.ts");
const { readStoredRoom, setRoomSectionLimitsForTests } = await import("../cloudflare/room-storage.mjs");
const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
const { canonicalJson } = await import("../src/lib/quire/canonical-json.ts");
const { toCopper } = await import("../src/lib/quire/money.ts");
const { questsOf } = await import("../src/lib/quire/quests.ts");
const { clearViewSectionCacheForTests } = await import("../src/lib/quire/view-sections.server.ts");
const { clearHistoryCachesForTests } = await import("../src/lib/quire/history.server.ts");

const OLD = { tabletopProtocol: 11 };
function shopTable() {
  const table = tradeFixture();
  table.shops.push({ id: "outfitter", name: "Outfitter", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1 });
  table.stock.push({ id: "rope", shopId: "outfitter", name: "Rope", copper: 100, baseCopper: 100, rarity: "common", quantity: 100000, notes: "50 feet", category: "general" });
  table.holdings.push({ id: "potion", purseId: "party", name: "Potion of healing", kind: "item", quantity: 3, unitCopper: 50, notes: "", pool: { at: 1, source: "add-loot" } });
  return table;
}
const buy = (id, purseId = "a") => ({ id, kind: "buy", stockId: "rope", purseId, quantity: 1 });
const message = (id, text) => ({ id, kind: "message", to: "party", purseId: "a", text });

/**
 * Runs `script` on a fresh database with fixed time, IDs and randomness; returns what it returns
 * plus the stored campaign and every seat's complete view.
 */
async function scenario(selections, script) {
  const realNow = Date.now,
    realRandom = Math.random,
    realUuid = crypto.randomUUID.bind(crypto);
  const db = localAccountDb();
  globalThis.__env__ = { DB: db };
  clearViewSectionCacheForTests();
  clearHistoryCachesForTests();
  setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 16 });
  setArchiveSelectionForTests(selections);
  let clock = 1_800_000_000_000,
    seq = 0,
    seed = 7;
  Date.now = () => clock;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const before = historyEngineStats.selections.length;
  try {
    const dm = await openRoom({ name: "Index DM", table: shopTable() });
    const a = await joinRoom({ code: dm.code, purseId: "a", name: "Arden" });
    await choosePace({ ...dm, live: true });
    const seats = { dm, a: { code: dm.code, token: a.token } };
    // Every command response (or refusal) is recorded and compared between the two runs.
    const responses = [];
    const send = async (seat, batchId, commands) => {
      clock += 1000;
      try {
        const view = await submitCommands({ ...seat, batchId, commands });
        responses.push({ batchId, view: canonicalJson(view) });
        return view;
      } catch (error) {
        responses.push({ batchId, error: error.message });
        throw error;
      }
    };
    const inject = async (lines, events = []) => {
      const room = await readRoom(dm.code);
      room.table.ledger.push(...lines);
      room.table.journal.events.push(...events);
      room.revision++;
      await updateRoom(room, room.revision - 1);
    };
    const session = async (n, lines, extra) => {
      await send(dm, `s-${n}`, [{ id: `s-${n}`, kind: "session", name: `Session ${n}`, end: false }]);
      for (let i = 0; i < lines; i += 20) await send(dm, `b-${n}-${i}`, Array.from({ length: 20 }, (_, k) => buy(`b-${n}-${i + k}`, k % 2 ? "a" : "b")));
      if (extra) await extra();
      await send(seats.a, `m-${n}`, [message(`m-${n}`, `Session ${n}`)]);
      await send(dm, `e-${n}`, [{ id: `e-${n}`, kind: "session", name: `Session ${n}`, end: true }]);
    };
    const result = await script({ db, dm, seats, send, session, inject, archived: async (id) => {
      for (const r of (await readRoom(dm.code)).table.journal.reports) {
        const line = JSON.parse(r.snapshot).ledger.find((l) => l.id === id);
        if (line) return line;
      }
      return null;
    } });
    const stored = await readStoredRoom(db, dm.code);
    const views = {};
    for (const [name, seat] of Object.entries(seats)) views[name] = (await roomState({ ...seat, ...OLD })).table;
    const whole = await readRoom(dm.code);
    return { ...result, responses, table: stored.room.table, whole: whole.table, views, code: dm.code, selections: historyEngineStats.selections.slice(before), db };
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
    crypto.randomUUID = realUuid;
    setArchiveSelectionForTests(true);
    setRoomSectionLimitsForTests({});
  }
}
const same = (x, y) => {
  const norm = (value, code) => JSON.stringify(value).split(code).join("CODE");
  assert.equal(norm(x.table, x.code), norm(y.table, y.code), "the stored campaigns are identical");
  assert.equal(norm(x.whole, x.code), norm(y.whole, y.code), "the whole campaigns are identical");
  for (const seat of Object.keys(x.views)) assert.equal(norm(x.views[seat], x.code), norm(y.views[seat], y.code), `${seat}'s complete view is identical`);
  assert.equal(x.responses.length, y.responses.length);
  for (const [i, response] of x.responses.entries())
    assert.equal(norm(response, x.code), norm(y.responses[i], y.code), `response to ${response.batchId} is identical`);
};
const settle = (promise) => promise.then(() => "applied", (error) => error.message);
const undo = (id, line) => ({ id, kind: "ledger-void", target: { kind: "ledger", id: line.id }, before: canonicalJson(line), reason: "Wrong." });

test("0030 (archive keys) is additive", () => {
  const name = "0030_campaign_room_archive_keys.sql";
  assert.equal(assertAdditiveSql(name, readFileSync(new URL(`../cloudflare/migrations/${name}`, import.meta.url), "utf8")), 1);
});

test("archiving a session indexes it in the same write", async () => {
  const run = await scenario(true, async ({ db, dm, session }) => {
    await session(1, 40);
    const keys = (await db.prepare("SELECT key FROM campaign_room_archive_keys WHERE code=?").bind(dm.code).all()).results.map((r) => r.key);
    return { keys };
  });
  assert.ok(run.keys.includes("*"));
  assert.ok(run.keys.includes("id:b-1-0") && run.keys.includes("id:b-1-39"));
});

test("Undo of an archived line loads only its session, applies once, and equals loading every session", async () => {
  const script = async ({ dm, send, session, archived }) => {
    for (let n = 1; n <= 5; n++) await session(n, 40);
    const line = await archived("b-2-3");
    await send(dm, "undo-1", [undo("undo-1", line)]);
    await send(dm, "undo-1-retry", [undo("undo-1", line)]); // the same action again: its receipt
    await send(dm, "undo-2", [undo("undo-2", line)]); // a second Undo of the same line: nothing
    // The void line is archived with session 6; Undo again: the earlier void is found there.
    await session(6, 20);
    await send(dm, "undo-3", [undo("undo-3", line)]);
    const t = await readRoom(dm.code);
    const voids = t.table.journal.reports.flatMap((r) => JSON.parse(r.snapshot).ledger).filter((l) => l.reversalOf === "b-2-3");
    return { voids: voids.length, coins: t.table.purses.map((p) => [p.id, toCopper(p.coins)]) };
  };
  const selected = await scenario(true, script);
  const every = await scenario(false, script);
  same(selected, every);
  assert.equal(selected.voids, 1, "voided exactly once");
  assert.ok(selected.selections.length >= 2, "the Undos ran on selected sessions");
  assert.ok(selected.selections.every((s) => s.loaded < s.archived), "fewer sessions than the campaign holds");
  assert.deepEqual(selected.selections[0], { kinds: ["ledger-void"], loaded: 1, archived: 5 });
  assert.equal(every.selections.length, 0);
});

test("quest reward links to archived receipts load only those sessions and equal loading every session", async () => {
  const script = async ({ dm, send, session }) => {
    for (let n = 1; n <= 4; n++) await session(n, 20);
    const draft = { title: "Rope", summary: "Find it.", locationIds: [], markers: [], areas: [], objectives: [], rewardText: "Rope", dmNotes: "" };
    await send(dm, "q", [{ id: "q", kind: "quest-save", questId: null, revision: null, quest: draft }]);
    const rev = async () => questsOf((await readRoom(dm.code)).table).find((q) => q.id === "q").revision;
    await send(dm, "q-reveal", [{ id: "q-reveal", kind: "quest-reveal", questId: "q", revision: await rev(), audience: { kind: "party" } }]);
    await send(dm, "q-link", [{ id: "q-link", kind: "quest-link-reward", questId: "q", revision: await rev(), link: { kind: "ledger", id: "b-3-1" } }]);
    await send(dm, "q-missing", [{ id: "q-missing", kind: "quest-link-reward", questId: "q", revision: await rev(), link: { kind: "ledger", id: "no-such-line" } }]).catch((error) => error.message);
    return {};
  };
  const selected = await scenario(true, script);
  const every = await scenario(false, script);
  same(selected, every);
  assert.ok(selected.selections.some((s) => s.kinds[0] === "quest-link-reward" && s.loaded === 1 && s.archived === 4));
});

test("a session that is not indexed loads every session, then is indexed for next time", async () => {
  const script = async ({ db, dm, send, session, archived }) => {
    for (let n = 1; n <= 3; n++) await session(n, 20);
    // As if session 1 had been archived before 0030.
    const first = (await db.prepare("SELECT reference FROM campaign_room_reports WHERE code=? ORDER BY rowid LIMIT 1").bind(dm.code).first()).reference;
    await db.prepare("DELETE FROM campaign_room_archive_keys WHERE code=? AND reference=?").bind(dm.code, first).run();
    const line = await archived("b-3-2");
    await send(dm, "undo-1", [undo("undo-1", line)]);
    // Indexed by that full read (in the background).
    await new Promise((resolve) => setTimeout(resolve, 50));
    const indexed = await db.prepare("SELECT 1 FROM campaign_room_archive_keys WHERE code=? AND reference=? AND key='*'").bind(dm.code, first).first();
    const line2 = await archived("b-2-2");
    await send(dm, "undo-2", [undo("undo-2", line2)]);
    return { indexed: !!indexed };
  };
  const selected = await scenario(true, script);
  const every = await scenario(false, script);
  same(selected, every);
  assert.equal(selected.indexed, true);
  assert.equal(selected.selections.filter((s) => s.kinds[0] === "ledger-void").length, 1, "the first Undo loaded every session; the second a selection");
});

test("Undo of a trade-linked line, or an unplanned command, loads every session and gives the same result", async () => {
  const script = async ({ dm, send, session, archived }) => {
    await session(1, 20);
    // A purchase line carrying a market receipt link (as an exchange purchase records it).
    const room = await readRoom(dm.code);
    room.table.ledger.push({ id: "traded-1", at: 1, purseId: "a", shopId: null, summary: "Bought 1 Silk", copper: -100, transactionType: "purchase", trade: { receiptId: "no-such-receipt", leg: "owner" } });
    room.revision++;
    await updateRoom(room, room.revision - 1);
    await session(2, 20);
    const line = await archived("traded-1");
    const error = await send(dm, "undo-trade", [undo("undo-trade", line)]).then(() => "", (e) => e.message);
    // A batch with an Undo and another command: not planned, every session.
    const plain = await archived("b-1-1");
    await send(dm, "mixed", [undo("undo-mixed", plain), buy("mixed-buy")]);
    return { error };
  };
  const selected = await scenario(true, script);
  const every = await scenario(false, script);
  same(selected, every);
  assert.equal(selected.error, every.error);
  assert.ok(selected.error, "the incomplete trade is refused the same way");
  assert.equal(selected.selections.length, 0, "no selection was used");
});

test("reused line IDs, voids recorded only in summaries, multi-Undo batches and players: identical either way", async () => {
  const script = async ({ dm, seats, send, session, inject, archived }) => {
    // A note in session 1 reuses the ID "V"; session 3 holds a genuine void of b-2-3 under "V".
    await session(1, 20, () => inject([{ id: "V", at: 1, purseId: "b", shopId: null, copper: 0, summary: "A note", transactionType: "adjustment" }]));
    await session(2, 20);
    const x = await archived("b-2-3");
    await session(3, 20, () => inject([{ id: "V", at: 2, purseId: x.purseId, shopId: x.shopId, copper: -x.copper, summary: "Voided " + x.summary + " (void:" + x.id + ")", transactionType: "adjustment", reversalOf: x.id }]));
    const outcomes = [await settle(send(dm, "undo-hidden", [undo("undo-hidden", x)]))];
    // A void recorded only in a summary (no reversalOf) in session 4.
    const y = await archived("b-1-5");
    await session(4, 20, () => inject([{ id: "summary-void", at: 3, purseId: y.purseId, shopId: y.shopId, copper: -y.copper, summary: "Voided by hand (void:" + y.id + ")", transactionType: "adjustment" }]));
    outcomes.push(await settle(send(dm, "undo-summary", [undo("undo-summary", y)])));
    // Undo of a current line whose earlier void is archived.
    await session(5, 0, () => inject([{ id: "cur-void", at: 4, purseId: "a", shopId: null, copper: 50, summary: "Voided Current fee (void:cur-1)", transactionType: "adjustment", reversalOf: "cur-1" }]));
    await inject([{ id: "cur-1", at: 5, purseId: "a", shopId: null, copper: -50, summary: "Current fee", transactionType: "adjustment" }]);
    const current = (await readRoom(dm.code)).table.ledger.find((l) => l.id === "cur-1");
    outcomes.push(await settle(send(dm, "undo-current", [undo("undo-current", current)])));
    // A batch with two Undos from different sessions.
    const p = await archived("b-3-7"), q = await archived("b-4-9");
    outcomes.push(await settle(send(dm, "undo-two", [undo("undo-two-a", p), undo("undo-two-b", q)])));
    // A player's Undo is refused the same way, without loading archived sessions.
    outcomes.push(await settle(send(seats.a, "player-undo", [undo("player-undo", q)])));
    return { outcomes };
  };
  const selected = await scenario(true, script);
  const every = await scenario(false, script);
  same(selected, every);
  assert.deepEqual(selected.outcomes, every.outcomes);
  assert.equal(selected.outcomes[4] === "applied", false, "the player is refused");
  const voidsOf = (run, id) => run.whole.journal.reports.flatMap((r) => JSON.parse(r.snapshot).ledger).concat(run.whole.ledger).filter((l) => l.reversalOf === id).length;
  assert.equal(voidsOf(selected, "b-2-3"), 1, "the hidden void is found: no second reversal");
  assert.equal(voidsOf(selected, "cur-1"), 1, "the archived void of a current line is found");
  assert.ok(selected.selections.some((s) => s.kinds.length === 2), "a two-Undo batch ran on a selection");
});

test("quest reward links of every kind (ledger, encounter award, treasure-pool resolution): identical either way", async () => {
  const script = async ({ dm, seats, send, session, inject }) => {
    await session(1, 20, async () => {
      // An encounter coin award line, and a treasure-pool resolution, both archived with session 1.
      await inject([{ id: "award-1-coins", at: 1, purseId: "a", shopId: null, copper: 500, summary: "Encounter award: 5 gp", transactionType: "adjustment", award: { receiptId: "award-1", role: "coins" } }]);
      await send(seats.a, "claim-a", [{ id: "claim-a", kind: "loot-claim", holdingId: "potion", purseId: "a", choice: "need", before: null }]);
      const { lootFingerprint } = await import("../src/lib/quire/loot-claims.ts");
      const lots = [{ holdingId: "potion", quantity: 3 }];
      await send(dm, "loot-1", [{ id: "loot-1", kind: "loot-resolve", method: "round-robin", lots, expect: lootFingerprint((await readRoom(dm.code)).table, lots, "round-robin") }]);
    });
    await session(2, 20);
    await session(3, 20);
    const draft = { title: "Rope", summary: "Find it.", locationIds: [], markers: [], areas: [], objectives: [], rewardText: "Rope", dmNotes: "" };
    await send(dm, "q", [{ id: "q", kind: "quest-save", questId: null, revision: null, quest: draft }]);
    const rev = async () => questsOf((await readRoom(dm.code)).table).find((q) => q.id === "q").revision;
    await send(dm, "q-reveal", [{ id: "q-reveal", kind: "quest-reveal", questId: "q", revision: await rev(), audience: { kind: "party" } }]);
    const outcomes = [];
    for (const link of [{ kind: "ledger", id: "b-2-4" }, { kind: "encounter-award", id: "award-1" }, { kind: "loot-resolution", id: "loot-1" }, { kind: "loot-resolution", id: "missing" }])
      outcomes.push(await settle(send(dm, `link-${link.kind}-${link.id}`, [{ id: `link-${link.kind}-${link.id}`, kind: "quest-link-reward", questId: "q", revision: await rev(), link }])));
    return { outcomes };
  };
  const selected = await scenario(true, script);
  const every = await scenario(false, script);
  same(selected, every);
  assert.deepEqual(selected.outcomes, every.outcomes);
  assert.ok(selected.selections.filter((s) => s.kinds[0] === "quest-link-reward").length >= 3);
  assert.deepEqual(selected.outcomes.slice(0, 3), ["applied", "applied", "applied"], "each kind of archived receipt is found and linked");
  assert.notEqual(selected.outcomes[3], "applied", "a missing resolution is refused");
});
