import type { Coins } from "./types.ts";
import { quireDb } from "./db.ts";

export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type CharacterSheet = {
  purseId: string;
  edition: "2014";
  importedAt: number;
  name: string;
  race: string;
  classLevel: string;
  background: string;
  alignment: string;
  experience: string;
  abilities: Record<AbilityKey, { score: string; modifier: string }>;
  saves: Record<AbilityKey, string>;
  skills: { name: string; bonus: string }[];
  armorClass: string;
  initiative: string;
  speed: string;
  hitPoints: string;
  hitDice: string;
  proficiency: string;
  passivePerception: string;
  traits: string;
  ideals: string;
  bonds: string;
  flaws: string;
  features: string;
  proficiencies: string;
  attacks: string;
  equipment: string;
  spells: string;
  coins: Coins;
};

export type SheetDraft = Omit<CharacterSheet, "purseId" | "importedAt">;

const ABILITIES: { key: AbilityKey; label: string }[] = [
  { key: "str", label: "Strength" },
  { key: "dex", label: "Dexterity" },
  { key: "con", label: "Constitution" },
  { key: "int", label: "Intelligence" },
  { key: "wis", label: "Wisdom" },
  { key: "cha", label: "Charisma" },
];

const SKILLS: { name: string; keys: string[] }[] = [
  { name: "Acrobatics", keys: ["acrobatics"] },
  { name: "Animal Handling", keys: ["animalhandling"] },
  { name: "Arcana", keys: ["arcana"] },
  { name: "Athletics", keys: ["athletics"] },
  { name: "Deception", keys: ["deception"] },
  { name: "History", keys: ["history"] },
  { name: "Insight", keys: ["insight"] },
  { name: "Intimidation", keys: ["intimidation"] },
  { name: "Investigation", keys: ["investigation"] },
  { name: "Medicine", keys: ["medicine"] },
  { name: "Nature", keys: ["nature"] },
  { name: "Perception", keys: ["perception"] },
  { name: "Performance", keys: ["performance"] },
  { name: "Persuasion", keys: ["persuasion"] },
  { name: "Religion", keys: ["religion"] },
  { name: "Sleight of Hand", keys: ["sleightofhand"] },
  { name: "Stealth", keys: ["stealth"] },
  { name: "Survival", keys: ["survival"] },
];

const FOUNDRY_SKILLS: Record<string, string> = {
  acr: "Acrobatics",
  ani: "Animal Handling",
  arc: "Arcana",
  ath: "Athletics",
  dec: "Deception",
  his: "History",
  ins: "Insight",
  itm: "Intimidation",
  inv: "Investigation",
  med: "Medicine",
  nat: "Nature",
  prc: "Perception",
  prf: "Performance",
  per: "Persuasion",
  rel: "Religion",
  slt: "Sleight of Hand",
  ste: "Stealth",
  sur: "Survival",
};

const ALIGNMENTS = [
  "",
  "Lawful good",
  "Neutral good",
  "Chaotic good",
  "Lawful neutral",
  "Neutral",
  "Chaotic neutral",
  "Lawful evil",
  "Neutral evil",
  "Chaotic evil",
];

export function sheetFromFields(fields: Record<string, string>): SheetDraft | null {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(fields)) {
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const text = clean(value);
    if (norm && text && !map.has(norm)) map.set(norm, text);
  }
  return bodyFromMap(map);
}

