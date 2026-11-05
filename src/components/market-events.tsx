import { useMemo, useState, type FormEvent } from "react";
import { useEconomy, useCommandId } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { CATEGORIES } from "@/lib/quire/labels";
import { locationLabel, readMarketLocations } from "@/lib/quire/shop-locations";
import {
  campaignDay,
  effectText,
  EVENT_CATEGORIES,
  eventStatus,
  readMarketEvents,
  scopeText,
  type MarketEvent,
} from "@/lib/quire/market-events";
import { AppLink } from "./app-link";
import { Button, Field, Select, TextArea, TextInput } from "./ui";
import "./market-events.css";

/**
 * Named market events (market-events.ts). `MarketEventsList` is the short list on Market for
 * everyone (players receive only today's open events for places they can see); `MarketEventsManager`
 * is the DM's add form, active/upcoming/ended list and End now, under Economic rules.
 */
function useEvents() {
  const { journal, shops } = useEconomy();
  return useMemo(() => {
    let events: MarketEvent[] = [];
    try {
      events = readMarketEvents((journal as { marketEvents?: unknown }).marketEvents);
    } catch {
      events = [];
    }
    const market = readMarketLocations(journal.market);
    const names = {
      location: (id: string) => (market.locations.some((l) => l.id === id) ? locationLabel(market, id) : undefined),
      shop: (id: string) => shops.find((s) => s.id === id)?.name,
    };
    return { events, today: campaignDay(journal), names, market, shops };
  }, [journal, shops]);
}

