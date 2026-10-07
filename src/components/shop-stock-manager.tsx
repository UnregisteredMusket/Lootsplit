import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Select, TextInput } from "./ui";
import { useEconomy } from "@/lib/quire/economy-context";
import { catalogStockDraft } from "@/lib/quire/compose";
import { CATEGORIES, RARITIES } from "@/lib/quire/labels";
import { formatCopper } from "@/lib/quire/money";
import type { Shop, StockLine } from "@/lib/quire/types";

const PAGE_SIZE = 25;

export function StockPages({
  page,
  count,
  onChange,
  label,
}: {
  page: number;
  count: number;
  onChange: (page: number) => void;
  label: string;
}) {
  if (count <= PAGE_SIZE) return null;
  return (
    <nav aria-label={label} className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <Button variant="secondary" disabled={page === 0} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <span className="text-sm text-muted">
        {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, count)} of {count}
      </span>
      <Button
        variant="secondary"
        disabled={(page + 1) * PAGE_SIZE >= count}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

export function ShopStockList({
  lines,
  renderRow,
}: {
  lines: StockLine[];
  renderRow: (line: StockLine) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [rarity, setRarity] = useState("all");
  const [page, setPage] = useState(0);
  const filtered = useMemo(
    () =>
      lines
        .filter(
          (line) =>
            (!query.trim() ||
              `${line.name} ${line.notes} ${line.category || ""}`
                .toLowerCase()
                .includes(query.trim().toLowerCase())) &&
            (rarity === "all" || line.rarity === rarity) &&
            (status === "all" ||
              (status === "sold-out"
                ? line.quantity === 0
                : status === "unlimited"
                  ? line.quantity === null
                  : line.quantity === null || line.quantity > 0)),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [lines, query, rarity, status],
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const totals = [
    ["Item types", lines.length],
    ["Units on hand", lines.reduce((n, line) => n + (line.quantity ?? 0), 0)],
    ["Unlimited lines", lines.filter((line) => line.quantity === null).length],
    ["Sold out", lines.filter((line) => line.quantity === 0).length],
  ] as const;
  return (
    <section className="mt-6" aria-label="Shop inventory">
      <dl className="flex gap-2 overflow-x-auto pb-2" aria-label="Shop inventory totals">
        {totals.map(([label, value]) => (
          <div
            key={label}
            className="min-w-32 flex-1 rounded-sm border border-border bg-subtle p-3"
          >
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1 font-display text-2xl tabular-nums">{value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <h2 className="mt-3 font-display text-2xl">Shop inventory</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <TextInput
          aria-label="Search shop inventory"
          placeholder="Search items, categories or notes"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
        <Select
          aria-label="Inventory stock filter"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(0);
          }}
        >
          <option value="all">All stock</option>
          <option value="available">In stock</option>
          <option value="sold-out">Sold out</option>
          <option value="unlimited">Unlimited</option>
        </Select>
        <Select
          aria-label="Inventory rarity filter"
          value={rarity}
          onChange={(event) => {
            setRarity(event.target.value);
            setPage(0);
          }}
        >
          <option value="all">All rarities</option>
          {RARITIES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      <p className="mt-2 text-sm text-muted" role="status">
        {filtered.length} of {lines.length} item types match. All stock is retained across pages.
      </p>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(renderRow)}
      </ul>
      {filtered.length === 0 ? (
        <p className="mt-3 text-muted">
          {lines.length ? "No items match these filters." : "This shop has no items."}
        </p>
      ) : null}
      <StockPages
        page={currentPage}
        count={filtered.length}
        onChange={setPage}
        label="Shop inventory pages"
      />
    </section>
  );
}

export function CatalogStockPicker({ shop }: { shop: Shop }) {
  const { catalog, stock, realm, addCatalogStock } = useEconomy();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [rarity, setRarity] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [quantity, setQuantity] = useState("1");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const names = new Set(
    stock.filter((line) => line.shopId === shop.id).map((line) => line.name.trim().toLowerCase()),
  );
  const matches = catalog
    .filter(
      (item) =>
        (category === "all" || item.category === category) &&
        (rarity === "all" || item.rarity === rarity) &&
        (!query.trim() ||
          `${item.name} ${item.notes}`.toLowerCase().includes(query.trim().toLowerCase())),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const available = matches.filter((item) => !names.has(item.name.trim().toLowerCase()));
  const chosen = catalog.filter(
    (item) => selected.has(item.id) && !names.has(item.name.trim().toLowerCase()),
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1));

  async function add() {
    const units = quantity.trim() === "" ? null : Number(quantity);
    if (units !== null && (!Number.isSafeInteger(units) || units < 0)) {
      setError("Enter a whole quantity of zero or more, or leave it blank for unlimited stock.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const added = await addCatalogStock(
        shop.id,
        chosen.map((item) => catalogStockDraft(item, shop, realm, units)),
      );
      toast.success(`${added} catalog item${added === 1 ? "" : "s"} added. Existing stock kept.`);
      setSelected(new Set());
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Stock could not be saved. Your selection is retained.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-4 rounded-lg border border-border p-4">
      <summary className="min-h-11 cursor-pointer font-display text-xl">Add from catalog</summary>
      <p className="mt-2 text-sm text-muted">
        Select exact items or add every matching item. New prices use this shop’s wealth and
        economic settings. Existing items are kept with their current prices and quantities.
      </p>
      <fieldset disabled={busy} className="mt-3">
        <legend className="sr-only">Catalog stock selection</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <TextInput
            aria-label="Search catalog for stock"
            placeholder="Search catalog"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
          <Select
            aria-label="Catalog stock category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Catalog stock rarity"
            value={rarity}
            onChange={(event) => {
              setRarity(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All rarities</option>
            {RARITIES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!available.length}
            onClick={() =>
              setSelected((current) => new Set([...current, ...available.map((item) => item.id)]))
            }
          >
            Select all {available.length} matching {available.length === 1 ? "item" : "items"}
          </Button>
          <Button variant="ghost" disabled={!selected.size} onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((item) => {
            const stocked = names.has(item.name.trim().toLowerCase());
            const draft = catalogStockDraft(item, shop, realm, 1);
            return (
              <li key={item.id}>
                <label className="flex min-h-14 items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-accent"
                    aria-label={`Stock ${item.name}`}
                    disabled={stocked}
                    checked={stocked || selected.has(item.id)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{item.name}</span>
                    <span className="text-sm text-muted">
                      {item.rarity} · {formatCopper(draft.copper)} base shop price
                      {stocked ? " · Already stocked" : item.service ? " · Service, unlimited" : ""}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {!matches.length ? (
          <p className="mt-2 text-sm text-muted">
            No catalog items match. Add custom items to the catalog or change these filters.
          </p>
        ) : null}
        <StockPages
          page={currentPage}
          count={matches.length}
          onChange={setPage}
          label="Catalog stock pages"
        />
        <label className="mt-4 block text-sm">
          Quantity for new items
          <TextInput
            className="mt-1"
            aria-label="Catalog stock quantity"
            inputMode="numeric"
            value={quantity}
            placeholder="Blank for unlimited"
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <p className="mt-1 text-sm text-muted">
          Blank means unlimited. Services are always unlimited. Selection is retained when you
          change filters.
        </p>
        <p className="mt-2 text-sm" role="status">
          {chosen.length} item types selected
        </p>
        {error ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="mt-3" disabled={!chosen.length || busy} onClick={() => void add()}>
          {busy
            ? "Saving stock…"
            : `Add ${chosen.length} selected ${chosen.length === 1 ? "item" : "items"}`}
        </Button>
      </fieldset>
    </details>
  );
}
