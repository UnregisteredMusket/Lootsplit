import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  readResourcePack,
  previewResourcePack,
  resourceCombatant,
  resourceNameRows,
  resourceFingerprint,
  type ResourceCreature,
} from "./resource-packs.ts";
import { resourcePackFixture as pack } from "./test-fixtures/resource-pack.ts";
import { emptyCloudTable, type CloudSeat } from "./cloud.ts";
import { applyCommand } from "./commands.ts";
import { readJournal, preserveJournalMetadata } from "./journal.ts";
import { projectRecord } from "./session-records.ts";
import { previewMarketNames } from "./market-name-import.ts";
import { readMarketLocations } from "./shop-locations.ts";
import { applyCloudTable, snapshot, readQuireFile, addCatalogRows } from "./economy.ts";
const dm: CloudSeat = { id: "dm", token: "test", name: "DM", role: "dm", purseIds: [] };
test("resource packs validate all reference kinds, unknown fields, identity, hierarchy and size", () => {
  assert.deepEqual(readResourcePack(JSON.stringify(pack)), pack);
  const clone = structuredClone(pack);
  clone.entries.push(clone.entries[0]);
  assert.throws(() => readResourcePack(JSON.stringify(clone)), /unique/);
  assert.throws(() => readResourcePack(JSON.stringify({ ...pack, inventory: [] })), /Unrecognized/);
  const invalid = structuredClone(pack);
  invalid.entries[3] = { ...invalid.entries[3], parentId: "absent" } as (typeof invalid.entries)[3];
  assert.throws(() => readResourcePack(JSON.stringify(invalid)), /parent/);
  assert.throws(() => readResourcePack(" ".repeat(1_500_001)), /1.5 MB/);
});
test("resource import is DM-only, additive, stale-safe and idempotent without economic side effects", () => {
  const table = emptyCloudTable();
  const cmd = {
    kind: "resource-pack-import" as const,
    id: "pack-import",
    before: resourceFingerprint(),
    pack,
  };
  assert.throws(() => applyCommand(table, { ...dm, role: "player" }, cmd), /Only the DM/);
  const next = applyCommand(table, dm, cmd);
  for (const field of [
    "purses",
    "holdings",
    "shops",
    "stock",
    "ledger",
    "listings",
    "sheets",
  ] as const)
    assert.deepEqual(next[field], table[field]);
  assert.equal(next.journal!.resourceLibrary!.packs.length, 1);
  assert.throws(() => applyCommand(next, dm, cmd), /fresh preview/);
  const again = applyCommand(next, dm, {
    ...cmd,
    id: "pack-again",
    before: resourceFingerprint(next.journal!.resourceLibrary),
  });
  assert.deepEqual(again, next);
  assert.throws(
    () =>
      previewResourcePack(next.journal!.resourceLibrary, {
        ...pack,
        title: "Changed without revision",
      }),
    /different contents/,
  );
  const newer = applyCommand(next, dm, {
    ...cmd,
    id: "new-revision",
    pack: { ...pack, revision: "2" },
    before: resourceFingerprint(next.journal!.resourceLibrary),
  });
  assert.equal(newer.journal!.resourceLibrary!.packs.length, 2);
});
test("private resources survive DM records and nested archives but never enter player projections or old-client patches", () => {
  const table = emptyCloudTable();
  table.journal = readJournal({ resourceLibrary: { packs: [pack] } });
  const snapshot = JSON.stringify(table);
  table.journal.reports = [{ id: "archive", name: "Archive", at: 1, snapshot }];
  assert.deepEqual(
    projectRecord(table, dm).journal!.resourceLibrary,
    table.journal.resourceLibrary,
  );
  const player = projectRecord(table, { role: "player", purseIds: [] });
  assert.equal(player.journal!.resourceLibrary, undefined);
  assert.equal(JSON.parse(player.journal!.reports![0].snapshot).journal.resourceLibrary, undefined);
  assert.deepEqual(
    preserveJournalMetadata({}, table.journal).resourceLibrary,
    table.journal.resourceLibrary,
  );
  assert.equal(preserveJournalMetadata(table.journal, readJournal({})).resourceLibrary, undefined);
});
test("encounter copies retain exact source notes and stats; incomplete stats are never guessed", () => {
  const creature = pack.entries[0] as ResourceCreature;
  const a = resourceCombatant(pack, creature),
    b = resourceCombatant(pack, creature);
  assert.notEqual(a.id, b.id);
  assert.equal(a.notes, creature.text);
  assert.equal(a.maxHp, 22);
  assert.equal(a.ac, 14);
  assert.match(a.source, /PDF p. 12.*print 8/);
  const incomplete = { ...creature, stats: { ...creature.stats, hp: null, cr: null } };
  assert.throws(() => resourceCombatant(pack, incomplete), /Missing hp/);
  assert.equal(
    previewResourcePack(undefined, { ...pack, entries: [incomplete] }).warnings.length,
    2,
  );
});
test("related source notes resolve within a pack and are copied once into encounter notes", () => {
  const related = {
    ...(pack.entries[0] as ResourceCreature),
    id: "source-notes",
    kind: "reference" as const,
    text: "Shared source salvage rules.",
  };
  const { stats: _stats, ...reference } = related;
  const creature = { ...(pack.entries[0] as ResourceCreature), relatedIds: [reference.id] };
  const linked = readResourcePack(JSON.stringify({ ...pack, entries: [creature, reference] }));
  const combatant = resourceCombatant(linked, linked.entries[0] as ResourceCreature);
  assert.match(combatant.notes, /Shared source salvage rules/);
  assert.throws(
    () => readResourcePack(JSON.stringify({ ...pack, entries: [creature] })),
    /related references/,
  );
});
test("location materialization reuses canonical parents and creates only closed empty shops", () => {
  const rows = resourceNameRows(pack);
  const plan = previewMarketNames(readMarketLocations(), [], rows, "resources");
  assert.equal(plan.locations.length, 2);
  assert.equal(plan.shops.length, 1);
  assert.equal(plan.shops[0].closed, true);
  const again = previewMarketNames(
    readMarketLocations({ locations: plan.locations, currentLocationId: null }),
    plan.shops,
    rows,
    "again",
  );
  assert.equal(again.locations.length, 0);
  assert.equal(again.shops.length, 0);
});
test("complete device exports retain packs and interrupted catalogue guards prevent writes", async () => {
  const table = emptyCloudTable();
  table.journal = readJournal({ resourceLibrary: { packs: [pack] } });
  await applyCloudTable(table);
  const exported = await snapshot();
  assert.deepEqual(readQuireFile(exported).journal!.resourceLibrary, table.journal.resourceLibrary);
  let calls = 0;
  await assert.rejects(
    addCatalogRows(
      [
        {
          id: "guarded",
          name: "Guarded test",
          category: "general",
          rarity: "common",
          baseCopper: 0,
          notes: "",
          origin: "hand",
          service: false,
        },
      ],
      () => {
        if (++calls === 2) throw Error("Campaign changed");
      },
    ),
    /Campaign changed/,
  );
});
