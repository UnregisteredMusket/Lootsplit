// "Favour whoever is behind" without loading every archived session (storage follow-up (a)): each
// archived session is read on its own, digested and released; the batch runs on the digests. The
// result is byte for byte the same as loading every session (each scenario runs twice on its own
// database, fixed time, IDs and randomness), responses included; a run that needs more falls back.
// Disposable local D1 stand-ins; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";

const { submitCommands, openRoom, joinRoom, choosePace, roomState, historyEngineStats, setArchiveSelectionForTests } = await import("../src/lib/quire/cloud.server.ts");
const { readRoom } = await import("../src/lib/quire/room-store.server.ts");
const { readStoredRoom, setRoomSectionLimitsForTests } = await import("../cloudflare/room-storage.mjs");
const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
const { canonicalJson } = await import("../src/lib/quire/canonical-json.ts");
const { fairnessStandings } = await import("../src/lib/quire/loot-fairness.ts");
const { lootFingerprint } = await import("../src/lib/quire/loot-claims.ts");
const { clearViewSectionCacheForTests } = await import("../src/lib/quire/view-sections.server.ts");
const { clearHistoryCachesForTests } = await import("../src/lib/quire/history.server.ts");

async function scenario(digests, script) {
  const realNow = Date.now,
    realRandom = Math.random,
    realUuid = crypto.randomUUID.bind(crypto);
  const db = localAccountDb();
  globalThis.__env__ = { DB: db };
  clearViewSectionCacheForTests();
  clearHistoryCachesForTests();
  setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 16 });
  setArchiveSelectionForTests(digests);
  let clock = 1_800_000_000_000,
    seq = 0,
    seed = 11;
  Date.now = () => clock;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const before = historyEngineStats.selections.length;
  try {
    const table = tradeFixture();
    for (let i = 0; i < 6; i++) table.holdings.push({ id: `potion-${i}`, purseId: "party", name: `Potion ${i}`, kind: "item", quantity: 2, unitCopper: 50 + i, notes: "", pool: { at: 1, source: "add-loot" } });
    const dm = await openRoom({ name: "Favour DM", table });
    const a = await joinRoom({ code: dm.code, purseId: "a", name: "Arden" });
    const b = await joinRoom({ code: dm.code, purseId: "b", name: "Briar" });
    await choosePace({ ...dm, live: true });
    const seats = { dm, a: { code: dm.code, token: a.token }, b: { code: dm.code, token: b.token } };
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
    const out = await script({ dm, seats, send });
    const stored = await readStoredRoom(db, dm.code);
    const views = {};
    for (const [name, seat] of Object.entries(seats)) views[name] = (await roomState({ ...seat, tabletopProtocol: 11 })).table;
    return { out, responses, table: stored.room.table, views, code: dm.code, selections: historyEngineStats.selections.slice(before) };
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
    crypto.randomUUID = realUuid;
    setArchiveSelectionForTests(true);
    setRoomSectionLimitsForTests({});
  }
}
const norm = (value, code) => JSON.stringify(value).split(code).join("CODE");
function same(x, y) {
  assert.equal(norm(x.table, x.code), norm(y.table, y.code), "the stored campaigns are identical");
  for (const seat of Object.keys(x.views)) assert.equal(norm(x.views[seat], x.code), norm(y.views[seat], y.code), `${seat}'s complete view is identical`);
  assert.equal(x.responses.length, y.responses.length);
  for (const [i, r] of x.responses.entries()) assert.equal(norm(r, x.code), norm(y.responses[i], y.code), `response to ${r.batchId}`);
}
const settle = (promise) => promise.then(() => "applied", (error) => error.message);

test("favour over every archived session runs on per-session digests and equals loading every session", async () => {
  const script = async ({ dm, seats, send }) => {
    // Four sessions, each with a coin split and a treasure-pool resolution (fairness receipts).
    for (let n = 0; n < 4; n++) {
      await send(dm, `s-${n}`, [{ id: `s-${n}`, kind: "session", name: `Session ${n}`, end: false }]);
      await send(dm, `split-${n}`, [{ id: `split-${n}`, kind: "coin-split", sourceId: "party", copper: 300 + n * 10, recipientIds: ["a", "b"], remainder: { rule: "party-fund", purseId: "party" }, expect: { share: 150 + n * 5, remainderTo: null } }]);
      await send(n % 2 ? seats.a : seats.b, `claim-${n}`, [{ id: `claim-${n}`, kind: "loot-claim", holdingId: `potion-${n}`, purseId: n % 2 ? "a" : "b", choice: "need", before: null }]);
      const lots = [{ holdingId: `potion-${n}`, quantity: 2 }];
      await send(dm, `resolve-${n}`, [{ id: `resolve-${n}`, kind: "loot-resolve", method: "round-robin", lots, expect: lootFingerprint((await readRoom(dm.code)).table, lots, "round-robin") }]);
      await send(dm, `e-${n}`, [{ id: `e-${n}`, kind: "session", name: `Session ${n}`, end: true }]);
    }
    // Favour whoever is behind over the whole campaign, then over this session.
    await send(dm, "s-4", [{ id: "s-4", kind: "session", name: "Session 4", end: false }]);
    const outcomes = [];
    for (const [i, basis] of ["campaign", "session"].entries()) {
      const holdingId = `potion-${4 + i}`;
      await send(seats.a, `claim-f${i}`, [{ id: `claim-f${i}`, kind: "loot-claim", holdingId, purseId: "a", choice: "need", before: null }]);
      await send(seats.b, `claim-g${i}`, [{ id: `claim-g${i}`, kind: "loot-claim", holdingId, purseId: "b", choice: "need", before: null }]);
      const t = (await readRoom(dm.code)).table;
      const lots = [{ holdingId, quantity: 2 }];
      const totals = fairnessStandings(t, basis);
      outcomes.push(await settle(send(dm, `favour-${i}`, [{ id: `favour-${i}`, kind: "loot-resolve", method: "round-robin", lots, favour: { basis }, expect: lootFingerprint(t, lots, "round-robin", { basis, totals }) }])));
    }
    // A stale expectation is refused the same way.
    const t = (await readRoom(dm.code)).table;
    outcomes.push(await settle(send(dm, "favour-stale", [{ id: "favour-stale", kind: "loot-resolve", method: "round-robin", lots: [{ holdingId: "potion-5", quantity: 1 }], favour: { basis: "campaign" }, expect: "stale" }])));
    void t;
    return outcomes;
  };
  const digested = await scenario(true, script);
  const every = await scenario(false, script);
  same(digested, every);
  assert.deepEqual(digested.out, every.out);
  assert.deepEqual(digested.out.slice(0, 2), ["applied", "applied"], "both favour resolutions applied");
  const favour = digested.selections.filter((s) => s.kinds.includes("loot-resolve"));
  assert.ok(favour.length >= 2 && favour.every((s) => s.loaded === 0 && s.archived === 4), "no archived session was held for the favour batches");
  assert.equal(every.selections.length, 0);
});
