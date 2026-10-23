/**
 * Party journeys and travel settings (journey planner phase B, docs/MAP-TILES.md "Journey
 * planner"). The record schemas live in world-schema.ts (the world record embeds them); this
 * module adds the commands. Optional journal fields: old saves load unchanged, no D1 migration.
 */
import { z } from "zod";
import { journeySchema, travelSettingsSchema } from "./world-schema.ts";
export {
  journeySchema,
  travelSettingsSchema,
  readTravel,
  DEFAULT_TRAVEL,
  OPEN_JOURNEY_STATUSES,
  journeyStatuses,
  pacePresets,
  journeyPointSchema,
  journeyLegSchema,
  journeyFrameSchema,
  type Journey,
  type JourneyPoint,
  type JourneyLeg,
  type TravelSettings,
} from "./world-schema.ts";
const id = z.string().min(1).max(150);
export const journeyCommands = [
  z
    .object({
      id,
      kind: z.literal("travel-settings"),
      before: travelSettingsSchema.nullable(),
      after: travelSettingsSchema.nullable(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("party-journey"),
      journeyId: id,
      before: journeySchema.nullable(),
      journey: journeySchema,
    })
    .strict(),
] as const;
export type JourneyCommand = z.infer<(typeof journeyCommands)[number]>;
export const journeyKinds = new Set(["travel-settings", "party-journey"]);
