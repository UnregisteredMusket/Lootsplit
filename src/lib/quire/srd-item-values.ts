// Matches equipment names (from an imported character sheet) against the bundled SRD price
// list built from Open5e (scripts/build-srd-item-values.mjs). Only confident matches are used:
// the same name after spelling normalization, the name without a parenthetical, or the same
// words in another order. A name that maps to two different prices is never guessed.
import type { PlaySheet } from "@/lib/characters/model.mjs";

export type SrdRow = [
  name: string,
  edition: "2014" | "2024",
  copper: number,
  weightLb: number,
  kind: string,
];
export type SrdMatch = {
  name: string;
  edition: "2014" | "2024";
  /** Price of one of the imported units, in whole copper. */
  copper: number;
  /** Weight of one imported unit in pounds (0 when the SRD gives none). */
  weightLb: number;
  /** "price": the SRD's listed cost; "rarity": SRD 5.2.1 magic item rarity value. */
  basis: "price" | "rarity";
  rarity?: string;
};
type Equipment = PlaySheet["equipment"][number];

const SINGULAR_EXCEPTIONS = new Set([
  "glass",
  "gas",
  "dress",
  "mass",
  "boss",
  "chess",
  "bless",
  "bliss",
  "pass",
  "brass",
  "moss",
  "class",
  "grass",
  "compass",
  "lens",
  "caltrops",
  "pants",
  "tongs",
  "manacles",
  "robes",
  "goggles",
  "scales",
  "bellows",
]);
function singular(word: string) {
  if (
    word.length <= 3 ||
    SINGULAR_EXCEPTIONS.has(word) ||
    word.endsWith("ss") ||
    word.endsWith("us")
  )
    return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("axes")) return word.slice(0, -1); // handaxes, greataxes
  if (/(ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ves") && word.length > 5) return word.slice(0, -3) + "f"; // knives → knif (both sides agree)
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}
const ARTICLE = /^(?:an?|the|some|one)\s+/;
// "flask of oil", "a pouch of caltrops" → the thing itself.
const MEASURE = /^\d+\s*(?:feet|foot|ft|days?)\s+of\s+/;
const CONTAINER =
  /^(?:flask|vial|bottle|bag|pouch|set|pair|day|days|bundle|quiver|case|jar|pot|piece|sheet|box|stick|ball)s?\s+of\s+/;
/** Lower-case words with apostrophes, punctuation and plurals evened out; "+1" bonuses last. */
export function srdKey(raw: string) {
  let s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
  s = s.replace(ARTICLE, "").replace(MEASURE, "").replace(CONTAINER, "");
  const words = s.split(" ").filter(Boolean);
  const bonus = words.filter((w) => /^\+\d$/.test(w));
  const rest = words.filter((w) => !/^\+\d$/.test(w)).map(singular);
  return [...rest, ...bonus].join(" ");
}
const withoutParens = (name: string) =>
  name
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const sorted = (key: string) => key.split(" ").sort().join(" ");
/** Bundles priced per pack ("Arrows (20)", "Blowgun Needles (50)"); imported quantities count single pieces. */
const AMMO_BUNDLE =
  /^(arrows?|bolts?|crossbow bolts?|bullets?|sling bullets?|needles?|blowgun needles?|firearm bullets?)\s*\((\d+)\)$/i;

/** Everyday names for SRD items that the SRD only lists by a specific form (all the same price). */
const ALIASES: Record<string, string> = {
  "holy symbol": "Amulet",
  "belt pouch": "Pouch",
};
type Index = Map<string, SrdRow | null>; // null: two different prices share the key
export type SrdIndex = { byEdition: Record<"2014" | "2024", Index[]> };

export function buildSrdIndex(rows: SrdRow[]): SrdIndex {
  const byEdition = {
    "2014": [new Map(), new Map(), new Map()],
    "2024": [new Map(), new Map(), new Map()],
  } as SrdIndex["byEdition"];
  const put = (index: Index, key: string, row: SrdRow) => {
    if (!key) return;
    const prior = index.get(key);
    if (prior === undefined) index.set(key, row);
    else if (prior && (prior[2] !== row[2] || prior[3] !== row[3])) index.set(key, null);
  };
  for (const row of rows) {
    const [name, edition] = row;
    const tiers = byEdition[edition];
    if (!tiers) continue;
    const full = srdKey(name);
    // A "+1" parenthetical is the item itself ("Longsword (+1)"), never an optional detail.
    const base = /\(\+\d\)/.test(name) ? full : srdKey(withoutParens(name));
    put(tiers[0], full, row);
    // "Studded leather" for "Studded Leather Armor".
    if (/ armor$/.test(base)) put(tiers[1], base.replace(/ armor$/, ""), row);
    for (const [alias, target] of Object.entries(ALIASES))
      if (name === target) put(tiers[1], alias, row);
    // "Alchemist's Supplies (50 GP)", "Rope, hempen (50 feet)", "Arrow (bow)": also reachable by the base name.
    if (base !== full) put(tiers[1], base, row);
    put(tiers[2], sorted(full), row);
    if (base !== full) put(tiers[2], sorted(base), row);
  }
  return { byEdition };
}

function toMatch(row: SrdRow): SrdMatch {
  const [name, edition, copper, weightLb, kind] = row;
  const bundle = name.match(AMMO_BUNDLE);
  const per = bundle ? Number(bundle[2]) : 1;
  return {
    name,
    edition,
    copper: per > 1 ? Math.max(1, Math.round(copper / per)) : copper,
    weightLb: per > 1 ? Math.round((weightLb / per) * 1000) / 1000 : weightLb,
    basis: kind.startsWith("m:") ? "rarity" : "price",
    ...(kind.startsWith("m:") ? { rarity: kind.slice(2) } : {}),
  };
}

/** Finds the SRD entry for an item name, preferring the sheet's own edition. */
export function matchSrdItem(
  index: SrdIndex,
  name: string,
  edition: string = "2014",
): SrdMatch | null {
  const first: "2014" | "2024" = edition === "2024" ? "2024" : "2014";
  const second = first === "2014" ? "2024" : "2014";
  const key = srdKey(name),
    base = srdKey(withoutParens(name));
  if (!key) return null;
  for (const ed of [first, second] as const) {
    const [exact, bases, words] = index.byEdition[ed];
    for (const [tier, k] of [
      [exact, key],
      [exact, base],
      [bases, key],
      [bases, base],
      [words, sorted(key)],
      [words, sorted(base)],
    ] as const) {
      const hit = tier.get(k);
      if (hit) return toMatch(hit); // null: two prices share this key, so try a stricter source
    }
  }
  return null;
}

export type SrdValuation = {
  equipment: Equipment[];
  valued: {
    item: string;
    srd: string;
    edition: "2014" | "2024";
    copper: number;
    basis: SrdMatch["basis"];
  }[];
  unmatched: string[];
};

/**
 * Gives each unpriced item its SRD value (and weight, when it has none). Values a person
 * already entered are kept. "20 arrows" style counts become the quantity when the rest of the
 * name is an SRD item.
 */
export function valueEquipment(
  index: SrdIndex,
  equipment: Equipment[],
  edition?: string,
): SrdValuation {
  const valued: SrdValuation["valued"] = [];
  const unmatched: string[] = [];
  const next = equipment.map((item) => {
    if ((item.unitCopper || 0) > 0 || item.kind === "property") return item;
    let name = item.name,
      quantity = item.quantity;
    // "20 arrows": the count is the quantity (checked first, so it never matches "Arrows (20)").
    const counted = quantity === 1 ? name.match(/^(\d{1,4})\s+(.+)$/) : null;
    let match = counted && Number(counted[1]) > 0 ? matchSrdItem(index, counted[2], edition) : null;
    if (match && counted) {
      name = counted[2].trim();
      quantity = Number(counted[1]);
    } else match = matchSrdItem(index, name, edition);
    if (!match) {
      unmatched.push(item.name);
      return item;
    }
    valued.push({
      item: item.name,
      srd: match.name,
      edition: match.edition,
      copper: match.copper,
      basis: match.basis,
    });
    const source = `SRD ${match.edition === "2014" ? "5.1" : "5.2"} "${match.name}"${
      match.basis === "rarity" ? ` (${match.rarity} magic item value)` : ""
    }, via Open5e`;
    return {
      ...item,
      name,
      quantity,
      unitCopper: match.copper,
      weight: item.weight > 0 ? item.weight : match.weightLb,
      notes: [item.notes, `Value from ${source}.`].filter(Boolean).join(" · "),
    };
  });
  return { equipment: next, valued, unmatched };
}

let loaded: Promise<SrdIndex> | undefined;
/** The bundled list is loaded on first use so it stays out of the main bundle. */
export function loadSrdIndex() {
  loaded ??= import("./srd-item-values.json").then((m) =>
    buildSrdIndex((m.default ?? m).rows as SrdRow[]),
  );
  return loaded;
}
