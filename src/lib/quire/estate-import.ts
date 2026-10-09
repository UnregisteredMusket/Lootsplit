import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";
import { readMarketLocations } from "./shop-locations.ts";
import { estateKey, estateTemplateSchema, materialSchema, readEstate } from "./estate-schema.ts";
import type { CloudTable } from "./cloud.ts";

const key = estateKey,
  name = z.string().min(1).max(160),
  money = z.number().int().min(0).max(1e12);
const row = z
  .object({
    key,
    name,
    recordKind: z.enum(["listing", "holding"]),
    templateKey: key,
    locationKey: key,
    condition: z.enum(["ready", "maintained", "repairs", "ruin"]),
    notes: z.string().max(4000),
    parentPropertyKey: key.optional(),
    priceCopper: money.optional(),
    status: z.enum(["available", "reserved", "withdrawn"]).optional(),
    ownerKey: key.optional(),
    valueCopper: money.optional(),
  })
  .strict();
export const estateImportSchema = z
  .object({
    format: z.literal("lootsplit.property-operations"),
    schemaVersion: z.literal(1),
    status: z.literal("draft"),
    currency: z.literal("copper"),
    timeUnit: z.literal("campaign-day"),
    locations: z
      .array(
        z
          .object({
            key,
            kind: z.enum(["region", "city", "town", "area"]),
            name,
            parentKey: key.nullable(),
          })
          .strict(),
      )
      .max(500),
    ownerBindings: z
      .array(z.object({ key, kind: z.enum(["party", "character"]), label: name }).strict())
      .max(500),
    materials: z.array(materialSchema).max(500),
    templates: z.array(estateTemplateSchema).max(500),
    properties: z.array(row).max(500),
    postalDefaults: z
      .object({ feeCopper: money, deliveryDays: z.number().int().min(0).max(3650) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: "custom", message });
    for (const field of [
      "locations",
      "ownerBindings",
      "materials",
      "templates",
      "properties",
    ] as const)
      if (new Set(s[field].map((x) => x.key)).size !== s[field].length)
        bad(`Duplicate keys in ${field}.`);
    const locations = new Map(s.locations.map((l) => [l.key, l]));
    for (const l of s.locations) {
      const parent = l.parentKey ? locations.get(l.parentKey) : undefined;
      if (
        !(l.kind === "region"
          ? l.parentKey === null
          : l.kind === "area"
            ? parent?.kind === "city" || parent?.kind === "town"
            : parent?.kind === "region")
      )
        bad(`Invalid hierarchy for ${l.key}.`);
    }
    const templates = new Set(s.templates.map((t) => t.key)),
      materials = new Set(s.materials.map((m) => m.key)),
      owners = new Set(s.ownerBindings.map((o) => o.key));
    for (const t of s.templates) {
      for (const r of t.recipes || []) {
        if (r.resultTemplateKey && !templates.has(r.resultTemplateKey))
          bad(`Missing result template for ${r.key}.`);
        for (const m of [...r.materials, ...(r.stages || []).flatMap((stage) => stage.materials)])
          if (!materials.has(m.materialKey)) bad(`Missing material ${m.materialKey}.`);
        if (r.output?.materialKey && !materials.has(r.output.materialKey))
          bad(`Missing output material for ${r.key}.`);
      }
      if (new Set((t.recipes || []).map((r) => r.key)).size !== (t.recipes || []).length)
        bad(`Duplicate recipes in ${t.key}.`);
    }
    const properties = new Map(s.properties.map((p) => [p.key, p]));
    for (const p of s.properties) {
      if (!templates.has(p.templateKey) || !locations.has(p.locationKey))
        bad(`Missing template or location for ${p.key}.`);
      if (
        p.recordKind === "listing"
          ? p.priceCopper === undefined ||
            !p.status ||
            p.ownerKey !== undefined ||
            p.valueCopper !== undefined
          : !p.ownerKey ||
            !owners.has(p.ownerKey) ||
            p.valueCopper === undefined ||
            p.priceCopper !== undefined ||
            p.status !== undefined
      )
        bad(`Invalid ${p.recordKind} fields for ${p.key}.`);
      const visited = new Set([p.key]);
      let ancestor = p.parentPropertyKey;
      while (ancestor) {
        if (visited.has(ancestor) || !properties.has(ancestor)) {
          bad(`Invalid property parent chain for ${p.key}.`);
          break;
        }
        visited.add(ancestor);
        ancestor = properties.get(ancestor)!.parentPropertyKey;
      }
      if (p.parentPropertyKey) {
        const parent = properties.get(p.parentPropertyKey);
        if (
          parent &&
          (parent.recordKind !== p.recordKind ||
            parent.ownerKey !== p.ownerKey ||
            parent.locationKey !== p.locationKey)
        )
          bad(`Attached properties must share ownership, record kind and location: ${p.key}.`);
        // An attachment is a building on its parent's legal parcel, never a second valued deed.
        if ((p.priceCopper ?? p.valueCopper ?? 0) !== 0)
          bad(`Attached building ${p.key} must have zero independent value.`);
      }
    }
  });
