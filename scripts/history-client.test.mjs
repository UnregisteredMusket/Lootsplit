// History on demand, browser side (tabletop protocol 12): the tab's history store loads older
// pages and archived sessions through the real server function and merges them into the view,
// exactly reproducing the complete view; gaps after new pages are sealed are filled; another seat
// starts over. Disposable local D1 stand-in with every migration applied; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";

const db = localAccountDb();
globalThis.__env__ = { DB: db };
const { openRoom, joinRoom, roomState, submitCommands, choosePace, readRoomHistory } = await import("../src/lib/quire/cloud.server.ts");
const { setRoomSectionLimitsForTests } = await import("../cloudflare/room-storage.mjs");
const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
const history = await import("../src/lib/quire/room-history.ts");
const { roomViewResponse } = await import("../src/lib/quire/view-sections.server.ts");
const { createRoomSync } = await import("../src/lib/quire/room-sync.ts");

setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 32 });
test.after(() => setRoomSectionLimitsForTests({}));

let calls = [];
history.connectRoomHistory(async ({ data }) => {
  calls.push(data);
  return readRoomHistory(data);
});

const message = (id, purseId, text, to = "party") => ({ id, kind: "message", to, purseId, text });
async function room() {
  const dm = await openRoom({ name: "Client DM", table: tradeFixture() });
  const a = await joinRoom({ code: dm.code, purseId: "a", name: "Arden" });
  await choosePace({ ...dm, live: true });
  return { dm, a: { code: dm.code, token: a.token } };
}
async function chatter(seats, from, to, prefix) {
  for (let i = from; i < to; i += 50)
    await submitCommands({
      ...seats.a,
      batchId: `${prefix}-${i}`,
      commands: Array.from({ length: Math.min(50, to - i) }, (_, n) => message(`${prefix}-${i + n}`, "a", `Line ${i + n}`)),
    });
}
const view = (seat) => roomState({ ...seat, tabletopProtocol: 12 });
const complete = async (seat) => (await roomState({ ...seat, tabletopProtocol: 11 })).table;

test("loading earlier entries reproduces the complete view, page by page, without re-sending held pages", async () => {
  const seats = await room();
  await chatter(seats, 0, 900, "c");
  await submitCommands({ ...seats.dm, batchId: "s1", commands: [{ id: "s1", kind: "session", name: "One", end: false }] });
  await submitCommands({ ...seats.dm, batchId: "e1", commands: [{ id: "e1", kind: "session", name: "One", end: true }] });
  await chatter(seats, 900, 1300, "d");
  for (const seat of [seats.dm, seats.a]) {
    history.clearRoomHistory();
    const current = await view(seat);
    history.noteRoomView(seat, current);
    let state = history.getRoomHistory();
    assert.equal(state.notes.more, true);
    assert.deepEqual(history.mergeHistory(current.table).notes, current.table.notes, "nothing loaded yet");
    calls = [];
    while (history.getRoomHistory().notes.more) await history.loadEarlier("notes");
    assert.ok(calls.length >= 1);
    const full = await complete(seat);
    assert.deepEqual(history.mergeHistory(current.table).notes, full.notes, "every older message, in order");
    // The archived session: listed without contents until opened.
    const listed = current.table.journal.reports[0];
    assert.equal(listed.deferred, true);
    await history.openReport(listed.id);
    assert.deepEqual(history.mergeHistory(current.table).journal.reports[0], full.journal.reports[0]);
    assert.equal(history.historyIncomplete(), false);
    state = history.getRoomHistory();
    assert.ok(state.notes.loaded > 0 && !state.notes.loading && !state.notes.error);
  }
});

test("new pages sealed above loaded history are filled in at once; another seat starts over", async () => {
  const seats = await room();
  await chatter(seats, 0, 300, "g");
  history.clearRoomHistory();
  let current = await view(seats.dm);
  history.noteRoomView(seats.dm, current);
  while (history.getRoomHistory().notes.more) await history.loadEarlier("notes");
  assert.equal(history.mergeHistory(current.table).notes.length, (await complete(seats.dm)).notes.length);
  // More chat seals more pages: the next view's cursor names a page this tab does not hold.
  await chatter(seats, 300, 500, "h");
  current = await view(seats.dm);
  calls = [];
  history.noteRoomView(seats.dm, current);
  // The gap is read automatically (held pages are named, so only the new ones are sent).
  for (let i = 0; i < 50 && history.getRoomHistory().notes.loading; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].held.length > 0);
  assert.deepEqual(history.mergeHistory(current.table).notes, (await complete(seats.dm)).notes);
  // Another seat: nothing of the DM's history is kept or merged.
  const player = await view(seats.a);
  history.noteRoomView(seats.a, player);
  assert.deepEqual(history.mergeHistory(player.table).notes, player.table.notes);
  assert.equal(history.roomHistoryForTests().pages.notes.size, 0);
});

