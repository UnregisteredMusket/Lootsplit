import test from "node:test";
import assert from "node:assert/strict";
import { readWorld } from "./world-schema.ts";
import { blankCombatant, blankEncounter } from "../encounters/model.mjs";
import {
  defaultDisplaySettings,
  displayMapSize,
  projectPlayerDisplay,
  playerDisplaySchema,
  openPlayerDisplay,
  type DisplayEncounter,
} from "./player-display.ts";
import type { CloudTable } from "./cloud.ts";

function fixture() {
  const body = {
    ...blankEncounter(),
    name: "PRIVATE TITLE",
    notes: "PRIVATE NOTES",
    activeId: "shown",
    combatants: [
      {
        ...blankCombatant(),
        id: "shown",
        name: "Guard",
        notes: "PRIVATE STATBLOCK",
        conditions: "Poisoned",
        initiative: 14,
      },
      { ...blankCombatant(), id: "hidden", name: "SECRET ENEMY" },
    ],
    loot: [
      {
        id: "loot",
        name: "Prize",
        quantity: 2,
        unitCopper: 999,
        notes: "SECRET ITEM NOTES",
        catalogId: "",
        purseId: "hero",
        sourceTableId: "",
      },
    ],
  };
  const detail: DisplayEncounter = {
    id: "encounter",
    code: "device",
    revision: 1,
    status: "active",
    body,
    award: null,
  };
  const map = {
    id: "map",
    name: "Courtyard",
    visible: true,
    image: "data:image/png;base64,YQ==",
    locationId: null,
    anchors: [],
    grid: {
      columns: 10,
      rows: 10,
      feetPerTile: 5,
      diagonal: "equal",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
    markers: [
      {
        id: "public",
        x: 0.2,
        y: 0.2,
        label: "Door",
        description: "SECRET MARKER NOTES",
        visibility: "party",
      },
      { id: "private", x: 0.3, y: 0.3, label: "SECRET MARKER", description: "", visibility: "dm" },
    ],
    tokens: [
      {
        id: "shown",
        label: "Guard",
        kind: "creature",
        encounterId: "encounter",
        combatantId: "shown",
        column: 1,
        row: 2,
        visibility: "party",
      },
      {
        id: "hidden",
        label: "SECRET TOKEN",
        kind: "creature",
        encounterId: "encounter",
        combatantId: "hidden",
        column: 3,
        row: 4,
        visibility: "party",
      },
      {
        id: "private",
        label: "SECRET DM TOKEN",
        kind: "other",
        column: 4,
        row: 4,
        visibility: "dm",
      },
    ],
  };
  const table = {
    purses: [],
    journal: { world: readWorld({ maps: [map] }) },
  } as unknown as CloudTable;
  const settings = {
    ...defaultDisplaySettings,
    paused: false,
    mapId: "map",
    encounterId: "encounter",
    combatantIds: ["shown"],
  };
  return { table, detail, settings };
}
test("player projection excludes DM/private content and unselected combatants at the transport boundary", () => {
  const { table, detail, settings } = fixture();
  const frame = projectPlayerDisplay(table, detail, settings, "device");
  assert.equal(frame.encounter?.combatants.length, 1);
  assert.equal(frame.encounter?.combatants[0].hp, null);
  assert.equal(frame.encounter?.combatants[0].conditions, "");
  assert.deepEqual(
    frame.map?.tokens.map((t) => t.label),
    ["Guard"],
  );
  assert.deepEqual(
    frame.map?.markers.map((m) => m.label),
    ["Door"],
  );
  assert.equal(frame.loot, null);
  assert.doesNotMatch(
    JSON.stringify(frame),
    /SECRET|PRIVATE|unitCopper|purseId|notes|code|combatantId/,
  );
  assert.equal(playerDisplaySchema.safeParse({ ...frame, body: detail.body }).success, false);
  const revealed = projectPlayerDisplay(
    table,
    detail,
    { ...settings, showHp: true, showConditions: true },
    "device",
  );
  assert.equal(revealed.encounter?.combatants[0].hp, 10);
  assert.equal(revealed.encounter?.combatants[0].conditions, "Poisoned");
});
test("pause, revoked map visibility and campaign mismatch remove content rather than retaining a stale projection", () => {
  const { table, detail, settings } = fixture();
  const paused = projectPlayerDisplay(table, detail, { ...settings, paused: true }, "device");
  assert.equal(paused.map, null);
  assert.equal(paused.encounter, null);
  assert.equal(paused.loot, null);
  table.journal!.world!.maps[0].visible = false;
  const mismatch = projectPlayerDisplay(table, detail, settings, "another-room");
  assert.equal(mismatch.map, null);
  assert.equal(mismatch.encounter, null);
  assert.equal(mismatch.loot, null);
});
test("loot requires explicit reveal and a valid canonical award receipt; display never changes balances or encounter", () => {
  const { table, detail, settings } = fixture();
  const before = JSON.stringify({ table, detail });
  assert.equal(
    projectPlayerDisplay(table, detail, { ...settings, showLoot: true }, "device").loot,
    null,
  );
  assert.equal(JSON.stringify({ table, detail }), before);
  detail.status = "awarded";
  detail.award = { receiptId: "confirmed-receipt", at: Date.now() };
  assert.equal(projectPlayerDisplay(table, detail, settings, "device").loot, null);
  const frame = projectPlayerDisplay(table, detail, { ...settings, showLoot: true }, "device");
  assert.deepEqual(frame.loot?.items, [{ name: "Prize", quantity: 2 }]);
  assert.doesNotMatch(JSON.stringify(frame), /SECRET|PRIVATE|unitCopper|purseId/);
  detail.award = null;
  assert.equal(
    projectPlayerDisplay(table, detail, { ...settings, showLoot: true }, "device").loot,
    null,
  );
});
test("display window strips all copied session credentials and opener; blocked popups remain actionable", () => {
  const previous = globalThis.window;
  let cleared = false;
  let destination = "";
  let opener: unknown = {};
  const child = {
    sessionStorage: {
      clear() {
        cleared = true;
      },
    },
    set opener(v: unknown) {
      opener = v;
    },
    location: {
      replace(s: string) {
        destination = s;
      },
    },
    focus() {},
    close() {},
  };
  Object.assign(globalThis, {
    window: { location: { origin: "https://lootsplit.example" }, open: () => child },
  });
  try {
    openPlayerDisplay("12345678-1234-1234-1234-123456789abc");
    assert.equal(cleared, true);
    assert.equal(opener, null);
    assert.equal(
      destination,
      "https://lootsplit.example/player-display#12345678-1234-1234-1234-123456789abc",
    );
    Object.assign(globalThis, {
      window: { location: { origin: "https://lootsplit.example" }, open: () => null },
    });
    assert.throws(() => openPlayerDisplay("12345678-1234-1234-1234-123456789abc"), /pop-ups/);
  } finally {
    Object.assign(globalThis, { window: previous });
  }
});

test("display follows saved roster order and never marks an unlinked token active", () => {
  const { table, detail, settings } = fixture();
  detail.body.combatants[1].initiative = 30;
  detail.body.combatants[0].initiative = 1;
  table.journal!.world!.maps[0].tokens!.push({
    id: "unlinked",
    label: "Flag",
    kind: "other",
    column: 5,
    row: 5,
    visibility: "party",
  });
  const all = { ...settings, combatantIds: ["shown", "hidden"] };
  const frame = projectPlayerDisplay(table, detail, all, "device");
  assert.deepEqual(
    frame.encounter?.combatants.map((c) => c.name),
    ["Guard", "SECRET ENEMY"],
  );
  const mapOnly = projectPlayerDisplay(table, null, { ...settings, encounterId: "" }, "device");
  assert.equal(mapOnly.map?.tokens.find((t) => t.label === "Flag")?.active, false);
  assert.equal(mapOnly.map?.grid?.columns, 10);
  assert.equal(
    mapOnly.map?.showGrid,
    false,
    "Physical calibration retains grid geometry with lines hidden",
  );
});

test("TV calibration keeps both tile axes square and fits rotated maps inside the viewport", () => {
  const image = { width: 800, height: 600 },
    viewport = { width: 1280, height: 720 };
  const camera = { rotation: 0, zoom: 100, tilePixels: 0 };
  assert.deepEqual(displayMapSize(image, viewport, null, camera), { width: 960, height: 720 });
  assert.deepEqual(displayMapSize(image, viewport, null, { ...camera, rotation: 90 }), {
    width: 720,
    height: 540,
  });
  const grid = {
    columns: 10,
    rows: 8,
    x: 0.1,
    y: 0.1,
    width: 0.5,
    height: 0.8,
    feetPerTile: 5,
    diagonal: "equal" as const,
  };
  const calibrated = displayMapSize(image, viewport, grid, { ...camera, tilePixels: 36 });
  assert.equal((calibrated.width * grid.width) / grid.columns, 36);
  assert.equal((calibrated.height * grid.height) / grid.rows, 36);
});
