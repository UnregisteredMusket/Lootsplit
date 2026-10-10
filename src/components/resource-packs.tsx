import { SearchSelect } from "@/components/search-select";
import { useState } from "react";
import { AppLink } from "./app-link";
import { libraryRecordHref } from "@/lib/quire/library-records";
import { Button } from "./ui";
import { useEconomy } from "@/lib/quire/economy-context";
import {
  captureMutationScope,
  assertMutationScope,
  type ExpectedMutationScope,
} from "@/lib/quire/cloud-client";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { downloadJson } from "@/lib/quire/table";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import type { ItemCategory, ItemRarity } from "@/lib/quire/types";
import { readMarketLocations } from "@/lib/quire/shop-locations";
import { previewMarketNames } from "@/lib/quire/market-name-import";
import {
  missingCreatureFields,
  previewResourcePack,
  readResourcePack,
  resourceNameRows,
  packKey,
  type ResourcePack,
  type ResourceEntry,
} from "@/lib/quire/resource-packs";

const failureText = (error: unknown) =>
  error instanceof Error ? error.message : "The resource pack could not be imported.";
function Reference({ entry, pack }: { entry: ResourceEntry; pack: ResourcePack }) {
  return (
    <details className="reference-handout">
      <summary>
        {entry.name} · {entry.kind}
      </summary>
      <p className="text-sm text-muted">
        {entry.sources
          .map(
            (s) =>
              `${s.book}, PDF p. ${s.pdfPage}${s.printedPage ? ` (print ${s.printedPage})` : ""}`,
          )
          .join("; ")}
      </p>
      {entry.kind === "creature" && (
        <p>
          AC {entry.stats.ac ?? "unknown"} · HP {entry.stats.hp ?? "unknown"} · CR{" "}
          {entry.stats.cr ?? "unknown"} · XP {entry.stats.xp ?? "unknown"}
        </p>
      )}
      {[...entry.warnings, ...missingCreatureFields(entry)].map((warning, i) => (
        <p className="text-sm text-danger" key={i}>
          {warning}
        </p>
      ))}
      <p className="whitespace-pre-wrap break-words">{entry.text}</p>
      {(entry.relatedIds ?? []).map((id) => {
        const related = pack.entries.find((e) => e.id === id);
        return related ? (
          <details key={id}>
            <summary>{related.name}</summary>
            <p className="whitespace-pre-wrap break-words">{related.text}</p>
          </details>
        ) : null;
      })}
    </details>
  );
}
export function ResourcePacks() {
  const { journal, shops, catalog, commandOutcome, addGoods, ready } = useEconomy();
  const [draft, setDraft] = useState<ResourcePack | null>(null),
    [preview, setPreview] = useState<{
      plan: ReturnType<typeof previewResourcePack>;
      scope: ExpectedMutationScope;
    } | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const [selected, setSelected] = useState(""),
    [prices, setPrices] = useState<Record<string, string>>({});
  const [names, setNames] = useState<{
    plan: ReturnType<typeof previewMarketNames>;
    rows: ReturnType<typeof resourceNameRows>;
    scope: ExpectedMutationScope;
  } | null>(null);
  useDraftGuard(!!draft || busy || !!names, "resource pack import");
  const packs = journal.resourceLibrary?.packs ?? [];
  const active = packs.find((p) => packKey(p) === selected) ?? packs[0];
  const entries =
    (draft ?? active)?.entries.filter((e) =>
      `${e.name} ${e.kind} ${e.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  async function apply() {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await commandOutcome(
        { kind: "resource-pack-import", before: preview.plan.before, pack: preview.plan.pack },
        preview.scope,
      );
      setNotice(
        mutationNotice(
          result,
          preview.plan.status === "Reuse"
            ? "This pack is already imported; no duplicate references were added."
            : "Resource pack imported. Its references are ready to use.",
        ),
      );
      setSelected(packKey(preview.plan.pack));
      setDraft(null);
      setPreview(null);
      setPage(0);
    } catch (error) {
      setError(failureText(error));
    } finally {
      setBusy(false);
    }
  }
  async function addItem(entry: Extract<ResourceEntry, { kind: "item" }>) {
    if (!active || busy) return;
    setBusy(true);
    setError("");
    try {
      const scope = captureMutationScope();
      const price = prices[entry.id] ?? (entry.baseCopper === null ? "" : String(entry.baseCopper));
      const copper = Number(price);
      if (!price.trim() || !Number.isSafeInteger(copper) || copper < 0 || copper > 1e12)
        throw Error("Enter a nonnegative whole-number price in copper before adding this item.");
      assertMutationScope(scope);
      const category = (
        [
          "provisions",
          "smith",
          "cloth",
          "apothecary",
          "inn",
          "general",
          "curios",
          "stable",
          "scribe",
          "jewels",
        ].includes(entry.category)
          ? entry.category
          : "general"
      ) as ItemCategory;
      const rarity = (
        ["common", "uncommon", "rare", "magic"].includes(entry.rarity) ? entry.rarity : "magic"
      ) as ItemRarity;
      const count = await addGoods(
        [
          {
            id: `resource-${crypto.randomUUID()}`,
            name: entry.name,
            category,
            rarity,
            baseCopper: copper,
            notes: `${entry.text}\nSource: ${active.title}; ${entry.sources.map((s) => `PDF p. ${s.pdfPage}`).join(", ")}`,
            origin: "hand",
            service: false,
          },
        ],
        scope,
      );
      setNotice(
        count
          ? "Item added to this device’s catalogue. Stock and inventory are unchanged."
          : "This item already exists in the catalogue; no duplicate was added.",
      );
    } catch (error) {
      setError(failureText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-6 space-y-3" id="resource-packs" aria-label="Resource packs">
      <h2>DM resource packs</h2>
      <p className="text-sm text-muted">
        Import reviewed JSON with creatures, items, NPC references, locations and shops. References
        stay private to the DM and are included in campaign saves and complete exports. Importing
        adds no money, stock, inventory or NPC accounts.
      </p>
      <label className="block text-sm">
        Resource pack JSON
        <input
          className="mt-1 block w-full text-sm"
          aria-label="Resource pack JSON"
          type="file"
          accept=".json,application/json"
          disabled={busy || !ready}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setBusy(true);
            setError("");
            setNotice("");
            setPreview(null);
            setNames(null);
            const scope = captureMutationScope();
            try {
              if (!file.name.toLowerCase().endsWith(".json") || file.size > 1_500_000)
                throw Error("Choose a JSON resource pack up to 1.5 MB.");
              const pack = readResourcePack(await file.text());
              assertMutationScope(scope);
              setDraft(pack);
              setQuery("");
              setPage(0);
            } catch (error) {
              setError(failureText(error));
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-danger whitespace-pre-wrap break-words">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {draft && (
        <div
          className="space-y-3 border border-border rounded-sm p-3"
          aria-label="Resource pack review"
        >
          <h3>
            {draft.title} · {draft.revision}
          </h3>
          <p>{draft.description}</p>
          <p>
            {["creature", "item", "npc", "location", "shop", "reference"]
              .map(
                (kind) =>
                  `${draft.entries.filter((e) => e.kind === kind).length} ${kind} references`,
              )
              .join(" · ")}
          </p>
          <p className="text-sm text-muted">{draft.attribution}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setError("");
                try {
                  setPreview({
                    plan: previewResourcePack(journal.resourceLibrary, draft),
                    scope: captureMutationScope(),
                  });
                } catch (error) {
                  setError(failureText(error));
                }
              }}
            >
              Review resource pack
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setPreview(null);
              }}
            >
              Cancel import
            </Button>
          </div>
          {preview && (
            <div aria-label="Resource import preview" className="space-y-2">
              <p>
                {preview.plan.status}: {draft.entries.length} references ·{" "}
                {preview.plan.warnings.length} warnings
              </p>
              {preview.plan.warnings.length > 0 && (
                <details>
                  <summary>Review warnings</summary>
                  <ul>
                    {preview.plan.warnings.map((w, i) => (
                      <li key={i}>
                        {w.name}: {w.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <Button disabled={busy} onClick={() => void apply()}>
                Apply resource pack
              </Button>
            </div>
          )}
        </div>
      )}
      {!draft && packs.length > 0 && (
        <div className="space-y-3">
          <label className="block">
            Imported pack
            <SearchSelect
              aria-label="Imported pack"
              className="w-full"
              value={active ? packKey(active) : ""}
              onValueChange={(selectedValue) => {
                setSelected(selectedValue);
                setPage(0);
                setNames(null);
              }}
            >
              {packs.map((p) => (
                <option key={packKey(p)} value={packKey(p)}>
                  {p.title} · {p.revision}
                </option>
              ))}
            </SearchSelect>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                active && void downloadJson(`${active.id}-${active.revision}.json`, active)
              }
            >
              Export resource pack
            </Button>
            <AppLink href="/encounters">Use creatures in Encounters →</AppLink>
            {active && resourceNameRows(active).length > 0 && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setError("");
                  try {
                    const rows = resourceNameRows(active);
                    setNames({
                      rows,
                      plan: previewMarketNames(
                        readMarketLocations(journal.market),
                        shops,
                        rows,
                        crypto.randomUUID(),
                      ),
                      scope: captureMutationScope(),
                    });
                  } catch (error) {
                    setError(failureText(error));
                  }
                }}
              >
                Review campaign locations and shops
              </Button>
            )}
          </div>
          {names && (
            <div aria-label="Resource location preview" className="space-y-2">
              <p>
                {names.plan.locations.length} new locations · {names.plan.shops.length} new closed,
                empty shops. Existing names and parents are reused.
              </p>
              <details>
                <summary>Review location hierarchy</summary>
                {names.plan.review.map((r, i) => (
                  <p key={i}>
                    {r.status}: {r.name} · {r.kind} · {r.path}
                  </p>
                ))}
              </details>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await commandOutcome(
                      { kind: "market-name-import", before: names.plan.before, rows: names.rows },
                      names.scope,
                    );
                    setNotice(mutationNotice(result, "Campaign locations and shops imported."));
                    setNames(null);
                  } catch (error) {
                    setError(failureText(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Apply campaign locations and shops
              </Button>
            </div>
          )}
        </div>
      )}
      {(draft || active) && (
        <>
          <label className="block">
            Search pack references
            <input
              aria-label="Search pack references"
              className="ledger-search w-full"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <p className="text-sm text-muted">
            {entries.length} matching references. NPC records are source references; create and
            place campaign NPCs through Maps when needed.
          </p>
          {entries.slice(page * 20, (page + 1) * 20).map((entry) => (
            <div key={entry.id}>
              <Reference entry={entry} pack={(draft ?? active)!} />
              {!draft && active && <AppLink className="settings-link" href={libraryRecordHref("resource", active.id, active.revision, entry.id)}>Open {entry.name} in Library →</AppLink>}
              {!draft && entry.kind === "item" && (
                <div className="flex flex-wrap items-end gap-2 mb-3">
                  <label className="text-sm">
                    Catalogue price in copper
                    <input
                      aria-label={`Price for ${entry.name}`}
                      type="number"
                      min="0"
                      max="1000000000000"
                      step="1"
                      value={
                        prices[entry.id] ??
                        (entry.baseCopper === null ? "" : String(entry.baseCopper))
                      }
                      placeholder="DM review required"
                      onChange={(e) => setPrices((p) => ({ ...p, [entry.id]: e.target.value }))}
                    />
                  </label>
                  <Button
                    variant="secondary"
                    disabled={
                      busy ||
                      catalog.some(
                        (c) => c.name.trim().toLowerCase() === entry.name.trim().toLowerCase(),
                      )
                    }
                    onClick={() => void addItem(entry)}
                  >
                    Add {entry.name} to catalogue
                  </Button>
                </div>
              )}
            </div>
          ))}
          {entries.length > 20 && (
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" disabled={!page} onClick={() => setPage(page - 1)}>
                Previous references
              </Button>
              <span>
                Page {page + 1} of {Math.ceil(entries.length / 20)}
              </span>
              <Button
                variant="ghost"
                disabled={(page + 1) * 20 >= entries.length}
                onClick={() => setPage(page + 1)}
              >
                More references
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
