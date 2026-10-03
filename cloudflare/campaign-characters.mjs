import { statsOnly, characterSheet } from "../src/lib/characters/campaign-sheet.mjs";
/** Upgrade only explicit existing assignments. Never match names or import wealth.
 * @param {any} db @param {import("../src/lib/quire/cloud.ts").CloudRoom} room */
export async function hydrateCampaignCharacters(db, room) {
  if (!room.table.purses.some((p) => p.kind === "character" && !p.sheet)) return room;
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
    p.portrait = body.portrait || undefined;
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
  if (!changed) return room;
  const base = room.revision++;
  const saved = await db
    .prepare("UPDATE campaign_rooms SET revision=?,body=? WHERE code=? AND revision=?")
    .bind(room.revision, JSON.stringify(room), room.code, base)
    .run();
  if (!saved.meta.changes)
    throw Object.assign(Error("Campaign changed while upgrading characters. Refresh and retry."), {
      status: 409,
    });
  return room;
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
