// Builds src/lib/quire/srd-item-values.json, the bundled price list that imported
// character-sheet equipment is matched against (src/lib/quire/srd-item-values.ts).
// Source: Open5e v2 (https://api.open5e.com), SRD 5.1 ("srd-2014") and SRD 5.2 ("srd-2024")
// equipment and magic items, CC-BY-4.0 (credited in src/lib/website/resources.ts).
// The list is bundled rather than fetched at import time so imports work offline and
// give the same answer every time. Refresh with: node scripts/build-srd-item-values.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SRD 5.2.1 "Magic Item Rarity" values in gold pieces (Artifact: priceless, so no value).
// Consumables (potions, scrolls, ammunition) are worth half (SRD 5.2.1). The SRD 5.1 has no
// magic item prices, so SRD 5.1 magic items use the same table.
export const RARITY_GP = {
  common: 100,
  uncommon: 400,
  rare: 4000,
  "very rare": 40000,
  legendary: 200000,
};
const CONSUMABLE = /^(potion|scroll|ammunition)$/i;

/** @param {any} r @param {"2014"|"2024"} edition @param {"gear"|"magic"} kind */
export function srdRow(r, edition, kind) {
  const name = String(r.name || "").trim();
  if (!name) return null;
  const cost = r.cost == null || r.cost === "" ? NaN : Number(r.cost);
  const weight = r.weight == null || r.weight === "" ? NaN : Number(r.weight);
  const lb =
    Number.isFinite(weight) && weight > 0 && /^lb/i.test(String(r.weight_unit || "lb"))
      ? weight
      : 0;
  const category = String(r.category?.name || "");
  const rarity = String(r.rarity?.name || "").toLowerCase();
  let copper = Number.isFinite(cost) && cost > 0 ? Math.round(cost * 100) : 0;
  let basis = "price";
  if (!copper && kind === "magic" && RARITY_GP[rarity]) {
    copper = RARITY_GP[rarity] * 100 * (CONSUMABLE.test(category) ? 0.5 : 1);
    basis = "rarity";
  }
  if (!copper) return null;
  return [
    name,
    edition,
    copper,
    lb,
    kind === "magic" ? (basis === "rarity" ? `m:${rarity}` : "m") : "g",
  ];
}

async function all(kind, doc) {
  const out = [];
  for (
    let url = `https://api.open5e.com/v2/${kind}/?document__key__in=${doc}&limit=500&ordering=name`;
    url;
  ) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw Error(`Open5e ${kind} ${doc}: HTTP ${res.status}`);
    const page = await res.json();
    out.push(...page.results);
    url = page.next;
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = [];
  for (const [doc, edition] of [
    ["srd-2014", "2014"],
    ["srd-2024", "2024"],
  ])
    for (const [kind, k] of [
      ["items", "gear"],
      ["magicitems", "magic"],
    ])
      for (const r of await all(kind, doc)) {
        const row = srdRow(r, edition, k);
        if (row) rows.push(row);
      }
  rows.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const file = fileURLToPath(new URL("../src/lib/quire/srd-item-values.json", import.meta.url));
  writeFileSync(
    file,
    JSON.stringify({
      source:
        "Open5e v2 (api.open5e.com): SRD 5.1 and SRD 5.2 equipment and magic items, CC-BY-4.0",
      fields: ["name", "edition", "copper", "weightLb", "kind"],
      rows,
    }) + "\n",
  );
  console.log(`Wrote ${rows.length} SRD item values to ${file}`);
}
