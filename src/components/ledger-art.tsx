import { useState } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import type { Holding, Purse } from "@/lib/quire/types";
import { formatCopper } from "@/lib/quire/money";
export function LedgerArt({
  src,
  kind,
  className = "",
}: {
  src?: string;
  kind: "portrait" | "shop" | "item" | "property";
  className?: string;
}) {
  return (
    <img
      src={src || `/art/${kind}-default.webp`}
      alt=""
      loading="lazy"
      className={`ledger-art ${className}`}
      onError={(e) => {
        e.currentTarget.onerror = null;
        e.currentTarget.src = `/art/${kind}-default.webp`;
      }}
    />
  );
}
export function PortraitPicker({ purse }: { purse: Purse }) {
  const { command } = useEconomy();
  const [busy, setBusy] = useState(false);
  return (
    <div className="portrait-picker">
      <LedgerArt kind="portrait" src={purse.portrait} />
      <label className="quick-action">
        {busy ? "Saving…" : "Choose portrait"}
        <input
          disabled={busy}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            try {
              if (file.size > 10_000_000) throw new Error("Choose an image smaller than 10 MB.");
              const bitmap = await createImageBitmap(file);
              const canvas = document.createElement("canvas");
              canvas.width = 256;
              canvas.height = 256;
              const ctx = canvas.getContext("2d")!;
              const side = Math.min(bitmap.width, bitmap.height);
              ctx.drawImage(
                bitmap,
                (bitmap.width - side) / 2,
                (bitmap.height - side) / 2,
                side,
                side,
                0,
                0,
                256,
                256,
              );
              bitmap.close();
              await command({
                kind: "portrait",
                purseId: purse.id,
                portrait: canvas.toDataURL("image/webp", 0.75),
              });
              toast.success("Portrait saved");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not save portrait");
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <button
        type="button"
        className="min-h-11 text-sm text-muted"
        onClick={() =>
          void command({
            kind: "portrait",
            purseId: purse.id,
            portrait: "/art/portrait-default.webp",
          }).catch((e) => toast.error(e.message))
        }
      >
        Use default artwork
      </button>
    </div>
  );
}
export function InventoryList({ holdings }: { holdings: Holding[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const categories = ["All", ...new Set(holdings.map((x) => x.category || x.kind))];
  const shown = holdings.filter(
    (x) =>
      (category === "All" || (x.category || x.kind) === category) &&
      `${x.name} ${x.notes}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="inventory-panel">
      <div className="section-heading">
        <h2>Inventory</h2>
        <span>
          {holdings.reduce((n, x) => n + x.quantity, 0)} units · {holdings.length} entries
        </span>
      </div>
      <input
        aria-label="Find inventory item"
        placeholder="Find an item…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="ledger-search"
      />
      <div className="filter-chips">
        {categories.map((x) => (
          <button key={x} aria-pressed={x === category} onClick={() => setCategory(x)}>
            {x}
          </button>
        ))}
      </div>
      <ul>
        {shown.map((x) => (
          <li key={x.id} className="inventory-row">
            <LedgerArt kind={x.kind} src={x.image} />
            <span className="min-w-0 flex-1">
              <strong>{x.name}</strong>
              <small>
                {x.category || x.kind} · ×{x.quantity}
              </small>
              {x.notes ? <small className="line-clamp-2">{x.notes}</small> : null}
            </span>
            <span className="text-lead tabular-nums">
              {formatCopper(x.quantity * x.unitCopper)}
              <small>total value</small>
            </span>
          </li>
        ))}
      </ul>
      {!shown.length ? <p className="py-4 text-muted">No matching holdings.</p> : null}
    </section>
  );
}
