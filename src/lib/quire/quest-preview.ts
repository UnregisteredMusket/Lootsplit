/**
 * "View as player" (docs/QUESTS.md): the DM's preview runs the real player projection on a copy of
 * the table for one character, so it leaves out exactly what that player's device would never
 * receive (hidden objectives and their chronicle lines, DM-only lines, a giver or place they
 * cannot read, pins and receipts they cannot see). A draft is previewed as a party reveal.
 */
import type { CloudTable } from "./cloud.ts";
import { projectRecord } from "./session-records.ts";
import { questsOf } from "./quests.ts";
import type { Quest } from "./quests-schema.ts";

export function previewQuestAs(
  table: CloudTable,
  questId: string,
  purseId: string,
): { quest: Quest | undefined; table: CloudTable } {
  const copy = structuredClone(table);
  const store = (copy.journal as { quests?: { quests: Quest[] } } | undefined)?.quests;
  const stored = store?.quests.find((q) => q.id === questId);
  if (stored && stored.audience.kind === "none") stored.audience = { kind: "party" };
  const projected = projectRecord(copy, { role: "player", purseIds: [purseId] });
  return { quest: questsOf(projected).find((q) => q.id === questId), table: projected };
}
