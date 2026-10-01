import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { loadRoster, type RosterPerson } from "@/lib/quire/gift";
import { carryUpTo, explainPurse, formatCoins, formatCopper, parsePrice, toCopper } from "@/lib/quire/money";
import { useDollarText } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import { characterControl, type Purse } from "@/lib/quire/types";
import { Shell } from "@/components/shell";
import { CharacterSheetPanel } from "@/components/character-sheet";
import { Button, Segmented, Select, TextInput } from "@/components/ui";
import { RemoveButton } from "@/components/quire-ui";

export const Route = createFileRoute("/party")({
  component: PartyPage,
});

function PartyPage() {
  const economy = useEconomy();
  const seat = useSeat();
  const visible = seat.role === "player" ? economy.purses.filter((purse) => seat.purseIds.includes(purse.id)) : economy.purses;
  const coin = visible.reduce((sum, purse) => sum + toCopper(purse.coins), 0);
  const goods = economy.holdings
    .filter((holding) => visible.some((purse) => purse.id === holding.purseId))
    .reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0);

  return (
    <Shell>
      <h1 className="font-display text-4xl tracking-tight">Party</h1>
      {!economy.ready ? <p className="mt-6 text-muted">Loading…</p> : null}
      {economy.ready ? (
        <>
          <section className="mt-4 rounded-2xl border border-lead/25 bg-elevated p-4">
            <p className="text-xs tracking-[0.16em] text-faint uppercase">Combined wealth</p>
            <p className="mt-1 font-display text-4xl tracking-tight text-lead">{formatCopper(coin + goods)}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <span><span className="block text-xs text-faint">Coin</span>{formatCopper(coin)}</span>
              <span><span className="block text-xs text-faint">Items</span>{formatCopper(itemValue(economy.holdings, visible, "item"))}</span>
              <span><span className="block text-xs text-faint">Property</span>{formatCopper(itemValue(economy.holdings, visible, "property"))}</span>
            </div>
          </section>
          <h2 className="mt-5 text-sm font-medium text-muted">Members · {visible.length}</h2>
          <ul className="mt-1 divide-y divide-border border-y border-border">
            {visible.map((purse) => {
              const worth = toCopper(purse.coins) + economy.holdings.filter((holding) => holding.purseId === purse.id).reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0);
              return (
                <li key={purse.id}>
                  <a href={`#purse-${purse.id}`} className="flex min-h-11 items-center justify-between gap-3 text-sm">
                    <span>{purse.name}</span>
                    <span className="tabular-nums text-lead">{formatCopper(worth)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
          {seat.role === "dm" && economy.loans.some((loan) => loan.status === "pending") ? (
            <section className="mt-4">
              <h2 className="text-sm font-medium text-muted">Pending</h2>
              <ul>
                {economy.loans.filter((loan) => loan.status === "pending").map((loan) => (
                  <li key={loan.id} className="flex items-baseline justify-between gap-3 border-b border-border/70 py-2 text-sm">
                    <span>{loan.purseName} · loan</span>
                    <span className="tabular-nums text-lead">{formatCopper(loan.copper)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="mt-1 text-sm text-muted">10 copper = 1 silver. 10 silver = 1 gold. 10 gold = 1 platinum. Electrum is half a gold.</p>
          {seat.role === "dm" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void economy.createPurse("character")}>
                Add character
              </Button>
              <Button variant="secondary" onClick={() => void economy.createPurse("party")}>
                Add party purse
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">You can spend only the characters on your link. You can give coins or holdings to the other players named on that link.</p>
          )}
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {visible.map((purse) => (
              <PurseCard key={purse.id} purse={purse} />
            ))}
          </div>
          <h2 className="mt-10 font-display text-2xl tracking-tight">Shared holdings</h2>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {economy.holdings
              .filter((holding) => visible.some((purse) => purse.id === holding.purseId))
              .map((holding) => {
                const owner = economy.purses.find((purse) => purse.id === holding.purseId);
                return (
                  <li key={holding.id} className="py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span>
                        <span className="block">{holding.name}</span>
                        <span className="text-sm text-muted">
                          {owner?.name ?? "Unassigned"} · {holding.kind} · × {holding.quantity}
                        </span>
                      </span>
                      <span className="text-right text-sm tabular-nums">
                        {formatCopper(holding.unitCopper * holding.quantity)}
                        <DollarLine copper={holding.unitCopper * holding.quantity} />
                      </span>
                    </div>
                    {seat.role === "dm" ? (
                      <RemoveButton
                        className="mt-1"
                        label="Remove"
                        title={`Remove ${holding.name}?`}
                        body="This item is deleted. Money already in a purse is not changed."
                        onRemove={() => void economy.deleteHolding(holding.id)}
                      />
                    ) : null}
                  </li>
                );
              })}
          </ul>
          <AddHolding purses={visible} />
          <GiveToPlayer purses={visible} />
          <Payment purses={visible} />
        </>
      ) : null}
    </Shell>
  );
}

function PurseCard({ purse }: { purse: Purse }) {
  const { updatePurse, setPurseCoins, deletePurse } = useEconomy();
  const seat = useSeat();
  const dollars = useDollarText();
  const [coins, setCoins] = useState(purse.coins);
  const purseDollars = dollars(toCopper(purse.coins));
  const worth = toCopper(coins);
  const worthNote = explainPurse(coins);
  const intoSilver = carryUpTo(coins, "sp");
  const intoGold = carryUpTo(coins, "gp");
  const intoPlatinum = carryUpTo(coins, "pp");
  const changed = (next: typeof coins) => next.cp !== coins.cp || next.sp !== coins.sp || next.ep !== coins.ep || next.gp !== coins.gp || next.pp !== coins.pp;

  useEffect(() => {
    setCoins(purse.coins);
  }, [purse.coins.cp, purse.coins.sp, purse.coins.ep, purse.coins.gp, purse.coins.pp]);

  return (
    <section id={`purse-${purse.id}`} className="rounded-xl border border-lead/25 bg-elevated p-4">
      <TextInput
        aria-label="Purse name"
        defaultValue={purse.name}
        key={purse.name}
        onBlur={(event) => {
          const name = event.target.value.trim();
          if (name && name !== purse.name) void updatePurse({ ...purse, name });
        }}
        className="font-display text-2xl"
      />
      <p className="mt-1 text-sm text-muted">
        {purse.kind === "party" ? "Party purse" : characterControl(purse) === "npc" ? "NPC" : "Player"} · {formatCoins(purse.coins)}
        {purseDollars ? ` · ${purseDollars}` : ""}
      </p>
      {purse.kind === "character" && seat.role === "dm" ? (
        <div className="mt-3">
          <Segmented
            label="Who controls this character"
            value={characterControl(purse) ?? "player"}
            options={[
              { value: "player", label: "Player" },
              { value: "npc", label: "NPC" },
            ]}
            onChange={(control) => void updatePurse({ ...purse, control })}
          />
        </div>
      ) : null}
      <p className="mt-2 text-sm tabular-nums">Worth {formatCopper(worth)}</p>
      {worthNote ? <p className="mt-1 text-sm text-muted">{worthNote}</p> : null}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(
          [
            ["gp", "Gold"],
            ["sp", "Silver"],
            ["cp", "Copper"],
          ] as const
        ).map(([unit, label]) => (
          <label key={unit} className="text-xs text-muted">
            {label}
            <input
              aria-label={label}
              inputMode="numeric"
              value={coins[unit]}
              onChange={(event) => setCoins((current) => ({ ...current, [unit]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))}
              className="mt-1 min-h-11 w-full rounded-sm border border-border bg-subtle px-2 text-center text-base text-fg"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(
          [
            ["pp", "Platinum", "10 gp each"],
            ["ep", "Electrum", "5 sp, half a gold"],
          ] as const
        ).map(([unit, label, hint]) => (
          <label key={unit} className="text-xs text-muted">
            {label}
            <span className="mt-0.5 block text-faint">{hint}</span>
            <input
              aria-label={label}
              inputMode="numeric"
              value={coins[unit]}
              onChange={(event) => setCoins((current) => ({ ...current, [unit]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))}
              className="mt-1 min-h-11 w-full rounded-sm border border-border bg-subtle px-2 text-center text-base text-fg"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void setPurseCoins(purse.id, coins)}>
          Set coins
        </Button>
        {changed(intoSilver) ? (
          <Button variant="secondary" onClick={() => { setCoins(intoSilver); void setPurseCoins(purse.id, intoSilver); }}>
            Into silver
          </Button>
        ) : null}
        {changed(intoGold) ? (
          <Button variant="secondary" onClick={() => { setCoins(intoGold); void setPurseCoins(purse.id, intoGold); }}>
            Into gold
          </Button>
        ) : null}
        {changed(intoPlatinum) ? (
          <Button variant="secondary" onClick={() => { setCoins(intoPlatinum); void setPurseCoins(purse.id, intoPlatinum); }}>
            Into platinum
          </Button>
        ) : null}
        {seat.role === "dm" ? (
          <RemoveButton
            label="Remove purse"
            title={`Remove ${purse.name}?`}
            body="Items on this purse are not deleted."
            onRemove={() => void deletePurse(purse.id)}
          />
        ) : null}
      </div>
      {purse.kind === "character" ? <CharacterSheetPanel purseId={purse.id} /> : null}
    </section>
  );
}

function itemValue(holdings: { purseId: string; kind: string; unitCopper: number; quantity: number }[], purses: { id: string }[], kind: "item" | "property") {
  const ids = new Set(purses.map((purse) => purse.id));
  return holdings.filter((holding) => ids.has(holding.purseId) && holding.kind === kind).reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0);
}

function DollarLine({ copper }: { copper: number }) {
  const dollars = useDollarText();
  const text = dollars(copper);
  if (!text) return null;
  return <span className="block text-muted">{text}</span>;
}

function AddHolding({ purses }: { purses: Purse[] }) {
  const { addHolding } = useEconomy();
  const [purseId, setPurseId] = useState(purses[0]?.id ?? "");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"item" | "property">("item");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");

  useEffect(() => {
    if (!purses.some((purse) => purse.id === purseId)) setPurseId(purses[0]?.id ?? "");
  }, [purses, purseId]);

  return (
    <form
      className="mt-4 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const copper = parsePrice(price);
        if (!purseId || !name.trim() || copper === null) return;
        void addHolding(purseId, name.trim(), kind, Math.max(1, Math.floor(Number(qty) || 1)), copper);
        setName("");
        setPrice("");
      }}
    >
      <Segmented
        label="Holding kind"
        value={kind}
        onChange={setKind}
        options={[
          { value: "item", label: "Item" },
          { value: "property", label: "Property" },
        ]}
      />
      <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="Holding name" />
      <div className="grid grid-cols-2 gap-2">
        <TextInput value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Value, 80 gp" aria-label="Holding value" />
        <TextInput value={qty} onChange={(event) => setQty(event.target.value)} aria-label="Holding quantity" />
      </div>
      <select
        value={purseId}
        onChange={(event) => setPurseId(event.target.value)}
        className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
      >
        {purses.map((purse) => (
          <option key={purse.id} value={purse.id}>
            {purse.name}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary">
        Add holding
      </Button>
    </form>
  );
}

function GiveToPlayer({ purses }: { purses: Purse[] }) {
  const { give, holdings, purses: everyone } = useEconomy();
  const seat = useSeat();
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [fromId, setFromId] = useState(purses[0]?.id ?? "");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [holdingId, setHoldingId] = useState("");
  const [qty, setQty] = useState("1");

  useEffect(() => {
    if (seat.role !== "player") return;
    void loadRoster().then(setRoster);
  }, [seat.role, purses]);

  const recipients =
    seat.role === "dm"
      ? everyone.filter((purse) => purse.id !== fromId).map((purse) => ({ id: purse.id, name: purse.name }))
      : roster;
  const mine = holdings.filter((holding) => holding.purseId === fromId);

  useEffect(() => {
    if (!purses.some((purse) => purse.id === fromId)) setFromId(purses[0]?.id ?? "");
  }, [purses, fromId]);

  useEffect(() => {
    if (recipients.some((person) => person.id === toId)) return;
    setToId(recipients[0]?.id ?? "");
  }, [recipients, toId]);

  useEffect(() => {
    if (holdingId && !mine.some((holding) => holding.id === holdingId)) setHoldingId("");
  }, [mine, holdingId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const copper = amount.trim() ? parsePrice(amount) : 0;
    if (copper === null || copper < 0 || !fromId || !toId) return;
    void give({ fromId, toId, copper, holdingId: holdingId || null, quantity: Math.max(1, Math.floor(Number(qty) || 1)) });
    setAmount("");
    setHoldingId("");
    setQty("1");
  }

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl tracking-tight">Give to a player</h2>
      <p className="mt-1 text-sm text-muted">
        Coins, items, or property move to another player. The party chat shows it, and the dungeon master's bill lists it.
      </p>
      {recipients.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          {seat.role === "player"
            ? "No other players are on this link. They are included the next time the dungeon master copies it."
            : "Add another character before giving something across the party."}
        </p>
      ) : (
        <form className="mt-3 flex flex-col gap-2" onSubmit={submit}>
          <select value={fromId} onChange={(event) => setFromId(event.target.value)} className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg" aria-label="Give from">
            {purses.map((purse) => (
              <option key={purse.id} value={purse.id}>
                From {purse.name}
              </option>
            ))}
          </select>
          <select value={toId} onChange={(event) => setToId(event.target.value)} className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg" aria-label="Give to">
            {recipients.map((person) => (
              <option key={person.id} value={person.id}>
                To {person.name}
              </option>
            ))}
          </select>
          <TextInput value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Coins, 5 gp. Blank sends only a holding." aria-label="Coins to give" />
          <select value={holdingId} onChange={(event) => setHoldingId(event.target.value)} className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg" aria-label="Holding to give">
            <option value="">No holding</option>
            {mine.map((holding) => (
              <option key={holding.id} value={holding.id}>
                {holding.name} · × {holding.quantity}
              </option>
            ))}
          </select>
          {holdingId ? <TextInput value={qty} onChange={(event) => setQty(event.target.value)} aria-label="Quantity to give" /> : null}
          <Button type="submit" variant="secondary">
            Give
          </Button>
        </form>
      )}
    </section>
  );
}

function Payment({ purses }: { purses: Purse[] }) {
  const { post } = useEconomy();
  const [purseId, setPurseId] = useState(purses.find((purse) => purse.kind === "party")?.id ?? purses[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!purses.some((purse) => purse.id === purseId)) setPurseId(purses.find((purse) => purse.kind === "party")?.id ?? purses[0]?.id ?? "");
  }, [purses, purseId]);

  function send(sign: 1 | -1) {
    const copper = parsePrice(amount);
    if (!purseId || copper === null || copper === 0 || !note.trim()) return;
    void post(purseId, copper * sign, note.trim());
    setAmount("");
    setNote("");
  }

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl tracking-tight">A payment</h2>
      <div className="mt-3 flex flex-col gap-2">
        <select
          value={purseId}
          onChange={(event) => setPurseId(event.target.value)}
          className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
          aria-label="Purse for the payment"
        >
          {purses.map((purse) => (
            <option key={purse.id} value={purse.id}>
              {purse.name}
            </option>
          ))}
        </select>
        <TextInput value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount, 5 gp" aria-label="Payment amount" />
        <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="What it was for" aria-label="Payment note" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => send(-1)}>
            Pay out
          </Button>
          <Button variant="secondary" onClick={() => send(1)}>
            Take in
          </Button>
        </div>
      </div>
    </section>
  );
}
