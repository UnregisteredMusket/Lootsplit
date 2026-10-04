import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { blankSheet } from "../characters/model.mjs";
import { applyCloudTable, economySnapshot, updateCharacterSheet } from "./economy.ts";
import { emptyCloudTable } from "./cloud.ts";
import { sheetFromFields, type CharacterSheet } from "./sheet.ts";
import { applyCommand } from "./commands.ts";
const dm = { id: "dm", token: "dm", name: "DM", role: "dm" as const, purseIds: [] };
function fixture() {
  const sheet = {
    ...blankSheet(),
    name: "Veteran",
    level: 9,
    proficiency: 4,
    tempHp: 7,
    inspiration: true,
    conditions: "Blessed",
    initiative: 2,
    notes: "Keep my notes",
    skills: { ...blankSheet().skills, Athletics: { rank: 1, extra: 1 } },
  };
  const legacy: CharacterSheet = {
    ...sheetFromFields({ CharacterName: "Veteran", STR: "10", HPCurrent: "10" })!,
    purseId: "hero",
    importedAt: 1,
  };
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hero", name: "Veteran", kind: "character" as const, coins: sheet.coins, sheet },
    ],
    sheets: [legacy],
  };
}
test("filling a legacy blank preserves every unrelated playable field in local and shared saves", async () => {
  const table = fixture(),
    before = table.sheets[0],
    incoming = { ...before, race: "Human" };
  await applyCloudTable(table);
  await updateCharacterSheet(incoming, before);
  assert.deepEqual((await economySnapshot()).purses[0].sheet, {
    ...table.purses[0].sheet,
    species: "Human",
  });
  const next = applyCommand(table, dm, {
    id: crypto.randomUUID(),
    kind: "sheet",
    sheet: incoming,
    before,
  });
  assert.deepEqual(next.purses[0].sheet, { ...table.purses[0].sheet, species: "Human" });
});
test("legacy edits reject stale changed fields and preserve unrelated concurrent changes", async () => {
  const table = fixture(),
    before = table.sheets[0];
  table.purses[0].sheet.notes = "Newer notes";
  table.purses[0].sheet.species = "Elf";
  await applyCloudTable(table);
  await assert.rejects(
    updateCharacterSheet({ ...before, race: "Human" }, before),
    /changed elsewhere/,
  );
  assert.deepEqual((await economySnapshot()).purses[0].sheet, table.purses[0].sheet);
  const next = applyCommand(table, dm, {
    id: crypto.randomUUID(),
    kind: "sheet",
    sheet: { ...before, classLevel: "Fighter" },
    before,
  });
  assert.equal(next.purses[0].sheet?.notes, "Newer notes");
  assert.equal(next.purses[0].sheet?.species, "Elf");
});
test("player-owned sheet protection applies to legacy edits and generic patches while funds remain manageable", async () => {
  const f = fixture(),
    p = { ...f.purses[0], sheetReadOnlyForDm: true, profileId: "private" };
  const table = { ...f, purses: [p] },
    before = f.sheets[0];
  await applyCloudTable(table);
  await assert.rejects(updateCharacterSheet({ ...before, race: "Human" }, before), /profile owner/);
  assert.throws(
    () =>
      applyCommand(table, dm, {
        id: crypto.randomUUID(),
        kind: "sheet",
        sheet: { ...before, race: "Human" },
        before,
      }),
    /profile owner/,
  );
  for (const after of [
    { ...p, sheet: { ...p.sheet, hp: 1 } },
    { ...p, sheetReadOnlyForDm: false },
  ])
    assert.throws(
      () =>
        applyCommand(table, dm, {
          id: crypto.randomUUID(),
          kind: "patch",
          changes: [{ store: "purses", id: p.id, before: p, after }],
        }),
      /profile owner/,
    );
  const next = applyCommand(table, dm, {
    id: crypto.randomUUID(),
    kind: "patch",
    changes: [
      { store: "purses", id: p.id, before: p, after: { ...p, coins: { ...p.coins, gp: 20 } } },
    ],
  });
  assert.equal(next.purses[0].coins.gp, 20);
  Object.assign(p, {editingAllowed: true});
  const owner = { ...dm, role: "player" as const, purseIds: [p.id] };
  assert.equal(
    applyCommand(table, owner, {
      id: crypto.randomUUID(),
      kind: "sheet",
      sheet: { ...before, race: "Human" },
      before,
    }).purses[0].sheet?.species,
    "Human",
  );
});

test("legacy conversion retains unambiguous levels and exact bonuses without guessing proficiency training", async () => {
  const { legacyCharacter, legacyLevel } = await import("../characters/campaign-sheet.mjs");
  const { rollSpec } = await import("../characters/model.mjs");
  const old = fixture().sheets[0];
  old.classLevel = "Fighter 5, Wizard 4";
  old.proficiency = "+4";
  old.hitDice = "9d10";
  old.initiative = "+5";
  old.hitPoints = "0 / 115";
  old.abilities.str.score = "18";
  old.abilities.dex.score = "16";
  old.skills = [{ name: "Athletics", bonus: "+8" }];
  old.saves.str = "+8";
  const s = legacyCharacter(old, old.name);
  assert.equal(s.level, 9);
  assert.equal(s.classes, old.classLevel);
  assert.equal(s.proficiency, 4);
  assert.equal(s.hp, 0);
  assert.equal(s.maxHp, 115);
  assert.equal(s.hitDice, "9d10");
  assert.equal(rollSpec(s, "skill", "Athletics").formula, "1d20+8");
  assert.equal(rollSpec(s, "save", "str").formula, "1d20+8");
  assert.equal(rollSpec(s, "initiative", "").formula, "1d20+5");
  assert.equal(legacyLevel("Fighter 9"), 9);
  assert.equal(legacyLevel("Level 9"), 9);
  assert.equal(legacyLevel("Fighter 2014"), null);
  assert.equal(legacyLevel("Fighter 9, Wizard ?"), null);
  const table = fixture();
  table.sheets = [];
  const imported = applyCommand(table, dm, { id: crypto.randomUUID(), kind: "sheet", sheet: old });
  assert.equal(imported.purses[0].sheet?.level, 9);
  assert.equal(imported.purses[0].sheet?.proficiency, 4);
  assert.equal(rollSpec(imported.purses[0].sheet!, "skill", "Athletics").formula, "1d20+8");
});
