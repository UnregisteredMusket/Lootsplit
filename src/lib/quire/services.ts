import type { CloudTable } from "./cloud.ts";
import { toCopper, formatCopper } from "./money.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import { shopVisible } from "./vendors.ts";
import {
  assertHeldItem,
  assertContribution,
  downtimePending,
  money as serviceMoney,
  npcAtShop,
  presentAt,
  quoteFingerprint,
} from "./service-core.ts";
import {
  isLinkKind,
  readServices,
  serviceTermsSchema,
  type ServiceKind,
  type ServiceOffer,
  type ServiceOrder,
  type ServiceProvider,
  type ServiceRequest,
  type Settlement,
} from "./services-schema.ts";

// Quote, availability and settlement rules for temple, workshop and inn providers
// (docs/SERVICES.md). The command, the hub, the conversation and the Review Inbox all use these.

type Table = Pick<CloudTable, "journal" | "purses" | "holdings" | "shops">;
const money = (n: number) => serviceMoney(n, "Service price exceeds the supported copper range.");

export const SERVICE_DOWNTIME_LOCK = "Services pause while the DM reviews downtime.";
/** What each kind is called: "Temple", "Workshop", … "Hire". */
export const serviceKindNames: Record<ServiceKind, string> = {
  temple: "Temple",
  workshop: "Workshop",
  inn: "Inn",
  trainer: "Trainer",
  stable: "Stable",
  courier: "Courier",
  sage: "Sage",
  fence: "Fence",
  bank: "Bank",
  hire: "Hire",
};

/** "Temple", "Workshop · Scribe", "Inn", "Sage". */
export function serviceLabel(p: Pick<ServiceProvider, "kind" | "specialty">) {
  const base = serviceKindNames[p.kind] ?? "Service";
  return p.specialty ? `${base} · ${p.specialty}` : base;
}

/** The provider's settlement: the DM's override, else the nearest town or city above its shop, else a village. */
export function providerSettlement(t: Table, p: ServiceProvider): { kind: Settlement; name: string } {
  const shop = t.shops.find((s) => s.id === p.shopId);
  const path = locationPath(readMarketLocations(t.journal?.market), shop?.locationId);
  const town = [...path].reverse().find((l) => l.kind === "city" || l.kind === "town");
  const name = town?.name ?? path.at(-1)?.name ?? shop?.name ?? p.name;
  return { kind: p.settlement ?? (town ? (town.kind as Settlement) : "village"), name };
}
const rank: Record<Settlement, number> = { village: 0, town: 1, city: 2 };
/** SRD 5.2.1: levels 0–2 anywhere, 3–5 in a town or city, 6–9 in a city. */
export function settlementNeeded(level: number | undefined): Settlement {
  return level === undefined || level <= 2 ? "village" : level <= 5 ? "town" : "city";
}
export function offerSettlementLock(t: Table, p: ServiceProvider, o: ServiceOffer) {
  const need = settlementNeeded(o.spellLevel),
    here = providerSettlement(t, p);
  if (rank[here.kind] >= rank[need]) return "";
  return `Only in a ${need === "city" ? "city" : "town or city"}. ${here.name} is a ${here.kind}.`;
}

/** Offers a player may see and order: approved drafts only. */
export const approvedOffers = (p: ServiceProvider) => p.offers.filter((o) => o.approved);

/**
 * Why this provider can't take a new order from this purse, in the hub's order (first match
 * wins); empty when it can. The server refuses with the same text.
 */
