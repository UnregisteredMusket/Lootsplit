import { useState } from "react";
import { toast } from "sonner";
import { STARTER_COMMODITIES } from "@/lib/quire/commodity-catalog";
import { parseCommodityImport, previewCommodityImport } from "@/lib/quire/commodity-import";
import { captureMutationScope, type ExpectedMutationScope } from "@/lib/quire/cloud-client";
import { useEconomy } from "@/lib/quire/economy-context";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { formatCopper } from "@/lib/quire/money";
import { CATEGORIES, labelOf } from "@/lib/quire/labels";
import type { Commodity, TradeEconomy } from "@/lib/quire/trade-economy-schema";
import { Button, Modal } from "./ui";

export function CommodityCatalogImport({ economy }: { economy: TradeEconomy }) {
  const { commandOutcome } = useEconomy();
  const [mode, setMode] = useState<"builtin" | "file" | null>(null),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [catalogPage, setCatalogPage] = useState(0),
    [text, setText] = useState(""),
    [fileName, setFileName] = useState(""),
    [reason, setReason] = useState("Add reviewed commodity definitions"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(0);
  const [preview, setPreview] = useState<{
    rows: Commodity[];
    plan: ReturnType<typeof previewCommodityImport>;
    scope: ExpectedMutationScope;
  } | null>(null);
  const [returnFocus, setReturnFocus] = useState("[data-commodity-import-entry]");
  useDraftGuard(!!text || !!selected.length || busy, "commodity import");
  const existing = new Set(economy.commodities.map((c) => c.id));
  const filtered = STARTER_COMMODITIES.filter(
    (c) =>
      (!category || c.category === category) &&
      `${c.name} ${c.unit} ${c.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const lastCatalogPage = Math.max(0, Math.ceil(filtered.length / 12) - 1);
  const currentCatalogPage = Math.min(catalogPage, lastCatalogPage);
  function invalidate() {
    setPreview(null);
    setError("");
    setPage(0);
  }
  function review(rows?: Commodity[]) {
    invalidate();
    try {
      const imported = rows ?? parseCommodityImport(text);
      setPreview({
        rows: imported,
        plan: previewCommodityImport(economy, imported),
        scope: captureMutationScope(),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not read commodities.");
    }
  }
  async function save() {
    if (!preview || busy || !preview.plan.additions.length || !reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await commandOutcome(
        {
          kind: "trade-commodity-import",
          before: preview.plan.before,
          commodities: preview.rows,
          reason,
        },
        preview.scope,
      );
      toast.success(
        mutationNotice(result, `${preview.plan.additions.length} commodity definitions added.`),
      );
      if (mode === "file") {
        setText("");
        setFileName("");
      } else setSelected([]);
      setPreview(null);
      setMode(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not import commodities. Your draft is retained.",
      );
    } finally {
      setBusy(false);
    }
  }
  const reviewed = preview
    ? [
        ...preview.plan.additions.map((c) => ({ c, state: "Add" })),
        ...preview.plan.skipped.map((c) => ({ c, state: "Already present" })),
      ]
    : [];
  const lastPage = Math.max(0, Math.ceil(reviewed.length / 20) - 1);
  return (
    <>
      <details className="journal-entry">
        <summary>Built-in fantasy commodity catalogue · {STARTER_COMMODITIES.length} goods</summary>
        <section aria-label="Built-in commodity catalogue">
          <p className="commodity-caption">
            Original Lootsplit trade goods, including grain, metals, textiles, herbs and rare
            fantasy materials. Prices and weights are editable homebrew references. These
            definitions do not create inventory, exchange stock, funds or magical effects.
          </p>
          <div className="world-toolbar">
            <label>
              Search built-in commodities
              <input
                aria-label="Search built-in commodities"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCatalogPage(0);
                }}
              />
            </label>
            <label>
              Catalogue category
              <select
                aria-label="Catalogue category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setCatalogPage(0);
                }}
              >
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="world-toolbar">
            <Button
              variant="secondary"
              onClick={() =>
                setSelected(STARTER_COMMODITIES.filter((c) => !existing.has(c.id)).map((c) => c.id))
              }
            >
              Select all missing goods
            </Button>
            <Button variant="secondary" onClick={() => setSelected([])}>
              Clear commodity selection
            </Button>
          </div>
          <p role="status">
            {filtered.length} goods · {selected.filter((id) => !existing.has(id)).length} selected
          </p>
          <div className="commodity-catalog-list">
            {filtered.slice(currentCatalogPage * 12, (currentCatalogPage + 1) * 12).map((c) => (
              <label key={c.id} className="commodity-catalog-row">
                <input
                  type="checkbox"
                  aria-label={`Add ${c.name}`}
                  disabled={existing.has(c.id)}
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id),
                    )
                  }
                />
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {labelOf(CATEGORIES, c.category)} · {c.unit} · {c.weight} lb ·{" "}
                    {formatCopper(c.baseCopper)}
                    {existing.has(c.id) ? " · Already in campaign" : ""}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <div className="world-toolbar">
            <Button
              variant="secondary"
              disabled={!currentCatalogPage}
              onClick={() => setCatalogPage(currentCatalogPage - 1)}
            >
              Previous catalogue page
            </Button>
            <span>
              Page {currentCatalogPage + 1} of {lastCatalogPage + 1}
            </span>
            <Button
              variant="secondary"
              disabled={currentCatalogPage >= lastCatalogPage}
              onClick={() => setCatalogPage(currentCatalogPage + 1)}
            >
              Next catalogue page
            </Button>
          </div>
          <Button
            data-commodity-builtin-review
            disabled={!selected.some((id) => !existing.has(id))}
            onClick={() => {
              setReturnFocus("[data-commodity-builtin-review]");
              setMode("builtin");
              review(
                STARTER_COMMODITIES.filter((c) => selected.includes(c.id) && !existing.has(c.id)),
              );
            }}
          >
            Review selected commodities
          </Button>
        </section>
      </details>
      <div className="world-toolbar">
        <Button
          variant="secondary"
          data-commodity-import-entry
          onClick={() => {
            setReturnFocus("[data-commodity-import-entry]");
            setMode("file");
            invalidate();
          }}
        >
          Import commodities
        </Button>
        <a href="/download/fantasy-commodities.json" download>
          Download starter catalogue JSON
        </a>
        <a href="/download/commodities.sample.csv" download>
          Download CSV template
        </a>
        <a href="/download/commodities.schema.json" download>
          Download JSON schema
        </a>
      </div>
      <Modal
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setMode(null);
        }}
        title={mode === "builtin" ? "Review built-in commodities" : "Import commodities"}
        returnFocus={returnFocus}
      >
        <div className="space-y-4 commodity-import">
          {mode === "file" && (
            <>
              <p>
                Upload or paste JSON, CSV or TSV. Review up to 500 commodity definitions before
                adding them. Existing goods are preserved; conflicting keys must be renamed or
                edited separately.
              </p>
              <label>
                Commodity import file
                <input
                  type="file"
                  aria-label="Commodity import file"
                  disabled={busy}
                  accept=".json,.csv,.tsv,application/json,text/csv,text/tab-separated-values"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    invalidate();
                    setBusy(true);
                    try {
                      if (file.size > 512000)
                        throw Error("Choose a file no larger than 512,000 bytes.");
                      setText(await file.text());
                      setFileName(file.name);
                    } catch (failure) {
                      setError(failure instanceof Error ? failure.message : "Could not read file.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
              {fileName && <p>{fileName}</p>}
              <label>
                Commodity data
                <textarea
                  aria-label="Commodity data"
                  rows={8}
                  value={text}
                  disabled={busy}
                  onChange={(e) => {
                    setText(e.target.value);
                    invalidate();
                  }}
                />
              </label>
              <p className="text-sm text-muted">
                Required fields: id, name, unit, category, baseCopper (whole copper), weight (lb),
                active (JSON true/false). CSV/TSV defaults active to true. Optional description and
                reviewed materialKey. JSON accepts an array or a version 1 commodity pack.
              </p>
              <Button variant="secondary" disabled={busy || !text.trim()} onClick={() => review()}>
                Review commodity import
              </Button>
            </>
          )}
          {preview && (
            <section aria-label="Commodity import preview">
              <p role="status">
                {preview.plan.additions.length} new commodities · {preview.plan.skipped.length}{" "}
                already present
              </p>
              <ul className="commodity-import-preview">
                {reviewed.slice(page * 20, (page + 1) * 20).map(({ c, state }) => (
                  <li key={c.id}>
                    <strong>{c.name}</strong> · {state}
                    <small>
                      {c.id} · {c.unit} · {c.weight} lb · {formatCopper(c.baseCopper)} ·{" "}
                      {labelOf(CATEGORIES, c.category)} · {c.active ? "Active" : "Inactive"}
                    </small>
                    <details>
                      <summary>Definition details</summary>
                      <p>{c.description || "No description."}</p>
                      <p>Property material: {c.materialKey || "Not linked"}</p>
                    </details>
                  </li>
                ))}
              </ul>
              <div className="world-toolbar">
                <Button variant="secondary" disabled={!page} onClick={() => setPage(page - 1)}>
                  Previous import page
                </Button>
                <span>
                  Page {page + 1} of {lastPage + 1}
                </span>
                <Button
                  variant="secondary"
                  disabled={page >= lastPage}
                  onClick={() => setPage(page + 1)}
                >
                  Next import page
                </Button>
              </div>
              <p className="text-sm text-muted">
                Only commodity definitions are added. Configure actual stock, prices and treasury in
                the exchange workshop. Material links must match an existing reviewed material and
                its exact unit.
              </p>
              <label>
                Reason for commodity import
                <input
                  aria-label="Reason for commodity import"
                  maxLength={2000}
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <Button
                disabled={busy || !preview.plan.additions.length || !reason.trim()}
                onClick={save}
              >
                {busy ? "Saving…" : "Add reviewed commodities"}
              </Button>
            </section>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