export function sheetFromText(text: string): SheetDraft | null {
  const flat = text.replace(/\u00a0/g, " ").replace(/[−–]/g, "-");
  const map = new Map<string, string>();
  const labeled = (label: string) => {
    const match = flat.match(
      new RegExp(`(?:^|\\n)\\s*${label}[ \t]*[:\\n][ \t]*([^\\n]{1,80})`, "i"),
    );
    return match?.[1]?.trim() ?? "";
  };
  put(map, "charactername", labeled("character name") || labeled("name"));
  put(
    map,
    "classlevel",
    labeled("class\\s*&\\s*level") || labeled("class and level") || labeled("class"),
  );
  put(map, "race", labeled("race"));
  put(map, "background", labeled("background"));
  put(map, "alignment", labeled("alignment"));
  put(map, "xp", labeled("experience points") || labeled("experience") || labeled("\\bxp\\b"));
  for (const ability of ABILITIES) {
    const match =
      flat.match(
        new RegExp(`(?:^|\\n)\\s*${ability.key}\\s+(\\d{1,2})\\s+\\(?([+-]?\\d{1,2})\\)?`, "i"),
      ) ||
      flat.match(
        new RegExp(
          `(?:^|\\n)\\s*${ability.label}[ \t:]+(\\d{1,2})\\s*(?:\\(\\s*([+-]?\\d{1,2})\\s*\\))?`,
          "i",
        ),
      );
    if (!match?.[1]) continue;
    put(map, ability.key, match[1]);
    if (match[2]) put(map, `${ability.key}mod`, match[2]);
  }
  const ac = flat.match(/armor class[\s:]+(\d{1,2})/i);
  const init = flat.match(/initiative[\s:]+([+-]?\d{1,2})/i);
  const speed = flat.match(/speed[\s:]+(\d{1,3}\s*(?:ft\.?)?)/i);
  const hp =
    flat.match(/hit point maximum[\s:]+(\d{1,4})/i) ||
    flat.match(/\bhp\s+max(?:imum)?[\s:]+(\d{1,4})/i);
  if (ac) put(map, "ac", ac[1] ?? "");
  if (init) put(map, "initiative", init[1] ?? "");
  if (speed) put(map, "speed", speed[1] ?? "");
  if (hp) put(map, "hpmax", hp[1] ?? "");
  const hpPair = flat.match(/(?:^|\n)\s*(?:hit points|hp)[ \t:]+(\d{1,4})[ \t]*\/[ \t]*(\d{1,4})/i);
  if (hpPair) {
    put(map, "hpcurrent", hpPair[1]!);
    put(map, "hpmax", hpPair[2]!);
  }
  const headings = [
    "personality traits",
    "traits",
    "ideals",
    "bonds",
    "flaws",
    "features and traits",
    "features",
    "proficiencies",
    "languages",
    "attacks and spellcasting",
    "attacks",
    "equipment",
    "spells",
    "spellcasting",
  ];
  for (const [heading, key] of Object.entries({
    "personality traits": "personalitytraits",
    traits: "traits",
    ideals: "ideals",
    bonds: "bonds",
    flaws: "flaws",
    "features and traits": "featuresandtraits",
    features: "features",
    proficiencies: "proficiencies",
    languages: "languages",
    "attacks and spellcasting": "attacks",
    attacks: "attacks",
    equipment: "equipment",
    spells: "spells",
    spellcasting: "spells",
  })) {
    const start = new RegExp(`(?:^|\\n)[ \t]*${heading}[ \t]*:?[^\\S\\n]*(?:\\n|$)`, "i").exec(
      flat,
    );
    if (start) {
      const rest = flat.slice(start.index + start[0].length);
      const stop = new RegExp(
        `\\n[ \t]*(?:${headings.join("|")})[ \t]*:?[^\\S\\n]*(?:\\n|$)`,
        "i",
      ).exec(rest);
      put(map, key, rest.slice(0, stop?.index ?? rest.length).trim());
    } else put(map, key, labeled(heading));
  }
  for (const skill of SKILLS) {
    const match = flat.match(
      new RegExp(`(?:^|\\n)\\s*${skill.name}[ \t:]+([+-]?\\d{1,2})\\b`, "i"),
    );
    if (match) put(map, skill.keys[0]!, match[1]!);
  }
  for (const ability of ABILITIES) {
    const save = flat.match(
      new RegExp(
        `(?:^|\\n)\\s*(?:${ability.key}|${ability.label})[ \t]+(?:save|saving throw)[ \t:]+([+-]?\\d{1,2})`,
        "i",
      ),
    );
    if (save) put(map, `${ability.key}save`, save[1]!);
  }
  for (const [key, pattern] of Object.entries({
    profbonus: /proficiency(?: bonus)?[ \t:]+([+-]?\d{1,2})/i,
    hpcurrent: /current hit points[ \t:]+(\d{1,4})/i,
    hitdice: /hit dice[ \t:]+(\d+d\d+)/i,
  })) {
    const match = flat.match(pattern);
    if (match) put(map, key, match[1]!);
  }
  for (const coin of ["cp", "sp", "ep", "gp", "pp"]) {
    const match = flat.match(new RegExp(`\\b(\\d+)[ \t]+${coin}\\b`, "i"));
    if (match) put(map, coin, match[1]!);
  }
  return bodyFromMap(map);
}

