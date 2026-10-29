import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { DoorOpen, Link2, Map as MapIcon, Plus, Route as RouteIcon, X } from "lucide-react";
import type { CloudTable } from "@/lib/quire/cloud";
import { useEconomy } from "@/lib/quire/economy-context";
import { locationPath, readMarketLocations } from "@/lib/quire/shop-locations";
import { readSplitRule, zonesFingerprint } from "@/lib/quire/zone-commands";
import { DEFAULT_SPLIT_RULE, ZONE_KINDS, type SplitRuleSettings, type Zone } from "@/lib/quire/world-schema";
import { parentZone, tripEstimate, zoneKind, zoneName, zoneOf, zonesAdjacent, zoneSettings, ZONE_DEFAULTS } from "@/lib/quire/zones";

type T = Pick<CloudTable, "journal" | "purses">;
const KIND_LABEL: Record<Zone["kind"], string> = {
  district: "District / building",
  town: "Town",
  city: "City",
  dungeon: "Dungeon",
  wilderness: "Forest / wilderness",
  region: "Region",
  custom: "Custom",
};
const SPLIT_LABEL = { block: "Block", "session-end": "Wait until end of session", vote: "Party vote" } as const;
const splitRuleText = (rule: SplitRuleSettings) =>
  rule.rule === "vote"
    ? `party vote · ${rule.majority} · ${rule.minutes ? `${rule.minutes} minutes` : "until the session ends"} · a tie keeps the party together · you can approve or reject any vote`
    : rule.rule === "block"
      ? "the move is refused; you can still move anyone"
      : "the request waits for the end of the session; you apply or decline it";

/** A table with the draft zones in place of the saved ones (to preview zoneOf and adjacency). */
const withZones = (t: T, zones: Zone[]): T => ({ ...t, journal: { ...t.journal!, world: { ...t.journal!.world!, zones } } });

/**
 * The DM's Zones editor (map tokens PR 7A; mockup zones frame 1): maps that count as one place.
 * Zones start from the location tree; the DM adds maps without a location, joins another
 * location, sets the kind, travel inside the zone, size and parent zone, the split rule override,
 * and which zones are adjacent. Saved as one `zone-save` with a revision check.
 */
