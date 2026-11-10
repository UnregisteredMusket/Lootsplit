/**
 * Settlement tiers, phases S1 and S2 (settlements.ts; owner design and decisions 2026-11-10), in
 * Market → Manage regions, cities, towns and areas: the campaign's ladder and tier names, its limits
 * (per-item sale cap, rarity cap on generated stock, per-tier values), and one city's or town's
 * profile (tier, population, the defaults a new shop there starts with, and its own limits). Every
 * change is one DM-only `settlement-*` command; nothing here changes an existing shop.
 */
import { useState } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import type { CommandInput } from "@/lib/quire/commands";
import { RARITIES, WEALTHS } from "@/lib/quire/labels";
import { formatCopper } from "@/lib/quire/money";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import type { MarketLocation } from "@/lib/quire/shop-locations";
import {
  ladderSettings,
  limitSettings,
  readSettlements,
  settlementAt,
  settlementLabel,
  settlementTiers,
  tierMaxRarity,
  tierSaleLimit,
} from "@/lib/quire/settlements";
import {
  MAX_POPULATION_TEXT,
  MAX_TIER_NAME,
  SETTLEMENT_LADDERS,
  settlementLadderIds,
  type SaleCapMode,
  type SettlementLadderId,
  type SettlementLimitSettings,
  type SettlementProfile,
  type Settlements,
} from "@/lib/quire/settlements-schema";
import type { ItemRarity, Wealth } from "@/lib/quire/types";
import { Button, Select, TextInput } from "./ui";
import { Status, useFactionCommand } from "./faction-command";

function useSettlements(): Settlements {
  const { journal } = useEconomy();
  try {
    return readSettlements((journal as { settlements?: unknown }).settlements);
  } catch {
    return { places: {} };
  }
}

/** The tier name (and population) of a place for anyone who can see the place; nothing without one. */
export function SettlementTierText({ locationId, className }: { locationId: string; className?: string }) {
  const { journal } = useEconomy();
  const here = settlementAt(journal, locationId);
  if (!here) return null;
  return (
    <p className={className ?? "text-sm text-muted"} data-testid="settlement-tier">
      {here.inherited ? `${here.location.name}: ` : ""}
      {settlementLabel(here)}
    </p>
  );
}

