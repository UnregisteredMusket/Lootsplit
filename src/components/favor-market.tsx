/**
 * The favor market (favor-market.ts; owner design 2026-11-05) inside each faction on
 * /features/factions. The DM writes the entries (none by default; "Add from template" only fills
 * the form), approves or declines players' requests, and records purchases directly. Players ask
 * for visible entries with their own character's Favor, see their own requests and read the
 * secrets they bought. An item entry moves no items: after approval the DM hands it over with
 * Party › Add loot.
 */
import { useState, type FormEvent } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { factionCharacter, standingOf, type Faction } from "@/lib/quire/factions";
import { favorMarketOf, favorRequestsOf } from "@/lib/quire/favor-market";
import {
  FAVOR_TEMPLATES,
  favorEntryKinds,
  MAX_FAVOR_COST,
  type FavorEntry,
  type FavorEntryKind,
  type FavorRequest,
} from "@/lib/quire/favor-market-schema";
import type { CommandInput } from "@/lib/quire/commands";
import type { Purse } from "@/lib/quire/types";
import { AppLink } from "./app-link";
import { Status, useFactionCommand } from "./faction-command";
import { Badge, Button, Field, Fold, Select, TextArea, TextInput } from "./ui";

const KIND_LABEL: Record<FavorEntryKind, string> = {
  favor: "Favor",
  item: "Item",
  secret: "Secret",
  service: "Service",
  other: "Other",
};
const STATUS_LABEL: Record<FavorRequest["status"], string> = {
  pending: "Waiting for the DM",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

function nameOf(purses: Purse[], id: string) {
  return purses.find((p) => p.id === id)?.name ?? "A departed character";
}

/** One request or purchase, as its own player or the DM reads it. */
function RequestLine({ request, who, dm }: { request: FavorRequest; who?: string; dm?: boolean }) {
  return (
    <div className="grid gap-1 text-sm" data-testid="favor-request" data-status={request.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{request.name}</span>
        <span className="text-muted">
          {request.cost} Favor{who ? ` · ${who}` : ""}
        </span>
        <Badge>{request.direct ? "Recorded by the DM" : STATUS_LABEL[request.status]}</Badge>
      </div>
      {request.note ? <p className="text-muted">“{request.note}”</p> : null}
      {request.reply ? <p className="text-muted">DM: {request.reply}</p> : null}
      {request.status === "approved" && request.secret ? (
        <p className="favor-secret" data-testid="favor-secret">
          {request.secret}
        </p>
      ) : null}
      {dm && request.status === "approved" && request.kind === "item" ? (
        <p className="text-faint">
          Hand the item over with <AppLink href="/party?action=add">Party › Add loot</AppLink>; approving moved no items.
        </p>
      ) : null}
    </div>
  );
}

// --- Players ---

export function PlayerFavorMarket({ faction, characters }: { faction: Faction; characters: Purse[] }) {
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const chosen = characters.find((p) => p.id === characterId) ?? characters[0];
  const entries = favorMarketOf(faction);
  const mine = favorRequestsOf(faction);
  if (!chosen || (!entries.length && !mine.length)) return null;
  const { favor } = standingOf(faction, chosen.id);
  return (
    <Fold title="Favor market" hint={`${entries.length} on offer · ${favor} Favor`}>
      <div className="grid gap-3" data-testid="player-favor-market">
        <p className="text-sm text-muted">
          Ask for something with your Favor. The DM decides; Favor is spent only when they approve.
        </p>
        {characters.length > 1 ? (
          <Field label="Asking as">
            <Select aria-label="Asking as" value={chosen.id} onChange={(e) => setCharacterId(e.target.value)}>
              {characters.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({standingOf(faction, p.id).favor} Favor)
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {entries.length ? (
          <ul className="grid gap-3">
            {entries.map((e) => (
              <AskRow key={e.id} faction={faction} entry={e} character={chosen} favor={favor} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-faint">Nothing on offer right now.</p>
        )}
        {mine.length ? (
          <section aria-label="Your requests" className="grid gap-2">
            <h3 className="text-sm font-medium">Your requests and purchases</h3>
            {[...mine].reverse().map((r) => (
              <OwnRequest key={r.id} faction={faction} request={r} who={characters.length > 1 ? nameOf(characters, r.characterId) : undefined} />
            ))}
          </section>
        ) : null}
      </div>
    </Fold>
  );
}

function AskRow({ faction, entry, character, favor }: { faction: Faction; entry: FavorEntry; character: Purse; favor: number }) {
  const [note, setNote] = useState("");
  const command = useFactionCommand(`${faction.id}|ask|${entry.id}|${character.id}|${note}`);
  const short = favor < entry.cost;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await command.send(
      {
        kind: "favor-request",
        factionId: faction.id,
        entryId: entry.id,
        characterId: character.id,
        cost: entry.cost,
        ...(note.trim() ? { note: note.trim() } : {}),
      } as CommandInput,
      "Request sent to the DM.",
    );
    if (ok) setNote("");
  }
  return (
    <li className="favor-entry grid gap-2 border-l border-border pl-3" data-testid="favor-entry">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{entry.name}</span>
        <span className="text-sm text-muted">
          {entry.cost} Favor · {KIND_LABEL[entry.kind]}
        </span>
        {!entry.available ? <Badge>Not available now</Badge> : null}
      </div>
      {entry.description ? <p className="text-sm text-muted">{entry.description}</p> : null}
      {entry.available ? (
        <form className="favor-ask grid gap-2" onSubmit={submit}>
          <Field label="Note to the DM (optional)">
            <TextInput aria-label={`Note for ${entry.name}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" disabled={command.busy || short}>
              {command.busy ? "Sending…" : short ? `Needs ${entry.cost} Favor` : "Ask for this"}
            </Button>
          </div>
          <Status error={command.error} notice={command.notice} />
        </form>
      ) : null}
    </li>
  );
}

function OwnRequest({ faction, request, who }: { faction: Faction; request: FavorRequest; who?: string }) {
  const withdraw = useFactionCommand(`${faction.id}|withdraw|${request.id}`);
  return (
    <div className="grid gap-1 border-l border-border pl-3">
      <RequestLine request={request} who={who} />
      {request.status === "pending" ? (
        <div>
          <Button
            variant="secondary"
            disabled={withdraw.busy}
            onClick={() =>
              void withdraw.send({ kind: "favor-withdraw", factionId: faction.id, requestId: request.id } as CommandInput, "Request withdrawn.")
            }
          >
            Withdraw
          </Button>
        </div>
      ) : null}
      <Status error={withdraw.error} notice={withdraw.notice} />
    </div>
  );
}

// --- The DM ---

type EntryDraft = { name: string; description: string; cost: string; kind: FavorEntryKind; available: boolean; hidden: boolean; secret: string; note: string };
const blank = (): EntryDraft => ({ name: "", description: "", cost: "1", kind: "favor", available: true, hidden: false, secret: "", note: "" });
const draftOf = (e: FavorEntry): EntryDraft => ({
  name: e.name,
  description: e.description,
  cost: String(e.cost),
  kind: e.kind,
  available: e.available,
  hidden: e.hidden,
  secret: e.secret ?? "",
  note: e.note ?? "",
});

function EntryForm({ faction, before, onDone }: { faction: Faction; before: FavorEntry | null; onDone?: () => void }) {
  const [d, setD] = useState<EntryDraft>(before ? draftOf(before) : blank());
  // A new entry's ID, renewed after each add so the next one is its own entry.
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const entryId = before?.id ?? newId;
  const command = useFactionCommand(`${faction.id}|entry|${entryId}|${faction.revision}`);
  const [problem, setProblem] = useState("");
  const set = (patch: Partial<EntryDraft>) => setD((x) => ({ ...x, ...patch }));
  async function save(e: FormEvent) {
    e.preventDefault();
    const cost = Number(d.cost);
    if (!d.name.trim()) return setProblem("Name the entry.");
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > MAX_FAVOR_COST) return setProblem("Cost is a whole number of Favor, 0 or more.");
    setProblem("");
    const entry: FavorEntry = {
      id: entryId,
      name: d.name.trim(),
      description: d.description.trim(),
      cost,
      kind: d.kind,
      available: d.available,
      hidden: d.hidden,
      ...(d.secret.trim() ? { secret: d.secret.trim() } : {}),
      ...(d.note.trim() ? { note: d.note.trim() } : {}),
    };
    const ok = await command.send(
      { kind: "favor-entry", factionId: faction.id, revision: faction.revision, entryId, entry } as CommandInput,
      before ? "Entry saved." : "Entry added.",
    );
    if (ok) {
      if (!before) {
        setD(blank());
        setNewId(crypto.randomUUID());
      }
      onDone?.();
    }
  }
  return (
    <form className="faction-form grid gap-3" onSubmit={save} data-testid={`favor-entry-form-${before ? "edit" : "add"}`}>
      {!before ? (
        <Field label="Add from template" hint="Optional. Fills the form; edit it before saving.">
          <Select
            aria-label="Add from template"
            value=""
            onChange={(e) => {
              const t = FAVOR_TEMPLATES[Number(e.target.value)];
              if (t) set({ name: t.name, description: t.description, cost: String(t.cost), kind: t.kind, secret: t.secret ?? "" });
            }}
          >
            <option value="">Choose a template…</option>
            {FAVOR_TEMPLATES.map((t, i) => (
              <option key={t.name} value={i}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <fieldset disabled={command.busy} className="faction-grid">
        <Field label="Name">
          <TextInput aria-label="Entry name" value={d.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Cost (Favor)">
          <TextInput aria-label="Cost" inputMode="numeric" value={d.cost} onChange={(e) => set({ cost: e.target.value })} />
        </Field>
        <Field label="Kind">
          <Select aria-label="Kind" value={d.kind} onChange={(e) => set({ kind: e.target.value as FavorEntryKind })}>
            {favorEntryKinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Shown to players">
          <Select aria-label="Shown to players" value={d.hidden ? "hidden" : "shown"} onChange={(e) => set({ hidden: e.target.value === "hidden" })}>
            <option value="shown">Shown</option>
            <option value="hidden">Hidden (DM only)</option>
          </Select>
        </Field>
        <Field label="Open to requests">
          <Select aria-label="Open to requests" value={d.available ? "yes" : "no"} onChange={(e) => set({ available: e.target.value === "yes" })}>
            <option value="yes">Available</option>
            <option value="no">Not available now</option>
          </Select>
        </Field>
      </fieldset>
      <Field label="Description" hint="What players read.">
        <TextArea aria-label="Entry description" value={d.description} maxLength={1000} rows={2} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <Field label="Revealed to the buyer" hint="Optional. Only the buying player reads it, once you approve (a secret's text).">
        <TextArea aria-label="Revealed to the buyer" value={d.secret} maxLength={2000} rows={2} onChange={(e) => set({ secret: e.target.value })} />
      </Field>
      <Field label="DM note" hint="Never shown to players.">
        <TextInput aria-label="Entry DM note" value={d.note} maxLength={1000} onChange={(e) => set({ note: e.target.value })} />
      </Field>
      <div>
        <Button type="submit">{command.busy ? "Saving…" : before ? "Save entry" : "Add entry"}</Button>
      </div>
      {problem && <p role="alert">{problem}</p>}
      <Status error={command.error} notice={command.notice} />
    </form>
  );
}

function EntryRow({ faction, entry, characters }: { faction: Faction; entry: FavorEntry; characters: Purse[] }) {
  const [editing, setEditing] = useState(false);
  const [buyer, setBuyer] = useState(characters[0]?.id ?? "");
  const remove = useFactionCommand(`${faction.id}|entry-remove|${entry.id}|${faction.revision}`);
  const purchase = useFactionCommand(`${faction.id}|purchase|${entry.id}|${buyer}|${entry.cost}`);
  const who = characters.find((p) => p.id === buyer);
  return (
    <li className="favor-entry grid gap-2 border-l border-border pl-3" data-testid="favor-entry">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{entry.name}</span>
        <span className="text-sm text-muted">
          {entry.cost} Favor · {KIND_LABEL[entry.kind]}
        </span>
        {entry.hidden ? <Badge>Hidden from players</Badge> : null}
        {!entry.available ? <Badge>Not available now</Badge> : null}
      </div>
      {entry.description ? <p className="text-sm text-muted">{entry.description}</p> : null}
      {entry.secret ? <p className="text-sm text-faint">Revealed to the buyer: {entry.secret}</p> : null}
      {entry.note ? <p className="text-sm text-faint">{entry.note}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        {characters.length ? (
          <>
            <Field label="Record a purchase for">
              <Select aria-label={`Record ${entry.name} for`} value={buyer} onChange={(e) => setBuyer(e.target.value)}>
                {characters.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({standingOf(faction, p.id).favor} Favor)
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="secondary"
              disabled={purchase.busy || !who}
              onClick={() =>
                void purchase.send(
                  { kind: "favor-purchase", factionId: faction.id, entryId: entry.id, characterId: buyer, cost: entry.cost } as CommandInput,
                  `Recorded: ${who?.name ?? "the character"} spent ${entry.cost} Favor.`,
                )
              }
            >
              Record purchase
            </Button>
          </>
        ) : null}
        <Button variant="secondary" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
          {editing ? "Close edit" : "Edit"}
        </Button>
        <Button
          variant="secondary"
          disabled={remove.busy}
          onClick={() =>
            void remove.send(
              { kind: "favor-entry", factionId: faction.id, revision: faction.revision, entryId: entry.id, entry: null } as CommandInput,
              "Entry removed. Requests already made keep its name.",
            )
          }
        >
          Remove
        </Button>
      </div>
      <Status error={purchase.error || remove.error} notice={purchase.notice || remove.notice} />
      {editing ? <EntryForm faction={faction} before={entry} onDone={() => setEditing(false)} /> : null}
    </li>
  );
}

function PendingRow({
  faction,
  request,
  purses,
  onDecided,
}: {
  faction: Faction;
  request: FavorRequest;
  purses: Purse[];
  /** The row leaves the waiting list once decided, so the outcome is shown by the market. */
  onDecided: (notice: string) => void;
}) {
  const [reply, setReply] = useState("");
  const approve = useFactionCommand(`${faction.id}|approve|${request.id}`);
  const decline = useFactionCommand(`${faction.id}|decline|${request.id}`);
  const { favor } = standingOf(faction, request.characterId);
  const send = async (yes: boolean) => {
    const done = yes ? `Approved: ${nameOf(purses, request.characterId)} spent ${request.cost} Favor on ${request.name}.` : `Declined: ${request.name}.`;
    if (
      await (yes ? approve : decline).send(
        { kind: "favor-decision", factionId: faction.id, requestId: request.id, approve: yes, ...(reply.trim() ? { reply: reply.trim() } : {}) } as CommandInput,
        done,
      )
    )
      onDecided(done);
  };
  return (
    <li className="grid gap-2 border-l border-border pl-3" data-testid="favor-pending">
      <RequestLine request={request} who={`${nameOf(purses, request.characterId)} has ${favor}`} dm />
      <Field label="Reply (optional)">
        <TextInput aria-label={`Reply to ${nameOf(purses, request.characterId)}`} value={reply} maxLength={500} onChange={(e) => setReply(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={approve.busy || decline.busy || favor < request.cost} onClick={() => void send(true)}>
          {favor < request.cost ? "Not enough Favor" : "Approve"}
        </Button>
        <Button variant="secondary" disabled={approve.busy || decline.busy} onClick={() => void send(false)}>
          Decline
        </Button>
      </div>
      <Status error={approve.error || decline.error} notice={approve.notice || decline.notice} />
    </li>
  );
}

export function FavorMarketManager({ faction }: { faction: Faction }) {
  const { purses, journal } = useEconomy();
  const table = { purses, journal };
  const characters = purses.filter((p) => factionCharacter(table, p));
  const entries = favorMarketOf(faction);
  const requests = favorRequestsOf(faction);
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending").reverse();
  const [notice, setNotice] = useState("");
  return (
    <Fold
      title="Favor market"
      hint={`${entries.length} entr${entries.length === 1 ? "y" : "ies"}${pending.length ? ` · ${pending.length} waiting` : ""}`}
      defaultOpen={pending.length > 0}
    >
      <div className="grid gap-4" data-testid="favor-market-manager">
        <p className="text-sm text-muted">
          What this faction offers for Favor. There are no default entries: add your own, or start from a template and edit it.
          Players ask; you approve (the Favor is spent then) or decline. An item moves nothing by itself: hand it over with Add loot.
        </p>
        {pending.length ? (
          <section aria-label="Waiting requests" className="grid gap-2">
            <h4 className="text-sm font-medium">Waiting for you</h4>
            <ul className="grid gap-3">
              {pending.map((r) => (
                <PendingRow key={r.id} faction={faction} request={r} purses={purses} onDecided={setNotice} />
              ))}
            </ul>
          </section>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {entries.length ? (
          <ul className="grid gap-3">
            {entries.map((e) => (
              <EntryRow key={e.id} faction={faction} entry={e} characters={characters} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-faint">No entries yet.</p>
        )}
        <Fold title="Add an entry">
          <EntryForm faction={faction} before={null} />
        </Fold>
        {decided.length ? (
          <Fold title="Decided requests and purchases" hint={`${decided.length} kept as history`}>
            <ul className="grid gap-2">
              {decided.map((r) => (
                <li key={r.id} className="border-l border-border pl-3">
                  <RequestLine request={r} who={nameOf(purses, r.characterId)} dm />
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}
      </div>
    </Fold>
  );
}