export function providerLock(t: Table, p: ServiceProvider, purseId: string | undefined) {
  if (downtimePending(t)) return SERVICE_DOWNTIME_LOCK;
  if (!purseId) return "Choose a character first.";
  const npc = t.journal?.world?.npcs.find((n) => n.id === p.npcId),
    shop = t.shops.find((s) => s.id === p.shopId);
  if (!npc) return "This service is no longer offered.";
  if (!npc.services?.includes(p.kind))
    return `${npc.name} doesn't offer ${serviceKindNames[p.kind].toLowerCase()} services right now.`;
  if (p.kind === "fence" && !blackMarketOn(t)) return `${npc.name} isn't dealing right now.`;
  if (!shop || !shopVisible(shop, t) || shop.closed) return `${shop?.name ?? p.name} is closed.`;
  if (!npcAtShop(t, npc.id, shop.locationId)) return `${npc.name} isn't at ${shop.name}.`;
  const payer = t.purses.find((x) => x.id === purseId);
  if (!presentAt(t, shop.locationId!, purseId))
    return `${payer?.name ?? "The paying character"} isn't at ${shop.name}.`;
  if (p.paused) return `Not taking new orders: “${p.paused.reason}”`;
  return linkLock(t, p, purseId!);
}

/** Black-market dealing is visible only while the DM has the black market switched on. */
export const blackMarketOn = (t: Pick<CloudTable, "journal">) => !!t.journal?.world?.blackMarketActive;

/** Properties the payer's side could staff: held by the payer or a party fund, with property operations. */
export function staffableProperties(t: Table, purseId: string) {
  const sites = new Set(
    ((t.journal?.propertyOperations as { sites?: { propertyId: string }[] } | undefined)?.sites ?? []).map((s) => s.propertyId),
  );
  return t.holdings.filter(
    (h) =>
      h.kind === "property" &&
      sites.has(h.id) &&
      (h.purseId === purseId || t.purses.some((p) => p.id === h.purseId && p.kind === "party")),
  );
}

/** The per-kind lock of a link (after the shared reasons); empty when the link can be used. */
function linkLock(t: Table, p: ServiceProvider, purseId: string) {
  const npc = t.journal?.world?.npcs.find((n) => n.id === p.npcId);
  if (p.kind === "hire") {
    if (!p.link?.roles?.length) return `${npc?.name ?? "This agent"} has no one for hire right now.`;
    if (!staffableProperties(t, purseId).length) return "The party owns no property to staff.";
  }
  return "";
}

/** Whether the provider shows in the hub, the Here sheet and a player's projection. */
export const providerListed = (p: ServiceProvider) => isLinkKind(p.kind) || approvedOffers(p).length > 0;

/** The provider as both the DM and a player see it: approved offers, no rumour text. */
export function publicProvider(p: ServiceProvider) {
  return {
    ...p,
    offers: approvedOffers(p),
    rumours: p.rumours?.map((r) => ({ id: r.id, teaser: r.teaser, priceCopper: r.priceCopper, once: r.once })),
  };
}

/** Units the offer allows per order. */
export function maxUnits(o: ServiceOffer) {
  return o.time.kind === "per-night" ? o.time.maxNights : o.time.kind === "training" ? (o.maxDays ?? 250) : (o.maxUnits ?? 1);
}
/** Beneficiaries each kind takes: a temple casts on one, an inn hosts guests, a workshop has none. */
export function beneficiaryRule(kind: ServiceKind, offer?: Pick<ServiceOffer, "target">) {
  if (offer?.target) return { min: 0, max: 0 };
  return kind === "temple" || kind === "trainer" ? { min: 1, max: 1 } : kind === "inn" ? { min: 1, max: 20 } : { min: 0, max: 0 };
}

/**
 * Items a payer could show a sage, with why others can't be chosen: their own carried items
 * (worn is fine); stored, travelling, reserved or pooled ones, and party-fund items, are listed
 * but blocked.
 */
