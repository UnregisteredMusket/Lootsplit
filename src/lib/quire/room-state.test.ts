import assert from "node:assert/strict";
import test from "node:test";
import { roomLifecycleLabels, roomStatusLabels, roomSaveDetail } from "./room-state.ts";

const active = {
  joined: true,
  live: false,
  mine: true,
  pending: 0,
  status: "synced" as const,
  lastSync: 1,
};

test("paused rooms never imply a player turn or closed access, including account metadata", () => {
  const paused = roomStatusLabels({ ...active, viewOnly: true });
  assert.equal(paused.room, "Room online");
  assert.equal(paused.play, "Between sessions · players view only");
  assert.equal(paused.turn, "");
  assert.equal(paused.save, "Saved to room");
  assert.equal(roomLifecycleLabels({ viewOnly: true, live: false }).play, paused.play);
  assert.match(roomLifecycleLabels({ closed: true, viewOnly: true }).play, /access revoked/);
  assert.equal(
    roomLifecycleLabels({}).play,
    "Play active",
    "legacy metadata retains active default",
  );
});

test("offline and restored credentials do not claim current room/play/save confirmation", () => {
  const offline = roomStatusLabels({ ...active, viewOnly: true, pending: 2 }, { online: false });
  assert.equal(offline.room, "Room status unavailable");
  assert.match(offline.play, /^Last known:/);
  assert.match(offline.save, /Offline.*2 unfinished turn actions/);
  assert.equal(offline.turn, "");
  const restored = roomStatusLabels({ ...active, lastSync: 0 });
  assert.equal(restored.room, "Checking room…");
  assert.equal(restored.play, "Checking play state…");
  assert.notEqual(restored.save, "Saved to room");
});

test("save failures and queued actions remain distinct from active play", () => {
  const failed = roomStatusLabels({ ...active, live: true, status: "attention", pending: 1 });
  assert.equal(failed.play, "Play active");
  assert.equal(failed.save, "Needs attention · 1 unsynced change");
  assert.equal(failed.turn, "");
  assert.equal(roomStatusLabels(active).turn, "Your turn");
});

test("guest memory and owned local campaigns have different storage labels", () => {
  assert.equal(roomStatusLabels({ ...active, joined: false }).save, "Saved on device");
  assert.equal(
    roomStatusLabels({ ...active, joined: false }, { ephemeral: true }).save,
    "In this document only",
  );
});

test("only a fully confirmed server draft is labeled saved turn, never committed", () => {
  const draft = { ...active, pending: 2, staged: 2 };
  assert.match(roomSaveDetail(draft), /Turn saved to room.*not committed/);
  assert.doesNotMatch(roomSaveDetail({ ...draft, staged: 1 }), /Turn saved/);
  assert.doesNotMatch(roomSaveDetail({ ...draft, live: true }), /Turn saved/);
  assert.doesNotMatch(
    roomSaveDetail({ ...draft, status: "attention", error: "Lost response" }),
    /Turn saved/,
  );
  assert.doesNotMatch(roomSaveDetail(draft, { online: false }), /Turn saved/);
  assert.equal(roomSaveDetail({ ...draft, lastSync: 0 }), "");
  assert.equal(roomSaveDetail({ ...draft, joined: false }), "");
  assert.equal(roomSaveDetail(active), "");
});
