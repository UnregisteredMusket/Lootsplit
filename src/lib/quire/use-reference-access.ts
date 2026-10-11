import { useEffect, useState, useSyncExternalStore } from "react";
import { useSeat, useSeatKnown } from "./seat";
import { useEconomy } from "./economy-context";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "./cloud-client";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "./campaigns";
import { subscribeSheetChanges } from "./party-sheet-links";
import { activeLocalEncounter } from "../encounters/local";
import { referenceAccess, referencePolicy, type ReferenceSection } from "./reference-access";

export function useReferenceAccess() {
  const seat = useSeat(),
    known = useSeatKnown(),
    economy = useEconomy();
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const registry = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const [local, setLocal] = useState<{ campaign: string; active: boolean }>();
  useEffect(() => {
    if (room.joined || !economy.ready) return;
    let live = true,
      sequence = 0;
    const refresh = () => {
      const current = ++sequence;
      void activeLocalEncounter()
        .then((active) => {
          if (live && sequence === current) setLocal({ campaign: registry.activeId, active });
        })
        .catch(() => {
          // Unreadable encounter data must not silently enable a restricted player lookup.
          if (live && sequence === current) setLocal({ campaign: registry.activeId, active: true });
        });
    };
    refresh();
    const unsubscribe = subscribeSheetChanges(refresh);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [room.joined, economy.ready, registry.activeId]);
  const ready =
    known &&
    economy.ready &&
    (room.joined
      ? typeof room.encounterActive === "boolean"
      : local?.campaign === registry.activeId);
  const active = room.joined ? room.encounterActive === true : local?.active === true;
  const policy = referencePolicy(economy.journal.referenceAccess);
  const access = (section?: ReferenceSection) =>
    !ready
      ? { allowed: false, reason: "Checking reference access…" }
      : referenceAccess(seat.role, policy, active, section);
  return { ready, active, policy, access };
}
