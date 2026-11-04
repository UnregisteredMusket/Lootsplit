// History on demand, part players (split from one file so the parts run in parallel;
// shared setup in history-on-demand-setup.mjs). Disposable local D1 stand-in only; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { NEW, OLD, allHistory, full, history, liveRoom, message, pagesOf, readRoom, readRoomHistory, roomState, send, updateRoom } from "./history-on-demand-setup.mjs";
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
