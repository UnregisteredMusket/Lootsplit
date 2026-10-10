import {
  useState,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import {
  readTradeEconomy,
  commoditySchema,
  exchangeSchema,
  type Commodity,
  type Exchange,
  type TradeEconomy,
  type TradeOffer,
  type TradeReceipt,
} from "@/lib/quire/trade-economy-schema";
import { exchangeHere, exchangeQuoteKey, tradeSeasonFingerprint } from "@/lib/quire/trade-economy";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { readEstate } from "@/lib/quire/estate-schema";
import { canAccessEstate, physicallyHere } from "@/lib/quire/estate";
import { readMarketLocations, locationLabel } from "@/lib/quire/shop-locations";
import { SEASON_NAMES, clampRealm } from "@/lib/quire/scale";
import { formatCopper, toCopper } from "@/lib/quire/money";
import { CommandForm, CommandButton } from "./world-tools";
import { CoinAmountInput } from "./finance-input";
import { AppLink } from "./app-link";
import { TradeSeasonReview } from "./trade-season-review";
import { tradeReversalGuidance } from "@/lib/quire/ledger-reversal";
import { Button, Modal } from "./ui";

function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <label className="grid gap-2" htmlFor={id}>
      <span>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string; "aria-label"?: string }>, {
            id,
            "aria-label": label,
          })
        : children}
    </label>
  );
}
const NumberField = ({
  label,
  value,
  set,
  min = 0,
  max = 1e9,
  step = 1,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) => (
  <Field label={label}>
    <input
      className="ledger-search"
      required
      type="number"
      min={min}
      max={max}
      step={step}
      value={Number.isNaN(value) ? "" : value}
      onChange={(e) => set(Number(e.target.value))}
    />
  </Field>
);
const Tick = ({
  label,
  value,
  set,
}: {
  label: string;
  value: boolean;
  set: (n: boolean) => void;
}) => (
  <label className="flex min-h-11 items-center gap-2">
    <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
    {label}
  </label>
);
const initialCommodity = (): Commodity => ({
  id: "",
  name: "",
  unit: "bundle",
  category: "general",
  baseCopper: 100,
  weight: 1,
  active: true,
  description: "",
});
const initialOffer = (commodityId: string): TradeOffer => ({
  commodityId,
  stock: 20,
  targetStock: 20,
  capacity: 100,
  supply: 100,
  demand: 100,
  askCopper: 100,
  bidCopper: 60,
  lockPrice: false,
  lockStock: false,
  lockIndices: false,
});

export function TradeEconomyPanel() {
  const table = useWorldTable(),
    seat = useSeat(),
    dm = seat.role === "dm";
  const economy = readTradeEconomy(table.journal.tradeEconomy),
    realm = clampRealm(table.realm);
  const [commodityId, setCommodityId] = useState(""),
    [exchangeId, setExchangeId] = useState("");
  const visible = economy.exchanges.filter((e) => dm || (e.visible && exchangeHere(table, e)));
  return (
    <div className="trade-economy-panel">
      <p className="text-muted">
        {SEASON_NAMES[realm.season]} · season {economy.epoch} ·{" "}
        {economy.settings.mode === "classic" ? "Classic Mode" : "Automatic Mode"} ·{" "}
        {economy.settings.enabled ? "Trading enabled" : "Trading disabled"}
      </p>
      <p>
        This campaign has its own economy. Prices stay fixed during a season. Purchases and sales
        feed the next season when the DM approves end-of-session downtime, or an explicit manual
        settlement.
      </p>
      <div className="world-toolbar">
        <AppLink href="/features/properties">Property stores & managers →</AppLink>
        {dm && <AppLink href="/features/downtime">Review end-of-session downtime →</AppLink>}
      </div>
      {dm && (
        <>
          <details className="journal-entry">
            <summary>Economy rules · Classic or Automatic</summary>
            <PolicyEditor economy={economy} />
          </details>
          <details className="journal-entry">
            <summary>Commodity catalogue · stable goods and units</summary>
            <Field label="Edit commodity">
              <select
                className="ledger-search"
                value={commodityId}
                onChange={(e) => setCommodityId(e.target.value)}
              >
                <option value="">New commodity</option>
                {economy.commodities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.unit}
                  </option>
                ))}
              </select>
            </Field>
            <CommodityEditor
              key={commodityId}
              economy={economy}
              current={economy.commodities.find((c) => c.id === commodityId)}
              onSaved={setCommodityId}
            />
          </details>
          <details className="journal-entry">
            <summary>Exchange workshop · stock, quotes and treasury</summary>
            <Field label="Edit exchange">
              <select
                className="ledger-search"
                value={exchangeId}
                onChange={(e) => setExchangeId(e.target.value)}
              >
                <option value="">New exchange</option>
                {economy.exchanges.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>
            <ExchangeEditor
              key={exchangeId}
              economy={economy}
              current={economy.exchanges.find((e) => e.id === exchangeId)}
              onSaved={setExchangeId}
            />
          </details>
          <details className="journal-entry">
            <summary>Link existing inventory & shop activity</summary>
            <GoodsLinks economy={economy} />
          </details>
          <details className="journal-entry" open={economy.pendingSeason ? true : undefined}>
            <summary>Manual season control & DM overrides</summary>
            <ManualSeason key={economy.pendingSeason?.id ?? "empty"} economy={economy} />
          </details>
        </>
      )}
      <h2>Regional exchanges</h2>
      {!visible.length && (
        <p>
          {dm
            ? "Create a commodity and an exchange to begin."
            : "No exchanges are available at the current party location."}
        </p>
      )}
      {visible.map((e) => (
        <section key={e.id} className="journal-entry" aria-label={e.name}>
          <h3>{e.name}</h3>
          <p>
            {locationLabel(readMarketLocations(table.journal.market), e.locationId ?? undefined)} ·{" "}
            {e.open ? "Open" : "Closed"}
          </p>
          {dm ? (
            <p>
              {table.purses.find((p) => p.id === e.purseId)
                ? `Treasury ${formatCopper(toCopper(table.purses.find((p) => p.id === e.purseId)!.coins))}`
                : "Treasury account unavailable"}
            </p>
          ) : (
            <p className="text-sm text-muted">
              Exchange balance is private. Purchases and sales check available funds when submitted.
            </p>
          )}
          {e.notes && <p>{e.notes}</p>}
          <div className="trade-offer-grid">
            {e.offers.map((o) => {
              const c = economy.commodities.find((c) => c.id === o.commodityId);
              return (
                c && (
                  <article key={c.id} className="trade-offer journal-entry">
                    <h4>{c.name}</h4>
                    <p>{c.description}</p>
                    <p>
                      Per {c.unit} · Ask {formatCopper(o.askCopper)} · Bid{" "}
                      {formatCopper(o.bidCopper)}
                    </p>
                    <p>
                      {o.stock} available · {o.capacity - o.stock} units wanted · Supply {o.supply}{" "}
                      · Demand {o.demand}
                    </p>
                    {economy.settings.enabled && e.open && c.active && (
                      <TradeForm
                        key={exchangeQuoteKey(economy, e, c)}
                        economy={economy}
                        exchange={e}
                        commodity={c}
                      />
                    )}
                  </article>
                )
              );
            })}
          </div>
        </section>
      ))}
      <TradeReceipts economy={economy} dm={dm} />
      {dm && <SeasonHistory history={economy.history} />}
    </div>
  );
}

