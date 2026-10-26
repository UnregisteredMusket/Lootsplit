import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, commandSchema, compactPatch, tablePatch, type Command } from "./commands.ts";
import { commandIdentity } from "./command-identity.ts";
import {
  diffJournal,
  journalChangeId,
  journalChangePath,
  writeJournalPath,
} from "./journal-patch.ts";
import { stableFixture, svcDm } from "./test-fixtures/services.ts";
import type { CloudTable } from "./cloud.ts";

// Four maps of inline artwork near the 500,000-character limit, as uploaded maps are stored.
const ART = "data:image/png;base64," + "A".repeat(480_000);
let seq = 0;
const withArt = () => {
  const t = stableFixture();
  const map = t.journal!.world!.maps[0];
  map.image = ART;
  for (const n of [2, 3, 4])
    t.journal!.world!.maps.push({
      ...structuredClone(map),
      id: `map-${n}`,
      name: `Map ${n}`,
    } as never);
  return t;
};
const size = (v: unknown) => JSON.stringify(v).length;
const legacy = (before: CloudTable, after: CloudTable): Command =>
  commandSchema.parse({
    id: `legacy-${++seq}`,
    kind: "patch",
    changes: [{ store: "journal", id: "journal", before: before.journal, after: after.journal }],
  });

test("a DM edit beside a large map sends only the part that changed", () => {
  const before = withArt(),
    after = structuredClone(before);
  after.journal!.world!.maps[0].name = "Vale of Harrow (revised)";
  after.journal!.market!.locations[0].description = "Busy";
  const patch = tablePatch(before, after) as Extract<Command, { kind: "patch" }>;
  assert.ok(size(patch) < 20_000, `patch is ${size(patch)} characters`);
  assert.ok(patch.changes.every((c) => c.store === "journal" && c.id.startsWith("journal:")));
  assert.equal(JSON.stringify(patch).includes("AAAA"), false, "the unchanged artwork stays behind");
  const applied = applyCommand(before, svcDm, { ...patch, id: `split-${++seq}` });
  assert.equal(applied.journal!.world!.maps[0].name, "Vale of Harrow (revised)");
  assert.equal(applied.journal!.world!.maps[0].image, ART);
  assert.equal(applied.journal!.market!.locations[0].description, "Busy");
});

test("split and whole-journal patches give the same table and the same action identity", () => {
  const before = withArt(),
    after = structuredClone(before);
  after.journal!.world!.maps[1].name = "Renamed second map";
  after.journal!.world!.npcs[0].description = "Grumpy";
  const old = legacy(before, after);
  assert.ok(size(old) > 2_000_000, "the old form is over the batch limit");
  const split = compactPatch(old);
  assert.notEqual(split, old);
  assert.ok(size(split) < 20_000);
  assert.equal(split.id, old.id);
  assert.deepEqual(applyCommand(before, svcDm, split), applyCommand(before, svcDm, old));
  assert.equal(compactPatch(split), split, "compacting twice changes nothing");
  assert.equal(commandIdentity(compactPatch(old)), commandIdentity(split));
  const made = tablePatch(before, after) as Extract<Command, { kind: "patch" }>;
  assert.deepEqual(made.changes, (split as Extract<Command, { kind: "patch" }>).changes);
});

test("a stale part is a conflict, and unrelated concurrent journal edits no longer collide", () => {
  const base = withArt();
  const mine = structuredClone(base);
  mine.journal!.world!.maps[0].name = "Mine";
  const patch = { ...tablePatch(base, mine), id: `mine-${++seq}` } as Command;
  // Someone else renamed the map first: my part is stale.
  const renamed = structuredClone(base);
  renamed.journal!.world!.maps[0].name = "Theirs";
  assert.throws(() => applyCommand(renamed, svcDm, patch), /changed elsewhere/);
  // Someone else changed a different part: my part still applies.
  const other = structuredClone(base);
  other.journal!.world!.npcs[0].description = "Elsewhere";
  const applied = applyCommand(other, svcDm, patch);
  assert.equal(applied.journal!.world!.maps[0].name, "Mine");
  assert.equal(applied.journal!.world!.npcs[0].description, "Elsewhere");
});

test("items are added, changed and removed by id; reorders fall back to the whole list", () => {
  const big = (id: string) => ({ id, text: id.repeat(3000) });
  const before = { list: [big("a"), big("b"), big("c")] };
  const after = { list: [big("a"), { ...big("c"), text: "changed" }, big("d")] };
  const parts = diffJournal(before, after);
  assert.deepEqual(
    parts.map((p) => p.path),
    [
      ["list", { id: "b" }],
      ["list", { id: "c" }],
      ["list", { id: "d" }],
    ],
  );
  let out: unknown = before;
  for (const p of parts) out = writeJournalPath(out, p.path, p.after);
  assert.deepEqual(out, after);
  const reordered = { list: [big("b"), big("a"), big("c")] };
  assert.deepEqual(
    diffJournal(before, reordered).map((p) => p.path),
    [["list"]],
  );
});

test("change ids are validated", () => {
  assert.deepEqual(journalChangePath(journalChangeId(["world", "maps", { id: "x" }])), [
    "world",
    "maps",
    { id: "x" },
  ]);
  for (const bad of [
    "journal:",
    "journal:{}",
    "journal:[]",
    'journal:["__proto__"]',
    "journal:[1]",
    "other",
  ])
    assert.equal(journalChangePath(bad), null, bad);
  const t = withArt();
  assert.throws(
    () =>
      applyCommand(t, svcDm, {
        id: `bad-${++seq}`,
        kind: "patch",
        changes: [{ store: "journal", id: "journal:nope", before: null, after: 1 }],
      }),
    /Invalid journal change/,
  );
});

test("players still cannot send journal patches", () => {
  const t = withArt(),
    after = structuredClone(t);
  after.journal!.world!.maps[0].name = "Player edit";
  const patch = { ...tablePatch(t, after), id: `p-${++seq}` } as Command;
  assert.throws(() =>
    applyCommand(t, { ...svcDm, id: "kael", role: "player", purseIds: ["kael"] }, patch),
  );
});
