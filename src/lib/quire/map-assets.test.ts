import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emptyCloudTable, type CloudRoom } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { mapTabletopSchema } from "./tabletop-schema.ts";
import {
  mapMediaReference,
  verifyMapAsset,
  mapAssetManifestSchema,
  MAP_ASSET_CHUNK_BYTES,
} from "./map-assets-schema.ts";
import type { MapAssetBundle } from "./map-assets-schema.ts";
import { visionPolygon } from "./map-visibility-render.ts";
import { inPolygon, scenePointVisible } from "./tabletop-geometry.ts";
import { mapGridSchema } from "./world-schema.ts";

async function bundle(
  purpose: "original" | "render" = "original",
  length = 32,
): Promise<MapAssetBundle> {
  const bytes = new Uint8Array(length);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  return {
    manifest: mapAssetManifestSchema.parse({
      id: crypto.randomUUID(),
      mime: "image/png",
      purpose,
      bytes: length,
      width: 40,
      height: 20,
      sha256,
      preview: "data:image/png;base64,aA==",
    }),
    parts: Array.from({ length: Math.ceil(length / MAP_ASSET_CHUNK_BYTES) }, (_, index) => ({
      index,
      base64: Buffer.from(
        bytes.subarray(index * MAP_ASSET_CHUNK_BYTES, (index + 1) * MAP_ASSET_CHUNK_BYTES),
      ).toString("base64"),
    })),
  };
}
test("bounded manifests and ordered checksum validation reject incomplete, corrupt and active content", async () => {
  const asset = await bundle("original", MAP_ASSET_CHUNK_BYTES + 32);
  assert.equal((await verifyMapAsset(asset)).length, asset.manifest.bytes);
  for (const parts of [
    asset.parts.slice(1),
    [...asset.parts].reverse(),
    [{ ...asset.parts[0], index: 1 }, asset.parts[1]],
    [{ ...asset.parts[0], base64: "AAAA" }, asset.parts[1]],
  ])
    await assert.rejects(verifyMapAsset({ ...asset, parts }));
  await assert.rejects(
    verifyMapAsset({ ...asset, manifest: { ...asset.manifest, sha256: "0".repeat(64) } }),
    /checksum/,
  );
  for (const change of [
    { width: 8193 },
    { width: 8192, height: 8192 },
    { bytes: 20_000_001 },
    { mime: "image/svg+xml" },
    { purpose: "render", mime: "video/mp4" },
  ])
    assert.equal(mapAssetManifestSchema.safeParse({ ...asset.manifest, ...change }).success, false);
});
test("asset reads require a fresh seat, visible scene and audience-specific current render; uploads retry without changing parts", async () => {
  const old = process.cwd(),
    directory = await mkdtemp(path.join(os.tmpdir(), "lootsplit-map-assets-"));
  process.chdir(directory);
  try {
    const { mapAssets } = await import("./map-assets.server.ts"),
      { createRoom, updateRoom } = await import("./room-store.server.ts");
    const original = await bundle(),
      render = await bundle("render");
    const map = {
      id: "map",
      name: "Keep",
      image: "data:image/png;base64,aA==",
      visible: true,
      locationId: null,
      anchors: [],
      markers: [],
      tabletop: mapTabletopSchema.parse({
        media: mapMediaReference(original.manifest),
        vision: "individual",
        frames: [
          {
            id: crypto.randomUUID(),
            audience: "purse:hero",
            revision: 0,
            media: mapMediaReference(render.manifest),
          },
        ],
      }),
    };
    const room: CloudRoom = {
      code: "MAPTEST",
      ownerId: "owner",
      sessionId: "session",
      revision: 1,
      turn: 0,
      live: true,
      seats: [
        { id: "dm", name: "DM", token: "dm-token", role: "dm", purseIds: [] },
        { id: "player", name: "Player", token: "pc-token", role: "player", purseIds: ["hero"] },
        { id: "other", name: "Other", token: "other-token", role: "player", purseIds: ["other"] },
      ],
      seen: { gifts: [], sales: [] },
      table: { ...emptyCloudTable(), journal: readJournal({ world: { maps: [map] } }) },
    };
    await createRoom(room);
    const call = (request: unknown, token = "dm-token") =>
      mapAssets({ code: room.code, token, request });
    for (const asset of [original, render]) {
      await call({ action: "begin", manifest: asset.manifest });
      await assert.rejects(call({ action: "complete", assetId: asset.manifest.id }), /incomplete/);
      await call({ action: "parts", assetId: asset.manifest.id, parts: asset.parts });
      await call({ action: "parts", assetId: asset.manifest.id, parts: asset.parts });
      await assert.rejects(
        call({
          action: "parts",
          assetId: asset.manifest.id,
          parts: [{ ...asset.parts[0], base64: Buffer.alloc(32).toString("base64") }],
        }),
        /cannot change/,
      );
      await call({ action: "complete", assetId: asset.manifest.id });
    }
    const read = (id: string, token = "pc-token") =>
      call({ action: "read", assetId: id, mapId: "map", from: 0, count: 4 }, token);
    assert.ok("parts" in (await read(render.manifest.id)));
    for (const token of ["pc-token", "other-token", "revoked"])
      await assert.rejects(read(original.manifest.id, token));
    await assert.rejects(read(render.manifest.id, "other-token"));
    await assert.rejects(
      call({ action: "begin", manifest: (await bundle()).manifest }, "pc-token"),
      /Only/,
    );
    assert.ok("parts" in (await read(original.manifest.id, "dm-token")));
    room.table.journal!.world!.maps[0].tabletop!.revision++;
    room.revision++;
    await updateRoom(room, room.revision - 1);
    await assert.rejects(read(render.manifest.id), /unavailable/);
    room.closed = true;
    room.revision++;
    await updateRoom(room, room.revision - 1);
    await assert.rejects(read(original.manifest.id, "dm-token"), /unavailable/);
  } finally {
    process.chdir(old);
    await rm(directory, { recursive: true, force: true });
  }
});
test("visibility polygons respect walls, doors, cropped grids and the authoritative line-of-sight boundary", () => {
  const map = {
    id: "map",
    name: "Map",
    image: "data:image/png;base64,aA==",
    visible: true,
    locationId: null,
    anchors: [],
    markers: [],
    grid: mapGridSchema.parse({ columns: 20, rows: 10, x: 0.1, y: 0.2, width: 0.8, height: 0.6 }),
  };
  const settings = mapTabletopSchema.parse({
    vision: "party",
    walls: [{ id: "wall", a: { x: 0.5, y: 0.1 }, b: { x: 0.5, y: 0.9 } }],
  });
  const viewer = { point: { x: 0.3, y: 0.5 }, rangeFeet: 80, darkvisionFeet: 0 },
    polygon = visionPolygon(viewer.point, 80, map, settings);
  assert.equal(inPolygon({ x: 0.7, y: 0.5 }, polygon), false);
  assert.equal(inPolygon({ x: 0.4, y: 0.5 }, polygon), true);
  for (let x = 0.025; x < 1; x += 0.05)
    for (let y = 0.025; y < 1; y += 0.05)
      if (inPolygon({ x, y }, polygon))
        assert.ok(scenePointVisible({ x, y }, settings, map.grid, [viewer]));
  settings.walls[0].open = true;
  assert.ok(inPolygon({ x: 0.7, y: 0.5 }, visionPolygon(viewer.point, 80, map, settings)));
});
