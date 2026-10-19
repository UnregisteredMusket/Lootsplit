import { useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { libraryRecordHref } from "@/lib/quire/library-records";
import { readMapTabletop } from "@/lib/quire/tabletop";
import type { CampaignMap, MapToken } from "@/lib/quire/world-schema";
import type { MapTabletop, AreaTemplate } from "@/lib/quire/tabletop-schema";
import { Button, Fold } from "./ui";
import { CommandForm } from "./world-tools";
import { AppLink } from "./app-link";
type Position = { column: number; row: number; offsetX?: number; offsetY?: number };
type Move = { tokenId: string; before: Position; after: Position };
const position = (token: Position): Position => ({
  column: token.column,
  row: token.row,
  offsetX: token.offsetX,
  offsetY: token.offsetY,
});

export function TemplateShape({ map, template }: { map: CampaignMap; template: AreaTemplate }) {
  const grid = map.grid!,
    distance = template.distanceFeet,
    width = template.widthFeet,
    half = (template.angle * Math.PI) / 360,
    x = Math.cos(half) * distance,
    y = Math.sin(half) * distance;
  return (
    <g
      className="tabletop-area"
      transform={`translate(${template.origin.x * 1000} ${template.origin.y * 1000}) scale(${(1000 * grid.width) / grid.columns / grid.feetPerTile} ${(1000 * grid.height) / grid.rows / grid.feetPerTile}) rotate(${template.direction})`}
    >
      {template.kind === "circle" ? (
        <circle r={distance} />
      ) : template.kind === "cone" ? (
        <path
          d={`M0 0 L${x} ${-y} A${distance} ${distance} 0 ${template.angle > 180 ? 1 : 0} 1 ${x} ${y} Z`}
        />
      ) : (
        <rect
          x={template.kind === "rectangle" ? -distance / 2 : 0}
          y={-width / 2}
          width={distance}
          height={width}
        />
      )}
    </g>
  );
}

export function TokenInspector({
  map,
  token,
  canMove,
  move,
}: {
  map: CampaignMap;
  token: MapToken;
  canMove: boolean;
  move: (move: Move) => void;
}) {
  const table = useWorldTable(),
    dm = useSeat().role === "dm",
    [base, setBase] = useState(token),
    [draft, setDraft] = useState(token),
    [column, setColumn] = useState(token.column + 1),
    [row, setRow] = useState(token.row + 1);
  const person = table.purses.find((person) => person.id === token.entityId),
    ship = table.holdings.find((item) => item.id === token.entityId),
    href =
      token.kind === "character"
        ? libraryRecordHref("character", token.entityId!)
        : token.kind === "ship"
          ? libraryRecordHref("property", token.entityId!)
          : token.encounterId
            ? `/encounters?encounter=${encodeURIComponent(token.encounterId)}`
            : undefined;
  return (
    <section className="tabletop-object-editor">
      <h3>{person?.name || ship?.name || token.label}</h3>
      {person?.portrait && (
        <img className="tabletop-portrait" src={person.portrait} alt={person.name} />
      )}
      {href && (
        <AppLink className="settings-link" href={href}>
          Open linked {token.kind === "creature" ? "encounter" : token.kind} →
        </AppLink>
      )}
      <p>
        {token.visibility === "dm" ? "DM only" : "Shared token"}
        {token.locked ? " · locked for players" : ""}
      </p>
      {canMove && (
        <form
          className="world-form"
          onSubmit={(event) => {
            event.preventDefault();
            move({
              tokenId: token.id,
              before: position(token),
              after: { column: column - 1, row: row - 1 },
            });
          }}
        >
          <label>
            Column
            <input
              type="number"
              min="1"
              max={map.grid?.columns}
              required
              value={column}
              onChange={(event) => setColumn(Number(event.target.value))}
            />
          </label>
          <label>
            Row
            <input
              type="number"
              min="1"
              max={map.grid?.rows}
              required
              value={row}
              onChange={(event) => setRow(Number(event.target.value))}
            />
          </label>
          <Button type="submit">Move to exact position</Button>
        </form>
      )}
      {dm && map.grid && (
        <CommandForm
          label="Save token controls"
          dirty={canonicalJson(base) !== canonicalJson(draft)}
          submit={() => ({
            kind: "map-token",
            mapId: map.id,
            grid: map.grid!,
            tokenId: token.id,
            before: base,
            token: draft,
          })}
          onDone={() => setBase(draft)}
        >
          <label>
            <input
              type="checkbox"
              checked={draft.locked ?? false}
              onChange={(event) => setDraft({ ...draft, locked: event.target.checked })}
            />
            Lock player movement
          </label>
          <label>
            Visibility
            <select
              value={draft.visibility}
              onChange={(event) =>
                setDraft({ ...draft, visibility: event.target.value as "party" | "dm" })
              }
            >
              <option value="party">Shared</option>
              <option value="dm">DM only</option>
            </select>
          </label>
          <fieldset>
            <legend>Additional controllers</legend>
            {table.purses
              .filter((person) => person.kind === "character")
              .map((person) => (
                <label key={person.id}>
                  <input
                    type="checkbox"
                    checked={draft.controllerPurseIds?.includes(person.id) ?? false}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        controllerPurseIds: event.target.checked
                          ? [...(draft.controllerPurseIds ?? []), person.id]
                          : draft.controllerPurseIds?.filter((id) => id !== person.id),
                      })
                    }
                  />
                  {person.name}
                </label>
              ))}
          </fieldset>
          <label>
            Token color
            <input
              type="color"
              value={draft.style?.color ?? "#d8b76d"}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  style: { size: 1, labels: "always", ...draft.style, color: event.target.value },
                })
              }
            />
          </label>
          <label>
            Token size (cells)
            <input
              type="number"
              min="0.25"
              max="8"
              step="0.25"
              value={draft.style?.size ?? 1}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  style: { labels: "always", ...draft.style, size: Number(event.target.value) },
                })
              }
            />
          </label>
          <label>
            Label
            <select
              value={draft.style?.labels ?? "always"}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  style: {
                    size: 1,
                    ...draft.style,
                    labels: event.target.value as "always" | "selected" | "never",
                  },
                })
              }
            >
              <option value="always">Always</option>
              <option value="selected">When selected</option>
              <option value="never">Hidden</option>
            </select>
          </label>
          {token.kind === "character" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={draft.vision?.enabled ?? true}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      vision: {
                        rangeFeet: 60,
                        darkvisionFeet: 0,
                        ...draft.vision,
                        enabled: event.target.checked,
                      },
                    })
                  }
                />
                Use as a vision source
              </label>
              <label>
                Sight range (feet)
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  value={draft.vision?.rangeFeet ?? 60}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      vision: {
                        enabled: true,
                        darkvisionFeet: 0,
                        ...draft.vision,
                        rangeFeet: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                Darkvision range (feet)
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={draft.vision?.darkvisionFeet ?? 0}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      vision: {
                        enabled: true,
                        rangeFeet: 60,
                        ...draft.vision,
                        darkvisionFeet: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            </>
          )}
          <Button
            onClick={() => {
              setBase(token);
              setDraft(token);
            }}
          >
            Reload current token controls
          </Button>
        </CommandForm>
      )}
    </section>
  );
}

