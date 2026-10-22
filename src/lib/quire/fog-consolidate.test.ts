import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { mapGridSchema } from "./world-schema.ts";
import {
  fogStateSchema,
  mapTabletopSchema,
  type FogShape,
  type FogState,
  type ScenePoint,
} from "./tabletop-schema.ts";
import { readMapTabletop, projectTabletopMap } from "./tabletop.ts";
import { manuallyVisible } from "./tabletop-geometry.ts";
import { consolidateFog } from "./fog-consolidate.ts";
import { expandFogHistory } from "./fog-history.ts";
import { tabletopResponse } from "./tabletop-protocol.ts";

const dm: CloudSeat = { id: "dm", token: "dm-token", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = {
  id: "player",
  token: "player-token",
  name: "Player",
  role: "player",
  purseIds: ["hero"],
};
function fixture(fog: FogState): CloudTable {
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
            tabletop: mapTabletopSchema.parse({ fog }),
          },
        ],
      },
    }),
  };
}
const fogOf = (t: CloudTable) => readMapTabletop(t.journal!.world!.maps[0]).fog;
const tabletopOf = (t: CloudTable) => readMapTabletop(t.journal!.world!.maps[0]);
let seq = 0;
const act = (t: CloudTable, c: CommandInput, seat = dm) =>
  applyCommand(t, seat, { ...c, id: `consolidate-${++seq}` });

function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const r4 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4;
const pt = (x: number, y: number): ScenePoint => ({ x: r4(x), y: r4(y) });
let ids = 0;
const rect = (x0: number, y0: number, x1: number, y1: number, reveal = true): FogShape => ({
  id: `r${++ids}`,
  kind: "rectangle",
  reveal,
  a: pt(x0, y0),
  b: pt(x1, y1),
});

/** Independent rasteriser following the canvas renderer: non-zero fill, round brush caps/joins. */
function canvasCovers(p: ScenePoint, shape: FogShape) {
  if (shape.kind === "polygon") {
    let winding = 0;
    const points = shape.points;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
      if (a.y <= p.y) {
        if (b.y > p.y && side > 0) winding++;
      } else if (b.y <= p.y && side < 0) winding--;
    }
    return winding !== 0;
  }
  if (shape.kind === "brush")
    return shape.points.some((a, i) => {
      const b = shape.points[Math.max(0, i - 1)],
        dx = b.x - a.x,
        dy = b.y - a.y,
        l = dx * dx + dy * dy,
        t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < shape.radius;
    });
  const x0 = Math.min(shape.a.x, shape.b.x),
    x1 = Math.max(shape.a.x, shape.b.x),
    y0 = Math.min(shape.a.y, shape.b.y),
    y1 = Math.max(shape.a.y, shape.b.y);
  if (shape.kind === "rectangle") return p.x >= x0 && p.x < x1 && p.y >= y0 && p.y < y1;
  const rx = (x1 - x0) / 2,
    ry = (y1 - y0) / 2;
  return rx > 0 && ry > 0 && ((p.x - x0 - rx) / rx) ** 2 + ((p.y - y0 - ry) / ry) ** 2 < 1;
}
function canvasVisible(p: ScenePoint, fog: FogState) {
  let visible = fog.base === "revealed";
  for (const shape of fog.shapes) if (canvasCovers(p, shape)) visible = shape.reveal;
  return visible;
}
/** Pixel centres and pixel corners (exact edge hits) at several resolutions, both fill rules. */
function assertSameCoverage(
  before: FogState,
  after: FogState,
  label: string,
  resolutions = [17, 64, 199, 400],
) {
  for (const n of resolutions) {
    for (const offset of [0, 0.5]) {
      let differences = 0;
      for (let j = 0; j <= n; j++)
        for (let i = 0; i <= n; i++) {
          const p = { x: Math.min(1, (i + offset) / n), y: Math.min(1, (j + offset) / n) };
          if (manuallyVisible(p, before) !== manuallyVisible(p, after)) differences++;
          else if (offset && canvasVisible(p, before) !== canvasVisible(p, after)) differences++;
        }
      assert.equal(
        differences,
        0,
        `${label}: ${differences} differing samples at ${n}px (+${offset})`,
      );
    }
  }
}
function randomShape(next: () => number, i: number): FogShape {
  const reveal = next() < 0.7,
    kind = Math.floor(next() * 4),
    x = next() * 0.9,
    y = next() * 0.9,
    w = 0.02 + next() * 0.3,
    h = 0.02 + next() * 0.3;
  const id = `s${i}`;
  if (kind === 0) return { id, kind: "rectangle", reveal, a: pt(x, y), b: pt(x + w, y + h) };
  if (kind === 1) return { id, kind: "ellipse", reveal, a: pt(x, y), b: pt(x + w, y + h) };
  if (kind === 2)
    return {
      id,
      kind: "polygon",
      reveal,
      points: [pt(x, y), pt(x + w, y + next() * h), pt(x + next() * w, y + h)],
    };
  const points: ScenePoint[] = [];
  let px = x,
    py = y;
  for (let k = 0; k < 2 + Math.floor(next() * 30); k++) {
    points.push(pt(px, py));
    px += (next() - 0.5) * 0.05;
    py += (next() - 0.5) * 0.05;
  }
  return { id, kind: "brush", reveal, points, radius: 0.005 + next() * 0.04 };
}

