import { blankSheet, sheetSchema, abilities, modifier } from "./model.mjs";

/** The character ID is the purse ID. Wallet/holdings are the financial fields of
 * this same character; stored stats never contain a second spendable balance. */
/** @param {import("./model.mjs").PlaySheet} sheet */
export function statsOnly(sheet) {
  return { ...sheet, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, equipment: [] };
}
/** @param {import("../quire/sheet.ts").CharacterSheet | undefined} legacy
 * @param {string} name */
export function legacyCharacter(legacy, name) {
  const s = { ...blankSheet(), name: name || "New character", hp: 0, maxHp: 0 };
  if (!legacy) return s;
  s.species = legacy.race || "";
  s.classes = legacy.classLevel || "";
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