function HistoryPages({
  page,
  count,
  pageSize,
  onChange,
  label,
}: {
  page: number;
  count: number;
  pageSize: number;
  onChange: (page: number) => void;
  label: string;
}) {
  if (count <= pageSize) return null;
  const last = Math.ceil(count / pageSize) - 1;
  return (
    <nav aria-label={label} className="trade-history-pages">
      <p className="text-sm text-muted" role="status">
        {page * pageSize + 1}–{Math.min((page + 1) * pageSize, count)} of {count} · Page {page + 1}{" "}
        of {last + 1}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={page === 0} onClick={() => onChange(0)}>
          First
        </Button>
        <Button variant="secondary" disabled={page === 0} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page === last} onClick={() => onChange(page + 1)}>
          Next
        </Button>
        <Button variant="secondary" disabled={page === last} onClick={() => onChange(last)}>
          Last
        </Button>
      </div>
    </nav>
  );
}

function TradeReceipts({ economy, dm }: { economy: TradeEconomy; dm: boolean }) {
  const table = useWorldTable();
  const [page, setPage] = useState(0);
  const [review, setReview] = useState<TradeReceipt | null>(null);
  const pageSize = 50;
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(economy.receipts.length / pageSize) - 1),
  );
  const end = economy.receipts.length - currentPage * pageSize;
  const rows = economy.receipts.slice(Math.max(0, end - pageSize), end).reverse();
  const reversals = new Map(
    economy.receipts.filter((r) => r.reversalOf).map((r) => [r.reversalOf!, r]),
  );
  return (
    <details className="journal-entry">
      <summary>Trade receipts · {economy.receipts.length}</summary>
      <p className="text-sm text-muted">
        Newest first. Every recorded trade and reversal is available across these pages.
      </p>
      {!rows.length && <p>No trade receipts have been recorded.</p>}
      <HistoryPages
        page={currentPage}
        count={economy.receipts.length}
        pageSize={pageSize}
        onChange={setPage}
        label="Trade receipt pages"
      />
      {rows.map((r) => {
        const reversed = reversals.get(r.id);
        const exchangeName = economy.exchanges.find((e) => e.id === r.exchangeId)?.name;
        const accountName = table.purses.find((p) => p.id === r.purseId)?.name;
        const propertyName =
          r.propertyId && table.holdings.find((h) => h.id === r.propertyId)?.name;
        return (
          <article
            key={r.id}
            id={`trade-receipt-${encodeURIComponent(r.id)}`}
            className="journal-entry"
            aria-label={`${r.reversalOf ? "Reversal" : "Trade"}: ${r.name} · season ${r.epoch}`}
          >
            <h3>
              {r.reversalOf
                ? `Reversal of ${r.direction === "sell" ? "purchase" : "sale"}`
                : r.direction === "buy"
                  ? "Bought"
                  : "Sold"}{" "}
              {r.quantity} {r.unit} of {r.name}
            </h3>
            <p>
              {formatCopper(r.copper)} · Season {r.epoch} · {new Date(r.at).toLocaleString()}
            </p>
            <p>
              Exchange:{" "}
              {exchangeName ??
                (dm
                  ? `Unavailable exchange (${r.exchangeId})`
                  : "Exchange unavailable in this view")}{" "}
              · Account: {accountName ?? "Account unavailable in this view"}
            </p>
            <p>
              Source:{" "}
              {r.origin === "exchange"
                ? "Exchange trade"
                : r.origin === "shop"
                  ? "Shop activity"
                  : "Manager activity"}
              {r.propertyId
                ? ` · Property storage: ${propertyName || "Property unavailable in this view"}`
                : ""}
            </p>
            {r.reversalOf && (
              <p className="text-muted">
                Correction in season {r.epoch}. Original receipt: {r.reversalOf}. {r.reversalReason}
              </p>
            )}
            {reversed && (
              <p className="text-muted">
                Reversal receipt recorded in season {reversed.epoch}. {reversed.reversalReason}
              </p>
            )}
            {dm && !r.reversalOf && !reversed && (
              <Button variant="secondary" onClick={() => setReview(structuredClone(r))}>
                Review reversal
              </Button>
            )}
          </article>
        );
      })}
      <HistoryPages
        page={currentPage}
        count={economy.receipts.length}
        pageSize={pageSize}
        onChange={setPage}
        label="Trade receipt pages at end"
      />
      {review && dm && (
        <TradeReversalReview
          original={review}
          reversal={reversals.get(review.id)}
          onClose={() => setReview(null)}
        />
      )}
    </details>
  );
}

