import { SearchSelect } from "@/components/search-select";
import { useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import { readWorld, type Trade } from "@/lib/quire/world-schema";
import { npcAvailableHere, npcController } from "@/lib/quire/world";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { formatCopper } from "@/lib/quire/money";
import type { Holding, Purse } from "@/lib/quire/types";
import type { CloudTable } from "@/lib/quire/cloud";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { CommandForm, CommandButton } from "./world-tools";
import { Button, Fold } from "./ui";
import { AppLink } from "./app-link";
import { FantasyIcon } from "./fantasy-icon";
import { ArrowLeftRight, Coins, PackageOpen, Search, UserRound, X } from "lucide-react";
import { toCopper } from "@/lib/quire/money";
export function CampaignTrading() {
  const t = useWorldTable(),
    world = readWorld(t.journal.world),
    seat = useSeat(),
    dm = seat.role === "dm",
    [editing, setEditing] = useState<Trade | null | undefined>();
  const canAct = (id: string) =>
    dm ||
    seat.purseIds.includes(id) ||
    world.npcs.some((n) => n.id === id && npcController(n, seat));
  const offers = world.trades.filter(
    (o) => dm || canAct(o.left.purseId) || canAct(o.right.purseId),
  );
  const name = (id: string) => t.purses.find((p) => p.id === id)?.name ?? "Former account";
  return (
    <div className="barter-page">
      <header className="barter-heading">
        <div>
          <p className="commodity-eyebrow">The trading table</p>
          <h2>Exchange goods & coins</h2>
        </div>
        <Button onClick={() => setEditing(null)}>New barter offer</Button>
      </header>
      <p className="barter-intro">
        Offer coins, goods or property deeds. The recipient can accept, decline or counter. Nothing
        moves until the current recipient accepts the reviewed offer.
      </p>
      <details className="barter-rules">
        <summary>What can be traded?</summary>
        <p className="text-sm text-muted">
          Stored, in-transit, reserved and service items cannot be bartered. Properties with active
          obligations require the existing DM handover process. Offered lots are checked again at
          acceptance.
        </p>
      </details>
      <AppLink className="settings-link" href="/features/npcs">
        Find nearby NPCs →
      </AppLink>
      {editing !== undefined && (
        <TradeEditor
          key={editing?.id ?? "new"}
          table={t}
          offer={editing ?? undefined}
          close={() => setEditing(undefined)}
        />
      )}
      {offers
        .filter((o) => o.status === "pending")
        .map((o) => (
          <article key={o.id} className="barter-pending">
            <h2>
              {name(o.left.purseId)} ↔ {name(o.right.purseId)}
            </h2>
            <p>
              Awaiting {name(o.awaitingId)} · revision {o.revision + 1}
            </p>
            <OfferReadout table={t} offer={o} />
            <p>{o.note}</p>
            <div className="world-toolbar">
              {canAct(o.awaitingId) && (
                <>
                  <CommandButton
                    input={{
                      kind: "trade-decision",
                      tradeId: o.id,
                      revision: o.revision,
                      actorId: o.awaitingId,
                      decision: "accepted",
                    }}
                  >
                    Accept barter
                  </CommandButton>
                  <Button onClick={() => setEditing(o)}>Counteroffer</Button>
                  <CommandButton
                    input={{
                      kind: "trade-decision",
                      tradeId: o.id,
                      revision: o.revision,
                      actorId: o.awaitingId,
                      decision: "declined",
                    }}
                  >
                    Decline offer
                  </CommandButton>
                </>
              )}
              {[o.left.purseId, o.right.purseId]
                .filter(canAct)
                .slice(0, 1)
                .map((id) => (
                  <CommandButton
                    key={id}
                    input={{
                      kind: "trade-decision",
                      tradeId: o.id,
                      revision: o.revision,
                      actorId: id,
                      decision: "cancelled",
                    }}
                  >
                    Cancel offer
                  </CommandButton>
                ))}
            </div>
          </article>
        ))}
      {!offers.some((o) => o.status === "pending") && <p>No pending barter offers.</p>}
      <Fold title="Trade history">
        {offers
          .filter((o) => o.status !== "pending")
          .map((o) => (
            <article key={o.id} className="journal-entry">
              <h3>
                {name(o.left.purseId)} ↔ {name(o.right.purseId)} · {o.status}
              </h3>
              <OfferReadout table={t} offer={o} />
              <p>{o.note}</p>
            </article>
          ))}
      </Fold>
    </div>
  );
}
function OfferReadout({ table, offer }: { table: CloudTable; offer: Trade }) {
  return (
    <div className="barter-readout">
      {[offer.left, offer.right].map((side) => (
        <section key={side.purseId} className="barter-tray">
          <Participant table={table} id={side.purseId} />
          <p className="barter-coins">
            <Coins size={16} aria-hidden="true" />
            {formatCopper(side.copper)} offered
          </p>
          <div className="barter-readout-items">
            {side.items.map((i) => {
              const h = JSON.parse(i.before) as Holding;
              return (
                <div key={i.holdingId} className="barter-offered-lot">
                  <LotArt holding={h} />
                  <div>
                    <strong>
                      {i.quantity} × {h.name}
                    </strong>
                    <small>
                      {h.kind === "property" ? "Property deed · " : ""}
                      {formatCopper(h.unitCopper * i.quantity)} recorded value
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
          {!side.items.length && <p className="barter-empty">No goods offered</p>}
        </section>
      ))}
    </div>
  );
}
function TradeEditor({
  table,
  offer,
  close,
}: {
  table: CloudTable;
  offer?: Trade;
  close: () => void;
}) {
  const seat = useSeat(),
    dm = seat.role === "dm",
    world = readWorld(table.journal?.world),
    canAct = (id: string) =>
      dm ||
      seat.purseIds.includes(id) ||
      world.npcs.some((n) => n.id === id && npcController(n, seat));
  const directory: Purse[] = [
    ...table.purses,
    ...(world.partyCharacters ?? [])
      .filter((p) => !table.purses.some((owned) => owned.id === p.id))
      .map((p) => ({
        ...p,
        kind: "character" as const,
        coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      })),
  ];
  const accounts = directory.filter(
      (p) =>
        !table.journal?.tradeEconomy?.exchanges.some((e) => e.purseId === p.id) &&
        (p.nonParty
          ? world.npcs.some((n) => n.id === p.id && n.barterAllowed && npcAvailableHere(n, table))
          : p.kind === "party" || p.control !== "npc"),
    ),
    actors = accounts.filter((p) => canAct(p.id));
  const [leftId, setLeftId] = useState(offer?.left.purseId ?? actors[0]?.id ?? ""),
    [rightId, setRightId] = useState(
      offer?.right.purseId ?? accounts.find((p) => p.id !== actors[0]?.id)?.id ?? "",
    ),
    [leftCoins, setLeftCoins] = useState(String(offer?.left.copper ?? 0)),
    [rightCoins, setRightCoins] = useState(String(offer?.right.copper ?? 0)),
    [leftItems, setLeftItems] = useState<Record<string, number>>(
      Object.fromEntries(offer?.left.items.map((i) => [i.holdingId, i.quantity]) ?? []),
    ),
    [rightItems, setRightItems] = useState<Record<string, number>>(
      Object.fromEntries(offer?.right.items.map((i) => [i.holdingId, i.quantity]) ?? []),
    ),
    [note, setNote] = useState(offer?.note ?? "");
  const actorId = offer?.awaitingId ?? leftId;
  function lots(purseId: string, side?: Trade["left"]) {
    if (dm || canAct(purseId) || world.npcs.some((n) => n.id === purseId))
      return table.holdings.filter(
        (h) =>
          h.purseId === purseId && h.quantity > 0 && !h.custody && !h.reservedFor && !h.service,
      );
    return side?.items.map((i) => JSON.parse(i.before) as Holding) ?? [];
  }
  const leftLots = lots(leftId, offer?.left),
    rightLots = lots(rightId, offer?.right);
  const side = (
    purseId: string,
    copper: string,
    selected: Record<string, number>,
    available: Holding[],
  ) => ({
    purseId,
    copper: Number(copper),
    items: Object.entries(selected)
      .filter(([, quantity]) => quantity > 0)
      .map(([id, quantity]) => {
        const h = available.find((h) => h.id === id);
        if (!h) throw Error("An offered item is no longer available. Review the inventory.");
        return { holdingId: id, quantity, before: canonicalJson(h) };
      }),
  });
  return (
    <section className="barter-table">
      <div className="barter-table-title">
        <ArrowLeftRight size={20} aria-hidden="true" />
        <h2>{offer ? "Review counteroffer" : "Propose a barter"}</h2>
        <span>Barter</span>
      </div>
      <CommandForm
        label={offer ? "Send counteroffer" : "Send barter offer"}
        dirty
        submit={() => ({
          kind: "trade-offer",
          tradeId: offer?.id ?? crypto.randomUUID(),
          revision: offer?.revision ?? null,
          actorId,
          left: side(leftId, leftCoins, leftItems, leftLots),
          right: side(rightId, rightCoins, rightItems, rightLots),
          note,
        })}
        onDone={close}
      >
        <div className="barter-workspace">
          <section className="barter-side barter-side-left">
            <Participant
              table={table}
              id={leftId}
              showBalance={dm || canAct(leftId) || world.npcs.some((n) => n.id === leftId)}
            />
            <label>
              {offer ? "First participant" : "Your offering account"}
              <SearchSelect
                aria-label={offer ? "First participant" : "Your offering account"}
                required
                value={leftId}
                disabled={!!offer}
                onValueChange={(selectedValue) => {
                  setLeftId(selectedValue);
                  setLeftItems({});
                  setLeftCoins("0");
                  if (selectedValue === rightId) {
                    setRightId(accounts.find((p) => p.id !== selectedValue)?.id ?? "");
                    setRightItems({});
                    setRightCoins("0");
                  }
                }}
              >
                {(offer ? accounts : actors).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SearchSelect>
            </label>
            <ItemOfferPicker
              label="First side"
              lots={leftLots}
              selected={leftItems}
              setSelected={setLeftItems}
              copper={leftCoins}
              setCopper={setLeftCoins}
              direction="offer"
            />
          </section>
          <section className="barter-side barter-side-right">
            <Participant
              table={table}
              id={rightId}
              showBalance={dm || canAct(rightId) || world.npcs.some((n) => n.id === rightId)}
            />
            <label>
              Other participant
              <SearchSelect
                aria-label="Other participant"
                required
                value={rightId}
                disabled={!!offer}
                onValueChange={(selectedValue) => {
                  setRightId(selectedValue);
                  setRightItems({});
                  setRightCoins("0");
                }}
              >
                {accounts
                  .filter((p) => p.id !== leftId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.nonParty ? " (NPC)" : ""}
                    </option>
                  ))}
              </SearchSelect>
            </label>
            <ItemOfferPicker
              label="Second side"
              lots={rightLots}
              selected={rightItems}
              setSelected={setRightItems}
              copper={rightCoins}
              setCopper={setRightCoins}
              direction="request"
            />
            {!rightLots.length && (
              <p className="barter-private">
                The other player adds their own goods in a counteroffer. Their private inventory is
                not displayed.
              </p>
            )}
          </section>
        </div>
        <div className="barter-review-band">
          <ArrowLeftRight size={18} aria-hidden="true" />
          <p>Review both offer trays. Nothing moves until the recipient accepts.</p>
        </div>
        <label>
          Barter note
          <textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p>
          The other side must accept this exact offer. Submitting a counteroffer makes them the
          recipient again.
        </p>
      </CommandForm>
      <Button
        onClick={() => {
          if (window.confirm("Close this unsaved offer?")) close();
        }}
      >
        Close offer editor
      </Button>
    </section>
  );
}
function ItemOfferPicker({
  label,
  lots,
  selected,
  setSelected,
  copper,
  setCopper,
  direction,
}: {
  label: string;
  lots: Holding[];
  selected: Record<string, number>;
  setSelected: (s: Record<string, number>) => void;
  copper: string;
  setCopper: (s: string) => void;
  direction: "offer" | "request";
}) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [limit, setLimit] = useState(24);
  const categoryOf = (h: Holding) => (h.kind === "property" ? "Deeds" : h.category || "Goods");
  const categories = [...new Set(lots.map(categoryOf))].sort();
  const filtered = lots.filter(
    (h) =>
      (category === "all" || categoryOf(h) === category) &&
      `${h.name} ${categoryOf(h)} ${h.notes}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim()),
  );
  const offered = lots.filter((h) => (selected[h.id] ?? 0) > 0);
  const recordedValue =
    offered.reduce((total, h) => total + h.unitCopper * selected[h.id], 0) + (Number(copper) || 0);
  return (
    <div className="barter-picker">
      <div className="barter-inventory">
        <div className="barter-section-label">
          <h3>Inventory</h3>
          <small>{lots.length} lots</small>
        </div>
        <label className="barter-search">
          <span className="sr-only">{label} inventory search</span>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search goods or deeds…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(24);
            }}
          />
        </label>
        <div className="barter-categories" aria-label={`${label} inventory categories`}>
          {["all", ...categories].map((c) => (
            <button
              type="button"
              key={c}
              aria-pressed={category === c}
              onClick={() => {
                setCategory(c);
                setLimit(24);
              }}
            >
              {c === "all" ? "All" : c}
            </button>
          ))}
        </div>
        <div className="barter-inventory-grid">
          {filtered.slice(0, limit).map((h) => (
            <button
              type="button"
              className="barter-tile"
              key={h.id}
              aria-pressed={(selected[h.id] ?? 0) > 0}
              aria-label={`${(selected[h.id] ?? 0) > 0 ? "Remove" : "Add"} ${h.name} ${direction === "offer" ? "to" : "from"} ${label} offer`}
              title={`${h.name} · ${h.quantity} available · ${formatCopper(h.unitCopper)} each${h.kind === "property" ? " · Property deed" : ""}`}
              onClick={() =>
                setSelected({ ...selected, [h.id]: (selected[h.id] ?? 0) > 0 ? 0 : 1 })
              }
            >
              <LotArt holding={h} />
              <span className="barter-tile-count">{h.quantity}</span>
              <span className="barter-tile-name">{h.name}</span>
            </button>
          ))}
        </div>
        {!filtered.length && (
          <p className="barter-empty">
            {lots.length ? "No matching goods." : "No available goods."}
          </p>
        )}
        {filtered.length > limit && (
          <Button variant="secondary" onClick={() => setLimit(limit + 48)}>
            Show more {label.toLowerCase()} goods ({filtered.length - limit})
          </Button>
        )}
        <p className="barter-hint">
          Tap goods to add or remove them. Set quantities in the offer tray.
        </p>
      </div>
      <div className="barter-tray barter-edit-tray">
        <div className="barter-section-label">
          <h3>{direction === "offer" ? "Offering" : "Requesting"}</h3>
          <PackageOpen size={17} aria-hidden="true" />
        </div>
        <label className="barter-coin-input">
          {label} coins (copper)
          <input
            aria-label={`${label} coins (copper)`}
            type="number"
            min={0}
            max={1e12}
            step={1}
            required
            value={copper}
            onChange={(e) => setCopper(e.target.value)}
          />
          <small>{formatCopper(Number(copper) || 0)}</small>
        </label>
        <div className="barter-offer-lots">
          {offered.map((h) => (
            <div key={h.id} className="barter-offered-lot">
              <LotArt holding={h} />
              <label>
                <strong>{h.name}</strong>
                <small>
                  {h.kind === "property" ? "Property deed · " : ""}
                  {h.quantity} available · {formatCopper(h.unitCopper)} each
                </small>
                <input
                  aria-label={`${label}: ${h.name} quantity`}
                  type="number"
                  min={0}
                  max={h.quantity}
                  step={1}
                  value={selected[h.id] ?? 0}
                  onChange={(e) => setSelected({ ...selected, [h.id]: Number(e.target.value) })}
                />
              </label>
              <button
                type="button"
                className="barter-remove"
                aria-label={`Remove ${h.name} from ${label} tray`}
                onClick={() => setSelected({ ...selected, [h.id]: 0 })}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
          {!offered.length && (
            <div className="barter-empty-tray">
              <PackageOpen size={28} aria-hidden="true" />
              <p>Add goods from inventory</p>
            </div>
          )}
        </div>
        <p className="barter-tray-value">
          <span>Recorded offer value</span>
          <strong>{formatCopper(recordedValue)}</strong>
        </p>
        <p className="barter-hint">Saved item values and coins; participants agree the terms.</p>
      </div>
    </div>
  );
}

function LotArt({ holding }: { holding: Holding }) {
  return (
    <span className="barter-lot-art">
      {holding.image ? (
        <img src={holding.image} alt="" loading="lazy" />
      ) : (
        <FantasyIcon entry={holding} size={32} />
      )}
    </span>
  );
}

function Participant({
  table,
  id,
  showBalance = false,
}: {
  table: CloudTable;
  id: string;
  showBalance?: boolean;
}) {
  const world = readWorld(table.journal?.world),
    purse = table.purses.find((p) => p.id === id),
    person = purse ?? world.partyCharacters?.find((p) => p.id === id),
    npc = world.npcs.find((n) => n.id === id),
    portrait = purse?.portrait || purse?.sheet?.portrait || npc?.portrait;
  return (
    <header className="barter-participant">
      <div className="barter-portrait">
        {portrait ? (
          <img src={portrait} alt={`${person?.name ?? "Participant"} portrait`} />
        ) : (
          <UserRound size={42} aria-hidden="true" />
        )}
      </div>
      <h3>{person?.name ?? "Former account"}</h3>
      <p>
        {purse?.sheet
          ? `Level ${purse.sheet.level} · ${purse.sheet.classes || purse.sheet.species || "Character"}`
          : npc
            ? "Nearby trader"
            : purse?.kind === "party"
              ? "Party treasury"
              : "Campaign character"}
      </p>
      {showBalance && purse && (
        <div className="barter-wallet">
          <Coins size={16} aria-hidden="true" />
          {formatCopper(toCopper(purse.coins))}
          <small>available funds</small>
        </div>
      )}
    </header>
  );
}
