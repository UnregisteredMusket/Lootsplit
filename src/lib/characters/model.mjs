import { z } from "zod";
export const abilities = ["str", "dex", "con", "int", "wis", "cha"];
export const skills = {
  Acrobatics: "dex",
  "Animal Handling": "wis",
  Arcana: "int",
  Athletics: "str",
  Deception: "cha",
  History: "int",
  Insight: "wis",
  Intimidation: "cha",
  Investigation: "int",
  Medicine: "wis",
  Nature: "int",
  Perception: "wis",
  Performance: "cha",
  Persuasion: "cha",
  Religion: "int",
  "Sleight of Hand": "dex",
  Stealth: "dex",
  Survival: "wis",
};
const short = z.string().trim().max(120),
  notes = z.string().max(12000),
  n = z.number().int().min(0).max(9999),
  bonus = z.number().int().min(-100).max(100);
const ability = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
const training = z.object({ rank: z.number().int().min(0).max(2), extra: bonus });
export const sheetSchema = z
  .object({
    version: z.literal(1),
    name: short.min(1),
    species: short,
    classes: short,
    background: short,
    level: z.number().int().min(1).max(20),
    edition: z.enum(["2014", "2024", "custom"]),
    description: notes,
    portrait: z
      .string()
      .max(500000)
      .refine((v) => !v || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)),
    scores: z.object({
      str: n.max(30).min(1),
      dex: n.max(30).min(1),
      con: n.max(30).min(1),
      int: n.max(30).min(1),
      wis: n.max(30).min(1),
      cha: n.max(30).min(1),
    }),
    proficiency: z.number().int().min(0).max(20),
    saves: z.record(ability, training),
    skills: z
      .record(z.string().max(40), training)
      .refine((v) => Object.keys(v).length <= 18 && Object.keys(v).every((k) => Object.hasOwn(skills, k))),
    hp: n,
    maxHp: n,
    tempHp: n,
    ac: n.max(99),
    speed: short,
    initiative: bonus,
    inspiration: z.boolean(),
    deathSuccesses: n.max(3),
    deathFailures: n.max(3),
    conditions: short,
    hitDice: short,
    spellAbility: ability,
    spellAttackExtra: bonus,
    spellDcExtra: bonus,
    attacks: z.array(z.object({ name: short.min(1), bonus, damage: short, notes })).max(50),
    spells: z
      .array(
        z.object({
          name: short.min(1),
          level: n.max(9),
          prepared: z.boolean(),
          description: notes,
          formula: short,
          source: z.string().max(4000),
        }),
      )
      .max(200),
    slots: z.array(z.object({ level: n.min(1).max(9), max: n.max(99), used: n.max(99) })).max(9),
    resources: z
      .array(
        z.object({
          name: short.min(1),
          max: n,
          current: n,
          recovery: z.enum(["short", "long", "manual"]),
        }),
      )
      .max(50),
    equipment: z
      .array(
        z.object({
          name: short.min(1),
          quantity: n,
          weight: z.number().min(0).max(9999),
          equipped: z.boolean(),
          notes,
        }),
      )
      .max(200),
    coins: z.object({
      cp: z.number().int().min(0).max(999999),
      sp: z.number().int().min(0).max(999999),
      ep: z.number().int().min(0).max(999999),
      gp: z.number().int().min(0).max(999999),
      pp: z.number().int().min(0).max(999999),
    }),
    features: notes,
    notes,
    source: z.string().max(12000),
  })
  .superRefine((s, ctx) => {
    if (
      s.hp > s.maxHp ||
      s.resources.some((r) => r.current > r.max) ||
      s.slots.some((r) => r.used > r.max) ||
      new Set(s.slots.map((r) => r.level)).size !== s.slots.length
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Current HP/resources and used slots must fit their maximums; slot levels must be unique.",
      });
  });
