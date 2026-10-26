import { useState } from "react";
import {
  connectedMapSchema,
  mapRecordTypes,
  type MapRecordReference,
} from "@/lib/quire/connected-maps-schema";
import { mapReferenceName } from "@/lib/quire/connected-maps";
import type { CampaignMap } from "@/lib/quire/world-schema";
import type { CloudTable } from "@/lib/quire/cloud";
import { Button, Fold } from "./ui";
import { SearchSelect } from "./search-select";
import { CommandButton, CommandForm } from "./world-tools";

export type EntranceDraft = {
  /** The map the entrance is on. */
  mapId: string;
  point: { x: number; y: number };
  target: string;
  label: string;
  visibility: "party" | "dm";
  entry?: { x: number; y: number; zoom: number };
};
const round = (n: number) => Math.round(n * 1000) / 1000;

export function MapConnectedTools({
  map,
  reveal,
  table,
  point,
  begin,
  done,
  only,
  entranceDraft,
  pickEntry,
}: {
  map: CampaignMap;
  reveal?: boolean;
  table: CloudTable;
  point?: { x: number; y: number };
  begin: () => void;
  done: () => void;
  /** Map controls: render just one form, for the Place record or Entrance panel. */
  only?: "record" | "entrance";
  /** An entrance being finished after its entry camera was picked on the destination map. */
  entranceDraft?: EntranceDraft;
  /** Start picking the entry camera on the destination map (Entrance panel). */
  pickEntry?: (draft: EntranceDraft) => void;
}) {
  const connected = map.connected ?? connectedMapSchema.parse({}),
    maps = table.journal?.world?.maps ?? [];

  const [parent, setParent] = useState(connected.parentMapId ?? ""),
    [purpose, setPurpose] = useState(connected.defaultForLocation ?? ""),
    [kind, setKind] = useState<MapRecordReference["kind"]>("shop"),
    [recordId, setRecordId] = useState(""),
    [label, setLabel] = useState(""),
    [visibility, setVisibility] = useState<"party" | "dm">(entranceDraft?.visibility ?? "party"),
    [target, setTarget] = useState(entranceDraft?.target ?? ""),
    [linkLabel, setLinkLabel] = useState(entranceDraft?.label ?? ""),
    [entry, setEntry] = useState(!!entranceDraft?.entry),
    [entryX, setEntryX] = useState(round(entranceDraft?.entry?.x ?? 0.5)),
    [entryY, setEntryY] = useState(round(entranceDraft?.entry?.y ?? 0.5)),
    [entryZoom, setEntryZoom] = useState(round(entranceDraft?.entry?.zoom ?? 1));
  const existing = () =>
    connected.placements.find((p) => p.record.kind === kind && p.record.id === recordId);
  const rows =
    kind === "location"
      ? table.journal?.market?.locations
      : kind === "shop"
        ? table.shops
        : kind === "npc"
          ? table.journal?.world?.npcs
          : kind === "character"
            ? table.purses.filter((p) => p.kind === "character")
            : kind === "property"
              ? table.holdings.filter((h) => h.kind === "property" && h.quantity > 0)
              : kind === "listing"
                ? table.listings
                : kind === "exchange"
                  ? table.journal?.tradeEconomy?.exchanges
                  : kind === "facility"
                    ? table.journal?.fleet?.facilities
                    : kind === "entry"
                      ? table.journal?.entries
                      : table.handouts;
  const save = (next: typeof connected) => ({
    kind: "map-save" as const,
    mapId: map.id,
    before: map,
    map: { ...map, connected: next },
  });
  const recordForm = (
    <CommandForm
      label={existing() ? "Save record placement" : "Place record on map"}
      dirty={!!point}
      submit={() => {
        if (!point || !recordId) throw Error("Choose a record, then tap its position on the map.");
        const current = existing();
        return save({
          ...connected,
          placements: [
            ...connected.placements.filter(
              (p) => !(p.record.kind === kind && p.record.id === recordId),
            ),
            {
              id: current?.id ?? crypto.randomUUID(),
              record: { kind, id: recordId },
              ...point,
              visibility,
              label: label.trim() || undefined,
            },
          ],
        });
      }}
      onDone={done}
    >
      {!only && <h3>Place an existing record</h3>}
      <label>
        Record type
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setRecordId("");
            setLabel("");
          }}
        >
          {mapRecordTypes.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label>
        Record
        <SearchSelect
          aria-label="Record to place"
          value={recordId}
          onValueChange={(id) => {
            setRecordId(id);
            const p = connected.placements.find(
              (p) => p.record.kind === kind && p.record.id === id,
            );
            setLabel(p?.label ?? "");
            setVisibility(p?.visibility ?? "party");
          }}
        >
          <option value="">Choose an existing record</option>
          {(rows ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {mapReferenceName(table, { kind, id: r.id })}
            </option>
          ))}
        </SearchSelect>
      </label>
      <label>
        Pin label (optional)
        <input value={label} maxLength={160} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label>
        Pin visibility
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as typeof visibility)}
        >
          <option value="party">Shared when the record is accessible</option>
          <option value="dm">DM only</option>
        </select>
      </label>
      {!only && <Button onClick={begin}>Choose record position</Button>}
      {point && (
        <p>
          Position: {Math.round(point.x * 100)}%, {Math.round(point.y * 100)}%
        </p>
      )}
      <p>
        Moving this pin changes only the map. The record’s location, inventory and permissions
        stay authoritative.
      </p>
    </CommandForm>
  );
  const entranceForm = (
    <CommandForm
      label="Add map entrance"
      dirty={!!linkLabel}
      submit={() => {
        if (!point || !target || !linkLabel.trim())
          throw Error("Name the entrance, choose a destination and tap its map position.");
        return save({
          ...connected,
          links: [
            ...connected.links,
            {
              id: crypto.randomUUID(),
              targetMapId: target,
              label: linkLabel.trim(),
              ...point,
              visibility,
              entry: entry ? { x: entryX, y: entryY, zoom: entryZoom } : undefined,
            },
          ],
        });
      }}
      onDone={() => {
        setLinkLabel("");
        setEntry(false);
        done();
      }}
    >
      {!only && <h3>Link an entrance or another floor</h3>}
      <label>
        Entrance name
        <input value={linkLabel} maxLength={160} onChange={(e) => setLinkLabel(e.target.value)} />
      </label>
      <label>
        Destination map
        <SearchSelect aria-label="Entrance destination" value={target} onValueChange={setTarget}>
          <option value="">Choose a map</option>
          {maps
            .filter((m) => m.id !== map.id)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </SearchSelect>
      </label>
      <label>
        <input type="checkbox" checked={entry} onChange={(e) => setEntry(e.target.checked)} /> Use
        a destination entry camera
      </label>
      {pickEntry && point && target && (
        <Button
          onClick={() =>
            pickEntry({
              mapId: map.id,
              point,
              target,
              label: linkLabel,
              visibility,
              entry: entry ? { x: entryX, y: entryY, zoom: entryZoom } : undefined,
            })
          }
        >
          Pick the entry view on the destination
        </Button>
      )}
      {entry && (
        <div className="world-toolbar">
          {(
            [
              ["Horizontal", entryX, setEntryX],
              ["Vertical", entryY, setEntryY],
              ["Zoom", entryZoom, setEntryZoom],
            ] as const
          ).map(([name, value, set]) => (
            <label key={name}>
              {name}
              <input
                aria-label={`Entry ${name.toLowerCase()}`}
                type="number"
                min={name === "Zoom" ? 0.1 : 0}
                max={name === "Zoom" ? 8 : 1}
                step="0.1"
                value={value}
                onChange={(e) => set(Number(e.target.value))}
              />
            </label>
          ))}
        </div>
      )}
      <p>
        Visibility: {visibility === "party" ? "shared when both maps are accessible" : "DM only"}.
        Entry cameras change the view; they do not move tokens.
      </p>
      <label>
        Entrance visibility
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as typeof visibility)}
        >
          <option value="party">Shared when the destination is accessible</option>
          <option value="dm">DM only</option>
        </select>
      </label>
      {!only && <Button onClick={begin}>Choose entrance position</Button>}
    </CommandForm>
  );
  if (only === "record") return recordForm;
  if (only === "entrance") return entranceForm;
  return (
    <Fold title="Connected maps & places" reveal={reveal}>
      <CommandForm
        label="Save map connections"
        dirty={
          parent !== (connected.parentMapId ?? "") ||
          purpose !== (connected.defaultForLocation ?? "")
        }
        submit={() =>
          save({
            ...connected,
            parentMapId: parent || undefined,
            defaultForLocation: (purpose || undefined) as typeof connected.defaultForLocation,
          })
        }
      >
        <label>
          Parent map
          <SearchSelect aria-label="Parent map" value={parent} onValueChange={setParent}>
            <option value="">No parent map</option>
            {maps
              .filter((m) => m.id !== map.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </SearchSelect>
        </label>
        <label>
          Default for this location
          <select
            aria-label="Default for this location"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          >
            <option value="">Choose explicitly when several maps exist</option>
            <option value="regional">Regional overview</option>
            <option value="local">Local / area map</option>
            <option value="battle">Battle map</option>
          </select>
        </label>
        <p>
          Defaults require a linked location in the map editor. Parent maps organize navigation;
          opening a map does not move the party.
        </p>
      </CommandForm>
      {recordForm}
      {connected.placements.map((p) => (
        <div className="world-row" key={p.id}>
          <span>
            {p.label ?? mapReferenceName(table, p.record)} · {p.visibility}
          </span>
          <CommandButton
            input={save({
              ...connected,
              placements: connected.placements.filter((x) => x.id !== p.id),
            })}
          >
            Remove record pin
          </CommandButton>
        </div>
      ))}
      {entranceForm}
      {connected.links.map((l) => (
        <div className="world-row" key={l.id}>
          <span>
            {l.label} → {maps.find((m) => m.id === l.targetMapId)?.name ?? "Unavailable"}
          </span>
          <CommandButton
            input={save({ ...connected, links: connected.links.filter((x) => x.id !== l.id) })}
          >
            Remove entrance
          </CommandButton>
        </div>
      ))}
    </Fold>
  );
}
