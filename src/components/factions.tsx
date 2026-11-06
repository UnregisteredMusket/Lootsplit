/**
 * Factions, Renown and Favor (factions.ts; owner design 2026-11-05) at /features/factions, beside
 * Quests. The DM creates factions (tiers, prices, the shops and places they control), reveals or
 * hides them, changes renown for the party or one character, and grants Favor. Players see the
 * visible factions with their own renown, tier and Favor and the party's attitude. Every change is
 * one DM-only `faction-*` command; nothing here moves coins or items. Each faction's favor market
 * (favor-market.tsx) sits in its card.
 */
import { useMemo, useState, type FormEvent } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { locationLabel, readMarketLocations } from "@/lib/quire/shop-locations";
import {
  defaultFactionDraft,
  factionCharacter,
  factionControlsShop,
  factionParty,
  factionPercent,
  MAX_RENOWN,
  MIN_RENOWN,
  partyAttitude,
  percentText,
  readFactions,
  standingOf,
  type Faction,
  type FactionDraft,
} from "@/lib/quire/factions";
import type { CommandInput } from "@/lib/quire/commands";
import type { Purse } from "@/lib/quire/types";
import { FactionMeter } from "./faction-meter";
import { Status, useFactionCommand } from "./faction-command";
import { FavorMarketManager, PlayerFavorMarket } from "./favor-market";
import { Badge, Button, Field, Fold, Select, TextArea, TextInput } from "./ui";
import "./factions.css";

function useFactions() {
  const { journal, purses, shops } = useEconomy();
  return useMemo(() => {
    let factions: Faction[] = [];
    try {
      factions = readFactions((journal as { factions?: unknown }).factions);
    } catch {
      factions = [];
    }
    const market = readMarketLocations(journal.market);
    const table = { purses, journal };
    return { factions, market, shops, purses, table };
  }, [journal, purses, shops]);
}

/** The shops whose prices a faction sets (directly or through a place), by name. */
function controlledShops(f: Faction, shops: { id: string; name: string; locationId?: string | null }[], market: ReturnType<typeof readMarketLocations>) {
  return shops.filter((s) => factionControlsShop(f, { id: s.id, locationId: s.locationId ?? undefined }, market));
}

export function FactionsScreen() {
  const seat = useSeat();
  return seat.role === "dm" ? <FactionsManager /> : <PlayerFactions />;
}

function PlayerFactions() {
  const seat = useSeat();
  const { factions, market, shops, purses, table } = useFactions();
  const mine = purses.filter((p) => seat.purseIds.includes(p.id) && factionCharacter(table, p));
  if (!factions.length)
    return (
      <p className="text-sm text-muted" data-testid="factions-empty">
        No factions have taken notice of the party yet. Your DM reveals them as you meet them.
      </p>
    );
  return (
    <div className="grid gap-4" data-testid="player-factions">
      <p className="text-sm text-muted">
        Renown is how a faction regards you, from Vilified to Idolized. The party's attitude (the middle score of the
        party's characters) sets prices at the shops the faction controls. Favor is earned as your renown rises.
      </p>
      {factions.map((f) => {
        const party = partyAttitude(table, f);
        const where = controlledShops(f, shops, market);
        return (
          <section key={f.id} className="faction-card border-b border-border/70 pb-4" data-testid="player-faction" aria-label={f.name}>
            <h2 className="text-base font-medium">{f.name}</h2>
            {f.description ? <p className="mt-1 text-sm text-muted">{f.description}</p> : null}
            <div className="mt-3 grid gap-3">
              {mine.map((p) => {
                const s = standingOf(f, p.id);
                return (
                  <FactionMeter
                    key={p.id}
                    tiers={f.tiers}
                    score={s.renown}
                    label={mine.length > 1 ? `${p.name}'s renown` : "Your renown"}
                    detail={`${s.favor} Favor`}
                    testId="faction-own-meter"
                  />
                );
              })}
              <FactionMeter tiers={f.tiers} score={party.renown} tierId={party.tier.id} label="Party's attitude" testId="faction-party-meter" />
            </div>
            {where.length ? (
              <p className="mt-2 text-sm text-muted">
                Prices at {where.map((s) => s.name).join(", ")}: {percentText(factionPercent(f, where[0]!.id, party.tier.id))}
                {where.length > 1 ? " (some shops may differ)" : ""}. Why this price? shows it.
              </p>
            ) : null}
            <PlayerFavorMarket faction={f} characters={mine} />
          </section>
        );
      })}
    </div>
  );
}

