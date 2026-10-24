import type { CloudTable } from "./cloud.ts";
import { characterLocation, characterPosition } from "./character-position.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import { formatCopper } from "./money.ts";
import { money } from "./service-core.ts";
import type { ServiceOrder, ServiceProvider } from "./services-schema.ts";

// Courier letters (docs/SERVICES.md, services wave 2): letters to NPCs the sender knows, priced by
// the DM's distance per destination (SRD Messenger, 2 cp a mile by default), delivered over approved
// downtime into the sender's own thread with the recipient.

type Table = Pick<CloudTable, "journal" | "purses" | "shops">;

/** One NPC the sender could write to, or why not. Players receive these on the provider. */
export type CourierRecipient = {
  purseId: string;
  npcId: string;
  name: string;
  /** The destination it falls under, with the DM's distance and days. */
  locationId?: string;
  placeName?: string;
  deciMiles?: number;
  days?: number;
  blocked: string;
};

/**
 * NPCs a character "knows": visible NPCs the character already has a thread with. Each is listed
 * with the courier destination it falls under, or blocked: here (talk instead) or a place the
 * courier doesn't serve. Hidden NPCs are never listed.
 */
export function courierRecipients(t: Table, p: ServiceProvider, purseId: string): CourierRecipient[] {
  // A player's projection carries this list already (the server worked it out for them).
  if (p.recipients) return p.recipients.filter((r) => r.purseId === purseId);
  const w = t.journal?.world;
  const market = readMarketLocations(t.journal?.market);
  const shop = t.shops.find((s) => s.id === p.shopId);
  const out: CourierRecipient[] = [];
  for (const c of w?.conversations ?? []) {
    if (c.purseId !== purseId) continue;
    const npc = w?.npcs.find((n) => n.id === c.npcId);
    const purse = t.purses.find((x) => x.id === c.npcId);
    if (!npc || !purse || !npc.visible || !characterPosition(t, purse).visible || out.some((r) => r.npcId === npc.id)) continue;
    const where = characterLocation(t, purse);
    const path = locationPath(market, where);
    const here = !!shop?.locationId && path.some((l) => l.id === shop.locationId);
    const destination = (p.destinations ?? []).find((d) => path.some((l) => l.id === d.locationId));
    const place = market.locations.find((l) => l.id === destination?.locationId);
    out.push({
      purseId,
      npcId: npc.id,
      name: npc.name,
      ...(destination
        ? { locationId: destination.locationId, placeName: place?.name ?? "", deciMiles: destination.deciMiles, days: destination.days }
        : {}),
      blocked: here
        ? `${npc.name} is here. Talk to them instead.`
        : !destination
          ? `${p.name} doesn't deliver to where ${npc.name} is.`
          : "",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A letter's price: miles × rate per mile, rounded up to whole copper. */
export function letterCopper(deciMiles: number, ratePerMile: number) {
  return money((deciMiles * ratePerMile) / 10, "Letter price exceeds the supported copper range.");
}
export const miles = (deciMiles: number) => (deciMiles / 10).toLocaleString("en", { maximumFractionDigits: 1 });

/** Why a letter can't be delivered now (recipient hidden or gone); empty when it can. */
export function letterHeld(t: Pick<CloudTable, "journal" | "purses">, o: Pick<ServiceOrder, "terms">) {
  const l = o.terms.letter!;
  const npc = t.journal?.world?.npcs.find((n) => n.id === l.recipientNpcId);
  const purse = t.purses.find((p) => p.id === l.recipientNpcId);
  if (!npc || !purse || !npc.visible || !characterPosition(t, purse).visible)
    return `Held at ${l.placeName}: ${l.recipientName} can't be found. The DM decides.`;
  return "";
}

/**
 * Deliver a letter once: the sender's text lands in the sender's own thread with the recipient
 * (`orderId-letter`), so it keeps that thread's privacy. The recipient's reply is an ordinary message.
 */
export function deliverLetter(t: CloudTable, o: ServiceOrder, at: number) {
  const l = o.terms.letter!;
  const w = t.journal!.world!;
  const conversationId = `${l.recipientNpcId}:${o.purseId}`;
  let c = w.conversations.find((x) => x.id === conversationId);
  if (!c) {
    c = { id: conversationId, npcId: l.recipientNpcId, purseId: o.purseId, messages: [] };
    w.conversations.push(c);
  }
  if (!c.messages.some((m) => m.id === o.id + "-letter")) c.messages.push({ id: o.id + "-letter", author: "character", text: l.text, at });
}

/** After approved downtime: every delivered letter not yet in its thread is delivered once. */
export function deliverLetters(t: CloudTable, at: number) {
  for (const o of (t.journal?.services?.orders ?? []) as ServiceOrder[])
    if (o.terms.letter && o.status === "completed" && !o.history.some((h) => h.status === "cancelled")) deliverLetter(t, o, at);
}

/** Order card and receipt line. */
export function letterSummary(o: Pick<ServiceOrder, "terms" | "status">) {
  const l = o.terms.letter!;
  return `Letter to ${l.recipientName}, ${l.placeName} · ${miles(l.deciMiles)} mi · ${formatCopper(o.terms.priceCopper)}`;
}
