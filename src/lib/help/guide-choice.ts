/** Which Help guide is shown: the player guide or the Dungeon Master guide (W-3). */
export type HelpGuide = "player" | "dm";

/** The guide a `?guide=` search value asks for, or null for none or an unknown value. */
export function guideFromSearch(search: unknown): HelpGuide | null {
  const value =
    search && typeof search === "object" ? (search as Record<string, unknown>).guide : undefined;
  return value === "player" || value === "dm" ? value : null;
}

type Groups = readonly { id: string; topics: readonly { id: string }[] }[];

/** For a `#topic` link with no `?guide=`: the guide that alone holds that topic or group, so
 * older links to a player-only topic still open it. Null when both guides (or neither) have it. */
export function guideForHash(hash: string, sources: Record<HelpGuide, Groups>): HelpGuide | null {
  const id = hash.replace(/^#/, "");
  if (!id) return null;
  const has = (groups: Groups) =>
    groups.some((g) => g.id === id || g.topics.some((t) => t.id === id));
  const player = has(sources.player),
    dm = has(sources.dm);
  return player && !dm ? "player" : dm && !player ? "dm" : null;
}
