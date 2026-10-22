import { useEffect, useRef, useState } from "react";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { readTabletopSession } from "@/lib/quire/tabletop";
import type { CampaignMap } from "@/lib/quire/world-schema";
import type { MapPing } from "@/lib/quire/map-signals";
import {
  mapAnnouncements,
  mapSnapshot,
  pingAnnouncement,
  visibleLabels,
  type MapSnapshot,
} from "@/lib/quire/map-announcements";

/**
 * Polite screen-reader announcements for token moves, pings, scene activation and the protected
 * player view. It reads only the map and session this viewer already receives.
 */
export function MapAnnouncer({ map, pings }: { map: CampaignMap; pings: MapPing[] }) {
  const table = useWorldTable(),
    session = readTabletopSession(table),
    activeName = table.journal.world?.maps.find((m) => m.id === session.activeMapId)?.name;
  const [message, setMessage] = useState(""),
    previous = useRef<MapSnapshot | undefined>(undefined),
    heard = useRef(new Set<string>());
  const say = (messages: string[]) => {
    if (messages.length) setMessage(messages.join(" "));
  };
  const snapshot = mapSnapshot(map, { id: session.activeMapId, name: activeName });
  const key = JSON.stringify(snapshot);
  useEffect(() => {
    say(mapAnnouncements(previous.current, snapshot));
    previous.current = snapshot;
    // The serialized snapshot is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    const fresh = pings.filter((p) => !heard.current.has(p.id));
    if (!fresh.length) return;
    for (const ping of fresh) heard.current.add(ping.id);
    if (heard.current.size > 200) heard.current = new Set(pings.map((p) => p.id));
    const labels = visibleLabels(map);
    say(fresh.map((ping) => pingAnnouncement(ping, labels)));
    // Only newly received ping IDs are announced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pings]);
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true" data-map-announcer="true">
      {message}
    </p>
  );
}
