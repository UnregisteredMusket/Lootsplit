import { getCampaigns, serverCampaigns, subscribeCampaigns } from "@/lib/quire/campaigns";
import { readPartySheetLinks, subscribeSheetChanges } from "@/lib/quire/party-sheet-links";
import { useEffect, useState, useSyncExternalStore } from "react";
import { accountRequest } from "@/lib/account/client";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { useSeat } from "@/lib/quire/seat";
export type SheetReadout = {
  id: string;
  purse_id: string;
  body: {
    name: string;
    portrait: string;
    classes: string;
    level: number;
    hp: number;
    maxHp: number;
    ac: number;
  };
};
export function useSheetReadouts() {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const campaigns = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const seat = useSeat();
  const scope = `${campaigns.activeId}:${room.joined}:${room.code}:${seat.role}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; rows: SheetReadout[] }>({
    scope: "",
    rows: [],
  });
  useEffect(() => {
    let stopped = false,
      request: AbortController | undefined;
    const save = (rows: SheetReadout[]) => {
      if (!stopped) setSnapshot({ scope, rows });
    };
    save([]);
    if (seat.role !== "dm") return;
    async function roster(code: string, signal: AbortSignal) {
      const result = await accountRequest<{
        characters: { id: string; purseId: string; body: SheetReadout["body"] }[];
      }>("sheets/campaign", { code }, signal);
      return result.characters.map((row) => ({
        id: row.id,
        purse_id: row.purseId,
        body: row.body,
      }));
    }
    async function load() {
      request?.abort();
      const current = new AbortController();
      request = current;
      try {
        let rows: SheetReadout[];
        if (room.joined && room.code) rows = await roster(room.code, current.signal);
        else {
          const own = await accountRequest<{
            userId: string;
            characters: (SheetReadout & { campaign_code: string })[];
            campaigns: { code: string; role: string }[];
          }>("sheets", undefined, current.signal);
          const savedRoom = own.campaigns.find(
            (c) => c.role === "dm" && campaigns.activeId === `account-${own.userId}-${c.code}`,
          );
          if (savedRoom) rows = await roster(savedRoom.code, current.signal);
          else
            rows = readPartySheetLinks(own.userId, campaigns.activeId).flatMap((link) => {
              const sheet = own.characters.find((r) => r.id === link.sheetId && !r.campaign_code);
              return sheet ? [{ ...sheet, purse_id: link.purseId }] : [];
            });
        }
        if (!current.signal.aborted) save(rows);
      } catch {
        if (!current.signal.aborted) save([]);
      }
    }
    const refresh = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    void load();
    const timer = window.setInterval(refresh, 15000);
    const unsubscribe = subscribeSheetChanges(refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      request?.abort();
      window.clearInterval(timer);
      unsubscribe();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [scope, room.code, room.joined, room.revision, campaigns.activeId, seat.role]);
  return snapshot.scope === scope ? snapshot.rows : [];
}
export function HpBar({ hp, max }: { hp: number; max: number }) {
  return (
    <span
      className="health-track"
      role="meter"
      aria-label="Hit points"
      aria-valuemin={0}
      aria-valuemax={Math.max(1, max)}
      aria-valuenow={Math.max(0, Math.min(hp, max))}
    >
      <span
        style={{
          width: `${Math.max(0, Math.min(100, max ? (hp / max) * 100 : 0))}%`,
        }}
      />
    </span>
  );
}