/** DM: the campaign's ladder (eight Pathfinder sizes or five steps) and its tier names. */
export function SettlementLadderForm() {
  const settlements = useSettlements();
  const before = ladderSettings(settlements);
  const [ladder, setLadder] = useState<SettlementLadderId>(before.ladder);
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(settlementTiers(settlements).map((t) => [t.id, t.name])),
  );
  const tiers = SETTLEMENT_LADDERS[ladder].tiers;
  const after = {
    ladder,
    names: Object.fromEntries(
      tiers.flatMap((t) => {
        const name = (names[t.id] ?? t.name).trim();
        return name && name !== t.name ? [[t.id, name]] : [];
      }),
    ),
  };
  const dirty = JSON.stringify(after) !== JSON.stringify({ ladder: before.ladder, names: before.names });
  useDraftGuard(dirty, "settlement ladder");
  const command = useFactionCommand(`settlement-ladder|${JSON.stringify(before)}|${JSON.stringify(after)}`);
  return (
    <form
      aria-label="Settlement sizes"
      data-testid="settlement-ladder-form"
      className="space-y-3 rounded-sm border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void command.send({ kind: "settlement-ladder", before, after } as CommandInput, "Settlement ladder saved.");
      }}
    >
      <p className="text-sm font-medium">Settlement sizes</p>
      <p className="text-sm text-muted">
        Give cities and towns a size. A size sets the wealth new shops there start with; shops already open keep their own.
      </p>
      <label className="block text-sm">
        Ladder
        <Select
          aria-label="Settlement ladder"
          value={ladder}
          disabled={command.busy}
          onChange={(event) => {
            const next = event.target.value as SettlementLadderId;
            setLadder(next);
            setNames(Object.fromEntries(SETTLEMENT_LADDERS[next].tiers.map((t) => [t.id, before.ladder === next ? (before.names[t.id] ?? t.name) : t.name])));
          }}
        >
          {settlementLadderIds.map((id) => (
            <option key={id} value={id}>
              {SETTLEMENT_LADDERS[id].name}
            </option>
          ))}
        </Select>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {tiers.map((t) => (
          <label key={t.id} className="block text-sm">
            <span className="text-muted">
              {t.name} · new shops {WEALTHS.find((w) => w.value === t.wealth)?.label}
            </span>
            <TextInput
              aria-label={`Name for ${t.name}`}
              value={names[t.id] ?? t.name}
              maxLength={MAX_TIER_NAME}
              disabled={command.busy}
              onChange={(event) => setNames({ ...names, [t.id]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <Status error={command.error} notice={command.notice} />
      <Button type="submit" disabled={command.busy || !dirty}>
        {command.busy ? "Saving…" : "Save sizes"}
      </Button>
    </form>
  );
}

const gp = (copper: number | undefined) => (copper === undefined ? "" : String(copper / 100));
/** Whole gold pieces typed by the DM → whole copper; "" is unset; anything else is refused. */
function copperFromGp(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 1e10 || !Number.isInteger(value * 100)) return null;
  return Math.round(value * 100);
}

/** DM: one city's or town's size, population and new-shop defaults. */
export function SettlementProfileEditor({ location }: { location: MarketLocation }) {
  const settlements = useSettlements();
  const before = settlements.places[location.id] ?? null;
  const tiers = settlementTiers(settlements);
  const [tier, setTier] = useState(before?.tier ?? "");
  const [population, setPopulation] = useState(before?.population ?? "");
  const [wealth, setWealth] = useState<Wealth | "">(before?.wealth ?? "");
  const [purse, setPurse] = useState(gp(before?.purse));
  const [refill, setRefill] = useState(gp(before?.refill));
  // S2: this place's own sale limit and rarest generated stock (blank: its size's).
  const [saleLimit, setSaleLimit] = useState(gp(before?.saleLimit));
  const [maxRarity, setMaxRarity] = useState<ItemRarity | "">(before?.maxRarity ?? "");
  const [problem, setProblem] = useState("");
  const chosen = tiers.find((t) => t.id === tier);
  const tierWealth = chosen?.wealth;
  const limits = limitSettings(settlements);
  const draft = { tier, population: population.trim(), wealth, purse: purse.trim(), refill: refill.trim(), saleLimit: saleLimit.trim(), maxRarity };
  const saved = { tier: before?.tier ?? "", population: before?.population ?? "", wealth: before?.wealth ?? "", purse: gp(before?.purse), refill: gp(before?.refill), saleLimit: gp(before?.saleLimit), maxRarity: before?.maxRarity ?? "" };
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useDraftGuard(dirty, "settlement size");
  const command = useFactionCommand(`settlement-profile|${location.id}|${JSON.stringify(before)}|${JSON.stringify(draft)}`);
  function profile(): SettlementProfile | null | string {
    if (!tier) return null;
    const purseCopper = copperFromGp(purse);
    const refillCopper = copperFromGp(refill);
    const limitCopper = copperFromGp(saleLimit);
    if (purseCopper === null || refillCopper === null) return "Enter the purse and refill in gold pieces, for example 100 or 2.5.";
    if (refillCopper !== undefined && purseCopper === undefined) return "Set a merchant purse before its refill.";
    if (limitCopper === null || limitCopper === 0) return "Enter the most paid for one item in gold pieces, at least 1 cp (0.01), or leave it blank.";
    return {
      tier,
      ...(population.trim() ? { population: population.trim() } : {}),
      ...(wealth ? { wealth } : {}),
      ...(purseCopper !== undefined ? { purse: purseCopper } : {}),
      ...(refillCopper !== undefined ? { refill: refillCopper } : {}),
      ...(limitCopper !== undefined ? { saleLimit: limitCopper } : {}),
      ...(maxRarity ? { maxRarity } : {}),
    };
  }
  const prefix = `settlement-${location.id}`;
  return (
    <form
      aria-label={`Size of ${location.name}`}
      data-testid="settlement-profile-form"
      className="space-y-3 rounded-sm border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const next = profile();
        if (typeof next === "string") {
          setProblem(next);
          return;
        }
        setProblem("");
        void command.send(
          { kind: "settlement-profile", locationId: location.id, before, profile: next } as CommandInput,
          next ? "Settlement size saved." : "Settlement size cleared.",
        );
      }}
    >
      <p className="text-sm font-medium">Size of {location.name}</p>
      <p className="text-sm text-muted">
        Its areas share it. Players who can see this {location.kind} see its size and population; the new-shop defaults are yours.
      </p>
      <label className="block text-sm" htmlFor={`${prefix}-tier`}>
        Size
      </label>
      <Select id={`${prefix}-tier`} aria-label="Settlement size" value={tier} disabled={command.busy} onChange={(e) => setTier(e.target.value)}>
        <option value="">No size set</option>
        {tiers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      {tier ? (
        <>
          <label className="block text-sm">
            Population (optional, players see it)
            <TextInput
              aria-label="Population"
              placeholder="about 2,000"
              value={population}
              maxLength={MAX_POPULATION_TEXT}
              disabled={command.busy}
              onChange={(e) => setPopulation(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            New shops' wealth
            <Select aria-label="New shops' wealth" value={wealth} disabled={command.busy} onChange={(e) => setWealth(e.target.value as Wealth | "")}>
              <option value="">From the size ({WEALTHS.find((w) => w.value === tierWealth)?.label ?? "Modest"})</option>
              {WEALTHS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </Select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              New shops' merchant purse, gp (blank: unlimited)
              <TextInput aria-label="New shops' merchant purse in gp" inputMode="decimal" value={purse} disabled={command.busy} onChange={(e) => setPurse(e.target.value)} />
            </label>
            <label className="block text-sm">
              Refill on restock, gp (optional)
              <TextInput aria-label="New shops' purse refill in gp" inputMode="decimal" value={refill} disabled={command.busy} onChange={(e) => setRefill(e.target.value)} />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              Most a shop here pays for one item, gp (blank: {chosen ? `${formatCopper(tierSaleLimit(settlements, chosen))} from the size` : "the size's"}
              {limits.sale === "off" ? "; the sale cap is off" : ""})
              <TextInput aria-label="Most paid for one item here in gp" inputMode="decimal" value={saleLimit} disabled={command.busy} onChange={(e) => setSaleLimit(e.target.value)} />
            </label>
            <label className="block text-sm">
              Rarest generated stock{limits.rarity ? "" : " (the rarity cap is off)"}
              <Select aria-label="Rarest generated stock here" value={maxRarity} disabled={command.busy} onChange={(e) => setMaxRarity(e.target.value as ItemRarity | "")}>
                <option value="">From the size ({RARITIES.find((r) => r.value === (chosen ? tierMaxRarity(settlements, chosen) : undefined))?.label ?? "size"})</option>
                {RARITIES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </>
      ) : null}
      {problem ? <p role="alert">{problem}</p> : null}
      <Status error={command.error} notice={command.notice} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={command.busy || !dirty}>
          {command.busy ? "Saving…" : tier ? "Save size" : "Clear size"}
        </Button>
      </div>
      {before?.purse !== undefined ? (
        <p className="text-sm text-faint">
          New shops here start with a {formatCopper(before.purse)} purse
          {before.refill !== undefined ? `, refilled to ${formatCopper(before.refill)}` : ""}.
        </p>
      ) : null}
    </form>
  );
}

const SALE_CAP_LABELS: Record<SaleCapMode, string> = {
  off: "Off: shops pay whatever an item is worth",
  refuse: "Refuse: a shop won't buy an item above the limit",
  "pay-limit": "Pay the limit: a shop pays the limit for that item",
};

/**
 * DM (S2): the campaign's settlement limits. The per-item sale cap is off until turned on (refuse
 * by default); the rarity cap on generated stock is on. Per-tier values show the ladder's
 * defaults; only changed values are stored.
 */
export function SettlementLimitsForm() {
  const settlements = useSettlements();
  // A new ladder has other tiers: the form starts again from what is stored.
  return <LimitsForm key={ladderSettings(settlements).ladder} />;
}
function LimitsForm() {
  const settlements = useSettlements();
  const before = limitSettings(settlements);
  const tiers = settlementTiers(settlements);
  const [sale, setSale] = useState<SaleCapMode>(before.sale);
  const [rarity, setRarity] = useState(before.rarity);
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(tiers.map((t) => [t.id, gp(tierSaleLimit(settlements, t))])),
  );
  const [rarest, setRarest] = useState<Record<string, ItemRarity>>(() =>
    Object.fromEntries(tiers.map((t) => [t.id, tierMaxRarity(settlements, t)])),
  );
  const [problem, setProblem] = useState("");
  function after(): SettlementLimitSettings | string {
    const saleLimits: Record<string, number> = {};
    for (const t of tiers) {
      const copper = copperFromGp(limits[t.id] ?? "");
      if (copper === undefined) continue;
      if (copper === null || copper === 0) return `Enter ${t.name}'s limit in gold pieces, at least 1 cp (0.01).`;
      if (copper !== t.saleLimit) saleLimits[t.id] = copper;
    }
    const maxRarity = Object.fromEntries(tiers.flatMap((t) => (rarest[t.id] && rarest[t.id] !== t.maxRarity ? [[t.id, rarest[t.id]!]] : [])));
    return { sale, saleLimits, rarity, maxRarity };
  }
  const next = after();
  const dirty = typeof next === "string" || JSON.stringify(next) !== JSON.stringify(before);
  useDraftGuard(dirty, "settlement limits");
  const command = useFactionCommand(`settlement-limits|${JSON.stringify(before)}|${JSON.stringify(next)}`);
  return (
    <form
      aria-label="Settlement limits"
      data-testid="settlement-limits-form"
      className="space-y-3 rounded-sm border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (typeof next === "string") {
          setProblem(next);
          return;
        }
        setProblem("");
        void command.send({ kind: "settlement-limits", before, after: next } as CommandInput, "Settlement limits saved.");
      }}
    >
      <p className="text-sm font-medium">What a town's shops will buy and stock</p>
      <p className="text-sm text-muted">
        Shops in a place with a size can cap what they pay for one item, and new shops&apos; generated stock can stop at a rarity.
        Stock you add by hand is never limited; shops already open keep their stock.
      </p>
      <label className="block text-sm">
        Per-item sale cap
        <Select aria-label="Per-item sale cap" value={sale} disabled={command.busy} onChange={(e) => setSale(e.target.value as SaleCapMode)}>
          {(Object.keys(SALE_CAP_LABELS) as SaleCapMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {SALE_CAP_LABELS[mode]}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-6 accent-accent"
          aria-label="Cap generated stock by rarity"
          checked={rarity}
          disabled={command.busy}
          onChange={(e) => setRarity(e.target.checked)}
        />
        Cap new shops&apos; generated stock by the place&apos;s size
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {tiers.map((t) => (
          <fieldset key={t.id} className="rounded-sm border border-border p-2 text-sm">
            <legend className="px-1 text-muted">{t.name}</legend>
            <label className="block">
              Most paid for one item, gp
              <TextInput
                aria-label={`Most paid for one item in a ${t.name}, gp`}
                inputMode="decimal"
                placeholder={gp(t.saleLimit)}
                value={limits[t.id] ?? ""}
                disabled={command.busy}
                onChange={(e) => setLimits({ ...limits, [t.id]: e.target.value })}
              />
            </label>
            <label className="mt-1 block">
              Rarest generated stock
              <Select
                aria-label={`Rarest generated stock in a ${t.name}`}
                value={rarest[t.id] ?? t.maxRarity}
                disabled={command.busy}
                onChange={(e) => setRarest({ ...rarest, [t.id]: e.target.value as ItemRarity })}
              >
                {RARITIES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </label>
          </fieldset>
        ))}
      </div>
      <p className="text-sm text-faint">
        Suggested limits are Pathfinder&apos;s base values. Players selling to a capped shop see its limit in Why this payout?; places
        without a size, and campaignwide shops, have no cap.
      </p>
      {problem ? <p role="alert">{problem}</p> : null}
      <Status error={command.error} notice={command.notice} />
      <Button type="submit" disabled={command.busy || !dirty}>
        {command.busy ? "Saving…" : "Save limits"}
      </Button>
    </form>
  );
}
