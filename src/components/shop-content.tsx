import { SavedTick, useSavedTick } from "@/components/saved-tick";
import { SearchSelect } from "@/components/search-select";
import { useSeatGroups } from "@/lib/quire/use-seat-groups";
import { MapRecordStrip } from "./map-record-strip";
import { BlacksmithServices } from "@/components/blacksmith-services";
import { ShopServices } from "@/components/service-providers";
import { shopVisible } from "@/lib/quire/world";
import { useFinanceReadiness } from "@/lib/quire/use-finance-readiness";
import { ShopEditor } from "@/components/shop-editor";
import "./shop-counter.css";
import { readMarketLocations, locationLabel } from "@/lib/quire/shop-locations";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { FinanceReadiness } from "@/components/finance-input";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { assertMerchantSale } from "@/lib/quire/merchant";
import { AppLink } from "@/components/app-link";
import { FantasyIcon } from "@/components/fantasy-icon";
import { getServerCloudTable } from "@/lib/quire/cloud-client";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { toast } from "sonner";
import { useCommandId, useEconomy } from "@/lib/quire/economy-context";
import {
  charismaOffPercent,
  formatCopper,
  parsePrice,
  priceAfterCharisma,
  toCopper,
} from "@/lib/quire/money";
import { charismaScore } from "@/lib/quire/sheet";
import { useDollarText, useShowDollars } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import { getSeat } from "@/lib/quire/table";
import { resultToast } from "@/lib/quire/result-toast";
import { showActionReceipt } from "@/lib/quire/action-receipt";
import { downloadShopPdf } from "@/lib/quire/shop-pdf";
import type { Holding, Shop, StockLine } from "@/lib/quire/types";
import { activeCampaignId } from "@/lib/quire/campaign-context";
import { initialPayer, rememberPayer, rememberedPayer } from "@/lib/quire/shop-counter-memory";
import { RemoveButton } from "@/components/quire-ui";
import { CatalogStockPicker, ShopStockList } from "@/components/shop-stock-manager";
import { Button, Confirm, Field, Segmented, TextInput } from "@/components/ui";
import { requestConfirm } from "@/lib/quire/confirm-store";

