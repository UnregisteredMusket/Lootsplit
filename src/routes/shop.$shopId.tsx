import { BlackMarketVendor } from "@/components/black-market";
import { shopVisible } from "@/lib/quire/world";
import { useFinanceReadiness } from "@/lib/quire/use-finance-readiness";
import { ShopLocationEditor } from "@/components/market-locations";
import { readMarketLocations, locationLabel } from "@/lib/quire/shop-locations";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { FinanceReadiness } from "@/components/finance-input";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { assertMerchantSale } from "@/lib/quire/merchant";
import { AppLink } from "@/components/app-link";
import { FantasyIcon } from "@/components/fantasy-icon";
import { getServerCloudTable } from "@/lib/quire/cloud-client";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { SHOP_KINDS, WEALTHS } from "@/lib/quire/labels";
import {
  charismaOffPercent,
  formatCopper,
  parsePrice,
  priceAfterCharisma,
  toCopper,
} from "@/lib/quire/money";
import { charismaScore } from "@/lib/quire/sheet";
import { useDollarText, usePrefs } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import { realmNote, scarcityNote } from "@/lib/quire/scale";
import { downloadShopPdf } from "@/lib/quire/shop-pdf";
import type { Holding, Shop, StockLine, Wealth } from "@/lib/quire/types";
import { Shell } from "@/components/shell";
import { RemoveButton } from "@/components/quire-ui";
import { CatalogStockPicker, ShopStockList } from "@/components/shop-stock-manager";
import { Button, Confirm, Segmented, Select, Slider, TextInput } from "@/components/ui";

export const Route = createFileRoute("/shop/$shopId")({
  component: ShopPage,
});

