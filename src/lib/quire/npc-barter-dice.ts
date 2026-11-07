/**
 * Which NPC barter checks the DM's screen throws as 3D dice (npc-barter-desk.tsx).
 *
 * A check is thrown when it appears while the DM is watching: a roll the DM asked for on this
 * screen, or one the server rolled when a player sent an offer (modes "confirm" and "auto").
 * Checks already rolled when the screen first loaded its campaign are the baseline and are never
 * replayed (on a reload or a return to the screen). Each check is thrown once (`npc-barter-<id>`).
 */
export type RolledAttempt = { id: string; roll?: unknown };

/**
 * @param known IDs of rolled checks already seen on this screen, or null before the first loaded
 *   view; it is filled in (the first loaded view only records the baseline).
 * @param requested checks the DM asked for on this screen; a thrown one is removed.
 * @returns the attempts to throw now, in list order.
 */
export function barterRollsToThrow<T extends RolledAttempt>(
  attempts: readonly T[],
  known: Set<string> | null,
  requested: Set<string>,
): { known: Set<string>; throwNow: T[] } {
  const rolled = attempts.filter((a) => a.roll);
  const seen = known ?? new Set(rolled.map((a) => a.id));
  const throwNow: T[] = [];
  for (const a of rolled) {
    if (seen.has(a.id) && !requested.has(a.id)) continue;
    seen.add(a.id);
    requested.delete(a.id);
    throwNow.push(a);
  }
  return { known: seen, throwNow };
}
