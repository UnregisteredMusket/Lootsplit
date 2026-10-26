import type { CloudTable } from "./cloud.ts";
import { toCopper } from "./money.ts";
import { readEstate } from "./estate-schema.ts";
import { readServices } from "./services-schema.ts";
import { readDowntimeActivities } from "./downtime-activities-schema.ts";
import { lotClaims, pooledLots, readLootClaims } from "./loot-claims.ts";
import { locationLabel, readMarketLocations } from "./shop-locations.ts";

/**
 * Review Inbox (design D2, dm-mobile finding 3): every request that waits for the DM, as one list
 * sorted by age. Read-only: it derives the queue from the campaign. Decisions still go through each
 * request's own command (payment-decision, decision, estate-staff, service-review…), unchanged.
 */
export type ReviewType =
  | "payments"
  | "loans"
  | "hires"
  | "property"
  | "ships"
  | "journeys"
  | "services"
  | "pool"
  | "training"
  | "groups"
  | "imports";

/** Chip labels, in the order the chips appear. */
export const REVIEW_TYPES: ReadonlyArray<{ type: ReviewType; label: string }> = [
  { type: "payments", label: "Payments" },
  { type: "loans", label: "Loans" },
  { type: "hires", label: "Hires" },
  { type: "journeys", label: "Journeys" },
  { type: "services", label: "Services" },
  { type: "pool", label: "Pool" },
  { type: "training", label: "Training" },
  { type: "groups", label: "Group moves" },
  { type: "property", label: "Property" },
  { type: "ships", label: "Ships" },
  { type: "imports", label: "Imports" },
];
export const reviewTypeLabel = (type: ReviewType) =>
  REVIEW_TYPES.find((t) => t.type === type)?.label ?? type;

export type ReviewKind =
  | "payment"
  | "loan"
  | "hire"
  | "job"
  | "withdrawal"
  | "boarding"
  | "voyage"
  | "journey"
  | "service"
  | "pool"
  | "training"
  | "group"
  | "imports";

export type ReviewItem = {
  /** Unique within the inbox: `${kind}:${id}`. */
  key: string;
  type: ReviewType;
  kind: ReviewKind;
  /** The record's own ID (request, order, staff, journey…); "pool"/"imports" for the grouped entries. */
  id: string;
  /** Who asked, or whose account it concerns. */
  who: string;
  /** One line: what approving does. */
  what: string;
  /** Whole copper that approving moves, when it moves a known amount. */
  copper?: number;
  /** "out": approving charges `purseId`; "in": approving credits it. */
  direction?: "out" | "in";
  purseId?: string;
  /** The account's balance in copper after approval, where the amount and account are known. */
  balanceAfter?: number;
  /** When it was asked (ms since epoch); absent for records that store no time. */
  at?: number;
  /** How many requests this entry stands for (the treasure pool's ready items, imports). */
  count: number;
  /** Property and ship requests: the holding they belong to (for "View receipt"). */
  propertyId?: string;
};

type ReviewTable = Pick<CloudTable, "purses" | "holdings" | "journal"> & {
  loans: CloudTable["loans"];
};

const purseName = (t: ReviewTable, id: string | undefined, fallback = "A character") =>
  t.purses.find((p) => p.id === id)?.name ?? fallback;
const balance = (t: ReviewTable, id: string | undefined) => {
  const p = t.purses.find((x) => x.id === id);
  return p ? toCopper(p.coins) : undefined;
};
const after = (t: ReviewTable, id: string | undefined, delta: number) => {
  const now = balance(t, id);
  return now === undefined ? undefined : now + delta;
};

/**
 * Every pending request for the DM, oldest first. Records without a stored time (hires, property
 * work, ships) follow the dated ones, in their saved order. `imports` is the account service's
 * pending character-import count when known (it is not part of the campaign).
 */
