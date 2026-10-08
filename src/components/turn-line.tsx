import { getServerCloudTable } from "@/lib/quire/cloud-client";
import { useSyncExternalStore } from "react";
import { getCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { getOnline, subscribeOnline } from "@/lib/mobile/online";
import { roomStatusLabels } from "@/lib/quire/room-state";

export function TurnLine({ paper = false }: { paper?: boolean }) {
  const table = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const online = useSyncExternalStore(subscribeOnline, getOnline, () => true);
  if (!table.joined || (table.live && !table.viewOnly)) return null;
  const labels = roomStatusLabels(table, { online });
  const text = table.viewOnly
    ? `${labels.play}.${online && table.lastSync !== 0 ? " The DM can prepare and resume play in Multiplayer." : ""}`
    : labels.turn || `${labels.room} · ${labels.play}`;
  return (
    <p className={paper ? "mt-2 text-sm text-paper-muted" : "mt-2 text-sm text-muted"}>
      {text}
    </p>
  );
}

export function turnLocked(): boolean {
  const table = getCloudTable();
  return table.joined && !table.live && !table.mine;
}
