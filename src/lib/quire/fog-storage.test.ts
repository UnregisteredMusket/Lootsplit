import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { mapGridSchema } from "./world-schema.ts";
import {
  mapTabletopSchema,
  type FogShape,
  type FogState,
  type MapTabletop,
  type ScenePoint,
} from "./tabletop-schema.ts";
import { readMapTabletop, projectTabletopMap } from "./tabletop.ts";
import { inFogShape } from "./tabletop-geometry.ts";
import { projectRecord } from "./session-records.ts";
import {
  expandFogHistory,
  expandTabletopHistory,
  fogStorageBytes,
  isFogDiff,
} from "./fog-history.ts";
import {
  FOG_SEGMENT_POINTS,
  compactStroke,
  extendStroke,
  finishStroke,
  splitStroke,
  strokeTolerance,
  type StrokeDraft,
} from "./fog-stroke.ts";
import { tableForProtocol, tabletopResponse } from "./tabletop-protocol.ts";
import { ROOM_BODY_LIMIT } from "../../../cloudflare/room-images.mjs";

const dm: CloudSeat = { id: "dm", token: "dm-token", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = {
  id: "player",
  token: "player-token",
  name: "Player",
  role: "player",
  purseIds: ["hero"],
};
function fixture(settings?: unknown): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      {
        id: "hero",
        kind: "character" as const,
        name: "Hero",
        coins: { cp: 100, sp: 0, ep: 0, gp: 0, pp: 0 },
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
            markers: [],
            grid: mapGridSchema.parse({ columns: 10, rows: 10 }),
            tokens: [
              {
                id: "hero-token",
                kind: "character",
                entityId: "hero",
                label: "Hero",
                column: 1,
                row: 1,
                visibility: "party",
              },
            ],
            ...(settings ? { tabletop: mapTabletopSchema.parse(settings) } : {}),
          },
        ],
      },
    }),
  };
}
const map = (t: CloudTable) => t.journal!.world!.maps[0];
const fog = (t: CloudTable) => readMapTabletop(map(t)).fog;
let seq = 0;
const act = (t: CloudTable, c: CommandInput, seat = dm) =>
  applyCommand(t, seat, { ...c, id: `fog-${++seq}` });

/** Deterministic pseudo-random numbers. */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
/** Raw pointer samples of a freehand stroke: a wandering path with hand tremor. */
function rawStroke(next: () => number, samples: number): ScenePoint[] {
  let x = 0.1 + next() * 0.8,
    y = 0.1 + next() * 0.8,
    heading = next() * Math.PI * 2;
  const points: ScenePoint[] = [];
  for (let i = 0; i < samples; i++) {
    heading += (next() - 0.5) * 0.25;
    x = Math.min(0.999, Math.max(0.001, x + Math.cos(heading) * 0.0025 + (next() - 0.5) * 0.0004));
    y = Math.min(0.999, Math.max(0.001, y + Math.sin(heading) * 0.0025 + (next() - 0.5) * 0.0004));
    points.push({ x, y });
  }
  return points;
}
function draw(points: ScenePoint[], radius: number) {
  let stroke: StrokeDraft = { points: [points[0]], frozen: 0 };
  for (const point of points.slice(1)) {
    const next = extendStroke(stroke, point, radius);
    if (!next.full) stroke = next;
  }
  return finishStroke(stroke, radius);
}
type BrushShape = Extract<FogShape, { kind: "brush" }>;
const brush = (id: string, points: ScenePoint[], radius: number, reveal = true): BrushShape => ({
  id,
  kind: "brush",
  reveal,
  points,
  radius,
});