export function ShopContent({
  shopId,
  onRemoved,
  mapStrip = true,
  sellHoldingId,
}: {
  shopId: string;
  /** Preselects this holding in "Sell to this shop" and scrolls to it. */
  sellHoldingId?: string;
  onRemoved?: () => void;
  /** False inside the map's place card, which is already on the map. */
  mapStrip?: boolean;
}) {
  const navigate = useNavigate();
  const economy = useEconomy();
  const showDollars = useShowDollars();
  const seat = useSeat();
  const groups = useSeatGroups();
  const shop = economy.shops.find((item) => item.id === shopId);
  const lines = economy.stock.filter((line) => line.shopId === shopId);
  const spendable =
    seat.role === "player"
      ? economy.purses.filter((purse) => seat.purseIds.includes(purse.id))
      : economy.purses;
  const [mode, setMode] = useState<"counter" | "edit">("counter");
  const [editDirty, setEditDirty] = useState(false);
  // DM "Sell to <character>": the buyer is chosen once and each row becomes one tap.
  const [sellTo, setSellTo] = useState(false);
  const [purseId, setPurseId] = useState(() =>
    initialPayer(spendable, rememberedPayer(activeCampaignId(), shopId)),
  );
  // Only the row being edited shows its cost and afterward-balance sentence.
  const [activeRow, setActiveRow] = useState("");
  const [confirming, setConfirming] = useState(false);
  const characters = spendable.filter((purse) => purse.kind === "character");
  const choices = sellTo && characters.length ? characters : spendable;

  useEffect(() => {
    if (!choices.some((purse) => purse.id === purseId) && choices[0])
      setPurseId(initialPayer(choices, rememberedPayer(activeCampaignId(), shopId)));
  }, [choices, purseId, shopId]);

  function choosePayer(id: string) {
    setPurseId(id);
    rememberPayer(activeCampaignId(), shopId, id);
  }

  if (!economy.ready) {
    return (
      <>
        <p className="text-muted">Opening the shop…</p>
      </>
    );
  }
  if (!shop) {
    return (
      <>
        <h1 className="font-display text-4xl tracking-tight">Missing shop</h1>
        <Link
          to="/market"
          search={{ book: "" }}
          className="mt-4 inline-flex min-h-11 items-center text-sm"
        >
          Back to the market
        </Link>
      </>
    );
  }

  if (
    seat.role === "player" &&
    (!seat.shopIds.includes(shop.id) || !shopVisible(shop, { journal: economy.journal }, groups))
  ) {
    return (
      <>
        <h1 className="font-display text-4xl tracking-tight">Shop not included</h1>
        <p className="mt-2 text-sm text-muted">
          This shop is not available at the party's current location.
        </p>
      </>
    );
  }

  const dm = seat.role === "dm";
  const viewing = dm ? mode : "counter";
  const payer = economy.purses.find((purse) => purse.id === purseId);
  const region = shop.locationId
    ? locationLabel(readMarketLocations(economy.journal.market), shop.locationId)
    : "";
  const pdf = (
    <Button
      variant="secondary"
      onClick={() => {
        void downloadShopPdf({
          shop,
          lines,
          showDollars,
          gpDollars: economy.realm.gpDollars,
        })
          .then((saved) => {
            if (saved) toast.success("Shop sheet downloaded.");
          })
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : "Could not share the shop sheet."),
          );
      }}
    >
      Share as PDF
    </Button>
  );

  return (
    <>
      <header className="shop-header">
        <Link to="/market" search={{ book: "" }} className="shop-header-back">
          <span aria-hidden="true">← </span>Market
        </Link>
        <div className="shop-header-title">
          {shop.image ? <img src={shop.image} alt={shop.name} className="shop-header-image" /> : null}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl leading-tight tracking-tight sm:text-4xl">
              {shop.name}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {[shop.keeper, shop.place].filter(Boolean).join(" · ") || "No owner or location"}
              {region && region !== shop.place ? ` · ${region}` : ""}
            </p>
            <p className="text-sm text-muted">
              Sells at {Math.round(shop.sellRate * 100)}%, buys at {Math.round(shop.buyRate * 100)}%
              {shop.blackMarket ? " · black market" : ""}
            </p>
          </div>
          {dm ? (
            <OpenSwitch shop={shop} />
          ) : (
            <span className={shop.closed ? "shop-status text-muted" : "shop-status text-positive"}>
              {shop.closed ? "Closed · browsing only" : "Open"}
            </span>
          )}
        </div>
        {dm ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="sm:flex-1">
              <Segmented
                label="Shop mode"
                value={mode}
                onChange={async (next) => {
                  if (
                    next === "counter" &&
                    editDirty &&
                    !(await requestConfirm({
                      title: "Discard unsaved shop edits?",
                      tone: "discard",
                    }))
                  )
                    return;
                  setMode(next);
                }}
                options={[
                  { value: "counter", label: "Counter" },
                  { value: "edit", label: "Edit" },
                ]}
              />
            </div>
            {pdf}
          </div>
        ) : null}
      </header>
      {mapStrip && (
        <MapRecordStrip reference={{ kind: "shop", id: shop.id }} hideUnplacedForPlayers />
      )}
      {viewing === "edit" ? (
        <ShopEditor key={shop.id} shop={shop} onDirtyChange={setEditDirty} />
      ) : (
        <>
          <div
            className="shop-paybar"
            role="group"
            aria-label="Counter purse"
          >
            <label className="shop-paybar-choice">
              <span className="shop-paybar-label">{sellTo ? "Sell to" : "Paying from"}</span>
              <SearchSelect
                aria-label={sellTo ? "Sell to" : "Paying from"}
                value={purseId}
                onValueChange={choosePayer}
                className="min-h-11 w-full min-w-0 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
              >
                {[...choices]
                  .sort(
                    (a, b) =>
                      Number(b.kind === "party") - Number(a.kind === "party") ||
                      a.name.localeCompare(b.name),
                  )
                  .map((purse) => (
                    <option key={purse.id} value={purse.id}>
                      {purse.kind === "party" ? `Party · ${purse.name}` : purse.name} ·{" "}
                      {formatCopper(toCopper(purse.coins))}
                    </option>
                  ))}
              </SearchSelect>
            </label>
            {dm ? (
              <label className="shop-paybar-mode">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={sellTo}
                  onChange={(event) => {
                    setSellTo(event.target.checked);
                    setActiveRow("");
                  }}
                />
                Sell to a character
              </label>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            <CharismaNote purseId={purseId} dm={dm} />
            {sellTo && payer
              ? ` Each Sell button charges ${payer.name} for one item through the usual purchase.`
              : ""}
          </p>
        </>
      )}
      <TurnLock />
      {viewing === "edit" ? <CatalogStockPicker key={`catalog-${shop.id}`} shop={shop} /> : null}
      <ShopStockList
        key={`stock-${shop.id}`}
        lines={lines}
        renderRow={(line) => (
          <StockRow
            key={line.id}
            line={line}
            mode={viewing}
            purseId={purseId}
            sellToName={dm && sellTo ? (payer?.name ?? "") : ""}
            active={activeRow === line.id}
            onActivate={() => setActiveRow(line.id)}
            sellRate={shop.sellRate * (shop.blackMarket ? (shop.blackMarketPremium ?? 1.5) : 1)}
            charisma={charismaScore(economy.sheets.find((sheet) => sheet.purseId === purseId))}
            locked={!!shop.closed || (viewing === "counter" && turnIsLocked())}
          />
        )}
      />
      <BlacksmithServices shop={shop} purseId={purseId} />
      <ShopServices shop={shop} purseId={purseId} />
      {viewing === "edit" ? <AddGood shopId={shop.id} /> : <SellBox shopId={shop.id} initialHoldingId={sellHoldingId} />}
      {!dm ? (
        <div className="mt-6 flex flex-col gap-2">
          <p className="text-sm text-muted">
            You can buy and sell. Only the dungeon master can change prices.
          </p>
          {pdf}
        </div>
      ) : null}
      {viewing === "edit" ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-8 inline-flex min-h-11 items-center text-sm text-muted"
        >
          Remove shop
        </button>
      ) : null}
      <Confirm
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove this shop?"
        body="The shop and its stock are deleted. Purchases already in the ledger stay."
        confirmLabel="Remove"
        onConfirm={() => {
          void economy
            .deleteShop(shop.id)
            .then(() =>
              onRemoved ? onRemoved() : navigate({ to: "/market", search: { book: "" } }),
            );
        }}
      />
    </>
  );
}