export function SceneConfiguration({ map }: { map: CampaignMap }) {
  const [before, setBefore] = useState(map.tabletop ?? null),
    [draft, setDraft] = useState(readMapTabletop(map));
  return (
    <Fold title="Scene permissions & vision">
      <CommandForm
        label="Save scene settings"
        dirty={
          canonicalJson(readMapTabletop({ tabletop: before ?? undefined })) !== canonicalJson(draft)
        }
        submit={() => ({ kind: "map-tabletop", mapId: map.id, before, settings: draft })}
      >
        <label>
          <input
            type="checkbox"
            checked={draft.playerMovement}
            onChange={(event) => setDraft({ ...draft, playerMovement: event.target.checked })}
          />
          Allow assigned-player token movement
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.playerTemplates}
            onChange={(event) => setDraft({ ...draft, playerTemplates: event.target.checked })}
          />
          Allow player area templates
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.snap}
            onChange={(event) => setDraft({ ...draft, snap: event.target.checked })}
          />
          Snap movement to grid cells
        </label>
        <label>
          Automatic vision
          <select
            value={draft.vision}
            onChange={(event) =>
              setDraft({ ...draft, vision: event.target.value as MapTabletop["vision"] })
            }
          >
            <option value="off">Off · manual exploration</option>
            <option value="party">Shared party vision</option>
            <option value="individual">Individual assigned-character vision</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.ambientLight}
            onChange={(event) => setDraft({ ...draft, ambientLight: event.target.checked })}
          />
          Ambient light
        </label>
        <label>
          Display units
          <input
            value={draft.unitLabel}
            required
            maxLength={20}
            onChange={(event) => setDraft({ ...draft, unitLabel: event.target.value })}
          />
        </label>
        <label>
          Display units per foot
          <input
            type="number"
            min="0.000001"
            step="any"
            required
            value={draft.unitsPerFoot}
            onChange={(event) => setDraft({ ...draft, unitsPerFoot: Number(event.target.value) })}
          />
        </label>
        <Button
          onClick={() => {
            setBefore(map.tabletop ?? null);
            setDraft(readMapTabletop(map));
          }}
        >
          Reload current scene settings
        </Button>
      </CommandForm>
    </Fold>
  );
}
