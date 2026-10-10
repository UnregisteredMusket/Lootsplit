import { SearchSelect } from "@/components/search-select";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { articlesForBook } from "@/lib/quire/db";
import { useEconomy } from "@/lib/quire/economy-context";
import { useLibrary } from "@/lib/quire/library";
import { goodsFromText, type GoodHit } from "@/lib/quire/extract";
import { formatCopper, parsePrice } from "@/lib/quire/money";
import { Button, TextInput } from "@/components/ui";

type Hit = GoodHit & { id: string; on: boolean; priceText: string };

export function PriceHarvest({ bookId }: { bookId: string }) {
  const { books } = useLibrary();
  const { shops, createShop, stockFromPrices } = useEconomy();
  const [chosenBook, setChosenBook] = useState(bookId);
  const [hits, setHits] = useState<Hit[]>([]);
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shopId, setShopId] = useState(shops[0]?.id ?? "new");
  const [newName, setNewName] = useState("Imported shop");

  useEffect(() => {
    setChosenBook(bookId);
    setHits([]);
    setScanned(false);
  }, [bookId]);

  async function scan(id: string) {
    if (!id) return;
    setBusy(true);
    try {
      const articles = await articlesForBook(id);
      const found: Hit[] = goodsFromText(articles).map((hit) => ({
        ...hit,
        id: `${hit.name.toLowerCase()}|${hit.copper}`,
        name: hit.name,
        copper: hit.copper,
        on: !hit.conflict,
        priceText: formatCopper(hit.copper),
      }));
      setHits(found);
      setScanned(true);
      if (found.length === 0) toast("No printed prices in that book. Add items by hand instead.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That book could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function file() {
    const chosen = hits.filter((hit) => hit.on);
    if (chosen.some((hit) => !hit.name.trim() || parsePrice(hit.priceText) === null)) {
      toast.error("Check selected item names and prices.");
      return;
    }
    if (chosen.length === 0) {
      toast("Select at least one price.");
      return;
    }
    setBusy(true);
    try {
      const target =
        shopId === "new" ? await createShop({ name: newName.trim() || "Imported shop" }) : shopId;
      const added = await stockFromPrices(
        target,
        chosen.map((hit) => ({
          name: hit.name.trim(),
          copper: parsePrice(hit.priceText)!,
          notes: `Read from ${books.find((b) => b.id === chosenBook)?.title ?? "a PDF"}. ${hit.source}\n${hit.quote}`,
        })),
      );
      toast.success(
        added === 0 ? "Those items are already in that shop." : `Added ${added} items.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add those items.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl tracking-tight">Prices from a book</h2>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Printed prices that look like items. You choose what to add to the shop.
      </p>
      {books.length === 0 ? (
        <p className="mt-4 text-muted">Import a PDF from Books first.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <SearchSelect
            value={chosenBook}
            disabled={busy}
            onValueChange={(selectedValue) => {
              setChosenBook(selectedValue);
              setHits([]);
              setScanned(false);
            }}
            className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
          >
            <option value="">Choose a book</option>
            {books.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </SearchSelect>
          <Button
            variant="secondary"
            disabled={!chosenBook || busy}
            onClick={() => void scan(chosenBook)}
          >
            {busy ? "Reading…" : "Find prices"}
          </Button>
        </div>
      )}
      {scanned && hits.length > 0 ? (
        <div className="mt-4">
          <ul className="divide-y divide-border border-y border-border">
            {hits.map((hit) => (
              <li key={hit.id} className="flex items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={hit.on}
                  onChange={() =>
                    setHits((current) =>
                      current.map((row) => (row.id === hit.id ? { ...row, on: !row.on } : row)),
                    )
                  }
                  className="size-5"
                />
                <span className="min-w-0 flex-1">
                  <TextInput
                    aria-label={`Name of ${hit.name}`}
                    value={hit.name}
                    onChange={(e) =>
                      setHits((rows) =>
                        rows.map((row) =>
                          row.id === hit.id ? { ...row, name: e.target.value } : row,
                        ),
                      )
                    }
                  />
                  <TextInput
                    className="mt-2"
                    aria-label={`Price of ${hit.name}`}
                    value={hit.priceText}
                    onChange={(e) =>
                      setHits((rows) =>
                        rows.map((row) =>
                          row.id === hit.id ? { ...row, priceText: e.target.value } : row,
                        ),
                      )
                    }
                  />
                  <span className="mt-2 block text-xs text-muted">{hit.source}</span>
                  <span className="block text-sm text-muted">{hit.quote}</span>
                  {hit.conflict ? (
                    <span className="block text-sm text-accent">
                      Conflicting prices. Choose the correct entry.
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-3">
            <SearchSelect
              value={shopId}
              onValueChange={(selectedValue) => setShopId(selectedValue)}
              className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
            >
              <option value="new">New shop</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </SearchSelect>
            {shopId === "new" ? (
              <TextInput
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                aria-label="New shop name"
              />
            ) : null}
            <Button disabled={busy} onClick={() => void file()}>
              Add selected items to shop
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
