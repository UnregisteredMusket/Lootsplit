import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { getCloudTable } from "@/lib/quire/cloud-client";
import { useCommandId, useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { formatCopper, fromCopper, parsePrice, toCopper } from "@/lib/quire/money";
import {
  defaultSplitRule,
  designatedPartyFund,
  isNpc,
  nextInRotation,
  partyFunds,
  planCoinSplit,
  remainderText,
  splitRecipients,
  type CoinSplitPlan,
  type SplitRule,
  type SplitTable,
} from "@/lib/quire/coin-split";
import type { Purse } from "@/lib/quire/types";
import { Button, TextInput } from "./ui";

const selectClass = "min-h-11 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg";

/** Gold, silver and copper chips for one share (the app's standard breakdown). */
export function CoinChips({ copper }: { copper: number }) {
  const c = fromCopper(copper);
  return (
    <span className="coin-split-chips" aria-hidden="true">
      {(["gp", "sp", "cp"] as const)
        .filter((k) => c[k] > 0)
        .map((k) => (
          <span key={k} className={`coin-split-chip ${k}`}>
            {c[k]} {k}
          </span>
        ))}
    </span>
  );
}

/** Recipient checkboxes: party player characters, then (DM only) companion NPCs. */
export function SplitRecipientPicker({
  table,
  actor,
  selected,
  onChange,
  you = [],
  showBalances = false,
  legend = "Split evenly among",
}: {
  table: SplitTable;
  actor: "dm" | "player";
  selected: string[];
  onChange: (ids: string[]) => void;
  you?: string[];
  showBalances?: boolean;
  legend?: string;
}) {
  const eligible = splitRecipients(table, actor);
  const players = eligible.filter((p) => !isNpc(table, p));
  const npcs = eligible.filter((p) => isNpc(table, p));
  // Keep Party order whatever order the boxes are ticked in.
  const toggle = (id: string, on: boolean) =>
    onChange(eligible.map((p) => p.id).filter((x) => (x === id ? on : selected.includes(x))));
  const row = (p: Purse, note: string) => (
    <label className="coin-split-check" key={p.id}>
      <input
        type="checkbox"
        checked={selected.includes(p.id)}
        onChange={(e) => toggle(p.id, e.target.checked)}
      />
      <span className="coin-split-who">
        {p.name}
        {you.includes(p.id) ? " (you)" : ""}
        <small>
          {you.includes(p.id) ? "Your own share stays in your purse" : note}
          {showBalances ? ` · ${formatCopper(toCopper(p.coins))}` : ""}
        </small>
      </span>
    </label>
  );
  return (
    <fieldset className="coin-split-group">
      <legend>{legend}</legend>
      {players.length > 1 && (
        <div className="coin-split-choose">
          <button
            type="button"
            className="coin-split-link"
            onClick={() => onChange(players.map((p) => p.id))}
          >
            All party characters
          </button>
          <button type="button" className="coin-split-link" onClick={() => onChange([])}>
            None
          </button>
        </div>
      )}
      {players.map((p) => row(p, "Player"))}
      {npcs.length > 0 && (
        <>
          <p className="coin-split-subgroup">
            Companion NPCs <span className="coin-split-tag">DM only</span>
          </p>
          {npcs.map((p) => row(p, "NPC travelling with the party · players never see this share"))}
        </>
      )}
      {!eligible.length && <p className="text-sm text-muted">No party characters can receive a share.</p>}
    </fieldset>
  );
}

/** The leftover-copper rule picker shared by fund and encounter splits. */
export function SplitRules({
  table,
  rule,
  onRule,
  plan,
  sourceId,
  recipientIds,
  purseId,
  onPurseId,
  encounter = false,
  isDm,
  projected,
}: {
  table: SplitTable;
  rule: SplitRule;
  onRule: (rule: SplitRule) => void;
  plan: CoinSplitPlan | null;
  sourceId: string | null;
  recipientIds: string[];
  purseId: string;
  onPurseId: (id: string) => void;
  encounter?: boolean;
  isDm: boolean;
  projected: boolean;
}) {
  const name = (id: string | null | undefined) =>
    table.purses.find((p) => p.id === id)?.name ?? "the party fund";
  const source = table.purses.find((p) => p.id === sourceId);
  const left = plan?.remainder ? formatCopper(plan.remainder) : "the leftover";
  const fund = designatedPartyFund(table, projected);
  const funds = partyFunds(table);
  const campaignDefault = defaultSplitRule(table);
  const next = recipientIds.length ? nextInRotation(table, recipientIds) : null;
  const badge = (r: SplitRule) =>
    r === campaignDefault ? <span className="coin-split-default">Campaign default</span> : null;
  const option = (r: SplitRule, label: string, note: ReactNode, extra?: ReactNode, disabled = false) => (
    <label className={`coin-split-rule${rule === r ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`} key={r}>
      <input type="radio" name={encounter ? "encounter-split-rule" : "split-rule"} checked={rule === r} disabled={disabled} onChange={() => onRule(r)} />
      <span>
        {label} {badge(r)}
      </span>
      <small>{note}</small>
      {extra}
    </label>
  );
  const partyNote = source?.kind === "party"
    ? `${source.name} is a party fund, so ${left} simply stays in it.`
    : fund
      ? `${left[0]?.toUpperCase()}${left.slice(1)} goes to ${name(fund)}.`
      : encounter
        ? "This campaign has no party fund. Choose who gets it; until you choose, it goes to the first ticked character."
        : `This campaign has no party fund, so ${left} stays in ${source?.name ?? "the source"}. The DM can add one under Party → Funds & inventory.`;
  return (
    <fieldset className="coin-split-group">
      <legend>Leftover copper</legend>
      <p className="text-sm text-muted">
        {plan
          ? plan.remainder
            ? `${formatCopper(plan.copper)} among ${plan.n} leaves ${formatCopper(plan.remainder)}. It goes:`
            : `${formatCopper(plan.copper)} divides evenly among ${plan.n}; nothing is left over.`
          : "When the amount does not divide evenly, the leftover copper goes:"}
      </p>
      <div className="coin-split-rules" role="radiogroup" aria-label="Leftover copper rule">
        {option(
          "party-fund",
          "To the party fund",
          partyNote,
          rule === "party-fund" && source?.kind !== "party" ? (
            !funds.length && encounter ? (
              <select className={selectClass} aria-label="Leftover recipient" value={purseId || recipientIds[0] || ""} onChange={(e) => onPurseId(e.target.value)}>
                {recipientIds.map((id) => (
                  <option key={id} value={id}>{name(id)}</option>
                ))}
              </select>
            ) : isDm && funds.length > 1 ? (
              <select className={selectClass} aria-label="Party fund for the leftover" value={purseId || fund || ""} onChange={(e) => onPurseId(e.target.value)}>
                {funds.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : null
          ) : null,
        )}
        {option(
          "source",
          "Stays in the source",
          encounter ? "Not available: encounter coins have no source purse." : `${left[0]?.toUpperCase()}${left.slice(1)} stays in ${source?.name ?? "the source"}.`,
          null,
          encounter,
        )}
        {option(
          "recipient",
          "To one recipient",
          `Choose who gets ${left}.`,
          rule === "recipient" ? (
            <select className={selectClass} aria-label="Leftover recipient" value={purseId} onChange={(e) => onPurseId(e.target.value)}>
              <option value="">Choose a ticked character</option>
              {recipientIds.map((id) => (
                <option key={id} value={id}>{name(id)}</option>
              ))}
            </select>
          ) : null,
        )}
        {option(
          "rotate",
          "Rotate",
          `Each split gives its leftover to the next person in line.${next ? ` Next: ${name(next)}.` : ""}${encounter ? " Shared with fund splits." : ""}`,
        )}
      </div>
    </fieldset>
  );
}

/** The share-by-share preview, with the conservation check. */
export function SplitPreview({
  plan,
  table,
  you = [],
  title = "Preview",
  note,
}: {
  plan: CoinSplitPlan;
  table: SplitTable;
  you?: string[];
  title?: string;
  note?: string;
}) {
  const name = (id: string) => table.purses.find((p) => p.id === id)?.name ?? "the party fund";
  const source = table.purses.find((p) => p.id === plan.sourceId);
  const after = source ? toCopper(source.coins) - plan.debit : 0;
  return (
    <section className="coin-split-preview" aria-label="Split preview" aria-live="polite">
      <div className="coin-split-preview-head">
        <strong>{title}</strong>
        <span className="tabular-nums">
          {plan.n} shares of {formatCopper(plan.share)}
        </span>
      </div>
      {plan.recipientIds.map((id) =>
        id === plan.sourceId ? (
          <div className="coin-split-row" key={id}>
            <span>
              {name(id)}
              {you.includes(id) ? " (you)" : ""} keeps
            </span>
            <span className="coin-split-amt">{formatCopper(plan.share)}</span>
          </div>
        ) : (
          <div className="coin-split-row" key={id}>
            <span>{name(id)}</span>
            <span className="coin-split-amt">+{formatCopper(plan.share)}</span>
            <CoinChips copper={plan.share} />
          </div>
        ),
      )}
      {plan.remainder > 0 && plan.remainderTo && (
        <div className="coin-split-row is-remainder">
          <span>{remainderText(plan, name)}</span>
          <span className="coin-split-amt">
            {plan.remainderMoves ? "+" : ""}
            {formatCopper(plan.remainder)}
          </span>
        </div>
      )}
      {source && (
        <div className="coin-split-row is-source">
          <span>
            {source.name} pays
            <small>Afterwards it holds {formatCopper(Math.max(0, after))}.</small>
          </span>
          <span className="coin-split-amt">−{formatCopper(plan.debit)}</span>
        </div>
      )}
      <div className="coin-split-sum">
        {plan.n} × {plan.share.toLocaleString("en")} cp
        {plan.remainder ? ` + ${plan.remainder} cp leftover` : ""} = {plan.copper.toLocaleString("en")} cp{" "}
        <b>✓ nothing created or lost</b>
        {note ? ` · ${note}` : ""}
      </div>
    </section>
  );
}

/**
 * Split coins from one purse (Party → Funds & inventory). Form → review → busy; a refusal
 * returns to the form with every choice kept and the same command ID for a retry.
 */
export function SplitCoins({
  sources,
  initialSourceId,
  onDone,
}: {
  sources: Purse[];
  initialSourceId?: string;
  onDone: () => void;
}) {
  const economy = useEconomy();
  const seat = useSeat();
  const isDm = seat.role === "dm";
  const joined = getCloudTable().joined;
  const projected = !isDm;
  const table: SplitTable = useMemo(
    () => ({ purses: economy.purses, journal: economy.journal }),
    [economy.purses, economy.journal],
  );
  const spendable = sources.filter((p) => toCopper(p.coins) > 0);
  const [sourceId, setSourceId] = useState(
    spendable.find((p) => p.id === initialSourceId)?.id ?? spendable[0]?.id ?? "",
  );
  const source = economy.purses.find((p) => p.id === sourceId);
  const [amount, setAmount] = useState(() => (source ? formatCopper(toCopper(source.coins)) : ""));
  const actor = isDm ? "dm" : "player";
  const eligible = splitRecipients(table, actor);
  const [recipientIds, setRecipientIds] = useState<string[]>(() =>
    eligible.filter((p) => !isNpc(table, p)).map((p) => p.id),
  );
  const [rule, setRule] = useState<SplitRule>(() => defaultSplitRule(table));
  const [purseId, setPurseId] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [stage, setStage] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copper = amount.trim() ? parsePrice(amount) : null;
  const ticked = recipientIds.filter((id) => eligible.some((p) => p.id === id));
  const remainderPurseId =
    rule === "recipient" || (rule === "party-fund" && purseId) ? purseId || undefined : undefined;
  let plan: CoinSplitPlan | null = null;
  let planError = "";
  try {
    if (copper === null) throw Error("Enter an amount, for example 50 gp.");
    plan = planCoinSplit(
      table,
      { sourceId, copper, recipientIds: ticked, rule, ...(remainderPurseId ? { purseId: remainderPurseId } : {}) },
      { actor, projected },
    );
  } catch (e) {
    planError = e instanceof Error ? e.message : "Check the split.";
  }
  const balance = source ? toCopper(source.coins) : 0;
  const overBalance = plan !== null && plan.debit > balance;
  const action = useCommandId(
    `${sourceId}|${copper}|${ticked.join(",")}|${rule}|${remainderPurseId ?? ""}|${makeDefault}`,
  );
  const name = (id: string | null) => economy.purses.find((p) => p.id === id)?.name ?? "the party fund";

  if (!isDm && !joined)
    return (
      <p className="text-sm text-muted">
        Splitting coins isn't available on a player link: the other characters live on the DM's
        device. Ask the DM to split, or use Give for one character at a time.
      </p>
    );
  if (!spendable.length)
    return <p className="text-sm text-muted">None of your purses holds coins to split.</p>;

  async function confirm() {
    if (!plan || busy) return;
    setBusy(true);
    setError("");
    try {
      const refusal = await economy.split(
        {
          sourceId,
          copper: plan.copper,
          recipientIds: plan.recipientIds,
          remainder: { rule, ...(remainderPurseId ? { purseId: remainderPurseId } : {}) },
          expect: { share: plan.share, remainderTo: plan.remainderTo },
          ...(makeDefault && isDm ? { makeDefault: true } : {}),
        },
        { commandId: action.commandId },
      );
      if (refusal) {
        setError(refusal);
        setStage("form");
        return;
      }
      action.renew();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  if (stage === "confirm" && plan) {
    const others = plan.recipientIds.map((id) => name(id));
    const list = others.length > 1 ? `${others.slice(0, -1).join(", ")} and ${others.at(-1)}` : others[0];
    return (
      <div className="coin-split" aria-busy={busy}>
        <h3 className="font-display text-xl">Split {formatCopper(plan.copper)}?</h3>
        <div className="coin-split-confirm">
          <p>
            From <strong>{source?.name}</strong> to {plan.n} characters:
          </p>
          <ul>
            <li>
              {list} each get <strong>{formatCopper(plan.share)}</strong>.
            </li>
            {plan.remainder > 0 && <li>{remainderText(plan, name)}</li>}
          </ul>
        </div>
        <p className="text-sm text-muted">
          This is one transaction: everyone is paid or nobody is. It appears once in Activity and
          the party chat. It can't be voided from the ledger; correct it with a Give or a payment.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void confirm()}>
            {busy ? (
              <>
                <span className="coin-split-spinner" aria-hidden="true" /> Splitting…
              </>
            ) : (
              "Split coins"
            )}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setStage("form")}>
            Back to edit
          </Button>
        </div>
        {busy && (
          <p className="text-sm text-muted" role="status">
            Waiting for the campaign to confirm. Pressing again can't pay twice: the split keeps one
            command ID until it succeeds.
          </p>
        )}
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (plan && !overBalance) setStage("confirm");
  };
  return (
    <form className="coin-split" onSubmit={submit}>
      {error && (
        <div className="coin-split-alert" role="alert">
          <strong>Nothing was split.</strong>
          {error} Your choices are kept.
        </div>
      )}
      <label className="coin-split-field">
        <span>From</span>
        <select
          className={selectClass}
          value={sourceId}
          onChange={(e) => {
            setSourceId(e.target.value);
            const next = economy.purses.find((p) => p.id === e.target.value);
            if (next) setAmount(formatCopper(toCopper(next.coins)));
          }}
          aria-label="Split from"
        >
          {spendable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.kind === "party" ? " · party fund" : ""} · {formatCopper(toCopper(p.coins))}
            </option>
          ))}
        </select>
        <small>Paid out with exact change, smallest coins first, as for any payment.</small>
      </label>
      <label className="coin-split-field">
        <span>Amount</span>
        <TextInput
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount to split"
          aria-invalid={overBalance || undefined}
          inputMode="text"
        />
        <small>
          {overBalance ? "More than the balance. " : "Type a smaller amount, for example 50 gp. "}
          <button
            type="button"
            className="coin-split-link"
            onClick={() => setAmount(formatCopper(balance))}
          >
            Use whole balance ({formatCopper(balance)})
          </button>
        </small>
      </label>
      <SplitRecipientPicker
        table={table}
        actor={actor}
        selected={ticked}
        onChange={setRecipientIds}
        you={isDm ? [] : seat.purseIds}
        showBalances={isDm}
      />
      <SplitRules
        table={table}
        rule={rule}
        onRule={(r) => {
          setRule(r);
          setPurseId("");
        }}
        plan={plan}
        sourceId={sourceId}
        recipientIds={ticked}
        purseId={purseId}
        onPurseId={setPurseId}
        isDm={isDm}
        projected={projected}
      />
      {isDm && (
        <label className="coin-split-check">
          <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
          <span className="coin-split-who">
            Make this the default for this campaign
            <small>DM only. Today's default: {defaultSplitRule(table).replace("-", " ")}.</small>
          </span>
        </label>
      )}
      {plan ? (
        <SplitPreview plan={plan} table={table} you={isDm ? [] : seat.purseIds} />
      ) : (
        <p className="coin-split-hint" role="status">
          {planError}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" disabled={!plan || overBalance}>
          Review split
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
