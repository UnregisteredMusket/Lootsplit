import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { readFilters, writeFilters } from "@/lib/quire/campaign-filters";
import { activeCampaignId } from "@/lib/quire/campaign-context";
import { isEphemeralCampaign } from "@/lib/quire/guest-storage";
import { CheckCheck } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { Button, EmptyState } from "@/components/ui";
import { useEconomy } from "@/lib/quire/economy-context";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import type { CloudTable } from "@/lib/quire/cloud";
import { requestConfirm } from "@/lib/quire/confirm-store";
import { formatCopper } from "@/lib/quire/money";
import { readEstate } from "@/lib/quire/estate-schema";
import { readServices } from "@/lib/quire/services-schema";
import { pooledLots } from "@/lib/quire/loot-claims";
import {
  REVIEW_TYPES,
  paymentsUnder,
  reviewCounts,
  reviewItems,
  reviewOutcome,
  reviewReceiptHref,
  reviewTotal,
  reviewTypeLabel,
  sortReviewItems,
  type ReviewItem,
  type ReviewType,
} from "@/lib/quire/review-inbox";
import { cn } from "@/lib/cn";
import {
  ReviewCard,
  useReviewStubs,
  useSavedReasons,
  type ReviewDecision,
  type SavedReasons,
} from "./review-card";
import { LoanReviewCard, PaymentReviewCard, paymentDecisionId } from "./review-cards-finance";
import { HireReviewCard, JobReviewCard, WithdrawalReviewCard } from "./property-operations";
import { BoardingReviewCard, VoyageReviewCard } from "./ship-management";
import { GroupRequestReview } from "./party-groups";
import { JourneyReviewEntry } from "./map-journeys";
import { ServiceRequestRow } from "./service-providers";
import { TrainingReviewEntry } from "./downtime-activities";
import { LootClaimsReview } from "./treasure-pool";
import { CharacterImportReviews } from "./character-import-reviews";
import { CampaignJournal } from "./campaign-journal";

/** Search and filters appear only when the queue is long enough to need them. */
const FILTER_THRESHOLD = 5;
const LIMIT_KEY = "lootsplit.review.bulk-limit-gp.v1";

function readLimit() {
  try {
    const n = Number(localStorage.getItem(LIMIT_KEY));
    return Number.isInteger(n) && n >= 1 && n <= 1000000 ? n : 10;
  } catch {
    return 10;
  }
}

/**
 * The DM's Review Inbox (design D2, QoL 5 and 13): every pending request in one queue sorted by
 * age, with type chips, a shared ReviewCard per request, stubs that stay in place after a
 * decision, "Approve all payments under N gp", saved deny reasons and A / D / J / K keys.
 */
