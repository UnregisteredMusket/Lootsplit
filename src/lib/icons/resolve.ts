import data from "./catalog.json" with { type: "json" };
export type IconEntry = {
  id?: string;
  key?: string;
  sourceKey?: string;
  catalogId?: string;
  kind?: string;
  name?: string;
  category?: string;
  school?: string;
  type?: string;
  source?: string;
  notes?: string;
  facts?: string[];
};
type Spec = { icon: string; category: string };
type Catalog = {
  records: Record<string, Spec>;
  names: Record<string, Record<string, Spec>>;
  categories: Record<string, Record<string, string>>;
  ui: Record<string, string>;
  defaults: Record<string, string>;
  rules: Record<string, string[][]>;
};
const catalog: Catalog = data;
const get = <T>(map: Record<string, T> | undefined, key: string): T | undefined =>
  map && Object.hasOwn(map, key) ? map[key] : undefined;
const normalize = (v = "") =>
  v
    .toLowerCase()
    .replace(/\s*\((?:2014|2024)\)\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const colors: Record<string, string> = {
  abjuration: "#81b7ef",
  conjuration: "#6bd7be",
  divination: "#e8c978",
  enchantment: "#e59fcb",
  evocation: "#f39b72",
  illusion: "#bca4ee",
  necromancy: "#aac77c",
  transmutation: "#e5b17f",
  weapon: "#edaa7b",
  armor: "#95bde3",
  shield: "#95bde3",
  ammunition: "#cbaa82",
  potion: "#dd8fb9",
  poison: "#acd36e",
  ring: "#eac675",
  jewelry: "#eac675",
  gem: "#75d9d0",
  scroll: "#dac6a0",
  staff: "#bf9eec",
  wand: "#bf9eec",
  "wondrous-item": "#c7a0ee",
  tools: "#aac4d6",
  "adventuring-gear": "#ceb18a",
  aberration: "#b89adf",
  beast: "#b5c989",
  celestial: "#f1d284",
  construct: "#a6bacb",
  dragon: "#ed9c7b",
  elemental: "#78cddc",
  fey: "#91d0b7",
  fiend: "#e79083",
  giant: "#ceb18a",
  humanoid: "#d7b789",
  monstrosity: "#b8a1d8",
  ooze: "#aaca74",
  plant: "#93c98c",
  undead: "#bdacca",
  fire: "#f39b72",
  cold: "#8bd7ef",
  lightning: "#e6d280",
  acid: "#b5d87f",
  radiant: "#f1d284",
  psychic: "#cc9ee8",
  thunder: "#b5acdf",
  necrotic: "#aac77c",
  force: "#b7a5ed",
};
const shops: Record<string, string> = {
  provisions: "trade-good",
  smith: "weapon",
  cloth: "adventuring-gear",
  apothecary: "potion",
  inn: "service",
  general: "adventuring-gear",
  curios: "wondrous-item",
  stable: "mount",
  scribe: "scroll",
  jewels: "jewelry",
  mixed: "trade-good",
};
const groups: Record<string, string> = {
  spells: "spellSchools",
  creatures: "creatureTypes",
  items: "itemCategories",
  magicitems: "itemCategories",
  conditions: "conditions",
  damage: "damageTypes",
};
function result(icon: string, category = "", matchedBy = "category") {
  return {
    icon,
    src: `/icons/game-icons/${icon}`,
    color: get(colors, category) || "#ddbd7d",
    category,
    matchedBy,
  };
}
/** Visual matching only. Never uses names to modify identities, prices, or rules. */
export function resolveFantasyIcon(
  entry: IconEntry = {},
  options: { categoryOnly?: boolean; ui?: string } = {},
) {
  if (options.ui)
    return result(get(catalog.ui, options.ui) || catalog.defaults.items, "", "navigation");
  let kind = entry.kind === "item" || !entry.kind ? "items" : entry.kind;
  let key = entry.key || entry.sourceKey || "";
  const identity = entry.catalogId || entry.id || "";
  const id = /^open5e:(items|magicitems|spells|creatures):(.+)$/.exec(identity);
  if (id) {
    kind = id[1];
    key = id[2];
  }
  // Existing spell imports and holdings already retain the original source URL.
  if (!key) {
    const source =
      /api\.open5e\.com\/v2\/(items|magicitems|spells|creatures)\/([a-zA-Z0-9_-]+)/.exec(
        `${entry.source || ""}\n${entry.notes || ""}`,
      );
    if (source) {
      kind = source[1];
      key = source[2];
    }
  }
  let spec = get(catalog.records, `${kind}:${key}`);
  const facts = entry.facts || [];
  const fact = (label: string) =>
    facts.find((f) => f.startsWith(`${label}: `))?.slice(label.length + 2) || "";
  let category = normalize(
    kind === "spells"
      ? entry.school || fact("School")
      : kind === "creatures"
        ? entry.type || fact("Type")
        : kind === "conditions"
          ? entry.key || entry.name
          : entry.category || fact("Type"),
  ).replaceAll(" ", "-");
  category = spec?.category || get(shops, category) || category;
  if (!options.categoryOnly && spec) return result(spec.icon, spec.category, "source");
  const n = normalize(entry.name);
  // The name index only chooses artwork for legacy/custom records, never an SRD identity.
  if (!options.categoryOnly && n) {
    spec =
      get(catalog.names[kind], n) ||
      (kind === "items" ? get(catalog.names.magicitems, n) : undefined);
    if (spec) return result(spec.icon, spec.category, "name");
    const rules = get(catalog.rules, kind === "magicitems" ? "items" : kind) || [];
    const match = rules.find(([term]) => ` ${n} `.includes(` ${normalize(term)} `));
    if (match) return result(match[1], category, "family");
  }
  category ||= spec?.category || "";
  const group = get(groups, kind) || "itemCategories";
  return result(
    get(catalog.categories[group], category) ||
      get(catalog.defaults, kind) ||
      catalog.defaults.items,
    category,
  );
}
