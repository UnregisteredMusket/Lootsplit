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
  type ServiceStatus,
} from "./services-schema.ts";
import { serviceQuote, serviceSummary } from "./services.ts";
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
  if (o.terms.offer.time.kind === "downtime-days")
    note(o, "active", `${paid} Work advances only with DM-approved downtime.`, at);
  else {
    o.completedDay = f.day;
    o.completedMinute = f.minuteOfDay ?? 0;
    note(o, "completed", `${paid} Recorded only; the DM updates character sheets.`, at);
  }
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
    if (q.terms.review === "dm")
      note(order, "requested", "Waiting for the DM's review. Nothing has been charged.", at);
    else settle(t, order, at, false);
    s.orders.push(order);
    purseId = cmd.purseId;
    summary = `Service ${order.status === "requested" ? "requested" : "ordered"}: ${serviceSummary(order)}.`;
  } else {
    const o = s.orders.find((x) => x.id === cmd.orderId);
    if (!o || !same(o, cmd.before)) throw Error("This order changed. Refresh before acting.");
    purseId = o.purseId;
    if (cmd.kind === "service-cancel") {
      own(o.purseId);
      if (o.status !== "requested") throw Error("Only a request waiting for the DM can be withdrawn.");
      note(o, "cancelled", "Withdrawn. Nothing was charged.", at);
      summary = `Service request withdrawn: ${serviceSummary(o)}.`;
    } else if (cmd.kind === "service-review") {
      dm();
      if (o.status !== "requested") throw Error("This request has already been decided.");
      if (cmd.decision === "deny") {
        if (!cmd.reason) throw Error("Give the player a reason for the denial.");
        note(o, "denied", `${cmd.reason} Nothing was charged.`, at);
        summary = `Service request denied: ${serviceSummary(o)}.`;
      } else {
        // Every check runs again against the campaign as it is now; the agreed price stands.
        const q = serviceQuote(t, o.providerId, o.offerKey, o.purseId, o.request);
        if (q.terms.priceCopper !== o.terms.priceCopper)
          throw Error("The price changed since the request. Deny it and ask the player to request again.");
        settle(t, o, at, true);
        if (cmd.reason) o.message = `${o.message} ${cmd.reason}`.slice(0, 1000);
        if (cmd.reason) o.history.at(-1)!.note = o.message;
        summary = `Service request approved: ${serviceSummary(o)}.`;
      }
    } else if (cmd.kind === "service-control") {
      dm();
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
