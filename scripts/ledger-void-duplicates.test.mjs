// Money review of #385 (proved on main before this fix): Undo in a shared room must never reverse a
// line twice when its earlier void is stored under a line ID that an older session also used.
// Disposable local D1 stand-in; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";

const db = localAccountDb();
globalThis.__env__ = { DB: db };
const { submitCommands, openRoom, choosePace } = await import("../src/lib/quire/cloud.server.ts");
const { readRoom, updateRoom } = await import("../src/lib/quire/room-store.server.ts");
const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
const { canonicalJson } = await import("../src/lib/quire/canonical-json.ts");
const { toCopper } = await import("../src/lib/quire/money.ts");

test("Undo in a shared room finds a void stored under a reused line ID in another session", async () => {
  const table = tradeFixture();
  table.shops.push({ id: "outfitter", name: "Outfitter", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1 });
  table.stock.push({ id: "rope", shopId: "outfitter", name: "Rope", copper: 100, baseCopper: 100, rarity: "common", quantity: 1000, notes: "", category: "general" });
  const dm = await openRoom({ name: "Duplicate DM", table });
  await choosePace({ ...dm, live: true });
  const send = (batchId, commands) => submitCommands({ ...dm, batchId, commands });
  const inject = async (lines) => {
    const room = await readRoom(dm.code);
    room.table.ledger.push(...lines);
    room.revision++;
    await updateRoom(room, room.revision - 1);
  };
  const session = async (n, body) => {
    await send(`s-${n}`, [{ id: `s-${n}`, kind: "session", name: `Session ${n}`, end: false }]);
    await body();
    await send(`e-${n}`, [{ id: `e-${n}`, kind: "session", name: `Session ${n}`, end: true }]);
  };
  await session(1, () => inject([{ id: "V", at: 1, purseId: "b", shopId: null, copper: 0, summary: "A note", transactionType: "adjustment" }]));
  await session(2, () => send("buy", [{ id: "buy-x", kind: "buy", stockId: "rope", purseId: "a", quantity: 1 }]));
  const archived = (await readRoom(dm.code)).table.journal.reports.flatMap((r) => JSON.parse(r.snapshot).ledger);
  const x = archived.find((l) => l.id === "buy-x");
  // A genuine earlier void of x, stored with the ID the session 1 note also used.
  await session(3, () => inject([{ id: "V", at: 2, purseId: x.purseId, shopId: x.shopId, copper: -x.copper, summary: "Voided " + x.summary + " (void:" + x.id + ")", transactionType: "adjustment", reversalOf: x.id }]));
  const before = (await readRoom(dm.code)).table.purses.find((p) => p.id === "a");
  const result = await send("undo", [{ id: "undo", kind: "ledger-void", target: { kind: "ledger", id: x.id }, before: canonicalJson(x), reason: "Again." }]).then(
    () => "",
    (error) => error.message,
  );
  const after = (await readRoom(dm.code)).table.purses.find((p) => p.id === "a");
  assert.equal(toCopper(after.coins), toCopper(before.coins), `no second reversal (${result || "applied as no change"})`);
});