test("consolidation keeps coverage identical for random mixed fog (both fill rules)", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const next = random(seed),
      fog: FogState = {
        enabled: true,
        base: seed % 2 ? "concealed" : "revealed",
        shapes: Array.from({ length: 60 }, (_, i) => randomShape(next, i)),
      };
    const result = consolidateFog(fog);
    assert.ok(fogStateSchema.safeParse(result.fog).success);
    assert.ok(result.after <= result.before);
    assertSameCoverage(fog, result.fog, `seed ${seed}`, [17, 64, 160]);
  }
});

test("interleaved reveal and conceal rectangles merge only where the order allows", () => {
  for (const seed of [21, 22, 23, 24]) {
    const next = random(seed),
      shapes: FogShape[] = Array.from({ length: 80 }, () => {
        const x = Math.floor(next() * 10) / 10,
          y = Math.floor(next() * 10) / 10,
          w = (1 + Math.floor(next() * 3)) / 10,
          h = (1 + Math.floor(next() * 3)) / 10;
        return rect(x, y, x + w, y + h, next() < 0.75);
      });
    const fog: FogState = { enabled: true, base: "concealed", shapes };
    const result = consolidateFog(fog);
    assert.ok(result.merged > 0, `seed ${seed} merged nothing`);
    assert.ok(fogStateSchema.safeParse(result.fog).success);
    assertSameCoverage(fog, result.fog, `rect seed ${seed}`, [20, 40, 99, 160]);
  }
});

test("adjacent and overlapping rectangles merge into one outline", () => {
  const shapes: FogShape[] = [];
  for (let i = 0; i < 6; i++) shapes.push(rect(0.1 + i * 0.1, 0.2, 0.2 + i * 0.1, 0.3));
  shapes.push(rect(0.15, 0.25, 0.25, 0.6), rect(0.2, 0.55, 0.65, 0.7));
  const fog: FogState = { enabled: true, base: "concealed", shapes };
  const result = consolidateFog(fog);
  assert.equal(result.before, 8);
  assert.equal(result.after, 1);
  assert.equal(result.fog.shapes[0].kind, "polygon");
  assertSameCoverage(fog, result.fog, "rooms");
  // Consolidating again changes nothing.
  assert.deepEqual(consolidateFog(result.fog).fog, result.fog);
});

