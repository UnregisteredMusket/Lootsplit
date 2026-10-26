/**
 * The "Quest updated" toast, mounted once in the root layout (kept apart from the quest screens so
 * startup does not load them).
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useRouter } from "@tanstack/react-router";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { questsOf } from "@/lib/quire/quests";
import { latestChange, questChanges, questStateKey } from "@/lib/quire/quest-view";
import { appLinkDestination } from "@/lib/quire/feature-navigation";

/**
 * "Quest updated" (design 2.6): when a synced table brings a newer player-visible change to a
 * quest this seat can read, a toast says what changed. Primed on first load; never on the DM's
 * device; deduped per quest and change.
 */
export function QuestUpdateToasts() {
  const { journal, ready } = useEconomy();
  const t = useMemo(() => ({ journal, ready }), [journal, ready]);
  const seat = useSeat();
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const primed = useRef<Map<string, number> | null>(null);
  const router = useRouter();
  const go = (href: string) => {
    const url = appLinkDestination(href, router.state.location.href);
    void router.navigate({ to: url.pathname as never, search: router.options.parseSearch!(url.search) as never });
  };
  const scope = `${questStateKey(seat)}:${room.joined ? room.code : "device"}`;
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current !== scope) {
      lastScope.current = scope;
      primed.current = null;
    }
    if (!t.ready || seat.role === "dm") return;
    const { next, changed } = questChanges(primed.current, questsOf(t));
    primed.current = next;
    for (const { quest: q, isNew } of changed)
      toast(`${isNew ? "New quest" : "Quest updated"} · ${q.title}`, {
        id: `quest-${q.id}-${q.updatedAt}`,
        description: latestChange(q).slice(0, 140),
        action: { label: "View", onClick: () => go(`/features/quests?quest=${encodeURIComponent(q.id)}`) },
      });
  }, [t, seat.role, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
