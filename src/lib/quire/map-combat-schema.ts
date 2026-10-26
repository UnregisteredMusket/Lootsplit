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

/**
 * A seat's initiative panel (map controls PR 6): the turn order of combatants whose token is
 * revealed to this seat on this map, the round and active turn, and HP only for the seat's own
 * characters. Never enemy or other players' HP, hidden combatants, conditions or notes.
 * A separate response from the HUD, so older clients' strict HUD schema is unaffected.
 */
export const mapCombatOrderSchema = z
  .object({
    mapId: id,
    status: z.enum(["draft", "active", "concluded"]),
    round: z.number().int().nonnegative(),
    entries: z
      .array(
        z
          .object({
            tokenId: id,
            label: z.string().max(160),
            initiative: z.number().finite().nullable(),
            active: z.boolean(),
            own: z.boolean(),
            hp: z.number().int().optional(),
            maxHp: z.number().int().optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type MapCombatOrder = z.infer<typeof mapCombatOrderSchema>;