export function identifyCandidates(t: Table, purseId: string) {
  const fund = new Set(t.purses.filter((p) => p.kind === "party").map((p) => p.id));
  return t.holdings
    .filter((h) => h.kind === "item" && !h.service && (h.purseId === purseId || fund.has(h.purseId)))
    .map((h) => ({
      holding: h,
      blocked:
        h.purseId !== purseId
          ? "Party fund. A character has to carry it first."
          : h.custody || h.reservedFor
            ? "Retrieve this item from its property first."
            : h.pool
              ? "In the treasure pool."
              : "",
    }));
}
/** Why this purse can't ask about an item at all; empty when it can. */
export function identifyLock(t: Table, purseId: string | undefined) {
  if (!purseId) return "";
  return identifyCandidates(t, purseId).some((c) => !c.blocked) ? "" : "Carry the item you want identified.";
}
/** Party characters who can be named as a beneficiary (and whether they are here). */
export function serviceBeneficiaries(t: Table, p: ServiceProvider) {
  const shop = t.shops.find((s) => s.id === p.shopId);
  return t.purses
    .filter((x) => x.kind === "character" && !x.nonParty && x.control !== "npc")
    .map((x) => ({ purseId: x.id, name: x.name, here: !!shop?.locationId && presentAt(t, shop.locationId, x.id) }));
}

/**
 * A holding can stand in for a component with this material key when it carries that key, or when
 * it has no material key and its name says what it is ("Diamond (500 gp)"). Another key never does.
 */
export function componentMatches(h: { materialKey?: string; name: string } | undefined, key: string | undefined) {
  if (!h) return false;
  if (!key) return true;
  if (h.materialKey) return h.materialKey === key;
  return h.name.toLowerCase().includes(key.replace(/[-_.]/g, " "));
}
/** Carried lots of the payer that could be handed over for a component, with why others can't. */
export function componentCandidates(t: Table, purseId: string, c: { materialKey?: string; minCopper: number }) {
  return t.holdings
    .filter((h) => h.purseId === purseId && h.kind === "item" && !h.service && componentMatches(h, c.materialKey))
    .map((h) => ({
      holding: h,
      blocked:
        h.unitCopper < c.minCopper
          ? `Worth less than ${formatCopper(c.minCopper)}.`
          : h.custody || h.reservedFor
            ? "Retrieve this item from its property first."
            : h.pool
              ? "In the treasure pool."
              : h.equipped
                ? "Unequip it first."
                : "",
    }));
}

export type ServiceQuote = ReturnType<typeof serviceQuote>;
/**
 * Recompute the price of a request from the current table. Throws the first reason it can't be
 * ordered. `before` is the stale-quote fingerprint the command compares.
 */
