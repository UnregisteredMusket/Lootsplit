import test from "node:test";
import assert from "node:assert/strict";
import { frameRoute, freeArea, journeyPlanHref, journeyPlanMapId, legTicks } from "./journey-ui.ts";

const map = (id: string, anchors: string[], extra: Record<string, unknown> = {}) => ({
  id,
  anchors: anchors.map((locationId) => ({ locationId, x: 0.5, y: 0.5 })),
  ...extra,
});

test("Plan journey opens the map the party is on", () => {
  const journal = {
    market: { currentLocationId: "harrowgate" },
    world: {
      maps: [map("town", ["harrowgate"]), map("vale", ["harrowgate"], { scale: {} }), map("road", [])],
      partyPosition: { mapId: "road" },
    },
  };
  // A free party position wins.
  assert.equal(journeyPlanMapId(journal as never), "road");
  // Otherwise a map anchoring the party's location, preferring one with a scale or grid.
  const located = { ...journal, world: { ...journal.world, partyPosition: undefined } };
  assert.equal(journeyPlanMapId(located as never), "vale");
  assert.equal(journeyPlanHref(located as never), "/maps?map=vale&plan=party");
  // Without a party location or a map for it the planner still opens on the usual map.
  assert.equal(journeyPlanHref({ market: { currentLocationId: null }, world: { maps: [] } } as never), "/maps?plan=party");
  assert.equal(journeyPlanHref(undefined), "/maps?plan=party");
  // A party position on a map this viewer can't see (projected away) is ignored.
  const hidden = { market: { currentLocationId: null }, world: { maps: [map("vale", [])], partyPosition: { mapId: "secret" } } };
  assert.equal(journeyPlanMapId(hidden as never), undefined);
  // Ids are encoded.
  const odd = { market: { currentLocationId: "a" }, world: { maps: [map("x&y", ["a"])] } };
  assert.equal(journeyPlanHref(odd as never), "/maps?map=x%26y&plan=party");
});

test("the free area is above a phone bottom sheet and right of a desktop panel", () => {
  const region = { width: 390, height: 844 },
    reserve = { left: 10, top: 170, right: 10, bottom: 10 };
  assert.deepEqual(freeArea(region, { left: 10, top: 300, right: 380, bottom: 700 }, reserve), {
    left: 10,
    top: 170,
    right: 380,
    bottom: 292,
  });
  const desk = { width: 1280, height: 900 };
  assert.deepEqual(
    freeArea(desk, { left: 14, top: 70, right: 394, bottom: 780 }, { left: 14, top: 70, right: 70, bottom: 60 }),
    { left: 402, top: 70, right: 1210, bottom: 840 },
  );
  assert.deepEqual(freeArea(desk, undefined, { left: 1, top: 2, right: 3, bottom: 4 }), {
    left: 1,
    top: 2,
    right: 1277,
    bottom: 896,
  });
});

test("framing a route keeps a visible route still and fits a hidden one without zooming in", () => {
  const base = { w: 390, h: 244 },
    area = { left: 10, top: 170, right: 380, bottom: 292 };
  // Whole map behind the sheet: zoom out so it fits the band and centre it there.
  const view = frameRoute(
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    { x: 0, y: 300, scale: 1 },
    base,
    area,
  )!;
  assert.ok(view.scale < 1 && view.scale >= 0.5, `zoomed out (${view.scale})`);
  const top = view.y,
    bottom = view.y + base.h * view.scale;
  assert.ok(top >= area.top - 0.5 && bottom <= area.bottom + 0.5, `${top}–${bottom} inside the band`);
  assert.ok(Math.abs(view.x + (base.w * view.scale) / 2 - 195) < 0.5, "centred horizontally");
  // Already inside: no camera change.
  assert.equal(
    frameRoute([{ x: 0.5, y: 0.5 }], { x: 0, y: 110, scale: 1 }, base, area),
    undefined,
  );
  // One hidden point: pan only, never zoom in.
  const pan = frameRoute([{ x: 0.5, y: 0.9 }], { x: 0, y: 300, scale: 2 }, base, area)!;
  assert.equal(pan.scale, 2);
  assert.ok(Math.abs(pan.y + 0.9 * base.h * 2 - 231) < 0.5);
  // Degenerate areas are left alone; the scale never drops below 0.5.
  assert.equal(frameRoute([{ x: 0, y: 0 }], { x: 0, y: 0, scale: 1 }, base, { left: 0, top: 0, right: 20, bottom: 20 }), undefined);
  const tiny = frameRoute(
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    { x: 0, y: 900, scale: 1 },
    { w: 4000, h: 4000 },
    area,
  )!;
  assert.equal(tiny.scale, 0.5);
});

test("leg ticks mark where each leg ends", () => {
  assert.deepEqual(legTicks([168, 150, 144, 149]).map((t) => Math.round(t * 1000)), [275, 520, 756]);
  assert.deepEqual(legTicks([10]), []);
  assert.deepEqual(legTicks([]), []);
  assert.deepEqual(legTicks([0, 0]), []);
});
