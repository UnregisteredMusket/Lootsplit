import test from "node:test";
import assert from "node:assert/strict";
import {
  deciMiles,
  downtimeDays,
  formatTileList,
  frameFingerprint,
  journeyDurationMinutes,
  legDayRange,
  legDeciMiles,
  legIndexAt,
  parseTileList,
  routeFrame,
  routePointAt,
  scaleDistance,
  scaleWidthPercent,
  snapRoutePoint,
  toMiles,
} from "./journey.ts";
import { routeDistance, routeLegs, routePosition, tileAt, tilePoint, tileDistance } from "./map-tiles.ts";
import { mapGridSchema, mapScaleSchema, campaignMapSchema } from "./world-schema.ts";

const close = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≈ ${b}`);

test("scale-bar distance uses the image's true proportions (non-square aspect)", () => {
  // A 2:1 image: half the width is as long as the full height.
  const wide = mapScaleSchema.parse({
    a: { x: 0, y: 0 },
    b: { x: 0.5, y: 0 },
    distance: 20,
    unit: "mi",
    aspect: 2,
  });
  close(scaleDistance(wide, { x: 0, y: 0 }, { x: 0, y: 1 }), 20);
  close(scaleDistance(wide, { x: 0, y: 0 }, { x: 1, y: 0 }), 40);
  // A tall 1:2 image calibrated vertically: the full width is a quarter of the height span.
  const tall = mapScaleSchema.parse({
    a: { x: 0.2, y: 0.1 },
    b: { x: 0.2, y: 0.9 },
    distance: 16,
    unit: "km",
    aspect: 0.5,
  });
  close(scaleDistance(tall, { x: 0, y: 0 }, { x: 1, y: 0 }), 10);
  close(toMiles(16.09344, "km"), 10);
  close(toMiles(5280, "ft"), 1);
  // "Harrowgate to Saltmere = 27 mi, so 1 mile is about 0.84% of the map's width."
  const vale = mapScaleSchema.parse({
    a: { x: 0.2, y: 0.5 },
    b: { x: 0.4268, y: 0.5 },
    distance: 27,
    unit: "mi",
    aspect: 1.5,
  });
  close(scaleWidthPercent(vale), 0.84, 0.001);
  assert.throws(
    () => mapScaleSchema.parse({ ...vale, b: vale.a }),
    /Drag the scale handles apart/,
  );
});

test("leg deci-miles on a scale bar and the integer duration (61.1 mi at 24 mi/day = 3,666 min)", () => {
  const scale = mapScaleSchema.parse({
    a: { x: 0, y: 0 },
    b: { x: 1, y: 0 },
    distance: 100,
    unit: "mi",
    aspect: 1,
  });
  const frame = { kind: "scale" as const, scale };
  const points = [
    { x: 0, y: 0 },
    { x: 0.168, y: 0 },
    { x: 0.318, y: 0 },
    { x: 0.462, y: 0 },
    { x: 0.611, y: 0 },
  ];
  const legs = legDeciMiles(frame, points);
  assert.deepEqual(legs, [168, 150, 144, 149]);
  const total = legs.reduce((s, l) => s + l, 0);
  assert.equal(total, 611);
  assert.equal(journeyDurationMinutes(total, 24), 3666);
  assert.equal(downtimeDays(3666), 3);
  assert.equal(downtimeDays(1440), 1);
  assert.equal(downtimeDays(1), 1);
  // Forced march: two extra hours add a quarter of a day's miles.
  assert.equal(journeyDurationMinutes(240, 24, 2), Math.ceil((240 * 144 * 8) / (24 * 10)));
  assert.throws(() => journeyDurationMinutes(10, 0), /Pace/);
  assert.throws(() => journeyDurationMinutes(10, 24, 9), /Forced march/);
  assert.equal(deciMiles(1.05), 11);
  // Leg list day ranges from the mockup.
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => legDayRange(legs, i, 24)),
    [
      { startDay: 1, endDay: 1 },
      { startDay: 1, endDay: 2 },
      { startDay: 2, endDay: 2 },
      { startDay: 2, endDay: 3 },
    ],
  );
});

test("grid legs match the voyage formula (feet ÷ 5,280) and carry the alternating diagonal", () => {
  const grid = mapGridSchema.parse({ columns: 40, rows: 25, feetPerTile: 15840 }); // 3 mi tiles
  const tiles = [
    { column: 27, row: 15 },
    { column: 22, row: 13 },
    { column: 21, row: 8 },
    { column: 27, row: 4 },
  ];
  const points = tiles.map((t) => tilePoint(grid, t));
  const legs = legDeciMiles({ kind: "grid", grid }, points);
  assert.deepEqual(legs, [150, 150, 180]);
  assert.equal(
    legs.reduce((s, l) => s + l, 0) / 10,
    routeDistance(grid, tiles) / 5280,
    "the same miles as a mapped voyage",
  );
  // Voyage: ceil(feet / (mpd × 5280) × 1440) at 48 mi/day; the journey formula agrees.
  const voyage = Math.ceil((routeDistance(grid, tiles) / (48 * 5280)) * 1440);
  assert.equal(journeyDurationMinutes(480, 48), voyage);
  assert.equal(voyage, 1440);
  // Alternating 5/10/5: the diagonal count carries from leg to leg.
  const alternating = { ...grid, diagonal: "alternating" as const };
  const diagonal = [
    { column: 0, row: 0 },
    { column: 1, row: 1 },
    { column: 2, row: 2 },
    { column: 3, row: 3 },
  ];
  const altLegs = legDeciMiles(
    { kind: "grid", grid: alternating },
    diagonal.map((t) => tilePoint(alternating, t)),
  );
  assert.deepEqual(altLegs, [30, 60, 30]);
  assert.deepEqual(
    routeLegs(alternating, diagonal).map((f) => f / 528),
    altLegs,
    "same as the voyage leg rule",
  );
  assert.throws(
    () => legDeciMiles({ kind: "grid", grid: { ...grid, width: 0.5 } }, [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }]),
    /inside the map's grid/,
  );
});

test("unchanged tileDistance/routeDistance for equal, euclidean and orthogonal grids", () => {
  for (const [diagonal, expected] of [
    ["equal", 20],
    ["euclidean", 5 * Math.hypot(4, 3)],
    ["orthogonal", 35],
  ] as const) {
    const grid = mapGridSchema.parse({ columns: 10, rows: 10, diagonal });
    close(tileDistance(grid, { column: 0, row: 0 }, { column: 4, row: 3 }), expected);
    close(routeDistance(grid, [{ column: 0, row: 0 }, { column: 4, row: 3 }]), expected);
  }
});

test("normalized route position at 0, at leg boundaries and at 1", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 0.5, y: 0.5 },
  ];
  const legs = [100, 100];
  assert.deepEqual(routePointAt(points, legs, 0), { x: 0, y: 0 });
  assert.deepEqual(routePointAt(points, legs, 0.5), { x: 0.5, y: 0 });
  assert.deepEqual(routePointAt(points, legs, 0.75), { x: 0.5, y: 0.25 });
  assert.deepEqual(routePointAt(points, legs, 1), { x: 0.5, y: 0.5 });
  assert.deepEqual(routePointAt(points, legs, 2), { x: 0.5, y: 0.5 }, "clamped");
  assert.deepEqual(routePointAt(points, [0, 100], 0), { x: 0.5, y: 0 }, "skips a zero-length leg");
  assert.deepEqual(routePointAt(points, [0, 0], 0.5), { x: 0.5, y: 0.5 }, "zero length");
  assert.equal(legIndexAt(legs, 0), 0);
  assert.equal(legIndexAt(legs, 0.5), 1);
  assert.equal(legIndexAt(legs, 0.49), 0);
  assert.equal(legIndexAt(legs, 1), 1);
  // At grid scale this matches the voyage clock.
  const grid = mapGridSchema.parse({ columns: 10, rows: 10, feetPerTile: 5280 });
  const tiles = [
    { column: 0, row: 0 },
    { column: 4, row: 0 },
    { column: 4, row: 4 },
  ];
  const tilePoints = tiles.map((t) => tilePoint(grid, t));
  const gridLegs = legDeciMiles({ kind: "grid", grid }, tilePoints);
  for (const progress of [0, 0.25, 0.5, 0.8, 1])
    assert.deepEqual(
      routePointAt(tilePoints, gridLegs, progress),
      routePosition({ grid, points: tiles }, progress),
    );
});

test("snapping to anchored places and tile centres", () => {
  const map = campaignMapSchema.parse({
    id: "vale",
    name: "Vale",
    image: "data:image/png;base64,YQ==",
    locationId: null,
    visible: true,
    anchors: [
      { locationId: "harrowgate", x: 0.2, y: 0.5 },
      { locationId: "mill", x: 0.3, y: 0.5 },
    ],
    markers: [],
  });
  assert.deepEqual(snapRoutePoint(map, { x: 0.21, y: 0.51 }), {
    x: 0.2,
    y: 0.5,
    locationId: "harrowgate",
  });
  assert.deepEqual(snapRoutePoint(map, { x: 0.27, y: 0.5 }), { x: 0.3, y: 0.5, locationId: "mill" });
  assert.deepEqual(snapRoutePoint(map, { x: 0.763, y: 0.54 }), { x: 0.763, y: 0.54 }, "free point");
  // A wide image: horizontal offsets count double.
  assert.deepEqual(snapRoutePoint(map, { x: 0.22, y: 0.5 }, { aspect: 2 }), { x: 0.22, y: 0.5 });
  assert.deepEqual(snapRoutePoint(map, { x: -1, y: 2 }), { x: 0, y: 1 });
  const grid = mapGridSchema.parse({ columns: 10, rows: 10 });
  const gridded = { ...map, grid };
  assert.deepEqual(snapRoutePoint(gridded, { x: 0.83, y: 0.11 }), tilePoint(grid, { column: 8, row: 1 }));
  assert.deepEqual(snapRoutePoint(gridded, { x: 0.21, y: 0.51 }), {
    ...tilePoint(grid, tileAt(grid, { x: 0.2, y: 0.5 })!),
    locationId: "harrowgate",
  });
});

test("typed tile list round-trips and is validated", () => {
  const grid = { columns: 40, rows: 25 };
  assert.deepEqual(parseTileList("23,14; 22,9", grid), [
    { column: 22, row: 13 },
    { column: 21, row: 8 },
  ]);
  assert.equal(formatTileList(parseTileList(" 23 , 14 ;22,9 ", grid)), "23,14; 22,9");
  assert.deepEqual(parseTileList("  ", grid), []);
  assert.throws(() => parseTileList("23-14", grid), /column,row/);
  assert.throws(() => parseTileList("41,1", grid), /outside the grid/);
  assert.throws(() => parseTileList("0,1", grid), /outside the grid/);
});

test("a map's measuring frame: grid wins over a scale bar", () => {
  const grid = mapGridSchema.parse({ columns: 4, rows: 4 }),
    scale = mapScaleSchema.parse({
      a: { x: 0, y: 0 },
      b: { x: 1, y: 0 },
      distance: 1,
      unit: "mi",
      aspect: 1,
    });
  assert.equal(routeFrame({ grid, scale })?.kind, "grid");
  assert.equal(routeFrame({ scale })?.kind, "scale");
  assert.equal(routeFrame({}), undefined);
  assert.notEqual(
    frameFingerprint({ kind: "scale", scale }),
    frameFingerprint({ kind: "scale", scale: { ...scale, distance: 2 } }),
  );
});

test("day plan for the review: 61.1 mi at 24 mi/day departs day 41 and arrives day 43 about 1 pm", async () => {
  const { journeyDayPlan, aboutTime } = await import("./journey.ts");
  const days = journeyDayPlan([168, 150, 144, 149], 3666, 0, 3666, 41);
  assert.deepEqual(days.map((d) => [d.day, d.deci, d.legs]), [
    [41, 240, [0, 1]],
    [42, 240, [1, 2, 3]],
    [43, 131, [3]],
  ]);
  assert.equal(days[2].arrivalMinute, 786);
  assert.equal(aboutTime(786), "about 1 pm");
  // Partial approval: one day now, the rest later from the same frozen route.
  assert.deepEqual(journeyDayPlan([168, 150, 144, 149], 3666, 1440, 3666, 42).map((d) => d.day), [42, 43]);
});
