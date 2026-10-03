import test from "node:test";
import assert from "node:assert/strict";
import {
  blankSheet,
  sheetSchema,
  parseDice,
  throwDice,
  rollSpec,
} from "../src/lib/characters/model.mjs";
import { handleCharacterPlay } from "../cloudflare/character-play.mjs";
import { localAccountDb } from "./account-dev-db.mjs";
test("character calculations, dice validation and resource boundaries", () => {
  const s = blankSheet();
  s.scores.dex = 16;
  s.skills.Stealth = { rank: 2, extra: 1 };
  s.saves.dex = { rank: 1, extra: 0 };
  assert.equal(rollSpec(s, "skill", "Stealth").formula, "1d20+8");
  assert.equal(rollSpec(s, "save", "dex").formula, "1d20+5");
  assert.deepEqual(parseDice("2d6 + 3"), { count: 2, sides: 6, modifier: 3 });
  for (const bad of ["0d20", "99d6", "d0", "d1001", "1d20+9999", "1d20;alert(1)"])
    assert.throws(() => parseDice(bad));
  for (const mode of ["normal", "advantage", "disadvantage"]) {
    const r = throwDice("1d20+5", mode);
    assert.ok(r.total >= 6 && r.total <= 25);
    if (mode === "advantage") assert.equal(r.total, Math.max(...r.dice) + 5);
    if (mode === "disadvantage") assert.equal(r.total, Math.min(...r.dice) + 5);
  }
  assert.throws(() => throwDice("2d6", "advantage"));
  assert.equal(sheetSchema.safeParse({ ...s, hp: 99 }).success, false);
  assert.equal(
    sheetSchema.safeParse({
      ...s,
      resources: [{ name: "Ki", current: 3, max: 2, recovery: "short" }],
    }).success,
    false,
  );
});
test("account characters enforce ownership, campaign assignments, DM policy, stable rolls and history", async () => {
  const db = localAccountDb();
  const call = (user, path, body = {}) =>
    handleCharacterPlay(db, user, "sheets" + path, body, new URL("http://localhost/"));
  try {
    for (const user of ["player", "dm", "other"])
      await db
        .prepare(
          "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)",
        )
        .bind(user, user, user + "@example.com")
        .run();
    const room = {
      code: "PLAYTEST",
      revision: 1,
      live: true,
      turn: 0,
      seats: [
        { id: "pseat", token: "ptoken", role: "player", name: "Player", purseIds: ["purse"] },
        { id: "dmseat", token: "dmtoken", role: "dm", name: "DM", purseIds: [] },
      ],
      table: {
        ledger: [],
        sheets: [],
        purses: [
          {
            id: "purse",
            kind: "character",
            name: "Hero",
            coins: { cp: 0, sp: 0, ep: 0, gp: 7, pp: 0 },
          },
        ],
        holdings: [
          {
            id: "sword",
            purseId: "purse",
            name: "Sword",
            quantity: 1,
            kind: "item",
            unitCopper: 100,
            notes: "",
          },
        ],
      },
    };
    await db
      .prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,1,?)")
      .bind("PLAYTEST", JSON.stringify(room))
      .run();
    for (const [user, seat, token] of [
      ["player", "pseat", "ptoken"],
      ["dm", "dmseat", "dmtoken"],
    ])
      await db
        .prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)")
        .bind(user, "PLAYTEST", seat, token, "Test campaign")
        .run();
    const sheet = blankSheet();
    sheet.name = "Test hero";
    sheet.scores.str = 18;
    const { id } = await call("player", "/save", { sheet });
    assert.equal((await call("other", "")).characters.length, 0);
    assert.equal((await call("player", "")).userId, "player");
    await assert.rejects(call("other", "/detail", { id }), (e) => e.status === 404);
    await assert.rejects(
      call("other", "/save", { id, sheet, revision: 0 }),
      (e) => e.status === 404,
    );
    await call("player", "/save", { id, sheet, revision: 0 });
    await assert.rejects(
      call("player", "/save", { id, sheet, revision: 0 }),
      (e) => e.status === 409,
    );
    const solo = {
      id,
      revision: 1,
      kind: "ability",
      key: "str",
      requestKey: crypto.randomUUID(),
      bonus: 999,
    };
    const roll = await call("player", "/roll", solo);
    assert.equal(roll.modifier, 4);
    assert.equal(roll.source, "server");
    assert.deepEqual(await call("player", "/roll", solo), roll);
    await assert.rejects(call("dm", "/log", { id }), (e) => e.status === 404);
    await call("player", "/assign", { id, code: "PLAYTEST", purseId: "purse", revision: 1 });
    const d = await call("dm", "/detail", { id });
    assert.equal(d.editable, false);
    assert.equal(d.campaign.coins.gp, 7);
    const roster = await call("dm", "/campaign", { code: "PLAYTEST" });
    assert.deepEqual(roster.characters, [
      {
        id: `campaign:PLAYTEST:purse`,
        name: sheet.name,
        purseId: "purse",
        body: {
          name: sheet.name,
          portrait: sheet.portrait,
          classes: sheet.classes,
          level: sheet.level,
          hp: sheet.hp,
          maxHp: sheet.maxHp,
          ac: sheet.ac,
        },
      },
    ]);
    for (const viewer of ["player", "other"])
      await assert.rejects(
        call(viewer, "/campaign", { code: "PLAYTEST" }),
        (e) => e.status === 403,
      );
    await assert.rejects(call("dm", "/save", { id, sheet, revision: 2 }), (e) => e.status === 404);
    await assert.rejects(
      call("player", "/policy", { code: "PLAYTEST", allowed: true }),
      (e) => e.status === 403,
    );
    const manual = {
      id,
      revision: d.revision,
      kind: "ability",
      key: "str",
      manual: true,
      total: 19,
      requestKey: crypto.randomUUID(),
    };
    await assert.rejects(call("player", "/roll", manual), (e) => e.status === 403);
    await call("dm", "/policy", { code: "PLAYTEST", allowed: true });
    const m = await call("player", "/roll", manual);
    assert.equal(m.source, "manual");
    assert.deepEqual(m.dice, []);
    assert.equal(m.total, 19);
    await call("dm", "/policy", { code: "PLAYTEST", allowed: false });
    await assert.rejects(
      call("player", "/roll", { ...manual, requestKey: crypto.randomUUID() }),
      (e) => e.status === 403,
    );
    assert.equal((await call("dm", "/log", { code: "PLAYTEST" })).rolls.length, 1);
    assert.equal((await call("player", "/log", { id })).rolls.length, 1);
    await assert.rejects(call("other", "/log", { code: "PLAYTEST" }), (e) => e.status === 403);
    const duplicate = await call("player", "/save", { sheet });
    await assert.rejects(
      call("player", "/assign", {
        id: duplicate.id,
        code: "PLAYTEST",
        purseId: "purse",
        revision: 0,
      }),
      (e) => e.status === 409,
    );
    room.seats = room.seats.filter((s) => s.role === "dm");
    await db
      .prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
      .bind(JSON.stringify(room), "PLAYTEST")
      .run();
    await assert.rejects(
      call("player", "/roll", { ...solo, revision: 2, requestKey: crypto.randomUUID() }),
      (e) => e.status === 403,
    );
    await assert.rejects(call("player", "/log", { code: "PLAYTEST" }), (e) => e.status === 403);
    assert.ok((await call("player", "/detail", { id })).assignmentError);
    await call("player", "/assign", { id, code: "", purseId: "", revision: 2 });
    assert.equal((await call("player", "/detail", { id })).campaign, null);
    assert.equal((await call("dm", "/log", { code: "PLAYTEST" })).rolls.length, 1);
  } finally {
    db.close();
  }
});
