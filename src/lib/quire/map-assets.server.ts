import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { database, readRoom } from "./room-store.server.ts";
import { mapAccessible, projectTabletopMap } from "./tabletop.ts";
import { canonicalJson } from "./canonical-json.ts";
import {
  MAP_ASSET_OWNER_LIMIT,
  MAP_ASSET_CHUNK_BYTES,
  decodeMapPart,
  mapAssetManifestSchema,
  mapAssetPartCount,
  mapAssetRequestSchema,
  mapMediaReference,
  verifyMapAsset,
  type MapAssetManifest,
  type MapAssetBundle,
  type MapMediaReference,
} from "./map-assets-schema.ts";

type StoredAsset = { manifest: MapAssetManifest; complete: boolean };
const localRoot = () => path.join(process.cwd(), "data", "map-assets");
const ownerDirectory = (owner: string) =>
  path.join(localRoot(), Buffer.from(owner).toString("base64url"));
const assetDirectory = (owner: string, id: string) => path.join(ownerDirectory(owner), id);
async function localRead<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function localPut(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + "." + crypto.randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value), { flag: "wx" });
  await rename(temporary, file);
}
export async function storedMapAsset(
  owner: string,
  id: string,
  db = database(),
): Promise<StoredAsset | null> {
  const row = db
    ? await db
        .prepare("SELECT manifest,complete FROM campaign_map_assets WHERE owner_id=? AND id=?")
        .bind(owner, id)
        .first<{ manifest: string; complete: number }>()
    : null;
  return db
    ? row
      ? {
          manifest: mapAssetManifestSchema.parse(JSON.parse(row.manifest)),
          complete: row.complete === 1,
        }
      : null
    : localRead<StoredAsset>(path.join(assetDirectory(owner, id), "manifest.json"));
}
async function parts(
  owner: string,
  id: string,
  from: number,
  count: number,
  db = database(),
): Promise<MapAssetBundle["parts"]> {
  if (db)
    return (
      await db
        .prepare(
          "SELECT part AS 'index',body AS base64 FROM campaign_map_asset_parts WHERE owner_id=? AND asset_id=? AND part>=? AND part<? ORDER BY part",
        )
        .bind(owner, id, from, from + count)
        .all<MapAssetBundle["parts"][number]>()
    ).results;
  const found = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      localRead<string>(path.join(assetDirectory(owner, id), String(from + index) + ".json")),
    ),
  );
  return found.flatMap((base64, index) =>
    base64 === null ? [] : [{ index: from + index, base64 }],
  );
}
const matches = (asset: StoredAsset, reference: MapMediaReference) =>
  asset.complete && canonicalJson(mapMediaReference(asset.manifest)) === canonicalJson(reference);