export function reviewItems(t: ReviewTable, imports: number | null = null): ReviewItem[] {
  const items: ReviewItem[] = [];
  const journal = t.journal;
  const market = readMarketLocations(journal?.market);
  const place = (id: string | null | undefined) => locationLabel(market, id) || "a place";

  for (const r of journal?.requests ?? [])
    if (r.status === "pending")
      items.push({
        key: `payment:${r.id}`,
        type: "payments",
        kind: "payment",
        id: r.id,
        who: purseName(t, r.purseId),
        what: r.note,
        copper: r.copper,
        direction: "out",
        purseId: r.purseId,
        balanceAfter: after(t, r.purseId, -r.copper),
        at: r.at,
        count: 1,
      });
  for (const l of t.loans ?? [])
    if (l.status === "pending")
      items.push({
        key: `loan:${l.id}`,
        type: "loans",
        kind: "loan",
        id: l.id,
        who: purseName(t, l.purseId, l.purseName || "A character"),
        what: l.note,
        copper: l.copper,
        direction: "in",
        purseId: l.purseId,
        balanceAfter: after(t, l.purseId, l.copper),
        at: l.at,
        count: 1,
      });

  for (const o of readServices(journal?.services).orders)
    if (o.status === "requested") {
      const asked = o.history.find((h) => h.status === "requested")?.at;
      items.push({
        key: `service:${o.id}`,
        type: "services",
        kind: "service",
        id: o.id,
        who: purseName(t, o.purseId),
        what: `${o.terms.offer.name}${o.terms.item ? ` ${o.terms.item.name}` : ""} from ${o.terms.npcName}`,
        copper: o.terms.priceCopper,
        direction: "out",
        purseId: o.purseId,
        balanceAfter: after(t, o.purseId, -o.terms.priceCopper),
        at: asked,
        count: 1,
      });
    }

  for (const j of journal?.world?.journeys ?? [])
    if (j.status === "proposed" || j.status === "planned") {
      const fare = j.costs.fare;
      items.push({
        key: `journey:${j.id}`,
        type: "journeys",
        kind: "journey",
        id: j.id,
        who: j.requestedBy === "dm" ? "DM draft" : purseName(t, j.requestedBy, "A player"),
        what: `Journey to ${place(j.destinationLocationId)}`,
        ...(fare
          ? {
              copper: fare.copper,
              direction: "out" as const,
              purseId: fare.payerId,
              balanceAfter: after(t, fare.payerId, -fare.copper),
            }
          : {}),
        at: j.createdAt,
        count: 1,
      });
    }

  for (const r of journal?.world?.groupRequests ?? [])
    if (r.status === "pending")
      items.push({
        key: `group:${r.id}`,
        type: "groups",
        kind: "group",
        id: r.id,
        who: purseName(t, r.purseId, "A player"),
        what: `Move their group to ${place(r.locationId)}`,
        at: r.createdAt,
        count: 1,
      });

  for (const r of readDowntimeActivities(journal?.downtimeActivities).requests)
    if (r.status === "pending")
      items.push({
        key: `training:${r.id}`,
        type: "training",
        kind: "training",
        id: r.id,
        who: r.trainerName,
        what: r.lessonOrderId
          ? `Paid lesson: ${r.topic} from ${r.npcName}`
          : `Training ${r.npcName}: ${r.topic}`,
        ...(r.lessonOrderId && r.feeCopper ? { copper: r.feeCopper, direction: "out" as const } : {}),
        at: r.at,
        count: 1,
      });

  // The treasure pool resolves in one reviewed batch, so it is one entry for all ready items.
  const ready = pooledLots(t).filter((h) => lotClaims(t, h.id).some((c) => c.choice !== "pass"));
  if (ready.length) {
    const ids = new Set(ready.map((h) => h.id));
    const claimed = readLootClaims(t)
      .claims.filter((c) => ids.has(c.holdingId) && c.choice !== "pass")
      .map((c) => c.at);
    items.push({
      key: "pool:pool",
      type: "pool",
      kind: "pool",
      id: "pool",
      who: "The party",
      what: `${ready.length} treasure pool ${ready.length === 1 ? "item has" : "items have"} claims to resolve`,
      at: claimed.length ? Math.min(...claimed) : undefined,
      count: ready.length,
    });
  }

  const estate = readEstate(journal?.propertyOperations);
  const holdingName = (id: string, fallback: string) =>
    t.holdings.find((h) => h.id === id)?.name ?? fallback;
  for (const s of estate.staff)
    if (s.status === "proposed")
      items.push({
        key: `hire:${s.id}`,
        type: "hires",
        kind: "hire",
        id: s.id,
        propertyId: s.propertyId,
        who: holdingName(s.propertyId, "A property"),
        what: `Hire ${s.name} as ${s.role}`,
        copper: s.wageCopper,
        count: 1,
      });
  for (const j of estate.jobs)
    if (j.status === "draft")
      items.push({
        key: `job:${j.id}`,
        type: "property",
        kind: "job",
        id: j.id,
        propertyId: j.propertyId,
        who: purseName(t, j.purseId, holdingName(j.propertyId, "A property")),
        what: `Property work: ${j.name} at ${holdingName(j.propertyId, "a property")}`,
        count: 1,
      });
  for (const r of estate.withdrawals)
    if (r.status === "pending")
      items.push({
        key: `withdrawal:${r.id}`,
        type: "property",
        kind: "withdrawal",
        id: r.id,
        propertyId: r.propertyId,
        who: purseName(t, r.purseId),
        what: `Withdraw ${r.quantity} × ${holdingName(r.holdingId, "stored item")}`,
        count: 1,
      });
  for (const r of journal?.fleet?.boarding ?? [])
    if (r.status === "pending")
      items.push({
        key: `boarding:${r.id}`,
        type: "ships",
        kind: "boarding",
        id: r.id,
        propertyId: r.propertyId,
        who: purseName(t, r.purseId),
        what: `${r.action[0]?.toUpperCase()}${r.action.slice(1)} ${holdingName(r.propertyId, "a ship")}`,
        count: 1,
      });
  for (const v of journal?.fleet?.voyages ?? [])
    if (v.status === "proposed")
      items.push({
        key: `voyage:${v.id}`,
        type: "ships",
        kind: "voyage",
        id: v.id,
        propertyId: v.propertyId,
        who: holdingName(v.propertyId, "A ship"),
        what: `Voyage ${place(v.originId)} → ${place(v.destinationId)}`,
        copper: v.budgetCopper,
        count: 1,
      });

  if (imports)
    items.push({
      key: "imports:imports",
      type: "imports",
      kind: "imports",
      id: "imports",
      who: "Account players",
      what: `${imports} character ${imports === 1 ? "import waits" : "imports wait"} for approval`,
      count: imports,
    });

  return sortReviewItems(items);
}

