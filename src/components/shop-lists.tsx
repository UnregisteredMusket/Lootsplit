/**
 * Alternative shop lists (shop-lists.ts; owner request 2026-11-10), DM only:
 * - `ShopListsPanel` (Market → Shop lists): the campaign-wide library. Create, edit, rename and
 *   delete named stock lists.
 * - `ShopStockLists` (a shop in Edit mode): which list the shop last had swapped in, "Save stock as
 *   list" and "Swap stock to…", with a confirmation naming what is replaced and the name the
 *   current stock is saved under.
 * Every change is one DM-only `shop-list-*` command with one command ID per action.
 */
import { useState } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import type { CommandInput } from "@/lib/quire/commands";
import { formatCopper, parsePrice } from "@/lib/quire/money";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { requestConfirm } from "@/lib/quire/confirm-store";
import {
  activeShopList,
  listFingerprint,
  savedStockName,
  shopListsOf,
  stockFingerprint,
  swapPlan,
} from "@/lib/quire/shop-lists";
import {
  MAX_SHOP_LIST_ITEMS,
  MAX_SHOP_LIST_NAME,
  MAX_SHOP_LIST_NOTE,
  type ShopList,
  type ShopListItem,
} from "@/lib/quire/shop-lists-schema";
import type { Shop } from "@/lib/quire/types";
import { Button, Field, Select, TextInput } from "./ui";
import { Status, useFactionCommand } from "./faction-command";

type Row = { key: string; name: string; price: string; quantity: string; base?: ShopListItem };

const toRow = (item: ShopListItem, i: number): Row => ({
  key: `${i}-${item.name}`,
  name: item.name,
  price: formatCopper(item.copper),
  quantity: item.quantity === null ? "" : String(item.quantity),
  base: item,
});

/** Rows back to items, or the first problem. Unedited item details (rarity, notes…) are kept. */
function rowsToItems(rows: Row[]): ShopListItem[] | string {
  const items: ShopListItem[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name && !row.price.trim() && !row.quantity.trim()) continue;
    if (!name) return "Every item needs a name.";
    const copper = parsePrice(row.price);
    if (copper === null) return `Enter a price for ${name}, such as 2 gp or 15 cp.`;
    const quantity = row.quantity.trim() === "" ? null : Number(row.quantity);
    if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0))
      return `Choose a whole quantity of zero or more for ${name}, or leave it blank for unlimited.`;
    const base = row.base;
    items.push({
      ...(base ?? { notes: "", rarity: "common" as const }),
      name,
      copper,
      baseCopper: base && base.copper === copper ? base.baseCopper : copper,
      quantity,
    });
  }
  return items;
}

