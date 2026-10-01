import assert from "node:assert/strict";
import test from "node:test";
import { buildBill, type Seat } from "./table.ts";
import { sheetFromData, sheetFromFields, sheetFromText } from "./sheet.ts";

const sitting: Seat = { role: "player", purseIds: ["ivo"], shopIds: ["s"], openedAt: 100 };

test("an official 2014 sheet keeps the scores", () => {
  const sheet = sheetFromFields({
    CharacterName: "Ivo",
    ClassLevel: "Fighter 5",
    Race: "Human",
    Background: "Soldier",
    Alignment: "Lawful Neutral",
    STR: "16",
    STRmod: "+3",
    DEX: "14",
    DEXmod: "+2",
    CON: "15",
    CONmod: "+2",
    INT: "10",
    INTmod: "+0",
    WIS: "12",
    WISmod: "+1",
    CHA: "8",
    CHAmod: "-1",
    AC: "18",
    Initiative: "+2",
    Speed: "30",
    HPMax: "44",
    HPCurrent: "30",
    ProfBonus: "+3",
    Passive: "11",
    PersonalityTraits: "I face problems head-on.",
    Athletics: "+6",
    GP: "15",
    "Wpn Name": "Longsword",
    "Wpn1 AtkBonus": "+5",
    "Wpn1 Damage": "1d8+3",
  });
  assert.equal(sheet?.name, "Ivo");
  assert.equal(sheet?.classLevel, "Fighter 5");
  assert.equal(sheet?.abilities.str.score, "16");
  assert.equal(sheet?.abilities.cha.modifier, "-1");
  assert.equal(sheet?.hitPoints, "30 / 44");
  assert.equal(sheet?.skills[0]?.name, "Athletics");
  assert.equal(sheet?.coins.gp, 15);
  assert.match(sheet?.attacks ?? "", /Longsword/);
});

test("plain sheet text still yields the six abilities", () => {
  const sheet = sheetFromText(`Character Name: Sera\nClass & Level: Rogue 3\nRace: Halfling\nStrength 10 (+0)\nDexterity 16 (+3)\nConstitution 12 (+1)\nIntelligence 14 (+2)\nWisdom 13 (+1)\nCharisma 11 (+0)\nArmor Class 14\nInitiative +3\nSpeed 25 ft.`);
  assert.equal(sheet?.name, "Sera");
  assert.equal(sheet?.abilities.dex.score, "16");
  assert.equal(sheet?.abilities.dex.modifier, "+3");
  assert.equal(sheet?.armorClass, "14");
});

test("a foundry actor and a beyond export both count", () => {
  const foundry = sheetFromData({
    name: "Ivo",
    type: "character",
    system: {
      abilities: { str: { value: 18, mod: 4 }, dex: { value: 12 }, con: { value: 14 }, int: { value: 8 }, wis: { value: 10 }, cha: { value: 13 } },
      details: { race: "Human", background: "Folk Hero", alignment: "Neutral", level: 5 },
      attributes: { ac: { value: 16 }, hp: { max: 40, value: 40 } },
    },
  });
  assert.equal(foundry?.abilities.str.score, "18");
  assert.equal(foundry?.armorClass, "16");
  const beyond = sheetFromData({
    name: "Mara",
    race: { fullName: "Hill Dwarf" },
    classes: [{ definition: { name: "Cleric" }, level: 2 }],
    stats: [
      { id: 1, value: 14 },
      { id: 2, value: 10 },
      { id: 3, value: 16 },
      { id: 4, value: 8 },
      { id: 5, value: 15 },
      { id: 6, value: 12 },
    ],
    alignmentId: 1,
    currencies: { gp: 25 },
  });
  assert.equal(beyond?.race, "Hill Dwarf");
  assert.equal(beyond?.classLevel, "Cleric 2");
  assert.equal(beyond?.abilities.wis.score, "15");
  assert.equal(beyond?.alignment, "Lawful good");
  assert.equal(beyond?.coins.gp, 25);
});

test("a bill carries the sheet for that character only", () => {
  const sheet = sheetFromFields({ CharacterName: "Ivo", STR: "10", DEX: "10", CON: "10", INT: "10", WIS: "10", CHA: "10" });
  assert.ok(sheet);
  const bill = buildBill(
    {
      purses: [],
      holdings: [],
      stock: [],
      ledger: [],
      sheets: [
        { ...sheet, purseId: "ivo", importedAt: 1 },
        { ...sheet, purseId: "sera", name: "Sera", importedAt: 1 },
      ],
    },
    sitting,
  );
  assert.deepEqual(bill.sheets?.map((row) => row.purseId), ["ivo"]);
});