/** The pre-protocol-3 engine: full snapshots, 20 deep, used as the equivalence reference. */
function legacyFog(
  state: { fog: FogState; undo: FogState[]; redo: FogState[] },
  action: string,
  shapes: FogShape[] = [],
) {
  const prior = structuredClone(state.fog);
  if (action === "undo" || action === "redo") {
    const source = action === "undo" ? state.undo : state.redo;
    const target = action === "undo" ? state.redo : state.undo;
    const next = source.pop();
    if (!next) return false;
    target.push(prior);
    if (target.length > 20) target.shift();
    state.fog = next;
    return true;
  }
  state.undo = [...state.undo.slice(-19), prior];
  state.redo = [];
  if (action === "shape") {
    state.fog.enabled = true;
    state.fog.shapes.push(...structuredClone(shapes));
  } else if (action === "reveal-all" || action === "conceal-all")
    state.fog = {
      enabled: true,
      base: action === "reveal-all" ? "revealed" : "concealed",
      shapes: [],
    };
  else state.fog.enabled = action === "enable";
  return true;
}

const roomBytes = (t: CloudTable) => new TextEncoder().encode(JSON.stringify({ table: t })).length;

test("100 freehand strokes stay well under the room guard (before/after sizes)", () => {
  const next = random(7),
    radius = 0.02;
  let t = fixture({ fog: { enabled: true, base: "concealed", shapes: [] } });
  const legacy = { fog: structuredClone(fog(t)), undo: [] as FogState[], redo: [] as FogState[] };
  let segments = 0;
  for (let i = 0; i < 100; i++) {
    const raw = rawStroke(next, 400);
    // Before: the first 200 unrounded samples, the rest dropped; every action snapshotted.
    legacyFog(legacy, "shape", [brush(`old-${i}`, raw.slice(0, 200), radius)]);
    const [shape, ...continued] = draw(raw, radius).map((points, n) =>
      brush(`s-${i}-${n}`, points, radius),
    );
    segments += 1 + continued.length;
    t = act(t, {
      kind: "map-fog",
      mapId: "map",
      before: fog(t),
      action: "shape",
      shape,
      ...(continued.length ? { continued } : {}),
    });
  }
  const legacyTable = fixture({ fog: legacy.fog, fogUndo: legacy.undo, fogRedo: legacy.redo });
  const before = roomBytes(legacyTable),
    after = roomBytes(t);
  console.log(
    `fog storage, 100 strokes: before ${before} bytes (fog+history ${fogStorageBytes(readMapTabletop(map(legacyTable)))}), after ${after} bytes (fog+history ${fogStorageBytes(readMapTabletop(map(t)))}), ${segments} shapes; guard ${ROOM_BODY_LIMIT}`,
  );
  assert.ok(before > ROOM_BODY_LIMIT, "the old format exceeds the guard (the reproduced bug)");
  assert.ok(after < ROOM_BODY_LIMIT / 4, `100 strokes use ${after} bytes`);
  assert.equal(readMapTabletop(map(t)).fogUndo.length, 20);
  assert.ok(readMapTabletop(map(t)).fogUndo.every(isFogDiff));
});

test("long strokes continue across shapes instead of stopping at 200 points", () => {
  const points = rawStroke(random(3), 900).map((p, i) => ({ x: p.x, y: (p.y + i * 0.00001) % 1 }));
  const segments = splitStroke(points);
  assert.ok(segments.length > 1);
  assert.ok(segments.every((s) => s.length <= FOG_SEGMENT_POINTS));
  // Consecutive segments share their junction point; together they hold every point in order.
  for (let i = 1; i < segments.length; i++)
    assert.deepEqual(segments[i][0], segments[i - 1][segments[i - 1].length - 1]);
  assert.deepEqual(
    segments.flatMap((s, i) => (i ? s.slice(1) : s)),
    points,
  );
  const radius = 0.01,
    whole = brush("whole", points, radius),
    parts = segments.map((s, i) => brush("part-" + i, s, radius));
  for (let x = 0; x <= 1; x += 0.01)
    for (let y = 0; y <= 1; y += 0.01) {
      const p = { x, y };
      assert.equal(
        parts.some((shape) => inFogShape(p, shape)),
        inFogShape(p, whole),
        `coverage differs at ${x},${y}`,
      );
    }
  // The drawn stroke reaches its end instead of being truncated after 200 samples.
  const drawn = draw(points, radius);
  assert.deepEqual(drawn.at(-1)!.at(-1), {
    x: Math.round(points.at(-1)!.x * 1e4) / 1e4,
    y: Math.round(points.at(-1)!.y * 1e4) / 1e4,
  });
});

