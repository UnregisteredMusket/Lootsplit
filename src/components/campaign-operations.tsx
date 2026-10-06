import { useState } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { readFinance } from "@/lib/quire/finance";
import { formatCopper } from "@/lib/quire/money";
import type { CommandInput } from "@/lib/quire/commands";
import type { Shop, Holding } from "@/lib/quire/types";
import { useDisclosureAnchor } from "@/lib/help/use-disclosure-anchor";

export function CampaignOperations() {
  const { shops, holdings, journal, command } = useEconomy();
  const seat = useSeat();
  const ref = useDisclosureAnchor("campaign-operations");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const finance = readFinance(journal.finance);
  if (seat.role !== "dm") return null;
  const locked = busy || finance.downtime.some((d) => d.status === "pending");
  async function save(input: CommandInput) {
    setBusy(true); setError("");
    try { await command(input); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to save campaign operations."); }
    finally { setBusy(false); }
  }
  return <details ref={ref} id="campaign-operations" className="review-inbox">
    <summary>Shop schedules & property management</summary>
    <p>Campaign day {finance.day}. Time advances only when the DM approves downtime. Opening days repeat from day 0. Restocking tops up finite stock without reducing surplus or changing unlimited stock.</p>
    {locked && !busy && <p>Cancel or settle the pending downtime before changing these plans.</p>}
    {error && <p role="alert">{error}</p>}
    <h3>Shop schedules</h3>
    {shops.map((s) => <ShopPlan key={`${s.id}:${JSON.stringify(s.schedule)}`} shop={s} day={finance.day} disabled={locked} save={save} />)}
    {!shops.length && <p>Create a shop in Shops & markets first.</p>}
    <h3>Properties</h3>
    <p>Add a property in Funds & inventory, then set its revenue and upkeep here. Amounts below are for the entire holding, per period. Income, loan payments and upkeep use the same purses and approved downtime ledger. Unpaid upkeep remains owed.</p>
    {holdings.filter((h) => h.kind === "property" && h.quantity > 0).map((h) => <PropertyPlan key={`${h.id}:${JSON.stringify(finance.rules.filter((r) => r.holdingId === h.id))}`} holding={h} rules={finance.rules} disabled={locked} save={save} />)}
    {!holdings.some((h) => h.kind === "property" && h.quantity > 0) && <p>No owned properties yet.</p>}
  </details>;
}
function ShopPlan({ shop, day, disabled, save }: { shop: Shop; day: number; disabled: boolean; save: (c: CommandInput) => Promise<void> }) {
  const [cycle, setCycle] = useState(shop.schedule?.cycleDays || 7);
  const [days, setDays] = useState(shop.schedule?.openDays.join(",") ?? "0,1,2,3,4");
  const [interval, setInterval] = useState(shop.schedule?.restockEveryDays || 0);
  const [quantity, setQuantity] = useState(shop.schedule?.restockQuantity || 5);
  return <details className="journal-entry"><summary>{shop.name} · {shop.schedule ? "Scheduled" : "Manual"} · {shop.closed ? "Closed" : "Open"}</summary>
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save({ kind: "shop-schedule", shopId: shop.id, schedule: { cycleDays: cycle, openDays: days.trim() ? days.split(",").map((d) => Number(d.trim())) : [], restockEveryDays: interval, restockQuantity: quantity, lastRestockDay: day } }); }}>
      <label>Cycle length in days<input type="number" min="1" max="30" required value={cycle} onChange={(e) => setCycle(Number(e.target.value))} /></label>
      <label>Open days in cycle (0-based, comma separated)<input value={days} onChange={(e) => setDays(e.target.value)} placeholder="0,1,2,3,4" /></label>
      <label>Restock every in-game days (0 disables)<input type="number" min="0" max="3650" required value={interval} onChange={(e) => setInterval(Number(e.target.value))} /></label>
      <label>Restock each finite item to at least<input type="number" min="1" max="100000" required value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label>
      <p>Saving starts a new restocking interval today. Manual Open/Close in Shops disables this schedule.</p>
      <button disabled={disabled}>Save {shop.name} schedule</button>
      {shop.schedule && <button type="button" disabled={disabled} onClick={() => void save({ kind: "shop-schedule", shopId: shop.id, schedule: null })}>Disable {shop.name} schedule</button>}
    </form>
  </details>;
}
function PropertyPlan({ holding, rules, disabled, save }: { holding: Holding; rules: ReturnType<typeof readFinance>["rules"]; disabled: boolean; save: (c: CommandInput) => Promise<void> }) {
  const existing = rules.filter((r) => r.holdingId === holding.id);
  const revenue = existing.find((r) => r.kind === "income"), upkeepRule = existing.find((r) => r.kind === "expense");
  const paused = existing.length > 0 && !existing.some((r) => r.active);
  const [income, setIncome] = useState(revenue && (revenue.active || paused) ? revenue.copper : 0);
  const [upkeep, setUpkeep] = useState(upkeepRule && (upkeepRule.active || paused) ? upkeepRule.copper : 0);
  const [period, setPeriod] = useState(revenue?.periodDays || upkeepRule?.periodDays || 7);
  const [active, setActive] = useState(existing.some((r) => r.active) || !existing.length);
  return <details className="journal-entry"><summary>{holding.name} · {existing.some((r) => r.propertyManaged) ? "Managed" : "Unmanaged"}</summary>
    <p>Saving updates this property’s existing linked revenue/upkeep schedules rather than adding another set. Multiple schedules of one type must be reviewed in Recurring revenue & expenses first.</p>
    <p>Planned net per period: {formatCopper(income - upkeep)}. Upkeep owed: {formatCopper(upkeepRule?.arrears || 0)}. Pausing preserves unpaid upkeep and partial periods.</p>
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save({ kind: "property-plan", holdingId: holding.id, income, upkeep, periodDays: period, active }); }}>
      <label>Property revenue (cp)<input type="number" min="0" max="1000000000000" required value={income} onChange={(e) => setIncome(Number(e.target.value))} /></label>
      <label>Property upkeep (cp)<input type="number" min="0" max="1000000000000" required value={upkeep} onChange={(e) => setUpkeep(Number(e.target.value))} /></label>
      <label>Property period in days<input type="number" min="1" max="3650" required value={period} onChange={(e) => setPeriod(Number(e.target.value))} /></label>
      <label><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active property plan</label>
      <button disabled={disabled}>Save {holding.name} plan</button>
    </form>
  </details>;
}
