// History on demand, part protocols (split from one file so the parts run in parallel;
// shared setup in history-on-demand-setup.mjs). Disposable local D1 stand-in only; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_HISTORY_NOTICE_ID, NEW, OLD, ROOM_BODY_LIMIT, allHistory, db, encodeRoomImages, full, history, liveRoom, message, pagesOf, readRoom, readRoomHistory, readStoredRoom, roomState, roomWriteStatements, send, updateRoom } from "./history-on-demand-setup.mjs";
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
