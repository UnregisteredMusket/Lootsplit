import { roleOf, staffCommitGuard } from "./members.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";
const fail = (m, status = 400) => {
  throw Object.assign(Error(m), { status });
};
export async function ownerTestMode(db, user, body, sessionId) {
  if ((await roleOf(db, user)) !== "owner")
    fail("Test mode is available only to the site owner.", 403);
  if (body.action === "create") {
    const count = Number(body.characters ?? 4),
      gp = Number(body.gold ?? 100),
      hp = Number(body.hp ?? 20);
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 12 ||
      !Number.isSafeInteger(gp) ||
      gp < 0 ||
      gp > 1000000 ||
      !Number.isInteger(hp) ||
      hp < 1 ||
      hp > 9999
    )
      fail("Choose 1–12 characters, 0–1,000,000 gold and 1–9,999 HP.");
    const code = "T" + crypto.randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase(),
      token = crypto.randomUUID(),
      seatId = crypto.randomUUID();
    const table = {
      purses: Array.from({ length: count }, (_, i) => {
        const sheet = blankSheet();
        sheet.name = "Test adventurer " + (i + 1);
        sheet.hp = sheet.maxHp = hp;
        return {
          id: crypto.randomUUID(),
          name: sheet.name,
          kind: "character",
          control: "player",
          coins: { cp: 0, sp: 0, ep: 0, gp, pp: 0 },
          sheet,
        };
      }),
      holdings: [],
      shops: [
        {
          id: "test-shop",
          name: "Test merchant",
          keeper: "Test keeper",
          place: "Sandbox",
          notes: "",
          sellRate: 1,
          buyRate: 0.5,
          wealth: "modest",
          category: "mixed",
          priceScale: 1,
        },
      ],
      stock: [
        {
          id: "test-potion",
          shopId: "test-shop",
          name: "Potion of healing",
          copper: 5000,
          baseCopper: 5000,
          quantity: 20,
          notes: "",
          rarity: "common",
          category: "apothecary",
          service: false,
        },
        {
          id: "test-service",
          shopId: "test-shop",
          name: "Room for the night",
          copper: 100,
          baseCopper: 100,
          quantity: null,
          notes: "Service",
          rarity: "common",
          category: "inn",
          service: true,
        },
      ],
      ledger: [],
      listings: [],
      loans: [],
      sheets: [],
      notes: [],
      journal: { sessions: [], events: [], requests: [] },
    };
    const room = {
      code,
      revision: 1,
      turn: 0,
      live: true,
      testMode: true,
      testTemplate: table,
      seats: [{ id: seatId, token, name: "Owner", role: "dm", purseIds: [] }],
      table,
      seen: { gifts: [], sales: [] },
    };
    const guard = await staffCommitGuard(db, user, sessionId, ["owner"]);
    const results = await db.batch([
      db
        .prepare(`INSERT INTO campaign_rooms(code,revision,body) SELECT ?,1,? WHERE ${guard.sql}`)
        .bind(code, JSON.stringify(room), ...guard.binds),
      db
        .prepare(
          "INSERT INTO library_members(user_id,code,seat_id,token,name,archived,updated_at) SELECT ?,?,?,?,?,0,? WHERE EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?)",
        )
        .bind(user, code, seatId, token, "Test mode", Date.now(), code, JSON.stringify(room)),
    ]);
    if (!results[0].meta.changes)
      fail("Owner access changed. Sign in again before creating a Test room.", 409);
    return { userId: user, code, token, seatId, role: "dm", purseIds: [], name: "Test mode" };
  }
  if (body.action !== "reset") fail("Invalid Test mode action.");
  const m = await db
    .prepare("SELECT * FROM library_members WHERE user_id=? AND code=?")
    .bind(user, body.code)
    .first();
  const row = await db
    .prepare("SELECT body FROM campaign_rooms WHERE code=?")
    .bind(body.code)
    .first();
  const room = row ? JSON.parse(row.body) : null;
  if (
    !room?.testMode ||
    room.closed ||
    !room.seats.some((s) => s.role === "dm" && s.id === m?.seat_id && s.token === m?.token)
  )
    fail("An active owner Test room is required.", 403);
  if (Object.values(room.drafts || {}).some((d) => d.length))
    fail("Resolve pending actions before resetting the Test room.", 409);
  if (room.revision !== body.revision)
    fail("The Test room changed. Refresh before resetting.", 409);
  room.table = structuredClone(room.testTemplate);
  room.revision++;
  room.commands = [];
  room.batches = [];
  room.drafts = {};
  room.departed = [];
  room.invitations = {};
  room.blockedUsers = {};
  const next = JSON.stringify(room);
  const guard = await staffCommitGuard(db, user, sessionId, ["owner"]);
  const results = await db.batch([
    db
      .prepare(
        `UPDATE campaign_rooms SET body=?,revision=? WHERE code=? AND body=? AND ${guard.sql}`,
      )
      .bind(next, room.revision, room.code, row.body, ...guard.binds),
    db
      .prepare(
        "DELETE FROM play_rolls WHERE code=? AND EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?)",
      )
      .bind(room.code, room.code, next),
    db
      .prepare(
        "DELETE FROM dm_encounters WHERE code=? AND EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?)",
      )
      .bind(room.code, room.code, next),
  ]);
  if (!results[0].meta.changes) fail("The Test room changed. Retry the reset.", 409);
  return { ok: true };
}
