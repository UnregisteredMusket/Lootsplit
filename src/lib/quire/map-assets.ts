import { quireDb, request } from "./db.ts";
import { getSeat } from "./table.ts";
import { activeCampaignId } from "./campaign-context.ts";
import { getCloudTable, requestMapAssets } from "./cloud-client.ts";
import {
  MAP_ASSET_LIMIT,
  MAP_ASSET_CHUNK_BYTES,
  mapAssetBundleSchema,
  mapAssetManifestSchema,
  mapAssetPartCount,
  verifyMapAsset,
  type MapAssetBundle,
  type MapMediaReference,
} from "./map-assets-schema.ts";
import type { CampaignMap } from "./world-schema.ts";

export async function cacheMapAsset(bundle: MapAssetBundle) {
  if (getSeat().role !== "dm") throw Error("Only the DM keeps map originals for offline play.");
  await verifyMapAsset(bundle);
  const db = await quireDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put({ id: "map-asset:" + bundle.manifest.id, bundle });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? Error("The map could not be saved for offline play."));
  });
}
export async function cachedMapAsset(id: string): Promise<MapAssetBundle | undefined> {
  if (getSeat().role !== "dm") return undefined;
  const db = await quireDb();
  return (
    await request<{ bundle: MapAssetBundle } | undefined>(
      db
        .transaction("meta")
        .objectStore("meta")
        .get("map-asset:" + id),
    )
  )?.bundle;
}
export async function publishMapAsset(
  bundle: MapAssetBundle,
  progress?: (message: string) => void,
) {
  if (!getCloudTable().joined) return;
  const scope = activeCampaignId(),
    current = () => {
      if (activeCampaignId() !== scope || getSeat().role !== "dm")
        throw Error("The campaign changed.");
    };
  current();
  const begun = await requestMapAssets({ action: "begin", manifest: bundle.manifest });
  if ("complete" in begun && begun.complete) return;
  for (let from = 0; from < bundle.parts.length; from += 4) {
    current();
    progress?.(`Uploading map ${Math.round((from / bundle.parts.length) * 100)}%`);
    await requestMapAssets({
      action: "parts",
      assetId: bundle.manifest.id,
      parts: bundle.parts.slice(from, from + 4),
    });
  }
  current();
  await requestMapAssets({ action: "complete", assetId: bundle.manifest.id });
}
export async function loadMapAsset(
  mapId: string,
  reference: MapMediaReference,
): Promise<MapAssetBundle> {
  const scope = activeCampaignId(),
    local = await cachedMapAsset(reference.id);
  if (local && local.manifest.sha256 === reference.sha256) return local;
  if (!getCloudTable().joined)
    throw Error(
      "This map's original is missing. Restore a complete backup or reconnect to its campaign.",
    );
  const response = await requestMapAssets({ action: "manifest", assetId: reference.id, mapId });
  if (!("manifest" in response)) throw Error("The map manifest is unavailable.");
  const manifest = mapAssetManifestSchema.parse(response.manifest);
  if (manifest.sha256 !== reference.sha256)
    throw Error("The map identity changed. Reload the map.");
  const parts: MapAssetBundle["parts"] = [];
  for (let from = 0; from < mapAssetPartCount(manifest.bytes); from += 4) {
    if (activeCampaignId() !== scope) throw Error("The campaign changed.");
    const part = await requestMapAssets({
      action: "read",
      assetId: reference.id,
      mapId,
      from,
      count: 4,
    });
    if (!("parts" in part) || !part.parts) throw Error("The map download is incomplete.");
    parts.push(...part.parts);
  }
  if (activeCampaignId() !== scope) throw Error("The campaign changed.");
  const bundle = mapAssetBundleSchema.parse({ manifest, parts });
  await verifyMapAsset(bundle);
  if (getSeat().role === "dm") await cacheMapAsset(bundle);
  return bundle;
}
export async function mapAssetBlob(bundle: MapAssetBundle) {
  const bytes = await verifyMapAsset(bundle);
  return new Blob([bytes.buffer as ArrayBuffer], { type: bundle.manifest.mime });
}
export async function bundleMapAsset(
  blob: Blob,
  width: number,
  height: number,
  preview: string,
  purpose: "original" | "render" = "original",
  credit?: MapAssetBundle["manifest"]["credit"],
): Promise<MapAssetBundle> {
  if (blob.size > MAP_ASSET_LIMIT) throw Error("Choose a map up to 20 MB.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const parts = [];
  for (let from = 0; from < bytes.length; from += MAP_ASSET_CHUNK_BYTES) {
    let text = "";
    for (const byte of bytes.subarray(from, from + MAP_ASSET_CHUNK_BYTES))
      text += String.fromCharCode(byte);
    parts.push({ index: parts.length, base64: btoa(text) });
  }
  const bundle = mapAssetBundleSchema.parse({
    manifest: {
      id: crypto.randomUUID(),
      mime: blob.type,
      purpose,
      width,
      height,
      bytes: bytes.length,
      sha256,
      preview,
      credit,
    },
    parts,
  });
  await verifyMapAsset(bundle);
  return bundle;
}
export function mapAssetReferences(maps: CampaignMap[]) {
  return maps.flatMap((map) =>
    [map.tabletop?.media, ...(map.tabletop?.frames.map((frame) => frame.media) ?? [])]
      .filter((media): media is MapMediaReference => !!media)
      .map((media) => ({ mapId: map.id, media })),
  );
}
export async function mapBackupAssets(maps: CampaignMap[]) {
  const seen = new Set<string>(),
    bundles = [];
  for (const { mapId, media } of mapAssetReferences(maps)) {
    if (seen.has(media.id)) continue;
    seen.add(media.id);
    bundles.push(await loadMapAsset(mapId, media));
  }
  return bundles;
}
