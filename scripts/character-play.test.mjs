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
test("account campaign NPC sheets share readonly stats and reject hidden sheets, guessed saves and rolls", async () => {
  const db = localAccountDb(),
    { readJournal } = await import("../src/lib/quire/journal.ts"),
    { emptyCloudTable } = await import("../src/lib/quire/cloud.ts");
  const call = (user, path, body = {}) =>
    handleCharacterPlay(db, user, "sheets" + path, body, new URL("http://localhost/"));
  try {
    for (const user of ["npc-player", "npc-dm"])
      await db
        .prepare(
          "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)",
        )
        .bind(user, user, user + "@example.com")
        .run();
    const room = {
      code: "NPCSHEET",
      revision: 1,
      live: true,
      turn: 0,
      seats: [
        {
          id: "player-seat",
          token: "player-token",
          role: "player",
          name: "Player",
          purseIds: ["hero"],
        },
        { id: "dm-seat", token: "dm-token", role: "dm", name: "DM", purseIds: [] },
      ],
      table: {
        ...emptyCloudTable(),
        purses: [
          {
            id: "hero",
            name: "Hero",
            kind: "character",
            coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
            sheet: { ...blankSheet(), name: "Hero" },
          },
          {
            id: "npc",
            name: "Scholar",
            kind: "character",
            control: "npc",
            coins: { cp: 0, sp: 0, ep: 0, gp: 99, pp: 0 },
            sheet: { ...blankSheet(), name: "Scholar", description: "Private NPC sheet" },
          },
        ],
        holdings: [
          {
            id: "gem",
            purseId: "npc",
            name: "Private gem",
            kind: "item",
            quantity: 1,
            unitCopper: 500,
            notes: "",
          },
        ],
        journal: readJournal({
          market: {
            currentLocationId: "region",
            locations: [
              { id: "region", name: "Region", kind: "region", parentId: null, description: "" },
            ],
          },
          world: {
            npcs: [
              {
                id: "npc",
                name: "Scholar",
                description: "Public record",
                locationId: "region",
                visible: true,
                barterAllowed: false,
                controllerPurseId: null,
              },
            ],
            characterPositions: [
              {
                purseId: "npc",
                inParty: true,
                locationId: null,
                visible: true,
                sheetVisible: true,
              },
            ],
          },
        }),
      },
    };
    await db
      .prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,1,?)")
      .bind(room.code, JSON.stringify(room))
      .run();
    for (const [user, seat, token] of [
      ["npc-player", "player-seat", "player-token"],
      ["npc-dm", "dm-seat", "dm-token"],
    ])
      await db
        .prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)")
        .bind(user, room.code, seat, token, "NPC sheets")
        .run();
    const id = `campaign:${room.code}:npc`,
      detail = await call("npc-player", "/detail", { id });
    assert.equal(detail.body.description, "Private NPC sheet");
    assert.equal(detail.editable, false);
    assert.equal(detail.campaign.editingAllowed, false);
    assert.equal(detail.body.coins.gp, 0);
    assert.deepEqual(detail.body.equipment, []);
    assert.deepEqual(detail.campaign.holdings, []);
    await assert.rejects(
      call("npc-player", "/save", { id, revision: 0, before: detail.body, sheet: detail.body }),
      (e) => e.status === 404,
    );
    await assert.rejects(
      call("npc-player", "/roll", {
        id,
        revision: 0,
        kind: "ability",
        key: "str",
        requestKey: crypto.randomUUID(),
      }),
      (e) => e.status === 403,
    );
    room.table.journal.world.characterPositions[0].sheetVisible = false;
    await db
      .prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
      .bind(JSON.stringify(room), room.code)
      .run();
    await assert.rejects(call("npc-player", "/detail", { id }), (e) => e.status === 404);
    assert.equal((await call("npc-dm", "/detail", { id })).body.description, "Private NPC sheet");
    assert.ok(!(await call("npc-player", "")).campaigns[0].purses.some((p) => p.id === "npc"));
  } finally {
    db.close();
  }
});
test("character calculations, dice validation and resource boundaries", () => {
  const s = blankSheet();
  s.scores.dex = 16;
  s.skills.Stealth = { rank: 2, extra: 1 };
  s.saves.dex = { rank: 1, extra: 0 };
  assert.equal(rollSpec(s, "skill", "Stealth").formula, "1d20+8");
  assert.equal(rollSpec(s, "save", "dex").formula, "1d20+5");
  assert.deepEqual(parseDice("2d6 + 3"), { count: 2, sides: 6, modifier: 3 });
  assert.deepEqual(throwDice("5"), {
    count: 0,
    sides: 0,
    modifier: 5,
    dice: [],
    mode: "normal",
    total: 5,
  });
  assert.throws(() => throwDice("5", "advantage"));
  assert.throws(() => parseDice("1001"));
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
    for (const change of ["denial", "sheet", "session"]) {
      const key = crypto.randomUUID();
      await call("player", "/assign", { id, code: "PLAYTEST", purseId: "purse", revision: 1, requestKey: key });
      await assert.rejects(call("other", "/imports", { code: "PLAYTEST" }), (e) => e.status === 403);
      if (change === "sheet") room.table.purses[0].sheetRevision = 1;
      if (change === "session") room.sessionId = "new-session";
      if (change !== "denial") {
        await db.prepare("UPDATE campaign_rooms SET body=? WHERE code=?").bind(JSON.stringify(room), "PLAYTEST").run();
        await assert.rejects(call("dm", "/review-import", { id: key, decision: "approved" }), (e) => e.status === 409);
      }
      await call("dm", "/review-import", { id: key, decision: "denied" });
      assert.equal((await call("player", "/detail", { id })).campaign, null);
    }
    const requestKey = crypto.randomUUID();
    const assignment = { id, code: "PLAYTEST", purseId: "purse", revision: 1, requestKey };
    assert.equal((await call("player", "/assign", assignment)).pending, true);
    assert.equal((await call("player", "/assign", assignment)).pending, true);
    assert.equal((await call("player", "/detail", { id })).campaign, null);
    const importRequest = (await call("dm", "/imports", { code: "PLAYTEST" })).requests.find((r) => r.id === requestKey);
    assert.equal(importRequest.id, requestKey);
    assert.equal(importRequest.seat_token, undefined);
    const campaignTarget = await call("dm", "/detail", {
      id: `campaign:PLAYTEST:${importRequest.purse_id}`,
    });
    assert.equal(
      campaignTarget.body.name,
      "Hero",
      "Review reads the authorized campaign target, not the submitted account source",
    );
    assert.equal(importRequest.target_revision, campaignTarget.revision);
    assert.equal(importRequest.source_revision, assignment.revision);
    assert.equal(importRequest.body.name, sheet.name);

    await assert.rejects(call("player", "/review-import", { id: requestKey, decision: "approved" }), (e) => e.status === 403);
    // A concurrent financial change is retained by approval.
    room.table.purses[0].coins.gp = 9;
    await db.prepare("UPDATE campaign_rooms SET body=? WHERE code=?").bind(JSON.stringify(room), "PLAYTEST").run();
    await call("dm", "/review-import", { id: requestKey, decision: "approved" });
    const approved = (await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind("PLAYTEST").first()).body;
    await call("dm", "/review-import", { id: requestKey, decision: "approved" });
    assert.equal((await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind("PLAYTEST").first()).body, approved);
    await assert.rejects(call("dm", "/review-import", { id: requestKey, decision: "denied" }), (e) => e.status === 409);
    const d = await call("dm", "/detail", { id });
    assert.equal(d.editable, false);
    assert.equal(d.campaign.coins.gp, 9);
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
    Object.assign(
      room,
      JSON.parse(
        (await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind("PLAYTEST").first())
          .body,
      ),
    );
    room.viewOnly = true;
    await db.prepare("UPDATE campaign_rooms SET body=? WHERE code=?").bind(JSON.stringify(room), "PLAYTEST").run();
    assert.equal((await call("player", "/detail", { id })).body.name, "Test hero");
    assert.equal((await call("player", "/log", { id })).rolls.length, 1);
    await assert.rejects(call("player", "/save", { id, sheet, revision: d.revision }), /view-only/);
    await assert.rejects(call("player", "/roll", { ...solo, revision: d.revision, requestKey: crypto.randomUUID() }), /view-only/);
    room.viewOnly = false;
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
    await assert.rejects(call("player", "/detail", { id }), (e) => e.status === 403);
    assert.equal(
      (await call("player", "")).characters.some((r) => r.id === id),
      false,
    );
    await assert.rejects(
      call("player", "/assign", { id, code: "", purseId: "", revision: 2 }),
      (e) => e.status === 403,
    );
    assert.equal((await call("dm", "/log", { code: "PLAYTEST" })).rolls.length, 1);
  } finally {
    db.close();
  }
});
