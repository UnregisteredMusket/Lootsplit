import { FantasyIcon } from "@/components/fantasy-icon";
import { createFileRoute } from "@tanstack/react-router";
import { Dices } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Open5eBrowser } from "@/components/open5e-browser";
import { NameGenerator } from "@/components/name-generator";
import { BookHarvest } from "@/components/book-harvest";
import { RemoveButton } from "@/components/quire-ui";
import { Shell } from "@/components/shell";
import { Button, Segmented, Select, TextInput } from "@/components/ui";
import { useEconomy } from "@/lib/quire/economy-context";
import { CATEGORIES, LEXEME_KINDS, RARITIES, labelOf } from "@/lib/quire/labels";
import { formatCopper, parsePrice } from "@/lib/quire/money";
import { useDollarText, usePrefs } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import { randomPerson, randomPlace, randomShopTitle } from "@/lib/quire/names";
import type { CatalogItem, ItemCategory, ItemRarity, LexemeKind } from "@/lib/quire/types";

export const Route = createFileRoute("/catalog")({
  component: CatalogPage,
});

type Pane = "goods" | "names" | "book" | "open5e";

function CatalogPage() {
  const seat = useSeat();
  const [pane, setPane] = useState<Pane>(seat.role === "player" ? "open5e" : "goods");
  useEffect(() => {
    const p = new URLSearchParams(location.search).get("pane");
    if (["goods", "names", "book", "open5e"].includes(p || "")) setPane(p as Pane);
  }, []);
  const dm = seat.role === "dm";
  const activePane = !dm && (pane === "goods" || pane === "book") ? "open5e" : pane;
  return (
    <Shell>
      <h1 className="font-display text-4xl tracking-tight">Catalog</h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Your item collection, open rules, and names for your world.
      </p>
      <div className="mt-4">
        <Segmented
          label="Catalog section"
          value={activePane}
          onChange={setPane}
          options={[
            ...(dm ? [{ value: "goods" as Pane, label: "Items" }] : []),
            { value: "open5e", label: "Open5e" },
            { value: "names", label: "Names" },
            ...(dm ? [{ value: "book" as Pane, label: "Book" }] : []),
          ]}
        />
      </div>
      {activePane === "goods" && dm ? <GoodsPane /> : null}
      {activePane === "names" ? (
        dm ? (
          <NamesPane />
        ) : (
          <div className="mt-6">
            <NameGenerator />
          </div>
        )
      ) : null}
      {activePane === "open5e" ? <Open5eBrowser /> : null}
      {activePane === "book" && dm ? <BookHarvest /> : null}
    </Shell>
  );
}

