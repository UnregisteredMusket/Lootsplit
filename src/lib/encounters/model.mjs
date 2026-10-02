import { z } from "zod";
const label = z.string().trim().min(1).max(120);
const note = z.string().max(16000);
const integer = z.number().int().min(0).max(1000000);
export const combatantSchema = z
  .object({
    id: label,
    name: label,
    side: z.enum(["enemy", "ally"]),
    hp: integer,
    maxHp: integer.min(1),
    ac: integer.max(100),
    initiative: z.number().int().min(-1000).max(1000).nullable(),
    initiativeBonus: z.number().int().min(-100).max(100),
    conditions: z.string().max(500),
    notes: note,
    cr: z.number().min(0).max(30),
    xp: integer,
    source: z.string().max(2000),
    sourceKey: z.string().max(120),
  })
  .refine((c) => c.hp <= c.maxHp, "HP cannot exceed maximum HP.");
export const lootSchema = z.object({
  id: label,
  name: label,
  quantity: integer.min(1).max(100000),
  unitCopper: integer,
  notes: note,
  catalogId: z.string().max(120),
  sourceTableId: z.string().max(120).default(""),
  purseId: z.string().max(120),
});
export const tableSchema = z
  .object({
    id: label,
    name: label,
    entries: z
      .array(z.object({ weight: integer.min(1).max(1000), loot: lootSchema }))
      .min(1)
      .max(100),
    selected: z.number().int().min(0).max(99).nullable(),
  })
  .refine(
    (t) => t.selected === null || t.selected < t.entries.length,
    "Choose an existing loot result.",
  );
export const encounterSchema = z
  .object({
    version: z.literal(1),
    name: label,
    notes: note,
    partySize: z.number().int().min(1).max(20),
    level: z.number().int().min(1).max(20),
    difficulty: z.enum(["easy", "medium", "hard", "deadly"]),
    round: integer.min(1),
    activeId: z.string().max(120),
    combatants: z.array(combatantSchema).max(100),
    loot: z.array(lootSchema).max(200),
    tables: z.array(tableSchema).max(20),
    coins: z.object({ cp: integer, sp: integer, ep: integer, gp: integer, pp: integer }),
    coinPurseId: z.string().max(120),
  })
  .superRefine((e, ctx) => {
    for (const rows of [e.combatants, e.loot, e.tables])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        ctx.addIssue({ code: "custom", message: "Each row needs a unique ID." });
    if (e.activeId && !e.combatants.some((c) => c.id === e.activeId))
      ctx.addIssue({ code: "custom", message: "Select an existing active combatant." });
  });
