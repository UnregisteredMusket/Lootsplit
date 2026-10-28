import { roomCommittedSql } from "./room-storage.mjs";
import {
  encodeRoomResources,
  hydrateRoomResources,
  roomResourceStatements,
} from "./room-resources.mjs";
import { encodeRoomReports, hydrateRoomReports, roomReportStatements } from "./room-reports.mjs";
/**
 * D1 rejects rows above 2,000,000 bytes with an opaque error. An encoded room body and each
 * archived snapshot row must stay at or below this budget (room-store.server.ts guards room
 * writes; campaign-recovery.mjs guards restores).
 */
export const ROOM_BODY_LIMIT = 1_800_000;
/** UTF-8 bytes of the largest row an encoded room write would store (room body or one snapshot).
 * @param {{body:string;reports?:{body:string}[]}} encoded */
export function encodedRoomBytes(encoded) {
  const utf8 = (/** @type {string} */ text) => new TextEncoder().encode(text).length;
  return {
    bytes: utf8(encoded.body),
    largestReport: Math.max(0, ...(encoded.reports || []).map((r) => utf8(r.body))),
  };
}
/** Campaign-scoped immutable raster bytes; references are internal storage only. */
const raster = /data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]{8000,}/g;
const reference = /\/art\/room-image-[a-f0-9]{64}\.webp/g;
/** @param {unknown} value */
export async function encodeRoomImages(value) {
  const resources = await encodeRoomResources(value);
  let body = JSON.stringify(resources.value);
  // Existing sheet/profile and recovery SQL reads raw room portraits directly, so an image that
  // also appears outside the campaign journal (a purse or sheet portrait, an NPC mirrored from
  // it) stays inline. Journal images move to campaign_room_images: map artwork, and since
  // 2026-10-26 the other journal artwork too (market location, shop and record images), which
  // could otherwise push a campaign over the room budget.
  const maps = new Set(),
    journal = new Set(),
    inline = new Set();
  /** @param {string} value */
  const whole = (value) => value.match(raster)?.some((image) => image === value);
  /** @param {unknown} node @param {boolean} [map] @param {boolean} [world] @param {boolean} [inJournal] */
  function scan(node, map = false, world = false, inJournal = false) {
    if (typeof node === "string") {
      if (inJournal && whole(node)) journal.add(node);
      else for (const image of node.match(raster) || []) inline.add(image);
    } else if (Array.isArray(node)) {
      node.forEach((value) => scan(value, false, false, inJournal));
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (map && key === "image" && typeof value === "string") {
          if (whole(value)) maps.add(value);
        } else if (world && key === "maps" && Array.isArray(value)) {
          value.forEach((value) => scan(value, true, false, true));
        } else if (key === "world") {
          scan(value, false, true, inJournal);
        } else if ("kind" in node && node.kind === "map-save" && ["map", "before"].includes(key)) {
          scan(value, true);
        } else if (
          "store" in node &&
          node.store === "journal" &&
          ["before", "after"].includes(key)
        ) {
          // A DM patch draft carries journal parts (journal-patch.ts) or a whole journal.
          scan(value, false, false, true);
        } else if (key === "snapshot" && typeof value === "string") {
          try {
            scan(JSON.parse(value));
          } catch {
            scan(value);
          }
        } else if (key === "journal" && value && typeof value === "object") {
          scan(value, false, false, true);
        } else scan(value, false, false, inJournal);
      }
    }
  }
  scan(value);
  const images = [
    ...[...maps].filter((image) => !inline.has(image)),
    // Larger non-map images stay inline, as before (map artwork keeps its size error below).
    ...[...journal].filter(
      (image) => !inline.has(image) && !maps.has(image) && image.length <= 500000,
    ),
  ];
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
  // Archived session snapshots (already image-encoded above) move to campaign_room_reports.
  const reports = await encodeRoomReports(JSON.parse(body));
  if (reports.reports.length) body = JSON.stringify(reports.value);
  return { body, assets, documents: resources.documents, reports: reports.reports };
}
/** Exact stored map image reference (`/art/room-image-<sha256>.webp`). */
export const ROOM_IMAGE_REFERENCE = /^\/art\/room-image-([a-f0-9]{64})\.webp$/;
/**
 * Non-enumerable reference->image map on a hydrated room: which inline images came from this
 * room's own `campaign_room_images` rows. It never serializes, so it never reaches a stored body.
 */
