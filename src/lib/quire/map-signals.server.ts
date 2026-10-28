import { database, readRoom } from "./room-store.server.ts";
import { mapPingInput, PING_DURATION, type MapPing } from "./map-signals.ts";
import type { CloudRoom, CloudSeat, CloudTable } from "./cloud.ts";
import type { CampaignMap } from "./world-schema.ts";
import { mapAccessible, readMapTabletop, sceneViewers } from "./tabletop.ts";
import { scenePointVisible } from "./tabletop-geometry.ts";
import { expireMapPings } from "../../../cloudflare/map-ping-expiry.mjs";
// Development fallback only; deployed Workers require D1 via database().
const local = new Map<string, MapPing[]>();

/**
 * Everything a map signal needs to authorize and filter, and nothing more. The visibility helpers
 * (mapAccessible, sceneViewers, scenePointVisible) read only these fields of the table:
 * - journal.world.tabletop (player browsing / active map),
 * - the one map's id, visibility, grid, tokens and tabletop settings (fog, vision, walls, lights),
 * - character purses (id, kind) and their visibility (characterPositions[].visible, npcs[].visible).
 */
type SignalAccess = {
  revision: number;
  closed: boolean;
  viewOnly: boolean;
  sessionId: string;
  seats: CloudSeat[];
  map: CampaignMap | undefined;
  table: Pick<CloudTable, "journal" | "purses">;
};

/**
 * F6 (2026-10-28 load audit): one light D1 read instead of fetching and parsing the whole room
 * body on every 1–3 s signal poll. SQLite extracts the seats, the requested map without its art,
 * anchors or markers, and the few visibility fields, so the Worker receives a few KB at most.
 */
const ACCESS_QUERY = `SELECT r.revision AS revision,
  json_extract(r.body,'$.closed') AS closed,
  json_extract(r.body,'$.viewOnly') AS viewOnly,
  json_extract(r.body,'$.sessionId') AS sessionId,
  json_extract(r.body,'$.seats') AS seats,
  (SELECT json_remove(m.value,'$.image','$.anchors','$.markers','$.connected')
     FROM json_each(r.body,'$.table.journal.world.maps') m
     WHERE json_extract(m.value,'$.id')=?2 LIMIT 1) AS map,
  json_extract(r.body,'$.table.journal.world.tabletop') AS tabletop,
  (SELECT json_group_array(json_object('id',p.value->>'$.id','kind','character'))
     FROM json_each(r.body,'$.table.purses') p WHERE p.value->>'$.kind'='character') AS purses,
  (SELECT json_group_array(json_object('id',n.value->>'$.id','visible',n.value->'$.visible'))
     FROM json_each(r.body,'$.table.journal.world.npcs') n) AS npcs,
  (SELECT json_group_array(json_object('purseId',c.value->>'$.purseId','visible',c.value->'$.visible'))
     FROM json_each(r.body,'$.table.journal.world.characterPositions') c) AS positions
FROM campaign_rooms r WHERE r.code=?1`;

type AccessRow = {
  revision: number;
  closed: number | null;
  viewOnly: number | null;
  sessionId: string | null;
  seats: string | null;
  map: string | null;
  tabletop: string | null;
  purses: string | null;
  npcs: string | null;
  positions: string | null;
};
const list = (value: string | null) => {
  const parsed: unknown = value ? JSON.parse(value) : [];
  return Array.isArray(parsed) ? parsed : [];
};
async function readSignalAccess(code: string, mapId: string): Promise<SignalAccess | null> {
  const db = database();
  if (!db) {
    const room: CloudRoom | null = await readRoom(code);
    if (!room) return null;
    return {
      revision: room.revision,
      closed: !!room.closed,
      viewOnly: !!room.viewOnly,
      sessionId: room.sessionId || "",
      seats: room.seats,
      map: room.table.journal?.world?.maps.find((m) => m.id === mapId),
      table: room.table,
    };
  }
  const row = await db.prepare(ACCESS_QUERY).bind(code, mapId).first<AccessRow>();
  if (!row) return null;
  const seats = list(row.seats) as CloudSeat[];
  const tabletop: unknown = row.tabletop ? JSON.parse(row.tabletop) : undefined;
  const map = row.map ? (JSON.parse(row.map) as CampaignMap) : undefined;
  // A shape-compatible table with only the fields the visibility rules read.
  const table = {
    purses: list(row.purses),
    journal: {
      world: {
        maps: map ? [map] : [],
        npcs: list(row.npcs),
        characterPositions: list(row.positions),
        ...(tabletop === undefined ? {} : { tabletop }),
      },
    },
  } as unknown as Pick<CloudTable, "journal" | "purses">;
  return {
    revision: row.revision,
    closed: row.closed === 1,
    viewOnly: row.viewOnly === 1,
    sessionId: row.sessionId || "",
    seats,
    map,
    table,
  };
}

export async function mapSignals(input: {
  code: string;
  token: string;
  mapId: string;
  ping?: unknown;
}) {
  const code = input.code.trim().toUpperCase(),
    db = database();
  // Signals only need room authorization and map metadata, never image/document hydration.
  const room = await readSignalAccess(code, input.mapId);
  if (!room || room.closed) throw Error("This room is unavailable.");
  const seat = room.seats.find((s) => s.token === input.token);
  if (!seat) throw Error("This browser is not seated at that table.");
  const map = room.map;
  if (!map || map.id !== input.mapId || !mapAccessible(room.table as CloudTable, map, seat))
    throw Error("This map is unavailable.");
  const canSee = (point: { x: number; y: number }) =>
    seat.role === "dm" ||
    scenePointVisible(point, readMapTabletop(map), map.grid, sceneViewers(room.table, map, seat));
  const now = Date.now(),
    sessionId = room.sessionId;
  let ping: MapPing | undefined;
  if (input.ping !== undefined) {
    if (room.viewOnly) throw Error("Resume play before sending map pings.");
    const parsed = mapPingInput.parse(input.ping);
    if (parsed.mapId !== map.id) throw Error("The ping belongs to a different map.");
    if (!canSee(parsed)) throw Error("Choose a visible point to ping.");
    ping = { ...parsed, seatId: seat.id, createdAt: now, expiresAt: now + PING_DURATION };
  }
  if (db) {
    if (ping) {
      // Cleanup runs with writes (and the minute cron), never on the read path.
      await expireMapPings(db, now);
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
          room.revision,
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
        .filter(
          (p) => p.mapId === map.id && canSee(p) && room.seats.some((s) => s.id === p.seatId),
        ),
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
      (p) => p.mapId === map.id && canSee(p) && room.seats.some((s) => s.id === p.seatId),
    ),
  };
}
