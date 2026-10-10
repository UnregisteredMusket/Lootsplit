import { database, readRoom } from "./room-store.server.ts";
import { mapPingInput, PING_DURATION, type MapPing } from "./map-signals.ts";
import type { CloudRoom } from "./cloud.ts";
// Development fallback only; deployed Workers require D1 via database().
const local = new Map<string, MapPing[]>();
export async function mapSignals(input: {
  code: string;
  token: string;
  mapId: string;
  ping?: unknown;
}) {
  const code = input.code.trim().toUpperCase(),
    db = database();
  // Signals only need room authorization and map metadata, never image/document hydration.
  const row = db
    ? await db
        .prepare("SELECT body,revision FROM campaign_rooms WHERE code=?")
        .bind(code)
        .first<{ body: string; revision: number }>()
    : null;
  const room: CloudRoom | null = db ? (row ? JSON.parse(row.body) : null) : await readRoom(code);
  if (!room || room.closed) throw Error("This room is unavailable.");
  const seat = room.seats.find((s) => s.token === input.token);
  if (!seat) throw Error("This browser is not seated at that table.");
  const map = room.table.journal?.world?.maps.find((m) => m.id === input.mapId);
  if (!map || (seat.role !== "dm" && !map.visible)) throw Error("This map is unavailable.");
  const now = Date.now(),
    sessionId = room.sessionId || "";
  let ping: MapPing | undefined;
  if (input.ping !== undefined) {
    if (room.viewOnly) throw Error("Resume play before sending map pings.");
    const parsed = mapPingInput.parse(input.ping);
    if (parsed.mapId !== map.id) throw Error("The ping belongs to a different map.");
    ping = { ...parsed, seatId: seat.id, createdAt: now, expiresAt: now + PING_DURATION };
  }
  if (db) {
    // Delete only expired ephemeral signals, across rooms. No campaign revision changes.
    await db.prepare("DELETE FROM campaign_map_pings WHERE expires_at<=?").bind(now).run();
    if (ping) {
      const result = await db
        .prepare(
          `INSERT INTO campaign_map_pings(code,id,session_id,seat_id,body,created_at,expires_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND revision=?)
        AND NOT EXISTS(SELECT 1 FROM campaign_map_pings WHERE code=? AND seat_id=? AND created_at>?)
        ON CONFLICT(code,id) DO NOTHING`,
        )
        .bind(
          code,
          ping.id,
          sessionId,
          seat.id,
          JSON.stringify(ping),
          now,
          ping.expiresAt,
          code,
          row!.revision,
          code,
          seat.id,
          now - 500,
        )
        .run();
      if (!result.meta.changes)
        throw Error("Wait a moment, then try a new ping. If the room changed, refresh it.");
    }
    const rows = await db
      .prepare(
        "SELECT body FROM campaign_map_pings WHERE code=? AND session_id=? AND expires_at>? AND json_extract(body,'$.mapId')=? ORDER BY created_at DESC LIMIT 100",
      )
      .bind(code, sessionId, now, map.id)
      .all<{ body: string }>();
    return {
      serverNow: now,
      pings: rows.results
        .map((r) => JSON.parse(r.body) as MapPing)
        .filter((p) => p.mapId === map.id && room.seats.some((s) => s.id === p.seatId)),
    };
  }
  for (const [key, pings] of local) {
    const active = pings.filter((p) => p.expiresAt > now);
    if (active.length) local.set(key, active);
    else local.delete(key);
  }
  const key = `${code}:${sessionId}`,
    active = local.get(key) || [];
  if (ping) {
    if (active.some((p) => p.seatId === seat.id && p.createdAt > now - 500))
      throw Error("Wait a moment before sending another ping.");
    local.set(key, [...active, ping].slice(-100));
  }
  return {
    serverNow: now,
    pings: (local.get(key) || []).filter(
      (p) => p.mapId === map.id && room.seats.some((s) => s.id === p.seatId),
    ),
  };
}
