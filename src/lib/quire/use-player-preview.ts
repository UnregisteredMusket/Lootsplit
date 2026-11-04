/** React readers for the DM's read-only "Preview as player" (player-preview.ts). */
import { useSyncExternalStore } from "react";
import { DM_SEAT, getActualSeat, subscribeSeat } from "./table.ts";
import { useSeatKnown } from "./seat.tsx";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "./cloud-client.ts";
import { getPreview, subscribePreview } from "./player-preview.ts";

const serverPreview = () => null;
export function usePlayerPreview() {
  return useSyncExternalStore(subscribePreview, getPreview, serverPreview);
}

/** True for this device's own DM seat (also while it previews; a player can never preview). */
export function useActualDm(): boolean {
  const known = useSeatKnown();
  const seat = useSyncExternalStore(subscribeSeat, getActualSeat, () => DM_SEAT);
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  // In a shared room the DM's seat is the host's; a player's device has a player seat.
  return known && seat.role === "dm" && (!room.joined || room.role === "dm" || getPreview() !== null);
}
