import { z } from "zod";
import { goodsKey } from "./goods-key.ts";

// NPC service providers beyond the forge (docs/SERVICES.md): temple, workshop and inn.
// Optional journal metadata (`journal.services`); old saves have none and read unchanged.

const id = z.string().min(1).max(150);
const name = z.string().trim().min(1).max(160);
const copper = z.number().int().min(0).max(1e12);
const day = z.number().int().nonnegative();
const minute = z.number().int().min(0).max(1439);
export const serviceKinds = [
  "temple",
  "workshop",
  "inn",
  // Wave 2 (tabletop protocol 9): new engines, then links that only open an existing screen.
  "trainer",
  "stable",
  "courier",
  "sage",
  "fence",
  "bank",
  "hire",
] as const;
export type ServiceKind = (typeof serviceKinds)[number];
/** The kinds tabletop protocol 8 clients know; older clients never receive the others. */
export const legacyServiceKinds = ["temple", "workshop", "inn"] as const;
/** Link kinds open an existing screen (Sell tab, loan request, staff proposal): no offers, no money path. */
export const linkServiceKinds = ["fence", "bank", "hire"] as const;
export const isLinkKind = (k: string) => (linkServiceKinds as readonly string[]).includes(k);
export const servicePresets = ["srd-5.2.1", "srd-5.1", "blank"] as const;
export const settlementKinds = ["village", "town", "city"] as const;
export type Settlement = (typeof settlementKinds)[number];

/** Something the service needs: a diamond for Raise Dead, herbs for a potion. */
export const serviceComponentSchema = z
  .object({
    key: goodsKey,
    label: name,
    /** Contributions must carry this material key (the forge's rule); absent accepts any item. */
    materialKey: goodsKey.optional(),
    /** Minimum value of one contributed piece, in copper. */
    minCopper: copper,
    /** Pieces needed per order, or per unit when `perUnit`. */
    quantity: z.number().int().min(1).max(1000),
    perUnit: z.boolean(),
    consumed: z.boolean(),
    /** party: must be brought; provider: always supplied for `supplyCopper` each; either: both. */
    supply: z.enum(["party", "provider", "either"]),
    supplyCopper: copper,
  })
  .strict();
export const serviceTimeSchema = z.discriminatedUnion("kind", [
  /** Casting time is noted on the receipt; the campaign clock never advances by itself. */
  z.object({ kind: z.literal("instant"), castingMinutes: z.number().int().min(0).max(14400).optional() }).strict(),
  /** Only DM-approved downtime advances work (the forge's rule). */
  z.object({ kind: z.literal("downtime-days"), days: z.number().int().min(1).max(3650), perUnit: z.boolean() }).strict(),
  /** Booked and paid up front; units are nights. */
  z.object({ kind: z.literal("per-night"), maxNights: z.number().int().min(1).max(365) }).strict(),
]);
export const serviceOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("record") }).strict(),
  z
    .object({
      kind: z.literal("holding"),
      name,
      unitCopper: copper,
      weight: z.number().finite().min(0).max(9999),
      category: z.string().max(80),
      notes: z.string().max(1500),
    })
    .strict(),
]);
export const innTierSchema = z
  .object({ key: goodsKey, name, nightCopper: copper, mealCopper: copper, offered: z.boolean() })
  .strict();
export const serviceOfferSchema = z
  .object({
    key: goodsKey,
    name,
    description: z.string().max(1500),
    /** Drafts are DM-only and never reach players. */
    approved: z.boolean(),
    /** Per unit (potion, scroll); for an inn the tier prices apply instead. */
    priceCopper: copper,
    /** Temple and scribe: drives the settlement rule (SRD 5.2.1). */
    spellLevel: z.number().int().min(0).max(9).optional(),
    time: serviceTimeSchema,
    review: z.enum(["auto", "dm"]),
    maxUnits: z.number().int().min(1).max(100).optional(),
    components: z.array(serviceComponentSchema).max(5).optional(),
    output: serviceOutputSchema,
    tiers: z.array(innTierSchema).max(10).optional(),
    /** Sage or temple Identify: the order names one item the payer carries (wave 2). */
    target: z.literal("held-item").optional(),
  })
  .strict();
