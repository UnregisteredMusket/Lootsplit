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
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable),
    seat = useSeat();
  const [rows, setRows] = useState<SheetReadout[]>([]);
  useEffect(() => {
    const c = new AbortController();
    setRows([]);
    if (!room.joined || !room.code || seat.role !== "dm") return;
    async function load() {
      try {
        const list = await accountRequest<{ characters: { id: string }[] }>(
          "sheets/campaign",
          { code: room.code },
          c.signal,
        );
        const details = await Promise.allSettled(
          list.characters.map((x) =>
            accountRequest<SheetReadout>("sheets/detail", { id: x.id }, c.signal),
          ),
        );
        if (!c.signal.aborted)
          setRows(details.flatMap((x) => (x.status === "fulfilled" ? [x.value] : [])));
      } catch {
        if (!c.signal.aborted) setRows([]);
      }
    }
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      c.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [room.code, room.joined, room.revision, seat.role]);
  return rows;
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
