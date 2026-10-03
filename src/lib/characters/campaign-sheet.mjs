import { blankSheet, sheetSchema, abilities, skills, modifier } from "./model.mjs";

/** The character ID is the purse ID. Wallet/holdings are the financial fields of
 * this same character; stored stats never contain a second spendable balance. */
/** @param {import("./model.mjs").PlaySheet} sheet
 * @returns {import("./model.mjs").PlaySheet} */
export function statsOnly(sheet) {
  return { ...sheet, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, equipment: [] };
}
/** @param {import("../quire/sheet.ts").CharacterSheet | import("../quire/sheet.ts").SheetDraft | undefined} legacy
 * @param {string} name */
export function legacyCharacter(legacy, name) {
  const s = { ...blankSheet(), name: name || "New character", hp: 0, maxHp: 0 };
  if (!legacy) return s;
  s.species = legacy.race || "";
  s.classes = legacy.classLevel || "";
  s.level = legacyLevel(s.classes) ?? s.level;
  s.proficiency = legacyNumber(legacy.proficiency, 0, 20) ?? s.proficiency;
  if (legacy.hitDice) s.hitDice = legacy.hitDice;
  s.background = legacy.background || "";
  s.features = legacy.features || "";
  s.notes = [legacy.attacks, legacy.equipment, legacy.spells, legacy.proficiencies]
    .filter(Boolean)
    .join("\n\n");
  s.description = [legacy.traits, legacy.ideals, legacy.bonds, legacy.flaws]
    .filter(Boolean)
    .join("\n");
  for (const a of /** @type {Array<keyof typeof s.scores>} */ (abilities)) {
    const n = Number(legacy.abilities?.[a]?.score);
    if (n >= 1 && n <= 30) s.scores[a] = n;
    const save = legacy.saves?.[a];
    if (save?.trim() && Number.isFinite(Number(save)))
      s.saves[a].extra = Number(save) - modifier(s.scores[a]);
  }
  for (const row of legacy.skills || []) {
    if (!Object.hasOwn(skills, row.name)) continue;
    const total = legacyNumber(row.bonus, -100, 100);
    const key = /** @type {keyof typeof skills} */ (row.name);
    const ability = /** @type {keyof typeof s.scores} */ (skills[key]);
    if (total !== null)
      s.skills[row.name] = { rank: 0, extra: total - modifier(s.scores[ability]) };
  }
  const initiative = legacyNumber(legacy.initiative, -100, 100);
  if (initiative !== null) s.initiative = initiative - modifier(s.scores.dex);
  const hp =
    String(legacy.hitPoints || "")
      .match(/\d+/g)
      ?.map(Number) || [];
  s.hp = Math.min(9999, hp[0] || 0);
  s.maxHp = Math.max(s.hp, Math.min(9999, hp[1] || hp[0] || 0));
  if (/^\d+$/.test(legacy.armorClass)) s.ac = Math.min(99, Number(legacy.armorClass));
  if (legacy.speed) s.speed = legacy.speed;
  return s;
}
/** Read only unambiguous class levels; retain the original class text separately.
 * @param {string} text @returns {number | null} */
export function legacyLevel(text) {
  const parts = text.trim().split(/\s*(?:\/|,|\+|;)\s*/);
  const levels = parts.map((part) => {
    const match = /(?:^|[^\d])(\d{1,2})\s*$/.exec(part);
    if (!match || /\d/.test(part.slice(0, match.index))) return null;
    const n = Number(match[1]);
    return n >= 1 && n <= 20 ? n : null;
  });
  if (levels.some((n) => n === null)) return null;
  let total = 0;
  for (const n of levels) if (n !== null) total += n;
  return total >= 1 && total <= 20 ? total : null;
}
/** @param {string} text @param {number} min @param {number} max */
function legacyNumber(text, min, max) {
  if (!/^[+-]?\d+$/.test(String(text || "").trim())) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}
/** @param {import("../quire/types.ts").Purse} purse
 * @param {import("../quire/types.ts").Holding[]} holdings
 * @param {import("../quire/sheet.ts").CharacterSheet} [legacy] */
export function characterSheet(purse, holdings = [], legacy) {
  return {
    ...(purse.sheet || legacyCharacter(legacy, purse.name)),
    name: purse.name,
    portrait: purse.portrait || purse.sheet?.portrait || "",
    coins: { ...purse.coins },
    equipment: holdings
      .filter((h) => h.purseId === purse.id)
      .map((h) => ({
        id: h.id,
        name: h.name,
        kind: h.kind,
        unitCopper: h.unitCopper,
        quantity: h.quantity,
        weight: h.weight || 0,
        equipped: h.equipped || false,
        notes: h.notes,
      })),
  };
}

/** Keep the legacy editor as a partial view of the full character.
 * Fields absent from that view must never be reset to blank-sheet defaults.
 * @param {{purses: import('../quire/types.ts').Purse[], sheets: import('../quire/sheet.ts').CharacterSheet[]}} table
 * @param {{role: string, purseIds: string[]}} seat
 * @param {import('../quire/sheet.ts').CharacterSheet} incoming
 * @param {import('../quire/sheet.ts').CharacterSheet} [before]
 */
