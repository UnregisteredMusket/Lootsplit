/** Split the party and journeys: which group a booking or plan moves. */
import type { CloudTable } from "./cloud.ts";
import { MAIN_GROUP, purseGroup, resolveGroup } from "./party-groups.ts";

/** A coach carries the paying character's group; party funds and characters away: the main group. */
export function coachGroup(t: Pick<CloudTable, "journal" | "purses">, purseId: string) {
  const g = purseGroup(t, purseId);
  const p = t.purses.find((x) => x.id === purseId);
  return g && p?.kind === "character" ? resolveGroup(t, g) : MAIN_GROUP;
}
