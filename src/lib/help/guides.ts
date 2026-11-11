import { HELP_GROUPS, type HelpGroup } from "./content.ts";
import { PLAYER_HELP_GROUPS } from "./player-content.ts";
import type { HelpGuide } from "./guide-choice.ts";

/** Joins guide groups in order. A topic whose ID an earlier group already holds is left out, so
 * a guide's own wording wins over a shared copy and every element ID stays unique. Groups left
 * with no topics are dropped. */
export function joinGuideGroups(...parts: readonly HelpGroup[][]): HelpGroup[] {
  const seen = new Set<string>();
  const joined: HelpGroup[] = [];
  for (const group of parts.flat()) {
    const topics = group.topics.filter((t) => !seen.has(t.id));
    for (const t of topics) seen.add(t.id);
    if (topics.length)
      joined.push(topics.length === group.topics.length ? group : { ...group, topics });
  }
  return joined;
}

/** The groups each Help guide shows. The player guide carries no DM setup links; only the
 * shared install topics join it, after the player's own topics. */
export const HELP_GUIDE_GROUPS: Record<HelpGuide, HelpGroup[]> = {
  player: joinGuideGroups(
    PLAYER_HELP_GROUPS,
    HELP_GROUPS.filter((g) => g.id === "install"),
  ),
  dm: HELP_GROUPS,
};
