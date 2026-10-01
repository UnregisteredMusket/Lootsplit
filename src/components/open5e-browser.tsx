import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, Select, TextInput } from "./ui";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { CATEGORIES } from "@/lib/quire/labels";
import { formatCopper, parsePrice } from "@/lib/quire/money";
import {
  OPEN5E_KINDS,
  openCatalogItem,
  type OpenEdition,
  type OpenEntry,
  type OpenKind,
  type OpenPage,
  type OpenQuery,
} from "@/lib/quire/open5e";
import { searchOpen5e } from "@/lib/quire/open5e-api";
import type { ItemCategory } from "@/lib/quire/types";
const CACHE = "lootsplit.open5e.search.v1";
type CacheRow = { key: string; at: string; data: OpenPage };
function cache(): CacheRow[] {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function Open5eBrowser() {
  const [kind, setKind] = useState<OpenKind>("items"),
    [edition, setEdition] = useState<OpenEdition>("srd-2014"),
    [query, setQuery] = useState("");
  const [result, setResult] = useState<OpenPage | null>(null),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [cached, setCached] = useState("");
  const [searched, setSearched] = useState<OpenQuery | null>(null);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function search(target = 1) {
    const q: OpenQuery = { kind, edition, query: query.trim(), page: target },
      key = JSON.stringify(q),
      id = ++request.current;
    setBusy(true);
    setError("");
    setResult(null);
    setCached("");
    setSearched(q);
    setPage(target);
    try {
      const data = await searchOpen5e({ data: q });
      if (id !== request.current) return;
      setResult(data);
      try {
        localStorage.setItem(
          CACHE,
          JSON.stringify(
            [
              { key, at: new Date().toISOString(), data },
              ...cache().filter((c) => c.key !== key),
            ].slice(0, 20),
          ),
        );
      } catch {
        setCached("Results could not be saved on this device.");
      }
    } catch (e) {
      if (id !== request.current) return;
      const saved = cache().find((c) => c.key === key);
      if (saved) {
        setResult(saved.data);
        setCached(
          `Saved results from ${new Date(saved.at).toLocaleDateString()}. Open5e is unavailable; these may be out of date.`,
        );
      } else
        setError(
          e instanceof Error
            ? e.message
            : "Could not reach Open5e. Check your connection and retry.",
        );
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void search();
  }
  const changed =
    searched &&
    (searched.kind !== kind || searched.edition !== edition || searched.query !== query.trim());
  return (
    <section className="mt-6">
      <h2 className="font-display text-2xl">Open5e reference</h2>
      <p className="mt-2 text-sm text-muted">
        Search the open rules. Review an item, set its shop price, then add a copy to your catalog.
        Imported copies stay on this device and never change automatically.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            Rules edition
            <Select value={edition} onChange={(e) => setEdition(e.target.value as OpenEdition)}>
              <option value="srd-2014">2014 · SRD 5.1</option>
              <option value="srd-2024">2024 · SRD 5.2</option>
            </Select>
          </label>
          <label className="text-sm">
            Reference section
            <Select value={kind} onChange={(e) => setKind(e.target.value as OpenKind)}>
              {OPEN5E_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <label className="text-sm">
          Search by name
          <TextInput
            maxLength={100}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Longsword, healing, invisibility…"
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? "Searching…" : "Search Open5e"}
        </Button>
      </form>
      <div aria-live="polite" className="mt-3 text-sm">
        {error ? <p role="alert">{error}</p> : null}
        {cached ? <p className="text-muted">{cached}</p> : null}
        {changed ? <p className="text-muted">Press Search to apply your new filters.</p> : null}
        {result ? (
          <p>
            {result.count} results · {searched?.edition === "srd-2014" ? "2014" : "2024"} · Page{" "}
            {page}
          </p>
        ) : null}
      </div>
      {result?.entries.length === 0 ? (
        <p className="mt-4 text-muted">
          No matching entries in this source. Try a shorter name or another section.
        </p>
      ) : null}
      <ul className="mt-4 grid gap-3">
        {result?.entries.map((entry) => (
          <OpenResult key={entry.key} entry={entry} />
        ))}
      </ul>
      {result ? (
        <div className="mt-4 flex justify-between gap-2">
          <Button
            disabled={busy || page === 1 || !!changed}
            variant="secondary"
            onClick={() => void search(page - 1)}
          >
            Previous
          </Button>
          <Button
            disabled={busy || !result.more || !!changed}
            variant="secondary"
            onClick={() => void search(page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
      <p className="mt-6 text-xs text-muted">
        Content via{" "}
        <a className="underline" href="https://open5e.com" target="_blank" rel="noreferrer">
          Open5e
        </a>
        . SRD 5.1 / 5.2 by Wizards of the Coast LLC,{" "}
        <a
          className="underline"
          href="https://www.dndbeyond.com/srd"
          target="_blank"
          rel="noreferrer"
        >
          source documents
        </a>
        ,{" "}
        <a
          className="underline"
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY 4.0
        </a>
        . Full attribution is included with each entry and import. First-time searches need
        internet; recent searches are retained when storage is available.
      </p>
    </section>
  );
}
function OpenResult({ entry }: { entry: OpenEntry }) {
  const { catalog, addGoods } = useEconomy(),
    seat = useSeat();
  const [price, setPrice] = useState(entry.copper === null ? "" : formatCopper(entry.copper)),
    [category, setCategory] = useState<ItemCategory>(entry.category),
    [saving, setSaving] = useState(false);
  const imported = catalog.some((i) => i.id === `open5e:${entry.kind}:${entry.key}`);
  const copper = parsePrice(price),
    item = ["items", "magicitems"].includes(entry.kind);
  async function add() {
    if (copper === null || saving) return;
    setSaving(true);
    try {
      const count = await addGoods([openCatalogItem(entry, copper, category)]);
      toast(
        count
          ? "Added to your catalog. Available when stocking shops."
          : "An item with this name is already in your catalog.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save this item.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <li className="rounded-lg border border-border p-4">
      <details>
        <summary className="cursor-pointer min-h-11">
          <span className="font-display text-xl">{entry.name}</span>
          <span className="mt-1 block text-xs text-muted">
            {entry.source}
            {item ? ` · ${entry.copper === null ? "Set a price" : formatCopper(entry.copper)}` : ""}
          </span>
        </summary>
        <div className="mt-3 text-sm">
          <ul className="mb-3 text-muted">
            {entry.facts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <p className="whitespace-pre-wrap break-words">
            {entry.description || "No description supplied."}
          </p>
          {item && seat.role === "dm" ? (
            <div className="mt-4 grid gap-2">
              <label>
                Catalog category
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ItemCategory)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                Shop list price
                <TextInput
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="For example, 50 gp"
                />
              </label>
              {entry.copper === null ? (
                <p className="text-xs text-muted">
                  No reliable listed price. Choose your campaign's price before importing.
                </p>
              ) : null}
              <Button disabled={imported || saving || copper === null} onClick={() => void add()}>
                {imported ? "Already in catalog" : saving ? "Saving…" : "Add to catalog"}
              </Button>
            </div>
          ) : null}
          <p className="mt-4 text-xs text-muted break-words">{entry.attribution}</p>
        </div>
      </details>
    </li>
  );
}