export type EstateImport = z.infer<typeof estateImportSchema>;
export const estateImportCommand = z.object({
  id: z.string().min(1).max(150),
  kind: z.literal("estate-import"),
  before: z.string(),
  document: estateImportSchema,
  owners: z.record(estateKey, z.string().min(1).max(150)),
  locations: z.record(estateKey, z.string().min(1).max(150)),
});
export function estateImportFingerprint(
  t: Pick<CloudTable, "purses" | "holdings" | "listings" | "journal">,
) {
  return canonicalJson({
    purses: t.purses.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    holdings: t.holdings,
    listings: t.listings,
    market: t.journal?.market,
    estate: t.journal?.propertyOperations,
  });
}
/** Preview is pure; its exact plan is rebuilt under the command's atomic revision check. */
export function previewEstateImport(
  t: CloudTable,
  raw: unknown,
  owners: Record<string, string>,
  locationBindings: Record<string, string>,
  receipt: string,
) {
  const doc = estateImportSchema.parse(raw),
    market = readMarketLocations(t.journal?.market),
    state = readEstate(t.journal?.propertyOperations);
  const next = structuredClone(t);
  next.journal ??= { sessions: [], requests: [], events: [] };
  const locationIds = new Map<string, string>(),
    propertyIds = new Map(
      doc.properties
        .filter((p) => !p.parentPropertyKey)
        .map((p, i) => [p.key, `${receipt}-property-${i}`]),
    );
  for (const binding of doc.ownerBindings) {
    const purse = t.purses.find((p) => p.id === owners[binding.key]);
    if (!purse || purse.kind !== binding.kind)
      throw Error(`Map “${binding.label}” to an existing ${binding.kind} account.`);
  }
  for (const kind of ["region", "city", "town", "area"] as const)
    for (const l of doc.locations.filter((l) => l.kind === kind)) {
      const parentId = l.parentKey ? locationIds.get(l.parentKey)! : null,
        bound = locationBindings[l.key];
      const existing = bound ? market.locations.find((x) => x.id === bound) : undefined;
      if (bound && (!existing || existing.kind !== l.kind || existing.parentId !== parentId))
        throw Error(`Review the location mapping for ${l.name}.`);
      const assigned = existing?.id ?? `${receipt}-place-${doc.locations.indexOf(l)}`;
      locationIds.set(l.key, assigned);
      if (!existing)
        market.locations.push({
          id: assigned,
          name: l.name,
          kind: l.kind,
          parentId,
          description: "Imported property location",
        });
    }
  for (const material of doc.materials) {
    const prior = state.materials.find((m) => m.key === material.key);
    if (prior && canonicalJson(prior) !== canonicalJson(material))
      throw Error(
        `Material key “${material.key}” already has another definition. Rename the imported key.`,
      );
    if (!prior) state.materials.push(material);
  }
  for (const template of doc.templates) {
    const prior = state.templates.find((x) => x.key === template.key);
    if (prior && canonicalJson(prior) !== canonicalJson(template))
      throw Error(
        `Template key “${template.key}” already exists with different rules. Rename the imported key.`,
      );
    if (!prior) state.templates.push(template);
  }
  for (const p of doc.properties.filter((p) => !p.parentPropertyKey)) {
    const template = doc.templates.find((x) => x.key === p.templateKey)!,
      propertyId = propertyIds.get(p.key)!;
    const property = { type: template.propertyType, condition: p.condition },
      locationId = locationIds.get(p.locationKey)!;
    if (p.recordKind === "listing")
      next.listings.push({
        id: propertyId,
        name: p.name,
        kind: "property",
        copper: p.priceCopper!,
        quantity: 1,
        notes: p.notes,
        locationId,
        property,
        status: p.status,
        estateTemplateKey: p.templateKey,
      });
    else {
      next.holdings.push({
        id: propertyId,
        purseId: owners[p.ownerKey!],
        name: p.name,
        kind: "property",
        quantity: 1,
        unitCopper: p.valueCopper!,
        notes: p.notes,
        locationId,
        property,
      });
      state.sites.push({
        propertyId,
        templateKey: template.key,
        enabled: false,
        access: template.storage?.defaultAccess ?? "owner",
        accessPurseIds: [],
        capacityWeight: template.storage?.capacityWeight ?? null,
        completedTemplates: [],
        notes: "Imported configuration awaiting DM activation.",
      });
    }
  }
  for (const p of doc.properties.filter((p) => p.parentPropertyKey)) {
    let root = p;
    while (root.parentPropertyKey)
      root = doc.properties.find((x) => x.key === root.parentPropertyKey)!;
    const propertyId = propertyIds.get(root.key)!,
      site = state.sites.find((s) => s.propertyId === propertyId);
    if (site) site.completedTemplates.push(p.templateKey);
    else {
      const listing = next.listings.find((l) => l.id === propertyId)!;
      listing.estateAttachments = [...(listing.estateAttachments || []), p.templateKey];
    }
  }
  if (doc.postalDefaults) Object.assign(state.postal, doc.postalDefaults);
  next.journal.market = readMarketLocations(market);
  next.journal.propertyOperations = readEstate(state);
  return next;
}