test("loadAllHistory reads every page and archived session; a failure is reported and changes nothing", async () => {
  const seats = await room();
  await chatter(seats, 0, 400, "x");
  await submitCommands({ ...seats.dm, batchId: "s1", commands: [{ id: "s1", kind: "session", name: "One", end: false }] });
  await submitCommands({ ...seats.dm, batchId: "e1", commands: [{ id: "e1", kind: "session", name: "One", end: true }] });
  await submitCommands({ ...seats.dm, batchId: "s2", commands: [{ id: "s2", kind: "session", name: "Two", end: false }] });
  await submitCommands({ ...seats.dm, batchId: "e2", commands: [{ id: "e2", kind: "session", name: "Two", end: true }] });
  await chatter(seats, 400, 700, "y");
  history.clearRoomHistory();
  const current = await view(seats.dm);
  history.noteRoomView(seats.dm, current);
  assert.equal(history.historyIncomplete(), true);
  await history.loadAllHistory();
  assert.equal(history.historyIncomplete(), false);
  const full = await complete(seats.dm);
  const merged = history.mergeHistory(current.table);
  assert.deepEqual(merged.notes, full.notes);
  assert.deepEqual(merged.ledger, full.ledger);
  assert.deepEqual(merged.journal.reports, full.journal.reports);
  // A read the server refuses (the room moved on) is reported; nothing merged changes.
  history.clearRoomHistory();
  history.noteRoomView(seats.dm, { ...current, history: { notes: "0".repeat(32) } });
  await assert.rejects(history.loadEarlier("notes"), /changed while earlier history was loading/);
  assert.match(history.getRoomHistory().notes.error, /changed while earlier history/);
  assert.deepEqual(history.mergeHistory(current.table).notes, current.table.notes);
});

test("a protocol 12 write whose sections cannot be fetched reads its own working view unsectioned", async () => {
  const seats = await room();
  await chatter(seats, 0, 900, "z");
  // A working set larger than one response's inline sections (512 KB): journal notes.
  const { readRoom, updateRoom } = await import("../src/lib/quire/room-store.server.ts");
  const stored = await readRoom(seats.dm.code);
  stored.table.journal.entries = Array.from({ length: 1500 }, (_, i) => ({ id: `e-${i}`, at: i, authorId: "dm", purseId: "", visibility: "party", title: `Entry ${i}`, text: "Lore ".repeat(100), reportIds: [] }));
  stored.revision++;
  await updateRoom(stored, stored.revision - 1);
  const fullReads = [];
  const sync = createRoomSync({
    // Section downloads fail (offline, paused): a committed write's view is read in full instead.
    readSections: async () => {
      throw Error("offline");
    },
    fullRead: async ({ data }) => {
      fullReads.push(data);
      return roomViewResponse(await roomState(data), data);
    },
  });
  const write = sync.roomWrite(async ({ data }) => roomViewResponse(await roomState(data), data));
  const result = await write({ data: { ...seats.dm, tabletopProtocol: 12 } });
  assert.deepEqual(fullReads.map((d) => [d.tabletopProtocol, d.unsectioned]), [[12, true]]);
  assert.ok(result.history?.notes, "the light working view, with its cursors");
  assert.equal(result.viewSections, undefined);
  assert.deepEqual(result.table.notes, (await view(seats.dm)).table.notes);
});

test("when what the seat may read changes, loaded history is dropped and loads again under the new rules", async () => {
  const seats = await room();
  for (let i = 0; i < 600; i += 50)
    await submitCommands({
      ...seats.dm,
      batchId: `give-${i}`,
      commands: Array.from({ length: 50 }, (_, n) => ({ id: `give-${i + n}`, kind: "give", fromId: "a", toId: "b", copper: 1, holdingId: null, quantity: 0 })),
    });
  const { readRoom, updateRoom } = await import("../src/lib/quire/room-store.server.ts");
  const setBriarAway = async (away) => {
    const stored = await readRoom(seats.dm.code);
    stored.table.purses.find((p) => p.id === "b").nonParty = away;
    stored.revision++;
    await updateRoom(stored, stored.revision - 1);
  };
  const loadAll = async () => {
    const current = await view(seats.a);
    history.noteRoomView(seats.a, current);
    return current;
  };
  history.clearRoomHistory();
  let current = await loadAll();
  while (history.getRoomHistory().ledger.more) await history.loadEarlier("ledger");
  let merged = history.mergeHistory(current.table).ledger;
  assert.deepEqual(merged, (await complete(seats.a)).ledger);
  assert.ok(merged.some((l) => l.purseId === "b"), "Arden reads Briar's lines while Briar travels with the party");
  // Access lost: the next view's projection differs; nothing loaded before is merged any more.
  await setBriarAway(true);
  current = await loadAll();
  assert.equal(history.roomHistoryForTests().pages.ledger.size, 0, "loaded pages dropped");
  assert.deepEqual(history.mergeHistory(current.table).ledger, current.table.ledger);
  assert.equal(history.historyIncomplete(), true);
  while (history.getRoomHistory().ledger.more) await history.loadEarlier("ledger");
  merged = history.mergeHistory(current.table).ledger;
  assert.deepEqual(merged, (await complete(seats.a)).ledger);
  assert.ok(!merged.some((l) => l.purseId === "b"), "none of Briar's lines remain");
  // Access gained: Briar is back with the party.
  await setBriarAway(false);
  current = await loadAll();
  assert.equal(history.roomHistoryForTests().pages.ledger.size, 0);
  while (history.getRoomHistory().ledger.more) await history.loadEarlier("ledger");
  merged = history.mergeHistory(current.table).ledger;
  assert.deepEqual(merged, (await complete(seats.a)).ledger);
  assert.ok(merged.some((l) => l.purseId === "b"));
  assert.equal(history.getRoomHistory().ledger.more, false);
});