test("a ring of rectangles keeps its hole exactly", () => {
  const fog: FogState = {
    enabled: true,
    base: "concealed",
    shapes: [
      rect(0.1, 0.1, 0.9, 0.3),
      rect(0.1, 0.7, 0.9, 0.9),
      rect(0.1, 0.1, 0.3, 0.9),
      rect(0.7, 0.1, 0.9, 0.9),
      rect(0.2, 0.2, 0.25, 0.25),
    ],
  };
  const result = consolidateFog(fog);
  assert.ok(result.after < result.before);
  assertSameCoverage(fog, result.fog, "ring");
});

test("strokes painted over by a later shape or already in their state are removed", () => {
  const next = random(11);
  const strokes: FogShape[] = Array.from({ length: 40 }, (_, i) => ({
    id: `b${i}`,
    kind: "brush",
    reveal: true,
    points: [
      pt(0.3 + next() * 0.3, 0.3 + next() * 0.3),
      pt(0.3 + next() * 0.3, 0.3 + next() * 0.3),
    ],
    radius: 0.02,
  }));
  const fog: FogState = {
    enabled: true,
    base: "concealed",
    shapes: [
      rect(0.5, 0.5, 0.52, 0.52, false), // conceal on an already concealed map
      ...strokes,
      rect(0.2, 0.2, 0.8, 0.8, false),
      { id: "keep", kind: "ellipse", reveal: true, a: pt(0.4, 0.4), b: pt(0.6, 0.6) },
    ],
  };
  const result = consolidateFog(fog);
  assert.equal(result.after, 1, JSON.stringify(result.fog.shapes.map((s) => s.id)));
  assert.equal(result.fog.shapes[0].id, "keep");
  assertSameCoverage(fog, result.fog, "overpaint");
  // A whole-map shape becomes the base state.
  const whole = consolidateFog({
    enabled: true,
    base: "concealed",
    shapes: [...strokes, rect(0, 0, 1, 1, true)],
  });
  assert.equal(whole.after, 0);
  assert.equal(whole.fog.base, "revealed");
});

test("shapes are not moved past opposite shapes they touch", () => {
  const fog: FogState = {
    enabled: true,
    base: "concealed",
    shapes: [
      rect(0.1, 0.1, 0.4, 0.4),
      { id: "c", kind: "ellipse", reveal: false, a: pt(0.2, 0.2), b: pt(0.5, 0.5) },
      rect(0.4, 0.1, 0.7, 0.4),
    ],
  };
  const result = consolidateFog(fog);
  assertSameCoverage(fog, result.fog, "order");
  assert.equal(result.after, 3);
});

test("500 shapes consolidate within a bounded time", () => {
  const next = random(99),
    fog: FogState = {
      enabled: true,
      base: "concealed",
      shapes: Array.from({ length: 500 }, (_, i) => randomShape(next, i)),
    };
  const started = performance.now(),
    result = consolidateFog(fog),
    elapsed = performance.now() - started;
  console.log(
    `consolidate 500 shapes: ${result.before} -> ${result.after} in ${Math.round(elapsed)} ms`,
  );
  assert.ok(elapsed < 8000, `took ${elapsed} ms`);
  assertSameCoverage(fog, result.fog, "500", [31, 96]);
});

