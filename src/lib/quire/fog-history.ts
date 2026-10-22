import { canonicalJson } from "./canonical-json.ts";
import type {
  FogDiff,
  FogHistoryEntry,
  FogShape,
  FogState,
  MapTabletop,
} from "./tabletop-schema.ts";

/**
 * Fog undo/redo history. Each stack is ordered oldest → newest; the newest entry restores the
 * state before the current fog, and every older entry restores the state before the one above
 * it. Entries are compact diffs (`fog-diff`); older rooms may still hold full snapshots, which
 * restore exactly as before and are converted to diffs on the next fog write.
 */
export const FOG_HISTORY_DEPTH = 20;
export const isFogDiff = (entry: unknown): entry is FogDiff =>
  !!entry && typeof entry === "object" && (entry as { kind?: unknown }).kind === "fog-diff";

const shapeKey = (shape: FogShape) => canonicalJson(shape);

/** The entry that turns `from` into exactly `to` (by canonical comparison). */
export function fogDiff(from: FogState, to: FogState): FogDiff {
  const limit = Math.min(from.shapes.length, to.shapes.length);
  let keep = 0;
  while (
    keep < limit &&
    from.shapes[keep].id === to.shapes[keep].id &&
    shapeKey(from.shapes[keep]) === shapeKey(to.shapes[keep])
  )
    keep++;
  return {
    kind: "fog-diff",
    keep,
    add: structuredClone(to.shapes.slice(keep)),
    enabled: to.enabled,
    base: to.base,
  };
}

/** The fog state a history entry restores when applied on top of `current`. */
export function applyFogEntry(current: FogState, entry: FogHistoryEntry): FogState {
  if (!isFogDiff(entry)) return structuredClone(entry);
  if (entry.keep > current.shapes.length)
    throw Error("This exploration history no longer matches the map. Refresh before undoing.");
  return {
    enabled: entry.enabled,
    base: entry.base,
    shapes: structuredClone([...current.shapes.slice(0, entry.keep), ...entry.add]),
  };
}

/** Full snapshots for a stack (oldest → newest), as tabletop protocol 2 stored them. */
export function expandFogHistory(current: FogState, stack: FogHistoryEntry[]): FogState[] {
  const states: FogState[] = [];
  let state = current;
  for (let i = stack.length - 1; i >= 0; i--) {
    state = applyFogEntry(state, stack[i]);
    states.unshift(state);
  }
  return states;
}

/** Diffs for absolute states (oldest → newest) relative to `current`. */
function encode(current: FogState, states: FogState[]): FogDiff[] {
  return states.map((state, i) =>
    fogDiff(i === states.length - 1 ? current : states[i + 1], state),
  );
}

/**
 * Converts a stack to compact diffs relative to `current`. `base` is the fog the stack was last
 * relative to (defaults to `current`). Already-compact stacks with an unchanged base are kept
 * as they are; a stack that cannot be read safely is never dropped, only kept unchanged.
 */
export function compactFogHistory(
  current: FogState,
  stack: FogHistoryEntry[],
  base: FogState = current,
): FogHistoryEntry[] {
  if (
    stack.every(isFogDiff) &&
    (base === current || canonicalJson(base) === canonicalJson(current))
  )
    return stack;
  try {
    return encode(current, expandFogHistory(base, stack));
  } catch {
    return stack;
  }
}

export const tabletopHasFogDiffs = (settings: Partial<Pick<MapTabletop, "fogUndo" | "fogRedo">>) =>
  !!settings.fogUndo?.some(isFogDiff) || !!settings.fogRedo?.some(isFogDiff);

/** Same tabletop with full-snapshot history, for clients on tabletop protocol 2 or older. */
export function expandTabletopHistory<T extends Partial<MapTabletop>>(settings: T): T {
  if (!settings.fog || !tabletopHasFogDiffs(settings)) return settings;
  const fog = settings.fog;
  const expand = (stack: FogHistoryEntry[] | undefined) => {
    if (!stack) return stack;
    try {
      return expandFogHistory(fog, stack);
    } catch {
      // Unreadable history is shown to older apps as empty rather than as an invalid shape;
      // the stored history is unchanged.
      return [];
    }
  };
  return { ...settings, fogUndo: expand(settings.fogUndo), fogRedo: expand(settings.fogRedo) };
}

/**
 * Normalizes history supplied with a whole tabletop (map-tabletop / map-save). The supplied
 * history is read relative to `base` (the fog the client last saw) and re-encoded relative to the
 * supplied fog, so undo restores exactly what full snapshots would have restored.
 */
export function compactTabletopHistory<T extends MapTabletop>(settings: T, base?: FogState): T {
  const from = base ?? settings.fog;
  return {
    ...settings,
    fogUndo: compactFogHistory(settings.fog, settings.fogUndo, from),
    fogRedo: compactFogHistory(settings.fog, settings.fogRedo, from),
  };
}

/** Stored size of a map's fog and its undo/redo history, in UTF-8 bytes. */
export function fogStorageBytes(settings: Pick<MapTabletop, "fog" | "fogUndo" | "fogRedo">) {
  return new TextEncoder().encode(
    JSON.stringify({ fog: settings.fog, fogUndo: settings.fogUndo, fogRedo: settings.fogRedo }),
  ).length;
}
