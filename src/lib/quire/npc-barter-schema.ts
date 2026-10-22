import { z } from "zod";

// NPC barter (docs/NPC-BARTER.md): autonomous answers for location NPCs that have
// no player controller. Every field is optional or defaulted so older saves load.
const id = z.string().min(1).max(150);
const copper = z.number().int().min(0).max(1e12);

export const barterLineKeys = [
  "greet",
  "barter",
  "accept",
  "counter",
  "refuse",
  "tooLow",
  "noInterest",
  "cooldown",
  "dm",
  "bye",
] as const;
export type BarterLineKey = (typeof barterLineKeys)[number];
export const barterStances = ["generous", "fair", "shrewd"] as const;
export type BarterStance = (typeof barterStances)[number];
export const barterModes = ["dm", "confirm", "auto"] as const;
export type BarterMode = (typeof barterModes)[number];
export const barterReplies = ["persuade", "offer", "too-low", "dm"] as const;
export type BarterReply = (typeof barterReplies)[number];

const line = z.string().trim().min(1).max(500);
export const barterLinesSchema = z
  .object({
    greet: line.optional(),
    barter: line.optional(),
    accept: line.optional(),
    counter: line.optional(),
    refuse: line.optional(),
    tooLow: line.optional(),
    noInterest: line.optional(),
    cooldown: line.optional(),
    dm: line.optional(),
    bye: line.optional(),
  })
  .strict();
export type BarterLines = z.infer<typeof barterLinesSchema>;

/** Per-NPC choices. Missing values follow the campaign rules. */
export const npcBarterConfigSchema = z
  .object({
    mode: z.enum(barterModes).optional(),
    stance: z.enum(barterStances).optional(),
    /** Item categories the NPC values; missing means every category. */
    wants: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    lines: barterLinesSchema.optional(),
  })
  .strict();
export type NpcBarterConfig = z.infer<typeof npcBarterConfigSchema>;

export const barterRulesSchema = z
  .object({
    mode: z.enum(barterModes).default("dm"),
    stance: z.enum(barterStances).default("fair"),
    receivePercent: z.number().int().min(0).max(100).default(50),
    acceptPercent: z.number().int().min(100).max(300).default(110),
    refusePercent: z.number().int().min(10).max(100).default(60),
    counterMargin: z.number().int().min(0).max(10).default(3),
    cooldownMinutes: z.number().int().min(0).max(10080).default(60),
    repeatDc: z.number().int().min(0).max(5).default(2),
    attemptsBeforeQueue: z.number().int().min(1).max(10).default(3),
    partyMemory: z.boolean().default(false),
    combineTrades: z.boolean().default(true),
    offerCapCopper: copper.default(5000),
    dailyCapCopper: copper.default(20000),
    unitCap: z.number().int().min(1).max(100).default(5),
    unreferencedToDm: z.boolean().default(true),
  })
  .strict()
  .refine((r) => r.refusePercent <= r.acceptPercent, {
    message: "The refuse level must be at or below the accept level.",
  });
export type BarterRules = z.infer<typeof barterRulesSchema>;
export const defaultBarterRules = (): BarterRules => barterRulesSchema.parse({});

export const barterSideSchema = z
  .object({
    purseId: id,
    copper,
    items: z
      .array(
        z
          .object({
            holdingId: id,
            quantity: z.number().int().min(1).max(100000),
            before: z.string().max(6000000),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type BarterSide = z.infer<typeof barterSideSchema>;

const d20 = z.number().int().min(1).max(20);
export const barterQuoteRecordSchema = z
  .object({
    /** NPC view, whole copper: what it receives and what it gives (DM only). */
    received: copper,
    given: copper,
    /** received ÷ given in thousandths (DM only). */
    ratio: z.number().int().min(0).max(1e9),
    dc: z.number().int().min(0).max(30),
    kind: z.enum(["accept", "check", "refuse", "dm"]),
    bonus: z.number().int().min(-30).max(60),
    advantage: z.enum(["normal", "advantage", "disadvantage"]),
    /** Chance of success in thousandths. */
    chance: z.number().int().min(0).max(1000),
    repeat: z.number().int().min(0).max(60),
    combined: z.boolean(),
    reasons: z.array(z.string().max(300)).max(10),
  })
  .strict();
export type BarterQuoteRecord = z.infer<typeof barterQuoteRecordSchema>;

export const barterAttemptSchema = z
  .object({
    id,
    npcId: id,
    purseId: id,
    /** Memory key: the player account (or the character when the DM acts). DM only. */
    account: z.string().min(1).max(200),
    at: z.number(),
    /** Campaign clock minute (day × 1440 + minute of day) when the offer was made. */
    minute: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    mode: z.enum(barterModes),
    reply: z.enum(barterReplies),
    give: barterSideSchema,
    ask: barterSideSchema,
    quote: barterQuoteRecordSchema,
    roll: z
      .object({
        dice: z.array(d20).min(1).max(2),
        kept: d20,
        total: z.number().int().min(-40).max(80),
        source: z.enum(["server", "local"]),
      })
      .strict()
      .optional(),
    status: z.enum(["accepted", "countered", "refused", "queued", "confirm", "declined", "cancelled"]),
    /** Extra copper the NPC asks for in a counter-offer. */
    counterCopper: copper.optional(),
    lines: z
      .array(z.object({ key: z.enum(barterLineKeys), text: z.string().max(600) }).strict())
      .max(12),
    settled: id.optional(),
    decidedAt: z.number().optional(),
    dmReason: z.string().trim().max(1000).optional(),
    showReason: z.boolean().optional(),
    values: z
      .array(z.object({ holdingId: id, copper }).strict())
      .max(20)
      .optional(),
    cleared: z.boolean().optional(),
  })
  .strict();
export type BarterAttempt = z.infer<typeof barterAttemptSchema>;

export const npcBarterStateSchema = z
  .object({
    rules: barterRulesSchema.prefault({}),
    revision: z.number().int().nonnegative().default(0),
    attempts: z.array(barterAttemptSchema).max(50000).default([]),
  })
  .strict();
export type NpcBarterState = z.infer<typeof npcBarterStateSchema>;

const offerShape = {
  npcId: id,
  purseId: id,
  give: barterSideSchema,
  ask: barterSideSchema,
};
export const npcBarterCommands = [
  z
    .object({
      id,
      kind: z.literal("npc-barter-rules"),
      revision: z.number().int().nonnegative(),
      rules: barterRulesSchema,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("npc-barter-npc"),
      npcId: id,
      before: npcBarterConfigSchema.nullable(),
      config: npcBarterConfigSchema.nullable(),
    })
    .strict(),
  z
    .object({ id, kind: z.literal("npc-barter-offer"), ...offerShape, reply: z.enum(barterReplies) })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("npc-barter-decide"),
      attemptId: id,
      revision: z.number().int().nonnegative(),
      decision: z.enum(["accept-counter", "decline-counter", "cancel"]),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("npc-barter-resolve"),
      attemptId: id,
      revision: z.number().int().nonnegative(),
      action: z.enum(["roll", "accept", "decline", "counter", "confirm", "overrule"]),
      counterCopper: copper.max(1e9).optional(),
      reason: z.string().trim().max(1000).optional(),
      showReason: z.boolean().optional(),
      values: z
        .array(z.object({ holdingId: id, copper }).strict())
        .max(20)
        .optional(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("npc-barter-clear-wait"),
      attemptId: id,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
] as const;
export type NpcBarterCommand = z.infer<(typeof npcBarterCommands)[number]>;
export const npcBarterKinds = new Set<string>(
  npcBarterCommands.map((schema) => schema.shape.kind.value),
);
