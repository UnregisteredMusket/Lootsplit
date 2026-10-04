import { projectRecord } from "../src/lib/quire/session-records.ts";
export async function campaignRecords(db, user) {
  const members = await db
    .prepare(
      "SELECT m.code,m.seat_id,m.token,m.name,r.body FROM library_members m JOIN campaign_rooms r ON r.code=m.code WHERE m.user_id=?",
    )
    .bind(user)
    .all();
  const reports = [];
  for (const m of members.results) {
    const room = JSON.parse(m.body);
    if (room.blockedUsers?.[user] === "banned") continue;
    const seat = [...room.seats, ...(room.departed || [])].find(
      (s) => s.id === m.seat_id && s.token === m.token,
    );
    if (!seat || seat.status === "banned") continue;
    for (const r of room.table.journal?.reports || []) {
      if (r.seatIds && !r.seatIds.includes(seat.id)) continue;
      reports.push({
        id: r.id,
        code: m.code,
        campaign: m.name,
        name: r.name,
        at: r.at,
        snapshot: projectRecord(JSON.parse(r.snapshot), seat),
      });
    }
  }
  return { reports };
}
