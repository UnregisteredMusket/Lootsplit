import { useState, type FormEvent } from "react";
import { useCommandId, useEconomy } from "@/lib/quire/economy-context";
import { designatedPartyFund, partyFunds } from "@/lib/quire/coin-split";
import { presentedHolding } from "@/lib/quire/item-identity";
import { readLootClaims } from "@/lib/quire/loot-claims";
import {
  departedSummary,
  isDeparted,
  returnableHoldings,
  returnFingerprint,
} from "@/lib/quire/loot-return";
import { formatCopper, parsePrice, toCopper } from "@/lib/quire/money";
import type { CloudTable } from "@/lib/quire/cloud";
import type { Purse } from "@/lib/quire/types";
import { Button, TextInput } from "./ui";

const selectClass = "min-h-11 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg";

/**
 * The prompt after the DM takes a character out of the party or hides it: "Aster left with 3
 * items and 42 gp. Return them to the party?" Never automatic; Keep leaves everything as it is.
 */
export function DepartedPrompt({
  table,
  purse,
  onKeep,
}: {
  table: Pick<CloudTable, "purses" | "holdings" | "journal">;
  purse: Purse;
  onKeep: () => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = departedSummary(table, purse);
  if (!summary || !isDeparted(table, purse)) return null;
  if (open) return <ReturnToParty table={table} purse={purse} onDone={onKeep} onCancel={() => setOpen(false)} />;
  return (
    <div className="coin-split" role="status" aria-label={`${purse.name} left the party`}>
      <p>
        <strong>
          {purse.name} left with {summary}.
        </strong>{" "}
        Return them to the party?
      </p>
      <p className="text-sm text-muted">
        Nothing moves unless you choose. Keeping them leaves everything with {purse.name}, as before.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => setOpen(true)}>Choose what to return…</Button>
        <Button variant="ghost" onClick={onKeep}>
          Keep with {purse.name}
        </Button>
      </div>
    </div>
  );
}