export function ZonesEditor({ table, open, onOpenChange, initialZone }: { table: T; open: boolean; onOpenChange: (open: boolean) => void; initialZone?: string }) {
  const { commandOutcome } = useEconomy();
  const [draft, setDraft] = useState<Zone[]>(() => structuredClone(table.journal?.world?.zones ?? []));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const preview = withZones(table, draft);
  const maps = preview.journal?.world?.maps ?? [];
  const market = readMarketLocations(preview.journal?.market);
  // Every zone in use: each map's zone, plus saved zones with no maps yet.
  const refs = useMemo(() => {
    const set = new Set<string>(maps.map((m) => zoneOf(preview, m.id)));
    for (const z of draft) set.add(`zone:${z.id}`);
    return [...set];
    // The draft and the maps decide the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, maps]);
  const [selected, setSelected] = useState(() => initialZone ?? refs.find((r) => !r.startsWith("map:")) ?? refs[0]);
  const saved = (ref: string) => (ref.startsWith("zone:") ? draft.find((z) => `zone:${z.id}` === ref) : draft.find((z) => z.derivedFrom === ref));
  /** The saved entry for a zone, created from its derived defaults on the first change. */
  const edit = (ref: string, change: (z: Zone) => void) =>
    setDraft((current) => {
      const next = structuredClone(current);
      let z = ref.startsWith("zone:") ? next.find((x) => `zone:${x.id}` === ref) : next.find((x) => x.derivedFrom === ref);
      if (!z) {
        z = { id: crypto.randomUUID(), name: zoneName(table, ref).slice(0, 80), kind: zoneKind(table, ref), mapIds: [], locationIds: [], derivedFrom: ref, settings: zoneSettings(table, ref) };
        if (ref.startsWith("map:")) {
          z.mapIds = [ref.slice(4)];
          delete z.derivedFrom;
        }
        next.push(z);
        if (!ref.startsWith("zone:")) setSelected(ref.startsWith("map:") ? `zone:${z.id}` : ref);
      }
      change(z);
      return next;
    });
  const ref = selected ?? refs[0];
  const entry = ref ? saved(ref) : undefined;
  const current = entry ? `zone:${entry.id}` : ref;
  const settings = current ? zoneSettings(preview, current) : { travel: "free" as const };
  const inZone = current ? maps.filter((m) => zoneOf(preview, m.id) === current) : [];
  const campaignRule = readSplitRule(table);
  const parents = refs.filter((r) => r !== current && !r.startsWith("map:"));
  const candidates = refs.filter((r) => r !== current && (parentZone(preview, r) === parentZone(preview, current ?? "") || zonesAdjacent(preview, current!, r)));
  const linkVia = (other: string) => {
    for (const m of inZone)
      for (const l of m.connected?.links ?? []) if (zoneOf(preview, l.targetMapId) === other) return l.label;
  };
  const kindOf = (r: string) => KIND_LABEL[zoneKind(preview, r)];
  const counts = (r: string) => maps.filter((m) => zoneOf(preview, m.id) === r).length;
  async function save() {
    setBusy(true);
    setError("");
    try {
      await commandOutcome({ kind: "zone-save", before: zonesFingerprint(table), zones: draft, splitRule: table.journal?.world?.splitRule ?? null });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zones could not be saved. Your draft is retained.");
    } finally {
      setBusy(false);
    }
  }
  const tree = refs
    .filter((r) => !r.startsWith("map:") || saved(r))
    .sort((a, b) => (parentZone(preview, a) ? 1 : 0) - (parentZone(preview, b) ? 1 : 0) || zoneName(preview, a).localeCompare(zoneName(preview, b)));
  const unzoned = refs.filter((r) => r.startsWith("map:") && !saved(r));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={document.querySelector<HTMLElement>(".map-view-frame") ?? undefined}>
        <Dialog.Overlay className="map-zones-scrim" />
        <Dialog.Content className="map-zones-dialog map-glass" aria-describedby={undefined}>
          <aside className="map-zones-list">
            <Dialog.Title asChild>
              <h2>Zones</h2>
            </Dialog.Title>
            <p>Maps in one zone count as the same place: moving between them never splits the party. Leaving for an adjacent zone follows your split rule; coming back merges them.</p>
            <div role="listbox" aria-label="Zones">
              {tree.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="option"
                  aria-selected={r === current}
                  className={`map-zones-item${parentZone(preview, r) ? " nested" : ""}`}
                  onClick={() => setSelected(r)}
                >
                  <b>{zoneName(preview, r)}</b>
                  <small>
                    {kindOf(r).split(" /")[0]} · {zoneSettings(preview, r).travel === "free" ? "free travel" : "journeys"} · {counts(r)} {counts(r) === 1 ? "map" : "maps"}
                  </small>
                </button>
              ))}
              {unzoned.length > 0 && (
                <div className="map-zones-item static">
                  <b>Unzoned maps</b>
                  <small>
                    {unzoned.length} {unzoned.length === 1 ? "map" : "maps"}: each counts as its own place
                  </small>
                </div>
              )}
            </div>
            <button
              type="button"
              className="map-zones-ghost"
              onClick={() => {
                const z: Zone = { id: crypto.randomUUID(), name: "New zone", kind: "custom", mapIds: [], locationIds: [], settings: { travel: "free" } };
                setDraft((d) => [...d, z]);
                setSelected(`zone:${z.id}`);
              }}
            >
              <Plus size={14} /> New zone
            </button>
          </aside>
          {current && (
            <section className="map-zones-detail" aria-label={zoneName(preview, current)}>
              <div className="map-zones-head">
                {entry && !entry.derivedFrom ? (
                  <input aria-label="Zone name" className="map-zones-name" value={entry.name} maxLength={80} onChange={(e) => edit(current, (z) => void (z.name = e.target.value))} />
                ) : (
                  <h2>{zoneName(preview, current)}</h2>
                )}
                <Dialog.Close className="map-icon-button" aria-label="Close zones">
                  <X size={16} />
                </Dialog.Close>
              </div>
              <p className="map-zones-sub">
                {current.startsWith("loc:") || entry?.derivedFrom
                  ? `Starts from your locations: the ${kindOf(entry?.derivedFrom ?? current).toLowerCase()} ${zoneName(preview, entry?.derivedFrom ?? current)} and its areas. Add maps that have no location, or join another place.`
                  : "Add maps, or join locations, that count as one place."}
              </p>
              <h3>Maps in this zone</h3>
              {inZone.map((m) => {
                const added = !!entry?.mapIds.includes(m.id);
                const location = m.locationId ? market.locations.find((l) => l.id === m.locationId) : undefined;
                const parent = m.connected?.parentMapId ? maps.find((x) => x.id === m.connected!.parentMapId) : undefined;
                return (
                  <div className="map-zones-row" key={m.id}>
                    <MapIcon size={18} aria-hidden="true" />
                    <span>
                      <b>{m.name}</b>
                      <small>
                        {location
                          ? `Location: ${location.name} (${location.kind === "area" ? `area of ${locationPath(market, location.id).at(-2)?.name ?? "a city"}` : location.kind})`
                          : `No location${parent ? ` · child of ${parent.name}` : ""}`}
                      </small>
                    </span>
                    <span className={`map-zones-tag${added ? " added" : ""}`}>{added ? "Added" : "From location"}</span>
                    {added ? (
                      <button type="button" className="map-zones-link" onClick={() => edit(current, (z) => void (z.mapIds = z.mapIds.filter((id) => id !== m.id)))}>
                        Remove
                      </button>
                    ) : (
                      <span className="map-zones-muted">Locked by location</span>
                    )}
                  </div>
                );
              })}
              <div className="map-zones-actions">
                <label className="map-zones-add">
                  <Plus size={14} aria-hidden="true" />
                  <select
                    aria-label="Add map…"
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      setDraft((d) => d.map((z) => ({ ...z, mapIds: z.mapIds.filter((x) => x !== id) })));
                      edit(current, (z) => void (z.mapIds = [...z.mapIds, id]));
                    }}
                  >
                    <option value="">Add map…</option>
                    {maps
                      .filter((m) => !inZone.includes(m))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="map-zones-add">
                  <Link2 size={14} aria-hidden="true" />
                  <select
                    aria-label="Join another location…"
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      setDraft((d) => d.map((z) => ({ ...z, locationIds: z.locationIds.filter((x) => x !== id) })));
                      edit(current, (z) => void (z.locationIds = [...z.locationIds, id]));
                    }}
                  >
                    <option value="">Join another location…</option>
                    {market.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.kind})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <h3>Zone settings</h3>
              <div className="map-zones-settings">
                <label>
                  Kind
                  <select value={zoneKind(preview, current)} onChange={(e) => edit(current, (z) => void (z.kind = e.target.value as Zone["kind"]))}>
                    {ZONE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Travel inside this zone
                  <select value={settings.travel} onChange={(e) => edit(current, (z) => void (z.settings.travel = e.target.value as "free" | "journey"))}>
                    <option value="free">Free during a session</option>
                    <option value="journey">Journey</option>
                  </select>
                  <small>Default for a {KIND_LABEL[zoneKind(preview, current)].toLowerCase()}: {ZONE_DEFAULTS[zoneKind(preview, current)].travel === "free" ? "free" : "journey"}. Region and wilderness default to Journey.</small>
                </label>
                <label>
                  Size (miles across)
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    value={settings.sizeMiles ?? ""}
                    placeholder="About … miles"
                    onChange={(e) => edit(current, (z) => void (e.target.value ? (z.settings.sizeMiles = Number(e.target.value)) : delete z.settings.sizeMiles))}
                  />
                  <small>Used to estimate trips only.</small>
                </label>
                <label>
                  Inside zone
                  <select value={parentZone(preview, current) ?? ""} onChange={(e) => edit(current, (z) => void (e.target.value ? (z.parentZoneId = e.target.value) : delete z.parentZoneId))}>
                    <option value="">None</option>
                    {parents.map((p) => (
                      <option key={p} value={p}>
                        {zoneName(preview, p)} ({kindOf(p).toLowerCase()} · {zoneSettings(preview, p).travel === "free" ? "free travel" : "journeys"})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="map-zones-wide" role="radiogroup" aria-label="When a player's move would split the party">
                <span>When a player's move would split the party</span>
                <div className="map-zones-seg">
                  {(["campaign", "block", "session-end", "vote", "allow"] as const).map((rule) => {
                    const on = (settings.splitRule ?? "campaign") === rule;
                    return (
                      <button
                        key={rule}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={on ? "on" : undefined}
                        onClick={() => edit(current, (z) => void (rule === "campaign" ? delete z.settings.splitRule : (z.settings.splitRule = rule)))}
                      >
                        {rule === "campaign" ? (
                          <>
                            Use campaign setting<small>{SPLIT_LABEL[campaignRule.rule]}</small>
                          </>
                        ) : rule === "allow" ? (
                          "Allow freely"
                        ) : (
                          SPLIT_LABEL[rule]
                        )}
                      </button>
                    );
                  })}
                </div>
                <small>
                  Leaving {zoneName(preview, current)}:{" "}
                  {settings.splitRule === "allow" ? "characters split off at once" : splitRuleText({ ...campaignRule, ...(settings.splitRule ? { rule: settings.splitRule as SplitRuleSettings["rule"] } : {}) })}. The DM can always move anyone directly.
                </small>
              </div>
              <h3>Adjacent zones: crossed freely, no journey</h3>
              {candidates.map((other) => {
                const adjacent = zonesAdjacent(preview, current, other);
                const via = linkVia(other);
                const trip = tripEstimate(preview, current, other);
                return (
                  <div className={`map-zones-row adj${adjacent ? "" : " off"}`} key={other}>
                    {via ? <DoorOpen size={18} aria-hidden="true" /> : <RouteIcon size={18} aria-hidden="true" />}
                    <span>
                      <b>{zoneName(preview, other)}</b>
                      <small>
                        {kindOf(other)} · {via ? `via the ${via} entrance` : "no link"}
                      </small>
                    </span>
                    <span className={adjacent ? "map-zones-warn" : "map-zones-muted"}>
                      {adjacent ? "A split here follows the split rule · blocked in combat" : `Not adjacent: about ${trip.days} ${trip.days === 1 ? "day" : "days"}, needs a journey`}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={adjacent}
                      aria-label={`${zoneName(preview, other)} is adjacent`}
                      className={`map-switch-button${adjacent ? " on" : ""}`}
                      onClick={() =>
                        edit(current, (z) => {
                          const add = (list: string[] | undefined) => [...new Set([...(list ?? []), other])];
                          const drop = (list: string[] | undefined) => (list ?? []).filter((x) => x !== other);
                          if (adjacent) {
                            z.settings.adjacent = drop(z.settings.adjacent);
                            z.settings.notAdjacent = add(z.settings.notAdjacent);
                          } else {
                            z.settings.notAdjacent = drop(z.settings.notAdjacent);
                            z.settings.adjacent = add(z.settings.adjacent);
                          }
                          if (!z.settings.adjacent.length) delete z.settings.adjacent;
                          if (!z.settings.notAdjacent?.length) delete z.settings.notAdjacent;
                        })
                      }
                    >
                      <span className={`map-switch${adjacent ? " on" : ""}`} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              {error && <p role="alert">{error}</p>}
              <div className="map-zones-foot">
                <span className="map-zones-muted">Changes save as one action with a revision check.</span>
                <span>
                  <Dialog.Close className="map-zones-ghost">Cancel</Dialog.Close>{" "}
                  <button type="button" className="map-zones-primary" disabled={busy} onClick={() => void save()}>
                    Save zone
                  </button>
                </span>
              </div>
            </section>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Settings › Players & display: the campaign's split rule (map tokens PR 7A). */
export function SplitRuleSetting({ table }: { table: T }) {
  const { commandOutcome } = useEconomy();
  const rule = readSplitRule(table);
  const [error, setError] = useState("");
  const save = async (next: SplitRuleSettings) => {
    setError("");
    try {
      await commandOutcome({ kind: "zone-save", before: zonesFingerprint(table), zones: table.journal?.world?.zones ?? [], splitRule: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The setting could not be saved.");
    }
  };
  return (
    <div className="map-split-rule" role="group" aria-labelledby="map-split-rule-label">
      <b id="map-split-rule-label">When a player's move would split the party</b>
      <div className="map-zones-seg" role="radiogroup" aria-labelledby="map-split-rule-label">
        {(["block", "session-end", "vote"] as const).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={rule.rule === r} className={rule.rule === r ? "on" : undefined} onClick={() => void save({ ...rule, rule: r })}>
            {SPLIT_LABEL[r]}
          </button>
        ))}
      </div>
      {rule.rule === "vote" && (
        <div className="map-split-vote">
          <label>
            Votes
            <select aria-label="Votes needed" value={rule.majority} onChange={(e) => void save({ ...rule, majority: e.target.value as SplitRuleSettings["majority"] })}>
              <option value="majority">Majority (a tie keeps the party together)</option>
              <option value="unanimous">Unanimous</option>
            </select>
          </label>
          <label>
            Closes after
            <select aria-label="Vote closes after" value={rule.minutes} onChange={(e) => void save({ ...rule, minutes: Number(e.target.value) as SplitRuleSettings["minutes"] })}>
              <option value={2}>2 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={0}>When the session ends</option>
            </select>
          </label>
        </div>
      )}
      <small>Zones can override it. Moves inside a zone never split the party; journeys still need your approval. Default: {SPLIT_LABEL[DEFAULT_SPLIT_RULE.rule]}.</small>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