export const ROOM_IMAGE_SOURCES = Symbol.for("lootsplit.room-image-sources");
/** @param {any} value @returns {any[] | undefined} */
function liveMaps(value) {
  const maps = value?.table?.journal?.world?.maps;
  return Array.isArray(maps) ? maps : undefined;
}
/**
 * Never fetch by hash alone: identical/guessed references confer no cross-campaign access.
 *
 * `keepMapImageReferences` (tabletop protocol 4 reads only): the current maps' own
 * `table.journal.world.maps[].image` references stay as references, so those rasters are neither
 * read from D1 nor sent on the wire. Everything else (drafts, archived snapshots, resource packs)
 * is hydrated exactly as before. Exports, backups, recovery, account records, writes and older
 * protocols never pass this option.
 * @template T @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {string} code @param {T} value @param {{keepMapImageReferences?: boolean}} [options]
 * @returns {Promise<T>} */
export async function hydrateRoomImages(db, code, value, options = {}) {
  // Snapshots first: they may contain image and resource references of their own.
  value = await hydrateRoomReports(db, code, value);
  /** @type {(string | undefined)[]} */
  let kept = [];
  if (options.keepMapImageReferences && liveMaps(value)) {
    value = structuredClone(value);
    kept = /** @type {any[]} */ (liveMaps(value)).map((map) => {
      if (!map || typeof map.image !== "string" || !ROOM_IMAGE_REFERENCE.test(map.image))
        return undefined;
      const image = map.image;
      delete map.image;
      return image;
    });
  }
  let body = JSON.stringify(value);
  const refs = [...new Set(body.match(reference) || [])];
  /** @type {Map<string,string>} */
  const sources = new Map();
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
      sources.set(ref, image);
      body = body.split(ref).join(image);
    }
  }
  const result = refs.length ? JSON.parse(body) : value;
  if (kept.some(Boolean)) {
    const maps = /** @type {any[]} */ (liveMaps(result));
    kept.forEach((image, index) => {
      if (image && maps[index]) maps[index].image = image;
    });
  }
  const hydrated = await hydrateRoomResources(db, code, result);
  if (hydrated && typeof hydrated === "object")
    Object.defineProperty(hydrated, ROOM_IMAGE_SOURCES, { value: sources, configurable: true });
  return hydrated;
}
/**
 * One stored map image, only from this room's own rows (never by hash alone). Callers authorize
 * the seat against the projected room first (cloud.server.ts `authorizedRoomImage`).
 * @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {string} code @param {string} ref @returns {Promise<string | null>} */
export async function readRoomImage(db, code, ref) {
  if (!ROOM_IMAGE_REFERENCE.test(ref)) return null;
  const row = await db
    .prepare("SELECT image FROM campaign_room_images WHERE code=? AND reference=?")
    .bind(code, ref)
    .first();
  return typeof row?.image === "string" ? row.image : null;
}
/** Writes follow the room CAS in the same atomic D1 batch; a losing writer creates no assets.
 * @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {{code:string;revision:number}} room @param {{body:string;assets:{reference:string;image:string}[];documents?:{reference:string;body:string}[];reports?:{reference:string;body:string}[]}} encoded
 * @param {string} writeId the room write (room-storage.mjs) these rows depend on */
export async function roomImageStatements(db, room, encoded, writeId) {
  const committed = roomCommittedSql(room.code, writeId);
  const documents = [
    ...(await roomReportStatements(db, room, encoded, writeId)),
    ...(await roomResourceStatements(db, room, encoded, writeId)),
  ];
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
            `INSERT INTO campaign_room_images(code,reference,image) SELECT ?,?,? WHERE ${committed.sql} ON CONFLICT(code,reference) DO NOTHING`,
          )
          .bind(room.code, asset.reference, asset.image, ...committed.args),
      ),
  ];
}
