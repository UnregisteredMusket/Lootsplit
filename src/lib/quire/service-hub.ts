import type { CloudTable } from "./cloud.ts";
import { readBlacksmith } from "./blacksmith-schema.ts";
import { smithAvailability } from "./blacksmith.ts";
import { downtimePending } from "./service-core.ts";
import { readServices, type ServiceProvider } from "./services-schema.ts";
import { approvedOffers, providerListed, providerLock, serviceLabel } from "./services.ts";
import { formatCopper } from "./money.ts";

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
  /** Opens an existing page (the forge's shop page, a fence's Sell tab, a bank's loan request). */
  href?: string;
  /** A link kind: it opens another screen and moves no money here (marked ↗). */
  link?: boolean;
  /** Opens this provider's branch of the conversation (temple, workshop, inn). */
  providerId?: string;
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
  const services = readServices(t.journal?.services);
  for (const p of services.providers.filter((p) => p.npcId === npcId)) {
    const shop = t.shops.find((s) => s.id === p.shopId),
      offers = approvedOffers(p);
    // A provider with nothing approved is a DM draft: not listed (players never receive it).
    // Links (fence, bank, hire) have no offers and are listed as they are.
    if (!shop || !providerListed(p)) continue;
    const mine = purseId ? services.orders.filter((o) => o.providerId === p.id && o.purseId === purseId) : [];
    const ready = mine.find((o) => o.status === "ready"),
      waiting = mine.find((o) => o.status === "requested");
    let locked = providerLock(t, p, purseId);
    // A pause stops new orders only: collecting or withdrawing stays open.
    if (p.paused && locked.startsWith("Not taking new orders") && (ready || waiting)) locked = "";
    const label = serviceLabel(p);
    const href =
      p.kind === "fence"
        ? `/shop/${encodeURIComponent(p.shopId)}#sell`
        : p.kind === "bank"
          ? `/features/bank?bank=${encodeURIComponent(p.id)}#apply-loan`
          : undefined;
    out.push({
      key: `svc:${p.id}`,
      label,
      tag: `Services · ${label}`,
      text: hubLine(p),
      ...(href ? { href } : {}),
      ...(p.kind === "fence" || p.kind === "bank" || p.kind === "hire" ? { link: true } : {}),
      sub: ready
        ? `Your ${ready.terms.offer.output.kind === "holding" ? ready.terms.offer.output.name : ready.terms.offer.name} is ready to collect.`
        : waiting
          ? `Your request for ${waiting.terms.offer.name} is waiting for the DM.`
          : hubSub(p, offers.length),
      ...(href ? {} : { providerId: p.id }),
      ready: !!ready || !!waiting,
      place: shop.name,
      locked,
    });
  }
  return out;
}

function hubLine(p: ServiceProvider) {
  if (p.kind === "temple") return "I need a priest's help.";
  if (p.kind === "inn") return "We need rooms, and a meal.";
  if (p.kind === "fence") return "What will you give me for these?";
  if (p.kind === "bank") return "I'd like to borrow some coin.";
  if (p.kind === "hire") return "Do you have work for hire? I need hands.";
  if (p.kind === "trainer") return "Can you teach me?";
  if (p.kind === "stable") return "Can you stable our animals, or take us somewhere?";
  if (p.kind === "courier") return "I need a letter delivered.";
  if (p.kind === "sage") return "What is this thing?";
  const s = p.specialty?.toLowerCase();
  return s === "scribe" ? "Can you scribe a scroll for me?" : s === "alchemist" ? "Can you brew something for me?" : "Can you make something for me?";
}
function hubSub(p: ServiceProvider, offers: number) {
  if (p.kind === "fence") return "Opens the Sell tab. The fence's buy rate applies; selling is the shop's usual sale.";
  if (p.kind === "bank") {
    const l = p.link?.loan;
    return `Opens a loan request naming ${p.name}. The DM decides it${l ? `; this bank lends at ${l.rateBps / 100}% ${l.compound ? "compound" : "simple"} per ${l.periodDays} days${l.maxCopper ? `, up to ${formatCopper(l.maxCopper)}` : ""}` : ""}.`;
  }
  if (p.kind === "hire") {
    const roles = p.link?.roles ?? [];
    return `Proposes a staff contract for one of the party's properties. ${roles.map((r) => `${r.name} ${formatCopper(r.wageCopper)} / ${r.periodDays === 1 ? "day" : `${r.periodDays} days`}`).join(" · ")}`.trim();
  }
  const review = approvedOffers(p).some((o) => o.review === "dm") || p.reviewAboveCopper !== undefined;
  const count = `${offers} ${offers === 1 ? "offer" : "offers"}`;
  return review ? `${count}. Some need the DM's approval.` : `${count}.`;
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
