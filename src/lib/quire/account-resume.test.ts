import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileAccountResume, type ResumeCache } from "./account-resume.ts";
import type { Command } from "./commands.ts";

const command = (id: string): Extract<Command, { kind: "patch" }> => ({
  id,
  kind: "patch",
  changes: [],
});
const cache = (ids = ["local"]): ResumeCache => ({
  code: "TEST",
  token: "token",
  seatId: "dm",
  role: "dm",
  revision: 2,
  pending: ids.map(command),
  batchId: "original-batch",
});
const remote = (acknowledged: string[] = [], draft: Command[] = []) => ({
  code: "TEST",
  seatId: "dm",
  revision: 3,
  acknowledged,
  draft: JSON.stringify(draft),
});
const identity = { token: "token", role: "dm" as const };

test("fresh profile opens the server campaign without a device queue", () => {
  assert.deepEqual(reconcileAccountResume(null, remote(), identity, "new"), {
    pending: [],
    batchId: "new",
    revision: 0,
    needsRecovery: false,
  });
});
test("already-acknowledged Live actions cannot block account resume", () => {
  const cached = cache(["accepted"]);
  const result = reconcileAccountResume(
    cached,
    remote(["accepted"]),
    identity,
    "new",
  );
  assert.equal(result.pending.length, 0);
  assert.equal(result.needsRecovery, false);
  assert.equal(
    cached.pending.length,
    1,
    "Reconciliation does not mutate the original recovery record",
  );
});
test("lost-response actions retain command and batch identity", () => {
  const result = reconcileAccountResume(cache(), remote(), identity, "new");
  assert.deepEqual(
    result.pending.map((c) => c.id),
    ["local"],
  );
  assert.equal(result.batchId, "original-batch");
  assert.equal(result.revision, -1);
});
test("genuine turn restores server draft and unsubmitted local additions", () => {
  const result = reconcileAccountResume(
    cache(["staged", "unsent"]),
    remote([], [command("staged")]),
    identity,
    "new",
  );
  assert.deepEqual(
    result.pending.map((c) => c.id),
    ["staged", "unsent"],
  );
  assert.equal(result.batchId, "original-batch");
});
test("a second device restores a genuine server draft", () => {
  const result = reconcileAccountResume(
    null,
    remote([], [command("staged")]),
    identity,
    "new",
  );
  assert.deepEqual(
    result.pending.map((c) => c.id),
    ["staged"],
  );
});
for (const change of [
  { seatId: "old" },
  { token: "old" },
  { code: "OTHER" },
  { role: "player" as const },
]) {
  test(`changed identity ${JSON.stringify(change)} never replays cached work`, () => {
    const result = reconcileAccountResume(
      { ...cache(), ...change },
      remote(),
      identity,
      "new",
    );
    assert.equal(result.pending.length, 0);
    assert.equal(result.needsRecovery, true);
  });
}
test("a device revision newer than the server requires a separate recovery copy", () => {
  assert.equal(
    reconcileAccountResume(
      { ...cache(), revision: 9 },
      remote(),
      identity,
      "new",
    ).needsRecovery,
    true,
  );
});
test("conflicting versions of the same draft command require separate recovery", () => {
  const draft: Command = {
    ...command("local"),
    changes: [{ store: "purses", id: "changed", before: null, after: null }],
  };
  assert.equal(
    reconcileAccountResume(cache(), remote([], [draft]), identity, "new")
      .needsRecovery,
    true,
  );
});