function ShopPage() {
  const { shopId } = Route.useParams();
  const navigate = useNavigate();
  const economy = useEconomy();
  const { prefs } = usePrefs();
  const seat = useSeat();
  const shop = economy.shops.find((item) => item.id === shopId);
  const lines = economy.stock.filter((line) => line.shopId === shopId);
  const spendable =
    seat.role === "player"
      ? economy.purses.filter((purse) => seat.purseIds.includes(purse.id))
      : economy.purses;
  const [mode, setMode] = useState<"counter" | "edit">("counter");
  const [purseId, setPurseId] = useState(
    spendable.find((purse) => purse.kind === "party")?.id ?? spendable[0]?.id ?? "",
  );
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!spendable.some((purse) => purse.id === purseId) && spendable[0])
      setPurseId(spendable[0].id);
  }, [spendable, purseId]);

  if (!economy.ready) {
    return (
      <Shell>
        <p className="text-muted">Opening the shop…</p>
      </Shell>
    );
  }
  if (!shop) {
    return (
      <Shell>
        <h1 className="font-display text-4xl tracking-tight">Missing shop</h1>
        <Link
          to="/market"
          search={{ book: "" }}
          className="mt-4 inline-flex min-h-11 items-center text-sm"
        >
          Back to the market
        </Link>
      </Shell>
    );
  }

  if (
    seat.role === "player" &&
    (!seat.shopIds.includes(shop.id) ||
      !shopVisible(shop, {journal:economy.journal}))
  ) {
    return (
      <Shell>
        <h1 className="font-display text-4xl tracking-tight">Shop not included</h1>
        <p className="mt-2 text-sm text-muted">
          This shop is not available at the party's current location.
        </p>
      </Shell>
    );
  }

  const viewing = seat.role === "player" ? "counter" : mode;

  return (
    <Shell>
      {seat.role === "dm" && <BlackMarketVendor key={shop.id} shop={shop}/>}
      <Link to="/market" search={{ book: "" }} className="text-sm text-muted">
        Market
      </Link>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className={shop.closed ? "text-muted" : "text-positive"}>
          {shop.closed ? "Closed · browsing only" : "Open for trading"}
        </p>
        {seat.role === "dm" ? (
          <Button
            variant="secondary"
            onClick={() => {
              if (
                shop.schedule &&
                !window.confirm(
                  "Manually changing availability disables this shop’s schedule. Continue?",
                )
              )
                return;
              void economy.updateShop({ ...shop, closed: !shop.closed });
            }}
          >
            {shop.closed ? "Open shop" : "Close shop"}
          </Button>
        ) : null}
      </div>
      {shop.image ? (
        <img
          src={shop.image}
          alt={shop.name}
          className="mt-3 max-h-72 w-full rounded-lg object-contain"
        />
      ) : null}
      <p className="mt-2 text-sm text-muted">
        {locationLabel(readMarketLocations(economy.journal.market), shop.locationId)}
      </p>
      {viewing === "edit" ? (
        <div className="mt-3 flex flex-col gap-3">
          <TextInput
            aria-label="Shop name"
            defaultValue={shop.name}
            key={shop.name}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name && name !== shop.name) void economy.updateShop({ ...shop, name });
            }}
            className="font-display text-2xl"
          />
          <TextInput
            aria-label="Shopkeeper"
            placeholder="Shopkeeper"
            defaultValue={shop.keeper}
            key={`keeper-${shop.keeper}`}
            onBlur={(event) =>
              void economy.updateShop({ ...shop, keeper: event.target.value.trim() })
            }
          />
          <TextInput
            aria-label="Shop location"
            placeholder="Shop location"
            defaultValue={shop.place}
            key={`place-${shop.place}`}
            onBlur={(event) =>
              void economy.updateShop({ ...shop, place: event.target.value.trim() })
            }
          />
          <ShelfTuning shop={shop} />
          <ShopLocationEditor key={shop.id} shop={shop} />
        </div>
      ) : (
        <div className="mt-2">
          <h1 className="font-display text-4xl tracking-tight">{shop.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {[shop.keeper, shop.place].filter(Boolean).join(" · ") || "No owner or location"} ·
            sells at {Math.round(shop.sellRate * 100)}%, buys at {Math.round(shop.buyRate * 100)}%
          </p>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        {seat.role === "dm" ? (
          <div className="sm:flex-1">
            <Segmented
              label="Shop mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "counter", label: "Counter" },
                { value: "edit", label: "Edit" },
              ]}
            />
          </div>
        ) : (
          <p className="text-sm text-muted sm:flex-1">
            You can buy and sell. Only the dungeon master can change prices.
          </p>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            void downloadShopPdf({
              shop,
              lines,
              showDollars: prefs.showDollars,
              gpDollars: economy.realm.gpDollars,
            })
              .then((saved) => {
                if (saved) toast.success("Shop sheet downloaded.");
              })
              .catch((error: unknown) =>
                toast.error(
                  error instanceof Error ? error.message : "Could not share the shop sheet.",
                ),
              );
          }}
        >
          Share as PDF
        </Button>
      </div>
      <label className="mt-4 block text-sm text-muted">
        Paying from
        <select
          value={purseId}
          onChange={(event) => setPurseId(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg"
        >
          {[...spendable]
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
        </select>
        {spendable.some((purse) => purse.kind === "party") ? (
          <span className="mt-1 block">
            The party option spends the shared account. A character spends their own.
          </span>
        ) : null}
        <CharismaNote purseId={purseId} />
      </label>
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
            sellRate={shop.sellRate * (shop.blackMarket ? shop.blackMarketPremium ?? 1.5 : 1)}
            charisma={charismaScore(economy.sheets.find((sheet) => sheet.purseId === purseId))}
            locked={!!shop.closed || (viewing === "counter" && turnIsLocked())}
          />
        )}
      />
      {viewing === "edit" ? <AddGood shopId={shop.id} /> : <SellBox shopId={shop.id} />}
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
            .then(() => navigate({ to: "/market", search: { book: "" } }));
        }}
      />
    </Shell>
  );
}