export function sheetFromData(value: unknown): SheetDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return (
    sheetFromStored(record) ?? foundrySheet(record) ?? beyondSheet(record) ?? looseSheet(record)
  );
}

export function readSheets(value: unknown): CharacterSheet[] {
  const list = Array.isArray(value) ? value : bag(value, "sheets");
  const sheets: CharacterSheet[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const sheet = normalizeSheet(item);
    if (!sheet || seen.has(sheet.purseId)) continue;
    seen.add(sheet.purseId);
    sheets.push(sheet);
  }
  return sheets;
}

export function mergeSheets(
  current: CharacterSheet[],
  incoming: CharacterSheet[],
): CharacterSheet[] {
  const byId = new Map(current.map((sheet) => [sheet.purseId, sheet]));
  for (const sheet of incoming) byId.set(sheet.purseId, sheet);
  return [...byId.values()];
}

export async function loadSheets(): Promise<CharacterSheet[]> {
  return readSheets(await meta("sheets"));
}

export async function saveSheet(sheet: CharacterSheet): Promise<void> {
  const sheets = mergeSheets(await loadSheets(), [sheet]);
  await putMeta({ id: "sheets", sheets });
}

export function charismaScore(sheet: CharacterSheet | undefined): number | null {
  const score = Math.floor(Number(sheet?.abilities.cha.score));
  return Number.isFinite(score) && score > 0 ? score : null;
}

export function showMod(value: string, score = ""): string {
  const text = value.trim();
  if (text) {
    if (text.startsWith("+") || text.startsWith("-") || text.startsWith("−")) return text;
    const number = Number(text);
    if (Number.isFinite(number)) return number >= 0 ? `+${number}` : String(number);
    return text;
  }
  const base = Number(score);
  if (!Number.isFinite(base)) return "";
  const mod = Math.floor((base - 10) / 2);
  return mod >= 0 ? `+${mod}` : String(mod);
}

