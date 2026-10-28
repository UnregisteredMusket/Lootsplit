import { ownedMapAsset, storedMapAsset } from "../src/lib/quire/map-assets.server.ts";
import { mapAssetRequestSchema, mapMediaReference } from "../src/lib/quire/map-assets-schema.ts";
import { canonicalJson } from "../src/lib/quire/canonical-json.ts";
import { projectRecord } from "../src/lib/quire/session-records.ts";
import { readArchivedSnapshot } from "../src/lib/quire/journal.ts";
import { hydrateRoomImages } from "./room-images.mjs";
import { readMemberRooms } from "./room-storage.mjs";

export function backupMapReferences(payload) {
  const refs = [];
  function read(table, depth = 0) {
    if (depth > 10) throw Error("The backup has too many nested archives.");
    for (const map of table?.journal?.world?.maps ?? [])
      refs.push(
        ...[
          map.tabletop?.media,
          ...(map.tabletop?.frames ?? []).map((frame) => frame.media),
        ].filter(Boolean),
      );
    for (const report of table?.journal?.reports ?? []) {
      let nested;
      try {
        nested = readArchivedSnapshot(report.snapshot);
      } catch {
        continue;
      }
      read(nested, depth + 1);
    }
  }
  read(payload);
  return [...new Map(refs.map((ref) => [ref.id, ref])).values()];
}
export async function validateBackupMapAssets(db, userId, payload) {
  for (const reference of backupMapReferences(payload)) {
    const asset = await storedMapAsset(userId, reference.id, db);
    if (
      !asset?.complete ||
      canonicalJson(mapMediaReference(asset.manifest)) !== canonicalJson(reference)
    )
      throw Object.assign(
        Error(
          "Upload the complete map artwork before saving this backup. Existing backups are retained.",
        ),
        { status: 400 },
      );
  }
}
/** Account handler authenticates/restriction-checks every call before this function. */
export async function accountMapAsset(db, userId, body) {
  const request = mapAssetRequestSchema.parse(body.request);
  let owner = userId;
  if (body.record) {
    if (!["manifest", "read"].includes(request.action))
      throw Object.assign(Error("Archived maps are read only."), { status: 403 });
    const [joined] = await readMemberRooms(db, userId, { code: body.record.code });
    const row = joined?.member;
    const room = joined ? await hydrateRoomImages(db, body.record.code, joined.stored.room) : null;
    const seat = [...(room?.seats ?? []), ...(room?.departed ?? [])].find(
      (seat) => seat.id === row?.seat_id && seat.token === row?.token,
    );
    if (!seat || seat.status === "banned" || room.blockedUsers?.[userId] === "banned")
      throw Object.assign(Error("This archive is unavailable."), { status: 404 });
    const report = room.table.journal?.reports?.find(
      (report) =>
        report.id === body.record.id && (!report.seatIds || report.seatIds.includes(seat.id)),
    );
    if (!report) throw Object.assign(Error("This archive is unavailable."), { status: 404 });
    const table = projectRecord(readArchivedSnapshot(report.snapshot), seat);
    const reference = backupMapReferences(table).find(
      (reference) => reference.id === request.assetId,
    );
    owner = room.ownerId;
    const asset = owner && reference ? await storedMapAsset(owner, request.assetId, db) : null;
    if (
      !asset?.complete ||
      canonicalJson(mapMediaReference(asset.manifest)) !== canonicalJson(reference)
    )
      throw Object.assign(Error("This archived map is unavailable."), { status: 404 });
  }
  return ownedMapAsset(owner, request, db);
}
