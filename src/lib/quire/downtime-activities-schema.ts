import { z } from "zod";

const id = z.string().min(1).max(150);
const minutes = z.number().int().nonnegative().max(1e12);
export const downtimeSettingsSchema = z.object({
  hoursPerDay: z.number().int().min(1).max(24).default(16),
  trainingHoursPerDay: z.number().int().min(1).max(24).default(8),
});
export const trainingCategorySchema = z.enum(["martial", "academic", "profession"]);
export const trainingRequestSchema = z.object({
  id,
  windowId: id,
  trainerId: id,
  npcId: id,
  trainerName: z.string().max(160),
  npcName: z.string().max(160),
  category: trainingCategorySchema,
  topic: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  className: z.string().trim().max(120),
  minutes: minutes.min(1),
  trainingHoursPerDay: z.number().int().min(1).max(24),
  status: z.enum(["pending", "approved", "denied", "cancelled"]),
  at: z.number(),
  decidedAt: z.number().optional(),
  reviewNote: z.string().max(4000).default(""),
  historicalContext: z.string().trim().min(1).max(4000).optional(),
  /** Paid lessons (services wave 2): the trainer order; the character is the pupil, the NPC teaches. */
  lessonOrderId: id.optional(),
  /** Paid lessons: this session's fee in copper, charged once when the DM approves it. */
  feeCopper: z.number().int().min(0).max(1e12).optional(),
});
export const trainingResetSchema = z.object({
  id,
  trainerId: id,
  npcId: id,
  category: trainingCategorySchema,
  topic: z.string().max(160),
  requestIds: z.array(id),
  at: z.number(),
  note: z.string().trim().min(1).max(4000),
});
export const downtimeWindowSchema = z.object({
  id,
  name: z.string().max(100),
  fromDay: z.number().int().nonnegative(),
  days: z.number().int().min(1).max(3650),
  settings: downtimeSettingsSchema,
  budgets: z.array(z.object({ purseId: id, totalMinutes: minutes, committedMinutes: minutes })),
});
export const downtimeActivitiesSchema = z.object({
  settings: downtimeSettingsSchema.default({ hoursPerDay: 16, trainingHoursPerDay: 8 }),
  windows: z.array(downtimeWindowSchema).default([]),
  requests: z.array(trainingRequestSchema).default([]),
  resets: z.array(trainingResetSchema).default([]),
});
export const downtimeActivityQuoteSchema = z.object({
  before: z.string(),
  window: downtimeWindowSchema,
});
export type DowntimeActivities = z.infer<typeof downtimeActivitiesSchema>;
export type TrainingRequest = z.infer<typeof trainingRequestSchema>;
export type DowntimeActivityCommand = z.infer<(typeof downtimeActivityCommands)[number]>;
export const readDowntimeActivities = (value?: unknown) =>
  downtimeActivitiesSchema.parse(value ?? {});
export const downtimeActivityCommands = [
  z
    .object({
      id,
      kind: z.literal("downtime-settings"),
      before: downtimeSettingsSchema,
      settings: downtimeSettingsSchema,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("downtime-training"),
      windowId: id,
      trainerId: id,
      npcId: id,
      category: trainingCategorySchema,
      topic: z.string().trim().min(1).max(160),
      description: z.string().max(4000),
      className: z.string().trim().max(120).default(""),
      minutes: minutes.min(1),
      historicalContext: z.string().trim().min(1).max(4000).optional(),
      lessonOrderId: id.optional(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("downtime-training-review"),
      requestId: id,
      before: trainingRequestSchema,
      approve: z.boolean(),
      note: z.string().max(4000),
      historicalConfirmed: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("downtime-training-cancel"),
      requestId: id,
      before: trainingRequestSchema,
    })
    .strict(),
  z
    .object({
      id: id.max(140),
      kind: z.literal("downtime-training-reset-category"),
      npcId: id,
      category: trainingCategorySchema,
      before: z.array(id),
      note: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("downtime-training-reset"),
      trainerId: id,
      npcId: id,
      category: trainingCategorySchema,
      topic: z.string().max(160),
      before: z.array(id),
      note: z.string().trim().min(1).max(4000),
    })
    .strict(),
] as const;
