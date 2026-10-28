import { encounterSchema } from "./model.mjs";
import type { z } from "zod";
import { copyName } from "../quire/duplicate.ts";

type Encounter = z.infer<typeof encounterSchema>;

/**
 * A fresh copy of an encounter (design Q9): the same combatants, loot, tables and coins, ready
 * to run again. Combat progress resets (round 1, no active turn, full HP, no rolled initiative or
 * conditions). The copy is a new draft; the original's status, rolls and award stay with it.
 */
export function duplicateEncounter(e: Encounter): Encounter {
  return encounterSchema.parse({
    ...structuredClone(e),
    name: copyName(e.name, 120),
    round: 1,
    activeId: "",
    combatants: e.combatants.map((c) => ({ ...structuredClone(c), hp: c.maxHp, initiative: null, conditions: "" })),
  });
}