function TradeReversalReview({
  original,
  reversal,
  onClose,
}: {
  original: TradeReceipt;
  reversal?: TradeReceipt;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const table = useWorldTable();
  const [operation] = useState(() => {
    const receipts = readTradeEconomy(table.journal.tradeEconomy).receipts;
    return original.operationId
      ? structuredClone(
          receipts.filter((r) => !r.reversalOf && r.operationId === original.operationId),
        )
      : [original];
  });
  const guidance = operation.map(tradeReversalGuidance).find(Boolean);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Review trade reversal"
    >
      <div className="trade-reversal-review">
        {operation.length > 1 && (
          <section aria-label="Manager operation receipts">
            <p>
              This manager operation includes {operation.length} receipts and is reversed as one
              action.
            </p>
            <ul>
              {operation.map((r) => (
                <li key={r.id}>
                  {r.direction === "buy" ? "Bought" : "Sold"} {r.quantity} {r.unit} of {r.name} ·{" "}
                  {formatCopper(r.copper)}
                </li>
              ))}
            </ul>
          </section>
        )}
        <p>
          {original.direction === "buy" ? "Purchase" : "Sale"}: {original.quantity} {original.unit}{" "}
          of {original.name} · {formatCopper(original.copper)}
        </p>
        <p>
          Account:{" "}
          {table.purses.find((p) => p.id === original.purseId)?.name ?? "Account unavailable"} ·
          Original season {original.epoch}
        </p>
        <p>
          Exchange:{" "}
          {table.journal.tradeEconomy?.exchanges.find((e) => e.id === original.exchangeId)?.name ??
            "Exchange unavailable"}
          {original.propertyId
            ? ` · Property storage: ${table.holdings.find((h) => h.id === original.propertyId)?.name ?? "Property unavailable"}`
            : ""}
        </p>
        <p>
          Reverse the recorded goods and related payments together. The campaign checks current
          funds, stock and custody before committing. A correction affects the current season;
          earlier settlements and rolls stay recorded.
        </p>
        {original.origin === "manager" && (
          <p className="text-sm text-muted">
            Review manager budget usage and order timing separately in Property Management. The
            campaign day stays as recorded.
          </p>
        )}
        {guidance && <p className="text-muted">{guidance}</p>}
        {reversal && (
          <p role="status">
            A reversal receipt is present for this trade. Check the room sync status for any pending
            submission.
          </p>
        )}
        <CommandForm
          label="Reverse trade"
          dirty={!!reason && !reversal}
          submitDisabled={!!guidance || !!reversal || !reason.trim()}
          submit={() => ({
            kind: "ledger-void",
            target: { kind: "trade", id: original.id },
            before: canonicalJson(original),
            reason,
          })}
        >
          <Field label="Reason for trade reversal">
            <textarea
              required
              maxLength={2000}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </CommandForm>
        <Button variant="secondary" onClick={onClose}>
          Close reversal review
        </Button>
      </div>
    </Modal>
  );
}