test("simplified strokes stay within the tolerance of every original sample", () => {
  const radius = 0.03,
    raw = rawStroke(random(11), 1500),
    drawn = draw(raw, radius).map((points, i) => brush("d" + i, points, radius));
  const tolerance = strokeTolerance(radius) + 1e-4;
  for (const p of raw) {
    // Every sample's own disc, shrunk by the tolerance, is still painted.
    assert.ok(drawn.some((shape) => inFogShape(p, { ...shape, radius: radius + tolerance })));
    assert.ok(drawn.some((shape) => inFogShape(p, shape)));
  }
  assert.ok(compactStroke(raw, radius).length < raw.length / 3);
});

test("diff undo/redo reproduces the full-snapshot behaviour exactly", () => {
  const next = random(42);
  let t = fixture({ fog: { enabled: false, base: "concealed", shapes: [] } });
  const legacy = { fog: structuredClone(fog(t)), undo: [] as FogState[], redo: [] as FogState[] };
  const actions = [
    "shape",
    "shape",
    "shape",
    "undo",
    "redo",
    "undo",
    "undo",
    "reveal-all",
    "conceal-all",
    "enable",
    "disable",
  ];
  for (let step = 0; step < 400; step++) {
    const action = actions[Math.floor(next() * actions.length)];
    const shapes =
      action === "shape"
        ? Array.from({ length: 1 + Math.floor(next() * 3) }, (_, n) =>
            next() < 0.5
              ? brush(
                  `b${step}-${n}`,
                  [
                    { x: next(), y: next() },
                    { x: next(), y: next() },
                  ],
                  0.02,
                  next() < 0.7,
                )
              : ({
                  id: `r${step}-${n}`,
                  kind: "rectangle",
                  reveal: next() < 0.7,
                  a: { x: next(), y: next() },
                  b: { x: next(), y: next() },
                } as FogShape),
          )
        : [];
    const ok = legacyFog(legacy, action, shapes);
    const command = {
      kind: "map-fog",
      mapId: "map",
      before: fog(t),
      action,
      ...(shapes.length ? { shape: shapes[0] } : {}),
      ...(shapes.length > 1 ? { continued: shapes.slice(1) } : {}),
    } as CommandInput;
    if (!ok) {
      assert.throws(() => act(t, command), /no exploration change/);
      continue;
    }
    t = act(t, command);
    const settings = readMapTabletop(map(t));
    assert.deepEqual(settings.fog, legacy.fog, `fog differs after step ${step} (${action})`);
    assert.equal(settings.fogUndo.length, legacy.undo.length);
    assert.equal(settings.fogRedo.length, legacy.redo.length);
    assert.deepEqual(expandFogHistory(settings.fog, settings.fogUndo), legacy.undo);
    assert.deepEqual(expandFogHistory(settings.fog, settings.fogRedo), legacy.redo);
  }
});

