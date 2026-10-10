import { useEffect, useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import {
  characterPosition,
  characterLocation,
  campaignMinute,
} from "@/lib/quire/character-position";
import { readMarketLocations, locationLabel } from "@/lib/quire/shop-locations";
import { canonicalJson } from "@/lib/quire/canonical-json";
import type { Purse } from "@/lib/quire/types";
import type { CloudTable } from "@/lib/quire/cloud";
import { SearchSelect } from "./search-select";
import { LocationOptions } from "./market-locations";
import { CommandForm, CommandButton } from "./world-tools";
import { AppLink } from "./app-link";

export function CharacterPlacement({
  selectedId = "",
  npcId,
}: {
  selectedId?: string;
  npcId?: string;
}) {
  const t = useWorldTable(),
    seat = useSeat();
  const [selected, setSelected] = useState(npcId || selectedId);
  useEffect(() => {
    if (npcId || selectedId) setSelected(npcId || selectedId);
  }, [npcId, selectedId]);
  if (seat.role !== "dm") return null;
  const characters = t.purses.filter(
    (p) =>
      p.kind === "character" && !t.journal.tradeEconomy?.exchanges.some((e) => e.purseId === p.id),
  );
  const p = characters.find((p) => p.id === selected);
  return (
    <section
      className="world-card"
      id={npcId ? undefined : "character-placement"}
      aria-label="Character locations and downtime"
    >
      <h2>Character locations & downtime</h2>
      {!npcId && (
        <label>
          Choose a character or NPC
          <SearchSelect
            aria-label="Choose a character or NPC"
            value={selected}
            onValueChange={setSelected}
          >
            <option value="">Choose a character or NPC</option>
            {characters.map((p) => {
              const s = characterPosition(t, p);
              return (
                <option key={p.id} value={p.id}>
                  {p.name} · {s.downtime ? "Downtime" : s.inParty ? "In party" : "Away / NPC list"}
                  {!s.visible ? " · Hidden" : ""}
                </option>
              );
            })}
          </SearchSelect>
        </label>
      )}
      <p className="text-sm text-muted">
        Leaving the party keeps the same sheet, funds, inventory and history. Individual locations
        remain fixed when the party moves. NPC sheets can be shared separately from their records.
      </p>
      {p && (
        <PlacementEditor
          key={`${p.id}:${canonicalJson(characterPosition(t, p))}`}
          p={p}
          table={t}
        />
      )}
    </section>
  );
}
function PlacementEditor({ p, table: t }: { p: Purse; table: CloudTable }) {
  const s = characterPosition(t, p),
    market = readMarketLocations(t.journal?.market);
  const [joined, setJoined] = useState(s.inParty),
    [location, setLocation] = useState(s.locationId ?? characterLocation(t, p) ?? ""),
    [visible, setVisible] = useState(s.visible),
    [sheetVisible, setSheetVisible] = useState(s.sheetVisible),
    [name, setName] = useState(""),
    [days, setDays] = useState(1);
  const actualLocation = characterLocation(t, p);
  return (
    <div>
      <h3>{p.name}</h3>
      <p>
        {s.inParty ? "In party" : s.locationId ? "At a location" : "Outside party / NPC list"} ·{" "}
        {locationLabel(market, actualLocation)} ·{" "}
        {s.visible ? "Visible record" : "Hidden from players"}
      </p>
      <AppLink
        className="settings-link"
        href={`/characters?id=${encodeURIComponent(`party:${p.id}`)}`}
      >
        Open character sheet →
      </AppLink>
      <CommandForm
        label="Save character placement"
        dirty={
          joined !== s.inParty ||
          location !== (s.locationId ?? actualLocation ?? "") ||
          visible !== s.visible ||
          sheetVisible !== s.sheetVisible
        }
        submit={() => ({
          kind: "character-position",
          purseId: p.id,
          before: s,
          inParty: joined,
          locationId: joined ? null : location || null,
          visible,
          sheetVisible,
        })}
      >
        <label>
          <input
            type="checkbox"
            checked={joined}
            disabled={!!s.downtime}
            onChange={(e) => setJoined(e.target.checked)}
          />{" "}
          In party
        </label>
        <label>
          Individual location
          <SearchSelect
            aria-label="Individual character location"
            disabled={joined || !!s.downtime}
            value={location}
            onValueChange={setLocation}
          >
            <option value="">Unassigned / NPC list</option>
            {LocationOptions({ market })}
          </SearchSelect>
        </label>
        <label>
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />{" "}
          Visible to players
        </label>
        {p.control === "npc" && (
          <label>
            <input
              type="checkbox"
              checked={sheetVisible}
              onChange={(e) => setSheetVisible(e.target.checked)}
            />{" "}
            NPC sheet visible to players
          </label>
        )}
      </CommandForm>
      {s.downtime ? (
        <div className="world-card">
          <h3>Downtime: {s.downtime.name}</h3>
          <p>
            Returns after{" "}
            {Math.max(0, Math.ceil((s.downtime.finishMinute - campaignMinute(t)) / 60))} campaign
            hours, on day {Math.floor(s.downtime.finishMinute / 1440)} at{" "}
            {String(Math.floor((s.downtime.finishMinute % 1440) / 60)).padStart(2, "0")}:00. Returns{" "}
            {s.downtime.returnInParty ? "to the party" : "to the previous location / NPC list"}.
          </p>
          <p>
            Advance approved campaign time in Downtime or Session Time. Results and rewards are
            recorded by the DM.
          </p>
          <CommandButton input={{ kind: "character-downtime-cancel", purseId: p.id, before: s }}>
            Cancel character downtime & restore placement
          </CommandButton>
        </div>
      ) : (
        <>
          <CommandForm
            label="Start character downtime"
            dirty={!!name}
            submit={() => ({
              kind: "character-downtime-start",
              purseId: p.id,
              before: s,
              name,
              days,
              locationId: location || null,
            })}
          >
            <h3>Start a downtime action</h3>
            <label>
              Action
              <input
                aria-label="Character downtime action"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Campaign days
              <input
                aria-label="Character downtime days"
                type="number"
                required
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
            <label>
              Downtime location
              <SearchSelect
                aria-label="Character downtime location"
                value={location}
                onValueChange={setLocation}
              >
                <option value="">Unassigned / NPC list</option>
                {LocationOptions({ market })}
              </SearchSelect>
            </label>
            <p className="text-sm text-muted">
              Temporarily leaves the party until this action's campaign time is complete. Completion
              restores the current saved placement. This action does not award money or items.
            </p>
          </CommandForm>
        </>
      )}
      <div className="world-toolbar">
        <AppLink href="/features/downtime">Review campaign downtime →</AppLink>
        <AppLink href="/features/time">Advance Session Time →</AppLink>
      </div>
    </div>
  );
}
