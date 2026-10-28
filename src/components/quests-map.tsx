/**
 * Quests on the map (docs/QUESTS.md "Map"; owner approval 2026-10-25): the map's Quests slot
 * (`MapQuestsSlot`, campaign-map.tsx). Quest pins (accent diamonds) sit beside the map pins and
 * places quests and open objectives are linked to; radius markers are dashed accent circles, a
 * general area the DM may place off-centre. The Quests panel lists the quests on this map (Show
 * all / Only followed / None); picking one highlights and frames its pins and areas and lists its
 * open objectives. The DM links existing map pins and draws, resizes, edits and deletes areas.
 * Everything comes from the table this seat already has: a player's is the projection, so hidden
 * objectives, their pins and areas never arrive.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { Button, Field, Select, TextInput } from "@/components/ui";
import { useQuestCommand, useQuestState } from "@/components/quest-hooks";
import { useSeat } from "@/lib/quire/seat";
import type { CloudTable } from "@/lib/quire/cloud";
import type { CampaignMap } from "@/lib/quire/world-schema";
import { MAX_QUEST_AREAS, MAX_QUEST_MARKERS, type Quest, type QuestDraft } from "@/lib/quire/quests-schema";
import {
  areaRadiusFromUnits,
  areaRadiusUnits,
  linkableMapPins,
  nextObjective,
  placeName,
  questDraft,
  questsOnMap,
} from "@/lib/quire/quest-view";
import type { MapQuestsSlot } from "@/components/campaign-map";
import { cn } from "@/lib/cn";

type Filter = "all" | "followed" | "none";
const questHref = (id: string) => `/features/quests?quest=${encodeURIComponent(id)}`;

export function useQuestMapSlot(
  map: CampaignMap | undefined,
  table: CloudTable,
  /** `/maps?quest=<id>`: pick that quest (once per link) when it is on this map. */
  requested?: string,
): MapQuestsSlot | undefined {
  const seat = useSeat();
  const dm = seat.role === "dm";
  const { state } = useQuestState();
  const { busy, run } = useQuestCommand();
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState("");
  const [focus, setFocus] = useState<{ nonce: string; points: { x: number; y: number }[] }>();
  const [openNonce, setOpenNonce] = useState<string>();
  const [markers, setMarkers] = useState(true);
  const [areas, setAreas] = useState(true);
  const items = useMemo(() => (map ? questsOnMap(table, map, seat) : []), [table, map, seat]);
  const pointsOf = (item: (typeof items)[number]) => [
    ...item.pins.map((p) => ({ x: p.x, y: p.y })),
    // The circle's box (its height is approximated by its width: framing only).
    ...item.areas.flatMap((a) => [
      { x: Math.max(0, a.x - a.r), y: Math.max(0, a.y - a.r) },
      { x: Math.min(1, a.x + a.r), y: Math.min(1, a.y + a.r) },
    ]),
  ];
  const pick = (questId: string) => {
    setPicked(questId);
    const item = items.find((i) => i.quest.id === questId);
    if (item) setFocus({ nonce: crypto.randomUUID(), points: pointsOf(item) });
  };
  const handled = useRef("");
  const requestedHere = !!requested && items.some((i) => i.quest.id === requested);
  useEffect(() => {
    if (!requested || !requestedHere || handled.current === `${map?.id}:${requested}`) return;
    handled.current = `${map?.id}:${requested}`;
    pick(requested);
    setOpenNonce(crypto.randomUUID());
    // Once per link and map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, requestedHere, map?.id]);
  if (!map) return undefined;
  // Players get the tool only when a quest they know has something on this map.
  if (!dm && !items.length) return undefined;
  const quests = table.journal?.quests?.quests ?? [];
  const pickedItem = items.find((i) => i.quest.id === picked);
  const pickedQuest = quests.find((q) => q.id === picked);
  // What the map draws: the filter, plus the picked quest always.
  const drawn = items.filter(
    (i) => i.quest.id === picked || filter === "all" || (filter === "followed" && i.quest.id === state.follow),
  );
  const save = async (quest: Quest, change: (draft: QuestDraft) => QuestDraft, ok: string) =>
    run(
      { id: crypto.randomUUID(), kind: "quest-save", questId: quest.id, revision: quest.revision, quest: change(questDraft(quest)) },
      ok,
    );
  const panel: ReactNode = (
    <div className="quest-map-panel">
      <div className="quest-map-filter" role="radiogroup" aria-label="Quests on the map">
        {(
          [
            ["all", "Show all"],
            ["followed", "Only followed"],
            ["none", "None"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className={cn("quest-map-filter-option", filter === value && "selected")}>
            <input type="radio" name="quest-map-filter" checked={filter === value} onChange={() => setFilter(value)} />
            {label}
          </label>
        ))}
      </div>
      {items.length ? (
        <ul className="quest-map-list">
          {items.map((i) => (
            <li key={i.quest.id}>
              <button type="button" aria-pressed={picked === i.quest.id} className="quest-map-row" onClick={() => pick(i.quest.id)}>
                <span className="map-quest-diamond" aria-hidden="true" />
                <span>
                  <strong>{i.quest.title}</strong>
                  <small>
                    {[i.quest.id === state.follow ? "Following" : "", nextObjective(i.quest)?.text ?? "", dm && i.quest.audience.kind === "none" ? "Draft" : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="quest-muted">
          {dm
            ? "No quest has a pin, place or area on this map. Pick a quest below to add one."
            : "No quest you know has anything on this map."}
        </p>
      )}
      {pickedItem && (
        <section className="quest-map-detail" aria-label={`On the map: ${pickedItem.quest.title}`}>
          <h3>{pickedItem.quest.title}</h3>
          {pickedItem.openObjectives.length ? (
            <ul className="quest-objectives compact">
              {pickedItem.openObjectives.map((o) => (
                <li key={o.id} className="open">
                  <span className="quest-mark" aria-hidden="true" />
                  <span>
                    <span className="quest-objective-text">{o.text}</span>
                    {o.locationId && <small>{placeName(table, o.locationId)}</small>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quest-muted">No open objectives.</p>
          )}
          <AppLink className="quest-link" href={questHref(pickedItem.quest.id)}>
            Open the quest log →
          </AppLink>
        </section>
      )}
      {dm && (
        <DmQuestMapTools
          map={map}
          table={table}
          quests={quests.filter((q) => !q.archived && q.status === "active")}
          picked={pickedQuest}
          pick={pick}
          busy={busy}
          save={save}
        />
      )}
    </div>
  );
  const highlighted = (questId: string) => questId === picked;
  return {
    count: items.length,
    panel,
    layers: { markers, areas, setMarkers, setAreas },
    pins: drawn.flatMap((i) =>
      i.pins.map((p) => ({ ...p, title: i.quest.title, highlighted: highlighted(i.quest.id) })),
    ),
    areas: drawn.flatMap((i) =>
      i.areas.map((a) => ({ ...a, title: i.quest.title, highlighted: highlighted(i.quest.id), editable: dm })),
    ),
    select: pick,
    focus,
    openNonce,
    moveArea: dm
      ? (key, next) => {
          const item = items.find((i) => i.areas.some((a) => a.key === key));
          const area = item?.areas.find((a) => a.key === key);
          if (!item || !area) return;
          void save(
            item.quest,
            (d) => ({ ...d, areas: d.areas.map((a) => (a.id === area.areaId ? { ...a, x: next.x, y: next.y, r: next.r } : a)) }),
            "Area moved.",
          );
        }
      : undefined,
  };
}

/** DM: pick any active quest, link this map's pins to it, add and edit its radius markers. */
function DmQuestMapTools({
  map,
  table,
  quests,
  picked,
  pick,
  busy,
  save,
}: {
  map: CampaignMap;
  table: CloudTable;
  quests: Quest[];
  picked?: Quest;
  pick: (id: string) => void;
  busy: boolean;
  save: (quest: Quest, change: (d: QuestDraft) => QuestDraft, ok: string) => Promise<boolean>;
}) {
  const pins = linkableMapPins(table, map);
  const [pinChoice, setPinChoice] = useState("");
  const units = areaRadiusUnits(map, 1);
  if (!quests.length) return <p className="quest-muted">Write a quest first (Open the quest log → New quest).</p>;
  const q = picked;
  const areasHere = q ? q.areas.filter((a) => a.mapId === map.id) : [];
  const linked = q ? q.markers.filter((m) => m.mapId === map.id) : [];
  return (
    <section className="quest-map-tools" aria-label="Quest map tools">
      <Field label="Quest">
        <Select value={q?.id ?? ""} onChange={(e) => e.target.value && pick(e.target.value)}>
          <option value="">Choose a quest…</option>
          {quests.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
              {x.audience.kind === "none" ? " (draft)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      {q && (
        <>
          <h3>Pins on this map</h3>
          {linked.map((m) => (
            <div key={m.markerId} className="quest-map-item">
              <span>
                <MapPin size={14} aria-hidden="true" /> {pins.find((p) => p.markerId === m.markerId)?.label ?? "Pin"}
              </span>
              <button
                type="button"
                className="map-icon-button"
                aria-label={`Unlink ${pins.find((p) => p.markerId === m.markerId)?.label ?? "pin"}`}
                disabled={busy}
                onClick={() => void save(q, (d) => ({ ...d, markers: d.markers.filter((x) => !(x.mapId === map.id && x.markerId === m.markerId)) }), "Pin unlinked.")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {pins.length > 0 && q.markers.length < MAX_QUEST_MARKERS && (
            <div className="quest-map-add">
              <Field label="Link a pin on this map">
                <Select value={pinChoice} onChange={(e) => setPinChoice(e.target.value)}>
                  <option value="">Choose a pin…</option>
                  {pins
                    .filter((p) => !linked.some((m) => m.markerId === p.markerId))
                    .map((p) => (
                      <option key={p.markerId} value={p.markerId}>
                        {p.label}
                      </option>
                    ))}
                </Select>
              </Field>
              <Button
                variant="secondary"
                disabled={busy || !pinChoice}
                onClick={async () => {
                  if (await save(q, (d) => ({ ...d, markers: [...d.markers, { mapId: map.id, markerId: pinChoice }] }), "Pin linked to the quest."))
                    setPinChoice("");
                }}
              >
                Link pin
              </Button>
            </div>
          )}
          <h3>Areas on this map</h3>
          <p className="quest-muted">
            A general area, not an exact spot: place it off-centre if you like. Drag its centre or edge on the map.
          </p>
          {areasHere.map((a) => (
            <AreaRow key={a.id} quest={q} area={a} map={map} units={units?.unit} busy={busy} save={save} />
          ))}
          {q.areas.length < MAX_QUEST_AREAS && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const anchor = linked[0] ? map.markers.find((m) => m.id === linked[0]!.markerId) : undefined;
                const id = crypto.randomUUID();
                void save(
                  q,
                  (d) => ({ ...d, areas: [...d.areas, { id, mapId: map.id, x: anchor?.x ?? 0.5, y: anchor?.y ?? 0.5, r: 0.08 }] }),
                  "Area added. Drag it into place.",
                ).then((ok) => ok && pick(q.id));
              }}
            >
              <Plus size={16} aria-hidden="true" /> Add radius area
            </Button>
          )}
          <p className="quest-muted">Places (market locations) are linked in the quest log, per quest and per objective.</p>
        </>
      )}
    </section>
  );
}

function AreaRow({
  quest,
  area,
  map,
  units,
  busy,
  save,
}: {
  quest: Quest;
  area: Quest["areas"][number];
  map: CampaignMap;
  units?: string;
  busy: boolean;
  save: (quest: Quest, change: (d: QuestDraft) => QuestDraft, ok: string) => Promise<boolean>;
}) {
  const shown = areaRadiusUnits(map, area.r);
  const [label, setLabel] = useState(area.label ?? "");
  const [radius, setRadius] = useState(shown ? String(Math.round(shown.value * 10) / 10) : String(Math.round(area.r * 1000) / 10));
  const [objective, setObjective] = useState(area.objectiveId ?? "");
  const nextR = units ? areaRadiusFromUnits(map, Number(radius)) : Number(radius) > 0 ? Math.min(2, Number(radius) / 100) : undefined;
  const changed = label !== (area.label ?? "") || objective !== (area.objectiveId ?? "") || (nextR !== undefined && Math.abs(nextR - area.r) > 1e-6);
  return (
    <div className="quest-map-area">
      <Field label="Label (players read this)">
        <TextInput value={label} maxLength={120} placeholder="Harkon's horse is somewhere in here" onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label={units ? `Radius (${units})` : "Radius (% of the map width)"}>
        <TextInput type="number" inputMode="decimal" min="0" step="any" value={radius} onChange={(e) => setRadius(e.target.value)} />
      </Field>
      <Field label="For objective">
        <Select value={objective} onChange={(e) => setObjective(e.target.value)}>
          <option value="">The whole quest</option>
          {quest.objectives.map((o) => (
            <option key={o.id} value={o.id}>
              {o.text}
              {o.hidden ? " (hidden)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <div className="quest-actions">
        <Button
          variant="secondary"
          disabled={busy || !changed || nextR === undefined}
          onClick={() =>
            void save(
              quest,
              (d) => ({
                ...d,
                areas: d.areas.map((a) =>
                  a.id === area.id
                    ? {
                        id: a.id,
                        mapId: a.mapId,
                        x: a.x,
                        y: a.y,
                        r: nextR ?? a.r,
                        ...(label.trim() ? { label: label.trim() } : {}),
                        ...(objective ? { objectiveId: objective } : {}),
                      }
                    : a,
                ),
              }),
              "Area saved.",
            )
          }
        >
          Save area
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void save(quest, (d) => ({ ...d, areas: d.areas.filter((a) => a.id !== area.id) }), "Area deleted.")}
        >
          <Trash2 size={16} aria-hidden="true" /> Delete area
        </Button>
      </div>
    </div>
  );
}
