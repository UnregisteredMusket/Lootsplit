import type { CloudTable } from "./cloud.ts";
import { canonicalJson } from "./canonical-json.ts";
import { characterLocation, characterPosition } from "./character-position.ts";
import { partyPlaces } from "./party-groups.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import { assertCarried } from "./custody.ts";
import type { Holding } from "./types.ts";

// Shared pieces of the NPC service engines (docs/SERVICES.md). The blacksmith was the first
// engine; these were lifted out of it unchanged so later providers (temple, workshop, inn)
// use the same presence, price, quote and contribution rules.

type Table = Pick<CloudTable, "journal" | "purses" | "holdings" | "shops">;

/** Whole copper: rounds up, and refuses anything outside 0..1e12 or unsafe. */
export function money(n: number, message = "Price or value exceeds the supported copper range.") {
  const v = Math.ceil(n);
  if (!Number.isSafeInteger(v) || v < 0 || v > 1e12) throw Error(message);
  return v;
}

/**
 * The purse is physically at `locationId` (or somewhere inside it). A character on individual
 * downtime or aboard a sailing ship is away; other purses follow the party's Market location.
 */
export function presentAt(t: Pick<CloudTable, "journal" | "purses">, locationId: string, purseId: string) {
  const p = t.purses.find((p) => p.id === purseId),
    m = readMarketLocations(t.journal?.market);
  if (!p) return false;
  if (p.kind === "character" && characterPosition(t, p).downtime) return false;
  const aboard = t.journal?.fleet?.aboard.find((a) => a.purseId === purseId);
  if (
    aboard &&
    t.journal?.fleet?.vessels.some(
      (v) => v.propertyId === aboard.propertyId && v.mode === "sailing",
    )
  )
    return false;
  // Party funds are shared by every group (split the party): present wherever a group is.
  const locations = p.kind === "character" ? [characterLocation(t, p)] : partyPlaces(t);
  return locations.some((location) => !!location && locationPath(m, location).some((l) => l.id === locationId));
}

/** The provider NPC is visible, not on downtime and standing at (or inside) the shop's location. */
export function npcAtShop(t: Table, npcId: string, shopLocationId: string | undefined) {
  const npc = t.journal?.world?.npcs.find((n) => n.id === npcId),
    maker = t.purses.find((a) => a.id === npcId);
  return (
    !!npc &&
    !!maker &&
    npc.visible &&
    characterPosition(t, maker).visible &&
    !characterPosition(t, maker).downtime &&
    !!shopLocationId &&
    locationPath(readMarketLocations(t.journal?.market), characterLocation(t, maker)).some(
      (l) => l.id === shopLocationId,
    )
  );
}

/** A pending downtime quote freezes every service: its preview already counts current orders. */
export function downtimePending(t: Pick<CloudTable, "journal">) {
  const downtime = (t.journal?.finance as { downtime?: { status: string }[] } | undefined)?.downtime;
  return !!downtime?.some((d) => d.status === "pending");
}

/**
 * The stale-quote fingerprint: canonical JSON of everything the price depends on (offer,
 * provider, terms, clock, payer coins, contributed lots). The command recomputes it and refuses
 * the order when it differs, so a player never pays a price they did not review.
 */
export function quoteFingerprint(parts: Record<string, unknown>) {
  return canonicalJson(parts);
}

/**
 * A holding the payer hands over (forge material, temple diamond, alchemist herbs): an item
 * owned by the payer, not a service, of the right material and value, carried and not equipped.
 */
export function assertContribution(
  t: Pick<CloudTable, "holdings">,
  holdingId: string,
  purseId: string,
  rule: { materialKey?: string; minCopper?: number; mismatch: string; equipped: string },
): Holding {
  const h = t.holdings.find((h) => h.id === holdingId);
  if (
    !h ||
    h.kind !== "item" ||
    h.service ||
    h.purseId !== purseId ||
    (rule.materialKey !== undefined && h.materialKey !== rule.materialKey) ||
    (rule.minCopper !== undefined && h.unitCopper < rule.minCopper)
  )
    throw Error(rule.mismatch);
  assertCarried(h);
  if (h.equipped) throw Error(rule.equipped);
  return h;
}

/**
 * An item the payer shows the provider without handing it over (a sage's Identify): owned by the
 * payer, not a service, carried (not stored, travelling, reserved or pooled). Worn items are fine.
 */
export function assertHeldItem(t: Pick<CloudTable, "holdings">, holdingId: string, purseId: string, mismatch: string): Holding {
  const h = t.holdings.find((h) => h.id === holdingId);
  if (!h || h.kind !== "item" || h.service || h.purseId !== purseId) throw Error(mismatch);
  assertCarried(h);
  return h;
}

/** Orders that still hold the provider, the customer and the pickup location. */
export type WorkOrder = {
  id: string;
  purseId: string;
  status: string;
  progressDays: number;
  completedDay?: number;
  completedMinute?: number;
  message: string;
};

/** DM pause, resume or cancel with a reason. A cancel never refunds by itself. */
export function controlOrder(
  order: WorkOrder,
  action: "pause" | "resume" | "cancel",
  reason: string,
  open: (o: WorkOrder) => boolean,
  refused = "This commission cannot make that status change.",
) {
  if (
    (action === "pause" && order.status !== "active") ||
    (action === "resume" && order.status !== "paused") ||
    (action === "cancel" && !open(order))
  )
    throw Error(refused);
  order.status = action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled";
  order.message = reason;
}

/**
 * Advance active orders by approved downtime days (never session hours). An order that reaches
 * its work days becomes ready on the day it finished. Returns one notice per advanced order.
 */
export function previewDays<O extends WorkOrder>(
  orders: O[],
  days: number,
  clock: { day: number; minuteOfDay?: number },
  rule: { workDays: (o: O) => number; name: (o: O) => string; readyMessage: string },
) {
  const notices: { orderId: string; purseId: string; summary: string }[] = [];
  for (const o of orders.filter((o) => o.status === "active")) {
    const w: WorkOrder = o,
      total = rule.workDays(o),
      worked = Math.min(days, total - w.progressDays);
    w.progressDays += worked;
    if (w.progressDays === total) {
      w.status = "ready";
      w.completedDay = clock.day + worked;
      w.completedMinute = clock.minuteOfDay ?? 0;
      w.message = rule.readyMessage;
    }
    notices.push({
      orderId: w.id,
      purseId: w.purseId,
      summary: `${rule.name(o)}: ${w.progressDays}/${total} days; ${w.status}${w.completedDay === undefined ? "" : `; completed ${`campaign day ${w.completedDay}`}`}.`,
    });
  }
  return notices;
}
