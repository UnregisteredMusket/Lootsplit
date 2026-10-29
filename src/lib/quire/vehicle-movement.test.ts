// Map tokens, privacy review 2026-10-29 (finding A3): a ship moved by its controller carries the
// characters aboard, locked ones included (riding a vehicle the party controls is not the character
// moving itself; owner decision kept). The ship's own move is held to the usual player rules: who may
// move it, the combat turn and a visible destination.
import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { canonicalJson } from "./canonical-json.ts";
import { readFinance } from "./finance.ts";
import { defaultShip, type Vessel } from "./ships-schema.ts";
import { shipFingerprint } from "./ships.ts";
import { mapTabletopSchema } from "./tabletop-schema.ts";

const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const captain: CloudSeat = { id: "p2", token: "p2", name: "Captain's player", role: "player", purseIds: ["other"] };
const outsider: CloudSeat = { id: "p3", token: "p3", name: "Sela's player", role: "player", purseIds: ["sela"] };
let sequence = 0;
const run = (t: CloudTable, c: CommandInput | object, seat = dm, execution = {}) =>
  applyCommand(t, seat, { ...(c as CommandInput), id: `vehicle-${++sequence}` } as never, execution);
const grid = { columns: 10, rows: 10, feetPerTile: 5, diagonal: "equal" as const, x: 0, y: 0, width: 1, height: 1 };

function fixture(settings: object = {}) {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "party", name: "Treasury", kind: "party", coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } },
      ...["hero", "other", "sela"].map((id) => ({ id, name: id, kind: "character" as const, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } })),
    ],
    holdings: [{ id: "ship", name: "Dawn Trader", kind: "property", quantity: 1, unitCopper: 10000, purseId: "party", notes: "", locationId: "port", property: { type: "other" } }],
    journal: readJournal({
      finance: readFinance(),
      market: {
        currentLocationId: "port",
        locations: [
          { id: "region", name: "Coast", kind: "region", parentId: null, description: "" },
          { id: "port", name: "Port", kind: "city", parentId: "region", description: "" },
        ],
      },
    }),
  };
  const vessel: Vessel = { ...defaultShip(), propertyId: "ship", mode: "docked", facilityId: null, installed: [], arrearsCopper: 0, expenseRemainder: 0, dmNotes: "" };
  t = run(t, { kind: "ship-configure", before: null, vessel });
  t = run(t, { kind: "ship-board", propertyId: "ship", purseId: "hero", action: "board", before: shipFingerprint(t, "ship") });
  const map = {
    id: "sea", name: "Sea", image: "data:image/png;base64,aA==", locationId: null, visible: true, grid, markers: [], anchors: [],
    tabletop: mapTabletopSchema.parse({ movement: "auto", playerMovement: true, lockedPurseIds: ["hero"], snap: true, ...settings }),
    tokens: [
      { id: "ship-t", kind: "ship" as const, entityId: "ship", label: "Dawn Trader", column: 1, row: 1, visibility: "party" as const, controllerPurseIds: ["other"], encounterId: "fight", combatantId: "ship-c" },
      { id: "hero-t", kind: "character" as const, entityId: "hero", label: "Hero", column: 2, row: 1, visibility: "party" as const },
    ],
  };
  t = run(t, { kind: "map-save", mapId: "sea", before: null, map });
  return t;
}
const tokens = (t: CloudTable) => t.journal!.world!.maps[0].tokens!;
const sail = (t: CloudTable, to: { column: number; row: number }, seat = captain, execution = {}) =>
  run(t, { kind: "map-token-move", mapId: "sea", grid: canonicalJson(grid), moves: [{ tokenId: "ship-t", before: { column: 1, row: 1 }, after: to }], ignoreWalls: false }, seat, execution);
const turn = (activeId: string) => ({ mapCombat: { encounterId: "fight", status: "active", activeId } });
function combat(t: CloudTable) {
  t.journal!.world!.combat = { id: "b", encounterId: "fight", encounterRevision: 1, mapId: "sea", returnMapId: "sea", returnCamera: { x: 0.5, y: 0.5, zoom: 1 }, mode: "theatre", phase: "active", scaleConfirmed: true, showPlayers: true };
  return t;
}

test("a ship carries a locked character aboard; the ship's own move follows the player rules", () => {
  // Outside combat: the controller sails, and the locked hero aboard travels with the ship.
  const sailed = sail(fixture(), { column: 1, row: 5 });
  assert.deepEqual([tokens(sailed)[1].column, tokens(sailed)[1].row], [2, 5]);
  // Someone who doesn't control the ship can't move it.
  assert.throws(() => sail(fixture(), { column: 1, row: 5 }, outsider), /cannot move/);
  // In combat: only on the ship's tracker turn.
  assert.throws(() => sail(combat(fixture()), { column: 1, row: 5 }, captain, turn("ogre")), /Not your turn/);
  assert.equal(tokens(sail(combat(fixture()), { column: 1, row: 5 }, captain, turn("ship-c")))[1].row, 5);
  // A destination the captain can't see is refused.
  const fogged = fixture({ fog: { enabled: true, base: "concealed", shapes: [] } });
  assert.throws(() => sail(fogged, { column: 1, row: 5 }), /visible destination/);
});
