/**
 * Progress of a campaign load or catch-up that downloads view sections (tabletop protocol 11,
 * room-sync.ts), for the loading screen (components/campaign-loading.tsx).
 *
 * "Go back" pauses section downloads for that campaign in this tab: the running load stops after
 * its current batch and later reads that would need a download fail with `RoomLoadingPaused`
 * (no request is made) until "Continue loading". Views that arrive complete (small changes) still
 * apply while paused. Nothing is ever written by pausing.
 */
export type RoomLoading = {
  /** The campaign code being loaded. */
  code: string;
  totalBytes: number;
  loadedBytes: number;
  totalSections: number;
  loadedSections: number;
  startedAt: number;
};

/** Downloads at least this large show the loading screen; smaller catch-ups stay silent. */
export const LOADING_SCREEN_BYTES = 300_000;

let current: RoomLoading | null = null;
let paused: string | null = null;
let snapshot: { loading: RoomLoading | null; paused: string | null } = {
  loading: null,
  paused: null,
};
const listeners = new Set<() => void>();
const emit = () => {
  snapshot = { loading: current, paused };
  for (const fn of listeners) fn();
};

export function getRoomLoading(): RoomLoading | null {
  return current;
}
/** Stable snapshot for useSyncExternalStore. */
export function getRoomLoadingState() {
  return snapshot;
}
export function subscribeRoomLoading(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function startRoomLoading(code: string, totalBytes: number, totalSections: number) {
  current = {
    code,
    totalBytes,
    loadedBytes: 0,
    totalSections,
    loadedSections: 0,
    startedAt: Date.now(),
  };
  emit();
}
export function advanceRoomLoading(bytes: number, sections: number) {
  if (!current) return;
  current = {
    ...current,
    loadedBytes: Math.min(current.totalBytes, current.loadedBytes + bytes),
    loadedSections: Math.min(current.totalSections, current.loadedSections + sections),
  };
  emit();
}
export function finishRoomLoading() {
  if (!current) return;
  current = null;
  emit();
}
/** "Go back": stop downloading this campaign's sections in this tab. */
export function pauseRoomLoading(code: string) {
  paused = code;
  current = null;
  emit();
}
/** "Continue loading", or the campaign opened again. */
export function resumeRoomLoading() {
  if (paused === null) return;
  paused = null;
  emit();
}
export function roomLoadingPaused(code: string) {
  return paused === code;
}
export class RoomLoadingPaused extends Error {
  constructor() {
    super(
      "Loading this large campaign is paused. Choose Continue loading to finish it; nothing was changed.",
    );
  }
}
export function throwIfRoomLoadingPaused(code: string) {
  if (paused === code) throw new RoomLoadingPaused();
}

/** True when every byte and part of the load has arrived. */
export function roomLoadingComplete(loading: RoomLoading) {
  return (
    loading.loadedBytes >= loading.totalBytes && loading.loadedSections >= loading.totalSections
  );
}
/**
 * Whole percent loaded for the loading screen: real bytes over the total, rounded down, kept
 * within 0–100, and 100 only once the load is complete (99 until then).
 */
export function loadingPercent(loadedBytes: number, totalBytes: number, complete: boolean) {
  if (complete) return 100;
  if (!(totalBytes > 0) || !(loadedBytes > 0)) return 0;
  const percent = Math.floor((loadedBytes * 100) / totalBytes);
  return Math.max(0, Math.min(99, percent));
}
/** The owner's "_%/_%" format: "42%/100%". */
export function formatLoadingPercent(percent: number) {
  return `${percent}%/100%`;
}
/** The step a polite live region announces: every 10 %, so screen readers are not flooded. */
export function announcedLoadingStep(percent: number) {
  return percent >= 100 ? 100 : Math.floor(percent / 10) * 10;
}
