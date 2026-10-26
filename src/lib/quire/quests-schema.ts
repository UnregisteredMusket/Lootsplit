/**
 * Quest log (docs/QUESTS.md): stored shapes and DM commands. Quests live in `journal.quests`,
 * outside every strict room schema: older clients' journal parser drops the field without error
 * and `preserveJournalMetadata` keeps the stored log when they write the journal back, so no
 * tabletop protocol bump is needed. Stored quest records are parsed with unknown keys stripped
 * (not strict) so a later quest field never breaks an older client's journal; quests change only
 * through the commands below (quests.ts), which the room and the device run identically.
 *
 * Quests never move coins or items. A reward is words plus read-only links to receipts that
 * already exist (an encounter award, a ledger line or a treasure-pool resolution).
 */
import { z } from "zod";

const id = z.string().min(1).max(150);
const at = z.number().int().nonnegative();
const revision = z.number().int().nonnegative();

export const MAX_QUESTS = 300;
export const MAX_QUEST_OBJECTIVES = 30;
export const MAX_QUEST_LOG = 500;
export const MAX_QUEST_REWARD_LINKS = 20;
export const MAX_QUEST_LOCATIONS = 10;
export const MAX_QUEST_MARKERS = 10;
export const MAX_QUEST_AREAS = 30;

export const questStatuses = ["active", "completed", "failed"] as const;
export type QuestStatus = (typeof questStatuses)[number];
export const objectiveStates = ["open", "done", "failed"] as const;

/** Who may read a quest. "none" is a draft only the DM sees. */
export const questAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  /** Every party player character, including later joiners and characters who walked off. */
  z.object({ kind: z.literal("party") }).strict(),
  /** Named characters, stored at reveal time (a group reveal stores its members then). */
  z.object({ kind: z.literal("characters"), purseIds: z.array(id).min(1).max(20) }).strict(),
]);
export type QuestAudience = z.infer<typeof questAudienceSchema>;

/** A link to an existing map pin: a map marker or a connected-map record placement. */
export const questMarkerSchema = z.object({ mapId: id, markerId: id });
export type QuestMarker = z.infer<typeof questMarkerSchema>;

/**
 * A DM-drawn radius marker: a general area on one map, not an exact spot (it may sit off the real
 * target). Centre in normalized image coordinates; `r` is a fraction of the image width.
 * `objectiveId` ties it to one objective (it then follows that objective's visibility).
 */
export const questAreaSchema = z.object({
  id,
  mapId: id,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  r: z.number().positive().max(2),
  label: z.string().trim().max(120).optional(),
  objectiveId: id.optional(),
});
export type QuestArea = z.infer<typeof questAreaSchema>;

export const questObjectiveSchema = z.object({
  id,
  text: z.string().trim().min(1).max(200),
  state: z.enum(objectiveStates),
  /** DM only until revealed. */
  hidden: z.boolean().optional(),
  optional: z.boolean().optional(),
  /** A market (Place hub) location. */
  locationId: id.optional(),
  /** An existing map pin. */
  marker: questMarkerSchema.optional(),
  changedAt: at.optional(),
  sessionId: id.optional(),
});
export type QuestObjective = z.infer<typeof questObjectiveSchema>;

export const questRewardKinds = ["encounter-award", "ledger", "loot-resolution"] as const;
export const questRewardLinkSchema = z.object({
  kind: z.enum(questRewardKinds),
  /** Ledger line ID, encounter award receipt ID or treasure-pool resolution ID. */
  id,
  /** What the DM saw when linking ("Advance from Ottilie · 40 gp"); players see it only when
   * they could already read the receipt. */
  label: z.string().max(160).optional(),
  at: at.optional(),
});
export type QuestRewardLink = z.infer<typeof questRewardLinkSchema>;

export const questLogKinds = ["entry", "revealed", "objective", "status"] as const;
export const questLogEntrySchema = z.object({
  id,
  at,
  sessionId: id.optional(),
  /** The campaign day (finance clock) when it was written. */
  day: z.number().int().nonnegative().optional(),
  text: z.string().trim().min(1).max(1000),
  /** false: a DM-only line, never sent to players. */
  shared: z.boolean(),
  kind: z.enum(questLogKinds).optional(),
  objectiveId: id.optional(),
});
export type QuestLogEntry = z.infer<typeof questLogEntrySchema>;

