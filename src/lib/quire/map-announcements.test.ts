import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { mapGridSchema } from "./world-schema.ts";
import { mapTabletopSchema } from "./tabletop-schema.ts";
import { projectTabletopMap } from "./tabletop.ts";
import { pingColors } from "./map-signals.ts";
import {
  mapAnnouncements,
  mapSnapshot,
  pingAnnouncement,
  pingShapes,
  visibleLabels,
} from "./map-announcements.ts";

const player: CloudSeat = { id: "p", token: "p", name: "P", role: "player", purseIds: ["hero"] };
function table(
  tokens: { id: string; label: string; column: number; row: number; visibility: "party" | "dm" }[],
): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      {
        id: "hero",
        kind: "character" as const,
        name: "Hero",
        coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    ],
    journal: readJournal({
      world: {
        maps: [
          {
            id: "map",
            name: "Keep",
            image: "data:image/png;base64,cHJpdmF0ZS1zb3VyY2U=",
            locationId: null,
            visible: true,
            anchors: [],
            markers: [
              { id: "m1", label: "Well", description: "", x: 0.5, y: 0.5, visibility: "party" },
              {
                id: "m2",
                label: "Secret vault",
                description: "",
                x: 0.52,
                y: 0.52,
                visibility: "dm",
              },
            ],
            grid: mapGridSchema.parse({ columns: 10, rows: 10 }),
            tokens: tokens.map((t) => ({ ...t, kind: "other" as const })),
            tabletop: mapTabletopSchema.parse({}),
          },
        ],
      },
    }),
  };
}

test("every ping colour has its own shape", () => {
  assert.deepEqual(Object.keys(pingShapes).sort(), [...pingColors].sort());
  assert.equal(new Set(Object.values(pingShapes)).size, pingColors.length);
});

test("token moves, activation and the awaiting state are announced from projected data", () => {
  const before = table([
    { id: "a", label: "Goblin", column: 1, row: 1, visibility: "party" },
    { id: "h", label: "Hidden ogre", column: 5, row: 5, visibility: "dm" },
  ]);
  const after = table([
    { id: "a", label: "Goblin", column: 2, row: 3, visibility: "party" },
    { id: "h", label: "Hidden ogre", column: 6, row: 6, visibility: "dm" },
  ]);
  const view = (t: CloudTable) => projectTabletopMap(t, t.journal!.world!.maps[0], player);
  const previous = mapSnapshot(view(before), { id: null });
  const next = mapSnapshot(view(after), { id: "map", name: "Keep" });
  const messages = mapAnnouncements(previous, next);
  assert.deepEqual(messages, [
    "The DM activated Keep for players.",
    "Goblin moved to column 3, row 4.",
  ]);
  assert.ok(!messages.join(" ").includes("ogre"), "hidden tokens are never announced");
  assert.deepEqual(mapAnnouncements(undefined, next), []);
  assert.deepEqual(mapAnnouncements({ ...next, awaiting: false }, { ...next, awaiting: true }), [
    "Waiting for the DM's device to update the map…",
  ]);
  assert.deepEqual(mapAnnouncements({ ...next, awaiting: true }, next), ["The map view updated."]);
  const many = {
    ...next,
    tokens: Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      label: `T${i}`,
      column: 0,
      row: 0,
    })),
  };
  assert.equal(
    mapAnnouncements(many, { ...many, tokens: many.tokens.map((t) => ({ ...t, row: 1 })) }).at(-1),
    "2 more tokens moved.",
  );
});

test("pings name the nearest visible label and never DM-only ones", () => {
  const t = table([{ id: "a", label: "Goblin", column: 0, row: 0, visibility: "party" }]);
  const projected = projectTabletopMap(t, t.journal!.world!.maps[0], player);
  const labels = visibleLabels(projected);
  assert.ok(!labels.some((l) => l.label === "Secret vault"));
  assert.equal(
    pingAnnouncement({ x: 0.52, y: 0.52, color: "red" }, labels),
    "Red circle ping at Well.",
  );
  assert.equal(
    pingAnnouncement({ x: 0.5, y: 0.2, color: "green" }, labels),
    "Green triangle ping north of Well.",
  );
  assert.equal(
    pingAnnouncement({ x: 0.5, y: 0.5, color: "blue" }, []),
    "Blue diamond ping on the map.",
  );
});
