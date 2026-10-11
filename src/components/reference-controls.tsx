import { useState } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import {
  type ReferencePolicy,
  referencePolicy,
  referenceSections,
} from "@/lib/quire/reference-access";
import { mutationNotice } from "@/lib/quire/mutation-outcome";

export function ReferenceControls() {
  const economy = useEconomy(),
    seat = useSeat(),
    policy = referencePolicy(economy.journal.referenceAccess);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  if (seat.role !== "dm") return null;
  async function save(next: ReferencePolicy) {
    setBusy(true);
    setNotice("");
    try {
      const outcome = await economy.commandOutcome({
        kind: "reference-policy",
        before: policy,
        policy: next,
      });
      setNotice(mutationNotice(outcome, "Player reference access saved."));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to save reference access.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="mt-4 grid gap-3" disabled={busy || !economy.ready}>
      <legend className="font-display text-xl">Player reference lookup</legend>
      <p className="text-sm text-muted">
        Players search read-only indices. Lookup pauses during active encounters by default; their
        saved sheet and shared campaign records remain available.
      </p>
      <label className="flex gap-3 items-center">
        <input
          type="checkbox"
          checked={policy.enabled}
          onChange={(e) => void save({ ...policy, enabled: e.target.checked })}
        />
        Allow player reference lookup
      </label>
      {referenceSections.map((section) => (
        <label className="flex gap-3 items-center" key={section}>
          <input
            type="checkbox"
            checked={policy.sections.includes(section)}
            aria-label={`Allow ${section} lookup`}
            onChange={(e) =>
              void save({
                ...policy,
                sections: referenceSections.filter((s) =>
                  s === section ? e.target.checked : policy.sections.includes(s),
                ),
              })
            }
          />
          {section === "items" ? "Items & catalog" : section === "spells" ? "Spells" : "Creatures"}
        </label>
      ))}
      <label className="flex gap-3 items-center">
        <input
          type="checkbox"
          checked={policy.allowDuringEncounters}
          onChange={(e) => void save({ ...policy, allowDuringEncounters: e.target.checked })}
        />
        Allow lookup during active encounters
      </label>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </fieldset>
  );
}
