import type { CloudTable, CloudSeat } from "./cloud.ts";
import { canonicalJson } from "./canonical-json.ts";
import { financeMove, readFinance } from "./finance.ts";
import { toCopper, formatCopper } from "./money.ts";
import { controlOrder, downtimePending, presentAt } from "./service-core.ts";
import {
  readServices,
  serviceOrderOpen,
  type ServiceCommand,
  type ServiceOrder,
  type ServiceReveal,
  type ServiceStatus,
} from "./services-schema.ts";
import { rumourQuote, serviceQuote, serviceSummary } from "./services.ts";
import { deliverLetter } from "./services-courier.ts";
import { journeySchema } from "./journey-schema.ts";
import { openJourney } from "./journey-engine.ts";
import { coachGroup } from "./party-groups-journeys.ts";
import { MAIN_GROUP } from "./party-groups.ts";
import { validateServices } from "./services-validation.ts";

// Authoritative service commands (docs/SERVICES.md). Every coin movement is one financeMove with
// `orderId + "-payment"`; reviewed orders move nothing until the DM approves; nothing refunds
// automatically. The room's command receipts and the device's action receipts make a retried
// command a no-op; a reused order ID is refused here as well.

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

function note(o: ServiceOrder, status: ServiceStatus, text: string, at: number) {
  o.status = status;
  o.message = text;
  // History is never trimmed; 50 entries is far beyond any order's lifetime.
  if (o.history.length < 50) o.history.push({ at, status, note: text });
}

/** Pay once and hand over components, then record the order as done or in progress. */
function settle(t: CloudTable, o: ServiceOrder, at: number, approved: boolean) {
  if (o.terms.lessons) {
    // Lessons: agreeing moves no money; each approved session is charged once.
    note(o, "active", `${approved ? "Agreed by the DM." : "Agreed."} Each session is charged once, when the DM approves it.`, at);
    return;
  }
  const payer = t.purses.find((p) => p.id === o.purseId)!;
  if (toCopper(payer.coins) < o.terms.priceCopper)
    throw Error(`${payer.name} can't afford ${formatCopper(o.terms.priceCopper)} for this service.`);
  financeMove(t, o.purseId, -o.terms.priceCopper, o.id + "-payment", serviceSummary(o), at);
  if (o.terms.priceCopper) t.ledger.at(-1)!.shopId = o.terms.shopId;
  for (const c of o.terms.components)
    if (c.holdingId && c.consumed) {
      const h = t.holdings.find((h) => h.id === c.holdingId)!;
      h.quantity -= c.quantity;
      if (h.quantity <= 0) t.holdings = t.holdings.filter((x) => x.id !== h.id);
    }
  const f = readFinance(t.journal?.finance);
  o.paidDay = f.day;
  o.paidMinute = f.minuteOfDay ?? 0;
  const paid = approved ? "Approved and paid." : "Paid.";
  if (o.terms.letter)
    note(o, "active", `${paid} In transit: it arrives after ${o.terms.workDays} approved downtime ${o.terms.workDays === 1 ? "day" : "days"}.`, at);
  else if (o.terms.offer.time.kind === "downtime-days")
    note(o, "active", `${paid} Work advances only with DM-approved downtime.`, at);
  else {
    o.completedDay = f.day;
    o.completedMinute = f.minuteOfDay ?? 0;
    note(o, "completed", `${paid} Recorded only; the DM updates character sheets.`, at);
  }
}

/**
 * Identify (sage or temple): deliver the DM's answer once, in the same command as the payment.
 * The answer goes into the payer's private thread with the NPC (`id-answer`); when ticked it is
 * appended to the item's notes with the day, and the item may be renamed. Phase 5 (item
 * identification) will call its logged reveal from here, so payment and reveal stay atomic.
 */