function bodyFromMap(map: Map<string, string>): SheetDraft | null {
  const abilities = emptyAbilities();
  let scores = 0;
  for (const ability of ABILITIES) {
    const score = pick(
      map,
      ability.key,
      ability.label.toLowerCase(),
      `${ability.label.toLowerCase()}score`,
    );
    const modifier = pick(
      map,
      `${ability.key}mod`,
      `${ability.label.toLowerCase()}mod`,
      `${ability.label.toLowerCase()}modifier`,
    );
    if (score) scores += 1;
    abilities[ability.key] = { score, modifier };
  }
  const name = pick(map, "charactername", "charname", "name", "fullname");
  const classLevel = pick(map, "classlevel", "classandlevel", "classes", "class");
  const race = pick(map, "race", "ancestry");
  if (scores < 3 && !name && !classLevel) return null;
  const current = pick(map, "hpcurrent", "currenthp", "hitpoints");
  const max = pick(map, "hpmax", "maxhp", "hitpointmaximum");
  const temp = pick(map, "hptemp", "temphp");
  const hitPoints = [
    current && max ? `${current} / ${max}` : max || current,
    temp ? `${temp} temp` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const dice = pick(map, "hd", "hitdice");
  const diceTotal = pick(map, "hdtotal", "hitdicetotal");
  const attacks = weaponLines(map) || pick(map, "attacksspellcasting", "attacks");
  return {
    edition: "2014",
    name,
    race,
    classLevel,
    background: pick(map, "background"),
    alignment: pick(map, "alignment"),
    experience: /^[\d, ]+$/.test(pick(map, "xp", "experience", "experiencepoints"))
      ? pick(map, "xp", "experience", "experiencepoints")
      : "",
    abilities,
    saves: {
      str: pick(map, "ststrength", "strsave", "strengthsave"),
      dex: pick(map, "stdexterity", "dexsave", "dexteritysave"),
      con: pick(map, "stconstitution", "consave", "constitutionsave"),
      int: pick(map, "stintelligence", "intsave", "intelligencesave"),
      wis: pick(map, "stwisdom", "wissave", "wisdomsave"),
      cha: pick(map, "stcharisma", "chasave", "charismasave"),
    },
    skills: SKILLS.flatMap((skill) => {
      const bonus = pick(map, ...skill.keys);
      return bonus ? [{ name: skill.name, bonus }] : [];
    }),
    armorClass: pick(map, "ac", "armorclass"),
    initiative: pick(map, "initiative", "init"),
    speed: pick(map, "speed"),
    hitPoints,
    hitDice: diceTotal && dice ? `${diceTotal} × ${dice}` : diceTotal || dice,
    proficiency: pick(map, "profbonus", "proficiencybonus", "proficiency"),
    passivePerception: pick(map, "passive", "passiveperception", "passivewisdom"),
    traits: clip(pick(map, "personalitytraits", "traits")),
    ideals: clip(pick(map, "ideals")),
    bonds: clip(pick(map, "bonds")),
    flaws: clip(pick(map, "flaws")),
    features: clip(pick(map, "featuresandtraits", "features", "classtraits")),
    proficiencies: clip(pick(map, "proficiencieslang", "proficiencies", "languages")),
    attacks: clip(attacks),
    equipment: clip(pick(map, "equipment")),
    spells: clip(
      pick(map, "spells", "spellcasting", "spellslist") ||
        [...map]
          .filter(([key]) => /^spells?\d/.test(key))
          .map(([, value]) => value)
          .join("\n"),
    ),
    coins: {
      cp: whole(pick(map, "cp", "copper")),
      sp: whole(pick(map, "sp", "silver")),
      ep: whole(pick(map, "ep", "electrum")),
      gp: whole(pick(map, "gp", "gold")),
      pp: whole(pick(map, "pp", "platinum")),
    },
  };
}

function weaponLines(map: Map<string, string>): string {
  const lines: string[] = [];
  for (const index of ["", "1", "2", "3"]) {
    const name = pick(map, `wpnname${index}`, `weaponname${index}`);
    if (!name) continue;
    const bonus = pick(map, `wpn${index || "1"}atkbonus`, `wpn${index}atkbonus`);
    const damage = pick(map, `wpn${index || "1"}damage`, `wpn${index}damage`);
    lines.push([name, bonus, damage].filter(Boolean).join(" · "));
  }
  return lines.join("\n");
}

function foundrySheet(record: Record<string, unknown>): SheetDraft | null {
  const system = record.system;
  if (typeof system !== "object" || system === null) return null;
  const abilities = (
    system as {
      abilities?: Record<string, { value?: unknown; mod?: unknown; proficient?: unknown }>;
    }
  ).abilities;
  if (!abilities?.str || typeof abilities.str !== "object") return null;
  const map = new Map<string, string>();
  put(map, "charactername", typeof record.name === "string" ? record.name : "");
  const details = (system as { details?: Record<string, unknown> }).details ?? {};
  put(map, "race", textOf(details.race) || textOf(details.species));
  put(map, "background", textOf(details.background));
  put(map, "alignment", textOf(details.alignment));
  const level = details.level;
  put(map, "classlevel", level === undefined ? "" : `Level ${String(level)}`);
  const xp = details.xp;
  if (typeof xp === "object" && xp !== null && "value" in xp)
    put(map, "xp", String((xp as { value?: unknown }).value ?? ""));
  for (const ability of ABILITIES) {
    const row = abilities[ability.key];
    if (!row) continue;
    put(map, ability.key, String(row.value ?? ""));
    if (row.mod !== undefined) put(map, `${ability.key}mod`, String(row.mod));
    if (row.proficient)
      put(
        map,
        `st${ability.label.toLowerCase()}`,
        showMod(String(row.mod ?? ""), String(row.value ?? "")),
      );
  }
  const attributes = (system as { attributes?: Record<string, unknown> }).attributes ?? {};
  const ac = attributes.ac;
  if (typeof ac === "object" && ac !== null && "value" in ac)
    put(map, "ac", String((ac as { value?: unknown }).value ?? ""));
  const hp = attributes.hp;
  if (typeof hp === "object" && hp !== null) {
    const current = (hp as { value?: unknown }).value;
    const max = (hp as { max?: unknown }).max;
    if (max !== undefined) put(map, "hpmax", String(max));
    if (current !== undefined) put(map, "hpcurrent", String(current));
  }
  const movement = attributes.movement;
  if (typeof movement === "object" && movement !== null && "walk" in movement)
    put(map, "speed", `${String((movement as { walk?: unknown }).walk ?? "")} ft`);
  const skills =
    (
      system as {
        skills?: Record<string, { total?: unknown; mod?: unknown; proficient?: unknown }>;
      }
    ).skills ?? {};
  for (const [key, skill] of Object.entries(FOUNDRY_SKILLS)) {
    const row = skills[key];
    if (!row || !row.proficient) continue;
    put(
      map,
      key === "acr" ? "acrobatics" : skill.toLowerCase().replace(/[^a-z]/g, ""),
      String(row.total ?? row.mod ?? ""),
    );
  }
  const currency = (system as { currency?: Partial<Coins> }).currency;
  if (currency) {
    put(map, "cp", String(currency.cp ?? ""));
    put(map, "sp", String(currency.sp ?? ""));
    put(map, "ep", String(currency.ep ?? ""));
    put(map, "gp", String(currency.gp ?? ""));
    put(map, "pp", String(currency.pp ?? ""));
  }
  const items = Array.isArray(record.items) ? record.items : [];
  const classes = items
    .filter(
      (item) => item && typeof item === "object" && (item as { type?: string }).type === "class",
    )
    .map((item) =>
      `${String((item as { name?: string }).name ?? "")} ${(item as { system?: { levels?: number } }).system?.levels ?? ""}`.trim(),
    )
    .filter(Boolean);
  if (classes.length > 0) put(map, "classlevel", classes.join(", "));
  const gear = items
    .filter(
      (item) =>
        item && typeof item === "object" && (item as { type?: string }).type === "equipment",
    )
    .map((item) => String((item as { name?: string }).name ?? ""))
    .filter(Boolean)
    .slice(0, 40);
  if (gear.length > 0) put(map, "equipment", gear.join(", "));
  return bodyFromMap(map);
}

function beyondSheet(record: Record<string, unknown>): SheetDraft | null {
  if (!Array.isArray(record.stats) || typeof record.name !== "string") return null;
  const map = new Map<string, string>();
  put(map, "charactername", record.name);
  const stats = new Map(
    record.stats.flatMap((stat) => {
      if (typeof stat !== "object" || stat === null) return [];
      const id = Number((stat as { id?: unknown }).id);
      const value = (stat as { value?: unknown }).value;
      return Number.isFinite(id) ? [[id, String(value ?? "")]] : [];
    }),
  );
  const order: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];
  for (let index = 0; index < order.length; index += 1) {
    const key = order[index];
    if (!key) continue;
    put(map, key, stats.get(index + 1) ?? "");
  }
  const race = record.race;
  if (typeof race === "object" && race !== null)
    put(
      map,
      "race",
      String(
        (race as { fullName?: string; baseName?: string }).fullName ||
          (race as { baseName?: string }).baseName ||
          "",
      ),
    );
  const background = record.background;
  if (typeof background === "object" && background !== null) {
    const definition = (background as { definition?: { name?: string } }).definition;
    put(map, "background", definition?.name ?? "");
  }
  if (Array.isArray(record.classes)) {
    const classes = record.classes
      .map((row) => {
        if (typeof row !== "object" || row === null) return "";
        const definition = (row as { definition?: { name?: string }; level?: number }).definition;
        const level = (row as { level?: number }).level;
        return `${definition?.name ?? ""} ${level ?? ""}`.trim();
      })
      .filter(Boolean);
    put(map, "classlevel", classes.join(", "));
  }
  const alignment = ALIGNMENTS[Number(record.alignmentId)] ?? "";
  put(map, "alignment", alignment);
  const currencies = record.currencies;
  if (typeof currencies === "object" && currencies !== null) {
    const coins = currencies as Partial<Coins>;
    put(map, "cp", String(coins.cp ?? ""));
    put(map, "sp", String(coins.sp ?? ""));
    put(map, "ep", String(coins.ep ?? ""));
    put(map, "gp", String(coins.gp ?? ""));
    put(map, "pp", String(coins.pp ?? ""));
  }
  return bodyFromMap(map);
}

