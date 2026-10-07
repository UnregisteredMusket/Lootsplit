import { getServerCloudTable } from "@/lib/quire/cloud-client";
import { useSyncExternalStore } from "react";
import { getCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";

export function TurnLine({ paper = false }: { paper?: boolean }) {
  const table = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  if (!table.joined || table.live) return null;
  const text = table.readOnly ? "Session ended. Your campaign information is available to view; changes are locked." : table.mine ? "It is your turn." : `It is ${table.who}'s turn.`;
  return <p className={paper ? "mt-2 text-sm text-paper-muted" : "mt-2 text-sm text-muted"}>{text}</p>;
}

export function turnLocked(): boolean {
  const table = getCloudTable();
  return table.joined && !table.live && !table.mine;
}