function revealIdentify(t: CloudTable, o: ServiceOrder, reveal: ServiceReveal, at: number) {
  const item = o.terms.item!;
  const h = t.holdings.find((x) => x.id === item.holdingId)!;
  const w = t.journal!.world!,
    conversationId = `${o.terms.npcId}:${o.purseId}`;
  let c = w.conversations.find((x) => x.id === conversationId);
  if (!c) {
    c = { id: conversationId, npcId: o.terms.npcId, purseId: o.purseId, messages: [] };
    w.conversations.push(c);
  }
  if (!c.messages.some((m) => m.id === o.id + "-answer"))
    c.messages.push({ id: o.id + "-answer", author: "npc", text: reveal.text, at });
  const day = readFinance(t.journal?.finance).day;
  if (reveal.appendToNotes)
    h.notes = [h.notes, `Day ${day} · identified by ${o.terms.npcName}: ${reveal.text}`].filter(Boolean).join("\n");
  if (reveal.rename) h.name = reveal.rename;
  o.reveal = reveal;
}

export function applyServiceCommand(t: CloudTable, seat: CloudSeat, cmd: ServiceCommand, at: number) {
  const s = readServices(t.journal?.services),
    f = readFinance(t.journal?.finance);
  if (downtimePending(t))
    throw Error("Approve or cancel pending downtime before changing services or orders.");
  const dm = () => {
    if (seat.role !== "dm") throw Error("Only the DM can set up services or decide requests.");
  };
  const own = (id: string) => {
    if (seat.role !== "dm" && !seat.purseIds.includes(id))
      throw Error("You can only order, cancel or collect for your own character.");
  };
  let purseId: string | undefined,
    summary = "";
  if (cmd.kind === "service-provider") {
    dm();
    const prior = s.providers.find((p) => p.id === cmd.providerId) ?? null;
    if (!same(prior, cmd.before)) throw Error("This service changed. Review the current settings.");
    if (cmd.provider && cmd.provider.id !== cmd.providerId)
      throw Error("A provider keeps its identity.");
    if (!cmd.provider && s.orders.some((o) => o.providerId === cmd.providerId && serviceOrderOpen(o)))
      throw Error("Resolve open orders before removing this service.");
    s.providers = s.providers.filter((p) => p.id !== cmd.providerId);
    if (cmd.provider) s.providers.push(cmd.provider);
    summary = `Service ${cmd.provider ? (prior ? "updated" : "added") : "removed"}: ${(cmd.provider ?? prior)?.name ?? cmd.providerId}.`;
  } else if (cmd.kind === "service-order") {
    own(cmd.purseId);
    const q = serviceQuote(t, cmd.providerId, cmd.offerKey, cmd.purseId, cmd.request);
    if (q.before !== cmd.before)
      throw Error("The price or details changed. Review again before ordering.");
    if (s.orders.some((o) => o.id === cmd.id)) throw Error("This order has already been recorded.");
    const order: ServiceOrder = {
      id: cmd.id,
      providerId: cmd.providerId,
      offerKey: cmd.offerKey,
      purseId: cmd.purseId,
      request: cmd.request,
      terms: q.terms,
      orderedDay: f.day,
      orderedMinute: f.minuteOfDay ?? 0,
      progressDays: 0,
      status: "requested",
      message: "",
      history: [],
    };
    if (q.terms.route) {
      // A coach booking is a party journey request with a fare line, created in this command.
      const r = q.provider.routes!.find((x) => x.key === q.terms.route!.key)!;
      const w = t.journal!.world!;
      const group = coachGroup(t, cmd.purseId);
      if (openJourney(t, group)) throw Error("The party already has a journey planned. Finish or withdraw it first.");
      const map = w.maps.find((m) => m.id === r.mapId)!;
      const anchored = (locationId?: string | null) =>
        locationId && map.anchors.some((a) => a.locationId === locationId) ? locationId : null;
      const journey = journeySchema.parse({
        id: `${cmd.id}-journey`,
        status: "proposed",
        requestedBy: seat.role === "dm" ? "dm" : cmd.purseId,
        ...(group !== MAIN_GROUP ? { groupId: group } : {}),
        message: `Coach booked with ${q.terms.npcName}, ${q.terms.shopName}.`,
        mapId: r.mapId,
        points: r.points,
        legs: r.legs,
        originLocationId: anchored(r.points![0].locationId),
        destinationLocationId: anchored(r.toLocationId),
        pace: { preset: "custom", milesPerDay: r.paceMilesPerDay },
        forcedMarchHours: 0,
        costs: {
          rations: false,
          mounts: false,
          payerId: null,
          mountHoldingIds: [],
          fare: { orderId: cmd.id, copper: q.terms.priceCopper, payerId: cmd.purseId },
        },
        elapsedMinutes: 0,
        downtimeIds: [],
        createdAt: at,
      });
      w.journeys = [...(w.journeys ?? []), journey];
      note(order, "requested", "Journey request sent to the DM. Nothing is charged until the DM approves departure.", at);
    } else if (q.terms.review === "dm")
      note(order, "requested", "Waiting for the DM's review. Nothing has been charged.", at);
    else settle(t, order, at, false);
    s.orders.push(order);
    purseId = cmd.purseId;
    summary = `Service ${order.status === "requested" ? "requested" : "ordered"}: ${serviceSummary(order)}.`;
  } else if (cmd.kind === "service-rumour") {
    own(cmd.purseId);
    const q = rumourQuote(t, cmd.providerId, cmd.rumourId, cmd.purseId);
    if (q.before !== cmd.before) throw Error("The price or details changed. Review again before buying.");
    const payer = t.purses.find((p) => p.id === cmd.purseId)!;
    if (payer.kind !== "character" || payer.nonParty) throw Error("Buy rumours with a party character.");
    if (toCopper(payer.coins) < q.rumour.priceCopper)
      throw Error(`${payer.name} can't afford ${formatCopper(q.rumour.priceCopper)} for this rumour.`);
    const npc = t.journal!.world!.npcs.find((n) => n.id === q.provider.npcId)!;
    financeMove(t, cmd.purseId, -q.rumour.priceCopper, cmd.id + "-payment", `Rumour · ${q.provider.name}`, at);
    if (q.rumour.priceCopper) t.ledger.at(-1)!.shopId = q.provider.shopId;
    // The buyer is recorded once; the text goes only into the buyer's private thread with the NPC.
    const stored = s.providers.find((p) => p.id === q.provider.id)!.rumours!.find((r) => r.id === q.rumour.id)!;
    stored.buyers = [...(stored.buyers ?? []), cmd.purseId];
    const w = t.journal!.world!,
      conversationId = `${npc.id}:${cmd.purseId}`;
    let c = w.conversations.find((x) => x.id === conversationId);
    if (!c) {
      c = { id: conversationId, npcId: npc.id, purseId: cmd.purseId, messages: [] };
      w.conversations.push(c);
    }
    c.messages.push({ id: cmd.id + "-rumour", author: "npc", text: stored.text!, at });
    purseId = cmd.purseId;
    summary = `Rumour bought from ${npc.name} at ${q.provider.name}.`;
  } else {
    const o = s.orders.find((x) => x.id === cmd.orderId);
    if (!o || !same(o, cmd.before)) throw Error("This order changed. Refresh before acting.");
    purseId = o.purseId;
    if (cmd.kind === "service-cancel") {
      own(o.purseId);
      if (o.terms.lessons && (o.status === "active" || o.status === "paused")) {
        // End lessons: no new sessions; sessions already paid stay in the history.
        note(o, "cancelled", "Lessons ended. No new sessions; nothing more is charged.", at);
      } else {
        if (o.status !== "requested") throw Error("Only a request waiting for the DM can be withdrawn.");
        note(o, "cancelled", "Withdrawn. Nothing was charged.", at);
        // A coach booking withdraws its journey request too (while it hasn't departed).
        const j = o.terms.route && t.journal!.world!.journeys?.find((x) => x.id === `${o.id}-journey`);
        if (j && (j.status === "proposed" || j.status === "planned")) {
          j.status = "cancelled";
          j.decidedAt = at;
        }
      }
      summary = `Service request withdrawn: ${serviceSummary(o)}.`;
    } else if (cmd.kind === "service-review") {
      dm();
      if (o.status !== "requested") throw Error("This request has already been decided.");
      if (o.terms.route) throw Error("A coach booking is decided as a journey: approve or deny its journey request.");
      if (cmd.reveal && (!o.terms.item || cmd.decision !== "approve"))
        throw Error("Only an Identify approval carries an answer.");
      if (cmd.decision === "deny") {
        if (!cmd.reason) throw Error("Give the player a reason for the denial.");
        note(o, "denied", `${cmd.reason} Nothing was charged.`, at);
        summary = `Service request denied: ${serviceSummary(o)}.`;
      } else {
        // Every check runs again against the campaign as it is now; the agreed price stands.
        const q = serviceQuote(t, o.providerId, o.offerKey, o.purseId, o.request, o.id);
        if (q.terms.priceCopper !== o.terms.priceCopper)
          throw Error("The price changed since the request. Deny it and ask the player to request again.");
        if (o.terms.item && !cmd.reveal) throw Error(`Write what ${o.terms.npcName} says before approving.`);
        settle(t, o, at, true);
        if (o.terms.item && cmd.reveal) {
          revealIdentify(t, o, cmd.reveal, at);
          o.message = `Answered and paid. The answer is in your thread with ${o.terms.npcName}.`;
          o.history.at(-1)!.note = o.message;
        }
        if (cmd.reason) o.message = `${o.message} ${cmd.reason}`.slice(0, 1000);
        if (cmd.reason) o.history.at(-1)!.note = o.message;
        summary = `Service request approved: ${serviceSummary(o)}.`;
      }
    } else if (cmd.kind === "service-control" && (cmd.action === "deliver" || cmd.action === "return")) {
      // A held courier letter: deliver it anyway, or return it to the sender (no refund).
      dm();
      if (!o.terms.letter || o.status !== "paused" || o.progressDays !== o.terms.workDays)
        throw Error("Only a letter held on arrival can be delivered or returned.");
      if (cmd.action === "deliver") {
        if (!t.journal!.world!.npcs.some((n) => n.id === o.terms.letter!.recipientNpcId))
          throw Error(`${o.terms.letter.recipientName} no longer exists. Return the letter instead.`);
        o.completedDay ??= f.day;
        o.completedMinute ??= f.minuteOfDay ?? 0;
        note(o, "completed", `Delivered by the DM. In your thread with ${o.terms.letter.recipientName}. ${cmd.reason}`.slice(0, 1000), at);
        deliverLetter(t, o, at);
      } else note(o, "cancelled", `Returned to sender. Nothing is refunded. ${cmd.reason}`.slice(0, 1000), at);
      summary = `Letter ${cmd.action === "deliver" ? "delivered" : "returned"}: ${serviceSummary(o)}.`;
    } else if (cmd.kind === "service-control") {
      dm();
      if (cmd.action === "deliver" || cmd.action === "return") throw Error("Only a held letter can be delivered or returned.");
      controlOrder(o, cmd.action, cmd.reason, (x) => ["active", "paused", "ready"].includes(x.status), "This order cannot make that status change.");
      if (o.history.length < 50) o.history.push({ at, status: o.status, note: cmd.reason });
      summary = `Service order ${cmd.action}: ${serviceSummary(o)}.`;
    } else {
      own(o.purseId);
      if (o.status !== "ready") throw Error("This order is not ready to collect, or was already collected.");
      if (!presentAt(t, o.terms.locationId, o.purseId))
        throw Error(`Return to ${o.terms.shopName} with the paying character to collect.`);
      const out = o.terms.offer.output;
      if (out.kind !== "holding") throw Error("This order has nothing to collect.");
      t.holdings.push({
        id: o.id + "-crafted",
        purseId: o.purseId,
        kind: "item",
        quantity: o.terms.units,
        name: out.name,
        unitCopper: out.unitCopper,
        weight: out.weight,
        category: out.category || "service",
        notes: [
          out.notes,
          `Made by ${o.terms.npcName} at ${o.terms.shopName}, ${o.terms.placeName}.`,
          `Ordered campaign day ${o.orderedDay}; finished campaign day ${o.completedDay ?? f.day}; collected campaign day ${f.day}.`,
          `Order record: ${o.id}.`,
        ]
          .filter(Boolean)
          .join("\n"),
      });
      o.claimedDay = f.day;
      note(o, "claimed", "Collected into inventory.", at);
      summary = `Service order collected: ${serviceSummary(o)}.`;
    }
  }
  t.journal!.services = s;
  validateServices(t);
  t.journal!.events.push({
    id: cmd.id + "-service-event",
    at,
    kind: "management",
    summary: summary.slice(0, 500),
    ...(cmd.kind === "service-provider" ? { dmOnly: true } : { purseId: purseId! }),
  });
}
