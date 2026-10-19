import { z } from "zod";
import { artworkSchema } from "./artwork.ts";

export const MAP_ASSET_LIMIT = 20_000_000;
export const MAP_ASSET_CHUNK_BYTES = 196_608;
export const MAP_ASSET_OWNER_LIMIT = 2_000_000_000;
const mediaFields = {
  id: z.string().uuid(),
  mime: z.enum(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"]),
  purpose: z.enum(["original", "render"]),
  bytes: z.number().int().positive().max(MAP_ASSET_LIMIT),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  animated: z.boolean().optional(),
};
const mediaBounds = (value: {
  width: number;
  height: number;
  purpose: string;
  mime: string;
  animated?: boolean;
}) =>
  value.width * value.height <= 64_000_000 &&
  (value.purpose !== "render" || (value.mime.startsWith("image/") && !value.animated));
export const mapMediaReferenceSchema = z
  .object(mediaFields)
  .strict()
  .refine(
    mediaBounds,
    "Maps support up to 64 megapixels; visibility renders must be still images.",
  );
export const mapAssetManifestSchema = z
  .object({
    ...mediaFields,
    preview: artworkSchema.refine((value) => value.length <= 65_000, "Use a smaller preview."),
    credit: z
      .object({
        creator: z.string().max(200),
        source: z.string().max(1000),
        license: z.string().max(500),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(mediaBounds, "Unsupported map dimensions or render format.");
export const mapRenderedFrameSchema = z
  .object({
    id: z.string().uuid(),
    audience: z.string().regex(/^(party|purse:[^\s]{1,150})$/),
    revision: z.number().int().nonnegative(),
    media: mapMediaReferenceSchema.refine(
      (value) => value.purpose === "render",
      "Use a visibility render.",
    ),
  })
  .strict();
export const mapAssetPartSchema = z
  .object({
    index: z
      .number()
      .int()
      .min(0)
      .max(Math.ceil(MAP_ASSET_LIMIT / MAP_ASSET_CHUNK_BYTES) - 1),
    base64: z
      .string()
      .min(4)
      .max(262_144)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  })
  .strict();
export const mapAssetBundleSchema = z
  .object({
    manifest: mapAssetManifestSchema,
    parts: z
      .array(mapAssetPartSchema)
      .min(1)
      .max(Math.ceil(MAP_ASSET_LIMIT / MAP_ASSET_CHUNK_BYTES)),
  })
  .strict();
export const mapAssetRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("begin"), manifest: mapAssetManifestSchema }).strict(),
  z
    .object({
      action: z.literal("parts"),
      assetId: z.string().uuid(),
      parts: z.array(mapAssetPartSchema).min(1).max(4),
    })
    .strict(),
  z.object({ action: z.literal("complete"), assetId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("manifest"),
      assetId: z.string().uuid(),
      mapId: z.string().min(1).max(150),
    })
    .strict(),
  z
    .object({
      action: z.literal("read"),
      assetId: z.string().uuid(),
      mapId: z.string().min(1).max(150),
      from: z.number().int().min(0).max(101),
      count: z.number().int().min(1).max(4),
    })
    .strict(),
]);
export type MapMediaReference = z.infer<typeof mapMediaReferenceSchema>;
export type MapAssetManifest = z.infer<typeof mapAssetManifestSchema>;
export type MapAssetBundle = z.infer<typeof mapAssetBundleSchema>;
export type MapRenderedFrame = z.infer<typeof mapRenderedFrameSchema>;
export const mapAssetPartCount = (bytes: number) => Math.ceil(bytes / MAP_ASSET_CHUNK_BYTES);
export function mapMediaReference(manifest: MapAssetManifest): MapMediaReference {
  return mapMediaReferenceSchema.parse(
    Object.fromEntries(
      Object.keys(mediaFields).map((key) => [key, manifest[key as keyof MapAssetManifest]]),
    ),
  );
}
export function decodeMapPart(base64: string) {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
/** Validate before publishing or replacing a local campaign. Never executes imported content. */
export async function verifyMapAsset(input: unknown): Promise<Uint8Array> {
  const { manifest, parts } = mapAssetBundleSchema.parse(input);
  if (parts.length !== mapAssetPartCount(manifest.bytes))
    throw Error("The map upload is incomplete.");
  const bytes = new Uint8Array(manifest.bytes);
  let offset = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!,
      decoded = decodeMapPart(part.base64);
    if (
      part.index !== index ||
      decoded.length !== Math.min(MAP_ASSET_CHUNK_BYTES, manifest.bytes - offset)
    )
      throw Error("The map upload has missing or incorrectly sized parts.");
    bytes.set(decoded, offset);
    offset += decoded.length;
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== manifest.sha256) throw Error("The map upload checksum did not match.");
  const text = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  const valid =
    manifest.mime === "image/png"
      ? text(1, 4) === "PNG" && bytes[0] === 137
      : manifest.mime === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : manifest.mime === "image/webp"
          ? text(0, 4) === "RIFF" && text(8, 12) === "WEBP"
          : manifest.mime === "video/mp4"
            ? text(4, 8) === "ftyp"
            : bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163;
  if (!valid) throw Error("The uploaded bytes do not match a supported map format.");
  return bytes;
}