function ShelfTuning({ shop }: { shop: Shop }) {
  const { applyShop, updateShop, realm } = useEconomy();
  const { prefs } = usePrefs();
  const [scale, setScale] = useState(shop.priceScale);
  const [sell, setSell] = useState(shop.sellRate);
  const [buy, setBuy] = useState(shop.buyRate);

  useEffect(() => {
    setScale(shop.priceScale);
    setSell(shop.sellRate);
    setBuy(shop.buyRate);
  }, [shop.id, shop.priceScale, shop.sellRate, shop.buyRate]);

  return (
    <div className="flex flex-col gap-3">
      <Select
        aria-label="Type of shop"
        value={shop.category}
        onChange={(event) =>
          void updateShop({ ...shop, category: event.target.value as Shop["category"] })
        }
      >
        {SHOP_KINDS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={shop.acceptAnyCategory === true}
          onChange={(e) => void updateShop({ ...shop, acceptAnyCategory: e.target.checked })}
        />
        DM exception: buy all item categories
      </label>
      <fieldset>
        <legend className="text-sm">Additional categories this merchant buys</legend>
        {SHOP_KINDS.filter((o) => o.value !== "mixed").map((o) => (
          <label key={o.value} className="mr-3 inline-flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={(shop.acceptedCategories || [shop.category]).includes(o.value)}
              onChange={(e) => {
                const categories = new Set(shop.acceptedCategories || [shop.category]);
                if (e.target.checked) categories.add(o.value);
                else categories.delete(o.value);
                void updateShop({ ...shop, acceptedCategories: [...categories] });
              }}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        {WEALTHS.map((option) => (
          <Button
            key={option.value}
            variant={shop.wealth === option.value ? "primary" : "secondary"}
            onClick={() =>
              void applyShop({
                ...shop,
                wealth: option.value as Wealth,
                priceScale: scale,
                sellRate: sell,
                buyRate: buy,
              })
            }
          >
            {option.label}
          </Button>
        ))}
      </div>
      <Slider
        label="Base price multiplier"
        min={0.5}
        max={2.5}
        step={0.05}
        value={scale}
        onChange={setScale}
        onCommit={(value) =>
          void applyShop({ ...shop, priceScale: value, sellRate: sell, buyRate: buy })
        }
        display={`${Math.round(scale * 100)}%`}
      />
      <Slider
        label="Sells at"
        min={0.5}
        max={2}
        step={0.05}
        value={sell}
        onChange={setSell}
        onCommit={(value) => void updateShop({ ...shop, sellRate: value })}
        display={`${Math.round(sell * 100)}%`}
      />
      <Slider
        label="Buys at"
        min={0.1}
        max={1}
        step={0.05}
        value={buy}
        onChange={setBuy}
        onCommit={(value) => void updateShop({ ...shop, buyRate: value })}
        display={`${Math.round(buy * 100)}%`}
      />
      <p className="text-sm text-muted">
        {realmNote(realm, { dollars: prefs.showDollars })} {scarcityNote(realm.scarcity)} Updating
        prices uses the modifiers above. Dollars are a comparison for one gold piece, not a second
        price.
      </p>
    </div>
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

function CharismaNote({ purseId }: { purseId: string }) {
  const { sheets, purses } = useEconomy();
  const purse = purses.find((item) => item.id === purseId);
  if (!purse || purse.kind !== "character")
    return <span className="mt-1 block">The party fund pays the listed price.</span>;
  const score = charismaScore(sheets.find((sheet) => sheet.purseId === purseId));
  if (score === null)
    return (
      <span className="mt-1 block">
        Import this character's 2014 sheet to take the Charisma discount.
      </span>
    );
  const percent = charismaOffPercent(score);
  if (percent <= 0)
    return <span className="mt-1 block">Charisma {score} pays the listed price.</span>;
  return (
    <span className="mt-1 block">
      Charisma {score} takes {percent}% off every purchase.
    </span>
  );
}

function StockRow({
  line,
  mode,
  purseId,
  sellRate,
  charisma,
  locked = false,
}: {
  line: StockLine;
  mode: "counter" | "edit";
  purseId: string;
  sellRate: number;
  charisma: number | null;
  locked?: boolean;
}) {
  const { buy, updateStock, deleteStock, purses } = useEconomy();
  const dollars = useDollarText();
  const [qty, setQty] = useState("1");
  const asked = Number(qty);
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

  if (mode === "counter") {
    return (
      <li className="flex flex-wrap items-center gap-3 py-3">
        <span className="min-w-0 flex-1">
          <span className="block">
            <FantasyIcon entry={line} className="fantasy-inline" />
            {line.name}
          </span>
          <span className="text-sm text-muted">
            {formatCopper(unit)}
            {reduced ? ` · ${percent}% off · was ${formatCopper(asking)}` : ""}
            {dollars(unit) ? ` · ${dollars(unit)}` : ""}
            {line.quantity === null ? "" : ` · ${line.quantity} left`}
          </span>
        </span>
        <input
          aria-label={`Quantity of ${line.name}`}
          value={qty}
          onChange={(event) => setQty(event.target.value)}
          inputMode="numeric"
          className="h-11 w-16 rounded-sm border border-border bg-subtle px-2 text-center text-base text-fg"
        />
        <Button
          disabled={
            busy ||
            readinessLocked ||
            locked ||
            !purseId ||
            !Number.isSafeInteger(asked) ||
            asked < 1 ||
            price > available ||
            (line.quantity !== null && asked > line.quantity)
          }
          onClick={async () => {
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const outcome = await buy(line.id, purseId, asked);
              setNotice(mutationNotice(outcome, "Purchase recorded."));
            } catch (e) {
              setError(e instanceof Error ? e.message : "Purchase failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Buy {formatCopper(price)}
        </Button>
        <p className="w-full text-sm">
          {Number.isSafeInteger(asked) && asked > 0
            ? `${asked} × ${formatCopper(unit)} = ${formatCopper(price)}. Available ${formatCopper(available)}; afterward ${formatCopper(available - price)}.`
            : "Choose a whole quantity of at least one."}
        </p>
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
          if (name && name !== line.name) void updateStock({ ...line, name });
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <TextInput
          aria-label="Price"
          defaultValue={formatCopper(line.copper)}
          onBlur={(event) => {
            const copper = parsePrice(event.target.value);
            if (copper !== null && copper !== line.copper) void updateStock({ ...line, copper });
          }}
        />
        <TextInput
          aria-label="Quantity, blank if unlimited"
          placeholder="Qty or blank"
          defaultValue={line.quantity === null ? "" : String(line.quantity)}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            const quantity = raw === "" ? null : Math.max(0, Math.floor(Number(raw)));
            if (raw !== "" && Number.isNaN(quantity)) return;
            if (quantity !== line.quantity) void updateStock({ ...line, quantity });
          }}
        />
      </div>
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
      <TextInput
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Good"
        aria-label="New item"
      />
      <div className="grid grid-cols-2 gap-2">
        <TextInput
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          placeholder="2 gp"
          aria-label="New price"
        />
        <TextInput
          value={qty}
          onChange={(event) => setQty(event.target.value)}
          placeholder="Qty"
          aria-label="New quantity"
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Button type="submit" variant="secondary" disabled={busy}>
        Add item
      </Button>
    </form>
  );
}

function SellBox({ shopId }: { shopId: string }) {
  const { holdings, sell, shops } = useEconomy();
  const closed = shops.find((s) => s.id === shopId)?.closed;
  const turnLocked = turnIsLocked();
  const seat = useSeat();
  const mine =
    seat.role === "player"
      ? holdings.filter((holding) => seat.purseIds.includes(holding.purseId))
      : holdings;
  const [holdingId, setHoldingId] = useState(mine[0]?.id ?? "");
  const [qty, setQty] = useState("1");
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
      className="mt-6 flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!holding || closed || turnLocked || locked || busy || eligibility) return;
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const result = await sell(holding.id, shopId, asked);
          setNotice(mutationNotice(result, "Sale recorded."));
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
      <select
        value={holdingId}
        onChange={(event) => setHoldingId(event.target.value)}
        className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
      >
        {mine.map((item) => (
          <option key={item.id} value={item.id}>
            {labelHolding(item)}
          </option>
        ))}
      </select>
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
