import { useEffect, useState } from "react";
import { toast } from "sonner";
import { articlesForBook } from "@/lib/quire/db";
import { useEconomy } from "@/lib/quire/economy-context";
import { useLibrary } from "@/lib/quire/library";
import { goodsFromText } from "@/lib/quire/extract";
import { formatCopper } from "@/lib/quire/money";
import { Button, TextInput } from "@/components/ui";

type Hit = { id: string; name: string; copper: number; on: boolean };

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
  }, [bookId]);

  async function scan(id: string) {
    if (!id) return;
    setBusy(true);
    try {
      const articles = await articlesForBook(id);
      const found: Hit[] = goodsFromText(articles).map((hit) => ({
        id: `${hit.name.toLowerCase()}|${hit.copper}`,
        name: hit.name,
        copper: hit.copper,
        on: true,
      }));
      setHits(found.slice(0, 80));
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
    if (chosen.length === 0) {
      toast("Select at least one price.");
      return;
    }
    setBusy(true);
    try {
      const target = shopId === "new" ? await createShop({ name: newName.trim() || "Imported shop" }) : shopId;
      const added = await stockFromPrices(
        target,
        chosen.map((hit) => ({ name: hit.name, copper: hit.copper, notes: "Read from a PDF. Check it." })),
      );
      toast.success(added === 0 ? "Those items are already in that shop." : `Added ${added} items.`);
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
          <select
            value={chosenBook}
            onChange={(event) => setChosenBook(event.target.value)}
            className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
          >
            <option value="">Choose a book</option>
            {books.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </select>
          <Button variant="secondary" disabled={!chosenBook || busy} onClick={() => void scan(chosenBook)}>
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
                  onChange={() => setHits((current) => current.map((row) => (row.id === hit.id ? { ...row, on: !row.on } : row)))}
                  className="size-5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{hit.name}</span>
                  <span className="text-sm text-muted">{formatCopper(hit.copper)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-3">
            <select
              value={shopId}
              onChange={(event) => setShopId(event.target.value)}
              className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
            >
              <option value="new">New shop</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
            {shopId === "new" ? (
              <TextInput value={newName} onChange={(event) => setNewName(event.target.value)} aria-label="New shop name" />
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
