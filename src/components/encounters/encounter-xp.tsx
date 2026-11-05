/**
 * XP from encounters: the DM's choice of XP for an encounter award (loot review, or "Award XP" on an
 * awarded encounter). Suggests the total from the enemies (their XP, else their CR), splits it
 * evenly among the ticked party characters with the xp-award remainder rule, and lets the DM
 * change the total or every share. A party that levels by milestones is offered "Mark milestone"
 * or nothing, never XP. Nothing here is stored: the choice is sent with the award request, and the
 * award's receipt keeps what was given (lib/quire/encounter-xp.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { isNpc, splitRecipients, type SplitTable } from "@/lib/quire/coin-split";
import {
  encounterXpShares,
  suggestEncounterXp,
  type EncounterXpInput,
  type EncounterXpReceipt,
} from "@/lib/quire/encounter-xp";
import { MAX_XP_AWARD } from "@/lib/quire/xp";
import { SplitRecipientPicker } from "@/components/coin-split";
import { Segmented } from "@/components/ui";

type Creature = Parameters<typeof suggestEncounterXp>[0][number];
export type EncounterXpChoice = { input: EncounterXpInput | null; problem: string };
const n = (value: number) => value.toLocaleString("en-US");
const whole = (text: string) => {
  const clean = text.replace(/[, ]/g, "");
  return /^\d+$/.test(clean) ? Number(clean) : NaN;
};
const selectClass = "min-h-11 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg";

export function EncounterXpChooser({
  combatants,
  table,
  mode,
  onChange,
}: {
  combatants: Creature[];
  table: SplitTable;
  /** "milestone": the party levels by milestones (from its sheets). */
  mode: "xp" | "milestone";
  onChange: (choice: EncounterXpChoice) => void;
}) {
  const suggestion = useMemo(() => suggestEncounterXp(combatants), [combatants]);
  const eligible = splitRecipients(table, "dm");
  const [kind, setKind] = useState<"xp" | "milestone" | "none">(() =>
    mode === "milestone" || suggestion.total === 0 ? "none" : "xp",
  );
  const [purseIds, setPurseIds] = useState<string[]>(() =>
    eligible.filter((p) => !isNpc(table, p)).map((p) => p.id),
  );
  const [total, setTotal] = useState(() => (suggestion.total ? String(suggestion.total) : ""));
  const [own, setOwn] = useState<Record<string, string> | null>(null);
  const [remainderTo, setRemainderTo] = useState("");
  const ticked = purseIds.filter((id) => eligible.some((p) => p.id === id));
  const name = (id: string) => eligible.find((p) => p.id === id)?.name ?? "Removed character";

  let input: EncounterXpInput | null = null;
  let problem = "";
  let preview: ReturnType<typeof encounterXpShares> | null = null;
  try {
    if (kind !== "none") {
      if (!ticked.length) throw Error("Choose at least one character.");
      if (kind === "milestone") input = { unit: "milestone", purseIds: ticked };
      else if (own) {
        const shares = ticked.map((id) => whole(own[id] ?? "0"));
        if (shares.some((s) => !Number.isSafeInteger(s) || s > MAX_XP_AWARD))
          throw Error("Enter each share as a whole number of XP.");
        const sum = shares.reduce((a, b) => a + b, 0);
        if (sum < 1 || sum > MAX_XP_AWARD) throw Error(`Give from 1 to ${n(MAX_XP_AWARD)} XP in all.`);
        input = { unit: "xp", purseIds: ticked, total: sum, shares };
      } else {
        const value = whole(total);
        if (!Number.isSafeInteger(value) || value < 1 || value > MAX_XP_AWARD)
          throw Error(`Enter the total XP, a whole number from 1 to ${n(MAX_XP_AWARD)}.`);
        input = {
          unit: "xp",
          purseIds: ticked,
          total: value,
          ...(remainderTo && ticked.includes(remainderTo) ? { remainderTo } : {}),
        };
      }
      preview = encounterXpShares(input);
    }
  } catch (e) {
    input = null;
    problem = e instanceof Error ? e.message : "Check the XP award.";
  }
  const report = JSON.stringify({ input, problem });
  useEffect(() => {
    onChange({ input, problem });
    // The choice is reported whenever it changes; `report` is its serialized form.
  }, [report]); // eslint-disable-line react-hooks/exhaustive-deps

  const kinds =
    mode === "milestone"
      ? [
          { value: "milestone" as const, label: "A milestone" },
          { value: "none" as const, label: "Nothing" },
        ]
      : [
          { value: "xp" as const, label: "Give XP" },
          { value: "milestone" as const, label: "A milestone" },
          { value: "none" as const, label: "No XP" },
        ];
  return (
    <section className="coin-split encounter-xp" aria-label="Experience from this encounter">
      <h4>Experience</h4>
      {mode === "milestone" && (
        <p className="text-sm text-muted">
          This party levels by milestones, so the award can mark a milestone instead of giving XP.
        </p>
      )}
      <Segmented label="Experience award" value={kind} onChange={setKind} options={kinds} />
      {kind !== "none" && (
        <>
          <SplitRecipientPicker
            table={table}
            actor="dm"
            selected={ticked}
            onChange={setPurseIds}
            legend={kind === "xp" ? "Split among" : "Mark a milestone for"}
          />
          {kind === "xp" && (
            <>
              <p className="text-sm text-muted" aria-label="Suggested XP">
                Suggested: {n(suggestion.total)} XP
                {suggestion.rows.length
                  ? ` (${suggestion.rows
                      .map((r) => `${r.name} ${r.from === "none" ? "no XP or CR" : `${n(r.xp)}${r.from === "cr" ? " by CR" : ""}`}`)
                      .join(", ")})`
                  : " (no enemies)"}
                .
              </p>
              {own ? (
                <fieldset className="coin-split-field">
                  <legend>Each share (XP)</legend>
                  {ticked.map((id) => (
                    <label key={id} className="encounter-xp-share">
                      <span>{name(id)}</span>
                      <input
                        inputMode="numeric"
                        aria-label={`XP for ${name(id)}`}
                        className={selectClass}
                        value={own[id] ?? "0"}
                        onChange={(e) => setOwn({ ...own, [id]: e.target.value })}
                      />
                    </label>
                  ))}
                  <button type="button" onClick={() => setOwn(null)}>
                    Split a total evenly instead
                  </button>
                </fieldset>
              ) : (
                <label className="coin-split-field">
                  <span>Total XP</span>
                  <input
                    inputMode="numeric"
                    aria-label="Total XP"
                    className={selectClass}
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                  />
                  <small>
                    {whole(total) !== suggestion.total && (
                      <button type="button" onClick={() => setTotal(String(suggestion.total))}>
                        Use the suggestion
                      </button>
                    )}{" "}
                    <button
                      type="button"
                      onClick={() =>
                        setOwn(
                          Object.fromEntries(
                            ticked.map((id) => [id, String(preview?.shares.find((s) => s.purseId === id)?.gain ?? 0)]),
                          ),
                        )
                      }
                    >
                      Set each share
                    </button>
                  </small>
                </label>
              )}
              {!own && preview && preview.remainder > 0 && (
                <label className="coin-split-field">
                  <span>Remainder: {n(preview.remainder)} XP</span>
                  <select
                    className={selectClass}
                    aria-label="Who gets the XP remainder"
                    value={preview.remainderTo ?? ""}
                    onChange={(e) => setRemainderTo(e.target.value)}
                  >
                    <option value="">Keep it unawarded</option>
                    {ticked.map((id) => (
                      <option key={id} value={id}>
                        Give it to {name(id)}
                      </option>
                    ))}
                  </select>
                  <small>Each share is rounded down; nothing extra is given unless you choose who gets it.</small>
                </label>
              )}
            </>
          )}
          {preview ? (
            <ul className="coin-split-preview" aria-label="XP preview">
              {preview.shares.map((s) => (
                <li key={s.purseId}>
                  <strong>{name(s.purseId)}</strong> {kind === "xp" ? `+${n(s.gain)} XP` : "+1 milestone"}
                </li>
              ))}
              {preview.remainder > 0 && preview.remainderTo === null && (
                <li>{n(preview.remainder)} XP is not awarded.</li>
              )}
            </ul>
          ) : (
            <p className="coin-split-hint" role="status">
              {problem}
            </p>
          )}
          <small className="text-muted">
            Levels never change by themselves: each sheet shows Ready to level up. Given once with
            this award; a retry never gives it twice.
          </small>
        </>
      )}
    </section>
  );
}

/** What an awarded encounter gave, for its receipt. */
export function EncounterXpReceiptView({
  receipt,
  name,
}: {
  receipt: EncounterXpReceipt;
  name: (purseId: string) => string;
}) {
  return (
    <section className="coin-split-preview" aria-label="Experience awarded">
      <div className="coin-split-preview-head">
        <strong>{receipt.unit === "xp" ? "Experience" : "Milestone"}</strong>
        <span className="tabular-nums">
          {receipt.unit === "xp" ? `${n(receipt.total)} XP` : `${receipt.shares.length} marked`}
        </span>
      </div>
      {receipt.shares.map((s) => (
        <div className="coin-split-row" key={s.purseId}>
          <span>{name(s.purseId)}</span>
          <span className="coin-split-amt">{receipt.unit === "xp" ? `+${n(s.gain)} XP` : "+1 milestone"}</span>
        </div>
      ))}
      {receipt.remainder ? (
        <div className="coin-split-row is-remainder">
          <span>
            Remainder{" "}
            {receipt.remainderTo ? `(included in ${name(receipt.remainderTo)}'s share)` : "kept unawarded"}
          </span>
          <span className="coin-split-amt">{n(receipt.remainder)} XP</span>
        </div>
      ) : null}
    </section>
  );
}
