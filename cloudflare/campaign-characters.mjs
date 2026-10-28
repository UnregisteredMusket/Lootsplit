import { statsOnly, characterSheet } from "../src/lib/characters/campaign-sheet.mjs";
import { roomWriteStatements } from "./room-storage.mjs";
/** Upgrade only explicit existing assignments. Never match names or import wealth.
 * @param {any} db @param {import("../src/lib/quire/cloud.ts").CloudRoom} room */
export async function hydrateCampaignCharacters(db, room) {
  return (await hydrateStoredCampaignCharacters(db, room, null)).room;
}
/**
 * `hydrateCampaignCharacters` for a stored read: also returns the room's version after the
 * upgrade (`version` unchanged when nothing was upgraded).
 * @template V
 * @param {any} db @param {import("../src/lib/quire/cloud.ts").CloudRoom} room @param {V} version
 * @returns {Promise<{ room: import("../src/lib/quire/cloud.ts").CloudRoom; version: V | import("./room-storage.mjs").RoomVersion }>}
 */
export async function hydrateStoredCampaignCharacters(db, room, version) {
  if (room.closed) return { room, version };
  if (!room.table.purses.some((p) => p.kind === "character" && !p.sheet)) return { room, version };
  const rows = await db
    .prepare("SELECT id,body,purse_id,user_id FROM play_characters WHERE campaign_code=?")
    .bind(room.code)
    .all();
  let changed = false;
  for (const r of rows.results) {
    const p = room.table.purses.find(
      (p) => p.id === r.purse_id && p.kind === "character" && !p.sheet,
    );
    if (!p) continue;
    const body = JSON.parse(r.body);
    p.sheet = statsOnly(body);
    p.name = body.name;
    p.portrait = p.portrait || body.portrait || undefined;
    p.sheet.portrait = p.portrait || "";
    p.profileId = r.id;
    const owner = await db
      .prepare("SELECT seat_id,token FROM library_members WHERE user_id=? AND code=?")
      .bind(r.user_id, room.code)
      .first();
    p.sheetReadOnlyForDm = !room.seats.some(
      (s) => s.id === owner?.seat_id && s.token === owner?.token && s.role === "dm",
    );
    p.sheetRevision = 0;
    changed = true;
  }
  if (!changed) return { room, version };
  const base = room.revision++;
  const write = roomWriteStatements(db, room, { expect: { revision: base } });
  const saved = await write.statements[0].run();
  if (!saved.meta.changes)
    throw Object.assign(Error("Campaign changed while upgrading characters. Refresh and retry."), {
      status: 409,
    });
  return { room, version: write.version };
}
/** @param {import("../src/lib/quire/cloud.ts").CloudRoom} room @param {string} purseId */
export function campaignBody(room, purseId) {
  const p = room.table.purses.find((p) => p.id === purseId);
  if (!p) throw Object.assign(Error("Campaign character no longer exists."), { status: 403 });
  return characterSheet(
    p,
    room.table.holdings,
    room.table.sheets.find((s) => s.purseId === p.id),
  );
}