export const rumourSchema = z
  .object({
    id,
    /** Players see the teaser and price. */
    teaser: z.string().trim().min(1).max(300),
    /** DM-only until bought; a player projection never carries it. */
    text: z.string().trim().min(1).max(2000).optional(),
    priceCopper: copper,
    once: z.enum(["character", "party"]),
    /** Purses that bought it; DM-only. */
    buyers: z.array(id).max(1000).optional(),
    /** Projection only: whether the viewer's characters (or the party) already bought it. */
    boughtBy: z.array(id).max(100).optional(),
    boughtByParty: z.boolean().optional(),
  })
  .strict();
/** A hireling role a Hire link proposes as a property staff contract (estate-staff). */
export const hireRoleSchema = z
  .object({
    key: goodsKey,
    name,
    wageCopper: copper,
    periodDays: z.number().int().min(1).max(3650),
    /** Optional NPC who takes the job; players see it only when they can read that NPC. */
    npcId: id.optional(),
  })
  .strict();
/** Starting values for the DM's loan form when a loan request names this bank. */
export const bankTermsSchema = z
  .object({
    rateBps: z.number().int().min(0).max(100000),
    periodDays: z.number().int().min(1).max(3650),
    compound: z.boolean(),
    /** Largest loan the bank suggests; the DM decides every request. */
    maxCopper: copper,
  })
  .strict();
/** Fence, bank and hire: what the link opens with. Never moves money by itself. */
export const serviceLinkSchema = z
  .object({ loan: bankTermsSchema.optional(), roles: z.array(hireRoleSchema).max(20).optional() })
  .strict();
export const serviceProviderSchema = z
  .object({
    id,
    kind: z.enum(serviceKinds),
    preset: z.enum(servicePresets),
    /** "Scribe", "Alchemist": shown as "Workshop · Scribe". */
    specialty: z.string().trim().max(60).optional(),
    shopId: id,
    npcId: id,
    name,
    description: z.string().max(1500),
    /** "Not taking new orders"; collecting a ready order stays possible. */
    paused: z.object({ reason: z.string().trim().min(1).max(500) }).strict().optional(),
    /** Any order above this total waits for DM review. */
    reviewAboveCopper: copper.optional(),
    /** Overrides the settlement derived from Market locations. */
    settlement: z.enum(settlementKinds).optional(),
    offers: z.array(serviceOfferSchema).max(200),
    rumours: z.array(rumourSchema).max(200).optional(),
    /** Link kinds only (fence, bank, hire). */
    link: serviceLinkSchema.optional(),
  })
  .strict();
export type HireRole = z.infer<typeof hireRoleSchema>;
export type BankTerms = z.infer<typeof bankTermsSchema>;
export const serviceStatuses = [
  "requested",
  "active",
  "paused",
  "ready",
  "claimed",
  "completed",
  "denied",
  "cancelled",
] as const;
export type ServiceStatus = (typeof serviceStatuses)[number];
const contributionSchema = z
  .object({ componentKey: goodsKey, holdingId: id, quantity: z.number().int().min(1).max(1000) })
  .strict();
/** What the player asked for, kept so DM approval can rerun every check. */
export const serviceRequestSchema = z
  .object({
    beneficiaryPurseIds: z.array(id).max(20),
    units: z.number().int().min(1).max(1000),
    contributions: z.array(contributionSchema).max(10),
    inn: z.object({ tierKey: goodsKey, meals: z.number().int().min(0).max(3) }).strict().optional(),
    /** Identify: the carried item the sage looks at. */
    itemHoldingId: id.optional(),
  })
  .strict();
export type ServiceRequest = z.infer<typeof serviceRequestSchema>;
/** The immutable accepted quote: names and prices survive later edits. */
export const serviceTermsSchema = z
  .object({
    kind: z.enum(serviceKinds),
    providerName: name,
    specialty: z.string().max(60).optional(),
    npcId: id,
    npcName: name,
    shopId: id,
    shopName: name,
    locationId: id,
    placeName: name,
    offer: serviceOfferSchema,
    units: z.number().int().min(1).max(1000),
    beneficiaries: z.array(z.object({ purseId: id, name: z.string().max(160) }).strict()).max(20),
    inn: z
      .object({
        tierKey: goodsKey,
        tierName: name,
        nightCopper: copper,
        mealCopper: copper,
        meals: z.number().int().min(0).max(3),
      })
      .strict()
      .optional(),
    components: z
      .array(
        z
          .object({
            key: goodsKey,
            label: name,
            holdingId: id.nullable(),
            holdingName: z.string().max(160).optional(),
            quantity: z.number().int().min(1).max(100000),
            supplied: z.enum(["party", "provider"]),
            copper,
            consumed: z.boolean(),
          })
          .strict(),
      )
      .max(10),
    lines: z.array(z.object({ label: z.string().max(300), copper }).strict()).max(20),
    priceCopper: copper,
    review: z.enum(["auto", "dm"]),
    workDays: z.number().int().min(0).max(3650),
    settlement: z.enum(settlementKinds),
    /** Identify: the item as it was when asked (its notes are a snapshot, never rewritten). */
    item: z
      .object({ holdingId: id, name: z.string().max(160), notesBefore: z.string().max(4000) })
      .strict()
      .optional(),
  })
  .strict();