type TierRow = { id: string; name: string; min: string; percent: string };
type Draft = {
  name: string;
  description: string;
  note: string;
  favorRatePercent: string;
  locationIds: string[];
  shopIds: string[];
  tiers: TierRow[];
  overrides: { shopId: string; percents: Record<string, string> }[];
};
function draftOf(f: Faction | null): Draft {
  const base: FactionDraft = f ?? defaultFactionDraft();
  return {
    name: base.name,
    description: base.description,
    note: base.note ?? "",
    favorRatePercent: String(base.favorRatePercent),
    locationIds: [...base.controls.locationIds],
    shopIds: [...base.controls.shopIds],
    tiers: base.tiers.map((t) => ({ id: t.id, name: t.name, min: String(t.min), percent: String(base.priceByTier[t.id] ?? 0) })),
    overrides: Object.entries(base.shopPriceByTier ?? {}).map(([shopId, table]) => ({
      shopId,
      percents: Object.fromEntries(Object.entries(table).map(([k, v]) => [k, String(v)])),
    })),
  };
}
function factionFromDraft(d: Draft): FactionDraft | string {
  const name = d.name.trim();
  if (!name) return "Name the faction.";
  const rate = Number(d.favorRatePercent);
  if (!Number.isSafeInteger(rate) || rate < 0 || rate > 1000) return "Choose a Favor rate from 0 to 1,000%.";
  const tiers = [];
  const priceByTier: Record<string, number> = {};
  for (const [i, t] of d.tiers.entries()) {
    const min = i === 0 ? MIN_RENOWN : Number(t.min);
    const percent = Number(t.percent);
    if (!t.name.trim()) return "Name every tier.";
    if (!Number.isSafeInteger(min) || min < MIN_RENOWN || min > MAX_RENOWN) return `${t.name}: choose a start from −1000 to 1000.`;
    if (!Number.isSafeInteger(percent) || percent < -90 || percent > 500) return `${t.name}: choose a price change from −90% to +500%.`;
    tiers.push({ id: t.id, name: t.name.trim(), min });
    priceByTier[t.id] = percent;
  }
  for (let i = 1; i < tiers.length; i++) if (tiers[i]!.min <= tiers[i - 1]!.min) return "Each tier starts above the one before it.";
  const shopPriceByTier: Record<string, Record<string, number>> = {};
  for (const o of d.overrides) {
    const table: Record<string, number> = {};
    for (const t of d.tiers) {
      const raw = o.percents[t.id]?.trim();
      if (!raw) continue;
      const v = Number(raw);
      if (!Number.isSafeInteger(v) || v < -90 || v > 500) return "Shop prices run from −90% to +500%.";
      table[t.id] = v;
    }
    if (Object.keys(table).length) shopPriceByTier[o.shopId] = table;
  }
  return {
    name,
    description: d.description.trim().slice(0, 1000),
    ...(d.note.trim() ? { note: d.note.trim().slice(0, 1000) } : {}),
    tiers,
    favorRatePercent: rate,
    controls: { locationIds: d.locationIds, shopIds: d.shopIds },
    priceByTier,
    ...(Object.keys(shopPriceByTier).length ? { shopPriceByTier } : {}),
  };
}

