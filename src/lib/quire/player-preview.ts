/**
 * "Preview as player" (docs/FEATURE-INVENTORY.md, "Preview as player"): the DM sees the app as one player character
 * would, strictly read-only. In memory only: nothing about a preview is stored, synced or logged,
 * and a reload or a campaign switch ends it.
 *
 * While a preview runs:
 * - `getSeat()` (table.ts) answers the previewed player seat, so every screen renders as that
 *   player; the DM's own seat is untouched (`getActualSeat`) and `setSeat` is refused.
 * - The app's reads (`economyView`, the chat snapshot) are the seat's player view, computed on this
 *   device from the DM's copy with the server's own projection (`seatView`, player-view.ts).
 * - Every write is refused where it happens, not just hidden: this campaign's IndexedDB refuses
 *   read-write transactions (db.ts), room writes refuse before any request (room-transport.ts),
 *   and the shared-room poll applies nothing until the preview ends (cloud-client.ts).
 */
import type { Seat } from "./table.ts";
import { getActualSeat } from "./table.ts";

export type PlayerPreview = Readonly<{
  /** The character's name, shown in the banner. */
  name: string;
  purseIds: readonly string[];
  startedAt: number;
}>;

let current: PlayerPreview | null = null;
let seat: Seat | null = null;
const listeners = new Set<() => void>();

export class PreviewReadOnlyError extends Error {
  constructor(name = current?.name ?? "a player") {
    super(`Previewing as ${name} — read-only. Stop preview to make changes.`);
    this.name = "PreviewReadOnlyError";
  }
}

/**
 * The player's main screens a preview shows (Home and the character sheet, Party & inventory,
 * Campaign chat, Maps, Journal, Quests); every other screen says "Not available in preview".
 */
const PREVIEW_SCREENS = ["/", "/party", "/characters", "/share", "/maps", "/features/journal", "/features/quests"];
export function previewScreenAllowed(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  return PREVIEW_SCREENS.includes(path);
}

export function getPreview(): PlayerPreview | null {
  return current;
}

export function previewActive(): boolean {
  return current !== null;
}

/** The previewed player seat (stable while the preview runs), or null. */
export function previewSeat(): Seat | null {
  return seat;
}

export function previewSeatOf(preview: PlayerPreview | null): Seat | null {
  return preview ? { role: "player", purseIds: [...preview.purseIds], shopIds: [], openedAt: preview.startedAt } : null;
}

/** Throws the read-only refusal while a preview runs. Call before any change is made. */
export function assertNotPreviewing(): void {
  if (current) throw new PreviewReadOnlyError();
}

export function subscribePreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish() {
  for (const listener of [...listeners]) listener();
}

/** DM only: the device's own seat must be the DM's (a player's device holds only its own view). */
export function startPreview(input: { name: string; purseIds: readonly string[] }): void {
  if (getActualSeat().role !== "dm") throw new Error("Only the DM can preview as a player.");
  const purseIds = [...new Set(input.purseIds.filter((id) => typeof id === "string" && id))];
  if (!purseIds.length) throw new Error("Choose a character to preview.");
  current = Object.freeze({ name: input.name.trim() || "a player", purseIds: Object.freeze(purseIds), startedAt: Date.now() });
  seat = previewSeatOf(current);
  publish();
}

export function stopPreview(): void {
  if (!current) return;
  current = null;
  seat = null;
  publish();
}
