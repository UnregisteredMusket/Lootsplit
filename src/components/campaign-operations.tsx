import { useEffect, useState } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { readFinance } from "@/lib/quire/finance";
import { formatCopper } from "@/lib/quire/money";
import { mutationNotice, type EconomyMutationOutcome } from "@/lib/quire/mutation-outcome";
import type { CommandInput } from "@/lib/quire/commands";
import type { Shop, Holding } from "@/lib/quire/types";
import { useDisclosureAnchor } from "@/lib/help/use-disclosure-anchor";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { AppLink } from "./app-link";
import { CoinAmountInput, FinanceReadiness } from "./finance-input";
import { Button, TextInput } from "./ui";

export function CampaignOperations({
  section = "all",
}: {
  section?: "all" | "shops" | "properties";
}) {
  const { shops, holdings, journal, commandOutcome } = useEconomy(),
    seat = useSeat();
  const ref = useDisclosureAnchor("campaign-operations"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const finance = readFinance(journal.finance);
  if (seat.role !== "dm") return null;
  const locked = busy || finance.downtime.some((d) => d.status === "pending");
  async function save(input: CommandInput) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await commandOutcome(input);
      setNotice(mutationNotice(result, "Campaign operations saved."));
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save campaign operations.");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return (
    <details open ref={ref} id="campaign-operations" className="review-inbox">
      <summary>
        {section === "shops"
          ? "Shop schedules"
          : section === "properties"
            ? "Property financial plans"
            : "Shop schedules & property management"}
      </summary>
      <p>
        Campaign day {finance.day}. Time advances only when the DM approves downtime. Opening days
        repeat from day 0. Scheduled restocking tops up finite stock without reducing surplus or
        changing unlimited stock.
      </p>
      <FinanceReadiness pendingDowntime={finance.downtime.some((d) => d.status === "pending")} />
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {section !== "properties" && (
        <>
          <h3>Shop schedules</h3>
          {shops.map((s) => (
            <ShopPlan key={s.id} shop={s} day={finance.day} disabled={locked} save={save} />
          ))}
          {!shops.length && (
            <p>
              <AppLink href="/market">Create a shop in Market & stock</AppLink> first.
            </p>
          )}
        </>
      )}
      {section !== "shops" && (
        <>
          <h3>Properties</h3>
          <p>
            <AppLink href="/party?section=funds">Add a property in Funds & inventory</AppLink>, then
            set revenue and upkeep here. Amounts are for the entire holding per period. Unpaid
            upkeep remains owed.
          </p>
          {holdings
            .filter((h) => h.kind === "property" && h.quantity > 0)
            .map((h) => (
              <PropertyFinancialPlan key={h.id} holding={h} />
            ))}
          {!holdings.some((h) => h.kind === "property" && h.quantity > 0) && (
            <p>No owned properties yet.</p>
          )}
        </>
      )}
    </details>
  );
}
function ShopPlan({
  shop,
  day,
  disabled,
  save,
}: {
  shop: Shop;
  day: number;
  disabled: boolean;
  save: (c: CommandInput) => Promise<EconomyMutationOutcome>;
}) {
  const { stock } = useEconomy();
  const initial = {
    cycle: shop.schedule?.cycleDays || 7,
    days: shop.schedule?.openDays.join(",") ?? "0,1,2,3,4",
    interval: shop.schedule?.restockEveryDays || 0,
    quantity: shop.schedule?.restockQuantity || 5,
  };
  const initialJson = JSON.stringify(initial),
    scheduleJson = JSON.stringify(shop.schedule);
  const [draft, setDraft] = useState(initial),
    [before, setBefore] = useState(draft),
    [source, setSource] = useState(JSON.stringify(shop.schedule)),
    [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(before),
    changed = source !== JSON.stringify(shop.schedule);
  useDraftGuard(dirty, "shop schedule");
  useEffect(() => {
    if (!dirty && !disabled) {
      const next = JSON.parse(initialJson) as typeof initial;
      setDraft(next);
      setBefore(next);
      setSource(scheduleJson);
    }
  }, [initialJson, scheduleJson, dirty, disabled]);
  const days = draft.days.trim() ? draft.days.split(",").map((d) => Number(d.trim())) : [];
  const valid =
    Number.isSafeInteger(draft.cycle) &&
    draft.cycle >= 1 &&
    draft.cycle <= 30 &&
    days.every((d) => Number.isSafeInteger(d) && d >= 0 && d < draft.cycle) &&
    new Set(days).size === days.length;
  const nextOpen = valid
    ? Array.from({ length: draft.cycle }, (_, i) => day + i).find((d) =>
        days.includes(d % draft.cycle),
      )
    : undefined;
  const nextRestock = shop.schedule?.restockEveryDays
    ? shop.schedule.lastRestockDay + shop.schedule.restockEveryDays
    : undefined;
  function reload() {
    if (
      dirty &&
      !window.confirm("Discard unsaved shop schedule changes and reload current settings?")
    )
      return;
    const next = initial;
    setDraft(next);
    setBefore(next);
    setSource(JSON.stringify(shop.schedule));
    setError("");
  }
  return (
    <details className="journal-entry">
      <summary>
        {shop.name} · {shop.schedule ? "Scheduled" : "Manual"} · {shop.closed ? "Closed" : "Open"}
      </summary>
      {changed && (
        <p role="status">
          The stored schedule changed. Your draft is retained; reload before saving.
        </p>
      )}
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (changed) return;
          setError("");
          try {
            await save({
              kind: "shop-schedule",
              shopId: shop.id,
              schedule: {
                cycleDays: draft.cycle,
                openDays: days,
                restockEveryDays: draft.interval,
                restockQuantity: draft.quantity,
                lastRestockDay: day,
              },
            });
            setBefore(draft);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Schedule failed. Your draft is retained.");
          }
        }}
      >
        <label>
          Cycle length in days
          <input
            type="number"
            min="1"
            max="30"
            required
            value={draft.cycle}
            onChange={(e) => {
              const cycle = Number(e.target.value);
              if (
                days.some((d) => d >= cycle) &&
                !window.confirm(
                  "The shorter cycle excludes selected opening days. Keep those selections for review? They must be corrected before saving.",
                )
              )
                return;
              setDraft({ ...draft, cycle });
            }}
          />
        </label>
        <fieldset disabled={disabled}>
          <legend>Opening days</legend>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: Math.min(30, Math.max(0, draft.cycle || 0)) }, (_, i) => (
              <label className="inline-flex min-h-11 items-center gap-2" key={i}>
                <input
                  type="checkbox"
                  checked={days.includes(i)}
                  onChange={(e) => {
                    const selected = new Set(days);
                    if (e.target.checked) selected.add(i);
                    else selected.delete(i);
                    setDraft({ ...draft, days: [...selected].sort((a, b) => a - b).join(",") });
                  }}
                />
                Day {i + 1}
              </label>
            ))}
          </div>
        </fieldset>
        <details>
          <summary>Advanced opening-day entry</summary>
          <label>
            Open days in cycle (0-based, comma separated)
            <input
              value={draft.days}
              onChange={(e) => setDraft({ ...draft, days: e.target.value })}
              placeholder="0,1,2,3,4"
            />
          </label>
          <p>Day 1 is stored as 0. Selected days remain visible and are never silently removed.</p>
        </details>
        {!valid && (
          <p role="alert">
            Choose distinct opening days within the cycle. Review excluded selections before saving.
          </p>
        )}
        <label>
          Restock every in-game days (0 disables)
          <input
            type="number"
            min="0"
            max="3650"
            required
            value={draft.interval}
            onChange={(e) => setDraft({ ...draft, interval: Number(e.target.value) })}
          />
        </label>
        <label>
          Restock each finite item to at least
          <input
            type="number"
            min="1"
            max="100000"
            required
            value={draft.quantity}
            onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })}
          />
        </label>
        <p>
          Cycle position Day {(day % draft.cycle) + 1}.{" "}
          {nextOpen === undefined
            ? "No opening day selected."
            : `Next open at campaign day ${nextOpen}, conditional on approved in-game time.`}{" "}
          {nextRestock === undefined
            ? "Stored automatic restock is disabled."
            : `Stored next top-up eligible at campaign day ${nextRestock}.`}
        </p>
        <details>
          <summary>Scheduled top-up preview</summary>
          {stock
            .filter((s) => s.shopId === shop.id)
            .map((s) => (
              <p key={s.id}>
                {s.name}:{" "}
                {s.quantity === null
                  ? "Unlimited; unchanged"
                  : `${s.quantity} → ${Math.max(s.quantity, draft.quantity)} on an eligible top-up`}
              </p>
            ))}
        </details>
        <p>
          Saving starts a new restocking interval today. Scheduled restock tops up to a target;
          Market Restock adds units. Manual Open/Close disables this schedule.
        </p>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={disabled || changed || !valid}>
          Save {shop.name} schedule
        </Button>
        {shop.schedule && (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={async () => {
              if (
                dirty &&
                !window.confirm("Discard your unsaved schedule and disable the stored schedule?")
              )
                return;
              try {
                await save({ kind: "shop-schedule", shopId: shop.id, schedule: null });
                setBefore(draft);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not disable schedule.");
              }
            }}
          >
            Disable {shop.name} schedule
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={reload}>
          Reload {shop.name} schedule
        </Button>
      </form>
    </details>
  );
}
export function PropertyFinancialPlan({ holding }: { holding: Holding }) {
  const { journal, purses, commandOutcome } = useEconomy(),
    finance = readFinance(journal.finance);
  const existing = finance.rules.filter((r) => r.holdingId === holding.id),
    revenue = existing.find((r) => r.kind === "income"),
    upkeepRule = existing.find((r) => r.kind === "expense"),
    paused = existing.length > 0 && !existing.some((r) => r.active);
  const initial = {
    income: revenue && (revenue.active || paused) ? revenue.copper : 0,
    upkeep: upkeepRule && (upkeepRule.active || paused) ? upkeepRule.copper : 0,
    period: revenue?.periodDays || upkeepRule?.periodDays || 7,
    active: existing.some((r) => r.active) || !existing.length,
  };
  const initialJson = JSON.stringify(initial);
  const [draft, setDraft] = useState(initial),
    [before, setBefore] = useState(draft),
    [source, setSource] = useState(JSON.stringify(existing)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(before),
    changed = source !== JSON.stringify(existing),
    locked = busy || finance.downtime.some((d) => d.status === "pending");
  useDraftGuard(dirty, "property financial plan");
  const latest = JSON.stringify(existing);
  useEffect(() => {
    if (!dirty && !busy) {
      const next = JSON.parse(initialJson) as typeof initial;
      setDraft(next);
      setBefore(next);
      setSource(latest);
    }
  }, [initialJson, latest, dirty, busy]);
  return (
    <details className="journal-entry">
      <summary>
        {holding.name} · {existing.some((r) => r.propertyManaged) ? "Managed" : "Unmanaged"}
      </summary>
      <p>
        Owner: {purses.find((p) => p.id === holding.purseId)?.name || "Missing account"}. Saving
        updates existing linked revenue/upkeep rather than adding another set.
      </p>
      <p>
        Planned net per period: {formatCopper(draft.income - draft.upkeep)}. Upkeep owed:{" "}
        {formatCopper(upkeepRule?.arrears || 0)}. Pausing preserves unpaid upkeep and partial
        periods.
      </p>
      <AppLink href={`/features/financial#property-${encodeURIComponent(holding.id)}`}>
        Review all linked recurring rules
      </AppLink>
      {existing.some((r) => r.purseId !== holding.purseId) && (
        <p role="alert">
          This property has a former owner’s agreements. Settle/review those rules before
          transferring its plan; obligations are not forgiven or reassigned.
        </p>
      )}
      {changed && (
        <p role="status">
          The financial plan changed. Your unsaved values are retained; reload before saving.
        </p>
      )}
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (locked || changed) return;
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const result = await commandOutcome({
              kind: "property-plan",
              holdingId: holding.id,
              income: draft.income,
              upkeep: draft.upkeep,
              periodDays: draft.period,
              active: draft.active,
            });
            setBefore(draft);
            setNotice(mutationNotice(result, "Property plan saved."));
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Property plan failed. Your draft is retained.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <CoinAmountInput
          label="Property revenue (cp)"
          value={draft.income}
          onChange={(raw) => setDraft({ ...draft, income: raw === "" ? NaN : Number(raw) })}
        />
        <CoinAmountInput
          label="Property upkeep (cp)"
          value={draft.upkeep}
          onChange={(raw) => setDraft({ ...draft, upkeep: raw === "" ? NaN : Number(raw) })}
        />
        <label className="grid gap-2 text-sm">
          Property period in days
          <TextInput
            type="number"
            min="1"
            max="3650"
            required
            value={draft.period}
            onChange={(e) => setDraft({ ...draft, period: Number(e.target.value) })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
          Active property plan
        </label>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <Button type="submit" disabled={locked || changed}>
          Save {holding.name} plan
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (dirty && !window.confirm("Discard unsaved property plan changes and reload?"))
              return;
            const next = initial;
            setDraft(next);
            setBefore(next);
            setSource(latest);
            setError("");
          }}
        >
          Reload {holding.name} plan
        </Button>
      </form>
    </details>
  );
}