test("the fog command consolidates in one undo step and keeps earlier history exactly", () => {
  let t = fixture({ enabled: true, base: "concealed", shapes: [] });
  const states: FogState[] = [structuredClone(fogOf(t))];
  for (let i = 0; i < 25; i++) {
    t = act(t, {
      kind: "map-fog",
      mapId: "map",
      before: fogOf(t),
      action: "shape",
      shape: rect(
        0.05 + (i % 5) * 0.1,
        0.1 + Math.floor(i / 5) * 0.1,
        0.15 + (i % 5) * 0.1,
        0.2 + Math.floor(i / 5) * 0.1,
      ),
    });
    states.push(structuredClone(fogOf(t)));
  }
  const before = tabletopOf(t),
    history = expandFogHistory(before.fog, before.fogUndo);
  const proposal = consolidateFog(before.fog);
  assert.equal(proposal.after, 1);
  // The server must agree with the client's result.
  assert.throws(
    () =>
      act(t, {
        kind: "map-fog",
        mapId: "map",
        before: before.fog,
        action: "consolidate",
        result: { ...proposal.fog, shapes: proposal.fog.shapes.slice(1) },
      }),
    /Exploration changed/,
  );
  assert.throws(
    () => act(t, { kind: "map-fog", mapId: "map", before: before.fog, action: "consolidate" }),
    /Exploration changed/,
  );
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "map-fog",
          mapId: "map",
          before: before.fog,
          action: "consolidate",
          result: proposal.fog,
        },
        player,
      ),
    /DM|unavailable/,
  );
  t = act(t, {
    kind: "map-fog",
    mapId: "map",
    before: before.fog,
    action: "consolidate",
    result: proposal.fog,
  });
  const after = tabletopOf(t);
  assert.deepEqual(after.fog, proposal.fog);
  assert.equal(after.fogUndo.length, 20);
  assert.deepEqual(after.fogRedo, []);
  // Earlier entries are byte-for-byte unchanged; only the oldest was dropped for the new step.
  assert.deepEqual(after.fogUndo.slice(0, 19), before.fogUndo.slice(1));
  const expanded = expandFogHistory(after.fog, after.fogUndo);
  assert.deepEqual(expanded.at(-1), before.fog);
  assert.deepEqual(expanded.slice(0, 19), history.slice(1));
  assert.throws(
    () =>
      act(t, {
        kind: "map-fog",
        mapId: "map",
        before: after.fog,
        action: "consolidate",
        result: after.fog,
      }),
    /already consolidated/,
  );
  // One undo restores every separate shape; the earlier steps then undo as before.
  t = act(t, { kind: "map-fog", mapId: "map", before: fogOf(t), action: "undo" });
  assert.deepEqual(fogOf(t), states[25]);
  t = act(t, { kind: "map-fog", mapId: "map", before: fogOf(t), action: "undo" });
  assert.deepEqual(fogOf(t), states[24]);
  t = act(t, { kind: "map-fog", mapId: "map", before: fogOf(t), action: "redo" });
  t = act(t, { kind: "map-fog", mapId: "map", before: fogOf(t), action: "redo" });
  assert.deepEqual(fogOf(t), proposal.fog);
  assert.throws(
    () =>
      act(t, { kind: "map-fog", mapId: "map", before: fogOf(t), action: "undo", result: fogOf(t) }),
    /resulting fog/,
  );
});

test("players still receive no fog geometry after consolidation", () => {
  let t = fixture({
    enabled: true,
    base: "concealed",
    shapes: [rect(0.1, 0.1, 0.3, 0.3), rect(0.3, 0.1, 0.5, 0.3)],
  });
  const projectedBefore = projectTabletopMap(t, t.journal!.world!.maps[0], player);
  const proposal = consolidateFog(fogOf(t));
  t = act(t, {
    kind: "map-fog",
    mapId: "map",
    before: fogOf(t),
    action: "consolidate",
    result: proposal.fog,
  });
  const projected = projectTabletopMap(t, t.journal!.world!.maps[0], player);
  assert.deepEqual(projected.tabletop!.fog, { enabled: true, base: "concealed", shapes: [] });
  assert.deepEqual(projected.tabletop!.fogUndo, []);
  assert.deepEqual(projected.tabletop!.fogRedo, []);
  assert.equal(projected.image, projectedBefore.image);
  assert.ok(!JSON.stringify(projected).includes("fog-merged"));
});

test("older apps are not handed a pending consolidation", () => {
  const t = fixture({ enabled: true, base: "concealed", shapes: [] });
  const draft = JSON.stringify([
    {
      id: "x",
      kind: "map-fog",
      mapId: "map",
      before: fogOf(t),
      action: "consolidate",
      result: fogOf(t),
    },
  ]);
  assert.throws(() => tabletopResponse({ table: t, draft }, 2), /updated Lootsplitter client/);
  assert.doesNotThrow(() => tabletopResponse({ table: t, draft }, 3));
});