test("a legacy room with full-snapshot undo loads, undoes and converts without losing fog", () => {
  const shape = (n: number): FogShape => ({
    id: "s" + n,
    kind: "rectangle",
    reveal: true,
    a: { x: n / 30, y: 0 },
    b: { x: n / 30 + 0.02, y: 0.5 },
  });
  const states: FogState[] = Array.from({ length: 21 }, (_, n) => ({
    enabled: true,
    base: "concealed",
    shapes: Array.from({ length: n }, (_, i) => shape(i)),
  }));
  const current = states[20],
    undo = states.slice(0, 20),
    redo = [{ enabled: true, base: "revealed", shapes: [] } as FogState];
  let t = fixture({ fog: current, fogUndo: undo, fogRedo: redo });
  assert.deepEqual(fog(t), current);
  // Undo restores the stored snapshot exactly.
  t = act(t, { kind: "map-fog", mapId: "map", before: fog(t), action: "undo" });
  assert.deepEqual(fog(t), states[19]);
  let settings = readMapTabletop(map(t));
  assert.ok([...settings.fogUndo, ...settings.fogRedo].every(isFogDiff), "converted on write");
  assert.deepEqual(expandFogHistory(settings.fog, settings.fogUndo), states.slice(0, 19));
  assert.deepEqual(expandFogHistory(settings.fog, settings.fogRedo), [redo[0], current]);
  // Every remaining step undoes to the same snapshot the old room held.
  for (let n = 18; n >= 0; n--) {
    t = act(t, { kind: "map-fog", mapId: "map", before: fog(t), action: "undo" });
    assert.deepEqual(fog(t), states[n]);
  }
  for (let n = 1; n <= 20; n++) {
    t = act(t, { kind: "map-fog", mapId: "map", before: fog(t), action: "redo" });
    assert.deepEqual(fog(t), states[n]);
  }
  // As before, the redo stack holds 20 steps, so the oldest redo fell off during the undos.
  assert.throws(
    () => act(t, { kind: "map-fog", mapId: "map", before: fog(t), action: "redo" }),
    /no exploration change/,
  );
  settings = readMapTabletop(map(t));
  assert.ok(
    fogStorageBytes(settings) <
      fogStorageBytes(mapTabletopSchema.parse({ fog: current, fogUndo: undo })),
  );
});

test("unreadable diff history is kept as it is and the current fog is never dropped", () => {
  const current: FogState = { enabled: true, base: "concealed", shapes: [] };
  const broken = {
    kind: "fog-diff" as const,
    keep: 5,
    add: [],
    enabled: true,
    base: "concealed" as const,
  };
  let t = fixture({ fog: current, fogUndo: [broken] });
  t = act(t, { kind: "map-fog", mapId: "map", before: fog(t), action: "enable" });
  assert.deepEqual(fog(t), current);
  assert.deepEqual(readMapTabletop(map(t)).fogUndo[0], broken);
});

test("player projection still hides fog geometry and history, with diffs or snapshots", () => {
  const secret = (id: string): FogShape => ({
    id,
    kind: "rectangle",
    reveal: true,
    a: { x: 0, y: 0 },
    b: { x: 0.3, y: 0.3 },
  });
  let t = fixture({ fog: { enabled: true, base: "concealed", shapes: [] } });
  t = act(t, {
    kind: "map-fog",
    mapId: "map",
    before: fog(t),
    action: "shape",
    shape: secret("secret-a"),
  });
  t = act(t, {
    kind: "map-fog",
    mapId: "map",
    before: fog(t),
    action: "shape",
    shape: secret("secret-b"),
    continued: [secret("secret-c")],
  });
  t = act(t, { kind: "map-fog", mapId: "map", before: fog(t), action: "undo" });
  const settings = readMapTabletop(map(t));
  assert.ok(settings.fogUndo.some(isFogDiff) && settings.fogRedo.some(isFogDiff));
  const snapshots = structuredClone(t);
  snapshots.journal!.world!.maps[0].tabletop = expandTabletopHistory(settings) as MapTabletop;
  for (const table of [t, snapshots]) {
    const text = JSON.stringify(projectRecord(table, player));
    for (const hidden of ["secret-a", "secret-b", "secret-c", "fog-diff", "cHJpdmF0ZS1zb3VyY2U"])
      assert.ok(!text.includes(hidden), hidden + " reached a player");
    const projected = readMapTabletop(projectTabletopMap(table, map(table), player));
    assert.deepEqual(projected.fogUndo, []);
    assert.deepEqual(projected.fogRedo, []);
    assert.deepEqual(projected.fog, { enabled: true, base: "concealed", shapes: [] });
  }
  assert.deepEqual(
    projectTabletopMap(t, map(t), player),
    projectTabletopMap(snapshots, map(snapshots), player),
  );
});

