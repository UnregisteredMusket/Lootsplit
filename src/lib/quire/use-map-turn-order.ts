import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getCloudTable,
  getServerCloudTable,
  readSharedMapCombatOrder,
  subscribeCloudTable,
} from "./cloud-client";
import { startVisiblePoll } from "./visible-poll";
import { useWorldTable } from "./use-world-table";
import type { MapCombatOrder } from "./map-combat-schema";
import type { CampaignMap } from "./world-schema";

/**
 * The shared turn order for a player while the DM shows combat on this map (the same server
 * projection as Initiative: revealed tokens only), polled every 3 s while the tab is visible.
 * Null for DMs, device campaigns and maps without a presented encounter.
 */
export function useMapTurnOrder(map: CampaignMap, dm: boolean) {
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const presentation = useWorldTable().journal.world?.tabletop?.presentation;
  const presenting = !dm && cloud.joined && presentation?.mapId === map.id ? presentation.id : undefined;
  const [state, setState] = useState<{ key: string; order: MapCombatOrder | null }>();
  useEffect(() => {
    if (!presenting) return;
    let cancelled = false;
    const key = `${map.id}:${presenting}`;
    const stop = startVisiblePoll(async () => {
      try {
        const order = await readSharedMapCombatOrder(map.id);
        if (!cancelled) setState({ key, order });
      } catch {
        if (!cancelled) setState({ key, order: null });
      }
    }, 3000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [map.id, presenting]);
  return presenting && state?.key === `${map.id}:${presenting}` ? state.order : null;
}

