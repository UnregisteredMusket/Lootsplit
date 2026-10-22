import { useEffect, useMemo, useState } from "react";
import type { CloudTable } from "./cloud.ts";
import { getCloudWatch } from "./cloud-turn.ts";
import { useSeat } from "./seat.tsx";
import {
  publicQuote,
  quoteNpcBarter,
  type BarterOfferInput,
  type PublicBarterQuote,
} from "./npc-barter.ts";

export type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; quote: PublicBarterQuote }
  | { status: "error"; message: string };

/**
 * The odds shown before an NPC offer. The DM and offline campaigns compute them
 * with the same function the command uses; a player in a shared room asks the
 * room server, because the NPC's rules and purse never reach the player.
 */
export function useNpcBarterQuote(table: CloudTable, input: BarterOfferInput | null): QuoteState {
  const seat = useSeat();
  const shared = getCloudWatch().joined && seat.role !== "dm";
  const key = input ? JSON.stringify(input) : "";
  const local = useMemo<QuoteState>(() => {
    if (!input || shared) return { status: "idle" };
    try {
      return {
        status: "ready",
        quote: publicQuote(quoteNpcBarter(table, { role: seat.role, id: "local" }, input)),
      };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "Offer unavailable." };
    }
    // The key captures the offer; table changes are part of the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, table, shared, seat.role]);
  const [remote, setRemote] = useState<QuoteState>({ status: "idle" });
  useEffect(() => {
    if (!shared || !input) {
      setRemote({ status: "idle" });
      return;
    }
    let cancelled = false;
    setRemote({ status: "loading" });
    const timer = setTimeout(async () => {
      try {
        const { requestNpcBarterQuote } = await import("./cloud-client.ts");
        const quote = (await requestNpcBarterQuote(input)) as PublicBarterQuote;
        if (!cancelled) setRemote({ status: "ready", quote });
      } catch (error) {
        if (!cancelled)
          setRemote({
            status: "error",
            message: error instanceof Error ? error.message : "The odds could not be checked.",
          });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, shared, table.journal]);
  return shared ? remote : local;
}
