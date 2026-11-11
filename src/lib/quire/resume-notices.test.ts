import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

// Audit 2026-11-10 C4: reloading a shared campaign published the saved session with no seats, so
// the first room response looked like seats joining and the mode changing, and opted-in users got
// "Player joined" / "Mode changed" notifications for nothing. Runs the actual `publish`.
const source = readFileSync(new URL("./cloud-client.ts", import.meta.url), "utf8");
const body = source.slice(
  source.indexOf("let seenRecovery: RecoveryVisibility | undefined;"),
  source.indexOf("/**\n * The room as the previewed player seat"),
);
const initial = source.slice(
  source.indexOf("const initialView = {"),
  source.indexOf("let view = initialView;"),
);

function harness() {
  const notices: string[] = [];
  const make = new Function(
    "notify",
    stripTypeScriptTypes(`
      ${initial}
      let view = initialView;
      const listeners = new Set();
      const recoveryVisibility = () => ({ recoveries: [], unverifiedRecoveries: 0, legacyRecoveryChecked: false });
      const setCloudWatch = () => {};
      ${body}
    `) + "; return { publish };",
  );
  const { publish } = make((title: string) => notices.push(title)) as {
    publish: (next: Record<string, unknown>, dataChanged?: boolean) => void;
  };
  return { publish, notices };
}

const seat = (id: string, role: "dm" | "player") => ({
  id,
  role,
  name: id,
  pending: 0,
  allowParty: false,
});
const room = {
  joined: true,
  code: "ROOM",
  sessionId: "play-1",
  role: "dm",
  seatId: "dm",
  live: true,
  mine: true,
  seats: [seat("dm", "dm"), seat("mira", "player"), seat("bram", "player")],
  status: "synced",
  lastSync: 1,
};

test("a reload's first room response sends no join, mode or turn notices", () => {
  const h = harness();
  // resumeTable: the saved session, before any room response.
  h.publish({ joined: true, code: "ROOM", sessionId: "play-1", role: "dm", seatId: "dm", pending: 0, status: "saving" });
  // An "unchanged" poll sets lastSync without seats.
  h.publish({ lastSync: 1, status: "synced" }, false);
  h.publish(room);
  assert.deepEqual(h.notices, []);
});

test("real changes between room responses still notify", () => {
  const h = harness();
  h.publish({ joined: true, code: "ROOM", sessionId: "play-1", role: "dm", seatId: "dm", pending: 0, status: "saving" });
  h.publish({ ...room, live: false, seats: room.seats.slice(0, 2) });
  h.publish(room);
  assert.deepEqual(h.notices.sort(), ["Mode changed", "Player joined"]);
});

test("switching to another room is not a join", () => {
  const h = harness();
  h.publish(room);
  h.publish({ ...room, code: "OTHER", seats: [...room.seats, seat("tamsin", "player")] });
  assert.deepEqual(h.notices, []);
});
