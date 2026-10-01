import { useEffect, useState, type FormEvent } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { formatCopper, parsePrice, priceAfterCharisma, charismaOffPercent } from "@/lib/quire/money";
import { charismaScore } from "@/lib/quire/sheet";
import { useDollarText } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import type { Listing } from "@/lib/quire/market";
import { Button, Fold, Segmented, TextInput } from "@/components/ui";

export function MarketBoard() {
  const seat = useSeat();
  return (
    <>
      <Fold title="Holdings and property" hint="Items and places for sale, apart from the shops.">
        <Listings />
      </Fold>
      <Fold title="Loans" hint="A player asks. The dungeon master approves or denies.">
        {seat.role === "dm" ? <LoanQueue /> : <LoanAskForm />}
      </Fold>
    </>
  );
}

function Listings() {
  const { listings, purses, buyListing, addListing, removeListing } = useEconomy();
  const seat = useSeat();
  const dollars = useDollarText();
  const mine = seat.role === "player" ? purses.filter((purse) => seat.purseIds.includes(purse.id)) : purses;
  const shown = seat.role === "player" ? listings.filter((listing) => listing.quantity !== 0) : listings;

  return (
    <div>
      <p className="text-sm text-muted">
        {seat.role === "dm"
          ? "Post a holding or a property. A player pays from their account and it becomes theirs."
          : "Buy a holding or a property with the account on this link. The dungeon master sees the purchase on your activity report."}
      </p>
      {shown.length === 0 ? <p className="mt-3 text-sm text-muted">Nothing is listed.</p> : null}
      <ul className="mt-3 flex flex-col gap-3">
        {shown.map((listing) => (
          <li key={listing.id} className="rounded-lg border border-border p-3">
            <p className="font-medium">{listing.name}</p>
            <p className="text-sm text-muted">
              {listing.kind === "property" ? "Property" : "Holding"} · {formatCopper(listing.copper)}
              {dollars(listing.copper) ? ` (${dollars(listing.copper)})` : ""} · {listing.quantity === null ? "Unlimited" : `${listing.quantity} left`}
            </p>
            {listing.notes ? <p className="mt-1 text-sm text-muted">{listing.notes}</p> : null}
            {seat.role === "dm" ? (
              <Button className="mt-2" variant="ghost" onClick={() => void removeListing(listing.id)}>
                Remove
              </Button>
            ) : (
              <BuyListing listing={listing} purses={mine} onBuy={(purseId, quantity) => void buyListing(listing.id, purseId, quantity)} />
            )}
          </li>
        ))}
      </ul>
      {seat.role === "dm" ? <ListingForm onAdd={addListing} /> : null}
    </div>
  );
}

function BuyListing({
  listing,
  purses,
  onBuy,
}: {
  listing: Listing;
  purses: { id: string; name: string }[];
  onBuy: (purseId: string, quantity: number) => void;
}) {
  const [purseId, setPurseId] = useState(purses[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const { sheets } = useEconomy();
  const score = charismaScore(sheets.find((sheet) => sheet.purseId === purseId));
  const percent = score === null ? 0 : charismaOffPercent(score);
  const unit = priceAfterCharisma(listing.copper, score);
  useEffect(() => {
    if (!purses.some((purse) => purse.id === purseId)) setPurseId(purses[0]?.id ?? "");
  }, [purses, purseId]);
  if (purses.length === 0) return <p className="mt-2 text-sm text-muted">This link has no account that can pay.</p>;
  return (
    <form
      className="mt-2 flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (!purseId) return;
        onBuy(purseId, Math.max(1, Math.floor(Number(qty) || 1)));
      }}
    >
      <select value={purseId} onChange={(event) => setPurseId(event.target.value)} className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg" aria-label={`Pay for ${listing.name} from`}>
        {purses.map((purse) => (
          <option key={purse.id} value={purse.id}>
            {purse.name}
          </option>
        ))}
      </select>
      {listing.quantity === 1 ? null : <TextInput value={qty} onChange={(event) => setQty(event.target.value)} aria-label={`Quantity of ${listing.name}`} />}
      <Button type="submit" variant="secondary">
        Buy {formatCopper(unit)}
      </Button>
      {percent > 0 ? <p className="text-sm text-muted sm:self-center">Charisma {score} takes {percent}% off.</p> : null}
    </form>
  );
}

