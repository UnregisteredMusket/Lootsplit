import { useEffect, useState, useSyncExternalStore } from "react";
import { useSeat } from "@/lib/quire/seat";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import {
  RENDER_BADGE_DELAY_MS,
  renderBadge,
  renderStatusStore,
} from "@/lib/quire/map-render-status";

/** DM-only: a pending or failed protected player-view render, shown on the map workspace. */
export function MapRenderBadge() {
  const seat = useSeat(),
    cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable),
    state = useSyncExternalStore(
      renderStatusStore.subscribe,
      renderStatusStore.get,
      renderStatusStore.get,
    ),
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (state.firstChangeAt === undefined) return;
    const wait = state.firstChangeAt + RENDER_BADGE_DELAY_MS - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), wait + 20);
    return () => clearTimeout(timer);
  }, [state]);
  if (seat.role !== "dm" || !cloud.joined) return null;
  const badge = renderBadge(state, now);
  if (!badge) return null;
  return (
    <p
      className="map-render-badge"
      data-tone={badge.tone}
      role={badge.tone === "alert" ? "alert" : "status"}
    >
      <span aria-hidden="true">⚠</span> {badge.text}
      {badge.tone === "alert" && (
        <button type="button" onClick={() => renderStatusStore.retry()}>
          Retry player view
        </button>
      )}
    </p>
  );
}
