import { useEffect, useState, useSyncExternalStore } from "react";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { formatCopper } from "@/lib/quire/money";
import type { Holding } from "@/lib/quire/types";
import { Button, TextInput, TextArea } from "./ui";
import { FeatureLink } from "./feature-navigation";
import { PropertyFinancialPlan } from "./campaign-operations";
import { readFinance } from "@/lib/quire/finance";
import { readArchivedSnapshot } from "@/lib/quire/journal";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { AppLink } from "./app-link";
export function PropertyDetails({ plans = false }: { plans?: boolean }) {
  const { holdings, purses, journal, ledger } = useEconomy(),
    seat = useSeat();
  const rows = holdings.filter(
    (h) =>
      h.kind === "property" &&
      h.quantity > 0 &&
      (seat.role === "dm" || seat.purseIds.includes(h.purseId)),
  );
  const finance = readFinance(journal.finance);
  const records = [...ledger];
  let unavailable = 0;
  for (const report of journal.reports || []) {
    try {
      if (report.error) throw Error(report.error);
      records.push(...readArchivedSnapshot(report.snapshot).ledger);
    } catch {
      unavailable++;
    }
  }
  return (
    <section id="campaign-operations">
      <p>Edit descriptive details. Ownership, value, revenue and upkeep remain under DM control.</p>
      {rows.map((h) => (
        <article className="journal-entry" key={h.id} id={`property-${encodeURIComponent(h.id)}`}>
          <p>
            Owner: {purses.find((p) => p.id === h.purseId)?.name || "Missing account"} · Property
            record {h.id}
          </p>
          <PropertyEditor holding={h} />
          {plans && seat.role === "dm" && <PropertyFinancialPlan holding={h} />}
          <PropertyHistory holding={h} records={records} finance={finance} />
        </article>
      ))}
      {!rows.length && (
        <p>
          No owned properties yet.{" "}
          {seat.role === "dm" ? (
            <AppLink href="/party?section=funds">Add a property in Funds & inventory</AppLink>
          ) : (
            <AppLink href="/market">View available Market property listings</AppLink>
          )}
        </p>
      )}
      {unavailable > 0 && (
        <p role="status">
          {unavailable} archived report{unavailable === 1 ? " is" : "s are"} unavailable; no history
          is fabricated from active records.
        </p>
      )}
      {seat.role === "dm" && (
        <AppLink href="/features/financial">Open the complete recurring rule editor</AppLink>
      )}
      <FeatureLink feature={seat.role === "dm" ? "reports" : "finances"}>
        View financial results
      </FeatureLink>
    </section>
  );
}
function PropertyEditor({ holding: h }: { holding: Holding }) {
  const { commandOutcome } = useEconomy();
  const seat = useSeat();
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const viewOnly = room.joined && room.viewOnly && seat.role === "player";
  const [draft, setDraft] = useState({ name: h.name, notes: h.notes }),
    [before, setBefore] = useState(draft),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const dirty = JSON.stringify(before) !== JSON.stringify(draft);
  useDraftGuard(dirty, "property");
  const changed = h.name !== before.name || h.notes !== before.notes;
  useEffect(() => {
    if (!dirty && !busy) {
      const next = { name: h.name, notes: h.notes };
      setDraft(next);
      setBefore(next);
    }
  }, [h.name, h.notes, dirty, busy]);
  return (
    <form
      className="journal-entry grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || viewOnly) return;
        setBusy(true);
        setError("");
        try {
          const result = await commandOutcome({
            kind: "property-details",
            holdingId: h.id,
            before,
            ...draft,
          });
          setNotice(mutationNotice(result, "Property details saved."));
          setBefore(draft);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not save property.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{h.name}</h2>
      {viewOnly && (
        <p role="status">
          This room is view-only until the DM resumes play. Your draft is kept in this view.
        </p>
      )}
      <p>
        Quantity {h.quantity} · Value each {formatCopper(h.unitCopper)}
      </p>
      <label className="grid gap-2 text-sm">
        Property name
        <TextInput
          required
          maxLength={160}
          value={draft.name}
          disabled={viewOnly}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <label className="grid gap-2 text-sm">
        Description & notes
        <TextArea
          maxLength={4000}
          value={draft.notes}
          disabled={viewOnly}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </label>
      {changed && dirty && (
        <p role="status">
          Stored details changed. Your draft is retained. Reload to compare before saving.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Button type="submit" disabled={busy || !dirty || viewOnly || changed}>
        Save property details
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          if (
            dirty &&
            !window.confirm(
              "Discard unsaved property description changes and reload current details?",
            )
          )
            return;
          const next = { name: h.name, notes: h.notes };
          setDraft(next);
          setBefore(next);
        }}
      >
        Reload details
      </Button>
    </form>
  );
}

function PropertyHistory({
  holding,
  records,
  finance,
}: {
  holding: Holding;
  records: import("@/lib/quire/types").LedgerLine[];
  finance: ReturnType<typeof readFinance>;
}) {
  const ruleIds = new Set(finance.rules.filter((r) => r.holdingId === holding.id).map((r) => r.id));
  const settlementIds = new Set(
    finance.downtime
      .filter((d) => d.status === "applied")
      .flatMap((d) => d.quote.lines.filter((l) => ruleIds.has(l.id)).map((l) => `${d.id}-${l.id}`)),
  );
  const unique = new Map(
    records
      .filter(
        (r) =>
          r.purseId === holding.purseId &&
          (r.purchase?.holding?.id === holding.id || settlementIds.has(r.id)),
      )
      .map((r) => [r.id, r]),
  );
  return (
    <details>
      <summary>Linked original property records · {unique.size}</summary>
      {[...unique.values()]
        .sort((a, b) => b.at - a.at)
        .map((r) => (
          <article key={r.id}>
            <p>
              {new Date(r.at).toLocaleString()} · {r.summary} · {formatCopper(r.copper)}
            </p>
            <small>Original record {r.id}</small>
          </article>
        ))}
      {!unique.size && (
        <p>
          No original transaction link is stored for this property. Full authorized history remains
          in financial reports; names are not used to invent a link.
        </p>
      )}
    </details>
  );
}
