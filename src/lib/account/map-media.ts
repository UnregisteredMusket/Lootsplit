import { accountRequest } from "./client";
import {
  mapAssetPartCount,
  mapAssetManifestSchema,
  verifyMapAsset,
  type MapAssetBundle,
  type MapMediaReference,
} from "../quire/map-assets-schema";

export async function saveAccountMapAsset(bundle: MapAssetBundle) {
  await verifyMapAsset(bundle);
  const result = await accountRequest<{ complete: boolean }>("map-assets", {
    request: { action: "begin", manifest: bundle.manifest },
  });
  if (result.complete) return;
  for (let from = 0; from < bundle.parts.length; from += 4)
    await accountRequest("map-assets", {
      request: {
        action: "parts",
        assetId: bundle.manifest.id,
        parts: bundle.parts.slice(from, from + 4),
      },
    });
  await accountRequest("map-assets", {
    request: { action: "complete", assetId: bundle.manifest.id },
  });
}
export async function loadAccountMapAsset(
  reference: MapMediaReference,
  record?: { code: string; id: string },
): Promise<MapAssetBundle> {
  const response = await accountRequest<{ manifest: unknown }>("map-assets", {
    record,
    request: { action: "manifest", mapId: "archive", assetId: reference.id },
  });
  const manifest = mapAssetManifestSchema.parse(response.manifest);
  if (manifest.sha256 !== reference.sha256)
    throw Error("The saved map identity changed. Keep the original backup.");
  const parts: MapAssetBundle["parts"] = [];
  for (let from = 0; from < mapAssetPartCount(manifest.bytes); from += 4) {
    const response = await accountRequest<{ parts: MapAssetBundle["parts"] }>("map-assets", {
      record,
      request: { action: "read", mapId: "archive", assetId: reference.id, from, count: 4 },
    });
    parts.push(...response.parts);
  }
  const bundle = { manifest, parts };
  await verifyMapAsset(bundle);
  return bundle;
}
export function accountMapReferences(payload: { journal?: unknown }): MapMediaReference[] {
  const references = new Map<string, MapMediaReference>();
  const scan = (value: unknown, depth = 0) => {
    if (depth > 10) throw Error("Too many nested campaign archives.");
    const journal = (
      value as {
        journal?: {
          world?: {
            maps?: {
              tabletop?: { media?: MapMediaReference; frames?: { media: MapMediaReference }[] };
            }[];
          };
          reports?: { snapshot: string }[];
        };
      }
    )?.journal;
    for (const map of journal?.world?.maps ?? [])
      for (const ref of [
        map.tabletop?.media,
        ...(map.tabletop?.frames?.map((frame) => frame.media) ?? []),
      ])
        if (ref) references.set(ref.id, ref);
    for (const report of journal?.reports ?? []) {
      let nested: unknown;
      try {
        nested = JSON.parse(report.snapshot);
      } catch {
        continue;
      }
      scan(nested, depth + 1);
    }
  };
  scan(payload);
  return [...references.values()];
}
export async function hydrateAccountMapBackup<
  T extends { journal?: unknown; mapAssets?: MapAssetBundle[] },
>(payload: T, record?: { code: string; id: string }): Promise<T> {
  const assets = [...(payload.mapAssets ?? [])];
  for (const reference of accountMapReferences(payload))
    if (!assets.some((asset) => asset.manifest.id === reference.id))
      assets.push(await loadAccountMapAsset(reference, record));
  return { ...payload, ...(assets.length ? { mapAssets: assets } : {}) };
}
