import test from "node:test";
import assert from "node:assert/strict";
import { readMapInterchange } from "./map-import.ts";
import { animatedMapImage } from "./map-image-animation.ts";

const fixture = () => ({
  format: 0.3,
  resolution: { map_origin: { x: 10, y: 20 }, map_size: { x: 4, y: 2 }, pixels_per_grid: 100 },
  image: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
  line_of_sight: [
    [
      { x: 9, y: 21 },
      { x: 12, y: 21 },
    ],
  ],
  portals: [
    {
      bounds: [
        { x: 11, y: 20 },
        { x: 11, y: 22 },
      ],
      closed: false,
    },
  ],
  lights: [{ position: { x: 12, y: 21 }, range: 3, color: "ffaabbcc", intensity: 0.5 }],
});
test("animated raster containers are identified before a motion map is displayed", () => {
  const png = new Uint8Array(28);
  png.set(Buffer.from("acTL"), 12);
  assert.equal(animatedMapImage(png, "image/png"), true);
  const webp = new Uint8Array(24);
  webp.set(Buffer.from("RIFF"));
  webp.set(Buffer.from("WEBP"), 8);
  webp.set(Buffer.from("ANIM"), 12);
  assert.equal(animatedMapImage(webp, "image/webp"), true);
  assert.equal(animatedMapImage(new Uint8Array([137, 80, 78, 71]), "image/png"), false);
  png.set([255, 255, 255, 255], 8);
  assert.equal(animatedMapImage(png, "image/png"), false);
});
test("UVTT normalizes origin, clips exterior geometry and preserves reviewed doors, scale and colors", () => {
  const imported = readMapInterchange(JSON.stringify(fixture()));
  assert.equal(imported.settings.vision, "off");
  assert.equal(imported.settings.fog.enabled, true);
  assert.equal(imported.settings.playerMovement, false);
  assert.deepEqual(imported.settings.walls[0].a, { x: 0, y: 0.5 });
  assert.deepEqual(imported.settings.walls[0].b, { x: 0.5, y: 0.5 });
  assert.equal(imported.settings.walls[1].open, true);
  assert.equal(imported.settings.lights[0].radiusFeet, 15);
  assert.equal(imported.settings.lights[0].color, "#aabbcc");
  assert.equal(imported.width, 400);
  assert.equal(imported.height, 200);
  assert.ok(imported.warnings.some((value) => value.includes("clipped")));
});
test("UVTT refuses remote/active artwork, invalid grids, huge geometry and unknown format versions", () => {
  for (const patch of [
    { image: "https://example.com/map.png" },
    { image: Buffer.from("<svg onload='evil()'/>").toString("base64") },
    { format: 2 },
    { resolution: { ...fixture().resolution, map_size: { x: 201, y: 2 } } },
    { line_of_sight: [Array.from({ length: 1002 }, () => ({ x: 0, y: 0 }))] },
    { lights: [{ position: { x: 0, y: 0 }, range: -1, color: "ffffff" }] },
  ])
    assert.throws(() => readMapInterchange(JSON.stringify({ ...fixture(), ...patch })));
});
test("untrusted extra metadata is never executed or retained and is disclosed for review", () => {
  const imported = readMapInterchange(
    JSON.stringify({ ...fixture(), script: "fetch('/secrets')", tokens: [{ id: "hijack" }] }),
  );
  assert.equal("script" in imported.settings, false);
  assert.equal("tokens" in imported, false);
  assert.ok(imported.warnings.some((value) => value.includes("ignored")));
});
