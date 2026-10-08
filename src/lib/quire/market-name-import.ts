import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";
import { locationLabel, readMarketLocations, type MarketLocations } from "./shop-locations.ts";
import type { Shop } from "./types.ts";

export const IMPORT_NAME_KINDS = ["region", "city", "town", "area", "shop"] as const;
export type ImportNameKind = (typeof IMPORT_NAME_KINDS)[number];
const name = z.string().trim().min(1).max(160);
const place = z.object({ kind: z.enum(["region", "city", "town", "area"]), name });
export const marketNameRowSchema = z.object({
  kind: z.enum(IMPORT_NAME_KINDS),
  name,
  parentId: z.string().min(1).max(150).nullable(),
  path: z.array(place).max(3),
});
export const marketNameRowsSchema = z.array(marketNameRowSchema).min(1).max(500);
export type MarketNameRow = z.infer<typeof marketNameRowSchema>;
const key = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/** Only names and ancestry affect this additive preview; images, finances and stock stay live. */
export function marketNameFingerprint(market: MarketLocations, shops: Shop[]): string {
  return canonicalJson({
    locations: market.locations
      .map(({ id, kind, name, parentId }) => ({ id, kind, name, parentId }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    shops: shops
      .map(({ id, name, locationId }) => ({ id, name, locationId: locationId ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

/** Strict quoted CSV/TSV, including escaped quotes, CRLF and embedded line breaks. */
function delimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    endedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        endedQuote = true;
      } else field += c;
    } else if (c === '"') {
      if (field.trim() || endedQuote)
        throw Error("A quote must start a field. Use doubled quotes inside a quoted name.");
      field = "";
      quoted = true;
    } else if (c === delimiter || c === "\n" || c === "\r") {
      row.push(field.trim());
      field = "";
      endedQuote = false;
      if (c !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else {
      if (endedQuote && c.trim()) throw Error("Unexpected text after a quoted field.");
      if (!endedQuote) field += c;
    }
  }
  if (quoted) throw Error("A quoted field is unfinished.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function hierarchyRow(value: unknown, index: number): MarketNameRow {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`Row ${index}: use an object with region, city, town, area or shop names.`);
  const record = value as Record<string, unknown>;
  const entries: { kind: ImportNameKind; name: string }[] = [];
  for (const [column, value] of Object.entries(record)) {
    if (!IMPORT_NAME_KINDS.includes(column as ImportNameKind))
      throw Error(`Row ${index}: unknown column "${column}".`);
    if (typeof value !== "string" && value !== null)
      throw Error(`Row ${index}: names must be text.`);
  }
  if (record.city && record.town) throw Error(`Row ${index}: choose a city or a town, not both.`);
  for (const kind of IMPORT_NAME_KINDS) {
    const value = record[kind];
    if (typeof value === "string" && value.trim()) entries.push({ kind, name: value.trim() });
  }
  const last = entries.pop();
  if (!last) throw Error(`Row ${index}: enter at least one name.`);
  return { ...last, parentId: null, path: entries as MarketNameRow["path"] };
}

export function parseMarketNames(
  text: string,
  kind: ImportNameKind,
  parentId: string | null,
  format = "auto",
): MarketNameRow[] {
  if (text.length > 128000) throw Error("Import up to 128,000 characters at a time.");
  const source = text.replace(/^\uFEFF/, "").trim();
  if (!source) throw Error("Paste names or choose a file first.");
  let rows: MarketNameRow[];
  if (source.startsWith("[") || format === "json") {
    let data: unknown;
    try {
      data = JSON.parse(source);
    } catch {
      throw Error("The JSON file is not valid. Use an array of names or location rows.");
    }
    if (!Array.isArray(data)) throw Error("Use a JSON array.");
    rows = data.map((row, i) =>
      typeof row === "string" ? { kind, name: row, parentId, path: [] } : hierarchyRow(row, i + 1),
    );
  } else {
    const first = source.split(/\r?\n/, 1)[0];
    const delimiter = first.includes("\t") ? "\t" : ",";
    const header = first
      .split(delimiter)
      .map((column) => column.trim().replace(/^"|"$/g, "").toLowerCase());
    if (source.startsWith("{")) throw Error("Use a JSON array of names or location rows.");
    const structured =
      format === "csv" ||
      format === "tsv" ||
      (format !== "txt" &&
        header.length > 1 &&
        header.some((column) => IMPORT_NAME_KINDS.includes(column as ImportNameKind)));
    if (structured) {
      if (header.some((column) => !IMPORT_NAME_KINDS.includes(column as ImportNameKind)))
        throw Error(
          "Use column headers region, city, town, area and shop. Include only the columns you need.",
        );
      if (new Set(header).size !== header.length) throw Error("Column headers must be unique.");
      rows = delimited(source, delimiter)
        .slice(1)
        .map((cells, i) => {
          if (cells.length !== header.length)
            throw Error(`Row ${i + 2}: expected ${header.length} columns.`);
          return hierarchyRow(
            Object.fromEntries(header.map((column, j) => [column, cells[j]])),
            i + 2,
          );
        });
    } else {
      rows = source
        .split(/\r\n|\r|\n/)
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ kind, name, parentId, path: [] }));
    }
  }
  const checked = marketNameRowsSchema.safeParse(rows);
  if (!checked.success)
    throw Error("Import 1–500 rows, with each name between 1 and 160 characters.");
  return checked.data;
}

export function previewMarketNames(
  market: MarketLocations,
  shops: Shop[],
  raw: MarketNameRow[],
  batchId: string,
) {
  const rows = marketNameRowsSchema.parse(raw);
  const next = structuredClone(market);
  const addedLocations: MarketLocations["locations"] = [],
    addedShops: Shop[] = [];
  const review: { kind: ImportNameKind; name: string; path: string; status: "Create" | "Reuse" }[] =
    [];
  const prefix = `names-${batchId.slice(0, 80)}`;
  function ensure(kind: ImportNameKind, name: string, parentId: string | null) {
    const parent = parentId ? next.locations.find((row) => row.id === parentId) : undefined;
    if (kind === "shop" && parentId && !parent)
      throw Error(`"${name}": the selected shop location no longer exists.`);
    if (kind !== "shop") {
      const valid =
        kind === "region"
          ? parentId === null
          : kind === "area"
            ? parent?.kind === "city" || parent?.kind === "town"
            : parent?.kind === "region";
      if (!valid)
        throw Error(
          `"${name}": choose a region for a city or town, and a city or town for an area. Regions have no parent.`,
        );
    }
    const matches =
      kind === "shop"
        ? [...shops, ...addedShops].filter(
            (row) => key(row.name) === key(name) && (row.locationId ?? null) === parentId,
          )
        : next.locations.filter(
            (row) => row.kind === kind && key(row.name) === key(name) && row.parentId === parentId,
          );
    if (matches.length > 1)
      throw Error(
        `"${name}" is ambiguous at this location. Rename duplicate entries before importing.`,
      );
    if (matches[0]) {
      review.push({
        kind,
        name: matches[0].name,
        path: locationLabel(next, parentId),
        status: "Reuse",
      });
      return matches[0].id;
    }
    const id = `${prefix}-${kind === "shop" ? "s" : "l"}-${addedLocations.length + addedShops.length}`;
    if (shops.some((row) => row.id === id) || next.locations.some((row) => row.id === id))
      throw Error("This import identifier is already used. Review a new preview.");
    if (kind === "shop") {
      if (parentId && !next.locations.some((row) => row.id === parentId))
        throw Error("The selected shop location no longer exists.");
      addedShops.push({
        id,
        name,
        keeper: "",
        place: "",
        notes: "",
        sellRate: 1,
        buyRate: 0.5,
        wealth: "modest",
        category: "general",
        priceScale: 1,
        closed: true,
        ...(parentId ? { locationId: parentId } : {}),
      });
    } else {
      const location = { id, kind, name, parentId, description: "" };
      // Validate each level before processing its descendants.
      readMarketLocations({ ...next, locations: [...next.locations, location] });
      addedLocations.push(location);
      next.locations.push(location);
    }
    review.push({ kind, name, path: locationLabel(next, parentId), status: "Create" });
    return id;
  }
  for (const row of rows) {
    if (row.path.length && row.parentId)
      throw Error("Use a full hierarchy or a selected parent, not both.");
    let parentId = row.parentId;
    for (const parent of row.path) parentId = ensure(parent.kind, parent.name, parentId);
    ensure(row.kind, row.name, parentId);
    if (addedLocations.length + addedShops.length > 1000)
      throw Error("Import up to 1,000 new locations and shops at a time.");
  }
  return {
    before: marketNameFingerprint(market, shops),
    locations: addedLocations,
    shops: addedShops,
    review,
  };
}
