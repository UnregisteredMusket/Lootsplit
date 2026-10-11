import test from "node:test";
import assert from "node:assert/strict";
import {
  referenceAccess,
  referencePolicy,
  referencePolicySchema,
  referenceSection,
} from "./reference-access.ts";
import { emptyCloudTable } from "./cloud.ts";
import { applyCommand } from "./commands.ts";
import { readJournal, preserveJournalMetadata } from "./journal.ts";

test("old campaigns permit read-only indices outside encounters and pause by default during combat", () => {
  for (const section of ["items", "spells", "creatures"] as const) {
    assert.equal(referenceAccess("player", undefined, false, section).allowed, true);
    assert.equal(referenceAccess("player", undefined, true, section).allowed, false);
  }
  assert.equal(referenceSection("magicitems"), "items");
  assert.equal(referenceSection("conditions"), "items");
});
test("DM limits and the encounter override are independent; DM retains all indices", () => {
  const policy = {
    ...referencePolicy(),
    sections: ["spells" as const],
    allowDuringEncounters: true,
  };
  assert.equal(referenceAccess("player", policy, true, "spells").allowed, true);
  assert.equal(referenceAccess("player", policy, true, "creatures").allowed, false);
  assert.equal(referenceAccess("player", { ...policy, enabled: false }, false).allowed, false);
  assert.equal(referenceAccess("player", { ...policy, sections: [] }, false).allowed, false);
  assert.equal(
    referenceAccess("dm", { ...policy, enabled: false }, true, "creatures").allowed,
    true,
  );
  assert.equal(
    referencePolicySchema.safeParse({ ...policy, sections: ["spells", "spells"] }).success,
    false,
  );
});
test("only the DM can change lookup controls; stale updates fail without mutating saves", () => {
  const table = emptyCloudTable(),
    dm = { id: "dm", role: "dm" as const, purseIds: [], token: "t", name: "DM" };
  const command = {
    id: "policy",
    kind: "reference-policy" as const,
    before: referencePolicy(),
    policy: { ...referencePolicy(), enabled: false },
  };
  assert.throws(() => applyCommand(table, { ...dm, role: "player" }, command), /Only the DM/);
  assert.equal(table.journal?.referenceAccess, undefined);
  const next = applyCommand(table, dm, command);
  assert.equal(next.journal?.referenceAccess?.enabled, false);
  assert.throws(() => applyCommand(next, dm, { ...command, id: "stale" }), /changed/);
  assert.equal(
    readJournal(JSON.parse(JSON.stringify(next.journal))).referenceAccess?.enabled,
    false,
  );
});
test("legacy journal writes cannot erase or override authoritative lookup policy", () => {
  const current = readJournal({ referenceAccess: { ...referencePolicy(), enabled: false } });
  assert.deepEqual(preserveJournalMetadata({}, current).referenceAccess, current.referenceAccess);
  assert.deepEqual(
    preserveJournalMetadata({ referenceAccess: referencePolicy() }, current).referenceAccess,
    current.referenceAccess,
  );
  assert.equal(
    preserveJournalMetadata(
      { referenceAccess: { ...referencePolicy(), allowDuringEncounters: true } },
      readJournal({}),
    ).referenceAccess,
    undefined,
  );
});
