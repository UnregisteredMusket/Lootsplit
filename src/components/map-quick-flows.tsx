import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import { encounterRequest } from "@/lib/encounters/client";
import { blankEncounter } from "@/lib/encounters/model.mjs";
import { encounterDetailPoller } from "@/lib/encounters/detail-poller";
import type { CloudTable } from "@/lib/quire/cloud";
import type { CommandInput } from "@/lib/quire/commands";
import { attemptKey, creatureAttempt, withCombatants, type CreatureAttempt } from "@/lib/quire/add-creatures";
import { DEFAULT_FORMATION, planFormation } from "@/lib/quire/formation";
import { snapTokenPosition, sizedToken, type TokenSizeClass } from "@/lib/quire/tabletop-geometry";
import { readMapTabletop, readTabletopSession } from "@/lib/quire/tabletop";
import { resultToast } from "@/lib/quire/result-toast";
import type { CampaignMap, MapToken } from "@/lib/quire/world-schema";

type Creature = {
  id: string;
  name: string;
  cr: number;
  maxHp: number;
  ac: number;
  type: string;
  sourceKey: string;
  size?: TokenSizeClass;
} & Record<string, unknown>;
type EncounterRow = { id: string; name: string; status: string; code: string };
type Detail = { id: string; revision: number; code: string; status: string; body: { combatants: { id: string }[] } & Record<string, unknown> };

const SEARCH_DEFAULTS = { partySize: 4, level: 1, difficulty: "medium", mode: "difficulty", cr: 0, count: 1, environment: "" };

/**
 * Add creatures here… (map tokens PR 6, map menu): search the SRD creature index, pick how many
 * of each, choose the encounter (the one on this map, another saved one, or a new one) and add
 * them in one go: the tracker's revision-checked `encounters/save` first, then DM-only tokens in a
 * cluster at the clicked square with one `map-tokens-place` (ids come from the new combatants, so a
 * retry never places twice).
 */