/** DM: choose a departed character's items and coins to return to the pool or a party fund. */
export function ReturnToParty({
  table,
  purse,
  onDone,
  onCancel,
}: {
  table: Pick<CloudTable, "purses" | "holdings" | "journal">;
  purse: Purse;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const { lootReturn } = useEconomy();
  const items = returnableHoldings(table, purse.id);
  const funds = partyFunds(table);
  const held = toCopper(purse.coins);
  const claims = readLootClaims(table).claims.filter((c) => c.purseId === purse.id).length;
  const [picked, setPicked] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((h) => [h.id, h.quantity])),
  );
  const [amount, setAmount] = useState(held ? formatCopper(held) : "0 cp");
  const [fundId, setFundId] = useState(designatedPartyFund(table) ?? funds[0]?.id ?? "");
  const [pool, setPool] = useState(true);
  const [stage, setStage] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action = useCommandId(`${purse.id}:${fundId}:${pool}:${amount}:${JSON.stringify(picked)}`);
  if (!isDeparted(table, purse)) return null;
  const copper = parsePrice(amount);
  const chosen = items
    .filter((h) => (picked[h.id] ?? 0) > 0)
    .map((h) => ({ holdingId: h.id, quantity: Math.min(h.quantity, Math.floor(picked[h.id]!)) }));
  const fund = funds.find((p) => p.id === fundId);
  const overBalance = copper !== null && copper > held;
  const nothing = !chosen.length && !copper && !claims;
  const where = pool ? `the treasure pool (${fund?.name ?? "party fund"})` : (fund?.name ?? "the party fund");
  if (!funds.length)
    return <p className="text-sm text-muted">Add a party fund before returning {purse.name}'s items to the party.</p>;

  async function confirm() {
    if (busy || copper === null || !fund) return;
    setBusy(true);
    setError("");
    try {
      const refusal = await lootReturn(
        {
          purseId: purse.id,
          to: { fundId: fund.id, pool },
          items: chosen,
          copper,
          expect: returnFingerprint(table, purse.id, fund.id),
        },
        { commandId: action.commandId },
      );
      if (refusal) {
        setError(refusal);
        setStage("form");
        return;
      }
      action.renew();
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  if (stage === "confirm")
    return (
      <div className="coin-split" aria-busy={busy}>
        <h3 className="font-display text-xl">Return to the party?</h3>
        <div className="coin-split-confirm">
          <p>
            From <strong>{purse.name}</strong> to <strong>{where}</strong>:
          </p>
          <ul>
            {chosen.map((c) => {
              const h = items.find((x) => x.id === c.holdingId)!;
              return (
                <li key={c.holdingId}>
                  {presentedHolding(h).name} × {c.quantity}
                  {h.attuned && c.quantity === h.quantity ? " · attunement ends" : ""}
                </li>
              );
            })}
            {!!copper && <li>{formatCopper(copper)}</li>}
            {claims > 0 && (
              <li>
                {claims} open treasure-pool claim{claims === 1 ? "" : "s"} withdrawn
              </li>
            )}
          </ul>
        </div>
        <p className="text-sm text-muted">
          One transaction: everything moves or nothing does. Each item gets a ledger line naming{" "}
          {purse.name}.{pool ? " Items arrive in the pool unclaimed." : ""} Fairness totals don't change.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void confirm()}>
            {busy ? "Returning…" : "Return to party"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setStage("form")}>
            Back to edit
          </Button>
        </div>
        {busy && (
          <p className="text-sm text-muted" role="status">
            Waiting for the campaign to confirm. Pressing again can't move anything twice.
          </p>
        )}
      </div>
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (copper !== null && !overBalance && !nothing && fund) setStage("confirm");
  };
  return (
    <form className="coin-split" onSubmit={submit} aria-label={`Return ${purse.name}'s items to the party`}>
      <h3 className="font-display text-xl">Return to party</h3>
      {error && (
        <div className="coin-split-alert" role="alert">
          <strong>Nothing moved.</strong>
          {error} Your choices are kept.
        </div>
      )}
      <fieldset className="coin-split-group">
        <legend>Items</legend>
        {items.length > 1 && (
          <div className="coin-split-choose">
            <button
              type="button"
              className="coin-split-link"
              onClick={() => setPicked(Object.fromEntries(items.map((h) => [h.id, h.quantity])))}
            >
              All items
            </button>
            <button type="button" className="coin-split-link" onClick={() => setPicked({})}>
              None
            </button>
          </div>
        )}
        {items.map((h) => {
          const name = presentedHolding(h).name;
          const n = picked[h.id] ?? 0;
          return (
            <label className="coin-split-check" key={h.id}>
              <input
                type="checkbox"
                checked={n > 0}
                aria-label={`Return ${name}`}
                onChange={(e) => setPicked((all) => ({ ...all, [h.id]: e.target.checked ? h.quantity : 0 }))}
              />
              <span className="coin-split-who">
                {name}
                <small>
                  {h.quantity > 1 ? `${h.quantity} held` : "1 held"}
                  {h.attuned ? " · attuned" : ""}
                  {h.equipped ? " · equipped" : ""}
                  {h.unidentified ? " · unidentified" : ""}
                </small>
              </span>
              {h.quantity > 1 && n > 0 && (
                <input
                  className="sale-split-qty"
                  type="number"
                  min={1}
                  max={h.quantity}
                  value={n}
                  aria-label={`How many ${name}`}
                  onChange={(e) =>
                    setPicked((all) => ({
                      ...all,
                      [h.id]: Math.max(1, Math.min(h.quantity, Math.floor(Number(e.target.value) || 1))),
                    }))
                  }
                />
              )}
            </label>
          );
        })}
        {!items.length && <p className="text-sm text-muted">{purse.name} carries no items that can be returned.</p>}
      </fieldset>
      <label className="coin-split-field">
        <span>Coins</span>
        <TextInput
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Coins to return"
          inputMode="text"
        />
        <small>
          {purse.name} holds {formatCopper(held)}.{" "}
          {copper === null
            ? "Enter an amount such as 42 gp or 0 cp."
            : overBalance
              ? `That is more than ${purse.name} holds.`
              : "Whole copper; change is made from the smallest coins first."}
        </small>
      </label>
      <label className="coin-split-field">
        <span>To</span>
        <select className={selectClass} value={fundId} onChange={(e) => setFundId(e.target.value)} aria-label="Return to party fund">
          {funds.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="coin-split-check">
        <input type="checkbox" checked={pool} onChange={(e) => setPool(e.target.checked)} />
        <span className="coin-split-who">
          Put the items in the treasure pool
          <small>Unclaimed, so the party can mark Need, Greed or Pass. Coins go to the fund.</small>
        </span>
      </label>
      {claims > 0 && (
        <p className="text-sm text-muted">
          {purse.name}'s {claims} open treasure-pool claim{claims === 1 ? " is" : "s are"} withdrawn and logged.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" disabled={copper === null || overBalance || nothing}>
          Review return
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