test("tabletop protocol 2 apps receive full snapshots and their writes still apply", () => {
  let t = fixture({ fog: { enabled: true, base: "concealed", shapes: [] } });
  const legacy = { fog: structuredClone(fog(t)), undo: [] as FogState[], redo: [] as FogState[] };
  for (let i = 0; i < 4; i++) {
    const shape = brush("p" + i, [{ x: i / 10, y: 0.5 }], 0.05);
    legacyFog(legacy, "shape", [shape]);
    t = act(t, { kind: "map-fog", mapId: "map", before: fog(t), action: "shape", shape });
  }
  legacyFog(legacy, "undo");
  t = act(t, { kind: "map-fog", mapId: "map", before: fog(t), action: "undo" });
  const old = tableForProtocol(t, 2);
  const oldSettings = mapTabletopSchema.parse(old.journal!.world!.maps[0].tabletop);
  assert.deepEqual(oldSettings.fogUndo, legacy.undo);
  assert.deepEqual(oldSettings.fogRedo, legacy.redo);
  assert.ok(!JSON.stringify(old).includes("fog-diff"));
  assert.ok(JSON.stringify(t).includes("fog-diff"), "the stored room is not changed by projection");
  assert.equal(tableForProtocol(t, 3), t);
  // Report snapshots are converted too.
  const withReport = structuredClone(t);
  withReport.journal!.reports = [
    {
      ...(withReport.journal!.reports?.[0] ?? {}),
      id: "r",
      at: 1,
      snapshot: JSON.stringify(t),
    } as never,
  ];
  assert.ok(!JSON.stringify(tableForProtocol(withReport, 2)).includes("fog-diff"));
  // An older DM app's whole-tabletop save (expanded before/settings) is accepted and re-compacted.
  const oldMap = old.journal!.world!.maps[0];
  t = act(t, {
    kind: "map-tabletop",
    mapId: "map",
    before: oldMap.tabletop!,
    settings: { ...oldMap.tabletop!, playerMovement: true },
  } as CommandInput);
  let settings = readMapTabletop(map(t));
  assert.equal(settings.playerMovement, true);
  assert.ok([...settings.fogUndo, ...settings.fogRedo].every(isFogDiff));
  assert.deepEqual(expandFogHistory(settings.fog, settings.fogUndo), legacy.undo);
  const oldSave = tableForProtocol(t, 2).journal!.world!.maps[0];
  t = act(t, {
    kind: "map-save",
    mapId: "map",
    before: oldSave,
    map: { ...oldSave, name: "Keep (renamed)" },
  } as CommandInput);
  settings = readMapTabletop(map(t));
  assert.equal(map(t).name, "Keep (renamed)");
  assert.deepEqual(expandFogHistory(settings.fog, settings.fogRedo), legacy.redo);
  legacyFog(legacy, "redo");
  t = act(t, { kind: "map-fog", mapId: "map", before: fog(t), action: "redo" });
  assert.deepEqual(fog(t), legacy.fog);
  // Pending protocol-3 fog forms are not handed to an older app.
  assert.throws(
    () =>
      tabletopResponse(
        {
          table: t,
          draft: JSON.stringify([
            { kind: "map-fog", continued: [brush("x", [{ x: 0, y: 0 }], 0.1)] },
          ]),
        },
        2,
      ),
    /unfinished map actions/,
  );
  assert.doesNotThrow(() => tabletopResponse({ table: t, draft: "[]" }, 2));
});

test("a new whole-tabletop save keeps diff history aligned when the fog itself changes", () => {
  let t = fixture({ fog: { enabled: true, base: "concealed", shapes: [] } });
  const shape = brush("a", [{ x: 0.5, y: 0.5 }], 0.05);
  t = act(t, { kind: "map-fog", mapId: "map", before: fog(t), action: "shape", shape });
  const before = map(t).tabletop!;
  // A DM draft that also changes fog (as a full-tabletop save may): undo returns to the snapshot.
  t = act(t, {
    kind: "map-tabletop",
    mapId: "map",
    before,
    settings: { ...before, fog: { enabled: true, base: "revealed", shapes: [] } },
  } as CommandInput);
  t = act(t, { kind: "map-fog", mapId: "map", before: fog(t), action: "undo" });
  assert.deepEqual(fog(t), { enabled: true, base: "concealed", shapes: [] });
});