export function ReviewInbox() {
  const { ready, purses, holdings, journal, loans, commandOutcome } = useEconomy();
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const world = useWorldTable() as unknown as CloudTable;
  const [imports, setImports] = useState<number | null>(null);
  const table = useMemo(() => ({ purses, holdings, journal, loans }), [purses, holdings, journal, loans]);
  const items = useMemo(() => reviewItems(table, room.joined ? imports : null), [table, imports, room.joined]);
  const stubs = useReviewStubs(
    items,
    (i) => i.key,
    (i) => ({ outcome: reviewOutcome(table, i) }),
  );
  const rows = sortReviewItems(stubs.rows.map((r) => ({ ...r, at: r.item.at })));
  const counts = reviewCounts(items);
  const total = reviewTotal(items);
  const reasons = useSavedReasons();
  // The type chip is remembered per campaign on this device (design QoL 3).
  const [filter, setFilterState] = useState<ReviewType | "all">(() => {
    const { type } = readFilters(activeCampaignId(), "review-inbox", { type: "all" });
    return type === "all" || REVIEW_TYPES.some((t) => t.type === type) ? (type as ReviewType | "all") : "all";
  });
  const setFilter = (type: ReviewType | "all") => {
    setFilterState(type);
    if (!isEphemeralCampaign())
      writeFilters(activeCampaignId(), "review-inbox", { type }, { type: "all" });
  };
  const [query, setQuery] = useState("");
  const filtering = total > FILTER_THRESHOLD;
  const q = filtering ? query.trim().toLowerCase() : "";
  const shown = rows.filter(
    (r) =>
      (filter === "all" || r.item.type === filter) &&
      (!q || `${reviewTypeLabel(r.item.type)} ${r.item.who} ${r.item.what}`.toLowerCase().includes(q)),
  );
  const present = REVIEW_TYPES.filter((t) => counts[t.type] > 0);
  const empty = REVIEW_TYPES.filter((t) => counts[t.type] === 0 && (t.type !== "imports" || room.joined));
  // A chip that empties while chosen falls back to the whole queue (once the campaign has
  // loaded; the remembered chip itself is kept for the next visit).
  useEffect(() => {
    if (!ready) return;
    if (filter !== "all" && counts[filter] === 0 && !rows.some((r) => r.item.type === filter && r.decided))
      setFilterState("all");
  }, [ready, filter, counts, rows]);

  const poolRow = rows.some((r) => r.item.kind === "pool");
  const poolLots = pooledLots(table).length;
  const importsRow = rows.some((r) => r.item.kind === "imports" && !r.decided);
  const onImports = useCallback((n: number | null) => {
    // Ignore "loading" reports so the entry does not flicker while a copy refetches.
    if (n !== null) setImports(n);
  }, []);

  return (
    <section id="review-inbox" className="review-inbox-queue" aria-labelledby="review-inbox-heading">
      <h2 id="review-inbox-heading" className="review-queue-title">
        {total ? `${total} waiting for you` : "All caught up"}
      </h2>
      {total === 0 && !rows.length && (
        <EmptyState
          className="review-empty"
          icon={<CheckCheck size={32} />}
          title="All caught up"
          body="Nothing is waiting for your review. New requests from players appear here."
          action={
            <AppLink className="settings-link" href="/?view=home">
              Back to the Desk
            </AppLink>
          }
        />
      )}
      {present.length > 1 && (
        <div className="review-chips" role="group" aria-label="Show request types">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All <span className="review-chip-count">{total}</span>
          </button>
          {present.map((t) => (
            <button
              key={t.type}
              type="button"
              aria-pressed={filter === t.type}
              onClick={() => setFilter(filter === t.type ? "all" : t.type)}
            >
              {t.label} <span className="review-chip-count">{counts[t.type]}</span>
            </button>
          ))}
        </div>
      )}
      {filtering && (
        <input
          className="ledger-search review-search"
          type="search"
          aria-label="Search requests"
          placeholder="Find a request, character or note"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {(filter === "all" || filter === "payments") && counts.payments > 1 && (
        <BulkPayments
          items={items.filter((i) => !rows.some((r) => r.key === i.key && r.decided))}
          approve={async (item) => {
            const outcome = await commandOutcome({
              id: paymentDecisionId(item.id, "approved"),
              kind: "payment-decision",
              requestId: item.id,
              status: "approved",
            });
            stubs.mark(item.key, { outcome: "approved", pending: outcome.status === "pending" });
          }}
        />
      )}
      <div className="review-queue" data-review-queue="">
        {shown.map((row) => (
          <ReviewEntry
            key={row.key}
            item={row.item}
            decided={row.decided}
            onDecided={(d) => stubs.mark(row.key, d)}
            reasons={reasons}
            world={world}
            onImports={onImports}
          />
        ))}
        {!shown.length && rows.length > 0 && (
          <p className="review-none-match">
            No requests match.{" "}
            <button type="button" className="settings-link" onClick={() => (setFilter("all"), setQuery(""))}>
              Show all
            </button>
          </p>
        )}
      </div>
      {total > 0 && filter === "all" && empty.length > 0 && (
        <p className="review-nothing-else">
          <strong>Nothing else pending</strong> · {empty.map((t) => t.label).join(", ")}
        </p>
      )}
      {total > 0 && (
        <p className="review-keys">
          Keyboard: focus a card, then <kbd>A</kbd> approve · <kbd>D</kbd> deny · <kbd>J</kbd> /{" "}
          <kbd>K</kbd> next / previous.
        </p>
      )}
      <details className="review-history" id="review-history-fold">
        <summary>Decided requests, history and imports</summary>
        <CampaignJournal section="bank" reviewOnly />
        {!poolRow && poolLots > 0 && <LootClaimsReview />}
        {!poolRow && poolLots === 0 && (
          <p className="text-sm text-muted">
            The treasure pool is empty. <AppLink href="/party?section=pool">Open the treasure pool →</AppLink>
          </p>
        )}
        {room.joined ? (
          !importsRow && <CharacterImportReviews code={room.code} onPending={onImports} />
        ) : (
          <p>Open a shared session to review account character imports.</p>
        )}
      </details>
    </section>
  );
}

/** One queue entry: the request's own card, or its full review inside a shared card. */
function ReviewEntry({
  item,
  decided,
  onDecided,
  reasons,
  world,
  onImports,
}: {
  item: ReviewItem;
  decided?: ReviewDecision;
  onDecided: (d: ReviewDecision) => void;
  reasons: SavedReasons;
  world: CloudTable;
  onImports: (n: number | null) => void;
}) {
  const { journal, loans } = useEconomy();
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const common = { decided, onDecided, savedReasons: reasons };
  const estate = readEstate(journal.propertyOperations);
  switch (item.kind) {
    case "payment": {
      const r = journal.requests.find((x) => x.id === item.id);
      if (r) return <PaymentReviewCard request={r} {...common} />;
      break;
    }
    case "loan": {
      const l = loans.find((x) => x.id === item.id);
      if (l) return <LoanReviewCard loan={l} {...common} />;
      break;
    }
    case "hire": {
      const c = estate.staff.find((x) => x.id === item.id);
      if (c) return <HireReviewCard staff={c} {...common} />;
      break;
    }
    case "job": {
      const j = estate.jobs.find((x) => x.id === item.id);
      if (j) return <JobReviewCard job={j} {...common} />;
      break;
    }
    case "withdrawal": {
      const r = estate.withdrawals.find((x) => x.id === item.id);
      if (r) return <WithdrawalReviewCard request={r} {...common} />;
      break;
    }
    case "boarding": {
      const r = journal.fleet?.boarding.find((x) => x.id === item.id);
      if (r) return <BoardingReviewCard request={r} {...common} />;
      break;
    }
    case "voyage": {
      const v = journal.fleet?.voyages.find((x) => x.id === item.id);
      if (v) return <VoyageReviewCard voyage={v} {...common} />;
      break;
    }
    case "group":
      return <GroupRequestReview requestId={item.id} {...common} />;
  }
  // Requests whose review needs more than two buttons keep their full review inside the card.
  const order = item.kind === "service" ? readServices(journal.services).orders.find((o) => o.id === item.id) : undefined;
  return (
    <ReviewCard
      typeLabel={reviewTypeLabel(item.type).replace(/s$/, "")}
      who={item.who}
      what={item.what}
      copper={item.copper}
      direction={item.direction}
      balanceAfter={item.balanceAfter}
      at={item.at}
      decided={decided}
      receiptHref={reviewReceiptHref(item)}
      keepBody={item.kind === "pool"}
      className={cn(`review-card-${item.kind}`)}
    >
      {item.kind === "journey" && <JourneyReviewEntry journeyId={item.id} />}
      {item.kind === "service" && order && <ServiceRequestRow order={order} table={world} dm />}
      {item.kind === "training" && <TrainingReviewEntry requestId={item.id} />}
      {item.kind === "pool" && <LootClaimsReview />}
      {item.kind === "imports" && room.joined && <CharacterImportReviews code={room.code} onPending={onImports} />}
    </ReviewCard>
  );
}

/** "Approve all payments under N gp": one confirmation, then one command per payment. */
function BulkPayments({ items, approve }: { items: ReviewItem[]; approve: (item: ReviewItem) => Promise<void> }) {
  const [limit, setLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ ok: number; failed: Array<{ item: ReviewItem; error: string }> } | null>(null);
  useEffect(() => setLimit(readLimit()), []);
  const under = paymentsUnder(items, limit * 100);
  const sum = under.reduce((n, i) => n + (i.copper ?? 0), 0);
  async function run() {
    if (busy || !under.length) return;
    const list = [...under];
    const ok = await requestConfirm({
      title: `Approve ${list.length} ${list.length === 1 ? "payment" : "payments"} under ${limit} gp?`,
      body: (
        <>
          <p>
            Total {formatCopper(sum)}. Each payment is approved on its own and charged once; any that
            can't be recorded stay pending.
          </p>
          <ul className="review-bulk-list">
            {list.map((i) => (
              <li key={i.key}>
                {i.who} · {i.what} · {formatCopper(i.copper ?? 0)}
              </li>
            ))}
          </ul>
        </>
      ),
      confirmLabel: `Approve ${list.length}`,
    });
    if (!ok) return;
    setBusy(true);
    setReport(null);
    const failed: Array<{ item: ReviewItem; error: string }> = [];
    let done = 0;
    for (const item of list) {
      try {
        await approve(item);
        done++;
      } catch (e) {
        failed.push({ item, error: e instanceof Error ? e.message : "Not recorded." });
      }
    }
    setReport({ ok: done, failed });
    setBusy(false);
  }
  return (
    <div className="review-bulk" role="group" aria-label="Approve payments in bulk">
      <label>
        Approve all payments under
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={1000000}
          step={1}
          value={limit}
          aria-label="Payment limit in gold pieces"
          onChange={(e) => {
            const n = Math.max(1, Math.min(1000000, Math.floor(Number(e.target.value) || 1)));
            setLimit(n);
            try {
              localStorage.setItem(LIMIT_KEY, String(n));
            } catch {
              // Not remembered on this device.
            }
          }}
        />
        gp
      </label>
      <Button variant="secondary" disabled={busy || !under.length} onClick={() => void run()}>
        {busy
          ? "Approving…"
          : under.length
            ? `Approve ${under.length} · ${formatCopper(sum)}…`
            : "None under this amount"}
      </Button>
      {report && (
        <div role={report.failed.length ? "alert" : "status"} className="review-bulk-report">
          <p>
            Approved {report.ok} of {report.ok + report.failed.length}.
            {report.failed.length ? " These stay pending:" : ""}
          </p>
          {report.failed.length > 0 && (
            <ul>
              {report.failed.map(({ item, error }) => (
                <li key={item.key}>
                  {item.who} · {item.what} · {formatCopper(item.copper ?? 0)}: {error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