export function blankEncounter() {
  return encounterSchema.parse({
    version: 1,
    name: "New encounter",
    notes: "",
    partySize: 4,
    level: 1,
    difficulty: "medium",
    round: 1,
    activeId: "",
    combatants: [],
    loot: [],
    tables: [],
    coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    coinPurseId: "",
  });
}
export function blankCombatant() {
  return combatantSchema.parse({
    id: crypto.randomUUID(),
    name: "Custom enemy",
    side: "enemy",
    hp: 10,
    maxHp: 10,
    ac: 10,
    initiative: null,
    initiativeBonus: 0,
    conditions: "",
    notes: "",
    cr: 0,
    xp: 0,
    source: "Custom content",
    sourceKey: "",
  });
}
export function blankLoot() {
  return lootSchema.parse({
    id: crypto.randomUUID(),
    name: "Treasure",
    quantity: 1,
    unitCopper: 0,
    notes: "",
    catalogId: "",
    purseId: "",
  });
}
// D&D 2014 Basic Rules: encounter XP thresholds and party-size multipliers.
export const thresholds = [
  [25, 50, 75, 100],
  [50, 100, 150, 200],
  [75, 150, 225, 400],
  [125, 250, 375, 500],
  [250, 500, 750, 1100],
  [300, 600, 900, 1400],
  [350, 750, 1100, 1700],
  [450, 900, 1400, 2100],
  [550, 1100, 1600, 2400],
  [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600],
  [1000, 2000, 3000, 4500],
  [1100, 2200, 3400, 5100],
  [1250, 2500, 3800, 5700],
  [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200],
  [2000, 3900, 5900, 8800],
  [2100, 4200, 6300, 9500],
  [2400, 4900, 7300, 10900],
  [2800, 5700, 8500, 12700],
];
/** @param {number} count @param {number} partySize */
export function multiplier(count, partySize) {
  if (!count) return 0;
  let i =
    count === 1 ? 1 : count === 2 ? 2 : count <= 6 ? 3 : count <= 10 ? 4 : count <= 14 ? 5 : 6;
  i += partySize < 3 ? 1 : partySize >= 6 ? -1 : 0;
  return [0.5, 1, 1.5, 2, 2.5, 3, 4, 5][i];
}
/** @param {z.infer<typeof encounterSchema>} e */
export function estimate(e) {
  const enemies = e.combatants.filter((c) => c.side === "enemy");
  const raw = enemies.reduce((s, c) => s + c.xp, 0),
    adjusted = raw * multiplier(enemies.length, e.partySize);
  const limits = thresholds[Math.max(0, Math.min(19, e.level - 1))].map((n) => n * e.partySize);
  const tier = limits.reduce((n, v, i) => (adjusted >= v ? i : n), -1);
  return {
    raw,
    adjusted,
    limits,
    label: ["trivial", "easy", "medium", "hard", "deadly"][tier + 1],
  };
}
export const generatorSchema = z.object({
  partySize: z.number().int().min(1).max(20),
  level: z.number().int().min(1).max(20),
  difficulty: z.enum(["easy", "medium", "hard", "deadly"]),
  mode: z.enum(["difficulty", "cr"]),
  cr: z.number().min(0).max(30),
  count: z.number().int().min(1).max(30),
  enemy: z.string().max(100),
  environment: z.string().max(80),
});
/** @param {z.infer<typeof combatantSchema>[]} creatures @param {z.infer<typeof generatorSchema>} input @param {()=>number} random */
export function generateEncounter(creatures, input, random = Math.random) {
  const g = generatorSchema.parse(input);
  const candidates = creatures.filter((c) => g.mode !== "cr" || c.cr === g.cr);
  if (!candidates.length)
    throw new Error("No enemies match these filters. Broaden the filters or add a custom enemy.");
  let chosen = [];
  if (g.mode === "cr")
    chosen = Array.from(
      { length: g.count },
      () => candidates[Math.floor(random() * candidates.length)],
    );
  else {
    const target =
      thresholds[g.level - 1][["easy", "medium", "hard", "deadly"].indexOf(g.difficulty)] *
      g.partySize;
    /** @type {{c: z.infer<typeof combatantSchema>, count: number, score: number}[]} */
    const options = [];
    // Compare groups against the selected threshold; never silently pretend an exact match.
    for (const c of candidates)
      for (let count = 1; count <= Math.min(30, g.partySize * 3); count++) {
        if (c.xp === 0) continue;
        const value = c.xp * count * multiplier(count, g.partySize);
        options.push({ c, count, score: Math.abs(Math.log(value / target)) });
      }
    options.sort((a, b) => a.score - b.score);
    if (!options.length)
      throw new Error(
        "No creatures with XP match these filters. Use CR mode or broaden the filters.",
      );
    const near = options.filter((o) => o.score <= options[0].score + 0.12);
    const pick = near[Math.floor(random() * near.length)];
    chosen = Array.from({ length: pick.count }, () => pick.c);
  }
  return chosen.map((c, i) => ({
    ...c,
    id: crypto.randomUUID(),
    name: chosen.length > 1 ? `${c.name} ${i + 1}` : c.name,
  }));
}
/** @param {z.infer<typeof encounterSchema>} e */
export function nextTurn(e) {
  const order = [...e.combatants].sort((a, b) => (b.initiative ?? -1001) - (a.initiative ?? -1001));
  if (!order.length) return e;
  const current = order.findIndex((c) => c.id === e.activeId),
    next = (current + 1) % order.length;
  return { ...e, activeId: order[next].id, round: e.round + (current >= 0 && next === 0 ? 1 : 0) };
}
