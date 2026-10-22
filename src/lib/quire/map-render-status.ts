import type { CampaignMap } from "./world-schema.ts";
import type { CloudTable } from "./cloud.ts";
import { concealedMapImage, mapNeedsMask, readMapTabletop } from "./tabletop.ts";

/**
 * Protected player views (fog or vision) are rendered on the DM's device and uploaded per audience
 * and revision. This module holds the pure parts of that flow: what is still missing, when the
 * next render should start, and what the DM and players are told while they wait.
 */

/** Wait this long after the last visibility change before rendering (rapid token moves). */
export const RENDER_DEBOUNCE_MS = 600;
/** …but never longer than this after the first unrendered change, so dragging still updates. */
export const RENDER_MAX_WAIT_MS = 2000;
/** The DM's badge appears only when a render has been pending this long. */
export const RENDER_BADGE_DELAY_MS = 1500;

export const PLAYER_RENDER_WAIT_MESSAGE = "Waiting for the DM's device to update the map…";

/** Audiences whose current-revision view a map still needs, for the DM's publisher. */
export function missingPlayerViews(table: Pick<CloudTable, "purses">, map: CampaignMap) {
  const settings = readMapTabletop(map);
  if (!map.tabletop || !map.visible || !mapNeedsMask(settings)) return [];
  const audiences =
    settings.vision === "individual"
      ? ["party", ...table.purses.filter((p) => p.kind === "character").map((p) => "purse:" + p.id)]
      : ["party"];
  return audiences.filter(
    (audience) =>
      !settings.frames.some(
        (frame) => frame.audience === audience && frame.revision === settings.revision,
      ),
  );
}

/**
 * Whether a player's (projected) map is concealed only because the DM's device has not yet
 * published the current view. Uses projected data alone: the placeholder image and the absence
 * of a current frame, never fog geometry.
 */
export function awaitingPlayerView(map: Pick<CampaignMap, "image" | "tabletop">) {
  return map.image === concealedMapImage && !map.tabletop?.frames?.length;
}

export type RenderPhase = "idle" | "waiting" | "rendering" | "failed";
export type RenderState = {
  phase: RenderPhase;
  /** The first visibility change not yet covered by a finished render. */
  firstChangeAt?: number;
  lastChangeAt?: number;
  error?: string;
};
export type RenderEvent =
  | { type: "change"; at: number; missing: number }
  | { type: "start"; at: number }
  | { type: "done"; at: number; missing: number }
  | { type: "fail"; at: number; error: string }
  | { type: "retry"; at: number };

export const initialRenderState: RenderState = { phase: "idle" };

/** The publisher's state machine. Pure and clock-free: callers pass `at`. */
export function renderReducer(state: RenderState, event: RenderEvent): RenderState {
  switch (event.type) {
    case "change":
      if (!event.missing) return { phase: "idle" };
      // A change supersedes any render in progress (its work is cancelled) and retries after a
      // failure; the failure stays reported until a render succeeds.
      return {
        phase: "waiting",
        firstChangeAt: state.phase === "failed" ? event.at : (state.firstChangeAt ?? event.at),
        lastChangeAt: event.at,
        ...(state.error ? { error: state.error } : {}),
      };
    case "start":
      return { ...state, phase: "rendering" };
    case "done":
      return event.missing
        ? {
            phase: "waiting",
            firstChangeAt: state.firstChangeAt ?? event.at,
            lastChangeAt: state.lastChangeAt ?? event.at,
          }
        : { phase: "idle" };
    case "fail":
      return { ...state, phase: "failed", error: event.error };
    case "retry":
      return { phase: "waiting", firstChangeAt: event.at, lastChangeAt: event.at };
  }
}

/** Milliseconds until the next render should start (0 = now), or undefined when none is due. */
export function renderDelay(state: RenderState, now: number) {
  if (state.phase !== "waiting" || state.lastChangeAt === undefined) return undefined;
  const due = Math.min(
    state.lastChangeAt + RENDER_DEBOUNCE_MS,
    (state.firstChangeAt ?? state.lastChangeAt) + RENDER_MAX_WAIT_MS,
  );
  return Math.max(0, due - now);
}

/** The DM's badge, if any: a failure always shows; a pending render after a short delay. */
export function renderBadge(state: RenderState, now: number) {
  if (state.error)
    return {
      tone: "alert" as const,
      text: `Player view update failed; players see the map concealed. ${state.error ?? ""}`.trim(),
    };
  if (
    (state.phase === "waiting" || state.phase === "rendering") &&
    state.firstChangeAt !== undefined &&
    now - state.firstChangeAt >= RENDER_BADGE_DELAY_MS
  )
    return {
      tone: "status" as const,
      text: "Player view is updating on this device; players see the map concealed until it finishes.",
    };
  return undefined;
}

/** A tiny shared store so the map workspace can show the publisher's state and request a retry. */
let current: RenderState = initialRenderState;
const listeners = new Set<() => void>();
let retryHandler: (() => void) | undefined;
export const renderStatusStore = {
  get: () => current,
  set(next: RenderState) {
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  onRetry(handler: (() => void) | undefined) {
    retryHandler = handler;
  },
  retry: () => retryHandler?.(),
};