export function editLegacyCharacter(table, seat, incoming, before) {
  const p = table.purses.find((p) => p.id === incoming.purseId && p.kind === "character");
  if (!p || (seat.role !== "dm" && !seat.purseIds.includes(p.id)))
    throw Error("You do not control this character.");
  if (seat.role === "dm" && p.sheetReadOnlyForDm)
    throw Error("Only the profile owner can edit this character sheet.");
  if (before && before.purseId !== p.id) throw Error("Invalid character baseline.");
  const previous = table.sheets.find((s) => s.purseId === p.id);
  const baseline = before || previous;
  const current = statsOnly(characterSheet(p, [], previous));
  const next = structuredClone(current);
  const converted = legacyCharacter(incoming, incoming.name || p.name);
  const prior = before ? legacyCharacter(before, before.name || p.name) : null;
  const changed = (/** @type {keyof typeof incoming} */ field) =>
    baseline
      ? !same(incoming[field], baseline[field])
      : !!incoming[field] && (typeof incoming[field] !== "string" || incoming[field].trim() !== "");
  const put = (/** @type {keyof typeof next} */ field) => {
    if (prior && !same(current[field], prior[field]))
      throw Error("This character changed elsewhere. Reload before editing.");
    /** @type {any} */ (next)[field] = converted[field];
  };
  for (const [source, target] of /** @type {Array<[keyof typeof incoming, keyof typeof next]>} */ ([
    ["name", "name"],
    ["race", "species"],
    ["classLevel", "classes"],
    ["background", "background"],
    ["features", "features"],
    ["speed", "speed"],
    ["armorClass", "ac"],
    ["hitDice", "hitDice"],
  ]))
    if (changed(source)) put(target);
  if (changed("classLevel") && legacyLevel(incoming.classLevel) !== null) put("level");
  if (changed("proficiency") && legacyNumber(incoming.proficiency, 0, 20) !== null)
    put("proficiency");
  if (changed("initiative") && legacyNumber(incoming.initiative, -100, 100) !== null)
    put("initiative");
  if (changed("hitPoints")) {
    put("hp");
    put("maxHp");
  }
  for (const a of /** @type {Array<keyof typeof next.scores>} */ (abilities)) {
    if (
      baseline
        ? !same(incoming.abilities[a], baseline.abilities[a])
        : incoming.abilities[a].score.trim()
    ) {
      if (seat.role !== "dm" && converted.scores[a] !== current.scores[a])
        throw Error("Ask the DM to change ability scores.");
      if (prior && current.scores[a] !== prior.scores[a])
        throw Error("This character changed elsewhere. Reload before editing.");
      next.scores[a] = converted.scores[a];
    }
    if (baseline ? incoming.saves[a] !== baseline.saves[a] : incoming.saves[a].trim()) {
      const bonus = (/** @type {typeof current} */ sheet) =>
        modifier(sheet.scores[a]) + sheet.saves[a].rank * sheet.proficiency + sheet.saves[a].extra;
      if (prior && bonus(current) !== bonus(prior))
        throw Error("This character changed elsewhere. Reload before editing.");
      next.saves[a] = {
        rank: current.saves[a].rank,
        extra:
          bonus(converted) - modifier(next.scores[a]) - current.saves[a].rank * next.proficiency,
      };
    }
  }
  if (changed("skills")) {
    for (const row of incoming.skills) {
      if (!Object.hasOwn(skills, row.name)) continue;
      const total = legacyNumber(row.bonus, -100, 100);
      const old = baseline?.skills.find((s) => s.name === row.name);
      if (total === null || row.bonus === old?.bonus) continue;
      const a = /** @type {keyof typeof next.scores} */ (
        skills[/** @type {keyof typeof skills} */ (row.name)]
      );
      const training = next.skills[row.name] || { rank: 0, extra: 0 };
      const currentBonus =
        modifier(current.scores[a]) + training.rank * current.proficiency + training.extra;
      if (before && old && currentBonus !== legacyNumber(old.bonus, -100, 100))
        throw Error("This character changed elsewhere. Reload before editing.");
      next.skills[row.name] = {
        rank: training.rank,
        extra: total - modifier(next.scores[a]) - training.rank * next.proficiency,
      };
    }
  }
  if (
    ["traits", "ideals", "bonds", "flaws"].some((field) =>
      changed(/** @type {keyof typeof incoming} */ (field)),
    )
  )
    put("description");
  // Imported free text has no one-to-one field in the playable arrays. Retain it
  // without replacing custom notes, attacks, spells, or equipment.
  const excerpts = ["attacks", "equipment", "spells", "proficiencies"]
    .filter((field) => changed(/** @type {keyof typeof incoming} */ (field)))
    .map((field) => String(incoming[/** @type {keyof typeof incoming} */ (field)] || "").trim())
    .filter((text) => text && !next.notes.includes(text));
  if (excerpts.length) next.notes = [next.notes, ...excerpts].filter(Boolean).join("\n\n");
  p.sheet = sheetSchema.parse(statsOnly(next));
  p.name = p.sheet.name;
  p.sheetRevision = (p.sheetRevision || 0) + 1;
  table.sheets = [...table.sheets.filter((s) => s.purseId !== p.id), incoming];
}
/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a, ordered) === JSON.stringify(b, ordered);
/** @param {string} _key @param {any} value */
function ordered(_key, value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, value[k]]),
      )
    : value;
}
/** @param {import("./model.mjs").PlaySheet["equipment"]} items */
const financialItems = (items) =>
  items.map(({ id, name, kind = "item", unitCopper = 0, quantity }) => ({
    id,
    name,
    kind,
    unitCopper,
    quantity,
  }));
