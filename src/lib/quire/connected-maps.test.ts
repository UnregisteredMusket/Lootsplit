import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable, type CloudSeat } from "./cloud.ts";
import { readJournal, preserveJournalMetadata } from "./journal.ts";
import { campaignMapSchema } from "./world-schema.ts";
import { connectedMapSchema } from "./connected-maps-schema.ts";
import { defaultLocationMap, mapAncestry } from "./connected-maps.ts";
import { applyCommand } from "./commands.ts";
import { projectRecord } from "./session-records.ts";
import { mapTabletopSchema, tabletopSessionSchema } from "./tabletop-schema.ts";
import {
  legacyTabletopMap,
  previousTabletopMap,
  tableForProtocol,
  tabletopResponse,
} from "./tabletop-protocol.ts";
const dm: CloudSeat = { id: "dm", name: "DM", role: "dm", token: "token", purseIds: [] };
const player: CloudSeat = { ...dm, id: "player", name: "Player", role: "player" };
const map = (id: string) =>
  campaignMapSchema.parse({
    id,
    name: id,
    image: "data:image/png;base64,YQ==",
    locationId: "town",
    visible: true,
    type: "city",
    anchors: [],
    markers: [],
  });
const fixture = () => ({
  ...emptyCloudTable(),
  journal: readJournal({
    market: {
      currentLocationId: "town",
      locations: [
        { id: "region", name: "Region", kind: "region", parentId: null, description: "" },
        { id: "town", name: "Town", kind: "town", parentId: "region", description: "" },
      ],
    },
    world: { maps: [map("a"), map("b"), map("c")] },
  }),
});
const config = (extra = {}) => connectedMapSchema.parse(extra);
test("explicit defaults resolve ambiguity without guessing by name or array order", () => {
  const maps = [map("a"), map("b")];
  assert.equal(defaultLocationMap(maps, "town"), undefined);
  maps[1].connected = config({ defaultForLocation: "local" });
  assert.equal(defaultLocationMap(maps, "town")?.id, "b");
  assert.equal(defaultLocationMap([...maps].reverse(), "town")?.id, "b");
});
test("map saves reject cycles, missing destinations, duplicate defaults, stale state and player edits", () => {
  const t = fixture(),
    before = t.journal.world!.maps[0];
  const save = (connected: unknown, seat = dm) =>
    applyCommand(t, seat, {
      id: "save",
      kind: "map-save",
      mapId: "a",
      before,
      map: { ...before, connected: config(connected as object) },
    });
  assert.throws(() => save({ parentMapId: "a" }), /cycle/);
  assert.throws(
    () =>
      save({
        links: [
          {
            id: "door",
            targetMapId: "missing",
            label: "Door",
            x: 0.5,
            y: 0.5,
            visibility: "party",
          },
        ],
      }),
    /destination/,
  );
  t.journal.world!.maps[1].connected = config({ parentMapId: "a" });
  assert.throws(() => save({ parentMapId: "b" }), /cycle/);
  t.journal.world!.maps[1].connected = config({ defaultForLocation: "local" });
  assert.throws(() => save({ defaultForLocation: "local" }), /default map/);
  assert.throws(() => save({}, player), /DM|Dungeon Master/i);
  const next = save({ parentMapId: "b" });
  assert.deepEqual(
    mapAncestry(
      next.journal!.world!.maps,
      next.journal!.world!.maps.find((m) => m.id === "a")!,
    ).map((m) => m.id),
    ["b", "a"],
  );
  assert.throws(
    () =>
      applyCommand(next, dm, {
        id: "stale",
        kind: "map-save",
        mapId: "a",
        before: { ...before, name: "Stale name" },
        map: before,
      }),
    /changed/,
  );
  assert.throws(
    () =>
      applyCommand(next, dm, {
        id: "remove",
        kind: "map-save",
        mapId: "b",
        before: next.journal!.world!.maps.find((m) => m.id === "b")!,
        map: null,
      }),
    /parent map/,
  );
});
test("projection removes private destinations, parents, pins and fog-covered links", () => {
  const t = fixture(),
    [a, b] = t.journal.world!.maps;
  b.visible = false;
  a.connected = config({
    parentMapId: "b",
    links: [
      {
        id: "hidden-target",
        targetMapId: "b",
        label: "Secret target",
        x: 0.2,
        y: 0.2,
        visibility: "party",
      },
      { id: "fog", targetMapId: "c", label: "Concealed door", x: 0.8, y: 0.8, visibility: "party" },
      {
        id: "visible",
        targetMapId: "c",
        label: "Public door",
        x: 0.2,
        y: 0.2,
        visibility: "party",
      },
    ],
    placements: [
      {
        id: "public",
        record: { kind: "location", id: "town" },
        x: 0.2,
        y: 0.2,
        visibility: "party",
      },
      {
        id: "private",
        record: { kind: "location", id: "region" },
        label: "Secret building",
        x: 0.2,
        y: 0.2,
        visibility: "dm",
      },
    ],
  });
  a.tabletop = mapTabletopSchema.parse({
    fog: {
      enabled: true,
      base: "concealed",
      shapes: [
        { id: "reveal", kind: "rectangle", reveal: true, a: { x: 0, y: 0 }, b: { x: 0.4, y: 0.4 } },
      ],
    },
  });
  const projected = projectRecord(t, player),
    nav = projected.journal!.world!.maps.find((m) => m.id === "a")!.connected!;
  assert.equal(nav.parentMapId, undefined);
  assert.deepEqual(
    nav.links.map((l) => l.id),
    ["visible"],
  );
  assert.deepEqual(
    nav.placements.map((p) => p.id),
    ["public"],
  );
  assert.doesNotMatch(JSON.stringify(projected), /Secret target|Concealed door|Secret building/);
  t.journal.world!.tabletop = tabletopSessionSchema.parse({
    activeMapId: "a",
    playerBrowsing: false,
  });
  assert.deepEqual(projectRecord(t, player).journal!.world!.maps[0].connected!.links, []);
});
test("legacy protocol 0/1 maps and journal writes retain connected metadata; unsupported pending actions stay recoverable", () => {
  const t = fixture(),
    a = t.journal.world!.maps[0];
  a.connected = config({ parentMapId: "b" });
  a.tabletop = mapTabletopSchema.parse({});
  for (const version of [0, 1]) {
    const old = version === 0 ? legacyTabletopMap(a) : previousTabletopMap(a);
    const saved = applyCommand(t, dm, {
      id: `legacy-${version}`,
      kind: "map-save",
      mapId: a.id,
      before: old,
      map: { ...old, name: "Renamed" },
    });
    assert.deepEqual(saved.journal!.world!.maps.find((m) => m.id === "a")!.connected, a.connected);
    assert.equal(tableForProtocol(t, version).journal!.world!.maps[0].connected, undefined);
    assert.deepEqual(
      preserveJournalMetadata(tableForProtocol(t, version).journal, t.journal).world!.maps[0]
        .connected,
      a.connected,
    );
    assert.throws(
      () =>
        tabletopResponse(
          { table: t, draft: JSON.stringify([{ kind: "map-save", map: a }]) },
          version,
        ),
      /unfinished map actions/,
    );
  }
  assert.deepEqual(tabletopResponse({ table: t, draft: "[]" }, 2).table, t);
});
