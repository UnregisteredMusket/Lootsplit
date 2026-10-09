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
    <div>
      <p>
        Offer coins, goods or property deeds. The recipient can accept, decline or counter. Nothing
        moves until the current recipient accepts the reviewed offer.
      </p>
      <p className="text-sm text-muted">
        Stored, in-transit, reserved and service items cannot be bartered. Properties with active
        obligations require the existing DM handover process. Offered lots are checked again at
        acceptance.
      </p>
      <AppLink className="settings-link" href="/features/npcs">
        Find nearby NPCs →
      </AppLink>
      <Button onClick={() => setEditing(null)}>New barter offer</Button>
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
          <article key={o.id} className="world-card">
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
    <div className="world-columns">
      {[offer.left, offer.right].map((side) => (
        <div key={side.purseId}>
          <h3>{table.purses.find((p) => p.id === side.purseId)?.name ?? "Former account"} gives</h3>
          <p>{formatCopper(side.copper)}</p>
          {side.items.map((i) => {
            const h = JSON.parse(i.before) as Holding;
            return (
              <p key={i.holdingId}>
                {i.quantity} × {h.name}
                {h.kind === "property" ? " · Property deed" : ""}
              </p>
            );
          })}
        </div>
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
  const accounts = directory.filter((p) =>
      p.nonParty
        ? world.npcs.some((n) => n.id === p.id && n.barterAllowed && npcAvailableHere(n, table))
        : p.kind === "party" || p.control !== "npc",
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
    <section className="world-card">
      <h2>{offer ? "Review counteroffer" : "Propose a barter"}</h2>
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
        <div className="world-columns">
          <div>
            <label>
              {offer ? "First participant" : "Your offering account"}
              <select
                aria-label={offer ? "First participant" : "Your offering account"}
                required
                value={leftId}
                disabled={!!offer}
                onChange={(e) => {
                  setLeftId(e.target.value);
                  setLeftItems({});
                  setLeftCoins("0");
                }}
              >
                {(offer ? accounts : actors).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <ItemOfferPicker
              label="First side"
              lots={leftLots}
              selected={leftItems}
              setSelected={setLeftItems}
              copper={leftCoins}
              setCopper={setLeftCoins}
            />
          </div>
          <div>
            <label>
              Other participant
              <select
                aria-label="Other participant"
                required
                value={rightId}
                disabled={!!offer}
                onChange={(e) => {
                  setRightId(e.target.value);
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
              </select>
            </label>
            <ItemOfferPicker
              label="Second side"
              lots={rightLots}
              selected={rightItems}
              setSelected={setRightItems}
              copper={rightCoins}
              setCopper={setRightCoins}
            />
            {!rightLots.length && (
              <p>
                The other player adds their own goods in a counteroffer. Their private inventory is
                not displayed.
              </p>
            )}
          </div>
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
}: {
  label: string;
  lots: Holding[];
  selected: Record<string, number>;
  setSelected: (s: Record<string, number>) => void;
  copper: string;
  setCopper: (s: string) => void;
}) {
  return (
    <>
      <label>
        {label} coins (copper)
        <input
          type="number"
          min={0}
          max={1e12}
          step={1}
          required
          value={copper}
          onChange={(e) => setCopper(e.target.value)}
        />
      </label>
      {lots.map((h) => (
        <label key={h.id}>
          {h.name}
          {h.kind === "property" ? " (deed)" : ""} · {h.quantity} available
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
      ))}
    </>
  );
}
