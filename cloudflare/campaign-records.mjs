import { hydrateRoomImages } from "./room-images.mjs";
import { readMemberRooms } from "./room-storage.mjs";
import { readArchivedSnapshot } from "../src/lib/quire/journal.ts";
import { projectRecord } from "../src/lib/quire/session-records.ts";
export async function campaignRecords(db, user) {
  const members = await readMemberRooms(db, user);
  const reports = [];
  for (const { member: m, stored } of members) {
    const room = await hydrateRoomImages(db,m.code,stored.room);
    if (room.blockedUsers?.[user] === "banned") continue;
    const seat = [...room.seats, ...(room.departed || [])].find(
      (s) => s.id === m.seat_id && s.token === m.token,
    );
    if (!seat || seat.status === "banned") continue;
    for (const r of room.table.journal?.reports || []) {
      if (r.seatIds && !r.seatIds.includes(seat.id)) continue;
      let snapshot, error;
      try { snapshot = projectRecord(readArchivedSnapshot(r.snapshot), seat); }
      catch { error = "This archived report cannot be read. Keep its original backup for recovery."; }
      reports.push({
        id: r.id,
        code: m.code,
        campaign: m.name,
        name: r.name,
        at: r.at,
        snapshot, ...(error ? { error } : {}),
      });
    }
  }
  return { reports };
}
