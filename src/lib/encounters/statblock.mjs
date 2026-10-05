import { blankCombatant, combatantSchema } from "./model.mjs";
/** Parse explicit printed values; never guess missing AC/HP or replace source text. */
/** @param {string} text */
export function parseStatblock(text) {
  const source = String(text).replace(/[−–]/g, "-").trim();
  const lines = source
    .split(/\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const name = lines[0] || "";
  const ac = source.match(/Armor\s+Class\s*:?\s*(\d{1,2})/i);
  const hp = source.match(/Hit\s+Points\s*:?\s*(\d{1,6})/i);
  if (!name || name.length > 120 || !ac || !hp || Number(hp[1]) < 1)
    throw Error(
      "Name, Armor Class and Hit Points must be readable. Correct the extracted text before adding this creature.",
    );
  const challenge = source.match(
    /Challenge\s*:?\s*(\d+(?:\s*\/\s*\d+)?)\s*(?:\(([\d,]+)\s*XP\))?/i,
  );
  let cr = 0,
    xp = 0;
  if (challenge) {
    const [a, b] = challenge[1].split("/").map(Number);
    cr = b ? a / b : a;
    xp = Number((challenge[2] || "0").replaceAll(",", ""));
  }
  const table = source.match(/STR\s+DEX\s+CON\s+INT\s+WIS\s+CHA\s+([\s\S]+?)(?:\n\s*[A-Za-z]|$)/i);
  const scores = table?.[1].match(/\d+\s*\([+-]?\d+\)/g);
  const dex =
    scores?.[1]?.match(/^\d+/)?.[0] || source.match(/\bDEX(?:TERITY)?\s*:?\s*(\d{1,2})\s*\(/i)?.[1];
  return combatantSchema.parse({
    ...blankCombatant(),
    name,
    ac: Number(ac[1]),
    hp: Number(hp[1]),
    maxHp: Number(hp[1]),
    cr,
    xp,
    initiativeBonus: dex ? Math.floor((Number(dex) - 10) / 2) : 0,
    notes: source,
    source: "Imported statblock; verify against the original",
    sourceKey: "",
  });
}
