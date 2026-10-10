import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";
import { combatantSchema } from "../encounters/model.mjs";

const key = z.string().trim().min(1).max(120);
const source = z
  .object({
    book: z.string().trim().min(1).max(200),
    pdfPage: z.number().int().positive(),
    printedPage: z.string().max(30).nullable(),
  })
  .strict();
const common = {
  id: key,
  name: z.string().trim().min(1).max(120),
  text: z.string().max(14000),
  sources: z.array(source).min(1).max(30),
  warnings: z.array(z.string().max(500)).max(30),
  tags: z.array(z.string().max(80)).max(30),
  relatedIds: z.array(key).max(50).optional(),
};
export const resourceEntrySchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("reference") }).strict(),
  z
    .object({
      ...common,
      kind: z.literal("creature"),
      stats: z
        .object({
          ac: z.number().int().min(0).max(100).nullable(),
          hp: z.number().int().min(1).max(1e6).nullable(),
          cr: z.number().min(0).max(30).nullable(),
          xp: z.number().int().min(0).max(1e6).nullable(),
          initiativeBonus: z.number().int().min(-100).max(100).nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("item"),
      category: z.string().max(80),
      rarity: z.string().max(80),
      baseCopper: z.number().int().nonnegative().max(1e12).nullable(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("location"),
      locationKind: z.enum(["region", "city", "town", "area"]),
      parentId: key.nullable(),
    })
    .strict(),
  z.object({ ...common, kind: z.literal("shop"), parentId: key.nullable() }).strict(),
  z.object({ ...common, kind: z.literal("npc"), parentId: key.nullable() }).strict(),
]);
export const resourcePackSchema = z
  .object({
    format: z.literal("lootsplit.resource-pack"),
    version: z.literal(1),
    id: key,
    revision: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000),
    attribution: z.string().max(4000),
    entries: z.array(resourceEntrySchema).min(1).max(1500),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const entries = new Map(pack.entries.map((e) => [e.id, e]));
    if (entries.size !== pack.entries.length)
      ctx.addIssue({ code: "custom", message: "Entry IDs must be unique within the pack." });
    for (const entry of pack.entries) {
      for (const related of entry.relatedIds ?? []) {
        if (!entries.has(related) || related === entry.id)
          ctx.addIssue({
            code: "custom",
            message: `${entry.name}: related references must name other entries in this pack.`,
          });
      }
      if (!("parentId" in entry)) continue;
      const parent = entry.parentId ? entries.get(entry.parentId) : undefined;
      if (entry.parentId && parent?.kind !== "location")
        ctx.addIssue({
          code: "custom",
          message: `${entry.name}: parent must name a location in this pack.`,
        });
      if (entry.kind !== "location") continue;
      const valid =
        entry.locationKind === "region"
          ? entry.parentId === null
          : entry.locationKind === "area"
            ? parent?.kind === "location" && ["city", "town"].includes(parent.locationKind)
            : parent?.kind === "location" && parent.locationKind === "region";
      if (!valid)
        ctx.addIssue({
          code: "custom",
          message: `${entry.name}: invalid region/city/town/area hierarchy.`,
        });
    }
  });
export type ResourcePack = z.infer<typeof resourcePackSchema>;
export type ResourceEntry = z.infer<typeof resourceEntrySchema>;
export type ResourceCreature = Extract<ResourceEntry, { kind: "creature" }>;
export const resourceLibrarySchema = z
  .object({ packs: z.array(resourcePackSchema).max(100) })
  .strict()
  .superRefine((library, ctx) => {
    if (new Set(library.packs.map(packKey)).size !== library.packs.length)
      ctx.addIssue({ code: "custom", message: "Duplicate pack identity." });
  });
export type ResourceLibrary = z.infer<typeof resourceLibrarySchema>;
export const packKey = (pack: ResourcePack) => JSON.stringify([pack.id, pack.revision]);
export const resourceFingerprint = (library?: ResourceLibrary) =>
  canonicalJson((library?.packs ?? []).map(packKey).sort());
