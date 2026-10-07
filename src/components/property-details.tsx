import { useState, useSyncExternalStore } from "react";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { formatCopper } from "@/lib/quire/money";
import type { Holding } from "@/lib/quire/types";
import { Button } from "./ui";
import { FeatureLink } from "./feature-navigation";
export function PropertyDetails() {
  const { holdings } = useEconomy(),
    seat = useSeat();
  const rows = holdings.filter(
    (h) =>
      h.kind === "property" &&
      h.quantity > 0 &&
      (seat.role === "dm" || seat.purseIds.includes(h.purseId)),
  );
  return (
    <section>
      <p>Edit descriptive details. Ownership, value, revenue and upkeep remain under DM control.</p>
      {rows.map((h) => (
        <PropertyEditor key={h.id} holding={h} />
      ))}
      {!rows.length && <p>No owned properties yet.</p>}
      <FeatureLink feature={seat.role === "dm" ? "reports" : "finances"}>
        View financial results
      </FeatureLink>
    </section>
  );
}
function PropertyEditor({ holding: h }: { holding: Holding }) {
  const { command } = useEconomy();
  const seat = useSeat();
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const viewOnly = room.joined && room.viewOnly && seat.role === "player";
  const [draft, setDraft] = useState({ name: h.name, notes: h.notes }),
    [before, setBefore] = useState(draft),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty = JSON.stringify(before) !== JSON.stringify(draft);
  useDraftGuard(dirty, "property");
  return (
    <form
      className="journal-entry grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || viewOnly) return;
        setBusy(true);
        setError("");
        try {
          await command({ kind: "property-details", holdingId: h.id, before, ...draft });
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
      <label>
        Property name
        <input
          required
          maxLength={160}
          value={draft.name}
          disabled={viewOnly}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <label>
        Description & notes
        <textarea
          maxLength={4000}
          value={draft.notes}
          disabled={viewOnly}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy || !dirty || viewOnly}>
        Save property details
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
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