/** @param {import("../quire/types.ts").Coins} coins */
const value = (coins) =>
  coins.cp + coins.sp * 10 + coins.ep * 50 + coins.gp * 100 + coins.pp * 1000;

/** Mutates only a private transaction snapshot. Callers commit it atomically/CAS.
 * Compare only changed groups, so saving HP never rolls back a simultaneous purchase.
 * @param {{purses: import("../quire/types.ts").Purse[], holdings: import("../quire/types.ts").Holding[], ledger: import("../quire/types.ts").LedgerLine[], sheets?: import("../quire/sheet.ts").CharacterSheet[]}} table
 * @param {{role: string, purseIds: string[]}} seat
 * @param {{purseId: string, before: import("./model.mjs").PlaySheet, sheet: import("./model.mjs").PlaySheet}} input
 * @param {string} receipt
 */
export function editCharacter(table, seat, input, receipt, at = Date.now()) {
  const p = table.purses.find((p) => p.id === input.purseId && p.kind === "character");
  if (!p || (seat.role !== "dm" && !seat.purseIds.includes(p.id)))
    throw Error("You do not control this character.");
  const before = sheetSchema.parse(input.before),
    next = sheetSchema.parse(input.sheet);
  const current = characterSheet(
    p,
    table.holdings,
    table.sheets?.find((s) => s.purseId === p.id),
  );
  const statChange = !same(statsOnly(before), statsOnly(next));
  if (statChange && seat.role === "dm" && p.sheetReadOnlyForDm)
    throw Error(
      "Only the profile owner can edit this character sheet. The DM can manage its funds and inventory.",
    );
  const coinChange = !same(before.coins, next.coins);
  const itemChange = !same(before.equipment, next.equipment);
  const grant =
    coinChange || !same(financialItems(before.equipment), financialItems(next.equipment));
  if (grant && seat.role !== "dm")
    throw Error(
      "Only the DM can add or adjust funds and items. Use purchases, transfers or a DM-approved award.",
    );
  if (seat.role !== "dm" && before.scores.cha !== next.scores.cha)
    throw Error("Ask the DM to change Charisma used for campaign prices.");
  if (
    (statChange && !same(statsOnly(before), statsOnly(current))) ||
    (coinChange && !same(before.coins, current.coins)) ||
    (itemChange && !same(before.equipment, current.equipment))
  )
    throw Error("This character changed elsewhere. Export your draft, reload and retry.");
  if (statChange || !p.sheet) {
    p.sheet = statsOnly(statChange ? next : current);
    p.name = p.sheet.name;
    p.portrait = p.sheet.portrait || undefined;
  }
  if (coinChange) {
    if (!Number.isSafeInteger(value(next.coins))) throw Error("Coin total is too large.");
    p.coins = next.coins;
  }
  if (itemChange) {
    const ids = new Set();
    const owned = table.holdings.filter((h) => h.purseId === p.id);
    const updated = next.equipment.map((item, i) => {
      const old = item.id ? owned.find((h) => h.id === item.id) : undefined;
      if (item.id && !old) throw Error("Unknown inventory item. Reload the sheet.");
      const id = old?.id || `${receipt}-item-${i}`;
      if (ids.has(id)) throw Error("Duplicate inventory item.");
      ids.add(id);
      return {
        ...old,
        ...item,
        id,
        purseId: p.id,
        kind: item.kind || "item",
        unitCopper: item.unitCopper || 0,
      };
    });
    table.holdings = [...table.holdings.filter((h) => h.purseId !== p.id), ...updated];
  }
  p.sheetRevision = (p.sheetRevision || 0) + 1;
  if (grant)
    table.ledger.push({
      id: receipt + "-adjustment",
      at,
      purseId: p.id,
      shopId: null,
      transactionType: "adjustment",
      copper: value(p.coins) - value(current.coins),
      summary:
        "DM character-sheet adjustment: " +
        (coinChange ? "funds" : "") +
        (itemChange ? " inventory" : ""),
    });
  return characterSheet(p, table.holdings);
}