export function MarketEventsList() {
  const seat = useSeat();
  const dm = seat.role === "dm";
  const { events, today, names } = useEvents();
  // Players' "Other adjustments" entries (secret or hidden events) never make a list entry.
  const active = events.filter((e) => eventStatus(e, today) === "active" && (dm || !e.secret));
  if (!active.length && !dm) return null;
  return (
    <section className="mt-5" data-testid="market-events-list" aria-labelledby="market-events-title">
      <h2 id="market-events-title" className="text-sm font-medium text-muted">
        Market events
      </h2>
      {active.length ? (
        <ul className="mt-2">
          {active.map((e) => (
            <li key={e.id} className="market-event-row border-b border-border/70 py-2 text-sm">
              <span className="block font-medium">
                {e.name}
                {dm && e.secret ? " · secret" : ""}
              </span>
              <span className="block text-muted">
                {effectText(e.permille)} · {scopeText(e, names)}
                {dm ? ` · until day ${e.endDay}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">No market events today.</p>
      )}
      {dm ? (
        <AppLink className="settings-link mt-2" href="/features/financial#market-events">
          Manage market events →
        </AppLink>
      ) : null}
    </section>
  );
}

type Draft = {
  name: string;
  scope: "realm" | "location" | "shop";
  locationId: string;
  shopId: string;
  category: string;
  multiplier: string;
  startDay: string;
  days: string;
  secret: boolean;
  note: string;
};
const draftOf = (e: MarketEvent | null, today: number): Draft => ({
  name: e?.name ?? "",
  scope: e?.scope.kind ?? "realm",
  locationId: e?.scope.kind === "location" ? e.scope.locationId : "",
  shopId: e?.scope.kind === "shop" ? e.scope.shopId : "",
  category: e?.category ?? "",
  multiplier: e ? String(e.permille / 1000) : "1.1",
  startDay: String(e?.startDay ?? today),
  days: String(e ? e.endDay - e.startDay : 7),
  secret: !!e?.secret,
  note: e?.note ?? "",
});

/** The stored event a draft describes, or the reason it can't be saved. */
function eventFromDraft(d: Draft, id: string): MarketEvent | string {
  const name = d.name.trim();
  if (!name) return "Name the event.";
  const multiplier = Number(d.multiplier);
  if (!Number.isFinite(multiplier) || multiplier < 0.1 || multiplier > 10) return "Choose a multiplier from 0.1 to 10.";
  const permille = Math.round(multiplier * 1000);
  const startDay = Number(d.startDay),
    days = Number(d.days);
  if (!Number.isSafeInteger(startDay) || startDay < 0) return "Choose a start day of 0 or later.";
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) return "Choose a length of 1 to 3,650 days.";
  if (d.scope === "location" && !d.locationId) return "Choose a location.";
  if (d.scope === "shop" && !d.shopId) return "Choose a shop.";
  const category = (EVENT_CATEGORIES as readonly string[]).includes(d.category)
    ? (d.category as MarketEvent["category"])
    : undefined;
  return {
    id,
    name,
    scope:
      d.scope === "location"
        ? { kind: "location", locationId: d.locationId }
        : d.scope === "shop"
          ? { kind: "shop", shopId: d.shopId }
          : { kind: "realm" },
    ...(category ? { category } : {}),
    permille,
    startDay,
    endDay: startDay + days,
    ...(d.secret ? { secret: true as const } : {}),
    ...(d.note.trim() ? { note: d.note.trim().slice(0, 500) } : {}),
  };
}

function EventForm({ before, onDone }: { before: MarketEvent | null; onDone?: () => void }) {
  const { commandOutcome } = useEconomy();
  const { today, market, shops } = useEvents();
  const initial = useMemo(() => draftOf(before, today), [before, today]);
  const [d, setD] = useState<Draft>(initial);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  useDraftGuard(dirty, "market event");
  // One command ID per save, reused if the same save is retried; the event keeps its ID.
  const action = useCommandId(JSON.stringify(d));
  // A new event's ID is kept across retries of the same add and renewed once it is added.
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const eventId = before?.id ?? newId;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const set = (patch: Partial<Draft>) => setD((current) => ({ ...current, ...patch }));
  const multiplier = Number(d.multiplier);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const after = eventFromDraft(d, eventId);
    if (typeof after === "string") {
      setError(after);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const outcome = await commandOutcome({ id: action.commandId, kind: "market-event", eventId, before, after });
      action.renew();
      setNotice(mutationNotice(outcome, before ? "Event saved." : "Event added."));
      if (!before) {
        setD(draftOf(null, today));
        setNewId(crypto.randomUUID());
      }
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The event wasn't saved. Your draft is kept.");
    } finally {
      setBusy(false);
    }
  }
  const prefix = before ? `edit-${before.id}` : "add";
  return (
    <form className="market-event-form grid gap-3" onSubmit={save} data-testid={`market-event-form-${before ? "edit" : "add"}`}>
      <fieldset disabled={busy} className="grid gap-3">
        <Field label="Name" hint='For example "Blight in the Riverlands".'>
          <TextInput id={`${prefix}-name`} aria-label="Event name" value={d.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <div className="market-event-grid">
          <Field label="Where">
            <Select aria-label="Where" value={d.scope} onChange={(e) => set({ scope: e.target.value as Draft["scope"] })}>
              <option value="realm">Whole realm</option>
              <option value="location" disabled={!market.locations.length}>
                One location (and its areas)
              </option>
              <option value="shop" disabled={!shops.length}>
                One shop
              </option>
            </Select>
          </Field>
          {d.scope === "location" ? (
            <Field label="Location">
              <Select aria-label="Location" value={d.locationId} onChange={(e) => set({ locationId: e.target.value })}>
                <option value="">Choose a location</option>
                {market.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {locationLabel(market, l.id)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {d.scope === "shop" ? (
            <Field label="Shop">
              <Select aria-label="Shop" value={d.shopId} onChange={(e) => set({ shopId: e.target.value })}>
                <option value="">Choose a shop</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.blackMarket ? " (black market)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Items">
            <Select aria-label="Items" value={d.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">All items</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Price multiplier"
            hint={
              Number.isFinite(multiplier) && multiplier >= 0.1 && multiplier <= 10
                ? `${effectText(Math.round(multiplier * 1000))} on list prices.`
                : "From 0.1 to 10: 1.8 is +80%, 0.9 is −10%."
            }
          >
            <TextInput
              aria-label="Price multiplier"
              inputMode="decimal"
              value={d.multiplier}
              onChange={(e) => set({ multiplier: e.target.value })}
            />
          </Field>
          <Field label="Start day" hint={`Today is day ${today}.`}>
            <TextInput aria-label="Start day" inputMode="numeric" value={d.startDay} onChange={(e) => set({ startDay: e.target.value })} />
          </Field>
          <Field label="Lasts (days)">
            <TextInput aria-label="Lasts (days)" inputMode="numeric" value={d.days} onChange={(e) => set({ days: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={d.secret} onChange={(e) => set({ secret: e.target.checked })} className="mt-1" />
          <span>
            Secret: players see only "Other adjustments" in Why this price?, and no list entry.
          </span>
        </label>
        <Field label="Note (DM only)">
          <TextArea aria-label="Note (DM only)" value={d.note} maxLength={500} onChange={(e) => set({ note: e.target.value })} />
        </Field>
        <div>
          <Button type="submit">{busy ? "Saving…" : before ? "Save event" : "Add event"}</Button>
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}

function EventRow({ event, today, names }: { event: MarketEvent; today: number; names: Parameters<typeof scopeText>[1] }) {
  const { commandOutcome } = useEconomy();
  const status = eventStatus(event, today);
  const action = useCommandId(JSON.stringify(event));
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function end() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await commandOutcome({ id: action.commandId, kind: "market-event-end", eventId: event.id, before: event });
      action.renew();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The event wasn't ended.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="market-event-row border-b border-border/70 py-3 text-sm" data-testid="market-event-row" data-status={status}>
      <span className="block font-medium">
        {event.name}
        {event.secret ? " · secret" : ""}
      </span>
      <span className="block text-muted">
        {effectText(event.permille)} · {scopeText(event, names)}
      </span>
      <span className="block text-muted">
        {status === "ended"
          ? event.endDay === event.startDay
            ? `Ended before it started (day ${event.startDay})`
            : `Days ${event.startDay}–${event.endDay - 1} · ended`
          : status === "upcoming"
            ? `Starts day ${event.startDay} · ends day ${event.endDay}`
            : `Since day ${event.startDay} · ends day ${event.endDay}`}
      </span>
      {event.note ? <span className="block text-faint">{event.note}</span> : null}
      {status !== "ended" ? (
        <span className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => void end()}>
            {busy ? "Ending…" : "End now"}
          </Button>
          <Button variant="secondary" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
            {editing ? "Close edit" : "Edit"}
          </Button>
        </span>
      ) : null}
      {error && <p role="alert">{error}</p>}
      {editing ? (
        <div className="mt-3">
          <EventForm before={event} onDone={() => setEditing(false)} />
        </div>
      ) : null}
    </li>
  );
}

export function MarketEventsManager() {
  const seat = useSeat();
  const { events, today, names } = useEvents();
  if (seat.role !== "dm") return null;
  const groups = (["active", "upcoming", "ended"] as const).map((status) => ({
    status,
    events: events
      .filter((e) => eventStatus(e, today) === status)
      .sort((a, b) => (status === "ended" ? b.endDay - a.endDay : a.startDay - b.startDay)),
  }));
  const titles = { active: "Active", upcoming: "Upcoming", ended: "Ended" };
  return (
    <div className="market-events-manager" data-testid="market-events-manager">
      <p className="text-sm text-muted">
        Named, timed price changes, e.g. a blight or a festival. An active event multiplies the asking price of
        what it covers when the price is shown and charged; stored shop prices are not rewritten. Days follow
        Session Time (today is day {today}). Ended events stay here as history.
      </p>
      {groups.map((g) => (
        <section key={g.status} className="mt-4" aria-label={`${titles[g.status]} market events`}>
          <h3 className="text-sm font-medium">
            {titles[g.status]} ({g.events.length})
          </h3>
          {g.events.length ? (
            <ul className="mt-1">
              {g.events.map((e) => (
                <EventRow key={e.id} event={e} today={today} names={names} />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-faint">None.</p>
          )}
        </section>
      ))}
      <h3 className="mt-5 text-sm font-medium">Add a market event</h3>
      <div className="mt-2">
        <EventForm before={null} />
      </div>
    </div>
  );
}
