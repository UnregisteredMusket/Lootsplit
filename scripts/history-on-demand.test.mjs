// History on demand, part storage (split from one file so the parts run in parallel;
// shared setup in history-on-demand-setup.mjs). Disposable local D1 stand-in only; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { NEW, OLD, assertAdditiveSql, buy, canonicalJson, clearHistoryCachesForTests, clearViewSectionCacheForTests, db, history, liveRoom, localAccountDb, message, pageRows, pagesOf, questsOf, readFileSync, readRoom, readStoredRoom, roomState, send, setRoomSectionLimitsForTests, toCopper, tradeSeasonFingerprint, setTick } from "./history-on-demand-setup.mjs";
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
    setTick(() => (clock += 1000));
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
      setTick(() => {});
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
