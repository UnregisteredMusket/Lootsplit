/**
 * Party → Funds & inventory list (design plan D3 for the DM, P6 for players).
 *
 * One list of every visible holding: group by holder or category, filter by holder, category and
 * Equipped, search. Identical rows stack for display only. Each row is a shared `RecordRow` with
 * a ⋯ menu (Edit, Give, Move to pool, Sell to shop, Remove). Every change runs the existing
 * economy action for one holding with its own command ID; bulk actions run them one by one and
 * can resume after a reload with the same IDs, so nothing moves twice.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppLink } from "./app-link";
import { LedgerArt } from "./ledger-art";
import { RecordRow, type RecordMenuItem } from "./record-row";
import { Button, Field, Modal, Segmented, TextInput } from "./ui";
import { useEconomy } from "@/lib/quire/economy-context";
import { holdingRecordId } from "@/lib/quire/finance-record-links";
import { newCommandId } from "@/lib/quire/command-id";
import { requestConfirm } from "@/lib/quire/confirm-store";
import { partyFunds } from "@/lib/quire/coin-split";
import { formatCopper } from "@/lib/quire/money";
import { useDollarText } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import { useSeatGroups } from "@/lib/quire/use-seat-groups";
import { shopVisible } from "@/lib/quire/world";
import type { Holding, Purse } from "@/lib/quire/types";
import { useGiveRecipients } from "@/lib/quire/use-give-recipients";
import {
  bulkRefusal,
  groupInventory,
  inventoryCategory,
  readBulkRun,
  remainingBulkItems,
  writeBulkRun,
  type BulkAction,
  type BulkRun,
  type InventoryGroupBy,
  type InventoryStack,
  stackKey,
} from "@/lib/quire/inventory-stacks";
import "./party-inventory.css";

const GROUP_STORAGE = "lootsplit.inventory-group.v1";

function readGroupBy(): InventoryGroupBy | null {
  try {
    const value = localStorage.getItem(GROUP_STORAGE);
    return value === "holder" || value === "category" ? value : null;
  } catch {
    return null;
  }
}

const ACTION_LABEL: Record<BulkAction, string> = {
  give: "Give",
  pool: "Move to pool",
  remove: "Remove",
};

export function PartyInventory({
  purses,
  readOnly,
  onGive,
}: {
  /** The accounts whose holdings are shown (a player's own; the DM's party). */
  purses: Purse[];
  /** The DM's view when it is not their turn, or any player: no direct edits. */
  readOnly: boolean;
  /** Open Give to a player for one holding. */
  onGive: (holding: Holding) => void;
}) {
  const economy = useEconomy();
  const seat = useSeat();
  const dm = seat.role === "dm";
  const manage = dm && !readOnly;
  const dollars = useDollarText();
  const holdings = useMemo(
    () => economy.holdings.filter((h) => purses.some((p) => p.id === h.purseId)),
    [economy.holdings, purses],
  );
  const classify = (h: Holding) => inventoryCategory(h, economy.catalog);
  const fundIds = useMemo(
    () => new Set(partyFunds({ purses: economy.purses, journal: economy.journal }).map((p) => p.id)),
    [economy.purses, economy.journal],
  );
  const holders = purses.filter((p) => holdings.some((h) => h.purseId === p.id));
  const [groupBy, setGroupByState] = useState<InventoryGroupBy>(
    () => readGroupBy() ?? "holder",
  );
  const setGroupBy = (value: InventoryGroupBy) => {
    setGroupByState(value);
    try {
      localStorage.setItem(GROUP_STORAGE, value);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  };
  const [query, setQuery] = useState("");
  const [holder, setHolder] = useState("");
  const [category, setCategory] = useState("");
  const [equippedOnly, setEquippedOnly] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Holding | null>(null);
  const [selling, setSelling] = useState<Holding | null>(null);
  const [giving, setGiving] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [interrupted, setInterrupted] = useState<BulkRun | null>(null);

  useEffect(() => {
    if (!economy.ready) return;
    const run = readBulkRun();
    if (!run) return;
    if (remainingBulkItems(run, economy.holdings).length) setInterrupted(run);
    else writeBulkRun(null);
    // Only on load: a run in progress manages its own record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [economy.ready]);

  // A receipt's "#holding-…" link: show that entry (open its stack, clear filters) and scroll to it.
  const hash = useRouterState({ select: (state) => state.location.hash });
  useEffect(() => {
    if (!hash.startsWith("holding-")) return;
    const target = holdings.find((h) => holdingRecordId(h.id) === hash);
    if (!target) return;
    setQuery("");
    setHolder("");
    setCategory("");
    setEquippedOnly(false);
    setExpanded((current) => new Set(current).add(stackKey(target, classify(target))));
    const timer = setTimeout(
      () => document.getElementById(hash)?.scrollIntoView({ block: "center" }),
      60,
    );
    return () => clearTimeout(timer);
    // classify depends only on the catalog, already covered by holdings changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, holdings.length]);

  const categories = [...new Set(holdings.map(classify))].sort((a, b) => a.localeCompare(b));
  const equippedCount = holdings.filter((h) => h.equipped).length;
  const needle = query.trim().toLowerCase();
  const shown = holdings.filter(
    (h) =>
      (!holder || h.purseId === holder) &&
      (!category || classify(h) === category) &&
      (!equippedOnly || h.equipped) &&
      (!needle || `${h.name} ${h.notes}`.toLowerCase().includes(needle)),
  );
  // One holder: a single heading is shorter than one per category.
  const groups = groupInventory(shown, purses, holders.length > 1 ? groupBy : "holder", classify);
  const nameOf = (purseId: string) =>
    economy.purses.find((p) => p.id === purseId)?.name ?? "Unassigned";
  const canGive = (h: Holding) => dm || seat.purseIds.includes(h.purseId);
  const selectedRows = holdings.filter((h) => selected.has(h.id));

  useEffect(() => {
    // Drop selections that left the list (given, removed, filtered by another seat's change).
    if ([...selected].some((id) => !holdings.some((h) => h.id === id)))
      setSelected(new Set([...selected].filter((id) => holdings.some((h) => h.id === id))));
  }, [holdings, selected]);

  const toggle = (ids: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  async function execute(run: BulkRun) {
    setBusy(true);
    setInterrupted(null);
    writeBulkRun(run);
    const items = remainingBulkItems(run, economy.holdings);
    let done = 0;
    let failed = false;
    try {
      for (const item of items) {
        const holding = economy.holdings.find((h) => h.id === item.holdingId);
        if (!holding) continue;
        let ok = false;
        if (run.action === "give" && run.toId) {
          ok = await economy.give(
            {
              fromId: item.purseId,
              toId: run.toId,
              copper: 0,
              holdingId: item.holdingId,
              quantity: holding.quantity,
            },
            { commandId: item.commandId },
          );
        } else if (run.action === "pool") {
          const refusal = await economy.lootPoolSet(item.holdingId, true, {
            commandId: item.commandId,
          });
          if (refusal) toast.error(`${holding.name}: ${refusal}`);
          ok = refusal === null;
        } else if (run.action === "remove") {
          ok = await economy.deleteHolding(item.holdingId);
        }
        if (!ok) {
          failed = true;
          break;
        }
        item.done = true;
        done++;
        writeBulkRun(run);
      }
    } finally {
      setBusy(false);
    }
    const total = run.items.filter((i) => i.done).length;
    if (failed) {
      setInterrupted(run);
      toast.error(
        `${ACTION_LABEL[run.action]} stopped after ${total} of ${run.items.length}. Nothing was applied twice; Resume sends the rest.`,
      );
      return;
    }
    writeBulkRun(null);
    setSelected(new Set());
    setSelecting(false);
    toast.success(
      run.action === "give"
        ? `Gave ${done} ${done === 1 ? "entry" : "entries"} to ${nameOf(run.toId ?? "")}.`
        : run.action === "pool"
          ? `Put ${done} ${done === 1 ? "entry" : "entries"} in the treasure pool.`
          : `Removed ${done} ${done === 1 ? "entry" : "entries"}.`,
    );
  }

  function plan(action: BulkAction, rows: Holding[], toId?: string) {
    const ok: Holding[] = [];
    const skipped: Array<[Holding, string]> = [];
    for (const h of rows) {
      const reason = bulkRefusal(action, h, { partyFundIds: fundIds, toId });
      if (reason) skipped.push([h, reason]);
      else ok.push(h);
    }
    return { ok, skipped };
  }

  const newRun = (action: BulkAction, rows: Holding[], toId?: string): BulkRun => ({
    id: newCommandId(),
    action,
    ...(toId ? { toId } : {}),
    items: rows.map((h) => ({ holdingId: h.id, purseId: h.purseId, commandId: newCommandId() })),
  });

  async function bulkPool(rows: Holding[]) {
    const { ok, skipped } = plan("pool", rows);
    if (!ok.length) {
      toast.error(`None of these can go in the treasure pool (${skipped[0]?.[1] ?? "nothing selected"}).`);
      return;
    }
    const yes = await requestConfirm({
      title: `Put ${ok.length} ${ok.length === 1 ? "entry" : "entries"} in the treasure pool?`,
      body: (
        <BulkSummary ok={ok} skipped={skipped} note="They stay in the party fund until you resolve the pool in Review Inbox." />
      ),
      confirmLabel: "Move to pool",
    });
    if (yes) await execute(newRun("pool", ok));
  }

  async function bulkRemove(rows: Holding[]) {
    const { ok, skipped } = plan("remove", rows);
    if (!ok.length) {
      toast.error(`None of these can be removed here (${skipped[0]?.[1] ?? "nothing selected"}).`);
      return;
    }
    const yes = await requestConfirm({
      title:
        ok.length === 1 ? `Remove ${ok[0]!.name}?` : `Remove ${ok.length} entries?`,
      body: (
        <BulkSummary ok={ok} skipped={skipped} note="These items are deleted. Money already in an account is not changed." />
      ),
      tone: "danger",
      confirmLabel: "Remove",
    });
    if (yes) await execute(newRun("remove", ok));
  }

  function menuFor(h: Holding): RecordMenuItem[] {
    const items: RecordMenuItem[] = [];
    if (manage) items.push({ label: "Edit", onSelect: () => setEditing(h) });
    if (canGive(h))
      items.push({
        label: "Give",
        onSelect: () => onGive(h),
        disabledReason:
          (h.pool && "In the treasure pool") ||
          ((h.custody || h.reservedFor) && "Stored at a property") ||
          undefined,
      });
    if (manage) {
      if (h.pool) items.push({ label: "Open treasure pool", href: "/party?section=pool" });
      else {
        const reason = bulkRefusal("pool", h, { partyFundIds: fundIds });
        items.push({
          label: "Move to pool",
          onSelect: () => void bulkPool([h]),
          disabledReason:
            reason === "not held by a party fund"
              ? "Give it to a party fund first"
              : reason
                ? reason[0]!.toUpperCase() + reason.slice(1)
                : undefined,
        });
      }
    }
    if (canGive(h)) items.push({ label: "Sell to shop", onSelect: () => setSelling(h) });
    if (manage) items.push({ label: "Remove", tone: "danger", onSelect: () => void bulkRemove([h]) });
    return items;
  }

  function badges(h: Holding) {
    return (
      <>
        {h.equipped ? <span className="record-chip is-lead">Equipped</span> : null}
        {h.pool ? <span className="record-chip">In the pool</span> : null}
        {h.custody ? (
          <span className="record-chip">{h.custody.kind === "transit" ? "In transit" : "Stored"}</span>
        ) : null}
        {h.reservedFor ? <span className="record-chip">Reserved</span> : null}
      </>
    );
  }

  function value(copper: number) {
    const text = dollars(copper);
    return (
      <>
        {formatCopper(copper)}
        {text ? <small className="block text-muted">{text}</small> : null}
      </>
    );
  }

  function row(h: Holding) {
    return (
      <RecordRow
        key={h.id}
        id={holdingRecordId(h.id)}
        className="inventory-record"
        icon={<LedgerArt kind={h.kind} src={h.image} entry={h} />}
        title={h.name}
        badges={badges(h)}
        meta={
          <>
            <span className="inventory-holder">{nameOf(h.purseId)}</span>
            <span aria-hidden="true"> · </span>
            <span>{classify(h)}</span>
          </>
        }
        detail={
          h.notes || h.custody ? (
            <>
              {h.notes}
              {h.custody ? (
                <>
                  {h.notes ? " · " : ""}
                  <AppLink
                    href={`/features/properties#property-${encodeURIComponent(h.custody.propertyId)}`}
                  >
                    View property
                  </AppLink>
                </>
              ) : null}
            </>
          ) : undefined
        }
        quantity={`×${h.quantity}`}
        value={value(h.quantity * h.unitCopper)}
        menu={menuFor(h)}
        menuLabel={`Actions for ${h.name}`}
        select={
          selecting
            ? {
                checked: selected.has(h.id),
                onChange: (on) => toggle([h.id], on),
                label: `Select ${h.name} (${nameOf(h.purseId)})`,
              }
            : undefined
        }
      />
    );
  }

  function stack(s: InventoryStack) {
    if (s.holdings.length === 1) return row(s.holdings[0]!);
    const first = s.holdings[0]!;
    const open = expanded.has(s.key);
    const ids = s.holdings.map((h) => h.id);
    const count = ids.filter((id) => selected.has(id)).length;
    return (
      <RecordRow
        key={s.key}
        className="inventory-record is-stack"
        icon={<LedgerArt kind={first.kind} src={first.image} entry={first} />}
        title={`${first.name} ×${s.quantity}`}
        badges={badges(first)}
        meta={
          <>
            <span className="inventory-holder">{nameOf(first.purseId)}</span>
            <span aria-hidden="true"> · </span>
            <span>{s.category}</span>
            <span aria-hidden="true"> · </span>
            <span>{s.holdings.length} entries</span>
          </>
        }
        quantity={`×${s.quantity}`}
        value={value(s.copper)}
        expand={{
          open,
          label: `${open ? "Hide" : "Show"} the ${s.holdings.length} entries of ${first.name}`,
          onToggle: () =>
            setExpanded((current) => {
              const next = new Set(current);
              if (open) next.delete(s.key);
              else next.add(s.key);
              return next;
            }),
        }}
        select={
          selecting
            ? {
                checked: count === ids.length,
                indeterminate: count > 0,
                onChange: (on) => toggle(ids, on),
                label: `Select all ${s.holdings.length} entries of ${first.name}`,
              }
            : undefined
        }
      >
        {open ? s.holdings.map((h) => row(h)) : null}
      </RecordRow>
    );
  }

  const units = holdings.reduce((n, h) => n + h.quantity, 0);
  const anyGive = holdings.some(canGive);

  return (
    <section className="inventory-panel party-inventory" aria-labelledby="party-inventory-title">
      <div className="section-heading">
        <h2 id="party-inventory-title">Inventory</h2>
        <span>
          {units} units · {holdings.length} entries
        </span>
      </div>
      {interrupted ? (
        <div className="inventory-resume" role="status">
          <span>
            {ACTION_LABEL[interrupted.action]} stopped after{" "}
            {interrupted.items.filter((i) => i.done).length} of {interrupted.items.length}.
            Resume sends only what has not moved.
          </span>
          <span className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void execute(interrupted)}>
              Resume
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                writeBulkRun(null);
                setInterrupted(null);
              }}
            >
              Dismiss
            </Button>
          </span>
        </div>
      ) : null}
      <div className="inventory-toolbar">
        <input
          aria-label="Find inventory item"
          placeholder="Find an item…"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ledger-search"
        />
        <div className="inventory-filters">
          {holders.length > 1 ? (
            <Segmented
              label="Group by"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "holder", label: "Holder" },
                { value: "category", label: "Category" },
              ]}
            />
          ) : null}
          {holders.length > 1 ? (
            <select
              aria-label="Holder"
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              className="inventory-select"
            >
              <option value="">Everyone</option>
              {holders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          {categories.length > 1 ? (
            <select
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="inventory-select"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : null}
          {equippedCount ? (
            <button
              type="button"
              className="inventory-chip"
              aria-pressed={equippedOnly}
              onClick={() => setEquippedOnly((on) => !on)}
            >
              Equipped · {equippedCount}
            </button>
          ) : null}
          {anyGive && holdings.length > 1 ? (
            <button
              type="button"
              className="inventory-chip"
              aria-pressed={selecting}
              onClick={() => {
                setSelecting((on) => !on);
                setSelected(new Set());
              }}
            >
              {selecting ? "Done selecting" : "Select"}
            </button>
          ) : null}
        </div>
      </div>
      {selecting ? (
        <div className="inventory-bulk" role="region" aria-label="Selected items">
          <label className="inventory-bulk-all">
            <input
              type="checkbox"
              checked={shown.length > 0 && shown.every((h) => selected.has(h.id))}
              onChange={(e) => toggle(shown.map((h) => h.id), e.target.checked)}
              aria-label="Select everything shown"
            />
            <span>{selected.size} selected</span>
          </label>
          <span className="inventory-bulk-actions">
            <Button
              variant="secondary"
              disabled={!selected.size || busy || !selectedRows.every(canGive)}
              onClick={() => setGiving(selectedRows.map((h) => h.id))}
            >
              Give
            </Button>
            {manage ? (
              <>
                <Button
                  variant="secondary"
                  disabled={!selected.size || busy}
                  onClick={() => void bulkPool(selectedRows)}
                >
                  Move to pool
                </Button>
                <Button
                  variant="danger"
                  disabled={!selected.size || busy}
                  onClick={() => void bulkRemove(selectedRows)}
                >
                  Remove
                </Button>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      {groups.map((group) => (
        <section key={group.key} className="inventory-group" aria-label={group.label}>
          <h3 className="inventory-group-title">
            <span>{group.label}</span>
            <small>
              {group.quantity} units · {formatCopper(group.copper)}
            </small>
          </h3>
          <ul>{group.stacks.map(stack)}</ul>
        </section>
      ))}
      {!shown.length ? (
        <p className="py-4 text-muted">
          {holdings.length ? "No matching holdings." : "No items yet."}
        </p>
      ) : null}
      <EditHolding holding={editing} onClose={() => setEditing(null)} />
      <SellPicker holding={selling} onClose={() => setSelling(null)} />
      <BulkGive
        ids={giving}
        onClose={() => setGiving(null)}
        plan={(toId) => plan("give", holdings.filter((h) => giving?.includes(h.id)), toId)}
        onGive={(toId, rows) => {
          setGiving(null);
          void execute(newRun("give", rows, toId));
        }}
      />
    </section>
  );
}

function BulkSummary({
  ok,
  skipped,
  note,
}: {
  ok: Holding[];
  skipped: Array<[Holding, string]>;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>{note}</p>
      <ul className="inventory-summary">
        {ok.slice(0, 8).map((h) => (
          <li key={h.id}>
            {h.name} ×{h.quantity}
          </li>
        ))}
        {ok.length > 8 ? <li>and {ok.length - 8} more</li> : null}
      </ul>
      {skipped.length ? (
        <p className="text-muted">
          Skipped {skipped.length}: {skipped.slice(0, 4).map(([h, why]) => `${h.name} (${why})`).join(", ")}
          {skipped.length > 4 ? ", …" : ""}
        </p>
      ) : null}
      <p className="text-muted">Each entry is its own action with its own receipt.</p>
    </div>
  );
}

function BulkGive({
  ids,
  onClose,
  plan,
  onGive,
}: {
  ids: string[] | null;
  onClose: () => void;
  plan: (toId: string) => { ok: Holding[]; skipped: Array<[Holding, string]> };
  onGive: (toId: string, rows: Holding[]) => void;
}) {
  const { recipients, rosterError } = useGiveRecipients("");
  const [toId, setToId] = useState("");
  useEffect(() => {
    if (ids && !recipients.some((r) => r.id === toId)) setToId(recipients[0]?.id ?? "");
  }, [ids, recipients, toId]);
  const planned = ids && toId ? plan(toId) : { ok: [], skipped: [] };
  return (
    <Modal open={ids !== null} onOpenChange={(open) => !open && onClose()} title="Give selected items">
      {rosterError && !recipients.length ? (
        <p role="alert" className="text-sm">
          {rosterError}
        </p>
      ) : !recipients.length ? (
        <p className="text-sm text-muted">There is no one else to give to.</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (toId && planned.ok.length) onGive(toId, planned.ok);
          }}
        >
          <Field label="Give to">
            <select
              aria-label="Give selected items to"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="min-h-11 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg"
            >
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <BulkSummary
            ok={planned.ok}
            skipped={planned.skipped}
            note="The whole quantity of each entry moves. The party chat shows each transfer."
          />
          <Button type="submit" disabled={!planned.ok.length}>
            Give {planned.ok.length} {planned.ok.length === 1 ? "entry" : "entries"}
          </Button>
        </form>
      )}
    </Modal>
  );
}

/** Edit an item's name, category and notes: an explicit Save, then a toast. */
function EditHolding({ holding, onClose }: { holding: Holding | null; onClose: () => void }) {
  const { updateHolding, catalog } = useEconomy();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!holding) return;
    setName(holding.name);
    setCategory(holding.category || inventoryCategory(holding, catalog));
    setNotes(holding.notes);
    setError("");
  }, [holding, catalog]);
  return (
    <Modal
      open={holding !== null}
      onOpenChange={(open) => !open && onClose()}
      title={holding ? `Edit ${holding.name}` : "Edit item"}
    >
      {holding ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving) return;
            if (!name.trim()) {
              setError("Enter a name.");
              return;
            }
            setSaving(true);
            setError("");
            try {
              const next: Holding = { ...holding, name: name.trim(), notes };
              const trimmed = category.trim();
              if (trimmed && trimmed !== holding.kind) next.category = trimmed;
              else if (!trimmed) delete next.category;
              if (await updateHolding(next)) {
                toast.success(`Saved ${next.name}.`);
                onClose();
              } else setError("Not saved. Your changes are still here.");
            } finally {
              setSaving(false);
            }
          }}
        >
          <Field label="Name">
            <TextInput
              aria-label="Item name"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Inventory category" hint="Groups and filters use it.">
            <TextInput
              aria-label={`Category for ${holding.name}`}
              value={category}
              maxLength={80}
              onChange={(e) => setCategory(e.target.value)}
            />
          </Field>
          <label className="text-sm">
            Notes & source
            <textarea
              aria-label="Item notes"
              className="mt-1 min-h-24 w-full rounded-sm border border-border bg-subtle p-3 text-fg"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <p className="text-sm text-muted">
            Quantity and value change through Give, Sell, the treasure pool or the character sheet,
            so every change has a receipt.
          </p>
          {error ? (
            <p role="alert" className="text-sm">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}

/** Sell to shop: pick a shop, then sell at its counter (the existing sale form, item chosen). */
function SellPicker({ holding, onClose }: { holding: Holding | null; onClose: () => void }) {
  const { shops, journal } = useEconomy();
  const seat = useSeat();
  const groups = useSeatGroups();
  const open = shops.filter(
    (shop) =>
      !shop.closed &&
      (seat.role === "dm" ||
        (seat.shopIds.includes(shop.id) && shopVisible(shop, { journal }, groups))),
  );
  return (
    <Modal
      open={holding !== null}
      onOpenChange={(value) => !value && onClose()}
      title={holding ? `Sell ${holding.name}` : "Sell to a shop"}
    >
      {holding ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            Choose a shop. Its counter opens with this item chosen and shows the payout before you
            sell.
          </p>
          {open.length ? (
            <ul className="inventory-shop-list">
              {open.map((shop) => (
                <li key={shop.id}>
                  <AppLink
                    href={`/shop/${encodeURIComponent(shop.id)}?sell=${encodeURIComponent(holding.id)}#sell`}
                    onClick={onClose}
                  >
                    <strong>{shop.name}</strong>
                    <small>
                      {shop.keeper ? `${shop.keeper} · ` : ""}buys at {Math.round(shop.buyRate * 100)}%
                    </small>
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No shop is open to you here.</p>
          )}
          <AppLink href="/market" onClick={onClose} className="text-sm">
            Open the Market →
          </AppLink>
        </div>
      ) : null}
    </Modal>
  );
}
