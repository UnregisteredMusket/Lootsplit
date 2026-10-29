/**
 * Add creatures here (map tokens PR 6; privacy review 2026-10-29): the encounter save and the token
 * placement are separate requests, so a retry after a lost response must not add the creatures
 * again. One attempt keeps its combatant and token IDs (made on the device) for as long as the
 * picks and the chosen encounter stay the same; the save then adds only combatants the encounter
 * doesn't have yet, and the placement skips tokens already on the map.
 */
export type CreatureAttempt = { key: string; encounterId: string; combatantIds: string[]; tokenIds: string[] };

/** What an attempt is for: the chosen encounter ("new" or its ID) and the picks. */
export const attemptKey = (picks: readonly { key: string; count: number }[], encounterChoice: string) =>
  JSON.stringify([encounterChoice, picks.map((p) => [p.key, p.count])]);

/** The attempt for these picks: the previous one when nothing changed, else fresh IDs. */
export function creatureAttempt(
  previous: CreatureAttempt | null,
  picks: readonly { key: string; count: number }[],
  encounterChoice: string,
  newId: () => string,
): CreatureAttempt {
  const key = attemptKey(picks, encounterChoice);
  if (previous?.key === key) return previous;
  const total = picks.reduce((n, p) => n + p.count, 0);
  return {
    key,
    encounterId: encounterChoice === "new" ? newId() : encounterChoice,
    combatantIds: Array.from({ length: total }, newId),
    tokenIds: Array.from({ length: total }, newId),
  };
}

/** The encounter's combatants with `joining` added once (by ID): a retried save adds nothing. */
export function withCombatants<T extends { id: string }>(existing: readonly T[], joining: readonly T[]) {
  const have = new Set(existing.map((c) => c.id));
  const added = joining.filter((c) => !have.has(c.id));
  return { combatants: [...existing, ...added], added: added.length };
}
