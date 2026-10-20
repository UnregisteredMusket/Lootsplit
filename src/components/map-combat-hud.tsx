import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getCloudTable,
  getServerCloudTable,
  subscribeCloudTable,
  readSharedMapCombat,
  captureMutationScope,
  assertMutationScope,
} from "@/lib/quire/cloud-client";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { projectMapCombat } from "@/lib/quire/map-combat";
import type { CampaignMap } from "@/lib/quire/world-schema";
import type { MapCombatHud } from "@/lib/quire/map-combat-schema";
export function MapCombatHud({ map }: { map: CampaignMap }) {
  const table = useWorldTable(),
    seat = useSeat(),
    cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable),
    binding = table.journal.world?.combat,
    presentation = table.journal.world?.tabletop?.presentation;
  const scope =
    seat.role === "dm"
      ? binding?.mapId === map.id && binding.phase === "active"
        ? binding.id
        : undefined
      : presentation?.mapId === map.id
        ? presentation.id
        : undefined;
  const [state, setState] = useState<{ scope: string; hud: MapCombatHud | null; error?: string }>();
  useEffect(() => {
    if (!scope) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const expected = captureMutationScope();
    async function load() {
      try {
        let hud: MapCombatHud | null = null;
        if (cloud.joined) hud = await readSharedMapCombat(map.id);
        else if (seat.role === "dm" && binding) {
          const { encounterRequest } = await import("@/lib/encounters/client");
          const row = await encounterRequest<{
            code: string;
            status: string;
            body: { round: number; activeId: string };
          }>("encounters/detail", { id: binding.encounterId });
          assertMutationScope(expected);
          if (row.code === "device") hud = projectMapCombat(map, binding.encounterId, row);
        }
        assertMutationScope(expected);
        if (!cancelled) setState({ scope: scope!, hud });
      } catch {
        if (!cancelled)
          setState({
            scope: scope!,
            hud: null,
            error: "Combat view unavailable. Refresh or check connection status.",
          });
      }
      if (!cancelled) timer = setTimeout(() => void load(), 3000);
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scope, map, cloud.joined, seat.role, binding]);
  if (!scope) return null;
  const current = state?.scope === scope ? state : undefined,
    hud = current?.hud,
    token = map.tokens?.find((t) => t.id === hud?.activeTokenId);
  return (
    <div className="map-combat-hud" aria-label="Map combat status" role="status">
      {current?.error ??
        (hud
          ? `${hud.status === "concluded" ? "Concluded · review loot" : hud.status === "draft" ? "Prepared encounter" : `Round ${hud.round}`} · ${token ? `${token.label}’s turn` : "No revealed active token"}`
          : "Opening combat view…")}
    </div>
  );
}
