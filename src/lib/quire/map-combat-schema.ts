import { z } from "zod";
import { sceneCameraSchema } from "./tabletop-schema.ts";
const id = z.string().min(1).max(150);
/** Private DM recovery state; only the separate presentation is shared. */
export const mapCombatBindingSchema = z
  .object({
    id,
    encounterId: id,
    encounterRevision: z.number().int().nonnegative(),
    mapId: id,
    mode: z.enum(["grid", "theatre"]),
    phase: z.enum(["prepared", "active"]),
    gridFingerprint: z.string().max(1000).optional(),
    scaleConfirmed: z.boolean(),
    showPlayers: z.boolean(),
    returnMapId: id,
    returnCamera: sceneCameraSchema,
  })
  .strict();
export type MapCombatBinding = z.infer<typeof mapCombatBindingSchema>;
export const mapCombatHudSchema = z
  .object({
    mapId: id,
    status: z.enum(["draft", "active", "concluded"]),
    round: z.number().int().nonnegative(),
    activeTokenId: id.optional(),
  })
  .strict();
export type MapCombatHud = z.infer<typeof mapCombatHudSchema>;
