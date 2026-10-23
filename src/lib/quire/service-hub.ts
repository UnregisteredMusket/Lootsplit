import type { CloudTable } from "./cloud.ts";
import { readBlacksmith } from "./blacksmith-schema.ts";
import { smithAvailability } from "./blacksmith.ts";
import { downtimePending } from "./service-core.ts";

// The Services branch of the NPC conversation hub (docs/SERVICES.md, docs/NPC-BARTER.md).
// One entry per provider this NPC runs. Each entry runs the same availability check the
// server runs when ordering, and carries its reason as the lock text.

export type HubService = {
  key: string;
  /** "Blacksmith", later "Temple", "Workshop · Scribe", "Inn". */
  label: string;
  /** The reply tag, e.g. "Services · Blacksmith". */
  tag: string;
  /** What the character says when choosing it. */
  text: string;
  sub?: string;
  /** Opens an existing page (the forge's shop page). */
  href?: string;
  /** Why it can't be used now; empty when usable. */
  locked: string;
  /** The provider's place (shop name), added to the tag in the sub-list. */
  place: string;
  /** The character has an order here waiting to be collected. */
  ready?: boolean;
};

export const DOWNTIME_LOCK = "Services pause while the DM reviews downtime.";
export const NO_CHARACTER_LOCK = "Choose a character first.";

/** Every service provider run by this NPC, in a stable order, with its current lock reason. */
export function npcServices(t: CloudTable, npcId: string, purseId: string | undefined): HubService[] {
  const out: HubService[] = [];
  const smith = readBlacksmith(t.journal?.blacksmith);
  for (const p of smith.profiles.filter((p) => p.npcId === npcId)) {
    const shop = t.shops.find((s) => s.id === p.shopId);
    if (!shop) continue;
    const ready = purseId
      ? smith.orders.find(
          (o) => o.purseId === purseId && o.terms.shopId === p.shopId && o.status === "ready",
        )
      : undefined;
    out.push({
      key: `smith:${p.shopId}`,
      label: "Blacksmith",
      tag: "Services · Blacksmith",
      text: "Do you take commissions?",
      sub: ready
        ? `Your ${ready.terms.design.name} is ready to collect at ${shop.name}.`
        : `Opens ${shop.name}'s commissions.`,
      href: `/shop/${encodeURIComponent(p.shopId)}`,
      ready: !!ready,
      place: shop.name,
      locked: downtimePending(t)
        ? DOWNTIME_LOCK
        : !purseId
          ? NO_CHARACTER_LOCK
          : smithAvailability(t, p, purseId),
    });
  }
  return out;
}

/** The single hub reply that leads to the providers: open directly, open a sub-list, or locked. */
export function servicesReply(services: HubService[], npcName: string) {
  if (!services.length)
    return {
      mode: "none" as const,
      tag: "Services",
      text: "Do you offer any services?",
      locked: `${npcName} offers no services.`,
    };
  if (services.length === 1) return { mode: "direct" as const, ...services[0] };
  const kinds = [...new Set(services.map((s) => s.label))];
  const usable = services.filter((s) => !s.locked);
  return {
    mode: "list" as const,
    tag: `Services · ${kinds.join(", ")}`,
    text: "Do you offer any services?",
    sub: `${services.length} services here. Pick one in the next step.`,
    // Enabled while at least one provider can be used; the sub-list explains the others.
    locked: usable.length ? "" : services[0].locked,
  };
}