function FactionForm({ before, onDone }: { before: Faction | null; onDone?: () => void }) {
  const { market, shops } = useFactions();
  const initial = useMemo(() => draftOf(before), [before]);
  const [d, setD] = useState<Draft>(initial);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  useDraftGuard(dirty, "faction");
  const command = useFactionCommand(JSON.stringify(d));
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const [problem, setProblem] = useState("");
  const set = (patch: Partial<Draft>) => setD((c) => ({ ...c, ...patch }));
  const toggle = (key: "locationIds" | "shopIds", value: string, on: boolean) =>
    setD((c) => ({ ...c, [key]: on ? [...c[key], value] : c[key].filter((x) => x !== value) }));
  const setTier = (i: number, patch: Partial<TierRow>) =>
    setD((c) => ({ ...c, tiers: c.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const prefix = before ? `edit-${before.id}` : "add";
  async function save(e: FormEvent) {
    e.preventDefault();
    const faction = factionFromDraft(d);
    if (typeof faction === "string") {
      setProblem(faction);
      return;
    }
    setProblem("");
    const ok = await command.send(
      { kind: "faction-save", factionId: before?.id ?? newId, revision: before?.revision ?? null, faction } as CommandInput,
      before ? "Faction saved." : "Faction added. It stays hidden from players until you reveal it.",
    );
    if (ok && !before) {
      setD(draftOf(null));
      setNewId(crypto.randomUUID());
    }
    if (ok) onDone?.();
  }
  const unused = shops.filter((s) => !d.overrides.some((o) => o.shopId === s.id));
  return (
    <form className="faction-form grid gap-3" onSubmit={save} data-testid={`faction-form-${before ? "edit" : "add"}`}>
      <fieldset disabled={command.busy} className="grid gap-3">
        <Field label="Name" hint='For example "The Black Hand".'>
          <TextInput id={`${prefix}-name`} aria-label="Faction name" value={d.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Description (players see it once revealed)">
          <TextArea aria-label="Description" value={d.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label="Note (DM only)">
          <TextArea aria-label="Note (DM only)" value={d.note} maxLength={1000} onChange={(e) => set({ note: e.target.value })} />
        </Field>
        <Field label="Favor per 100 renown gained" hint="100: each renown point gained earns 1 Favor. Losing renown never removes Favor.">
          <TextInput aria-label="Favor rate" inputMode="numeric" value={d.favorRatePercent} onChange={(e) => set({ favorRatePercent: e.target.value })} />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Controls</legend>
          <p className="text-sm text-muted">The party's attitude sets prices at these shops, and every shop in these places and their areas.</p>
          {market.locations.length ? (
            <div className="faction-checks" aria-label="Controlled places">
              {market.locations.map((l) => (
                <label key={l.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={d.locationIds.includes(l.id)} onChange={(e) => toggle("locationIds", l.id, e.target.checked)} />
                  <span>{locationLabel(market, l.id)}</span>
                </label>
              ))}
            </div>
          ) : null}
          {shops.length ? (
            <div className="faction-checks" aria-label="Controlled shops">
              {shops.map((s) => (
                <label key={s.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={d.shopIds.includes(s.id)} onChange={(e) => toggle("shopIds", s.id, e.target.checked)} />
                  <span>{s.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-faint">No shops yet.</p>
          )}
        </fieldset>
        <fieldset className="faction-tiers">
          <legend className="text-sm font-medium">Tiers and prices</legend>
          <p className="text-sm text-muted">
            Each tier runs from its start up to the next one. The price change applies at the shops it controls: −10 is 10% cheaper.
          </p>
          {d.tiers.map((t, i) => (
            <div key={t.id} className="faction-tier-row" data-testid="faction-tier-row">
              <Field label="Tier">
                <TextInput aria-label={`Tier ${i + 1} name`} value={t.name} maxLength={40} onChange={(e) => setTier(i, { name: e.target.value })} />
              </Field>
              <Field label="Starts at">
                <TextInput
                  aria-label={`${t.name} starts at`}
                  inputMode="numeric"
                  value={i === 0 ? String(MIN_RENOWN) : t.min}
                  disabled={i === 0}
                  onChange={(e) => setTier(i, { min: e.target.value })}
                />
              </Field>
              <Field label="Price %">
                <TextInput aria-label={`${t.name} price change`} inputMode="numeric" value={t.percent} onChange={(e) => setTier(i, { percent: e.target.value })} />
              </Field>
            </div>
          ))}
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">A shop's own prices (optional)</legend>
          {d.overrides.map((o, oi) => (
            <div key={o.shopId} className="grid gap-2 border-l border-border pl-3" data-testid="faction-shop-override">
              <span className="text-sm font-medium">{shops.find((s) => s.id === o.shopId)?.name ?? "A shop"}</span>
              <div className="faction-checks">
                {d.tiers.map((t) => (
                  <Field key={t.id} label={`${t.name} %`}>
                    <TextInput
                      aria-label={`${shops.find((s) => s.id === o.shopId)?.name ?? "Shop"} ${t.name} price change`}
                      inputMode="numeric"
                      placeholder={t.percent}
                      value={o.percents[t.id] ?? ""}
                      onChange={(e) =>
                        setD((c) => ({
                          ...c,
                          overrides: c.overrides.map((x, j) => (j === oi ? { ...x, percents: { ...x.percents, [t.id]: e.target.value } } : x)),
                        }))
                      }
                    />
                  </Field>
                ))}
              </div>
              <div>
                <Button variant="secondary" onClick={() => setD((c) => ({ ...c, overrides: c.overrides.filter((_, j) => j !== oi) }))}>
                  Remove shop prices
                </Button>
              </div>
            </div>
          ))}
          {unused.length ? (
            <Field label="Add a shop's own prices" hint="Its prices replace the tier prices above at that shop; blank tiers keep them.">
              <Select
                aria-label="Add a shop's own prices"
                value=""
                onChange={(e) => e.target.value && setD((c) => ({ ...c, overrides: [...c.overrides, { shopId: e.target.value, percents: {} }] }))}
              >
                <option value="">Choose a shop</option>
                {unused.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </fieldset>
        <div>
          <Button type="submit">{command.busy ? "Saving…" : before ? "Save faction" : "Add faction"}</Button>
        </div>
      </fieldset>
      {problem && <p role="alert">{problem}</p>}
      <Status error={command.error} notice={command.notice} />
    </form>
  );
}

function RenownForm({ faction, party, characters }: { faction: Faction; party: Purse[]; characters: Purse[] }) {
  const [target, setTarget] = useState("party"),
    [delta, setDelta] = useState("10"),
    [reason, setReason] = useState(""),
    [kind, setKind] = useState<"renown" | "favor">("renown");
  const command = useFactionCommand(`${faction.id}|${kind}|${target}|${delta}|${reason}`);
  const [problem, setProblem] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(delta);
    if (!Number.isSafeInteger(n) || n === 0) return setProblem("Choose a whole number other than 0.");
    if (!reason.trim()) return setProblem("Give a reason; it goes in the campaign history.");
    const ids = target === "party" ? party.map((p) => p.id) : [target];
    if (!ids.length) return setProblem("Nobody is travelling with the party.");
    setProblem("");
    const ok = await command.send(
      {
        kind: kind === "renown" ? "faction-renown" : "faction-favor-grant",
        factionId: faction.id,
        characters: ids.map((characterId) => ({ characterId, delta: n })),
        reason: reason.trim(),
      } as CommandInput,
      kind === "renown" ? "Renown changed." : "Favor changed.",
    );
    if (ok) setReason("");
  }
  return (
    <form className="faction-form mt-3 grid gap-3" onSubmit={submit} data-testid="faction-renown-form">
      <fieldset disabled={command.busy} className="faction-grid">
        <Field label="Change">
          <Select aria-label="Change" value={kind} onChange={(e) => setKind(e.target.value as "renown" | "favor")}>
            <option value="renown">Renown (gains earn Favor)</option>
            <option value="favor">Favor only</option>
          </Select>
        </Field>
        <Field label="Who">
          <Select aria-label="Who" value={target} onChange={(e) => setTarget(e.target.value)}>
            {kind === "renown" ? <option value="party">Whole party ({party.length})</option> : null}
            {characters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount" hint="Negative to lower it. Favor never goes below 0.">
          <TextInput aria-label="Amount" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} />
        </Field>
        <Field label="Reason">
          <TextInput aria-label="Reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </fieldset>
      <div>
        <Button type="submit">{command.busy ? "Saving…" : kind === "renown" ? "Change renown" : "Change Favor"}</Button>
      </div>
      {problem && <p role="alert">{problem}</p>}
      <Status error={command.error} notice={command.notice} />
    </form>
  );
}

function FactionCard({ faction }: { faction: Faction }) {
  const { market, shops, purses, table } = useFactions();
  const [editing, setEditing] = useState(false);
  const visibility = useFactionCommand(`${faction.id}|vis|${faction.revision}`);
  const removal = useFactionCommand(`${faction.id}|del|${faction.revision}`);
  const party = factionParty(table);
  const attitude = partyAttitude(table, faction);
  const characters = purses.filter((p) => factionCharacter(table, p));
  const where = controlledShops(faction, shops, market);
  // Party members first, then anyone else the faction knows (departed characters keep standing).
  const rows = [...party, ...characters.filter((p) => !party.includes(p) && faction.standing[p.id])];
  return (
    <li className="faction-card border-b border-border/70 py-4" data-testid="faction-card" aria-label={faction.name}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-medium">{faction.name}</h3>
        {faction.hidden ? <Badge>Hidden from players</Badge> : <Badge>Visible</Badge>}
      </div>
      {faction.description ? <p className="mt-1 text-sm text-muted">{faction.description}</p> : null}
      {faction.note ? <p className="mt-1 text-sm text-faint">{faction.note}</p> : null}
      <div className="mt-3">
        <FactionMeter tiers={faction.tiers} score={attitude.renown} label="Party's attitude (median)" testId="faction-party-meter" />
      </div>
      <p className="mt-2 text-sm text-muted" data-testid="faction-prices">
        {where.length
          ? `Prices: ${where.map((s) => `${s.name} ${percentText(factionPercent(faction, s.id, attitude.tier.id))}`).join(" · ")}`
          : "Controls no shops yet."}
      </p>
      <Fold title="Standing" hint={`${rows.length} character${rows.length === 1 ? "" : "s"}`} defaultOpen>
        <div className="grid gap-3" data-testid="faction-standing">
          {rows.map((p) => {
            const s = standingOf(faction, p.id);
            return (
              <FactionMeter
                key={p.id}
                tiers={faction.tiers}
                score={s.renown}
                label={`${p.name}${party.includes(p) ? "" : " (not in the party)"}`}
                detail={`${s.favor} Favor`}
              />
            );
          })}
          {!rows.length ? <p className="text-sm text-faint">No characters yet.</p> : null}
        </div>
        <RenownForm faction={faction} party={party} characters={characters} />
      </Fold>
      <FavorMarketManager faction={faction} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={visibility.busy}
          onClick={() =>
            void visibility.send(
              { kind: "faction-visibility", factionId: faction.id, revision: faction.revision, hidden: !faction.hidden } as CommandInput,
              faction.hidden ? "Revealed to players." : "Hidden from players.",
            )
          }
        >
          {faction.hidden ? "Reveal to players" : "Hide from players"}
        </Button>
        <Button variant="secondary" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
          {editing ? "Close edit" : "Edit"}
        </Button>
        <Button
          variant="secondary"
          disabled={removal.busy}
          onClick={() =>
            void removal.send(
              { kind: "faction-delete", factionId: faction.id, revision: faction.revision, deleted: true } as CommandInput,
              "Faction deleted. Its history and standing are kept under Deleted factions.",
            )
          }
        >
          Delete
        </Button>
      </div>
      <Status error={visibility.error || removal.error} notice={visibility.notice || removal.notice} />
      {editing ? (
        <div className="mt-3">
          <FactionForm before={faction} onDone={() => setEditing(false)} />
        </div>
      ) : null}
    </li>
  );
}

function DeletedRow({ faction }: { faction: Faction }) {
  const restore = useFactionCommand(`${faction.id}|restore|${faction.revision}`);
  return (
    <li className="faction-card border-b border-border/70 py-2 text-sm">
      <span className="font-medium">{faction.name}</span>
      <span className="ml-2">
        <Button
          variant="secondary"
          disabled={restore.busy}
          onClick={() =>
            void restore.send({ kind: "faction-delete", factionId: faction.id, revision: faction.revision, deleted: false } as CommandInput, "Faction restored.")
          }
        >
          Restore
        </Button>
      </span>
      <Status error={restore.error} notice={restore.notice} />
    </li>
  );
}

function FactionsManager() {
  const { factions } = useFactions();
  const live = factions.filter((f) => !f.deleted);
  const deleted = factions.filter((f) => f.deleted);
  return (
    <div className="grid gap-4" data-testid="factions-manager">
      <p className="text-sm text-muted">
        Guilds, cults and houses that judge the party. Each character has renown with a faction from −1000 to 1000; the party's
        attitude is the middle score of the characters travelling with the party, and its tier sets prices at the shops the
        faction controls. Renown gains earn Favor. New factions stay hidden from players until you reveal them; hidden factions
        still change prices, and players see that as "Local standing".
      </p>
      {live.length ? (
        <ul>
          {live.map((f) => (
            <FactionCard key={f.id} faction={f} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-faint">No factions yet.</p>
      )}
      <section aria-labelledby="add-faction-title">
        <h2 id="add-faction-title" className="text-sm font-medium">
          Add a faction
        </h2>
        <div className="mt-2">
          <FactionForm before={null} />
        </div>
      </section>
      {deleted.length ? (
        <Fold title="Deleted factions" hint={`${deleted.length} kept as history`}>
          <ul>
            {deleted.map((f) => (
              <DeletedRow key={f.id} faction={f} />
            ))}
          </ul>
        </Fold>
      ) : null}
    </div>
  );
}