/** Oldest first; undated records after dated ones, each keeping its saved order. */
export function sortReviewItems<T extends { at?: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (a.item.at ?? Number.POSITIVE_INFINITY) - (b.item.at ?? Number.POSITIVE_INFINITY) ||
        a.index - b.index,
    )
    .map((x) => x.item);
}

/** The number on the Desk tab and the Review Inbox title: requests, not entries. */
export const reviewTotal = (items: Pick<ReviewItem, "count">[]) =>
  items.reduce((n, i) => n + i.count, 0);

/** Pending count per chip type. */
export function reviewCounts(items: Pick<ReviewItem, "type" | "count">[]) {
  const counts = Object.fromEntries(REVIEW_TYPES.map((t) => [t.type, 0])) as Record<ReviewType, number>;
  for (const i of items) counts[i.type] += i.count;
  return counts;
}

/** "Approve all payments under N gp": the pending payments strictly below the limit, oldest first. */
export function paymentsUnder(items: ReviewItem[], limitCopper: number) {
  return items.filter(
    (i) => i.kind === "payment" && i.copper !== undefined && i.copper < limitCopper,
  );
}

/** "3 days ago" style age for a card; empty when the record stored no time. */
export function reviewAge(at: number | undefined, now = Date.now()) {
  if (at === undefined || !Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export type ReviewOutcome = "approved" | "denied" | "cancelled" | "withdrawn" | "resolved";

/**
 * What became of an entry that left the queue, read back from the campaign (for the inline
 * "Approved · View receipt" stub). Records that store no decision read as "resolved".
 */
export function reviewOutcome(t: ReviewTable, item: Pick<ReviewItem, "kind" | "id">): ReviewOutcome {
  const j = t.journal;
  const status = (() => {
    switch (item.kind) {
      case "payment":
        return j?.requests.find((r) => r.id === item.id)?.status;
      case "loan":
        return t.loans.find((l) => l.id === item.id)?.status;
      case "service":
        return readServices(j?.services).orders.find((o) => o.id === item.id)?.status;
      case "journey":
        return j?.world?.journeys?.find((x) => x.id === item.id)?.status;
      case "group":
        return j?.world?.groupRequests?.find((r) => r.id === item.id)?.status;
      case "training":
        return readDowntimeActivities(j?.downtimeActivities).requests.find((r) => r.id === item.id)?.status;
      case "hire":
        return readEstate(j?.propertyOperations).staff.find((s) => s.id === item.id)?.status;
      case "job":
        return readEstate(j?.propertyOperations).jobs.find((x) => x.id === item.id)?.status;
      case "withdrawal":
        return readEstate(j?.propertyOperations).withdrawals.find((r) => r.id === item.id)?.status;
      case "boarding":
        return j?.fleet?.boarding.find((r) => r.id === item.id)?.status;
      case "voyage":
        return j?.fleet?.voyages.find((v) => v.id === item.id)?.status;
      default:
        return undefined;
    }
  })() as string | undefined;
  if (status === "denied") return "denied";
  if (status === "cancelled") return "cancelled";
  if (status === "withdrawn") return "withdrawn";
  if (status === undefined || item.kind === "pool" || item.kind === "imports") return "resolved";
  return "approved";
}

/** Where the decision's record can be read afterwards ("View receipt"). */
export function reviewReceiptHref(item: Pick<ReviewItem, "kind" | "id" | "propertyId">): string | undefined {
  const propertyId = item.propertyId;
  switch (item.kind) {
    case "payment":
    case "service":
      return "/features/reports";
    case "loan":
      return "/features/bank";
    case "hire":
    case "job":
    case "withdrawal":
    case "boarding":
    case "voyage":
      return propertyId
        ? `/features/properties#property-${encodeURIComponent(propertyId)}`
        : "/features/properties";
    case "training":
      return "/features/downtime";
    case "journey":
      return "/maps";
    case "group":
      return "/party?section=characters";
    default:
      return undefined;
  }
}