export function AddCreaturesPanel({
  map,
  table,
  code,
  point,
  act,
  close,
}: {
  map: CampaignMap;
  table: Pick<CloudTable, "journal">;
  /** The encounter store's campaign code ("device" on this device). */
  code: string;
  point: { x: number; y: number };
  act: (input: CommandInput, done?: () => void) => Promise<void>;
  close: () => void;
}) {
  const bound = table.journal?.world?.combat?.encounterId ?? map.encounterId ?? "";
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Creature[]>([]),
    [picks, setPicks] = useState<{ creature: Creature; count: number }[]>([]),
    [encounters, setEncounters] = useState<EncounterRow[]>([]),
    [encounterId, setEncounterId] = useState(bound || "new"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    searchRef = useRef<HTMLInputElement>(null),
    // One attempt's IDs, kept for a retry with the same picks (never duplicates combatants).
    attempt = useRef<CreatureAttempt | null>(null);
  useEffect(() => {
    searchRef.current?.focus();
    let cancelled = false;
    void encounterRequest<{ encounters: EncounterRow[] }>("encounters", { code })
      .then((r) => {
        if (cancelled) return;
        const open = r.encounters.filter((e) => e.code === code && ["draft", "active"].includes(e.status));
        setEncounters(open);
        if (!bound && open[0]) setEncounterId(open[0].id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [code, bound]);
  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    setError("");
    try {
      const r = await encounterRequest<{ creatures: Creature[] }>("encounters/index", {
        code,
        filters: { ...SEARCH_DEFAULTS, enemy: query.trim() },
        page: 1,
      });
      setResults(r.creatures);
      if (!r.creatures.length) setError("No creatures match. Try another name or type.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The creature index could not be searched.");
    }
  }
  const bump = (creature: Creature, delta: number) =>
    setPicks((current) => {
      const at = current.findIndex((p) => p.creature.sourceKey === creature.sourceKey);
      if (at < 0) return delta > 0 ? [...current, { creature, count: 1 }] : current;
      const count = Math.max(0, Math.min(20, current[at].count + delta));
      return count ? current.map((p, i) => (i === at ? { ...p, count } : p)) : current.filter((_, i) => i !== at);
    });
  const total = picks.reduce((n, p) => n + p.count, 0);
  async function add() {
    if (!total || !map.grid) return;
    setBusy(true);
    setError("");
    try {
      const pickKeys = picks.map((p) => ({ key: p.creature.sourceKey, count: p.count }));
      const run = (attempt.current = creatureAttempt(attempt.current, pickKeys, encounterId, () => crypto.randomUUID()));
      let id = run.encounterId;
      if (encounterId === "new") {
        id = (
          await encounterRequest<{ id: string }>("encounters/create", {
            code,
            id,
            encounter: { ...blankEncounter(), name: `${map.name} encounter` },
          })
        ).id;
        setEncounterId(id);
        // The retry now names the created encounter; it keeps this attempt's IDs.
        attempt.current = { ...run, key: attemptKey(pickKeys, id), encounterId: id };
      }
      const detail = await encounterRequest<Detail>("encounters/detail", { id });
      let next = 0;
      const joining = picks.flatMap(({ creature, count }) =>
        Array.from({ length: count }, (_, i) => {
          const { type: _type, environments: _environments, ...combatant } = creature;
          return { ...combatant, id: run.combatantIds[next++]!, name: count > 1 ? `${creature.name} ${i + 1}` : creature.name };
        }),
      );
      const merged = withCombatants(detail.body.combatants, joining);
      if (merged.combatants.length > 100) throw Error("An encounter can contain up to 100 combatants.");
      if (merged.added)
        await encounterRequest("encounters/save", {
          id: detail.id,
          revision: detail.revision,
          encounter: { ...detail.body, combatants: merged.combatants },
        });
      encounterDetailPoller.refresh(detail.id);
      // DM-only tokens in a cluster at the point, sized from the stat blocks.
      const anchor = snapTokenPosition(map.grid, {}, point) ?? { column: 0, row: 0 };
      const placedIds = new Set((map.tokens ?? []).map((t) => t.id));
      const tokens: MapToken[] = joining.map((c, i) => ({
        id: run.tokenIds[i]!,
        kind: "creature",
        label: c.name,
        encounterId: id,
        combatantId: c.id,
        column: 0,
        row: 0,
        visibility: "dm",
        ...sizedToken((c as Creature).size),
      }));
      const missing = tokens.filter((t) => !placedIds.has(t.id));
      const done = () => {
        attempt.current = null;
        resultToast(`Added ${joining.length} ${joining.length === 1 ? "creature" : "creatures"} to the encounter, hidden from players`);
        close();
      };
      // A retry whose placement already landed: nothing left to place.
      if (!missing.length) return done();
      const plan = planFormation(map.grid, map.tokens ?? [], missing, { column: anchor.column, row: anchor.row }, readTabletopSession(table).partyFormation ?? DEFAULT_FORMATION, readMapTabletop(map).walls);
      if (plan.unplaced) throw Error("There is no room here for every creature. Choose another spot.");
      await act(
        {
          kind: "map-tokens-place",
          mapId: map.id,
          grid: map.grid,
          place: plan.places.map((p) => {
            const token = missing.find((t) => t.id === p.id)!;
            return { tokenId: p.id, before: null, token: { ...token, column: p.column, row: p.row } };
          }),
        },
        done,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The creatures could not be added. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside
      className="map-side-panel map-setup-panel map-quick-panel map-glass"
      role="dialog"
      aria-modal="false"
      aria-labelledby="map-add-creatures-heading"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="map-panel-heading">
        <h2 id="map-add-creatures-heading">Add creatures here</h2>
        <button className="map-icon-button" aria-label="Close Add creatures here" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <form className="map-quick-search" onSubmit={(e) => void search(e)}>
        <input
          ref={searchRef}
          type="search"
          aria-label="Search SRD creatures"
          placeholder="Search SRD creatures (goblin, undead…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="map-icon-button" aria-label="Search">
          <Search size={16} />
        </button>
      </form>
      <ul className="map-quick-list" aria-label="Creatures">
        {results.map((c) => {
          const count = picks.find((p) => p.creature.sourceKey === c.sourceKey)?.count ?? 0;
          return (
            <li key={c.sourceKey}>
              <span>
                <strong>{c.name}</strong>
                <small>
                  CR {c.cr} · {c.type} · HP {c.maxHp} · AC {c.ac}
                </small>
              </span>
              <span className="map-place-party-step">
                <button type="button" aria-label={`One fewer ${c.name}`} disabled={!count} onClick={() => bump(c, -1)}>
                  <Minus size={14} />
                </button>
                <small aria-live="polite">{count}</small>
                <button type="button" aria-label={`Add ${c.name}`} onClick={() => bump(c, 1)}>
                  <Plus size={14} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <label className="map-quick-field">
        Encounter
        <select aria-label="Encounter for the creatures" value={encounterId} onChange={(e) => setEncounterId(e.target.value)}>
          {encounters.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.id === bound ? " · on this map" : ""}
            </option>
          ))}
          {bound && !encounters.some((e) => e.id === bound) && <option value={bound}>The encounter on this map</option>}
          <option value="new">New encounter</option>
        </select>
      </label>
      <p>Creatures join the encounter's tracker and appear here hidden from players; reveal them when the fight begins. Open5e SRD 5.1 credits stay with each creature.</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="map-quick-primary" disabled={!total || busy || !map.grid} onClick={() => void add()}>
        {total ? `Add ${total} ${total === 1 ? "creature" : "creatures"} here` : "Choose creatures to add"}
      </button>
    </aside>
  );
}

/**
 * Add characters here… (map tokens PR 6): tick any campaign characters (in any group, or none) and
 * place them at the clicked square in the party's formation as one action with Undo; characters
 * already on this map move there.
 */
export function AddCharactersPanel({
  rows,
  place,
  close,
}: {
  rows: { purseId: string; name: string; status: string }[];
  place: (purseIds: string[]) => void;
  close: () => void;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <aside
      className="map-side-panel map-setup-panel map-quick-panel map-glass"
      role="dialog"
      aria-modal="false"
      aria-labelledby="map-add-characters-heading"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="map-panel-heading">
        <h2 id="map-add-characters-heading">Add characters here</h2>
        <button className="map-icon-button" aria-label="Close Add characters here" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <p>Tick the characters to place here, in the party's formation. Characters already on this map move here.</p>
      <ul className="map-place-party-list" aria-label="Characters">
        {rows.map((row, i) => (
          <li key={row.purseId} className={checked.includes(row.purseId) ? undefined : "off"}>
            <label>
              <input
                ref={i === 0 ? first : undefined}
                type="checkbox"
                checked={checked.includes(row.purseId)}
                onChange={() => setChecked((c) => (c.includes(row.purseId) ? c.filter((x) => x !== row.purseId) : [...c, row.purseId]))}
              />
              <span className="map-place-party-avatar" aria-hidden="true">
                {row.name.slice(0, 1).toUpperCase()}
              </span>
              {row.name}
              <small>{row.status}</small>
            </label>
          </li>
        ))}
      </ul>
      <button type="button" className="map-quick-primary" disabled={!checked.length} onClick={() => place(checked)}>
        {checked.length ? `Place ${checked.length} here` : "Choose characters"}
      </button>
    </aside>
  );
}
