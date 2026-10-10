import {
  encodeRoomResources,
  hydrateRoomResources,
  roomResourceStatements,
} from "./room-resources.mjs";
/** Campaign-scoped immutable raster bytes; references are internal storage only. */
const raster = /data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]{8000,}/g;
const reference = /\/art\/room-image-[a-f0-9]{64}\.webp/g;
/** @param {unknown} value */
export async function encodeRoomImages(value) {
  const resources = await encodeRoomResources(value);
  let body = JSON.stringify(resources.value);
  // Existing sheet/profile and recovery SQL reads raw room portraits directly.
  // Extract map images only; keep every image also used outside maps inline.
  const maps = new Set(),
    inline = new Set();
  /** @param {unknown} node */
  function scan(node, map = false, world = false) {
    if (typeof node === "string") {
      for (const image of node.match(raster) || []) inline.add(image);
    } else if (Array.isArray(node)) {
      node.forEach((value) => scan(value));
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (map && key === "image" && typeof value === "string") {
          if (value.match(raster)?.some((image) => image === value)) maps.add(value);
        } else if (world && key === "maps" && Array.isArray(value)) {
          value.forEach((value) => scan(value, true));
        } else if (key === "world") {
          scan(value, false, true);
        } else if ("kind" in node && node.kind === "map-save" && ["map", "before"].includes(key)) {
          scan(value, true);
        } else if (key === "snapshot" && typeof value === "string") {
          try {
            scan(JSON.parse(value));
          } catch {
            scan(value);
          }
        } else scan(value);
      }
    }
  }
  scan(value);
  const images = [...maps].filter((image) => !inline.has(image));
  const assets = await Promise.all(
    images.map(async (image) => {
      if (image.length > 500000)
        throw Error(
          "A shared raster image exceeds the supported size. Keep the original export and resize it before sharing.",
        );
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(image));
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
        "",
      );
      return { reference: `/art/room-image-${hash}.webp`, image };
    }),
  );
  for (const asset of assets) body = body.split(asset.image).join(asset.reference);
  return { body, assets, documents: resources.documents };
}
/** Never fetch by hash alone: identical/guessed references confer no cross-campaign access.
 * @template T @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {string} code @param {T} value @returns {Promise<T>} */
export async function hydrateRoomImages(db, code, value) {
  let body = JSON.stringify(value);
  const refs = [...new Set(body.match(reference) || [])];
  if (!refs.length) return hydrateRoomResources(db, code, value);
  // Fetch only needed references, in bounded parameter groups. No public image endpoint.
  for (let offset = 0; offset < refs.length; offset += 80) {
    const wanted = refs.slice(offset, offset + 80);
    const rows = await db
      .prepare(
        `SELECT reference,image FROM campaign_room_images WHERE code=? AND reference IN (${wanted.map(() => "?").join(",")})`,
      )
      .bind(code, ...wanted)
      .all();
    const assets = new Map(rows.results.map((row) => [row.reference, row.image]));
    for (const ref of wanted) {
      const image = assets.get(ref);
      if (typeof image !== "string")
        throw Error(
          "A campaign image is missing. Keep the original recovery export; the campaign was not changed.",
        );
      body = body.split(ref).join(image);
    }
  }
  return hydrateRoomResources(db, code, JSON.parse(body));
}
/** Writes follow the room CAS in the same atomic D1 batch; a losing writer creates no assets.
 * @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {{code:string;revision:number}} room @param {{body:string;assets:{reference:string;image:string}[]}} encoded */
export async function roomImageStatements(db, room, encoded) {
  const documents = await roomResourceStatements(db, room, encoded);
  if (!encoded.assets.length) return documents;
  const present = await db
    .prepare("SELECT reference FROM campaign_room_images WHERE code=?")
    .bind(room.code)
    .all();
  const existing = new Set(present.results.map((row) => row.reference));
  return [
    ...documents,
    ...encoded.assets
      .filter((asset) => !existing.has(asset.reference))
      .map((asset) =>
        db
          .prepare(
            "INSERT INTO campaign_room_images(code,reference,image) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND revision=? AND body=?) ON CONFLICT(code,reference) DO NOTHING",
          )
          .bind(room.code, asset.reference, asset.image, room.code, room.revision, encoded.body),
      ),
  ];
}