/** @typedef {z.infer<typeof sheetSchema>} PlaySheet */
/** @returns {PlaySheet} */
export function blankSheet() {
  return sheetSchema.parse({
    version: 1,
    name: "New adventurer",
    species: "",
    classes: "",
    background: "",
    level: 1,
    edition: "2014",
    description: "",
    portrait: "",
    scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiency: 2,
    saves: Object.fromEntries(abilities.map((k) => [k, { rank: 0, extra: 0 }])),
    skills: Object.fromEntries(Object.keys(skills).map((k) => [k, { rank: 0, extra: 0 }])),
    hp: 10,
    maxHp: 10,
    tempHp: 0,
    ac: 10,
    speed: "30 ft",
    initiative: 0,
    inspiration: false,
    deathSuccesses: 0,
    deathFailures: 0,
    conditions: "",
    hitDice: "1d8",
    spellAbility: "int",
    spellAttackExtra: 0,
    spellDcExtra: 0,
    attacks: [],
    spells: [],
    slots: [],
    resources: [],
    equipment: [],
    coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    features: "",
    notes: "",
    source: "",
  });
}
/** @param {number} score */
export const modifier = (score) => Math.floor((score - 10) / 2);
/** @param {PlaySheet} s @param {string} kind @param {string} key */
export function rollSpec(s, kind, key) {
  const k = ability.safeParse(key);
  if (kind === "ability" && k.success)
    return {
      label: `${key.toUpperCase()} check`,
      formula: `1d20${signed(modifier(s.scores[k.data]))}`,
    };
  if (kind === "save" && k.success)
    return {
      label: `${key.toUpperCase()} save`,
      formula: `1d20${signed(modifier(s.scores[k.data]) + s.saves[k.data].rank * s.proficiency + s.saves[k.data].extra)}`,
    };
  if (kind === "skill" && Object.hasOwn(skills, key)) {
    const score =
      s.scores[
        /** @type {keyof PlaySheet['scores']} */ (skills[/** @type {keyof typeof skills} */ (key)])
      ];
    const t = s.skills[key] || { rank: 0, extra: 0 };
    return {
      label: key,
      formula: `1d20${signed(modifier(score) + t.rank * s.proficiency + t.extra)}`,
    };
  }
  if (kind === "initiative")
    return { label: "Initiative", formula: `1d20${signed(modifier(s.scores.dex) + s.initiative)}` };
  if (kind === "death") return { label: "Death saving throw", formula: "1d20" };
  if (kind === "spellAttack")
    return {
      label: "Spell attack",
      formula: `1d20${signed(modifier(s.scores[s.spellAbility]) + s.proficiency + s.spellAttackExtra)}`,
    };
  const index = Number(key);
  if (!Number.isInteger(index) || index < 0) throw Error("Choose a valid roll.");
  if ((kind === "attack" || kind === "damage") && s.attacks[index]) {
    const a = s.attacks[index];
    return {
      label: `${a.name} ${kind}`,
      formula: kind === "attack" ? `1d20${signed(a.bonus)}` : a.damage,
    };
  }
  if (kind === "spell" && s.spells[index])
    return { label: s.spells[index].name, formula: s.spells[index].formula };
  throw Error("Choose a valid roll.");
}
/** @param {number} n */
export const signed = (n) => (n >= 0 ? `+${n}` : String(n));
/** @param {string} input */
export function parseDice(input) {
  const m = /^(\d{1,2})?d(\d{1,4})([+-]\d{1,4})?$/i.exec(input.replace(/\s/g, ""));
  if (!m) throw Error("Use a dice formula such as 1d20+5 or 2d6+3.");
  const count = Number(m[1] || 1),
    sides = Number(m[2]),
    mod = Number(m[3] || 0);
  if (count < 1 || count > 40 || sides < 2 || sides > 1000 || Math.abs(mod) > 1000)
    throw Error("Use 1–40 dice, 2–1000 sides, and a modifier from −1000 to 1000.");
  return { count, sides, modifier: mod };
}
/** @param {number} sides */
function die(sides) {
  const limit = Math.floor(4294967296 / sides) * sides;
  let value;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= limit);
  return (value % sides) + 1;
}
/** @param {string} formula @param {string} mode */
export function throwDice(formula, mode = "normal") {
  const p = parseDice(formula);
  if (!["normal", "advantage", "disadvantage"].includes(mode)) throw Error("Invalid roll mode.");
  if (mode !== "normal" && (p.count !== 1 || p.sides !== 20))
    throw Error("Advantage and disadvantage apply to a single d20.");
  const dice = Array.from({ length: mode === "normal" ? p.count : 2 }, () => die(p.sides));
  const subtotal =
    mode === "advantage"
      ? Math.max(...dice)
      : mode === "disadvantage"
        ? Math.min(...dice)
        : dice.reduce((a, b) => a + b, 0);
  return { ...p, dice, mode, total: subtotal + p.modifier };
}
