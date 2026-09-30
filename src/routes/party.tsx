import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { carryToStandard, explainPurse, formatCoins, formatCopper, parsePrice, toCopper } from "@/lib/quire/money";
import { useDollarText } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import { characterControl, type Purse } from "@/lib/quire/types";
import { Shell } from "@/components/shell";
import { Button, Segmented, Select, TextInput } from "@/components/ui";
import { RemoveButton } from "@/components/quire-ui";

export const Route = createFileRoute("/party")({
  component: PartyPage,
});

function PartyPage() {
  const economy = useEconomy();
  const seat = useSeat();
  const dollars = useDollarText();
  const visible = seat.role === "player" ? economy.purses.filter((purse) => seat.purseIds.includes(purse.id)) : economy.purses;
  const coin = visible.reduce((sum, purse) => sum + toCopper(purse.coins), 0);
  const goods = economy.holdings
    .filter((holding) => visible.some((purse) => purse.id === holding.purseId))
    .reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0);
  const coinDollars = dollars(coin);
  const goodsDollars = dollars(goods);

  return (
    <Shell>
      <h1 className="font-display text-4xl tracking-tight">Party</h1>
      {!economy.ready ? <p className="mt-6 text-muted">Loading…</p> : null}
      {economy.ready ? (
        <>
          <p className="mt-3 text-muted">
            {formatCopper(coin)}
            {coinDollars ? ` (${coinDollars})` : ""} in coin · {formatCopper(goods)}
            {goodsDollars ? ` (${goodsDollars})` : ""} in goods and property
          </p>
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
            <p className="mt-3 text-sm text-muted">You can only use the characters assigned to you.</p>
          )}
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {visible.map((purse) => (
              <PurseCard key={purse.id} purse={purse} />
            ))}
          </div>
          <h2 className="mt-10 font-display text-2xl tracking-tight">Holdings</h2>
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
  const carried = carryToStandard(coins);
  const worthNote = explainPurse(coins);
  const loose = carried.gp !== coins.gp || carried.sp !== coins.sp || carried.cp !== coins.cp || coins.pp > 0 || coins.ep > 0;

  useEffect(() => {
    setCoins(purse.coins);
  }, [purse.coins.cp, purse.coins.sp, purse.coins.ep, purse.coins.gp, purse.coins.pp]);

  return (
    <section className="rounded-xl border border-border p-4">
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
        {loose ? (
          <Button
            variant="secondary"
            onClick={() => {
              setCoins(carried);
              void setPurseCoins(purse.id, carried);
            }}
          >
            Make change
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
    </section>
  );
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
