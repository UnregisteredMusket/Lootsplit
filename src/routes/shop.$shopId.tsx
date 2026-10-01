import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { SHOP_KINDS, WEALTHS } from "@/lib/quire/labels";
import { charismaOffPercent, formatCopper, parsePrice, priceAfterCharisma, toCopper } from "@/lib/quire/money";
import { charismaScore } from "@/lib/quire/sheet";
import { useDollarText, usePrefs } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import { realmNote, scarcityNote } from "@/lib/quire/scale";
import { downloadShopPdf } from "@/lib/quire/shop-pdf";
import type { Holding, Shop, StockLine, Wealth } from "@/lib/quire/types";
import { Shell } from "@/components/shell";
import { RemoveButton } from "@/components/quire-ui";
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
  const spendable = seat.role === "player" ? economy.purses.filter((purse) => seat.purseIds.includes(purse.id)) : economy.purses;
  const [mode, setMode] = useState<"counter" | "edit">("counter");
  const [purseId, setPurseId] = useState(spendable.find((purse) => purse.kind === "party")?.id ?? spendable[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!spendable.some((purse) => purse.id === purseId) && spendable[0]) setPurseId(spendable[0].id);
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
        <Link to="/market" search={{ book: "" }} className="mt-4 inline-flex min-h-11 items-center text-sm">
          Back to the market
        </Link>
      </Shell>
    );
  }

  if (seat.role === "player" && !seat.shopIds.includes(shop.id)) {
    return (
      <Shell>
        <h1 className="font-display text-4xl tracking-tight">Shop not included</h1>
        <p className="mt-2 text-sm text-muted">This shop was not included in the link you opened.</p>
      </Shell>
    );
  }

  const viewing = seat.role === "player" ? "counter" : mode;

  return (
    <Shell>
      <Link to="/market" search={{ book: "" }} className="text-sm text-muted">
        Market
      </Link>
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
            onBlur={(event) => void economy.updateShop({ ...shop, keeper: event.target.value.trim() })}
          />
          <TextInput
            aria-label="Shop location"
            placeholder="Shop location"
            defaultValue={shop.place}
            key={`place-${shop.place}`}
            onBlur={(event) => void economy.updateShop({ ...shop, place: event.target.value.trim() })}
          />
          <ShelfTuning shop={shop} />
        </div>
      ) : (
        <div className="mt-2">
          <h1 className="font-display text-4xl tracking-tight">{shop.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {[shop.keeper, shop.place].filter(Boolean).join(" · ") || "No owner or location"} · sells at {Math.round(shop.sellRate * 100)}%, buys at{" "}
            {Math.round(shop.buyRate * 100)}%
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
          <p className="text-sm text-muted sm:flex-1">You can buy and sell. Only the dungeon master can change prices.</p>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            downloadShopPdf({ shop, lines, showDollars: prefs.showDollars, gpDollars: economy.realm.gpDollars });
            toast.success("Shop sheet downloaded.");
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
          {[...spendable].sort((a, b) => Number(b.kind === "party") - Number(a.kind === "party") || a.name.localeCompare(b.name)).map((purse) => (
            <option key={purse.id} value={purse.id}>
              {purse.kind === "party" ? `Party · ${purse.name}` : purse.name} · {formatCopper(toCopper(purse.coins))}
            </option>
          ))}
        </select>
        {spendable.some((purse) => purse.kind === "party") ? (
          <span className="mt-1 block">The party option spends the shared account. A character spends their own.</span>
        ) : null}
        <CharismaNote purseId={purseId} />
      </label>
      <TurnLock />
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {lines.map((line) => (
          <StockRow key={line.id} line={line} mode={viewing} purseId={purseId} sellRate={shop.sellRate} charisma={charismaScore(economy.sheets.find((sheet) => sheet.purseId === purseId))} locked={viewing === "counter" && turnIsLocked()} />
        ))}
      </ul>
      {lines.length === 0 ? <p className="mt-4 text-muted">This shop has no items.</p> : null}
      {viewing === "edit" ? <AddGood shopId={shop.id} /> : <SellBox shopId={shop.id} />}
      {viewing === "edit" ? (
        <button type="button" onClick={() => setConfirming(true)} className="mt-8 inline-flex min-h-11 items-center text-sm text-muted">
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
          void economy.deleteShop(shop.id).then(() => navigate({ to: "/market", search: { book: "" } }));
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
        onChange={(event) => void updateShop({ ...shop, category: event.target.value as Shop["category"] })}
      >
        {SHOP_KINDS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <div className="grid grid-cols-2 gap-2">
        {WEALTHS.map((option) => (
          <Button
            key={option.value}
            variant={shop.wealth === option.value ? "primary" : "secondary"}
            onClick={() => void applyShop({ ...shop, wealth: option.value as Wealth, priceScale: scale, sellRate: sell, buyRate: buy })}
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
        onCommit={(value) => void applyShop({ ...shop, priceScale: value, sellRate: sell, buyRate: buy })}
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
        {realmNote(realm, { dollars: prefs.showDollars })} {scarcityNote(realm.scarcity)} Updating prices uses the modifiers above. Dollars are a comparison for one gold piece, not a second price.
      </p>
    </div>
  );
}

function turnIsLocked() {
  const table = getCloudTable();
  return table.joined && !table.live && !table.mine;
}

function TurnLock() {
  const table = useSyncExternalStore(subscribeCloudTable, getCloudTable, getCloudTable);
  if (!table.joined || table.live || table.mine) return null;
  return <p className="mt-3 text-sm text-muted">It is {table.who}'s turn. Buying waits.</p>;
}

function CharismaNote({ purseId }: { purseId: string }) {
  const { sheets, purses } = useEconomy();
  const purse = purses.find((item) => item.id === purseId);
  if (!purse || purse.kind !== "character") return <span className="mt-1 block">The party fund pays the listed price.</span>;
  const score = charismaScore(sheets.find((sheet) => sheet.purseId === purseId));
  if (score === null) return <span className="mt-1 block">Import this character's 2014 sheet to take the Charisma discount.</span>;
  const percent = charismaOffPercent(score);
  if (percent <= 0) return <span className="mt-1 block">Charisma {score} pays the listed price.</span>;
  return <span className="mt-1 block">Charisma {score} takes {percent}% off every purchase.</span>;
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
  const { buy, updateStock, deleteStock } = useEconomy();
  const dollars = useDollarText();
  const [qty, setQty] = useState("1");
  const asked = Math.max(1, Math.floor(Number(qty) || 1));
  const asking = Math.round(line.copper * sellRate);
  const percent = charisma === null ? 0 : charismaOffPercent(charisma);
  const unit = priceAfterCharisma(asking, charisma);
  const price = unit * asked;
  const reduced = unit !== asking;

  if (mode === "counter") {
    return (
      <li className="flex flex-wrap items-center gap-3 py-3">
        <span className="min-w-0 flex-1">
          <span className="block">{line.name}</span>
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
          disabled={locked || !purseId || (line.quantity !== null && line.quantity < 1)}
          onClick={() => void buy(line.id, purseId, asked)}
        >
          Buy {formatCopper(price)}
        </Button>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 py-3">
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

  return (
    <form
      className="mt-4 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const copper = parsePrice(price);
        if (!name.trim() || copper === null) return;
        const quantity = qty.trim() === "" ? null : Math.max(0, Math.floor(Number(qty)));
        void addStock(shopId, name.trim(), copper, quantity);
        setName("");
        setPrice("");
        setQty("");
      }}
    >
      <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Good" aria-label="New item" />
      <div className="grid grid-cols-2 gap-2">
        <TextInput value={price} onChange={(event) => setPrice(event.target.value)} placeholder="2 gp" aria-label="New price" />
        <TextInput value={qty} onChange={(event) => setQty(event.target.value)} placeholder="Qty" aria-label="New quantity" />
      </div>
      <Button type="submit" variant="secondary">
        Add item
      </Button>
    </form>
  );
}

function SellBox({ shopId }: { shopId: string }) {
  const { holdings, sell } = useEconomy();
  const seat = useSeat();
  const mine = seat.role === "player" ? holdings.filter((holding) => seat.purseIds.includes(holding.purseId)) : holdings;
  const [holdingId, setHoldingId] = useState(mine[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const holding = mine.find((item) => item.id === holdingId);

  useEffect(() => {
    if (!mine.some((item) => item.id === holdingId) && mine[0]) setHoldingId(mine[0].id);
  }, [holdingId, mine]);

  if (mine.length === 0) return <p className="mt-6 text-sm text-muted">This account has nothing this shop will buy.</p>;

  return (
    <form
      className="mt-6 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!holding) return;
        void sell(holding.id, shopId, Math.max(1, Math.floor(Number(qty) || 1)));
      }}
    >
      <p className="text-sm text-muted">Sell to this shop</p>
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
        <TextInput value={qty} onChange={(event) => setQty(event.target.value)} aria-label="Quantity to sell" className="w-24" />
        <Button type="submit" variant="secondary">
          Sell
        </Button>
      </div>
    </form>
  );
}

function labelHolding(holding: Holding) {
  return `${holding.name} × ${holding.quantity}`;
}
