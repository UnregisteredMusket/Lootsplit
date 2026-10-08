import { useState } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { captureMutationScope, type ExpectedMutationScope } from "@/lib/quire/cloud-client";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import {
  IMPORT_NAME_KINDS,
  parseMarketNames,
  previewMarketNames,
  type ImportNameKind,
  type MarketNameRow,
} from "@/lib/quire/market-name-import";
import { locationLabel, type MarketLocations } from "@/lib/quire/shop-locations";
import type { Shop } from "@/lib/quire/types";
import { Button, Modal, Select } from "./ui";

export function MarketNameImport({
  market,
  shops,
  disabled,
}: {
  market: MarketLocations;
  shops: Shop[];
  disabled?: boolean;
}) {
  const { commandOutcome } = useEconomy();
  const [open, setOpen] = useState(false),
    [text, setText] = useState("");
  const [kind, setKind] = useState<ImportNameKind>("region"),
    [parentId, setParentId] = useState("");
  const [format, setFormat] = useState("auto"),
    [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(0);
  const [preview, setPreview] = useState<{
    plan: ReturnType<typeof previewMarketNames>;
    rows: MarketNameRow[];
    scope: ExpectedMutationScope;
  } | null>(null);
  useDraftGuard(!!text || busy, "name import");
  const parents = market.locations.filter((location) =>
    kind === "area"
      ? ["city", "town"].includes(location.kind)
      : kind === "shop"
        ? true
        : location.kind === "region",
  );
  function invalidate() {
    setPreview(null);
    setError("");
    setPage(0);
  }
  function review() {
    invalidate();
    try {
      const rows = parseMarketNames(
        text,
        kind,
        kind === "region" ? null : parentId || null,
        format,
      );
      setPreview({
        rows,
        plan: previewMarketNames(market, shops, rows, crypto.randomUUID()),
        scope: captureMutationScope(),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not read the names.");
    }
  }
  async function save() {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await commandOutcome(
        { kind: "market-name-import", before: preview.plan.before, rows: preview.rows },
        preview.scope,
      );
      toast.success(
        mutationNotice(
          result,
          `${preview.plan.locations.length} locations and ${preview.plan.shops.length} shops imported.`,
        ),
      );
      setText("");
      setFileName("");
      setFormat("auto");
      setPreview(null);
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not import the names.");
    } finally {
      setBusy(false);
    }
  }
  const count = preview ? preview.plan.locations.length + preview.plan.shops.length : 0;
  return (
    <>
      <Button
        variant="secondary"
        data-name-import-entry
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Import names
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
        title="Import location and shop names"
        returnFocus="[data-name-import-entry]"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Paste one name per line, or upload TXT, CSV, TSV or JSON. Review up to 500 rows before
            adding them to this campaign.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Name type for a simple list
              <Select
                aria-label="Imported name type"
                value={kind}
                disabled={busy}
                onChange={(event) => {
                  setKind(event.target.value as ImportNameKind);
                  setParentId("");
                  invalidate();
                }}
              >
                {IMPORT_NAME_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {value[0].toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </Select>
            </label>
            {kind !== "region" ? (
              <label className="text-sm">
                Location for a simple list
                <Select
                  aria-label="Import parent location"
                  value={parentId}
                  disabled={busy}
                  onChange={(event) => {
                    setParentId(event.target.value);
                    invalidate();
                  }}
                >
                  <option value="">
                    {kind === "shop"
                      ? "Campaignwide"
                      : `Choose a ${kind === "area" ? "city or town" : "region"}`}
                  </option>
                  {parents.map((location) => (
                    <option key={location.id} value={location.id}>
                      {locationLabel(market, location.id)} · {location.kind}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
          </div>
          <label className="block text-sm">
            Import names file
            <input
              aria-label="Import names file"
              type="file"
              accept=".txt,.csv,.tsv,.json,text/plain,text/csv,application/json"
              className="mt-1 block w-full text-sm"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                invalidate();
                setBusy(true);
                try {
                  const extension = file.name.split(".").at(-1)?.toLowerCase();
                  if (!["txt", "csv", "tsv", "json"].includes(extension || ""))
                    throw Error("Choose a TXT, CSV, TSV or JSON file.");
                  if (file.size > 128000) throw Error("Choose a file no larger than 128 KB.");
                  const source = await file.text();
                  setText(source);
                  setFormat(extension!);
                  setFileName(file.name);
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : "Could not read this file.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {fileName ? (
            <p className="break-all text-xs text-muted">
              Loaded {fileName}. Editing below uses the same format.
            </p>
          ) : null}
          <label className="block text-sm">
            Names to import
            <textarea
              aria-label="Names to import"
              value={text}
              maxLength={128000}
              disabled={busy}
              className="ledger-search mt-1 min-h-32 w-full"
              onChange={(event) => {
                setText(event.target.value);
                invalidate();
              }}
              placeholder={"Green Coast\nNorthern Highlands"}
            />
          </label>
          <details className="text-sm text-muted">
            <summary className="cursor-pointer">Import a complete hierarchy</summary>
            <p className="mt-2">
              CSV and TSV use region, city, town, area and shop column headers. Leave unused columns
              empty. A city or town needs a region; an area needs a city or town. Repeated parents
              are reused. JSON accepts an array of names or objects with these same fields.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-sm bg-subtle p-2 text-xs">
              {
                "region,city,town,area,shop\nGreen Coast,Port,,Docks,Salt & Rope\nGreen Coast,,Oakford,,The Copper Kettle"
              }
            </pre>
          </details>
          <p className="text-sm text-muted">
            New shops start closed with empty stock, general goods, modest wealth and standard
            buy/sell rates. Open each shop to configure its stock, image, keeper, prices and
            schedule. Existing shops and location images stay as saved; the party does not move.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy || !text.trim()} onClick={review}>
              Review import
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !text}
              onClick={() => {
                setText("");
                setFileName("");
                setFormat("auto");
                invalidate();
              }}
            >
              Clear import
            </Button>
          </div>
          {preview ? (
            <section
              aria-label="Name import preview"
              className="space-y-3 border-t border-border pt-3"
            >
              <p className="font-medium">
                {preview.plan.locations.length} new locations · {preview.plan.shops.length} new
                shops
              </p>
              <p className="text-sm text-muted">
                {preview.plan.review.filter((row) => row.status === "Reuse").length} existing or
                repeated names reused. Matching uses the name, type and parent location.
              </p>
              <ul className="divide-y divide-border">
                {preview.plan.review.slice(page * 20, (page + 1) * 20).map((row, i) => (
                  <li key={page * 20 + i} className="py-2 text-sm">
                    <span className="font-medium">
                      {row.status}: {row.name}
                    </span>
                    <span className="block break-words text-muted">
                      {row.kind} · {row.path}
                    </span>
                  </li>
                ))}
              </ul>
              {preview.plan.review.length > 20 ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Button variant="ghost" disabled={!page} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <span>
                    Page {page + 1} of {Math.ceil(preview.plan.review.length / 20)}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={(page + 1) * 20 >= preview.plan.review.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
              {!count ? (
                <p className="text-sm text-muted">
                  All names already exist at these locations. Nothing will be added.
                </p>
              ) : null}
              <Button disabled={busy || !count} onClick={() => void save()}>
                {busy ? "Importing…" : `Import ${count} new entries`}
              </Button>
            </section>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