export function readResourcePack(text: string): ResourcePack {
  if (new TextEncoder().encode(text).length > 1_500_000)
    throw Error(
      "Import a resource pack up to 1.5 MB. Keep larger books split into separate packs.",
    );
  const result = resourcePackSchema.safeParse(JSON.parse(text));
  if (!result.success)
    throw Error(
      result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .slice(0, 8)
        .join("\n"),
    );
  return result.data;
}
export function previewResourcePack(library: ResourceLibrary | undefined, raw: ResourcePack) {
  const pack = readResourcePack(JSON.stringify(raw));
  const existing = library?.packs.find((p) => packKey(p) === packKey(pack));
  if (existing && canonicalJson(existing) !== canonicalJson(pack))
    throw Error(
      "This pack ID and revision already have different contents. Use a new revision; existing references are preserved.",
    );
  if (!existing && (library?.packs.length ?? 0) >= 100)
    throw Error("This campaign already contains 100 packs.");
  const warnings = pack.entries.flatMap((entry) =>
    [...entry.warnings, ...missingCreatureFields(entry)].map((message) => ({
      name: entry.name,
      message,
    })),
  );
  return {
    pack,
    before: resourceFingerprint(library),
    status: existing ? ("Reuse" as const) : ("Import" as const),
    warnings,
  };
}
export function missingCreatureFields(entry: ResourceEntry): string[] {
  return entry.kind === "creature"
    ? Object.entries(entry.stats)
        .filter(([, value]) => value === null)
        .map(([key]) => `Missing ${key}; encounter use requires review.`)
    : [];
}
export function resourceCombatant(pack: ResourcePack, entry: ResourceCreature) {
  const missing = missingCreatureFields(entry);
  if (missing.length) throw Error(`${entry.name}: ${missing.join(" ")}`);
  const s = entry.stats;
  const notes = [
    entry.text,
    ...(entry.relatedIds ?? []).map((id) => {
      const related = pack.entries.find((e) => e.id === id);
      if (!related) throw Error("A related source reference is missing.");
      return `${related.name}\n${related.text}`;
    }),
  ].join("\n\n");
  if (notes.length > 16000)
    throw Error(
      "This creature and its related notes exceed the encounter-note limit. Review the reference in Library and add a custom enemy with shorter notes.",
    );
  return combatantSchema.parse({
    id: crypto.randomUUID(),
    name: entry.name,
    side: "enemy",
    hp: s.hp,
    maxHp: s.hp,
    ac: s.ac,
    initiative: null,
    initiativeBonus: s.initiativeBonus,
    conditions: "",
    notes,
    cr: s.cr,
    xp: s.xp,
    source: `${pack.title} · ${entry.sources.map((s) => `PDF p. ${s.pdfPage}${s.printedPage ? ` (print ${s.printedPage})` : ""}`).join(", ")}`,
    sourceKey: entry.id,
  });
}
export function resourceNameRows(pack: ResourcePack) {
  const entries = new Map(pack.entries.map((e) => [e.id, e]));
  return pack.entries
    .filter((e) => e.kind === "location" || e.kind === "shop")
    .map((entry) => {
      if (entry.kind !== "location" && entry.kind !== "shop") throw Error("Invalid location.");
      const path: { kind: "region" | "city" | "town" | "area"; name: string }[] = [];
      let parentId = entry.parentId;
      while (parentId) {
        const parent = entries.get(parentId);
        if (parent?.kind !== "location") throw Error("Invalid parent location.");
        path.unshift({ kind: parent.locationKind, name: parent.name });
        parentId = parent.parentId;
      }
      return {
        kind: entry.kind === "shop" ? ("shop" as const) : entry.locationKind,
        name: entry.name,
        parentId: null,
        path,
      };
    });
}
