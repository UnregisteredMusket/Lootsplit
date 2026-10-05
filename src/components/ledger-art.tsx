import type { IconEntry } from "@/lib/icons/resolve";
import { FantasyIcon } from "@/components/fantasy-icon";
import { useState } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { getCloudTable, hasPendingChanges } from "@/lib/quire/cloud-client";
import type { Holding, Purse } from "@/lib/quire/types";
import { formatCopper } from "@/lib/quire/money";
export function LedgerArt({
  src,
  kind,
  className = "",
  entry,
}: {
  src?: string;
  entry?: IconEntry;
  kind: "portrait" | "shop" | "item" | "property";
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  if (kind === "item" && (!src || src === "/art/item-default.webp" || failedSrc === src))
    return <FantasyIcon entry={entry} size={56} className={`ledger-art ${className}`} />;
  return (
    <img
      src={src || `/art/${kind}-default.webp`}
      alt=""
      loading="lazy"
      className={`ledger-art ${className}`}
      onError={(e) => {
        if (kind === "item") {
          setFailedSrc(src);
          return;
        }
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
              const sync = getCloudTable();
              if (sync.joined && hasPendingChanges()) {
                if (sync.live || sync.error)
                  toast.warning(
                    "Portrait kept on this device. It has not synced to the campaign. Open Multiplayer to retry.",
                  );
                else
                  toast.info("Portrait queued for your turn. Submit the turn to sync it.");
              } else {
                toast.success(sync.joined ? "Portrait saved" : "Portrait saved on this device");
              }
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
  const { catalog } = useEconomy();
  const classify = (x: Holding) =>
    x.category ||
    (x.kind === "property"
      ? "property"
      : catalog.find((c) => c.name.toLowerCase() === x.name.toLowerCase())?.category) ||
    x.kind;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const categories = ["All", ...new Set(holdings.map(classify))];
  const shown = holdings.filter(
    (x) =>
      (category === "All" || classify(x) === category) &&
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
            <FantasyIcon
              entry={{ category: x }}
              categoryOnly
              size={22}
              className="fantasy-inline"
            />
            {x}
          </button>
        ))}
      </div>
      <ul>
        {shown.map((x) => (
          <li key={x.id} className="inventory-row">
            <LedgerArt kind={x.kind} src={x.image} entry={x} />
            <span className="min-w-0 flex-1">
              <strong>{x.name}</strong>
              <small>
                {classify(x)} · ×{x.quantity}
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