function SeasonHistory({ history }: { history: TradeEconomy["history"] }) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(history.length / pageSize) - 1));
  const end = history.length - currentPage * pageSize;
  const rows = history.slice(Math.max(0, end - pageSize), end).reverse();
  return (
    <details className="journal-entry">
      <summary>Seasonal history · {history.length}</summary>
      <p className="text-sm text-muted">
        Newest first. Open a record to compare its original baseline, proposal and applied result.
      </p>
      {!rows.length && <p>No seasonal settlements have been recorded.</p>}
      <HistoryPages
        page={currentPage}
        count={history.length}
        pageSize={pageSize}
        onChange={setPage}
        label="Seasonal history pages"
      />
      {rows.map((record) => (
        <SeasonHistoryRecord key={record.id} record={record} />
      ))}
      <HistoryPages
        page={currentPage}
        count={history.length}
        pageSize={pageSize}
        onChange={setPage}
        label="Seasonal history pages at end"
      />
    </details>
  );
}

function SeasonHistoryRecord({ record }: { record: TradeEconomy["history"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="journal-entry"
      id={`trade-season-${encodeURIComponent(record.id)}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {SEASON_NAMES[record.realm.season]} · season {record.quote.fromEpoch + 1} · day {record.day}{" "}
        · {record.source}
      </summary>
      {open && (
        <>
          <p>
            {new Date(record.at).toLocaleString()} · Approval reason: {record.reason}
          </p>
          <TradeSeasonReview
            quote={record.quote}
            applied={{ exchanges: record.appliedExchanges, realm: record.realm }}
          />
        </>
      )}
    </details>
  );
}

function PolicyEditor({ economy }: { economy: TradeEconomy }) {
  const [value, set] = useState(economy.settings),
    [baseline, setBaseline] = useState(economy.settings),
    [reason, setReason] = useState("DM economy configuration");
  const update = (patch: Partial<typeof value>) => set({ ...value, ...patch });
  return (
    <CommandForm
      label="Save economy rules"
      dirty={canonicalJson(value) !== canonicalJson(baseline)}
      onDone={() => setBaseline(value)}
      submit={() => ({ kind: "trade-settings", before: baseline, settings: value, reason })}
    >
      <Tick
        label="Enable campaign trade economy"
        value={value.enabled}
        set={(enabled) => update({ enabled })}
      />
      <Field label="Market mode">
        <select
          value={value.mode}
          onChange={(e) => update({ mode: e.target.value as typeof value.mode })}
        >
          <option value="classic">Classic Mode · full DM control</option>
          <option value="automatic">Automatic Mode · seasonal supply & demand</option>
        </select>
      </Field>
      <p>
        Classic retains the DM's stock, indices and prices. Automatic proposes seasonal values using
        the campaign's existing economic settings. Every proposal requires DM approval.
      </p>
      <div className="trade-offer-grid">
        {(
          [
            ["volatility", "Seasonal volatility (%)"],
            ["hardshipChance", "Hardship chance (%)"],
            ["feedback", "Transaction influence (%)"],
            ["bidRateBps", "Buyback share (basis points)"],
          ] as const
        ).map(([key, label]) => (
          <NumberField
            key={key}
            label={label}
            value={value[key]}
            max={key === "bidRateBps" ? 10000 : 100}
            set={(n) => update({ [key]: n })}
          />
        ))}
        <NumberField
          label="Minimum price multiplier"
          value={value.minMultiplier}
          min={0.05}
          max={10}
          step={0.05}
          set={(minMultiplier) => update({ minMultiplier })}
        />
        <NumberField
          label="Maximum price multiplier"
          value={value.maxMultiplier}
          min={0.05}
          max={10}
          step={0.05}
          set={(maxMultiplier) => update({ maxMultiplier })}
        />
      </div>
      <p>
        Price bounds apply relative to the existing realm-adjusted base price. Winter adds 10 chance
        points; each war/plague level adds 5. Values are editable campaign rules.
      </p>
      {(["shortage", "roads", "war", "plague"] as const).map((key) => (
        <Tick
          key={key}
          label={`Allow automatic ${key} hardship`}
          value={value.hardshipTypes.includes(key)}
          set={(checked) =>
            update({
              hardshipTypes: checked
                ? [...value.hardshipTypes, key]
                : value.hardshipTypes.filter((k) => k !== key),
            })
          }
        />
      ))}
      <Field label="Reason for economy change">
        <input
          required
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </CommandForm>
  );
}

function CommodityEditor({
  current,
  onSaved,
}: {
  economy: TradeEconomy;
  current?: Commodity;
  onSaved: (id: string) => void;
}) {
  const table = useWorldTable(),
    [value, set] = useState<Commodity>(current ?? initialCommodity()),
    [baseline, setBaseline] = useState<Commodity | null>(current ?? null),
    [reason, setReason] = useState("DM commodity definition");
  const patch = (x: Partial<Commodity>) => set({ ...value, ...x });
  return (
    <CommandForm
      label="Save commodity"
      dirty={canonicalJson(value) !== canonicalJson(baseline ?? initialCommodity())}
      onDone={() => {
        setBaseline(value);
        onSaved(value.id);
      }}
      submit={() => ({
        kind: "trade-commodity",
        before: baseline,
        commodity: commoditySchema.parse(value),
        reason,
      })}
    >
      <Field label="Commodity key">
        <input
          required
          pattern="[a-z0-9][a-z0-9._-]{0,79}"
          maxLength={80}
          disabled={!!baseline}
          value={value.id}
          onChange={(e) => patch({ id: e.target.value })}
        />
      </Field>
      <Field label="Commodity name">
        <input
          required
          maxLength={160}
          value={value.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </Field>
      <Field label="Unit of trade">
        <input
          required
          maxLength={160}
          value={value.unit}
          onChange={(e) => patch({ unit: e.target.value })}
        />
      </Field>
      <Field label="Commodity category">
        <select
          value={value.category}
          onChange={(e) => patch({ category: e.target.value as Commodity["category"] })}
        >
          {[
            "provisions",
            "smith",
            "cloth",
            "apothecary",
            "inn",
            "general",
            "curios",
            "stable",
            "scribe",
            "jewels",
          ].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <CoinAmountInput
        label="Base price per unit (cp)"
        min={1}
        value={value.baseCopper}
        onChange={(n) => patch({ baseCopper: Number(n) })}
      />
      <NumberField
        label="Weight per unit"
        value={value.weight}
        max={9999}
        step={0.01}
        set={(weight) => patch({ weight })}
      />
      <Field label="Property material">
        <select
          value={value.materialKey ?? ""}
          onChange={(e) => {
            const material = readEstate(table.journal.propertyOperations).materials.find(
              (m) => m.key === e.target.value,
            );
            const next = { ...value };
            delete next.materialKey;
            if (material) {
              next.materialKey = material.key;
              next.unit = material.unit;
            }
            set(next);
          }}
        >
          <option value="">No construction material link</option>
          {readEstate(table.journal.propertyOperations).materials.map((m) => (
            <option key={m.key} value={m.key}>
              {m.name} · {m.unit}
            </option>
          ))}
        </select>
      </Field>
      <p>
        Keys and units identify goods, regardless of their names. Traded units stay fixed. Reviewed
        material links let produced goods and purchased supplies use existing property recipes.
      </p>
      <Field label="Commodity description">
        <textarea
          maxLength={4000}
          value={value.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </Field>
      <Tick label="Commodity active" value={value.active} set={(active) => patch({ active })} />
      <Field label="Reason for commodity change">
        <input
          required
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </CommandForm>
  );
}

function ExchangeEditor({
  economy,
  current,
  onSaved,
}: {
  economy: TradeEconomy;
  current?: Exchange;
  onSaved: (id: string) => void;
}) {
  const table = useWorldTable(),
    [value, set] = useState<Exchange>(
      current ?? {
        id: crypto.randomUUID(),
        name: "",
        locationId: null,
        purseId: crypto.randomUUID(),
        open: true,
        visible: true,
        notes: "",
        offers: [],
      },
    ),
    [baseline, setBaseline] = useState<Exchange | null>(current ?? null),
    [funds, setFunds] = useState(0),
    [reason, setReason] = useState("DM exchange configuration");
  const patch = (x: Partial<Exchange>) => set({ ...value, ...x });
  return (
    <>
      <CommandForm
        label="Save exchange"
        dirty={baseline ? canonicalJson(value) !== canonicalJson(baseline) : !!value.name}
        onDone={() => {
          setBaseline(value);
          onSaved(value.id);
        }}
        submit={() => ({
          kind: "trade-exchange",
          before: baseline,
          exchange: exchangeSchema.parse(value),
          reason,
          ...(!baseline ? { treasury: { name: `${value.name} treasury`, copper: funds } } : {}),
        })}
      >
        <Field label="Exchange name">
          <input
            required
            maxLength={140}
            value={value.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field label="Exchange location">
          <select
            value={value.locationId ?? ""}
            onChange={(e) => patch({ locationId: e.target.value || null })}
          >
            <option value="">Campaignwide exchange</option>
            {readMarketLocations(table.journal.market).locations.map((l) => (
              <option key={l.id} value={l.id}>
                {locationLabel(readMarketLocations(table.journal.market), l.id)}
              </option>
            ))}
          </select>
        </Field>
        <Tick label="Exchange open" value={value.open} set={(open) => patch({ open })} />
        <Tick
          label="Visible to players here"
          value={value.visible}
          set={(visible) => patch({ visible })}
        />
        {!baseline && (
          <CoinAmountInput
            label="Explicit opening treasury funds (cp)"
            value={funds}
            onChange={(n) => setFunds(Number(n))}
          />
        )}
        <Field label="Exchange notes">
          <textarea
            maxLength={4000}
            value={value.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </Field>
        <h3>Commodity offers</h3>
        {!economy.commodities.length && <p>Create a commodity first.</p>}
        {economy.commodities.map((c) => {
          const offer = value.offers.find((o) => o.commodityId === c.id);
          const update = (p: Partial<TradeOffer>) =>
            patch({
              offers: value.offers.map((o) => (o.commodityId === c.id ? { ...o, ...p } : o)),
            });
          return (
            <fieldset key={c.id} className="journal-entry">
              <legend>
                {c.name} · {c.unit}
              </legend>
              <Tick
                label={`Trade ${c.name}`}
                value={!!offer}
                set={(checked) =>
                  patch({
                    offers: checked
                      ? [
                          ...value.offers,
                          {
                            ...initialOffer(c.id),
                            askCopper: c.baseCopper,
                            bidCopper: Math.floor(
                              (c.baseCopper * economy.settings.bidRateBps) / 10000,
                            ),
                          },
                        ]
                      : value.offers.filter((o) => o.commodityId !== c.id),
                  })
                }
              />
              {offer && (
                <>
                  <div className="trade-offer-grid">
                    {(
                      [
                        ["stock", "Available stock"],
                        ["targetStock", "Seasonal target stock"],
                        ["capacity", "Exchange stock capacity"],
                        ["supply", "Supply index"],
                        ["demand", "Demand index"],
                        ["askCopper", "Ask price (cp)"],
                        ["bidCopper", "Bid price (cp)"],
                      ] as const
                    ).map(([key, label]) => (
                      <NumberField
                        key={key}
                        label={`${c.name}: ${label}`}
                        value={offer[key]}
                        min={key === "supply" || key === "demand" || key === "askCopper" ? 1 : 0}
                        max={
                          key === "supply" || key === "demand"
                            ? 1000
                            : key.endsWith("Copper")
                              ? 1e12
                              : 1e9
                        }
                        set={(n) => update({ [key]: n })}
                      />
                    ))}
                  </div>
                  <Tick
                    label={`${c.name}: lock prices in Automatic Mode`}
                    value={offer.lockPrice}
                    set={(lockPrice) => update({ lockPrice })}
                  />
                  <Tick
                    label={`${c.name}: lock stock in Automatic Mode`}
                    value={offer.lockStock}
                    set={(lockStock) => update({ lockStock })}
                  />
                  <Tick
                    label={`${c.name}: lock supply & demand in Automatic Mode`}
                    value={offer.lockIndices}
                    set={(lockIndices) => update({ lockIndices })}
                  />
                </>
              )}
            </fieldset>
          );
        })}
        <Field label="Reason for exchange change">
          <input
            required
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </CommandForm>
      {baseline && <FundingEditor exchange={baseline} />}
    </>
  );
}

function FundingEditor({ exchange }: { exchange: Exchange }) {
  const table = useWorldTable(),
    balance = toCopper(table.purses.find((p) => p.id === exchange.purseId)!.coins),
    [funds, set] = useState(balance),
    [beforeBalance, setBeforeBalance] = useState(balance),
    [reason, setReason] = useState("DM treasury adjustment");
  return (
    <CommandForm
      label="Adjust exchange treasury"
      dirty={funds !== beforeBalance}
      onDone={() => setBeforeBalance(funds)}
      submit={() => ({
        kind: "trade-funding",
        exchangeId: exchange.id,
        beforeCopper: beforeBalance,
        copper: funds,
        reason,
      })}
    >
      <p>
        Current treasury {formatCopper(balance)}. Player trades conserve money; this explicit DM
        adjustment is recorded in the ledger.
      </p>
      <CoinAmountInput
        label="Set treasury balance (cp)"
        value={funds}
        onChange={(n) => set(Number(n))}
      />
      <Field label="Treasury adjustment reason">
        <input
          required
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </CommandForm>
  );
}

function TradeForm({
  economy,
  exchange,
  commodity,
}: {
  economy: TradeEconomy;
  exchange: Exchange;
  commodity: Commodity;
}) {
  const table = useWorldTable(),
    seat = useSeat(),
    dm = seat.role === "dm",
    accounts = table.purses.filter((p) => !p.nonParty && (dm || seat.purseIds.includes(p.id))),
    estate = readEstate(table.journal.propertyOperations);
  const [direction, setDirection] = useState<"buy" | "sell">("buy"),
    [purseId, setPurseId] = useState(accounts[0]?.id ?? ""),
    [quantity, setQuantity] = useState(1),
    [holdingId, setHoldingId] = useState(""),
    [propertyId, setPropertyId] = useState(""),
    [overrideLocation, setOverride] = useState(false);
  const lots = table.holdings.filter(
      (h) =>
        h.purseId === purseId &&
        h.commodityId === commodity.id &&
        !h.reservedFor &&
        h.custody?.kind !== "transit",
    ),
    stores = table.holdings.filter(
      (h) =>
        h.kind === "property" &&
        canAccessEstate(table, estate, h.id, seat) &&
        physicallyHere(table, h),
    );
  return (
    <CommandForm
      label={direction === "buy" ? "Buy commodity" : "Sell commodity"}
      submitDisabled={!purseId || (!exchangeHere(table, exchange) && !overrideLocation)}
      dirty={quantity !== 1 || !!holdingId || !!propertyId}
      onDone={() => {
        setQuantity(1);
        setHoldingId("");
        setPropertyId("");
      }}
      submit={() =>
        direction === "buy"
          ? {
              kind: "trade-buy",
              exchangeId: exchange.id,
              commodityId: commodity.id,
              purseId,
              quantity,
              before: exchangeQuoteKey(economy, exchange, commodity),
              ...(propertyId ? { propertyId } : {}),
              overrideLocation,
            }
          : {
              kind: "trade-sell",
              exchangeId: exchange.id,
              commodityId: commodity.id,
              holdingId,
              quantity,
              before: exchangeQuoteKey(economy, exchange, commodity),
              overrideLocation,
            }
      }
    >
      <Field label="Trade direction">
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as typeof direction)}
        >
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      </Field>
      <Field label="Trading account">
        <select
          required
          value={purseId}
          onChange={(e) => {
            setPurseId(e.target.value);
            setHoldingId("");
          }}
        >
          <option value="">Choose account</option>
          {accounts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {formatCopper(toCopper(p.coins))}
            </option>
          ))}
        </select>
      </Field>
      {direction === "sell" ? (
        <Field label="Commodity lot">
          <select required value={holdingId} onChange={(e) => setHoldingId(e.target.value)}>
            <option value="">Choose owned goods</option>
            {lots.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} · {h.quantity} {commodity.unit}
                {h.custody ? " · stored" : " · carried"}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Purchase destination">
          <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">Carried inventory</option>
            {stores.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} · property storage
              </option>
            ))}
          </select>
        </Field>
      )}
      <NumberField label="Trade quantity" value={quantity} min={1} max={100000} set={setQuantity} />
      <p>
        Total{" "}
        {formatCopper(
          quantity *
            exchange.offers.find((o) => o.commodityId === commodity.id)![
              direction === "buy" ? "askCopper" : "bidCopper"
            ],
        )}
        . Stock, storage, ownership and funds are checked together when committed.
      </p>
      {dm && (
        <Tick
          label="DM override: allow exchange visit from another location"
          value={overrideLocation}
          set={setOverride}
        />
      )}
    </CommandForm>
  );
}

function GoodsLinks({ economy }: { economy: TradeEconomy }) {
  const table = useWorldTable(),
    [holdingId, setHolding] = useState(""),
    [commodityId, setCommodity] = useState(economy.commodities[0]?.id ?? ""),
    [stockId, setStock] = useState(""),
    [exchangeId, setExchange] = useState(economy.exchanges[0]?.id ?? "");
  return (
    <>
      <p>
        Review the physical unit before linking existing goods. Shop links record seasonal activity
        and preserve custom shop prices.
      </p>
      <p className="text-sm text-muted">
        For supplier deliveries, review the material and physical unit against any linked commodity.
        Purchases use the shop’s configured asking price and any applicable Charisma adjustment. A
        reviewed commodity and exchange link records goods demand once, when purchased. Delivery
        fees stay separate, and arrival does not record another trade.
      </p>
      <CommandForm
        label="Link inventory commodity"
        submit={() => ({
          kind: "trade-bind",
          holdingId,
          commodityId,
          before: table.holdings.find((h) => h.id === holdingId)?.commodityId ?? null,
        })}
      >
        <Field label="Existing goods">
          <select required value={holdingId} onChange={(e) => setHolding(e.target.value)}>
            <option value="">Choose item lot</option>
            {table.holdings
              .filter(
                (h) =>
                  h.kind === "item" &&
                  !h.service &&
                  !h.reservedFor &&
                  h.custody?.kind !== "transit",
              )
              .map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} · {h.quantity}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Goods commodity">
          <select required value={commodityId} onChange={(e) => setCommodity(e.target.value)}>
            <option value="">Choose commodity</option>
            {economy.commodities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.unit}
              </option>
            ))}
          </select>
        </Field>
      </CommandForm>
      <CommandForm
        label="Link shop activity"
        submit={() => {
          const stock = table.stock.find((s) => s.id === stockId);
          return {
            kind: "trade-stock-link",
            stockId,
            commodityId: exchangeId ? commodityId || null : null,
            exchangeId: exchangeId || null,
            before: canonicalJson([stock?.tradeExchangeId ?? null, stock?.commodityId ?? null]),
          };
        }}
      >
        <Field label="Shop stock">
          <select required value={stockId} onChange={(e) => setStock(e.target.value)}>
            <option value="">Choose stock line</option>
            {table.stock
              .filter((s) => !s.service)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {table.shops.find((x) => x.id === s.shopId)?.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Activity exchange">
          <select value={exchangeId} onChange={(e) => setExchange(e.target.value)}>
            <option value="">Clear link (also clear commodity)</option>
            {economy.exchanges.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        <p>Uses the goods commodity chosen above. Clear both selections to remove a shop link.</p>
      </CommandForm>
    </>
  );
}

function ManualSeason({ economy }: { economy: TradeEconomy }) {
  const table = useWorldTable(),
    [season, setSeason] = useState((clampRealm(table.realm).season + 1) % 5),
    [reason, setReason] = useState("DM manual seasonal settlement"),
    [quotes, setQuotes] = useState(""),
    [realm, setRealm] = useState("");
  const pending = economy.pendingSeason;
  return (
    <>
      <p>
        Manual settlement changes the season once and preserves campaign time, original rolls and
        transaction receipts. Cancel pending downtime first. For normal session ends, use Downtime.
      </p>
      {!pending ? (
        <CommandForm
          label="Prepare manual season"
          submitDisabled={!economy.settings.enabled}
          submit={() => ({
            kind: "trade-season-plan",
            before: tradeSeasonFingerprint(table),
            season,
          })}
        >
          <Field label="Next season">
            <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
              {SEASON_NAMES.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        </CommandForm>
      ) : (
        <>
          <TradeSeasonReview quote={pending} />
          <CommandForm
            label="Approve manual season"
            dirty={!!quotes || !!realm}
            submit={() => ({
              kind: "trade-season-approve",
              previewId: pending.id,
              reason,
              ...(quotes.trim() ? { exchanges: JSON.parse(quotes) } : {}),
              ...(realm.trim() ? { realm: JSON.parse(realm) } : {}),
            })}
          >
            <Field label="Seasonal approval reason">
              <input
                required
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <details>
              <summary>Full DM override · proposed quotes and realm conditions</summary>
              <p>
                Copy the proposed JSON below, edit the values, and paste into the matching override
                field. Leave fields empty to approve the proposal. Identities and treasury accounts
                stay intact.
              </p>
              <details>
                <summary>Proposed exchange JSON</summary>
                <pre className="trade-json">{JSON.stringify(pending.exchanges, null, 2)}</pre>
              </details>
              <Field label="Exchange quote overrides (JSON)">
                <textarea rows={8} value={quotes} onChange={(e) => setQuotes(e.target.value)} />
              </Field>
              <details>
                <summary>Proposed realm JSON</summary>
                <pre className="trade-json">{JSON.stringify(pending.realm, null, 2)}</pre>
              </details>
              <Field label="Realm overrides (JSON)">
                <textarea rows={6} value={realm} onChange={(e) => setRealm(e.target.value)} />
              </Field>
            </details>
          </CommandForm>
          <CommandButton input={{ kind: "trade-season-cancel", previewId: pending.id }}>
            Cancel seasonal preview
          </CommandButton>
        </>
      )}
    </>
  );
}