/** The DM's Open/Closed switch in the shop header. */
function OpenSwitch({ shop }: { shop: Shop }) {
  const { updateShop } = useEconomy();
  const open = !shop.closed;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={open}
      aria-label="Open for trading"
      className="shop-open-switch"
      onClick={async () => {
        if (
          shop.schedule &&
          !(await requestConfirm({
            title: shop.closed ? "Open this shop by hand?" : "Close this shop by hand?",
            body: "Manually changing availability disables this shop’s schedule.",
            confirmLabel: shop.closed ? "Open shop" : "Close shop",
          }))
        )
          return;
        void updateShop({ ...shop, closed: !shop.closed });
      }}
    >
      <span className="shop-open-track" aria-hidden="true">
        <span className="shop-open-thumb" />
      </span>
      <span aria-hidden="true">{open ? "Open" : "Closed"}</span>
    </button>
  );
}

function turnIsLocked() {
  const table = getCloudTable();
  return table.joined && !table.live && !table.mine;
}

function TurnLock() {
  const table = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  if (table.joined && table.viewOnly)
    return (
      <p className="mt-3 text-sm text-muted">
        Between sessions · players view only. Buying waits until the DM resumes play.
      </p>
    );
  if (!table.joined || table.live || table.mine) return null;
  return <p className="mt-3 text-sm text-muted">It is {table.who}'s turn. Buying waits.</p>;
}