function ShopListEditor({ list, onDone }: { list: ShopList | null; onDone: () => void }) {
  const [before] = useState(() => (list ? listFingerprint(list) : null));
  const [listId] = useState(() => list?.id ?? crypto.randomUUID());
  const [name, setName] = useState(list?.name ?? "");
  const [note, setNote] = useState(list?.note ?? "");
  const [rows, setRows] = useState<Row[]>(() => (list?.items.length ? list.items.map(toRow) : [{ key: "new-0", name: "", price: "", quantity: "" }]));
  const [problem, setProblem] = useState("");
  const draft = JSON.stringify([name, note, rows.map(({ name, price, quantity }) => [name, price, quantity])]);
  const [initial] = useState(draft);
  useDraftGuard(draft !== initial, "shop list");
  const command = useFactionCommand(`shop-list-save|${listId}|${before}|${draft}`);
  const edit = (key: string, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <form
      aria-label={list ? `Edit ${list.name}` : "New shop list"}
      data-testid="shop-list-editor"
      className="space-y-3 rounded-sm border border-border p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const items = rowsToItems(rows);
        if (typeof items === "string") return setProblem(items);
        if (!name.trim()) return setProblem("Give the list a name.");
        setProblem("");
        const ok = await command.send(
          { kind: "shop-list-save", listId, before, list: { name: name.trim(), ...(note.trim() ? { note: note.trim() } : {}), items } } as CommandInput,
          list ? "Shop list saved." : "Shop list created.",
        );
        if (ok) onDone();
      }}
    >
      <p className="text-sm font-medium">{list ? `Edit ${list.name}` : "New shop list"}</p>
      <Field label="List name">
        <TextInput value={name} maxLength={MAX_SHOP_LIST_NAME} onChange={(e) => setName(e.target.value)} aria-label="List name" placeholder="Winter goods" />
      </Field>
      <Field label="Note" hint="Optional; only you see it.">
        <TextInput value={note} maxLength={MAX_SHOP_LIST_NOTE} onChange={(e) => setNote(e.target.value)} aria-label="List note" />
      </Field>
      <ul className="space-y-3">
        {rows.map((row, i) => (
          <li key={row.key} className="grid grid-cols-2 gap-2 border-b border-border/60 pb-3" data-testid="shop-list-row">
            <label className="col-span-2 block text-sm">
              Item
              <TextInput value={row.name} onChange={(e) => edit(row.key, { name: e.target.value })} aria-label={`Item ${i + 1} name`} />
            </label>
            <label className="block text-sm">
              Price
              <TextInput value={row.price} placeholder="2 gp" onChange={(e) => edit(row.key, { price: e.target.value })} aria-label={`Item ${i + 1} price`} />
            </label>
            <label className="block text-sm">
              Quantity
              <TextInput value={row.quantity} placeholder="Unlimited" onChange={(e) => edit(row.key, { quantity: e.target.value })} aria-label={`Item ${i + 1} quantity`} />
            </label>
            <button
              type="button"
              className="col-span-2 inline-flex min-h-11 items-center text-sm text-muted"
              onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
            >
              Remove {row.name.trim() || `item ${i + 1}`}
            </button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="secondary"
        disabled={rows.length >= MAX_SHOP_LIST_ITEMS}
        onClick={() => setRows((all) => [...all, { key: `new-${Date.now()}-${all.length}`, name: "", price: "", quantity: "" }])}
      >
        Add item
      </Button>
      {problem && <p role="alert">{problem}</p>}
      <Status error={command.error} notice={command.notice} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={command.busy}>
          {list ? "Save list" : "Create list"}
        </Button>
        <Button type="button" variant="secondary" disabled={command.busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteList({ list }: { list: ShopList }) {
  const before = listFingerprint(list);
  const command = useFactionCommand(`shop-list-delete|${list.id}|${before}`);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={command.busy}
        onClick={async () => {
          if (
            !(await requestConfirm({
              title: `Delete ${list.name}?`,
              body: "The list leaves the library. Shops keep the stock they have now.",
              tone: "danger",
              confirmLabel: "Delete list",
            }))
          )
            return;
          await command.send({ kind: "shop-list-delete", listId: list.id, before } as CommandInput, "Shop list deleted.");
        }}
      >
        Delete
      </Button>
      <Status error={command.error} notice={command.notice} />
    </>
  );
}

/** Market → Shop lists (DM): the campaign-wide library. */
export function ShopListsPanel() {
  const { journal, shops } = useEconomy();
  const library = shopListsOf(journal as { shopLists?: unknown });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const usedBy = (listId: string) =>
    shops.filter((s) => library.active?.[s.id] === listId).map((s) => s.name);
  return (
    <div className="space-y-3" data-testid="shop-lists-panel">
      <p className="text-sm text-muted">
        Named stock lists you can swap into any shop, such as Winter goods or Post-siege. Swapping saves the shop's current
        stock as a list, so you can swap back. Save a shop's stock as a list from the shop's Edit mode.
      </p>
      {library.lists.length ? (
        <ul className="space-y-2">
          {library.lists.map((list) =>
            editing === list.id ? (
              <li key={list.id}>
                <ShopListEditor list={list} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={list.id} className="rounded-sm border border-border p-3" data-testid="shop-list">
                <p className="font-medium break-words">{list.name}</p>
                <p className="text-sm text-muted">
                  {list.items.length} {list.items.length === 1 ? "item" : "items"}
                  {usedBy(list.id).length ? ` · in ${usedBy(list.id).join(", ")}` : ""}
                </p>
                {list.note ? <p className="text-sm text-muted break-words">{list.note}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => setEditing(list.id)} aria-label={`Edit ${list.name}`}>
                    Edit
                  </Button>
                  <DeleteList list={list} />
                </div>
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="text-sm text-muted">No shop lists yet.</p>
      )}
      {editing === "new" ? (
        <ShopListEditor list={null} onDone={() => setEditing(null)} />
      ) : (
        <Button type="button" variant="secondary" onClick={() => setEditing("new")}>
          New shop list
        </Button>
      )}
    </div>
  );
}

/** A shop in Edit mode (DM): save its stock as a list, or swap its stock to a list. */
export function ShopStockLists({ shop, disabled }: { shop: Shop; disabled?: boolean }) {
  const { journal, stock } = useEconomy();
  const library = shopListsOf(journal as { shopLists?: unknown });
  const active = activeShopList(journal as { shopLists?: unknown }, shop.id);
  const lineCount = stock.filter((l) => l.shopId === shop.id).length;
  const before = stockFingerprint(stock, shop.id);
  const [name, setName] = useState(`${shop.name} stock`.slice(0, MAX_SHOP_LIST_NAME));
  const [target, setTarget] = useState("");
  const capture = useFactionCommand(`shop-list-capture|${shop.id}|${before}|${name}`);
  const list = library.lists.find((l) => l.id === target);
  const listBefore = list ? listFingerprint(list) : "";
  const swap = useFactionCommand(`shop-list-swap|${shop.id}|${target}|${before}|${listBefore}`);
  return (
    <section className="mt-8 space-y-3 rounded-sm border border-border p-3" aria-label="Shop lists" data-testid="shop-stock-lists">
      <h2 className="text-sm font-medium">Shop lists</h2>
      <p className="text-sm text-muted" data-testid="shop-active-list">
        {active ? `Stock last swapped to ${active.name}.` : "No shop list swapped in yet."}
      </p>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void capture.send({ kind: "shop-list-capture", shopId: shop.id, before, name: name.trim() } as CommandInput, `Stock saved as ${name.trim()}.`);
        }}
      >
        <Field label="Save stock as list" hint="Copies this shop's current stock into your shop lists; the shop doesn't change.">
          <TextInput value={name} maxLength={MAX_SHOP_LIST_NAME} onChange={(e) => setName(e.target.value)} aria-label="New list name" />
        </Field>
        <Button type="submit" variant="secondary" disabled={disabled || capture.busy || !lineCount || !name.trim()}>
          Save stock as list
        </Button>
        <Status error={capture.error} notice={capture.notice} />
      </form>
      <div className="space-y-2">
        <label className="block text-sm">
          Swap stock to…
          <Select aria-label="Swap stock to" value={target} onChange={(e) => setTarget(e.target.value)} disabled={!library.lists.length}>
            <option value="">{library.lists.length ? "Choose a list" : "No shop lists yet"}</option>
            {library.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.items.length} {l.items.length === 1 ? "item" : "items"}
              </option>
            ))}
          </Select>
        </label>
        <Button
          type="button"
          disabled={disabled || swap.busy || !list}
          onClick={async () => {
            if (!list) return;
            const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
            const savedName = savedStockName(shop.name, list.name, date);
            const plan = swapPlan({ stock, journal }, shop.id, list.id, savedName);
            const outgoing = plan.outgoing.map((i) => i.name);
            const shown = outgoing.slice(0, 6).join(", ") + (outgoing.length > 6 ? ` and ${outgoing.length - 6} more` : "");
            const ok = await requestConfirm({
              title: `Swap ${shop.name}'s stock to ${list.name}?`,
              body: (
                <span data-testid="shop-swap-confirm">
                  {outgoing.length
                    ? `Replaces the current ${outgoing.length} stock ${outgoing.length === 1 ? "line" : "lines"} (${shown}) with the ${list.items.length} ${list.items.length === 1 ? "item" : "items"} of ${list.name}, at the list's prices and quantities. `
                    : `Stocks the shop with the ${list.items.length} ${list.items.length === 1 ? "item" : "items"} of ${list.name}. `}
                  {plan.save
                    ? `The current stock will be saved as "${plan.save}", so you can swap back.`
                    : plan.keptIn
                      ? `The current stock is already saved as "${plan.keptIn.name}".`
                      : ""}{" "}
                  Coins, the merchant purse, what the shop buys and items characters own don't change.
                </span>
              ),
              confirmLabel: "Swap stock",
            });
            if (!ok) return;
            const done = await swap.send(
              { kind: "shop-list-swap", shopId: shop.id, listId: list.id, before, listBefore, savedName } as CommandInput,
              plan.save ? `Stock swapped to ${list.name}; the previous stock is saved as ${plan.save}.` : `Stock swapped to ${list.name}.`,
            );
            if (done) setTarget("");
          }}
        >
          Swap stock
        </Button>
        <Status error={swap.error} notice={swap.notice} />
      </div>
    </section>
  );
}
