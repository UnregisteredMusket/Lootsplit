// The phone radial (map tokens PR 5): sizes at 390 and 320 px, clamping inside the map with a
// pointer to the true point, More on the lower side for presses in the top third, hit testing
// for slide-to-select, and the long-press rules (500 ms, 6 px pans, a second finger cancels).
import assert from "node:assert/strict";
import test from "node:test";
import { longPress, radialGeometry, radialHit, sliceAngle, sliceLabelPoint } from "./radial-geometry.ts";

const phone = { left: 0, top: 0, width: 390, height: 844 };
const small = { left: 0, top: 0, width: 320, height: 844 };

test("248 px across at 390, 216 at 320; players' wheel is smaller", () => {
  assert.equal(radialGeometry({ x: 195, y: 430 }, 8, phone).radius * 2, 248);
  assert.equal(radialGeometry({ x: 160, y: 430 }, 8, small).radius * 2, 216);
  assert.ok(radialGeometry({ x: 195, y: 430 }, 4, phone, { player: true }).radius < 124);
  // 8 slices at 390 px: each label point is far enough apart for 48 px targets.
  const g = radialGeometry({ x: 195, y: 430 }, 8, phone);
  const a = sliceLabelPoint(g, 0),
    b = sliceLabelPoint(g, 1);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 48);
});

test("near an edge the wheel moves inward and points at the press", () => {
  const g = radialGeometry({ x: 20, y: 800 }, 8, phone);
  assert.ok(g.cx - g.radius >= 16 && g.cy + g.radius <= 844 - 96);
  assert.deepEqual(g.anchor, { x: 20, y: 800 });
  assert.equal(radialGeometry({ x: 195, y: 430 }, 8, phone).anchor, undefined);
  // Landscape (844 × 390): the whole wheel stays on screen.
  const wide = radialGeometry({ x: 300, y: 40 }, 8, { left: 0, top: 0, width: 844, height: 390 });
  assert.ok(wide.cy - wide.radius >= 16 && wide.cy + wide.radius <= 390 - 16);
});

test("a press in the top third puts More (the last slice) at the bottom", () => {
  const g = radialGeometry({ x: 195, y: 150 }, 8, phone, { moreLast: true });
  assert.equal(((sliceAngle(g, 7) % 360) + 360) % 360, 90);
  assert.equal(sliceAngle(radialGeometry({ x: 195, y: 500 }, 8, phone, { moreLast: true }), 0), -90);
});

test("hit testing: slices clockwise from the top, the hub, outside", () => {
  const g = radialGeometry({ x: 195, y: 430 }, 8, phone);
  const at = (deg: number, r = 84) => radialHit(g, g.cx + r * Math.cos((deg * Math.PI) / 180), g.cy + r * Math.sin((deg * Math.PI) / 180));
  assert.equal(at(-90), 0);
  assert.equal(at(-45), 1);
  assert.equal(at(45), 3);
  assert.equal(at(-100), 0);
  assert.equal(at(-135), 7);
  assert.equal(radialHit(g, g.cx + 5, g.cy), "hub");
  assert.equal(radialHit(g, g.cx + 200, g.cy), "outside");
});

test("long press: fires after 500 ms; moving 6 px, a second finger or lifting cancels", () => {
  let now: (() => void) | undefined;
  const fired: number[] = [];
  const timers = { set: (f: () => void) => ((now = f), 1), clear: () => (now = undefined) };
  const press = longPress((id) => fired.push(id), timers);
  press.down(1, 100, 100, true);
  press.move(1, 104, 103);
  now?.();
  assert.deepEqual(fired, [1], "4–5 px of jitter still opens it");
  press.down(2, 100, 100, true);
  press.move(2, 107, 100);
  assert.equal(now, undefined, "pan wins past 6 px");
  press.down(3, 100, 100, true);
  press.down(4, 150, 100, true);
  assert.equal(now, undefined, "a second finger (pinch) cancels");
  press.down(5, 100, 100, true);
  press.up(5);
  assert.equal(now, undefined);
  press.down(6, 100, 100, false);
  assert.equal(press.pending, false, "not while another tool is armed");
});
