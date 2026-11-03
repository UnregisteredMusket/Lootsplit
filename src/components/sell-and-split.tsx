/**
 * Sell and split (loot phase 4; mockup approved by the owner on 2026-11-03): sell items from a
 * party fund at one open shop and split the proceeds evenly, as one atomic `sale-split` command.
 * Form → review → busy; a refusal returns to the form with every choice kept and the same
 * command ID, so pressing again can never sell or pay twice.
 */
import { useMemo, useState, type FormEvent } from "react";
import { getCloudTable } from "@/lib/quire/cloud-client";
import { useCommandId, useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { useSeatGroups } from "@/lib/quire/use-seat-groups";
import { shopVisible } from "@/lib/quire/vendors";
import { formatCopper } from "@/lib/quire/money";
import { creditCoins, defaultSplitRule, isNpc, remainderText, splitRecipients, type SplitRule } from "@/lib/quire/coin-split";
import { lotLabel, planSaleSplit, saleProblem, unitSalePrice, type SaleSplitPlan } from "@/lib/quire/sale-split";
import type { Purse } from "@/lib/quire/types";
import { SplitPreview, SplitRecipientPicker, SplitRules } from "./coin-split";
import { Button } from "./ui";

const selectClass = "min-h-11 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg";

export function SellAndSplit({
  funds,
  initialFundId,
  onDone,
}: {
  /** Party funds this seat may spend from. */
  funds: Purse[];
  initialFundId?: string;
  onDone: () => void;
}) {
  const economy = useEconomy();
  const seat = useSeat();
  const groups = useSeatGroups();
  const isDm = seat.role === "dm";
  const actor = isDm ? "dm" : "player";
  const projected = !isDm;
  const joined = getCloudTable().joined;
  const [fundId, setFundId] = useState(funds.find((p) => p.id === initialFundId)?.id ?? funds[0]?.id ?? "");
  const shops = economy.shops.filter(
    (s) => isDm || (seat.shopIds.includes(s.id) && shopVisible(s, { journal: economy.journal }, groups)),
  );
  const open = shops.filter((s) => !s.closed);
  const [shopId, setShopId] = useState(open[0]?.id ?? "");
  const shop = open.find((s) => s.id === shopId);
  const fund = economy.purses.find((p) => p.id === fundId);
  const items = economy.holdings.filter((h) => h.purseId === fundId && h.kind === "item");
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const table = useMemo(
    () => ({ purses: economy.purses, journal: economy.journal, holdings: economy.holdings, shops: economy.shops }),
    [economy.purses, economy.journal, economy.holdings, economy.shops],
  );
  const eligible = splitRecipients(table, actor);
  const [recipientIds, setRecipientIds] = useState<string[]>(() =>
    eligible.filter((p) => !isNpc(table, p)).map((p) => p.id),
  );
  const [rule, setRule] = useState<SplitRule>(() => defaultSplitRule(table));
  const [purseId, setPurseId] = useState("");
  const [stage, setStage] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const problem = (id: string) => {
    const h = items.find((x) => x.id === id);
    return h && shop ? saleProblem(h, shop, actor) : "Choose a shop.";
  };
  const lots = items
    .filter((h) => chosen[h.id] && !problem(h.id))
    .map((h) => ({ holdingId: h.id, quantity: Math.min(chosen[h.id]!, h.quantity) }));
  const ticked = recipientIds.filter((id) => eligible.some((p) => p.id === id));
  const remainderPurseId =
    rule === "recipient" || (rule === "party-fund" && purseId) ? purseId || undefined : undefined;
  let plan: SaleSplitPlan | null = null;
  let planError = "";
  try {
    if (!shop) throw Error("No shop here is open to buy. Open the Market to check the hours.");
    plan = planSaleSplit(
      table,
      {
        fundId,
        shopId,
        lots,
        recipientIds: ticked,
        rule,
        ...(remainderPurseId ? { purseId: remainderPurseId } : {}),
      },
      { actor, projected },
    );
  } catch (e) {
    planError = e instanceof Error ? e.message : "Check the sale.";
  }
  const action = useCommandId(
    `${fundId}|${shopId}|${lots.map((l) => `${l.holdingId}:${l.quantity}`).join(",")}|${ticked.join(",")}|${rule}|${remainderPurseId ?? ""}`,
  );
  const name = (id: string | null) => economy.purses.find((p) => p.id === id)?.name ?? "the party fund";

  if (!isDm && !joined)
    return (
      <p className="text-sm text-muted">
        Sell and split isn't available on a player link: the other characters live on the DM's device. Ask the DM, or
        sell one item at a shop.
      </p>
    );
  if (!funds.length) return <p className="text-sm text-muted">Sell and split works from a party fund you can spend from.</p>;

  async function confirm() {
    if (!plan || busy) return;
    setBusy(true);
    setError("");
    try {
      const refusal = await economy.sellAndSplit(
        {
          fundId,
          shopId,
          lots,
          recipientIds: plan.split.recipientIds,
          remainder: { rule, ...(remainderPurseId ? { purseId: remainderPurseId } : {}) },
          expect: { proceeds: plan.proceeds, share: plan.split.share, remainderTo: plan.split.remainderTo },
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
    const names = plan.lots.map(lotLabel);
    const listOf = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
    const count = plan.lots.length;
    return (
      <div className="coin-split" aria-busy={busy}>
        <h3 className="font-display text-xl">
          Sell {count === 1 ? names[0] : `${count} items`} to {plan.shopName} and split {formatCopper(plan.proceeds)}?
        </h3>
        <div className="coin-split-confirm">
          <ul>
            <li>
              {listOf(names)} {count === 1 && plan.lots[0]!.quantity === 1 ? "leaves" : "leave"} {fund?.name}.
            </li>
            <li>
              {fund?.name} receives {formatCopper(plan.proceeds)} from {plan.shopName}, then pays it out at once.
            </li>
            <li>
              {listOf(plan.split.recipientIds.map(name))} each get <strong>{formatCopper(plan.split.share)}</strong>.
            </li>
            {plan.split.remainder > 0 && <li>{remainderText(plan.split, name)}</li>}
          </ul>
        </div>
        <p className="text-sm text-muted">
          One action: everything happens or nothing does. Pressing again after an error never sells or pays twice. It
          appears once in Activity and the party chat.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void confirm()}>
            {busy ? (
              <>
                <span className="coin-split-spinner" aria-hidden="true" /> Selling…
              </>
            ) : (
              "Sell & split"
            )}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setStage("form")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (plan) setStage("confirm");
  };
  const others = shops.filter((s) => s.id !== shopId);
  return (
    <form className="coin-split" onSubmit={submit} aria-label="Sell and split">
      {error && (
        <div className="coin-split-alert" role="alert">
          <strong>Nothing was sold or split.</strong>
          {error} Your choices are kept; check the list and review again.
        </div>
      )}
      {funds.length > 1 && (
        <label className="coin-split-field">
          <span>From</span>
          <select className={selectClass} value={fundId} onChange={(e) => { setFundId(e.target.value); setChosen({}); }} aria-label="Sell from">
            {funds.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="coin-split-field">
        <span>Sell at</span>
        <select className={selectClass} value={shopId} onChange={(e) => setShopId(e.target.value)} aria-label="Sell at">
          {open.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.place ? ` · ${s.place}` : ""} · pays {Math.round(s.buyRate * 100)}%
            </option>
          ))}
        </select>
        <small>
          {open.length ? "Open shops where the party is." : "No shop here is open."}
          {others.length
            ? ` Other shops here: ${others
                .slice(0, 4)
                .map((s) => `${s.name} (${s.closed ? "closed" : `pays ${Math.round(s.buyRate * 100)}%`})`)
                .join(", ")}${others.length > 4 ? `, and ${others.length - 4} more` : ""}.`
            : ""}
        </small>
      </label>
      <fieldset className="coin-split-group">
        <legend>Items</legend>
        {!items.length && <p className="text-sm text-muted">{fund?.name ?? "This fund"} holds no items.</p>}
        {items.map((h) => {
          const why = problem(h.id);
          const qty = chosen[h.id] ?? 0;
          const pays = shop ? unitSalePrice(h, shop) : 0;
          return (
            <div className={`coin-split-check${why ? " is-disabled" : ""}`} key={h.id}>
              <input
                type="checkbox"
                aria-label={`Sell ${h.name}`}
                checked={!why && qty > 0}
                disabled={!!why}
                onChange={(e) => setChosen({ ...chosen, [h.id]: e.target.checked ? h.quantity : 0 })}
              />
              <span className="coin-split-who">
                {h.name}
                {h.quantity > 1 ? ` ×${h.quantity}` : ""}
                {h.pool ? " · in the pool" : ""}
                <small>
                  {why ??
                    `${h.quantity > 1 ? `${h.quantity} × ` : ""}${formatCopper(h.unitCopper)} value · ${shop?.name} pays ${formatCopper(pays * Math.max(1, qty || h.quantity))}`}
                </small>
              </span>
              {!why && qty > 0 && h.quantity > 1 ? (
                <input
                  type="number"
                  min={1}
                  max={h.quantity}
                  value={qty}
                  aria-label={`How many ${h.name} to sell`}
                  className="sale-split-qty rounded-sm border border-border bg-subtle px-2 text-base text-fg"
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(h.quantity, Math.floor(Number(e.target.value) || 1)));
                    setChosen({ ...chosen, [h.id]: n });
                  }}
                />
              ) : null}
            </div>
          );
        })}
        <small className="text-sm text-muted">
          Each price is the item's value × the shop's buy rate, rounded to whole copper per unit, exactly as Sell to shop
          does.
        </small>
      </fieldset>
      <div className="coin-split-preview-head sale-split-proceeds" aria-live="polite">
        <strong>Proceeds</strong>
        <span className="tabular-nums">{formatCopper(lots.reduce((sum, l) => sum + (shop ? unitSalePrice(items.find((h) => h.id === l.holdingId)!, shop) * l.quantity : 0), 0))}</span>
      </div>
      <SplitRecipientPicker
        table={table}
        actor={actor}
        selected={ticked}
        onChange={setRecipientIds}
        you={isDm ? [] : seat.purseIds}
        legend="Split the proceeds evenly among"
      />
      <SplitRules
        table={table}
        rule={rule}
        onRule={(r) => {
          setRule(r);
          setPurseId("");
        }}
        plan={plan?.split ?? null}
        sourceId={fundId}
        recipientIds={ticked}
        purseId={purseId}
        onPurseId={setPurseId}
        isDm={isDm}
        projected={projected}
      />
      {plan ? (
        <SplitPreview
          plan={plan.split}
          // The fund receives the proceeds before it pays out: show its balance after both.
          table={{
            ...table,
            purses: table.purses.map((p) => (p.id === fundId ? { ...p, coins: creditCoins(p.coins, plan!.proceeds) } : p)),
          }} you={isDm ? [] : seat.purseIds} note={`sold for ${formatCopper(plan.proceeds)}`} />
      ) : (
        <p className="coin-split-hint" role="status">
          {planError}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" disabled={!plan}>
          Review sale &amp; split
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
