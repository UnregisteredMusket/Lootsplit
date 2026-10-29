import { useState, useEffect } from "react";
import { SearchSelect } from "./search-select";
import { Button, Fold } from "./ui";
import { AppLink } from "./app-link";
import { CommandForm, CommandButton } from "./world-tools";
import {
  mapGridSchema,
  travelEnvironments,
  wildernessBiomes,
  type CampaignMap,
  type MapToken,
} from "@/lib/quire/world-schema";
import type { CloudTable } from "@/lib/quire/cloud";
import { getCloudTable, captureMutationScope, assertMutationScope } from "@/lib/quire/cloud-client";
import { encounterRequest } from "@/lib/encounters/client";
import { tileAt, tileDistance, partyEnvironment } from "@/lib/quire/map-tiles";
import { firstFreeSquare, occupiedSquares, sizedToken, tokenFootprint, type TokenSizeClass } from "@/lib/quire/tabletop-geometry";

type Point = { x: number; y: number };
export function GridEditor({ map, set }: { map: CampaignMap; set: (map: CampaignMap) => void }) {
  const grid = map.grid;
  return (
    <Fold title="Combat grid settings" defaultOpen={!!grid}>
      <label>
        <input
          type="checkbox"
          checked={!!grid}
          onChange={(e) => {
            if (!e.target.checked && map.tokens?.length) return;
            set({
              ...map,
              grid: e.target.checked ? mapGridSchema.parse({ columns: 20, rows: 20 }) : undefined,
            });
          }}
        />{" "}
        Enable tile grid
      </label>
      {grid && (
        <>
          <div className="tile-fields">
            {(
              [
                ["columns", "Grid columns", 1, 200],
                ["rows", "Grid rows", 1, 200],
                ["feetPerTile", "Feet per tile", 0.1, 1000000],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={key === "feetPerTile" ? 0.1 : 1}
                  required
                  value={grid[key]}
                  onChange={(e) =>
                    set({ ...map, grid: { ...grid, [key]: Number(e.target.value) } })
                  }
                />
              </label>
            ))}
            <label>
              Diagonal distance
              <SearchSelect
                aria-label="Diagonal distance"
                value={grid.diagonal}
                onValueChange={(v) =>
                  set({ ...map, grid: { ...grid, diagonal: v as typeof grid.diagonal } })
                }
              >
                <option value="equal">One tile per diagonal step</option>
                <option value="euclidean">Straight-line distance</option>
                <option value="orthogonal">Horizontal + vertical distance</option>
                <option value="alternating">
                  Alternating 5/10/5 (every second diagonal costs double)
                </option>
              </SearchSelect>
            </label>
          </div>
          <p>
            Tiles default to 5 ft. Match columns and rows to the image, then align the grid
            rectangle. Distances use your chosen diagonal rule; the DM handles terrain and movement
            limits.
          </p>
          <div className="tile-fields">
            {(
              [
                ["x", "Grid left (%)"],
                ["y", "Grid top (%)"],
                ["width", "Grid width (%)"],
                ["height", "Grid height (%)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={key === "width" || key === "height" ? 1 : 0}
                  max={100}
                  step={0.1}
                  value={Math.round(grid[key] * 1000) / 10}
                  onChange={(e) =>
                    set({ ...map, grid: { ...grid, [key]: Number(e.target.value) / 100 } })
                  }
                />
              </label>
            ))}
          </div>
          {!!map.tokens?.length && (
            <p>Remove or reposition tokens before shrinking the grid past them or disabling it.</p>
          )}
        </>
      )}
    </Fold>
  );
}
export function PartyPlacement({
  map,
  table,
  point,
  begin,
  done,
  bare = false,
}: {
  map: CampaignMap;
  table: CloudTable;
  point?: Point;
  begin: () => void;
  done: () => void;
  /** In the Party position panel (map controls): no fold and no start button; the rail arms it. */
  bare?: boolean;
}) {
  const current = table.journal?.world?.partyPosition;

  const [environment, setEnvironment] = useState<(typeof travelEnvironments)[number]>(
      current?.environment ?? "Roads",
    ),
    [biome, setBiome] = useState<(typeof wildernessBiomes)[number]>(current?.biome ?? "Forest"),
    [description, setDescription] = useState(current?.description ?? "");
  const body = (
    <>
      <p>
        {current
          ? `Travelling: ${partyEnvironment(current)}.`
          : "Place the party anywhere, without creating or choosing a listed location."}
      </p>
      {!bare && <Button onClick={begin}>Place party on map</Button>}
      {point && (
        <CommandForm
          label="Save party travel position"
          dirty={!bare || description !== (current?.description ?? "")}
          submit={() => ({
            kind: "party-map-position",
            before: current ?? null,
            beforeLocationId: table.journal?.market?.currentLocationId ?? null,
            position: {
              mapId: map.id,
              ...point,
              environment,
              ...(environment === "Wilderness" ? { biome } : {}),
              description,
            },
          })}
          onDone={done}
        >
          <label>
            Travel environment
            <SearchSelect
              aria-label="Travel environment"
              value={environment}
              onValueChange={(v) => setEnvironment(v as typeof environment)}
            >
              {travelEnvironments.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </SearchSelect>
          </label>
          {environment === "Wilderness" && (
            <label>
              Wilderness biome
              <SearchSelect
                aria-label="Wilderness biome"
                value={biome}
                onValueChange={(v) => setBiome(v as typeof biome)}
              >
                {wildernessBiomes.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </SearchSelect>
            </label>
          )}
          <label>
            Travel description
            <input
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional trail, region or custom environment"
            />
          </label>
          <p>
            Located shops and property listings are unavailable while travelling. Selecting a listed
            party location ends free placement.
          </p>
        </CommandForm>
      )}
      {current && (
        <CommandButton
          input={{
            kind: "party-map-position",
            before: current,
            beforeLocationId: table.journal?.market?.currentLocationId ?? null,
            position: null,
          }}
        >
          Clear free party position
        </CommandButton>
      )}
    </>
  );
  return bare ? (
    body
  ) : (
    <Fold title="Move party freely" defaultOpen>
      {body}
    </Fold>
  );
}
type EncounterDetail = {
  id: string;
  code: string;
  status: string;
  body: {
    name: string;
    round: number;
    activeId: string;
    combatants: { id: string; name: string; side: string; size?: TokenSizeClass }[];
  };
};
export function CombatControls({
  map,
  table,
  point,
  selected,
  select,
  begin,
  done,
}: {
  map: CampaignMap;
  table: CloudTable;
  point?: Point;
  selected: string;
  select: (id: string) => void;
  begin: () => void;
  done: () => void;
}) {
  const [actor, setActor] = useState(""),
    [label, setLabel] = useState(""),
    [secret, setSecret] = useState(false),
    [column, setColumn] = useState(1),
    [row, setRow] = useState(1),
    [encounters, setEncounters] = useState<{ id: string; name: string; status: string }[]>([]),
    [encounterId, setEncounterId] = useState(map.encounterId ?? ""),
    [detail, setDetail] = useState<EncounterDetail>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const grid = map.grid!,
    tokens = map.tokens ?? [],
    token = tokens.find((t) => t.id === selected),
    tile = point ? tileAt(grid, point) : { column: column - 1, row: row - 1 };
  const tokenColumn = token?.column ?? 0,
    tokenRow = token?.row ?? 0,
    tokenSecret = token?.visibility === "dm",
    tokenLabel = token?.label ?? "",
    tokenActor = token?.entityId ? `${token.kind}:${token.entityId}` : "";
  useEffect(() => {
    setColumn(tokenColumn + 1);
    setRow(tokenRow + 1);
    setSecret(tokenSecret);
    setLabel(tokenLabel);
    setActor(tokenActor);
  }, [selected, map.id, tokenColumn, tokenRow, tokenSecret, tokenLabel, tokenActor]);
  const scope = () => {
    const cloud = getCloudTable();
    return cloud.joined ? cloud.code : "device";
  };
  async function loadEncounters() {
    setBusy(true);
    setError("");
    try {
      const code = scope(),
        res = await encounterRequest<{
          encounters: { id: string; code: string; name: string; status: string }[];
        }>("encounters", { code });
      setEncounters(res.encounters.filter((e) => e.code === code));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load encounters.");
    } finally {
      setBusy(false);
    }
  }
  async function loadDetail(id: string) {
    const expected = captureMutationScope();
    const saved = await encounterRequest<EncounterDetail>("encounters/detail", { id });
    assertMutationScope(expected);
    if (saved.code !== scope())
      throw Error("Resume this encounter's campaign before placing its roster.");
    setDetail(saved);
    return saved;
  }
  const choices = [
    ...table.purses
      .filter((p) => p.kind === "character")
      .map((p) => ({ value: `character:${p.id}`, label: p.name })),
    ...(table.journal?.fleet?.vessels ?? []).map((s) => ({
      value: `ship:${s.propertyId}`,
      label: `Ship · ${table.holdings.find((h) => h.id === s.propertyId)?.name ?? s.propertyId}`,
    })),
  ];
  const actorFields = (value: string) => {
    const colon = value.indexOf(":"),
      kind = value.slice(0, colon);
    return value
      ? { kind: kind as "character" | "ship", entityId: value.slice(colon + 1) }
      : { kind: "other" as const };
  };
  const occupants =
    token?.kind === "ship"
      ? (table.journal?.fleet?.aboard ?? [])
          .filter((a) => a.propertyId === token.entityId)
          .map((a) => table.purses.find((p) => p.id === a.purseId)?.name ?? "Crew member")
      : [];
  return (
    <section className="combat-controls" aria-label="Combat tile controls">
      <p>
        {grid.columns} × {grid.rows} tiles · {grid.feetPerTile} ft per tile. Select a token, choose
        its destination on the map or enter a column and row, then record the move.
      </p>
      <label>
        Combat token
        <SearchSelect
          aria-label="Combat token"
          value={selected}
          onValueChange={(id) => {
            select(id);
            const next = tokens.find((t) => t.id === id);
            if (next) {
              setColumn(next.column + 1);
              setRow(next.row + 1);
              setSecret(next.visibility === "dm");
              setLabel(next.label);
              setActor(next.entityId ? `${next.kind}:${next.entityId}` : "");
            }
          }}
        >
          <option value="">New token</option>
          {tokens.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} · {t.column + 1}, {t.row + 1}
              {t.visibility === "dm" ? " (DM only)" : ""}
            </option>
          ))}
        </SearchSelect>
      </label>
      <Button onClick={begin}>
        {token ? "Choose token destination" : "Choose new token tile"}
      </Button>
      {point && !tile && <p role="alert">Choose a tile inside the grid rectangle.</p>}
      {tile && token && (
        <p role="status">
          Move {token.label} to column {tile.column + 1}, row {tile.row + 1} ·{" "}
          {Math.round(tileDistance(grid, token, tile) * 100) / 100} ft.
          {occupants.length ? ` Aboard: ${occupants.join(", ")}.` : ""}
        </p>
      )}
      <CommandForm
        label={token ? "Save token move" : "Add combat token"}
        dirty={
          !!point ||
          (!!token &&
            (column !== token.column + 1 ||
              row !== token.row + 1 ||
              label !== token.label ||
              secret !== (token.visibility === "dm") ||
              actor !== tokenActor)) ||
          (!token && (!!actor || !!label))
        }
        submit={() => {
          if (!tile) throw Error("Choose a destination inside the grid.");
          const id = token?.id ?? crypto.randomUUID();
          const next: MapToken = {
            ...(token ?? {}),
            id,
            ...actorFields(actor),
            label:
              label.trim() ||
              choices.find((c) => c.value === actor)?.label ||
              token?.label ||
              "Token",
            ...tile,
            visibility: secret ? "dm" : "party",
          };
          // Keep encounter creatures unless deliberately linked to a canonical character/ship.
          if (token?.kind === "creature" && !actor) next.kind = "creature";
          return {
            kind: "map-token",
            mapId: map.id,
            grid,
            tokenId: id,
            before: token ?? null,
            token: next,
          };
        }}
        onDone={() => {
          done();
          if (!token) {
            setActor("");
            setLabel("");
            setSecret(false);
          }
        }}
      >
        <div className="tile-fields">
          <label>
            Token column
            <input
              type="number"
              min={1}
              max={grid.columns}
              value={tile?.column !== undefined ? tile.column + 1 : column}
              onChange={(e) => {
                done();
                setColumn(Number(e.target.value));
              }}
            />
          </label>
          <label>
            Token row
            <input
              type="number"
              min={1}
              max={grid.rows}
              value={tile?.row !== undefined ? tile.row + 1 : row}
              onChange={(e) => {
                done();
                setRow(Number(e.target.value));
              }}
            />
          </label>
        </div>
        <label>
          Character / ship link
          <SearchSelect aria-label="Character / ship link" value={actor} onValueChange={setActor}>
            <option value="">Custom / encounter token</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </SearchSelect>
        </label>
        <label>
          Token label
          <input value={label} maxLength={160} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />{" "}
          DM-only token
        </label>
      </CommandForm>
      {token && (
        <CommandButton
          input={{
            kind: "map-token",
            mapId: map.id,
            grid,
            tokenId: token.id,
            before: token,
            token: null,
          }}
        >
          Remove selected token
        </CommandButton>
      )}
      <Fold title="Use encounter roster">
        <Button disabled={busy} onClick={() => void loadEncounters()}>
          Load campaign encounters
        </Button>
        {!!encounters.length && (
          <label>
            Map encounter
            <SearchSelect
              aria-label="Map encounter"
              value={encounterId}
              onValueChange={(id) => {
                setEncounterId(id);
                setDetail(undefined);
              }}
            >
              <option value="">Choose encounter</option>
              {encounters.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.status}
                </option>
              ))}
            </SearchSelect>
          </label>
        )}
        {encounterId && (
          <>
            <CommandForm
              label="Place encounter roster"
              submit={async () => {
                const e = await loadDetail(encounterId),
                  next = [...tokens];
                for (const c of e.body.combatants) {
                  if (next.some((t) => t.encounterId === e.id && t.combatantId === c.id)) continue;
                  // Footprints: SRD creatures keep their size; each takes its whole free area.
                  const sized = sizedToken(c.size);
                  const cell = firstFreeSquare(grid, occupiedSquares(next), tokenFootprint(sized));
                  if (!cell)
                    throw Error(
                      "The grid has no free tile for the entire roster. Enlarge it first.",
                    );
                  next.push({
                    id: crypto.randomUUID(),
                    kind: "creature",
                    label: c.name,
                    encounterId: e.id,
                    combatantId: c.id,
                    ...sized,
                    ...cell,
                    visibility: "dm",
                  });
                }
                return {
                  kind: "map-save",
                  mapId: map.id,
                  before: map,
                  map: { ...map, encounterId: e.id, tokens: next },
                };
              }}
            >
              <p>
                Imports token names and identities from the saved encounter. New roster tokens start
                DM-only; choose each token to share or link it to a character/ship. HP, initiative,
                conditions and loot stay in the encounter.
              </p>
            </CommandForm>
            <Button
              onClick={() => {
                setError("");
                void loadDetail(encounterId).catch((e) =>
                  setError(e instanceof Error ? e.message : "Could not refresh encounter."),
                );
              }}
            >
              Refresh encounter turn
            </Button>
            <AppLink
              className="settings-link"
              href={`/encounters?encounter=${encodeURIComponent(encounterId)}`}
            >
              Open encounter tracker →
            </AppLink>
          </>
        )}
        {detail && (
          <p>
            Saved encounter: {detail.body.name} · {detail.status} · round {detail.body.round} ·
            active:{" "}
            {detail.body.combatants.find((c) => c.id === detail.body.activeId)?.name ??
              "None selected"}
            . Save tracker changes, then refresh here.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </Fold>
      <p>
        Combat token placement is controlled by the DM and shared through campaign actions. It does
        not change party membership, ship boarding, campaign location or voyage progress.
      </p>
    </section>
  );
}
