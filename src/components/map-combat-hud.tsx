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
import { startVisiblePoll } from "@/lib/quire/visible-poll";
import { encounterDetailPoller } from "@/lib/encounters/detail-poller";
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
    let cancelled = false;
    const expected = captureMutationScope();
    const unavailable = () => {
      if (!cancelled)
        setState({
          scope: scope!,
          hud: null,
          error: "Combat view unavailable. Refresh or check connection status.",
        });
    };
    if (!cloud.joined) {
      if (seat.role !== "dm" || !binding) {
        setState({ scope, hud: null });
        return;
      }
      // Device campaign: the DM's own encounter, through the page's shared encounter poll.
      const unsubscribe = encounterDetailPoller.subscribe(binding.encounterId, {
        intervalMs: 3000,
        onResult: (value) => {
          try {
            assertMutationScope(expected);
            const row = value as { code: string; status: string; body: { round: number; activeId: string } };
            const hud = row.code === "device" ? projectMapCombat(map, binding.encounterId, row) : null;
            if (!cancelled) setState({ scope: scope!, hud });
          } catch {
            unavailable();
          }
        },
        onError: unavailable,
      });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }
    // Shared campaign: every 3 s while the tab is visible, catching up on return.
    const stop = startVisiblePoll(async () => {
      try {
        const hud = await readSharedMapCombat(map.id);
        assertMutationScope(expected);
        if (!cancelled) setState({ scope: scope!, hud });
      } catch {
        unavailable();
      }
    }, 3000);
    return () => {
      cancelled = true;
      stop();
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
