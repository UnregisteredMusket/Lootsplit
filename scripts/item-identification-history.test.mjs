// Item identification on paged storage (history on demand): with an unidentified item in the
// campaign, a command on the working set (a purchase, giving or selling the unidentified item)
// still reads no history page, and the players' view stays presented. A disposable local D1
// stand-in with every migration applied; never a real campaign or account.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";

const db = localAccountDb();
globalThis.__env__ = { DB: db };
const { openRoom, joinRoom, roomState, submitCommands, choosePace } = await import("../src/lib/quire/cloud.server.ts");
const { readStoredRoom, setRoomSectionLimitsForTests } = await import("../cloudflare/room-storage.mjs");
const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
const { HISTORY_PROTOCOL } = await import("../src/lib/quire/history-pages.ts");

const NEW = { tabletopProtocol: HISTORY_PROTOCOL };
const TRUE_NAME = "Ring of Djinni Summoning";

function table() {
  const t = tradeFixture();
  t.shops.push({ id: "outfitter", name: "Outfitter", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1, acceptAnyCategory: true });
  t.stock.push({ id: "rope", shopId: "outfitter", name: "Rope", copper: 100, baseCopper: 100, rarity: "common", quantity: 100000, notes: "50 feet", category: "general" });
  t.holdings.push({
    id: "ring", purseId: "a", name: TRUE_NAME, kind: "item", quantity: 2, unitCopper: 987653, notes: "", category: "jewels",
    unidentified: { name: "Plain brass ring", value: 2500 },
  });
  return t;
}

setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 64 });
test.after(() => setRoomSectionLimitsForTests({}));

test("with an unidentified item present, working-set commands read no history page", async () => {
  const dm = await openRoom({ name: "Identify history DM", table: table() });
  const a = await joinRoom({ code: dm.code, purseId: "a", name: "Arden" });
  await choosePace({ ...dm, live: true });
  const send = (seat, batchId, commands) => submitCommands({ ...seat, ...NEW, batchId, commands });
  for (let start = 0; start < 300; start += 100)
    await send(dm, `buys-${start}`, Array.from({ length: 100 }, (_, i) => ({ id: `buy-${start + i}`, kind: "buy", stockId: "rope", purseId: "a", quantity: 1 })));
  const pages = ((await readStoredRoom(db, dm.code)).version.sections ?? []).filter((e) => e.path.join(".") === "$history.table.ledger");
  assert.ok(pages.length >= 3, `the ledger is paged (${pages.length} pages)`);
  const hashes = pages.map((p) => p.hash);
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
    await send(dm, "cheap", [{ id: "cheap-1", kind: "buy", stockId: "rope", purseId: "a", quantity: 1 }]);
    // Giving one ring (a new holding ID) and selling the other (the item ends) stay on the working set.
    await send({ code: dm.code, token: a.token }, "give", [{ id: "give-1", kind: "give", fromId: "a", toId: "b", copper: 0, holdingId: "ring", quantity: 1 }]);
    await send({ code: dm.code, token: a.token }, "sell", [{ id: "sell-1", kind: "sell", holdingId: "ring", shopId: "outfitter", quantity: 1 }]);
    const pageReads = reads.filter((r) => /^SELECT[^]*\bbody\b[^]*FROM campaign_room_sections/.test(r) && hashes.some((h) => r.includes(h)));
    assert.deepEqual(pageReads, [], "no history page was read");
  } finally {
    db.prepare = real;
  }
  const whole = (await roomState({ ...dm, tabletopProtocol: 11 })).table;
  assert.equal(whole.ledger.find((l) => l.id === "sell-1").copper, 1250, "sold at the presented value");
  assert.ok(whole.journal.events.some((e) => e.identityEnded?.holdingIds.includes("ring")), "the ended item is kept for the session");
  const view = await roomState({ code: dm.code, token: a.token, ...NEW });
  assert.ok(!JSON.stringify(view).includes(TRUE_NAME));
});