/** Poster hydration is called only with an already-authorized projected media reference. */
export async function projectedMapPoster(owner: string, reference: MapMediaReference) {
  const asset = await storedMapAsset(owner, reference.id);
  return asset && matches(asset, reference) ? asset.manifest.preview : undefined;
}
export async function mapAssets(input: { code: string; token: string; request: unknown }) {
  const request = mapAssetRequestSchema.parse(input.request);
  const room = await readRoom(input.code.trim().toUpperCase());
  if (!room || room.closed || !room.ownerId) throw Error("This campaign is unavailable.");
  const seat = room.seats.find((seat) => seat.token === input.token);
  if (!seat) throw Error("This browser is not seated at that table.");
  const owner = room.ownerId;
  const writing = !["manifest", "read"].includes(request.action);
  if (writing && (seat.role !== "dm" || room.viewOnly))
    throw Error("Only the campaign DM can publish map media during play.");
  if (request.action === "manifest" || request.action === "read") {
    const asset = await storedMapAsset(owner, request.assetId);
    if (!asset?.complete)
      throw Object.assign(Error("This map asset is unavailable."), { status: 404 });
    if (seat.role !== "dm") {
      const map = room.table.journal?.world?.maps.find((map) => map.id === request.mapId);
      if (!map || !mapAccessible(room.table, map, seat)) throw Error("This map is unavailable.");
      const authorized = projectTabletopMap(room.table, map, seat);
      const refs = [
        authorized.tabletop?.media,
        ...(authorized.tabletop?.frames.map((frame) => frame.media) ?? []),
      ];
      if (!refs.some((reference) => reference?.id === request.assetId && matches(asset, reference)))
        throw Object.assign(Error("This map asset is unavailable."), { status: 404 });
    }
  }
  return ownedMapAsset(owner, request);
}
/** Internal storage primitive: callers MUST establish account ownership or projected seat access first. */
export async function ownedMapAsset(owner: string, input: unknown, db = database()) {
  const request = mapAssetRequestSchema.parse(input);
  if (request.action === "begin") {
    const manifest = request.manifest,
      existing = await storedMapAsset(owner, manifest.id, db);
    if (existing) {
      if (canonicalJson(existing.manifest) !== canonicalJson(manifest))
        throw Error("That map asset identity is already used.");
      return { complete: existing.complete };
    }
    if (db) {
      // Reserve the declared bytes atomically, including unfinished uploads. Never discard campaign art.
      const result = await db
        .prepare(
          "INSERT INTO campaign_map_assets(owner_id,id,manifest,sha256,bytes,created_at) SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT SUM(bytes) FROM campaign_map_assets WHERE owner_id=?),0)+?<=? ON CONFLICT(owner_id,id) DO NOTHING",
        )
        .bind(
          owner,
          manifest.id,
          JSON.stringify(manifest),
          manifest.sha256,
          manifest.bytes,
          Date.now(),
          owner,
          manifest.bytes,
          MAP_ASSET_OWNER_LIMIT,
        )
        .run();
      if (!result.meta.changes)
        throw Error(
          "Map storage is full or another upload used this identity. Existing artwork is retained.",
        );
    } else
      await localPut(path.join(assetDirectory(owner, manifest.id), "manifest.json"), {
        manifest,
        complete: false,
      });
    return { complete: false };
  }
  const asset = await storedMapAsset(owner, request.assetId, db);
  if (!asset) throw Object.assign(Error("This map asset is unavailable."), { status: 404 });
  if (request.action === "manifest" || request.action === "read") {
    if (!asset.complete)
      throw Object.assign(Error("This map asset is unavailable."), { status: 404 });
    return request.action === "manifest"
      ? { manifest: asset.manifest }
      : { parts: await parts(owner, request.assetId, request.from, request.count, db) };
  }
  if (request.action === "parts") {
    if (asset.complete) return { complete: true };
    for (const part of request.parts) {
      const expected = Math.min(
        MAP_ASSET_CHUNK_BYTES,
        asset.manifest.bytes - part.index * MAP_ASSET_CHUNK_BYTES,
      );
      if (expected <= 0 || decodeMapPart(part.base64).length !== expected)
        throw Error("The map upload part has the wrong size.");
      const prior = (await parts(owner, request.assetId, part.index, 1, db))[0];
      if (prior && prior.base64 !== part.base64)
        throw Error("An uploaded map part cannot change. Start a new upload instead.");
    }
    if (db)
      await db.batch(
        request.parts.map((part) =>
          db
            .prepare(
              "INSERT INTO campaign_map_asset_parts(owner_id,asset_id,part,body) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM campaign_map_assets WHERE owner_id=? AND id=? AND complete=0) ON CONFLICT(owner_id,asset_id,part) DO NOTHING",
            )
            .bind(owner, request.assetId, part.index, part.base64, owner, request.assetId),
        ),
      );
    else
      for (const part of request.parts)
        await localPut(
          path.join(assetDirectory(owner, request.assetId), part.index + ".json"),
          part.base64,
        );
    return { complete: false };
  }
  if (!asset.complete) {
    const uploaded = await parts(
      owner,
      request.assetId,
      0,
      mapAssetPartCount(asset.manifest.bytes),
      db,
    );
    if (uploaded.length !== mapAssetPartCount(asset.manifest.bytes))
      throw Error("The map upload is incomplete.");
    await verifyMapAsset({ manifest: asset.manifest, parts: uploaded });
    if (db)
      await db
        .prepare("UPDATE campaign_map_assets SET complete=1 WHERE owner_id=? AND id=?")
        .bind(owner, request.assetId)
        .run();
    else
      await localPut(path.join(assetDirectory(owner, request.assetId), "manifest.json"), {
        ...asset,
        complete: true,
      });
  }
  return { complete: true };
}