export function serviceQuote(
  t: Table,
  providerId: string,
  offerKey: string,
  purseId: string,
  request: ServiceRequest,
  /** The order being approved, which doesn't count as another open agreement. */
  excludeOrderId?: string,
) {
  const p = readServices(t.journal?.services).providers.find((x) => x.id === providerId);
  if (!p) throw Error("This service is no longer offered.");
  const lock = providerLock(t, p, purseId);
  if (lock) throw Error(lock);
  if (isLinkKind(p.kind)) throw Error(`${serviceLabel(p)} opens another screen; it takes no orders here.`);
  const offer = approvedOffers(p).find((o) => o.key === offerKey);
  if (!offer) throw Error("Choose an offer the DM has approved.");
  const settlementLock = offerSettlementLock(t, p, offer);
  if (settlementLock) throw Error(settlementLock);
  const npc = t.journal!.world!.npcs.find((n) => n.id === p.npcId)!,
    shop = t.shops.find((s) => s.id === p.shopId)!,
    payer = t.purses.find((x) => x.id === purseId)!;
  const units = request.units;
  if (!Number.isSafeInteger(units) || units < 1 || units > maxUnits(offer))
    throw Error(`Choose between 1 and ${maxUnits(offer)} for this offer.`);

  // Beneficiaries: party characters who are here. Paying for someone grants no control.
  const rule = beneficiaryRule(p.kind, offer),
    ids = request.beneficiaryPurseIds;
  if (new Set(ids).size !== ids.length) throw Error("Choose each character once.");
  if (ids.length < rule.min || ids.length > rule.max)
    throw Error(
      offer.target
        ? "This offer takes no beneficiary."
        : p.kind === "trainer"
          ? "Choose who takes the lessons."
          : p.kind === "temple"
          ? "Choose who the spell is cast on."
          : p.kind === "inn"
            ? "Choose who stays."
            : "This offer takes no beneficiary.",
    );
  const beneficiaries = ids.map((id) => {
    const b = t.purses.find((x) => x.id === id);
    if (!b || b.kind !== "character" || b.nonParty || b.control === "npc")
      throw Error("Choose a party character.");
    if (!presentAt(t, shop.locationId!, id)) throw Error(`${b.name} isn't at ${shop.name}.`);
    return { purseId: id, name: b.name };
  });

  // Identify: one item the payer carries (worn is fine); it never leaves their inventory.
  let item: { holdingId: string; name: string; notesBefore: string } | undefined;
  if (offer.target === "held-item") {
    if (!request.itemHoldingId) throw Error("Carry the item you want identified.");
    const h = assertHeldItem(t, request.itemHoldingId, purseId, `Choose an item ${payer.name} owns and carries.`);
    item = { holdingId: h.id, name: h.name.slice(0, 160), notesBefore: h.notes.slice(0, 4000) };
    if (units !== 1) throw Error("Ask about one item at a time.");
  } else if (request.itemHoldingId) throw Error("This offer doesn't look at an item.");

  // Price: the offer per unit, or an inn's tier per guest per night plus meals.
  const lines: { label: string; copper: number }[] = [];
  let inn: { tierKey: string; tierName: string; nightCopper: number; mealCopper: number; meals: number } | undefined;
  if (p.kind === "inn") {
    const tier = offer.tiers?.find((x) => x.key === request.inn?.tierKey && x.offered);
    if (!tier || !request.inn) throw Error("Choose a room the inn offers.");
    const guests = beneficiaries.length,
      meals = request.inn.meals;
    inn = { tierKey: tier.key, tierName: tier.name, nightCopper: tier.nightCopper, mealCopper: tier.mealCopper, meals };
    lines.push({
      label: `Rooms · ${guests} ${guests === 1 ? "guest" : "guests"} × ${units} ${units === 1 ? "night" : "nights"} × ${formatCopper(tier.nightCopper)}`,
      copper: money(guests * units * tier.nightCopper),
    });
    if (meals)
      lines.push({
        label: `Meals · ${guests} × ${units} ${units === 1 ? "day" : "days"} × ${meals} × ${formatCopper(tier.mealCopper)}`,
        copper: money(guests * units * meals * tier.mealCopper),
      });
  } else if (request.inn) throw Error("Rooms are booked at an inn.");
  else if (p.kind === "trainer") {
    // Booking moves no money: each session is charged once when the DM approves it.
    if (!offer.category) throw Error("This subject has no training category.");
    lines.push({ label: `Booking now · up to ${units} training ${units === 1 ? "day" : "days"} at ${formatCopper(offer.priceCopper)} a day, charged per approved session`, copper: 0 });
  } else
    lines.push({
      label: units > 1 ? `${units} × ${offer.name} × ${formatCopper(offer.priceCopper)}` : offer.name,
      copper: money(units * offer.priceCopper),
    });

  // Components: brought by the payer (the forge's held-item rule) or supplied at a price.
  const components = [];
  const used = new Map<string, number>();
  for (const c of request.contributions)
    if (!offer.components?.some((x) => x.key === c.componentKey))
      throw Error("Offer only the items this service needs.");
  if (new Set(request.contributions.map((c) => c.componentKey)).size !== request.contributions.length)
    throw Error("Offer one lot for each item the service needs.");
  for (const c of offer.components ?? []) {
    const needed = c.quantity * (c.perUnit ? units : 1),
      given = request.contributions.find((x) => x.componentKey === c.key);
    if (given && c.supply === "provider") throw Error(`${npc.name} supplies the ${c.label}.`);
    if (!given && c.supply === "party") throw Error(`Bring the ${c.label} this service needs.`);
    if (given && given.quantity > needed) throw Error(`This service needs only ${needed} × ${c.label}.`);
    if (given && c.supply === "party" && given.quantity !== needed)
      throw Error(`Bring ${needed} × ${c.label}.`);
    if (given) {
      if (!componentMatches(t.holdings.find((h) => h.id === given.holdingId), c.materialKey))
        throw Error(`Offer a ${c.label}, not another item.`);
      const h = assertContribution(t, given.holdingId, purseId, {
        minCopper: c.minCopper,
        mismatch: `Offer a ${c.label} owned by the paying character${c.minCopper ? `, worth at least ${formatCopper(c.minCopper)}` : ""}.`,
        equipped: `Unequip the ${c.label} before handing it over.`,
      });
      used.set(h.id, (used.get(h.id) ?? 0) + given.quantity);
      if (used.get(h.id)! > h.quantity) throw Error(`You don't carry enough ${h.name}.`);
      components.push({
        key: c.key,
        label: c.label,
        holdingId: h.id,
        holdingName: h.name,
        quantity: given.quantity,
        supplied: "party" as const,
        copper: 0,
        consumed: c.consumed,
      });
    }
    const supplied = needed - (given?.quantity ?? 0);
    if (supplied > 0) {
      const copper = money(supplied * c.supplyCopper);
      components.push({
        key: c.key,
        label: c.label,
        holdingId: null,
        quantity: supplied,
        supplied: "provider" as const,
        copper,
        consumed: c.consumed,
      });
      lines.push({ label: `${c.label} supplied by ${npc.name}${supplied > 1 ? ` × ${supplied}` : ""}`, copper });
    }
  }
  const priceCopper = money(lines.reduce((n, l) => n + l.copper, 0));
  const review =
    offer.review === "dm" || (p.reviewAboveCopper !== undefined && priceCopper > p.reviewAboveCopper)
      ? ("dm" as const)
      : ("auto" as const);
  const workDays =
    offer.time.kind === "downtime-days" ? offer.time.days * (offer.time.perUnit ? units : 1) : 0;
  if (workDays > 3650) throw Error("This order would take more than 3650 downtime days.");
  const settlement = providerSettlement(t, p);
  const terms = serviceTermsSchema.parse({
    kind: p.kind,
    providerName: p.name,
    ...(p.specialty ? { specialty: p.specialty } : {}),
    npcId: npc.id,
    npcName: npc.name,
    shopId: shop.id,
    shopName: shop.name,
    locationId: shop.locationId!,
    placeName: settlement.name,
    offer,
    units,
    beneficiaries,
    ...(inn ? { inn } : {}),
    components,
    lines,
    priceCopper,
    review,
    workDays,
    settlement: settlement.kind,
    ...(item ? { item } : {}),
    ...(p.kind === "trainer"
      ? {
          lessons: {
            pupilId: beneficiaries[0].purseId,
            pupilName: beneficiaries[0].name.slice(0, 160),
            category: offer.category!,
            topic: offer.name,
            dayCopper: offer.priceCopper,
            maxDays: units,
          },
        }
      : {}),
  });
  if (p.kind === "trainer") {
    const open = readServices(t.journal?.services).orders.find(
      (o) =>
        o.id !== excludeOrderId &&
        o.providerId === p.id &&
        o.offerKey === offer.key &&
        o.terms.lessons?.pupilId === beneficiaries[0].purseId &&
        ["requested", "active", "paused"].includes(o.status),
    );
    if (open) throw Error(`${beneficiaries[0].name} already has lessons in ${offer.name} with ${npc.name}.`);
  }
  const f = t.journal?.finance ?? { day: 0, minuteOfDay: 0 };
  const before = quoteFingerprint({
    provider: publicProvider(p),
    npc: { id: npc.id, name: npc.name, services: npc.services },
    terms,
    day: f.day,
    minute: f.minuteOfDay ?? 0,
    payer: payer.coins,
    holdings: [...used.keys()].sort().map((id) => t.holdings.find((h) => h.id === id)),
    ...(item ? { item: t.holdings.find((h) => h.id === item.holdingId) } : {}),
  });
  return { terms, before, provider: p, offer };
}

