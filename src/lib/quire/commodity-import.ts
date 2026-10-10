import { z } from "zod";
import { commoditySchema, type Commodity, type TradeEconomy } from "./trade-economy-schema.ts";
import { canonicalJson } from "./canonical-json.ts";
import { parseDelimited } from "./market-name-import.ts";

export const commodityImportRowsSchema = z.array(commoditySchema).min(1).max(500);
export const commodityPackSchema = z
  .object({ version: z.literal(1), commodities: commodityImportRowsSchema })
  .strict();
const columns = [
  "id",
  "name",
  "unit",
  "category",
  "baseCopper",
  "weight",
  "description",
  "active",
  "materialKey",
];

export function parseCommodityImport(text: string): Commodity[] {
  if (text.length > 512000) throw Error("Import at most 512,000 characters at a time.");
  const source = text.replace(/^\uFEFF/, "").trim();
  if (!source) throw Error("Paste commodities or choose a JSON, CSV or TSV file first.");
  let rows: unknown;
  if (source.startsWith("[") || source.startsWith("{")) {
    let data: unknown;
    try {
      data = JSON.parse(source);
    } catch {
      throw Error("The commodity JSON is not valid.");
    }
    rows = Array.isArray(data) ? data : commodityPackSchema.parse(data).commodities;
  } else {
    const delimiter = source.split(/\r?\n/)[0].includes("\t") ? "\t" : ",";
    const [header, ...records] = parseDelimited(source, delimiter);
    if (
      !header ||
      new Set(header).size !== header.length ||
      header.some((h) => !columns.includes(h))
    )
      throw Error(
        "Use unique commodity column headers: id, name, unit, category, baseCopper, weight, description, active, materialKey.",
      );
    if (["id", "name", "unit", "category", "baseCopper", "weight"].some((h) => !header.includes(h)))
      throw Error("Include id, name, unit, category, baseCopper and weight columns.");
    rows = records.map((cells, i) => {
      if (cells.length !== header.length)
        throw Error(`Row ${i + 2}: expected ${header.length} columns.`);
      const row: Record<string, unknown> = Object.fromEntries(header.map((h, j) => [h, cells[j]]));
      for (const key of ["baseCopper", "weight"]) {
        if (!/^\d+(?:\.\d+)?$/.test(String(row[key])))
          throw Error(`Row ${i + 2}: ${key} must be a nonnegative number.`);
        row[key] = Number(row[key]);
      }
      if (row.active === undefined || row.active === "") row.active = true;
      else if (row.active === "true" || row.active === "false") row.active = row.active === "true";
      else throw Error(`Row ${i + 2}: active must be true or false.`);
      if (row.materialKey === "") delete row.materialKey;
      return row;
    });
  }
  const checked = commodityImportRowsSchema.parse(rows);
  if (new Set(checked.map((c) => c.id)).size !== checked.length)
    throw Error("Commodity keys must be unique within the import.");
  return checked;
}

export const commodityImportFingerprint = (economy: Pick<TradeEconomy, "commodities">) =>
  canonicalJson([...economy.commodities].sort((a, b) => a.id.localeCompare(b.id)));

/** Add definitions only. Never replace existing goods, offers, stock, wallets or history. */
export function previewCommodityImport(
  economy: Pick<TradeEconomy, "commodities">,
  raw: Commodity[],
) {
  const rows = commodityImportRowsSchema.parse(raw);
  const existing = new Map(economy.commodities.map((c) => [c.id, c]));
  if (new Set(rows.map((c) => c.id)).size !== rows.length)
    throw Error("Commodity keys must be unique within the import.");
  const additions: Commodity[] = [],
    skipped: Commodity[] = [];
  for (const row of rows) {
    const prior = existing.get(row.id);
    if (!prior) additions.push(row);
    else if (canonicalJson(prior) === canonicalJson(row)) skipped.push(row);
    else
      throw Error(
        `Commodity key "${row.id}" already has a different definition. Keep the existing good or choose a new key before importing.`,
      );
  }
  if (economy.commodities.length + additions.length > 500)
    throw Error("A campaign supports at most 500 commodity definitions.");
  return { before: commodityImportFingerprint(economy), additions, skipped };
}
