/**
 * Quest log hooks shared by the quest screens and the map's Quests panel: the per-device Follow and
 * Updated state (owner decision D4) and running one quest command with its notice.
 */
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { questStateKey, readQuestState, writeQuestState } from "@/lib/quire/quest-view";
import type { Quest } from "@/lib/quire/quests-schema";
import type { CommandRequest } from "@/lib/quire/commands";

/** Follow and Updated, per device (owner decision D4). */
export function useQuestState() {
  const seat = useSeat();
  const key = questStateKey(seat);
  const subscribe = (fn: () => void) => {
    window.addEventListener("quire-quest-state", fn);
    window.addEventListener("storage", fn);
    return () => {
      window.removeEventListener("quire-quest-state", fn);
      window.removeEventListener("storage", fn);
    };
  };
  const snapshot = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(readQuestState(key)),
    () => '{"seen":{}}',
  );
  const state = JSON.parse(snapshot) as ReturnType<typeof readQuestState>;
  return {
    state,
    follow: (id: string | undefined) => {
      const next = { ...readQuestState(key) };
      if (id) next.follow = id;
      else delete next.follow;
      writeQuestState(key, next);
    },
    markSeen: (q: Quest) => {
      const current = readQuestState(key);
      if (current.seen[q.id] === q.updatedAt) return;
      writeQuestState(key, { ...current, seen: { ...current.seen, [q.id]: q.updatedAt } });
    },
  };
}
export function useQuestCommand() {
  const { commandOutcome } = useEconomy();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run: async (input: CommandRequest, ok: string) => {
      setBusy(true);
      try {
        const outcome = await commandOutcome(input);
        toast.success(outcome.status === "pending" ? `${ok} It is waiting to be sent.` : ok);
        return true;
      } catch (error) {
        toast.error(error instanceof Error && error.message ? error.message : "The quest could not be saved.");
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}