function GoodsPane() {
  const { ready, catalog, saveGood, deleteGood, addGoods, invent, restoreGoods } = useEconomy();
  const { prefs, ready: prefsReady } = usePrefs();
  const dollars = useDollarText();
  const seeded = useRef(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ItemCategory | "all">("all");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [rarity, setRarity] = useState<ItemRarity>("common");
  const [kind, setKind] = useState<ItemCategory>("general");
  const [inventCategory, setInventCategory] = useState<ItemCategory>("general");
  const [count, setCount] = useState(4);
  const [flags, setFlags] = useState({
    common: true,
    uncommon: false,
    rare: false,
    magic: false,
  });

  useEffect(() => {
    if (!prefsReady || seeded.current) return;
    seeded.current = true;
    setFlags({
      common: prefs.carryCommon,
      uncommon: prefs.carryUncommon,
      rare: prefs.carryRare,
      magic: prefs.carryMagic,
    });
    setCount(prefs.inventCount);
  }, [prefs, prefsReady]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!needle) return true;
      return item.name.toLowerCase().includes(needle);
    });
  }, [catalog, query, category]);

  function add(event: FormEvent) {
    event.preventDefault();
    const copper = parsePrice(price);
    if (!name.trim() || copper === null) return;
    const item: CatalogItem = {
      id: crypto.randomUUID(),
      name: name.trim(),
      category: kind,
      rarity,
      baseCopper: copper,
      notes: "",
      origin: "hand",
      service: false,
    };
    void addGoods([item]).then((added) => {
      if (added > 0) {
        setName("");
        setPrice("");
      }
    });
  }

  return (
    <div className="mt-6">
      {!ready ? <p className="text-muted">Opening the catalog…</p> : null}
      <form className="flex flex-col gap-2" onSubmit={add}>
        <TextInput
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New item"
          aria-label="New item"
        />
        <div className="grid grid-cols-2 gap-2">
          <TextInput
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="List price, 2 gp"
            aria-label="List price"
          />
          <Select
            aria-label="Category"
            value={kind}
            onChange={(event) => setKind(event.target.value as ItemCategory)}
          >
            {CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <Select
          aria-label="Rarity"
          value={rarity}
          onChange={(event) => setRarity(event.target.value as ItemRarity)}
        >
          {RARITIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Add to the catalog
        </Button>
      </form>
      <div className="mt-8 rounded-lg border border-border p-4">
        <h2 className="font-display text-2xl tracking-tight">Generate items</h2>
        <p className="mt-2 text-sm text-muted">
          Generated items with list prices. No PDF required.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <Select
            aria-label="Generated category"
            value={inventCategory}
            onChange={(event) => setInventCategory(event.target.value as ItemCategory)}
          >
            {CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            {RARITIES.map((option) => (
              <label key={option.value} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-accent"
                  checked={flags[option.value]}
                  onChange={() =>
                    setFlags((current) => ({
                      ...current,
                      [option.value]: !current[option.value],
                    }))
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
          <label className="text-sm text-muted">
            How many
            <input
              inputMode="numeric"
              value={count}
              onChange={(event) =>
                setCount(Math.min(12, Math.max(1, Math.floor(Number(event.target.value) || 1))))
              }
              className="mt-1 min-h-11 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg"
            />
          </label>
          <Button onClick={() => void invent(inventCategory, flags, count)}>Generate</Button>
        </div>
      </div>
      <div className="mt-8 grid gap-2 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find an item"
          aria-label="Find an item"
        />
        <Select
          aria-label="Filter category"
          value={category}
          onChange={(event) => setCategory(event.target.value as ItemCategory | "all")}
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <p className="mt-3 text-sm text-muted">{shown.length} shown</p>
      <ul className="mt-2 border-y border-border lg:grid lg:grid-cols-2 lg:gap-x-8 lg:border-y-0">
        {shown.map((item) => (
          <li key={item.id} className="border-b border-border py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="block">
                  <FantasyIcon entry={item} className="fantasy-inline" />
                  {item.name}
                </span>
                <span className="text-sm text-muted">
                  <FantasyIcon
                    entry={{ category: item.category }}
                    categoryOnly
                    size={20}
                    className="fantasy-inline"
                  />
                  {labelOf(CATEGORIES, item.category)} · {item.rarity}
                  {dollars(item.baseCopper) ? ` · ${dollars(item.baseCopper)}` : ""}
                  {item.origin === "pdf"
                    ? " · from a book"
                    : item.origin === "open5e"
                      ? " · Open5e"
                      : ""}
                </span>
              </span>
            </div>
            {item.origin === "open5e" ? (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer min-h-8 text-muted">
                  Description & source
                </summary>
                <p className="whitespace-pre-wrap break-words">{item.notes}</p>
              </details>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              <TextInput
                aria-label={`List price of ${item.name}`}
                defaultValue={formatCopper(item.baseCopper)}
                key={`${item.id}-${item.baseCopper}`}
                onBlur={(event) => {
                  const copper = parsePrice(event.target.value);
                  if (copper !== null && copper !== item.baseCopper)
                    void saveGood({ ...item, baseCopper: copper });
                }}
              />
              <RemoveButton
                className="shrink-0"
                label="Remove"
                title={`Remove ${item.name}?`}
                body="This removes it from the catalog. Shops that already stock it keep it until you edit them."
                onRemove={() => void deleteGood(item.id)}
              />
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-4 text-sm text-muted" onClick={() => void restoreGoods()}>
        Restore starter items
      </button>
    </div>
  );
}

function NamesPane() {
  const { lexicon, addNames, deleteName } = useEconomy();
  const [kind, setKind] = useState<LexemeKind | "all">("all");
  const [name, setName] = useState("");
  const [addKind, setAddKind] = useState<LexemeKind>("person");
  const shown = lexicon.filter((row) => kind === "all" || row.kind === kind);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    void addNames([{ name: name.trim(), kind: addKind, bookId: "", notes: "" }]).then(() =>
      setName(""),
    );
  }

  function roll() {
    if (addKind === "person") setName(randomPerson());
    else if (addKind === "shop") setName(randomShopTitle("mixed", "", Math.random));
    else setName(randomPlace());
  }

  return (
    <div className="mt-6">
      <NameGenerator />
      <h2 className="mb-3 font-display text-2xl">Saved names</h2>
      <form className="flex flex-col gap-2" onSubmit={save}>
        <div className="flex gap-2">
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            aria-label="Name"
          />
          <Button
            type="button"
            variant="secondary"
            className="shrink-0 px-3"
            aria-label="Randomize name"
            onClick={roll}
          >
            <Dices className="size-4" />
          </Button>
        </div>
        <Select
          aria-label="Name kind"
          value={addKind}
          onChange={(event) => setAddKind(event.target.value as LexemeKind)}
        >
          {LEXEME_KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Save name
        </Button>
      </form>
      <div className="mt-6">
        <Select
          aria-label="Filter names"
          value={kind}
          onChange={(event) => setKind(event.target.value as LexemeKind | "all")}
        >
          <option value="all">All kinds</option>
          {LEXEME_KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      {shown.length === 0 ? (
        <p className="mt-4 text-muted">
          No names yet. Use the dice button, or import them from a PDF.
        </p>
      ) : null}
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {shown.map((row) => (
          <li key={row.id} className="flex items-baseline justify-between gap-3 py-3">
            <span>
              <span className="block">{row.name}</span>
              <span className="text-sm text-muted">{labelOf(LEXEME_KINDS, row.kind)}</span>
            </span>
            <RemoveButton
              label="Remove"
              title={`Remove ${row.name}?`}
              body="The name is removed from the list. Shops that already use it are not renamed."
              onRemove={() => void deleteName(row.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
