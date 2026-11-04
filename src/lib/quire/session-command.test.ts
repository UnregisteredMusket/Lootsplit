import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";

const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };

// "End & start next" is one `session` command that ends the active session and starts the next.
// archiveSession replaces t.journal, so the command used to keep writing to the old journal object:
// the new session, the "Started session" event and the ended session's last event were lost.
test("one session command ends the active session and starts the next", () => {
  let t: CloudTable = { ...emptyCloudTable(), journal: readJournal({}) };
  t = applyCommand(t, dm, { id: "s1", kind: "session", name: "The Crypt", end: false });
  assert.equal(t.journal!.sessions.find((s) => !s.endedAt)?.name, "The Crypt");
  t = applyCommand(t, dm, { id: "s2", kind: "session", name: "The Market", end: false });
  const sessions = t.journal!.sessions;
  assert.equal(sessions.find((s) => s.id === "s1")?.endedAt !== undefined, true, "the first session ended");
  const active = sessions.filter((s) => !s.endedAt);
  assert.deepEqual(active.map((s) => s.id), ["s2"], "the next session is the one active session");
  assert.equal(t.journal!.reports?.length, 1, "the ended session was archived once");
  assert.ok(
    t.journal!.events.some((e) => e.summary === "Started session: The Market"),
    "the start is in the new session's events",
  );
});
