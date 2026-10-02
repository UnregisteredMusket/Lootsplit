import type { CatalogItem, ItemCategory } from "./types.ts";
export const OPEN5E_KINDS = [
  { value: "creatures", label: "Creatures" },
  { value: "items", label: "Equipment" },
  { value: "magicitems", label: "Magic items" },
  { value: "spells", label: "Spells" },
  { value: "conditions", label: "Conditions" },
] as const;
export type OpenKind = (typeof OPEN5E_KINDS)[number]["value"];
export type OpenEdition = "srd-2014" | "srd-2024";
export type OpenQuery = {
  kind: OpenKind;
  edition: OpenEdition;
  query: string;
  page: number;
};
export type OpenEntry = {
  key: string;
  name: string;
  description: string;
  facts: string[];
  copper: number | null;
  category: ItemCategory;
  kind: OpenKind;
  edition: OpenEdition;
  source: string;
  attribution: string;
  url: string;
};
export type OpenPage = { entries: OpenEntry[]; count: number; more: boolean };
export function openQuery(input: OpenQuery): OpenQuery {
  if (
    !OPEN5E_KINDS.some((k) => k.value === input.kind) ||
    !["srd-2014", "srd-2024"].includes(input.edition)
  )
    throw new Error("Choose a supported source and section.");
  if (
    typeof input.query !== "string" ||
    input.query.length > 100 ||
    !Number.isInteger(input.page) ||
    input.page < 1 ||
    input.page > 1000
  )
    throw new Error("Invalid search.");
  return { ...input, query: input.query.trim() };
}
export function openUrl(input: OpenQuery) {
  const q = openQuery(input);
  const url = new URL(`https://api.open5e.com/v2/${q.kind}/`);
  url.search = new URLSearchParams({
    document__key__in: q.kind === "conditions" ? "core" : q.edition,
    name__icontains: q.query,
    limit: q.kind === "conditions" ? "100" : "12",
    page: String(q.page),
    ordering: "name",
  }).toString();
  return url.toString();
}
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown) => (typeof v === "string" ? v : "");
const name = (v: unknown) => text(record(v).name) || text(v);
export function normalizeOpenPage(payload: unknown, q: OpenQuery): OpenPage {
  const data = record(payload);
  if (!Array.isArray(data.results) || typeof data.count !== "number")
    throw new Error("Open5e returned an unexpected response. Try again later.");
  const entries = data.results.flatMap((value): OpenEntry[] => {
    const r = { ...record(value) };
    let doc = record(r.document);
    if (q.kind === "conditions" && !text(r.name).toLowerCase().includes(q.query.toLowerCase()))
      return [];
    // Conditions are shared concepts; only their per-source descriptions belong to an edition.
    if (q.kind === "conditions" && doc.key === "core") {
      const description = Array.isArray(r.descriptions)
        ? r.descriptions.map(record).find((d) => d.document === q.edition)
        : undefined;
      if (!description) return [];
      r.desc = text(description.desc);
      doc = {
        key: q.edition,
        name: `System Reference Document ${q.edition === "srd-2014" ? "5.1" : "5.2"}`,
      };
    }
    if (doc.key !== q.edition || !text(r.key) || !text(r.name)) return [];
    const version = q.edition === "srd-2014" ? "5.1" : "5.2";
    const attribution = `This work includes material from the System Reference Document ${version} (“SRD ${version}”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD ${version} is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode. Retrieved through Open5e; formatting adapted. Prices and categories may be customized in Lootsplit.`;
    const categoryName = name(r.category).toLowerCase();
    const category: ItemCategory = /weapon|armor/.test(categoryName)
      ? "smith"
      : /potion/.test(categoryName)
        ? "apothecary"
        : /ring|gem|jewel/.test(categoryName)
          ? "jewels"
          : /scroll/.test(categoryName)
            ? "scribe"
            : q.kind === "magicitems"
              ? "curios"
              : "general";
    const cost =
      (typeof r.cost === "string" && r.cost.trim() !== "") || typeof r.cost === "number"
        ? Number(r.cost)
        : NaN;
    // Magic-item zeroes are often placeholders rather than an actual selling price.
    const copper =
      Number.isFinite(cost) &&
      cost >= 0 &&
      Number.isSafeInteger(Math.round(cost * 100)) &&
      !(q.kind === "magicitems" && cost === 0)
        ? Math.round(cost * 100)
        : null;
    const facts: string[] = [];
    for (const [label, v] of [
      ["Type", name(r.category)],
      ["Rarity", name(r.rarity)],
      ["Weight", r.weight == null ? "" : `${r.weight} ${text(r.weight_unit)}`],
      ["School", name(r.school)],
      ["Casting time", name(r.casting_time)],
      ["Range", text(r.range_text) || name(r.range)],
      ["Duration", name(r.duration)],
    ] as const)
      if (v) facts.push(`${label}: ${v}`);
    if (typeof r.level === "number") facts.push(`Spell level: ${r.level}`);
    if (q.kind === "spells") {
      const components = [r.verbal ? "V" : "", r.somatic ? "S" : "", r.material ? "M" : ""]
        .filter(Boolean)
        .join(", ");
      if (components)
        facts.push(
          `Components: ${components}${text(r.material_specified) ? ` (${r.material_specified})` : ""}`,
        );
      if (r.concentration) facts.push("Concentration required");
      if (r.ritual) facts.push("Can be cast as a ritual");
      if (Array.isArray(r.classes)) facts.push(`Classes: ${r.classes.map(name).join(", ")}`);
      if (text(r.reaction_condition)) facts.push(`Reaction: ${r.reaction_condition}`);
    }
    let creatureText = "";
    if (q.kind === "creatures") {
      for (const [label, value] of [
        ["Type", name(r.type)],
        ["Size", name(r.size)],
        ["Armor class", r.armor_class],
        ["Hit points", r.hit_points],
        ["Challenge rating", r.challenge_rating],
        ["XP", r.experience_points],
      ] as const) {
        if (value !== undefined && value !== null && value !== "") facts.push(`${label}: ${value}`);
      }
      creatureText = ["traits", "actions", "bonus_actions", "reactions", "legendary_actions"]
        .flatMap((key) =>
          Array.isArray(r[key])
            ? r[key].map((value: unknown) => {
                const action = record(value);
                return `${text(action.name)}: ${text(action.desc)}`;
              })
            : [],
        )
        .join("\n\n");
    }
    if (r.requires_attunement)
      facts.push(
        `Requires attunement${text(r.attunement_detail) ? `: ${r.attunement_detail}` : ""}`,
      );
    const weapon = record(r.weapon),
      armor = record(r.armor);
    if (weapon.damage_dice)
      facts.push(`Damage: ${text(weapon.damage_dice)} ${name(weapon.damage_type)}`);
    if (armor.ac_display) facts.push(`Armor class: ${text(armor.ac_display)}`);
    const propertyText = Array.isArray(weapon.properties)
      ? weapon.properties
          .map((p) => {
            const prop = record(p),
              detail = record(prop.property);
            return `${name(detail)}${prop.detail ? ` (${prop.detail})` : ""}: ${text(detail.desc)}`;
          })
          .join("\n\n")
      : "";
    return [
      {
        key: text(r.key),
        name: text(r.name),
        description: [text(r.desc), text(r.higher_level), propertyText, creatureText]
          .filter(Boolean)
          .join("\n\n"),
        facts,
        copper,
        category,
        kind: q.kind,
        edition: q.edition,
        source: text(doc.name),
        attribution,
        url: `https://api.open5e.com/v2/${q.kind}/${encodeURIComponent(text(r.key))}/`,
      },
    ];
  });
  return {
    entries,
    count: q.kind === "conditions" ? entries.length : data.count,
    more: q.kind !== "conditions" && typeof data.next === "string",
  };
}
export function openCatalogItem(
  entry: OpenEntry,
  price: number,
  category: ItemCategory,
): CatalogItem {
  if (!["items", "magicitems"].includes(entry.kind) || !Number.isSafeInteger(price) || price < 0)
    throw new Error("Enter a valid item price.");
  const edition = entry.edition === "srd-2014" ? "2014" : "2024";
  return {
    id: `open5e:${entry.kind}:${entry.key}`,
    name: `${entry.name} (${edition})`,
    category,
    rarity: entry.kind === "magicitems" ? "magic" : "common",
    baseCopper: price,
    origin: "open5e",
    service: false,
    notes: [
      entry.description,
      ...entry.facts,
      `Source: ${entry.source}`,
      entry.url,
      entry.attribution,
    ].join("\n\n"),
  };
}
