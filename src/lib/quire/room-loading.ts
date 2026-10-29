/**
 * Progress of a campaign load or catch-up that downloads view sections (tabletop protocol 11,
 * room-transport.ts). The loading screen reads it; nothing else depends on it.
 */
export type RoomLoading = {
  /** The campaign code being loaded. */
  code: string;
  totalBytes: number;
  loadedBytes: number;
  totalSections: number;
  loadedSections: number;
};

let current: RoomLoading | null = null;
let cancelled: string | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const fn of listeners) fn();
};

export function getRoomLoading(): RoomLoading | null {
  return current;
}
export function subscribeRoomLoading(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function startRoomLoading(code: string, totalBytes: number, totalSections: number) {
  cancelled = null;
  current = { code, totalBytes, loadedBytes: 0, totalSections, loadedSections: 0 };
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
/** The person chose to go back: the running load stops after its current batch. */
export function cancelRoomLoading() {
  if (current) cancelled = current.code;
  finishRoomLoading();
}
export class RoomLoadingCancelled extends Error {
  constructor() {
    super("Loading the campaign was stopped. Open it again to continue; nothing was changed.");
  }
}
export function throwIfRoomLoadingCancelled(code: string) {
  if (cancelled === code) {
    cancelled = null;
    throw new RoomLoadingCancelled();
  }
}