function looseSheet(record: Record<string, unknown>): SheetDraft | null {
  if (record.edition !== "2014" && typeof record.abilities !== "object") return null;
  const abilities = record.abilities;
  const map = new Map<string, string>();
  put(map, "charactername", typeof record.name === "string" ? record.name : "");
  put(map, "classlevel", typeof record.classLevel === "string" ? record.classLevel : "");
  put(map, "race", typeof record.race === "string" ? record.race : "");
  put(map, "background", typeof record.background === "string" ? record.background : "");
  put(map, "alignment", typeof record.alignment === "string" ? record.alignment : "");
  if (abilities && typeof abilities === "object") {
    for (const ability of ABILITIES) {
      const value = (abilities as Record<string, unknown>)[ability.key];
      if (typeof value === "number" || typeof value === "string")
        put(map, ability.key, String(value));
      if (typeof value === "object" && value !== null) {
        put(map, ability.key, String((value as { score?: unknown }).score ?? ""));
        put(map, `${ability.key}mod`, String((value as { modifier?: unknown }).modifier ?? ""));
      }
    }
  }
  return bodyFromMap(map);
}

function sheetFromStored(record: Record<string, unknown>): SheetDraft | null {
  if (
    record.edition !== "2014" ||
    typeof record.abilities !== "object" ||
    record.abilities === null
  )
    return null;
  const sheet = normalizeSheet({ ...record, purseId: "draft", importedAt: 0 });
  if (!sheet) return null;
  const { purseId: _purseId, importedAt: _importedAt, ...body } = sheet;
  return body;
}