function CharismaNote({ purseId, dm }: { purseId: string; dm: boolean }) {
  const { sheets, purses } = useEconomy();
  const purse = purses.find((item) => item.id === purseId);
  if (!purse) return null;
  if (purse.kind !== "character")
    return <>The party fund pays the listed price from the shared account.</>;
  const score = charismaScore(sheets.find((sheet) => sheet.purseId === purseId));
  // Importing a sheet is the DM's setup step; players are not shown it.
  if (score === null)
    return dm ? <>Import this character's 2014 sheet to take the Charisma discount.</> : null;
  const percent = charismaOffPercent(score);
  if (percent <= 0) return <>Charisma {score} pays the listed price.</>;
  return (
    <>
      Charisma {score} takes {percent}% off every purchase.
    </>
  );
}

function StockRow({
  line,
  mode,
  purseId,
  sellToName = "",
  active = false,
  onActivate,
  sellRate,
  charisma,
  locked = false,
}: {
  line: StockLine;
  mode: "counter" | "edit";
  purseId: string;
  /** DM "Sell to" mode: the buyer's name; the row becomes one tap for one item. */
  sellToName?: string;
  /** This row is being edited, so it shows the cost and afterward balance. */
  active?: boolean;
  onActivate?: () => void;
  sellRate: number;
  charisma: number | null;
  locked?: boolean;
}) {
  const { buy, updateStock, deleteStock, purses, undoPurchase } = useEconomy();
  const stockSaved = useSavedTick();
  const dollars = useDollarText();
  const [qty, setQty] = useState("1");
  const oneTap = !!sellToName;
  const pending = useRef(false);
  // One command ID per purchase, reused if the same purchase is retried.
  const action = useCommandId(`${purseId}|${oneTap ? "1" : qty}`);
  const asked = oneTap ? 1 : Number(qty);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const { locked: readinessLocked } = useFinanceReadiness();
  const available = toCopper(
    purses.find((p) => p.id === purseId)?.coins || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  );
  const asking = Math.round(line.copper * sellRate);
  const percent = charisma === null ? 0 : charismaOffPercent(charisma);
  const unit = priceAfterCharisma(asking, charisma);
  const price = unit * asked;
  const reduced = unit !== asking;
  const modern = dollars(unit);

  if (mode === "counter") {
    const disabled =
      busy ||
      readinessLocked ||
      locked ||
      !purseId ||
      !Number.isSafeInteger(asked) ||
      asked < 1 ||
      price > available ||
      (line.quantity !== null && asked > line.quantity);
    async function purchase() {
      // A second tap before React re-renders the disabled button must not start another buy.
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setError("");
      setNotice("");
      let settle = 0;
      try {
        const commandId = action.commandId;
        const outcome = await buy(line.id, purseId, asked, { commandId });
        action.renew();
        const done = mutationNotice(outcome, oneTap ? `Sold 1 to ${sellToName}.` : "Purchase recorded.");
        setNotice(done);
        // Result toast (design D9): the receipt, and Undo for the DM while the ledger void applies.
        resultToast(done, {
          receipt: () =>
            showActionReceipt({ title: "Purchase receipt", commandId, holdingId: commandId + "-item" }),
          ...(outcome.status === "committed" && getSeat().role === "dm"
            ? { undo: () => void undoPurchase(commandId) }
            : {}),
        });
        // One-tap selling: an accidental double tap is one sale, so the row rests briefly.
        if (oneTap) settle = 700;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Purchase failed.");
      } finally {
        window.setTimeout(() => {
          pending.current = false;
          setBusy(false);
        }, settle);
      }
    }
    return (
      <li className="shop-row flex flex-wrap items-center gap-x-3 gap-y-1 py-3" data-active={active || undefined}>
        <span className="min-w-0 flex-1">
          <span className="block">
            <FantasyIcon entry={line} className="fantasy-inline" />
            {line.name}
          </span>
          <span className="text-sm text-muted">
            {formatCopper(unit)}
            {reduced ? ` · ${percent}% off · was ${formatCopper(asking)}` : ""}
            {line.quantity === null ? "" : ` · ${line.quantity} left`}
            {modern ? <span className="shop-row-modern"> · {modern}</span> : null}
          </span>
        </span>
        {oneTap ? (
          <Button disabled={disabled} onClick={() => void purchase()}>
            Sell 1 · {formatCopper(price)}
          </Button>
        ) : (
          <>
            <input
              aria-label={`Quantity of ${line.name}`}
              value={qty}
              onFocus={onActivate}
              onChange={(event) => {
                setQty(event.target.value);
                onActivate?.();
              }}
              inputMode="numeric"
              className="h-11 w-16 rounded-sm border border-border bg-subtle px-2 text-center text-base text-fg"
            />
            <Button disabled={disabled} onClick={() => void purchase()}>
              Buy {formatCopper(price)}
            </Button>
          </>
        )}
        {active && !oneTap ? (
          <p className="w-full text-sm" aria-live="polite">
            {Number.isSafeInteger(asked) && asked > 0
              ? `${asked} × ${formatCopper(unit)} = ${formatCopper(price)}. Available ${formatCopper(available)}; afterward ${formatCopper(available - price)}.`
              : "Choose a whole quantity of at least one."}
          </p>
        ) : null}
        {error && <p role="alert">{error}</p>}
        {notice && (
          <p role="status">
            {notice} <AppLink href="/party?section=funds">Open inventory & ledger</AppLink>
          </p>
        )}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 py-3">
      <FantasyIcon entry={line} size={32} />
      <TextInput
        aria-label="Good"
        defaultValue={line.name}
        onBlur={(event) => {
          const name = event.target.value.trim();
          if (name && name !== line.name) stockSaved.track(updateStock({ ...line, name }));
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Price">
          <TextInput
            aria-label="Price"
            defaultValue={formatCopper(line.copper)}
            onBlur={(event) => {
              const copper = parsePrice(event.target.value);
              if (copper !== null && copper !== line.copper)
                stockSaved.track(updateStock({ ...line, copper }));
            }}
          />
        </Field>
        <Field label="Quantity" hint="Blank if unlimited.">
          <TextInput
            aria-label="Quantity, blank if unlimited"
            defaultValue={line.quantity === null ? "" : String(line.quantity)}
            onBlur={(event) => {
              const raw = event.target.value.trim();
              const quantity = raw === "" ? null : Math.max(0, Math.floor(Number(raw)));
              if (raw !== "" && Number.isNaN(quantity)) return;
              if (quantity !== line.quantity) stockSaved.track(updateStock({ ...line, quantity }));
            }}
          />
        </Field>
      </div>
      <SavedTick saved={stockSaved.saved} />
      <RemoveButton
        className="self-start"
        label="Remove item"
        title={`Remove ${line.name}?`}
        body="This removes the item from this shop. It stays in the catalog."
        onRemove={() => void deleteStock(line.id)}
      />
    </li>
  );
}

function AddGood({ shopId }: { shopId: string }) {
  const { addStock } = useEconomy();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useDraftGuard(!!name || !!price || !!qty, "shop item");
  return (
    <form
      className="mt-4 flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const copper = parsePrice(price);
        if (!name.trim() || copper === null) return;
        const quantity = qty.trim() === "" ? null : Number(qty);
        if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0)) {
          setError("Choose a whole quantity of zero or more, or leave blank for unlimited.");
          return;
        }
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const result = await addStock(shopId, name.trim(), copper, quantity);
          setNotice(mutationNotice(result, "Item added."));
          setName("");
          setPrice("");
          setQty("");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Item save failed. Your draft is retained.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="New item">
        <TextInput
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="New item"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Price">
          <TextInput
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="2 gp"
            aria-label="New price"
          />
        </Field>
        <Field label="Quantity" hint="Blank if unlimited.">
          <TextInput
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            aria-label="New quantity"
          />
        </Field>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Button type="submit" variant="secondary" disabled={busy}>
        Add item
      </Button>
    </form>
  );
}

function SellBox({ shopId, initialHoldingId }: { shopId: string; initialHoldingId?: string }) {
  const { holdings, sell, shops } = useEconomy();
  const closed = shops.find((s) => s.id === shopId)?.closed;
  const turnLocked = turnIsLocked();
  const seat = useSeat();
  const mine =
    seat.role === "player"
      ? holdings.filter((holding) => seat.purseIds.includes(holding.purseId))
      : holdings;
  const [holdingId, setHoldingId] = useState(
    initialHoldingId && mine.some((item) => item.id === initialHoldingId)
      ? initialHoldingId
      : (mine[0]?.id ?? ""),
  );
  const [qty, setQty] = useState("1");
  useEffect(() => {
    if (!initialHoldingId) return;
    const timer = setTimeout(
      () => document.getElementById("sell")?.scrollIntoView({ block: "center" }),
      80,
    );
    return () => clearTimeout(timer);
  }, [initialHoldingId]);
  // One command ID per sale, reused if the same sale is retried.
  const action = useCommandId(`${holdingId}|${qty}`);
  const holding = mine.find((item) => item.id === holdingId),
    shop = shops.find((s) => s.id === shopId);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const { locked } = useFinanceReadiness();
  let eligibility = "";
  if (holding && shop) {
    try {
      assertMerchantSale(holding, shop);
    } catch (e) {
      eligibility = e instanceof Error ? e.message : "This sale is unavailable.";
    }
  }
  const asked = Number(qty),
    payout =
      holding && shop ? Math.max(0, Math.round(holding.unitCopper * shop.buyRate)) * asked : 0;

  useEffect(() => {
    if (!mine.some((item) => item.id === holdingId) && mine[0]) setHoldingId(mine[0].id);
  }, [holdingId, mine]);

  if (mine.length === 0)
    return <p className="mt-6 text-sm text-muted">This account has nothing this shop will buy.</p>;

  return (
    <form
      id="sell"
      className="mt-6 flex flex-col gap-2"
      style={{ scrollMarginTop: "6rem" }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!holding || closed || turnLocked || locked || busy || eligibility) return;
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const commandId = action.commandId;
          const result = await sell(holding.id, shopId, asked, { commandId });
          action.renew();
          const done = mutationNotice(result, "Sale recorded.");
          setNotice(done);
          // No Undo: a shop sale has no goods-return receipt for the ledger void to reverse.
          resultToast(done, {
            receipt: () => showActionReceipt({ title: "Sale receipt", commandId }),
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Sale failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted">Sell to this shop</p>
      <FinanceReadiness />
      {holding && shop && (
        <p>
          Lot value each {formatCopper(holding.unitCopper)} · merchant rate{" "}
          {Math.round(shop.buyRate * 100)}%.{" "}
          {Number.isSafeInteger(asked) && asked > 0
            ? `Preview payout ${formatCopper(payout)}; quantity remaining ${holding.quantity - asked}.`
            : "Choose a whole quantity of at least one."}
        </p>
      )}
      {eligibility && <p role="status">{eligibility}</p>}
      {error && <p role="alert">{error}</p>}
      {notice && (
        <p role="status">
          {notice} <AppLink href="/party?section=funds">Open original inventory & ledger</AppLink>
        </p>
      )}
      <SearchSelect
        aria-label="Item to sell"
        value={holdingId}
        onValueChange={(selectedValue) => setHoldingId(selectedValue)}
        className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
      >
        {mine.map((item) => (
          <option key={item.id} value={item.id}>
            {labelHolding(item)}
          </option>
        ))}
      </SearchSelect>
      <div className="flex gap-2">
        <TextInput
          value={qty}
          onChange={(event) => setQty(event.target.value)}
          aria-label="Quantity to sell"
          className="w-24"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={
            closed ||
            turnLocked ||
            locked ||
            busy ||
            !!eligibility ||
            !Number.isSafeInteger(asked) ||
            asked < 1 ||
            asked > (holding?.quantity || 0)
          }
        >
          Sell
        </Button>
      </div>
    </form>
  );
}

function labelHolding(holding: Holding) {
  return `${holding.name} × ${holding.quantity}`;
}
