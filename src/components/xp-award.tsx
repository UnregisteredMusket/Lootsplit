/**
 * XP and milestones (loot plan phase 6): the DM's award form on Party → Characters. One
 * `xp-award` command per award (lib/quire/xp.ts), with a preview of exactly who gets what and,
 * for an even split, where the remainder goes. The level itself is never changed here: each
 * sheet shows "Ready to level up" and the person confirms the new level as a normal sheet edit.
 */
import { useMemo, useState, type FormEvent } from "react";
import { useCommandId, useEconomy } from "@/lib/quire/economy-context";
import { isNpc, splitRecipients, type SplitTable } from "@/lib/quire/coin-split";
import { MAX_XP_AWARD, planXpAward, type XpAwardInput, type XpAwardPlan } from "@/lib/quire/xp";
import { SplitRecipientPicker } from "./coin-split";
import { Button, Segmented, TextInput } from "./ui";

const selectClass = "min-h-11 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg";
const n = (value: number) => value.toLocaleString("en-US");

export function XpAward({ onDone }: { onDone: () => void }) {
  const economy = useEconomy();
  const table: SplitTable & { sheets: typeof economy.sheets } = useMemo(
    () => ({ purses: economy.purses, journal: economy.journal, sheets: economy.sheets }),
    [economy.purses, economy.journal, economy.sheets],
  );
  const eligible = splitRecipients(table, "dm");
  const [purseIds, setPurseIds] = useState<string[]>(() =>
    eligible.filter((p) => !isNpc(table, p)).map((p) => p.id),
  );
  const [unit, setUnit] = useState<"xp" | "milestone">("xp");
  const [rule, setRule] = useState<"each" | "split">("split");
  const [amount, setAmount] = useState("");
  const [remainderTo, setRemainderTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ticked = purseIds.filter((id) => eligible.some((p) => p.id === id));
  const value = /^\d+$/.test(amount.replace(/[, ]/g, "")) ? Number(amount.replace(/[, ]/g, "")) : NaN;
  const input: XpAwardInput = {
    unit,
    rule: unit === "milestone" ? "each" : rule,
    amount: value,
    purseIds: ticked,
    ...(unit === "xp" && rule === "split" && remainderTo && ticked.includes(remainderTo)
      ? { remainderTo }
      : {}),
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  };
  let plan: XpAwardPlan | null = null;
  let problem = "";
  try {
    if (!amount.trim()) throw Error(unit === "xp" ? "Enter the XP to award." : "Enter how many milestones.");
    plan = planXpAward(table, input);
  } catch (e) {
    problem = e instanceof Error ? e.message : "Check the award.";
  }
  const action = useCommandId(JSON.stringify(input));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!plan || busy) return;
    setBusy(true);
    try {
      if (await economy.awardXp(input, { commandId: action.commandId })) {
        action.renew();
        onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!eligible.length)
    return <p className="text-sm text-muted">Add a party character before awarding XP.</p>;
  return (
    <form className="coin-split xp-award" onSubmit={(e) => void submit(e)} aria-busy={busy}>
      <Segmented
        label="Award type"
        value={unit}
        onChange={setUnit}
        options={[
          { value: "xp", label: "Experience points" },
          { value: "milestone", label: "Milestones" },
        ]}
      />
      <label className="coin-split-field">
        <span>{unit === "xp" ? "XP" : "Milestones for each character"}</span>
        <TextInput
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label={unit === "xp" ? "XP to award" : "Milestones to award"}
          inputMode="numeric"
          placeholder={unit === "xp" ? "For example 1,200" : "1"}
        />
        <small>
          {unit === "xp"
            ? `Whole numbers, up to ${n(MAX_XP_AWARD)} per award.`
            : "Each milestone is one level (the usual milestone rule)."}
        </small>
      </label>
      {unit === "xp" && (
        <Segmented
          label="How to give it"
          value={rule}
          onChange={setRule}
          options={[
            { value: "split", label: "Split evenly" },
            { value: "each", label: "Each gets this" },
          ]}
        />
      )}
      <SplitRecipientPicker
        table={table}
        actor="dm"
        selected={ticked}
        onChange={setPurseIds}
        legend={unit === "xp" && rule === "split" ? "Split among" : "Award to"}
      />
      {plan && plan.remainder > 0 && (
        <label className="coin-split-field">
          <span>Remainder: {n(plan.remainder)} XP</span>
          <select
            className={selectClass}
            aria-label="Who gets the remainder"
            value={plan.remainderTo ?? ""}
            onChange={(e) => setRemainderTo(e.target.value)}
          >
            <option value="">Keep it unawarded</option>
            {plan.shares.map((s) => (
              <option key={s.purseId} value={s.purseId}>
                Give it to {s.name}
              </option>
            ))}
          </select>
          <small>
            {n(plan.amount)} doesn't divide evenly by {plan.shares.length}. Nothing is given away
            unless you choose who gets it.
          </small>
        </label>
      )}
      <label className="coin-split-field">
        <span>What for (optional)</span>
        <TextInput
          value={reason}
          maxLength={120}
          onChange={(e) => setReason(e.target.value)}
          aria-label="What the award is for"
          placeholder="For example: Cleared the goblin warren"
        />
      </label>
      {plan ? (
        <section className="coin-split-preview" aria-label="Award preview">
          <ul>
            {plan.shares.map((s) => (
              <li key={s.purseId}>
                <strong>{s.name}</strong>{" "}
                {plan.unit === "xp"
                  ? `+${n(s.gain)} XP → ${n(s.after)} XP`
                  : `+${n(s.gain)} → level ${s.after}`}
                {s.ready ? ` · ready to level up to ${s.ready}` : ""}
              </li>
            ))}
            {plan.remainder > 0 && plan.remainderTo === null && (
              <li>{n(plan.remainder)} XP is not awarded.</li>
            )}
          </ul>
          <small>
            One journal entry lists who got what; the party sees it
            {plan.npc ? " unless an NPC is included (then it's DM-only)" : ""}. Levels don't change
            until each character's player (or you) confirms the level on the sheet.
          </small>
        </section>
      ) : (
        <p className="coin-split-hint" role="status">
          {problem}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" disabled={!plan || busy}>
          {busy ? "Awarding…" : unit === "xp" ? "Award XP" : "Award milestones"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