export function mergeSheetBodies(
  primary: SheetDraft | null,
  extra: SheetDraft | null,
): SheetDraft | null {
  if (!primary) return extra;
  if (!extra) return primary;
  const abilities = emptyAbilities();
  for (const ability of ABILITIES) {
    const first = primary.abilities[ability.key];
    const second = extra.abilities[ability.key];
    abilities[ability.key] = {
      score: first.score || second.score,
      modifier: first.modifier || second.modifier,
    };
  }
  return {
    ...primary,
    name: primary.name || extra.name,
    race: primary.race || extra.race,
    classLevel: primary.classLevel || extra.classLevel,
    background: primary.background || extra.background,
    alignment: primary.alignment || extra.alignment,
    experience: primary.experience || extra.experience,
    abilities,
    saves: fillRecord(primary.saves, extra.saves),
    skills: primary.skills.length > 0 ? primary.skills : extra.skills,
    armorClass: primary.armorClass || extra.armorClass,
    initiative: primary.initiative || extra.initiative,
    speed: primary.speed || extra.speed,
    hitPoints: primary.hitPoints || extra.hitPoints,
    hitDice: primary.hitDice || extra.hitDice,
    proficiency: primary.proficiency || extra.proficiency,
    passivePerception: primary.passivePerception || extra.passivePerception,
    traits: primary.traits || extra.traits,
    ideals: primary.ideals || extra.ideals,
    bonds: primary.bonds || extra.bonds,
    flaws: primary.flaws || extra.flaws,
    features: primary.features || extra.features,
    proficiencies: primary.proficiencies || extra.proficiencies,
    attacks: primary.attacks || extra.attacks,
    equipment: primary.equipment || extra.equipment,
    spells: primary.spells || extra.spells,
    coins: toCopperSafe(primary.coins) > 0 ? primary.coins : extra.coins,
  };
}