export const questSchema = z.object({
  id,
  title: z.string().trim().min(1).max(100),
  main: z.boolean().optional(),
  status: z.enum(questStatuses),
  audience: questAudienceSchema,
  /** Player-facing summary. */
  summary: z.string().max(2000),
  giverNpcId: id.optional(),
  locationIds: z.array(id).max(MAX_QUEST_LOCATIONS).default([]),
  markers: z.array(questMarkerSchema).max(MAX_QUEST_MARKERS).default([]),
  areas: z.array(questAreaSchema).max(MAX_QUEST_AREAS).default([]),
  objectives: z.array(questObjectiveSchema).max(MAX_QUEST_OBJECTIVES).default([]),
  /** The promised reward, in words. Paying happens elsewhere. */
  rewardText: z.string().max(300).optional(),
  rewardLinks: z.array(questRewardLinkSchema).max(MAX_QUEST_REWARD_LINKS).default([]),
  /** The chronicle. Never pruned; a full log refuses new lines. */
  log: z.array(questLogEntrySchema).max(MAX_QUEST_LOG).default([]),
  /** Never sent to players. */
  dmNotes: z.string().max(4000).optional(),
  createdAt: at,
  /** The last change players can see (reveal, objective, shared entry, status): drives "Updated". */
  updatedAt: at,
  /** The last change of any kind (DM only). */
  editedAt: at.optional(),
  revision,
  revealedAt: at.optional(),
  closedAt: at.optional(),
  archived: z.boolean().optional(),
});
export type Quest = z.infer<typeof questSchema>;

export const questsSchema = z.object({
  quests: z.array(questSchema).max(MAX_QUESTS).default([]),
});
export type Quests = z.infer<typeof questsSchema>;
export function readQuests(value: unknown): Quests {
  return questsSchema.parse(value ?? {});
}

// --- Commands (every quest command is DM only and revision-checked) ---

/** The editable body of a quest. Status, audience and the chronicle have their own commands. */
export const questDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    main: z.boolean().optional(),
    summary: z.string().max(2000),
    giverNpcId: id.optional(),
    locationIds: z.array(id).max(MAX_QUEST_LOCATIONS).default([]),
    markers: z.array(questMarkerSchema.strict()).max(MAX_QUEST_MARKERS).default([]),
    areas: z.array(questAreaSchema.strict()).max(MAX_QUEST_AREAS).default([]),
    objectives: z
      .array(
        z
          .object({
            id,
            text: z.string().trim().min(1).max(200),
            hidden: z.boolean().optional(),
            optional: z.boolean().optional(),
            locationId: id.optional(),
            marker: questMarkerSchema.strict().optional(),
          })
          .strict(),
      )
      .max(MAX_QUEST_OBJECTIVES)
      .default([]),
    rewardText: z.string().max(300).optional(),
    dmNotes: z.string().max(4000).optional(),
  })
  .strict();
export type QuestDraft = z.infer<typeof questDraftSchema>;

/** Also post existing chat notes: one private DM message per character who can read the quest. */
const message = z.boolean().optional();
/** The quest revision the DM saw; null creates a new quest whose ID is the command ID. */
const expected = { questId: id, revision };
export const questCommands = [
  z
    .object({
      id,
      kind: z.literal("quest-save"),
      questId: id.nullable(),
      revision: revision.nullable(),
      quest: questDraftSchema,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("quest-reveal"),
      ...expected,
      audience: questAudienceSchema,
      text: z.string().trim().max(1000).optional(),
      message,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("quest-objective"),
      ...expected,
      objectiveId: id,
      action: z.enum(["open", "done", "failed", "reveal", "hide"]),
      text: z.string().trim().max(1000).optional(),
      message,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("quest-log"),
      ...expected,
      text: z.string().trim().min(1).max(1000),
      shared: z.boolean(),
      message,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("quest-close"),
      ...expected,
      /** "active" reopens a closed quest. */
      status: z.enum(questStatuses),
      text: z.string().trim().max(1000).optional(),
      message,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("quest-link-reward"),
      ...expected,
      link: z.object({ kind: z.enum(questRewardKinds), id }).strict(),
      remove: z.boolean().optional(),
    })
    .strict(),
  z.object({ id, kind: z.literal("quest-archive"), ...expected, archived: z.boolean() }).strict(),
  /** Only a never-revealed draft can be deleted; a revealed quest is archived instead. */
  z.object({ id, kind: z.literal("quest-delete"), ...expected }).strict(),
] as const;
export type QuestCommand = z.infer<(typeof questCommands)[number]>;
export const questKinds: ReadonlySet<string> = new Set(questCommands.map((c) => c.shape.kind.value));