/** One line per check the DM's approval reruns, for the Review Inbox. */
export function reviewChecks(t: Table, o: ServiceOrder) {
  const checks: { ok: boolean; text: string }[] = [];
  const p = readServices(t.journal?.services).providers.find((x) => x.id === o.providerId);
  const payer = t.purses.find((x) => x.id === o.purseId);
  const shop = t.shops.find((s) => s.id === o.terms.shopId);
  const where = o.terms.placeName;
  const people = [o.purseId, ...o.request.beneficiaryPurseIds.filter((id) => id !== o.purseId)];
  for (const id of people) {
    const who = t.purses.find((x) => x.id === id);
    checks.push({
      ok: !!who && !!shop?.locationId && presentAt(t, shop.locationId, id),
      text: who ? `${who.name} is at ${where}` : "A character on this order no longer exists",
    });
  }
  checks.push({
    ok: !!shop?.locationId && npcAtShop(t, o.terms.npcId, shop.locationId),
    text: `${o.terms.npcName} is at ${o.terms.shopName}, visible, not on downtime`,
  });
  const offer = p ? approvedOffers(p).find((x) => x.key === o.offerKey) : undefined;
  let quote: ServiceQuote | undefined,
    error = "";
  try {
    quote = serviceQuote(t, o.providerId, o.offerKey, o.purseId, o.request, o.id);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  checks.push({
    ok: !!offer && !!shop && !shop.closed && quote?.terms.priceCopper === o.terms.priceCopper,
    text: `${o.terms.shopName} open; offer still approved at ${formatCopper(o.terms.priceCopper)}`,
  });
  const coins = payer ? toCopper(payer.coins) : 0;
  checks.push({
    ok: coins >= o.terms.priceCopper,
    text: `${payer?.name ?? "The payer"} has ${formatCopper(coins)} (needs ${formatCopper(o.terms.priceCopper)})`,
  });
  for (const c of o.terms.components.filter((c) => c.holdingId)) {
    const h = t.holdings.find((h) => h.id === c.holdingId);
    checks.push({
      ok: !!h && h.purseId === o.purseId && !h.custody && !h.reservedFor && !h.pool && !h.equipped && h.quantity >= c.quantity,
      text: `${c.holdingName ?? c.label} still carried by ${payer?.name ?? "the payer"} and not equipped`,
    });
  }
  if (o.terms.item) {
    const h = t.holdings.find((h) => h.id === o.terms.item!.holdingId);
    let carried = !!h && h.purseId === o.purseId;
    try {
      if (h) assertHeldItem(t, h.id, o.purseId, "");
    } catch {
      carried = false;
    }
    checks.push({ ok: carried, text: `${o.terms.item.name} is still owned and carried by ${payer?.name ?? "the payer"}` });
  }
  if (error && checks.every((c) => c.ok)) checks.push({ ok: false, text: error });
  return checks;
}

/** A short receipt line, for events and history. */
export function serviceSummary(o: Pick<ServiceOrder, "terms">) {
  if (o.terms.lessons) return `Lessons · ${o.terms.lessons.topic} for ${o.terms.lessons.pupilName} · ${o.terms.shopName}`;
  if (o.terms.item) return `${o.terms.offer.name} · ${o.terms.item.name} · ${o.terms.shopName}`;
  const on = o.terms.beneficiaries.length && o.terms.kind === "temple" ? ` on ${o.terms.beneficiaries[0].name}` : "";
  return `${o.terms.offer.name}${on} · ${o.terms.shopName}`;
}

/** Service requests waiting for the DM (Review Inbox count). */
export function pendingServiceRequests(t: Pick<CloudTable, "journal">) {
  return readServices(t.journal?.services).orders.filter((o) => o.status === "requested").length;
}

/** Why this purse can't buy this rumour; empty when it can. */
export function rumourLock(t: Table, p: ServiceProvider, rumourId: string, purseId: string | undefined) {
  const lock = providerLock(t, p, purseId);
  if (lock) return lock;
  const r = p.rumours?.find((x) => x.id === rumourId);
  if (!r) return "That rumour isn't for sale any more.";
  const npc = t.journal?.world?.npcs.find((n) => n.id === p.npcId)?.name ?? "the innkeeper";
  if ((r.buyers ?? r.boughtBy ?? []).includes(purseId!)) return `You bought this. It's in your thread with ${npc}.`;
  if (r.once === "party" && (r.boughtByParty || (r.buyers?.length ?? 0) > 0))
    return "Someone in the party already bought this one.";
  return "";
}
/** The stale-price fingerprint of a rumour purchase (the same on the DM's and a player's table). */
export function rumourQuote(t: Table, providerId: string, rumourId: string, purseId: string) {
  const p = readServices(t.journal?.services).providers.find((x) => x.id === providerId);
  if (!p) throw Error("This service is no longer offered.");
  const lock = rumourLock(t, p, rumourId, purseId);
  if (lock) throw Error(lock);
  const r = p.rumours!.find((x) => x.id === rumourId)!;
  const npc = t.journal!.world!.npcs.find((n) => n.id === p.npcId)!;
  const payer = t.purses.find((x) => x.id === purseId)!;
  const f = t.journal?.finance ?? { day: 0, minuteOfDay: 0 };
  return {
    provider: p,
    rumour: r,
    before: quoteFingerprint({
      provider: publicProvider(p),
      npc: { id: npc.id, name: npc.name, services: npc.services },
      rumour: { id: r.id, teaser: r.teaser, priceCopper: r.priceCopper, once: r.once },
      day: f.day,
      minute: f.minuteOfDay ?? 0,
      payer: payer.coins,
    }),
  };
}

/** The note a bank link starts a loan request with; the DM's loan form recognises it. */
export function bankLoanNote(p: Pick<ServiceProvider, "name">, npcName: string) {
  return `Loan from ${p.name} (${npcName}). `;
}
/** The bank a loan request names (by its note), for the DM's starting terms. */
export function bankForLoanNote(t: Pick<CloudTable, "journal">, note: string) {
  const s = readServices(t.journal?.services);
  return s.providers.find((p) => {
    if (p.kind !== "bank") return false;
    const npc = t.journal?.world?.npcs.find((n) => n.id === p.npcId)?.name ?? "";
    return note.startsWith(bankLoanNote(p, npc).trim());
  });
}

/** A paid lesson session's fee: hours × rate ÷ hours per training day, rounded up to whole copper. */
export function lessonFee(minutes: number, dayCopper: number, trainingHoursPerDay: number) {
  return serviceMoney((minutes * dayCopper) / (trainingHoursPerDay * 60), "Lesson fee exceeds the supported copper range.");
}
/** Training days taken on an agreement (approved sessions) and reserved (pending requests). */
export function lessonDays(
  t: Pick<CloudTable, "journal">,
  o: Pick<ServiceOrder, "id">,
): { approved: number; pending: number; paidCopper: number } {
  const requests = ((t.journal?.downtimeActivities as { requests?: { lessonOrderId?: string; status: string; minutes: number; trainingHoursPerDay: number; feeCopper?: number }[] } | undefined)?.requests ?? []).filter(
    (r) => r.lessonOrderId === o.id,
  );
  const days = (status: string) =>
    requests.filter((r) => r.status === status).reduce((n, r) => n + r.minutes / (r.trainingHoursPerDay * 60), 0);
  return {
    approved: days("approved"),
    pending: days("pending"),
    paidCopper: requests.filter((r) => r.status === "approved").reduce((n, r) => n + (r.feeCopper ?? 0), 0),
  };
}