function normalizeSheet(value: unknown): CharacterSheet | null {
  if (typeof value !== "object" || value === null) return null;
  const sheet = value as Partial<CharacterSheet>;
  if (sheet.edition !== "2014" || typeof sheet.purseId !== "string" || !sheet.purseId) return null;
  const abilities = emptyAbilities();
  for (const ability of ABILITIES) {
    const row = sheet.abilities?.[ability.key];
    abilities[ability.key] = {
      score:
        typeof row?.score === "string"
          ? row.score
          : row?.score !== undefined
            ? String(row.score)
            : "",
      modifier: typeof row?.modifier === "string" ? row.modifier : "",
    };
  }
  return {
    purseId: sheet.purseId,
    edition: "2014",
    importedAt: Number.isFinite(sheet.importedAt) ? Number(sheet.importedAt) : 0,
    name: text(sheet.name),
    race: text(sheet.race),
    classLevel: text(sheet.classLevel),
    background: text(sheet.background),
    alignment: text(sheet.alignment),
    experience: text(sheet.experience),
    abilities,
    saves: {
      str: text(sheet.saves?.str),
      dex: text(sheet.saves?.dex),
      con: text(sheet.saves?.con),
      int: text(sheet.saves?.int),
      wis: text(sheet.saves?.wis),
      cha: text(sheet.saves?.cha),
    },
    skills: Array.isArray(sheet.skills)
      ? sheet.skills.flatMap((skill) => {
          if (typeof skill !== "object" || skill === null) return [];
          const name = text((skill as { name?: string }).name);
          const bonus = text((skill as { bonus?: string }).bonus);
          return name && bonus ? [{ name, bonus }] : [];
        })
      : [],
    armorClass: text(sheet.armorClass),
    initiative: text(sheet.initiative),
    speed: text(sheet.speed),
    hitPoints: text(sheet.hitPoints),
    hitDice: text(sheet.hitDice),
    proficiency: text(sheet.proficiency),
    passivePerception: text(sheet.passivePerception),
    traits: text(sheet.traits),
    ideals: text(sheet.ideals),
    bonds: text(sheet.bonds),
    flaws: text(sheet.flaws),
    features: text(sheet.features),
    proficiencies: text(sheet.proficiencies),
    attacks: text(sheet.attacks),
    equipment: text(sheet.equipment),
    spells: text(sheet.spells),
    coins: {
      cp: whole(sheet.coins?.cp),
      sp: whole(sheet.coins?.sp),
      ep: whole(sheet.coins?.ep),
      gp: whole(sheet.coins?.gp),
      pp: whole(sheet.coins?.pp),
    },
  };
}

function emptyAbilities(): CharacterSheet["abilities"] {
  return {
    str: { score: "", modifier: "" },
    dex: { score: "", modifier: "" },
    con: { score: "", modifier: "" },
    int: { score: "", modifier: "" },
    wis: { score: "", modifier: "" },
    cha: { score: "", modifier: "" },
  };
}

function fillRecord(
  primary: Record<AbilityKey, string>,
  extra: Record<AbilityKey, string>,
): Record<AbilityKey, string> {
  return {
    str: primary.str || extra.str,
    dex: primary.dex || extra.dex,
    con: primary.con || extra.con,
    int: primary.int || extra.int,
    wis: primary.wis || extra.wis,
    cha: primary.cha || extra.cha,
  };
}

function pick(map: Map<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = map.get(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (value) return value;
  }
  return "";
}

function put(map: Map<string, string>, key: string, value: string) {
  const text = clean(value);
  if (text) map.set(key, text);
}

function clean(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
  if (!text || /^(off|false|undefined)$/i.test(text)) return "";
  return text;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "name" in value)
    return String((value as { name?: unknown }).name ?? "");
  return "";
}

function clip(value: string): string {
  return value.length > 4000 ? `${value.slice(0, 3999)}…` : value;
}

function whole(value: unknown): number {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function toCopperSafe(coins: Coins): number {
  return coins.cp + coins.sp * 10 + coins.ep * 50 + coins.gp * 100 + coins.pp * 1000;
}

function bag(value: unknown, key: string): unknown[] {
  if (typeof value !== "object" || value === null || !(key in value)) return [];
  const inner = (value as Record<string, unknown>)[key];
  return Array.isArray(inner) ? inner : [];
}

async function meta(id: string): Promise<unknown> {
  const db = await quireDb();
  return request(db.transaction("meta").objectStore("meta").get(id));
}

async function putMeta(value: { id: string } & Record<string, unknown>): Promise<void> {
  const db = await quireDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(value);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("The character sheet could not be saved."));
    tx.onabort = () => reject(tx.error ?? new Error("The character sheet could not be saved."));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("The character sheet could not be read."));
  });
}
