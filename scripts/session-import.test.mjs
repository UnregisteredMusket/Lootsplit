import test from "node:test";
import assert from "node:assert/strict";
import { sheetFromFields, sheetFromText } from "../src/lib/quire/sheet.ts";
import { legacyCharacter } from "../src/lib/characters/campaign-sheet.mjs";
import { importedFieldNames } from "../src/lib/characters/import-fields.mjs";
import { parseStatblock } from "../src/lib/encounters/statblock.mjs";

test("printed/form character fields populate each relevant playable tab without losing source", () => {
  const source = sheetFromFields({
    CharacterName: "Fixture hero",
    ClassLevel: "Fighter 4",
    STR: "20",
    DEX: "18",
    CON: "20",
    INT: "8",
    WIS: "9",
    CHA: "12",
    HPCurrent: "47",
    HPMax: "53",
    AC: "19",
    XP: "INITIATIVE",
    Attacks: "Sword · +7 · 1d8+5 slashing",
    Equipment: "Shield\nPotion × 2",
    Spells: "Cantrips: Light\nLevel 1: Shield, Magic Missile",
    Features: "Rage (2/3): strength advantage",
    GP: "147",
    CP: "3",
  });
  assert.ok(source);
  assert.equal(source.experience, "");
  const sheet = legacyCharacter(source, source.name);
  assert.equal(sheet.attacks[0].bonus, 7);
  assert.equal(sheet.equipment[1].quantity, 2);
  assert.equal(sheet.spells.length, 3);
  assert.equal(sheet.spells[1].level, 1);
  assert.deepEqual(sheet.resources[0], { name: "Rage", current: 2, max: 3, recovery: "manual" });
  assert.equal(sheet.scores.str, 20);
  assert.equal(sheet.hp, 47);
  assert.equal(sheet.maxHp, 53);
  assert.match(sheet.notes, /Sword/);
  assert.match(sheet.features, /Rage/);
  assert.ok(importedFieldNames(source).includes("equipment"));
  const partial = sheetFromText("Character Name: Partial\nRace: Human");
  assert.deepEqual(importedFieldNames(partial).sort(), ["name", "species"]);
});

test("statblock imports explicit combat values and retains all actions, refusing missing HP", () => {
  const text = `Goblin\nSmall humanoid (goblinoid), neutral evil\nArmor Class 15 (leather armor, shield)\nHit Points 7 (2d6)\nSpeed 30 ft.\nSTR DEX CON INT WIS CHA\n8 (-1) 14 (+2) 10 (+0) 10 (+0) 8 (-1) 8 (-1)\nSkills Stealth +6\nSenses darkvision 60 ft., passive Perception 9\nLanguages Common, Goblin\nChallenge 1/4 (50 XP)\nNimble Escape. Disengage or Hide as a bonus action.\nActions\nScimitar. +4 to hit, 1d6+2 slashing.\nShortbow. +4 to hit, 1d6+2 piercing.`;
  const c = parseStatblock(text);
  assert.equal(c.ac, 15);
  assert.equal(c.hp, 7);
  assert.equal(c.cr, 0.25);
  assert.equal(c.xp, 50);
  assert.equal(c.initiativeBonus, 2);
  assert.equal(c.notes, text);
  assert.throws(() => parseStatblock("Goblin\nArmor Class 15"));
});

test("partial imports name only extracted nested fields", () => {
  const partial = sheetFromFields({ CharacterName: "Partial", STR: "18", GP: "4" });
  const fields = importedFieldNames(partial);
  assert.ok(fields.includes("scores.str"));
  assert.ok(fields.includes("coins.gp"));
  for (const absent of ["scores.dex", "coins.cp", "equipment", "spells", "attacks"])
    assert.ok(!fields.includes(absent));
});

test("colon-labeled scan text preserves abilities, armor and current/max HP", () => {
  const legacy = sheetFromText(
    "Character Name: Scan Hero\nClass and Level: Fighter 4\nRace: Human\nArmor Class: 19\nHit Points: 47 / 53\nStrength: 20\nDexterity: 18\nConstitution: 20\nIntelligence: 8\nWisdom: 9\nCharisma: 12",
  );
  const sheet = legacyCharacter(legacy, legacy.name);
  assert.equal(sheet.ac, 19);
  assert.equal(sheet.hp, 47);
  assert.equal(sheet.maxHp, 53);
  assert.equal(sheet.scores.str, 20);
  assert.equal(sheet.scores.dex, 18);
});