function ListingForm({ onAdd }: { onAdd: (input: { name: string; kind: Listing["kind"]; copper: number; quantity: number | null; notes: string }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Listing["kind"]>("property");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const copper = parsePrice(price);
    if (!name.trim() || copper === null) return;
    const quantity = qty.trim() === "" ? null : Math.max(0, Math.floor(Number(qty)));
    if (qty.trim() !== "" && Number.isNaN(quantity)) return;
    void onAdd({ name: name.trim(), kind, copper, quantity, notes: notes.trim() });
    setName("");
    setPrice("");
    setNotes("");
    setQty(kind === "property" ? "1" : "");
  }

  return (
    <form className="mt-4 flex flex-col gap-2" onSubmit={submit}>
      <Segmented
        label="Listing kind"
        value={kind}
        onChange={setKind}
        options={[
          { value: "property", label: "Property" },
          { value: "item", label: "Holding" },
        ]}
      />
      <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "property" ? "Old mill" : "Wagon"} aria-label="Listing name" />
      <div className="grid grid-cols-2 gap-2">
        <TextInput value={price} onChange={(event) => setPrice(event.target.value)} placeholder="80 gp" aria-label="Listing price" />
        <TextInput value={qty} onChange={(event) => setQty(event.target.value)} placeholder="Qty, blank if unlimited" aria-label="Listing quantity" />
      </div>
      <TextInput value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Note, optional" aria-label="Listing note" />
      <Button type="submit" variant="secondary">
        Post listing
      </Button>
    </form>
  );
}

function LoanAskForm() {
  const { purses, loans, askLoan } = useEconomy();
  const seat = useSeat();
  const mine = purses.filter((purse) => seat.purseIds.includes(purse.id));
  const [purseId, setPurseId] = useState(mine[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const asked = loans.filter((loan) => mine.some((purse) => purse.id === loan.purseId));

  useEffect(() => {
    if (!mine.some((purse) => purse.id === purseId)) setPurseId(mine[0]?.id ?? "");
  }, [mine, purseId]);

  return (
    <div>
      <p className="text-sm text-muted">Request a loan from the DM. Funds are added only after the loan is approved.</p>
      {asked.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {asked.map((loan) => (
            <li key={loan.id} className="text-sm">
              <span className="font-medium">{formatCopper(loan.copper)}</span>
              <span className="text-muted"> · {loan.note} · {loan.status === "pending" ? "Waiting" : loan.status === "approved" ? "Approved" : "Denied"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {mine.length === 0 ? <p className="mt-3 text-sm text-muted">This link has no account to borrow for.</p> : (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const copper = parsePrice(amount);
            if (!purseId || copper === null || !note.trim()) return;
            void askLoan(purseId, copper, note.trim());
            setAmount("");
            setNote("");
          }}
        >
          <select value={purseId} onChange={(event) => setPurseId(event.target.value)} className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg" aria-label="Borrow for">
            {mine.map((purse) => (
              <option key={purse.id} value={purse.id}>
                {purse.name}
              </option>
            ))}
          </select>
          <TextInput value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="50 gp" aria-label="Loan amount" />
          <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="What it is for" aria-label="Loan reason" />
          <Button type="submit" variant="secondary">
            Request loan
          </Button>
        </form>
      )}
    </div>
  );
}

function LoanQueue() {
  const { loans, decideLoan } = useEconomy();
  const waiting = loans.filter((loan) => loan.status === "pending");
  const answered = loans.filter((loan) => loan.status !== "pending").slice(-6).reverse();
  return (
    <div>
      <p className="text-sm text-muted">Requests arrive through player activity reports or shared campaign updates. Approval adds funds to the character’s account; denial adds nothing.</p>
      {waiting.length === 0 ? <p className="mt-3 text-sm text-muted">No loans waiting.</p> : null}
      <ul className="mt-3 flex flex-col gap-3">
        {waiting.map((loan) => (
          <li key={loan.id} className="rounded-lg border border-border p-3">
            <p className="font-medium">{loan.purseName} · {formatCopper(loan.copper)}</p>
            <p className="mt-1 text-sm text-muted">{loan.note}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => void decideLoan(loan.id, "approved")}>Approve</Button>
              <Button variant="secondary" onClick={() => void decideLoan(loan.id, "denied")}>Deny</Button>
            </div>
          </li>
        ))}
      </ul>
      {answered.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1">
          {answered.map((loan) => (
            <li key={loan.id} className="text-sm text-muted">
              {loan.purseName} · {formatCopper(loan.copper)} · {loan.status === "approved" ? "Approved" : "Denied"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
