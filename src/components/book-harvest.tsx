import { SearchSelect } from "@/components/search-select";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { articlesForBook } from "@/lib/quire/db";
import { useEconomy } from "@/lib/quire/economy-context";
import { extractLexemes, goodsFromText, type GoodHit, type LexemeHit } from "@/lib/quire/extract";
import { LEXEME_KINDS } from "@/lib/quire/labels";
import { useLibrary } from "@/lib/quire/library";
import { formatCopper, parsePrice } from "@/lib/quire/money";
import type { LexemeKind } from "@/lib/quire/types";
import { Button, Select, TextInput } from "@/components/ui";

type NameRow = LexemeHit & { on: boolean };
type GoodRow = GoodHit & { on: boolean; priceText: string };

export function BookHarvest() {
  const { books } = useLibrary();
  const { addGoods, addNames } = useEconomy();
  const [bookId, setBookId] = useState("");
  const [names, setNames] = useState<NameRow[]>([]);
  const [goods, setGoods] = useState<GoodRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);

  async function scan() {
    if (!bookId) return;
    setBusy(true);
    try {
      const articles = await articlesForBook(bookId);
      setNames(extractLexemes(articles).map((hit) => ({ ...hit, on: true })));
      setGoods(
        goodsFromText(articles).map((hit) => ({
          ...hit,
          on: !hit.conflict,
          priceText: formatCopper(hit.copper),
        })),
      );
      setScanned(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That book could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function fileNames() {
    const chosen = names.filter((row) => row.on);
    if (chosen.length === 0) {
      toast("Select at least one name.");
      return;
    }
    setBusy(true);
    try {
      const added = await addNames(
        chosen.map((row) => ({ name: row.name, kind: row.kind, bookId, notes: row.notes })),
      );
      toast.success(added === 0 ? "Those names are already saved." : `Saved ${added} names.`);
    } finally {
      setBusy(false);
    }
  }

  async function fileGoods() {
    const chosen = goods.filter((row) => row.on);
    if (chosen.some((row) => !row.name.trim() || parsePrice(row.priceText) === null)) {
      toast.error("Check the selected item names and prices.");
      return;
    }
    if (chosen.length === 0) {
      toast("Select at least one item.");
      return;
    }
    setBusy(true);
    try {
      const added = await addGoods(
        chosen.map((row) => ({
          id: crypto.randomUUID(),
          name: row.name,
          category: row.category,
          rarity: row.rarity,
          baseCopper: parsePrice(row.priceText)!,
          notes: `Read from ${books.find((b) => b.id === bookId)?.title ?? "a PDF"}. ${row.source}\n${row.quote}`,
          origin: "pdf" as const,
          service: false,
        })),
      );
      toast.success(
        added === 0 ? "Those items are already in the catalog." : `Added ${added} items.`,
      );
    } finally {
      setBusy(false);
    }
  }

  if (books.length === 0) {
    return <p className="mt-4 text-sm text-muted">Import a PDF from Books first.</p>;
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-sm text-muted">
        Review detected names and items before saving. Conflicting prices start unselected.
        Re-import older PDFs to use the improved line reader. Up to 200 item candidates are shown.
      </p>
      <SearchSelect
        aria-label="Book"
        value={bookId}
        disabled={busy}
        onValueChange={(selectedValue) => {
          setBookId(selectedValue);
          setScanned(false);
          setNames([]);
          setGoods([]);
        }}
      >
        <option value="">Choose a book</option>
        {books.map((book) => (
          <option key={book.id} value={book.id}>
            {book.title}
          </option>
        ))}
      </SearchSelect>
      <Button variant="secondary" disabled={!bookId || busy} onClick={() => void scan()}>
        {busy ? "Reading…" : "Read this book"}
      </Button>
      {scanned ? (
        <>
          <HarvestBlock title="Names and places" empty="No names were found. Add them yourself.">
            {names.map((row, index) => (
              <li key={`${row.kind}-${row.name}`} className="flex items-center gap-2 py-2">
                <input
                  type="checkbox"
                  className="size-5 accent-accent"
                  aria-label={`Include ${row.name}`}
                  checked={row.on}
                  onChange={() =>
                    setNames((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, on: !item.on } : item,
                      ),
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block">{row.name}</span>
                  <span className="block text-xs text-muted">{row.notes}</span>
                </span>
                <Select
                  aria-label={`Kind of ${row.name}`}
                  value={row.kind}
                  className="w-32 shrink-0"
                  onChange={(event) =>
                    setNames((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, kind: event.target.value as LexemeKind }
                          : item,
                      ),
                    )
                  }
                >
                  {LEXEME_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </HarvestBlock>
          {names.length > 0 ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void fileNames().catch((e) =>
                  toast.error(e instanceof Error ? e.message : "Could not save names."),
                )
              }
            >
              Save selected names
            </Button>
          ) : null}
          <HarvestBlock title="Items with detected prices" empty="No printed prices in that book.">
            {goods.map((row, index) => (
              <li key={index} className="flex items-start gap-3 py-3">
                <input
                  type="checkbox"
                  className="size-5 accent-accent"
                  aria-label={`Include ${row.name}`}
                  checked={row.on}
                  onChange={() =>
                    setGoods((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, on: !item.on } : item,
                      ),
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <TextInput
                    aria-label={`Item name ${index + 1}`}
                    value={row.name}
                    onChange={(e) =>
                      setGoods((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, name: e.target.value } : item,
                        ),
                      )
                    }
                  />
                  <TextInput
                    className="mt-2"
                    aria-label={`Price of item ${index + 1}`}
                    value={row.priceText}
                    onChange={(e) =>
                      setGoods((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, priceText: e.target.value } : item,
                        ),
                      )
                    }
                  />
                  <span className="mt-2 block text-xs text-muted">{row.source}</span>
                  <span className="block whitespace-pre-wrap text-sm text-muted">{row.quote}</span>
                  {row.conflict ? (
                    <span className="block text-sm text-accent">
                      Different prices found for this name. Choose the correct entry.
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </HarvestBlock>
          {goods.length > 0 ? (
            <Button
              disabled={busy}
              onClick={() =>
                void fileGoods().catch((e) =>
                  toast.error(e instanceof Error ? e.message : "Could not save items."),
                )
              }
            >
              Add selected items to catalog
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function HarvestBlock({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const list = Array.isArray(children) ? children : [];
  return (
    <div>
      <h3 className="font-display text-xl tracking-tight">{title}</h3>
      {list.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border border-y border-border">{children}</ul>
      )}
    </div>
  );
}
