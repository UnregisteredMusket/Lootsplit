import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { linkAccountSeat } from "../cloudflare/accounts.mjs";
import { readRoom, updateRoom } from "../src/lib/quire/room-store.server.ts";

const room = (code) => ({
  code,
  revision: 1,
  closed: false,
  live: true,
  turn: 0,
  seats: [
    { id: "dm", token: `${code}-dm-token`, name: "DM", role: "dm", purseIds: [] },
    { id: "player", token: `${code}-player-token`, name: "Player", role: "player", purseIds: ["hero"] },
  ],
  table: {
    purses: [
      { id: "hero", name: "Hero", kind: "character", coins: { cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 } },
    ],
    holdings: [],
    ledger: [],
    shops: [],
    stock: [],
    listings: [],
    loans: [],
    sheets: [],
    notes: [],
  },
  seen: { gifts: [], sales: [] },
});

async function withRoom(code, run) {
  const DB = localAccountDb();
  globalThis.__env__ = { DB };
  try {
    for (const id of ["dm-user", "player-user"])
      await DB.prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)",
      )
        .bind(id, id, `${id}@example.com`)
        .run();
    await DB.prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,1,?)")
      .bind(code, JSON.stringify(room(code)))
      .run();
    await run(DB);
  } finally {
    delete globalThis.__env__;
    DB.close();
  }
}

for (const [role, token, user] of [
  ["DM", "dm-token", "dm-user"],
  ["player", "player-token", "player-user"],
]) {
  test(`linking the ${role} seat bumps the room revision so a stale room write cannot erase it`, async () => {
    const code = role === "DM" ? "LINKDM12" : "LINKPL12";
    await withRoom(code, async (DB) => {
      const stale = await readRoom(code);
      assert.equal(stale.revision, 1);
      await linkAccountSeat(DB, user, { code, token: `${code}-${token}`, name: "Game" });
      const row = await DB.prepare("SELECT revision,body FROM campaign_rooms WHERE code=?")
        .bind(code)
        .first();
      const linked = JSON.parse(row.body);
      assert.equal(row.revision, 2, "the revision column must change with the body");
      assert.equal(linked.revision, 2, "the stored body revision must match the column");
      // A poller holding knownRevision=1 must see the link.
      assert.notEqual((await readRoom(code)).revision, stale.revision);
      // A request that loaded the room before the link must not overwrite it.
      stale.turn = 1;
      stale.revision++;
      await assert.rejects(updateRoom(stale, 1), /table changed/);
      const after = await readRoom(code);
      const seat = after.seats.find((s) => s.token === `${code}-${token}`);
      assert.equal(seat.userId, user);
      if (role === "DM") assert.equal(after.ownerId, user);
      else assert.equal(after.ownerId, undefined);
      const member = await DB.prepare("SELECT seat_id FROM library_members WHERE user_id=? AND code=?")
        .bind(user, code)
        .first();
      assert.equal(member?.seat_id, seat.id);
      // A fresh read can still commit normally after the link.
      after.turn = 1;
      const base = after.revision++;
      await updateRoom(after, base);
      assert.equal((await readRoom(code)).seats.find((s) => s.id === seat.id).userId, user);
    });
  });
}

test("a link that races another room write fails cleanly instead of overwriting it", async () => {
  const code = "LINKRACE";
  await withRoom(code, async (DB) => {
    const original = DB.prepare.bind(DB);
    let raced = false;
    // Commit a competing write between the link's read and its conditional update.
    DB.prepare = (sql) => {
      if (!raced && /^UPDATE campaign_rooms/.test(sql)) {
        raced = true;
        const competing = room(code);
        competing.revision = 2;
        competing.turn = 1;
        original("UPDATE campaign_rooms SET revision=2,body=? WHERE code=?")
          .bind(JSON.stringify(competing), code)
          .run();
      }
      return original(sql);
    };
    await assert.rejects(
      linkAccountSeat(DB, "dm-user", { code, token: `${code}-dm-token`, name: "Game" }),
      (e) => e.status === 409,
    );
    DB.prepare = original;
    const row = await DB.prepare("SELECT revision,body FROM campaign_rooms WHERE code=?").bind(code).first();
    assert.equal(row.revision, 2);
    assert.equal(JSON.parse(row.body).turn, 1);
    assert.equal(JSON.parse(row.body).seats[0].userId, undefined);
    assert.equal(
      await DB.prepare("SELECT 1 FROM library_members WHERE code=?").bind(code).first(),
      null,
    );
  });
});

test("relinking an already linked seat refreshes the membership without a room write", async () => {
  const code = "RELINK12";
  await withRoom(code, async (DB) => {
    const token = `${code}-player-token`;
    await linkAccountSeat(DB, "player-user", { code, token, name: "Game" });
    const linked = await DB.prepare("SELECT revision,body FROM campaign_rooms WHERE code=?")
      .bind(code)
      .first();
    assert.equal(linked.revision, 2);
    await linkAccountSeat(DB, "player-user", { code, token, name: "Renamed game" });
    const relinked = await DB.prepare("SELECT revision,body FROM campaign_rooms WHERE code=?")
      .bind(code)
      .first();
    assert.deepEqual(relinked, linked, "a no-op link must not change the room or its revision");
    const member = await DB.prepare("SELECT name FROM library_members WHERE user_id=? AND code=?")
      .bind("player-user", code)
      .first();
    assert.equal(member.name, "Renamed game");
    // Another account still cannot take the linked seat.
    await assert.rejects(
      linkAccountSeat(DB, "dm-user", { code, token, name: "Game" }),
      (e) => e.status === 409,
    );
    // A no-op relink that races a room change still refuses to write the membership.
    const original = DB.prepare.bind(DB);
    let raced = false;
    DB.prepare = (sql) => {
      if (!raced && /^INSERT INTO library_members/.test(sql)) {
        raced = true;
        const r = JSON.parse(linked.body);
        r.revision = 3;
        r.turn = 1;
        original("UPDATE campaign_rooms SET revision=3,body=? WHERE code=?")
          .bind(JSON.stringify(r), code)
          .run();
      }
      return original(sql);
    };
    await assert.rejects(
      linkAccountSeat(DB, "player-user", { code, token, name: "Raced name" }),
      (e) => e.status === 409,
    );
    DB.prepare = original;
    const after = await DB.prepare("SELECT name FROM library_members WHERE user_id=? AND code=?")
      .bind("player-user", code)
      .first();
    assert.equal(after.name, "Renamed game");
  });
});
