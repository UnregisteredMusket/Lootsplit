/**
 * The favor market's stored shapes (owner design 2026-11-05, PR B; engine in favor-market.ts).
 * Each faction carries its own `favorMarket` (no default entries) and `favorRequests` (players'
 * requests and the DM's purchases). Both live on the faction record in `journal.factions`, which
 * is parsed with unknown keys stripped, so a reader of PR A's version drops them without error and
 * the server's stored copy keeps them (journal.ts `preserveJournalMetadata`).
 */
import { z } from "zod";

/** At most this many entries in one faction's market. */
export const MAX_FAVOR_ENTRIES = 50;
/** At most this many requests and purchases on one faction, decided ones included (never pruned). */
export const MAX_FAVOR_REQUESTS = 300;
/** At most this many waiting requests per character and faction. */
export const MAX_PENDING_FAVOR_REQUESTS = 10;
export const MAX_FAVOR_COST = 1_000_000;

const id = z.string().min(1).max(150);
const at = z.number().int().nonnegative();
export const favorEntryKinds = ["favor", "item", "secret", "service", "other"] as const;
export type FavorEntryKind = (typeof favorEntryKinds)[number];
const cost = z.number().int().min(0).max(MAX_FAVOR_COST);

/** One thing a faction offers for Favor. The DM writes every entry; there are no defaults. */
export const favorEntrySchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    /** What players read. */
    description: z.string().max(1000),
    /** In Favor with this faction. */
    cost,
    kind: z.enum(favorEntryKinds),
    /** false: shown but not open to requests right now. */
    available: z.boolean(),
    /** DM only until revealed. */
    hidden: z.boolean(),
    /** Revealed only to the buying player, when the purchase is approved (a secret's text). */
    secret: z.string().max(2000).optional(),
    /** DM only; never sent to players. */
    note: z.string().max(1000).optional(),
  })
  .strict();
export type FavorEntry = z.infer<typeof favorEntrySchema>;

export const favorRequestStatuses = ["pending", "approved", "declined", "withdrawn"] as const;
/**
 * A request for an entry, or the DM's direct purchase (`direct`). Name, kind and cost are copied
 * from the entry when asked, so a later edit or deletion of the entry never changes what was
 * agreed; `secret` is copied only when approved.
 */
export const favorRequestSchema = z
  .object({
    id,
    entryId: id,
    characterId: id,
    name: z.string().trim().min(1).max(80),
    kind: z.enum(favorEntryKinds),
    cost,
    at,
    status: z.enum(favorRequestStatuses),
    /** The player's words with the request. */
    note: z.string().max(500).optional(),
    /** The DM's reply on approval or decline (the requesting player reads it). */
    reply: z.string().max(500).optional(),
    decidedAt: at.optional(),
    /** Recorded by the DM directly, not asked for. */
    direct: z.literal(true).optional(),
    /** The entry's secret text at approval: only this character's player reads it. */
    secret: z.string().max(2000).optional(),
  })
  .strict();
export type FavorRequest = z.infer<typeof favorRequestSchema>;

export const favorMarketSchema = z
  .array(favorEntrySchema)
  .max(MAX_FAVOR_ENTRIES)
  .superRefine((list, ctx) => {
    if (new Set(list.map((e) => e.id)).size !== list.length)
      ctx.addIssue({ code: "custom", message: "Each favor market entry needs its own ID." });
  });
export const favorRequestsSchema = z.array(favorRequestSchema).max(MAX_FAVOR_REQUESTS);

/** What the DM edits (the stored entry, as sent by the form). */
export const favorEntryDraftSchema = favorEntrySchema;

/**
 * Optional generic starting points for "Add from template" (owner: favor is faction-specific, so
 * these only fill the form; the DM edits them before saving and nothing is added by default).
 */
export const FAVOR_TEMPLATES: readonly Omit<FavorEntry, "id" | "available" | "hidden">[] = [
  { name: "Safe house for a night", description: "A bed, a locked door and no questions asked.", cost: 3, kind: "service" },
  { name: "Introduction to a contact", description: "A word in the right ear: someone who can help.", cost: 5, kind: "favor" },
  {
    name: "A rumour about a rival",
    description: "Something the faction's people have overheard.",
    cost: 4,
    kind: "secret",
    secret: "",
  },
  { name: "Forged papers", description: "Travel papers, a writ or a seal that will pass a casual look.", cost: 8, kind: "item" },
  { name: "Discount voucher", description: "A token that buys goodwill at one of the faction's shops.", cost: 2, kind: "other" },
];

type MarketHolder = { favorMarket?: FavorEntry[]; favorRequests?: FavorRequest[] };
/**
 * A player's copy of one visible faction's market (factions.ts `projectFactions`): visible entries without the
 * DM's note or secret text, and only this seat's own characters' requests (a secret only on their
 * approved purchases). Mutates the projected faction.
 */
export function projectFavorMarket(source: MarketHolder, projected: MarketHolder, own: ReadonlySet<string>): void {
  const entries = (source.favorMarket ?? [])
    .filter((e) => !e.hidden)
    .map(({ secret: _secret, note: _note, ...e }) => e);
  const requests = (source.favorRequests ?? [])
    .filter((r) => own.has(r.characterId))
    .map(({ secret, ...r }) => ({ ...r, ...(r.status === "approved" && secret ? { secret } : {}) }));
  if (entries.length) projected.favorMarket = entries;
  else delete projected.favorMarket;
  if (requests.length) projected.favorRequests = requests;
  else delete projected.favorRequests;
}