export type ServiceTerms = z.infer<typeof serviceTermsSchema>;
/** What the DM answered for an Identify order; the text is in the payer's thread with the NPC. */
export const serviceRevealSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    /** Append a dated line with the answer to the item's notes (the old notes stay). */
    appendToNotes: z.boolean(),
    /** Rename the item. */
    rename: name.optional(),
  })
  .strict();
export type ServiceReveal = z.infer<typeof serviceRevealSchema>;
export const serviceOrderSchema = z
  .object({
    id,
    providerId: id,
    offerKey: goodsKey,
    purseId: id,
    request: serviceRequestSchema,
    terms: serviceTermsSchema,
    orderedDay: day,
    orderedMinute: minute,
    progressDays: z.number().int().min(0).max(3650),
    status: z.enum(serviceStatuses),
    paidDay: day.optional(),
    paidMinute: minute.optional(),
    completedDay: day.optional(),
    completedMinute: minute.optional(),
    claimedDay: day.optional(),
    message: z.string().max(1000),
    /** Identify: the DM's answer, set once on approval. */
    reveal: serviceRevealSchema.optional(),
    history: z
      .array(
        z
          .object({ at: z.number().int().nonnegative(), status: z.enum(serviceStatuses), note: z.string().max(1000) })
          .strict(),
      )
      .max(50),
  })
  .strict();
export const servicesSchema = z
  .object({
    providers: z.array(serviceProviderSchema).max(500).default([]),
    orders: z.array(serviceOrderSchema).max(5000).default([]),
  })
  .strict();
export type ServiceComponent = z.infer<typeof serviceComponentSchema>;
export type ServiceOffer = z.infer<typeof serviceOfferSchema>;
export type ServiceProvider = z.infer<typeof serviceProviderSchema>;
export type ServiceOrder = z.infer<typeof serviceOrderSchema>;
export type Rumour = z.infer<typeof rumourSchema>;
export type Services = z.infer<typeof servicesSchema>;
export const readServices = (value?: unknown) => servicesSchema.parse(value ?? {});
/** Orders that still tie up a provider, its customer and its pickup location. */
export const openServiceStatuses: readonly ServiceStatus[] = ["requested", "active", "paused", "ready"];
export const serviceOrderOpen = (o: { status: string }) =>
  (openServiceStatuses as readonly string[]).includes(o.status);

const orderRef = { id, orderId: id, before: serviceOrderSchema };
export const serviceCommands = [
  z
    .object({
      id,
      kind: z.literal("service-provider"),
      providerId: id,
      before: serviceProviderSchema.nullable(),
      provider: serviceProviderSchema.nullable(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("service-order"),
      providerId: id,
      offerKey: goodsKey,
      purseId: id,
      request: serviceRequestSchema,
      before: z.string().max(2000000),
    })
    .strict(),
  z.object({ ...orderRef, kind: z.literal("service-cancel") }).strict(),
  z
    .object({
      ...orderRef,
      kind: z.literal("service-review"),
      decision: z.enum(["approve", "deny"]),
      reason: z.string().trim().max(1000),
      /** Identify approval: the answer, and whether to note it on the item and rename it. */
      reveal: serviceRevealSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...orderRef,
      kind: z.literal("service-control"),
      action: z.enum(["pause", "resume", "cancel"]),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z.object({ ...orderRef, kind: z.literal("service-claim") }).strict(),
  /** Buy one rumour: one payment, and the text lands in the buyer's private thread with the NPC. */
  z
    .object({
      id,
      kind: z.literal("service-rumour"),
      providerId: id,
      rumourId: id,
      purseId: id,
      before: z.string().max(100000),
    })
    .strict(),
] as const;
export type ServiceCommand = z.infer<(typeof serviceCommands)[number]>;
