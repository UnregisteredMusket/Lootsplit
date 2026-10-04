import test from "node:test";
import assert from "node:assert/strict";
import { handleEncounters } from "../cloudflare/encounters.mjs";
import {
  blankEncounter,
  blankCombatant,
  blankLoot,
  encounterSchema,
  estimate,
  multiplier,
  generateEncounter,
  nextTurn,
} from "../src/lib/encounters/model.mjs";
import { localAccountDb } from "./account-dev-db.mjs";
async function fixture() {
  const db = localAccountDb();
  for (const user of ["dm", "player", "stranger"])
    await db
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)",
      )
      .bind(user, user, user + "@example.com")
      .run();
  const room = {
    code: "BATTLE",
    revision: 1,
    turn: 0,
    live: true,
    seats: [
      { id: "dmseat", token: "dm-token", role: "dm", name: "DM", purseIds: [] },
      { id: "playerseat", token: "player-token", role: "player", name: "Hero", purseIds: ["hero"] },
    ],
    table: {
      purses: [
        {
          id: "party",
          name: "Party fund",
          kind: "party",
          coins: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
        },
        {
          id: "hero",
          name: "Hero",
          kind: "character",
          coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        },
      ],
      holdings: [],
      ledger: [],
      shops: [],
      stock: [],
      notes: [],
      sheets: [],
      loans: [],
      listings: [],
    },
    drafts: {},
    seen: { gifts: [], sales: [] },
  };
  await db
    .prepare("INSERT INTO campaign_rooms VALUES (?,1,?)")
    .bind("BATTLE", JSON.stringify(room))
    .run();
  for (const u of ["dm", "player"])
    await db
      .prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)")
      .bind(u, "BATTLE", u + "seat", u + "-token", "Battle")
      .run();
  const call = (user, path, body = {}) => handleEncounters(db, user, "encounters" + path, body);
  const id = crypto.randomUUID();
  await call("dm", "/create", { id, code: "BATTLE" });
  return { db, call, id, room };
}
test("encounter estimates, generators, turn order and schema boundaries", () => {
  const e = blankEncounter();
  e.combatants = [
    { ...blankCombatant(), xp: 50, initiative: 10 },
    { ...blankCombatant(), xp: 50, initiative: 18 },
  ];
  assert.equal(estimate(e).adjusted, 150);
  assert.equal(multiplier(1, 6), 0.5);
  assert.equal(multiplier(15, 2), 5);
  assert.equal(nextTurn(e).activeId, e.combatants[1].id);
  const turn = nextTurn(nextTurn(nextTurn(e)));
  assert.equal(turn.round, 2);
  const filters = {
    partySize: 4,
    level: 1,
    difficulty: "medium",
    mode: "difficulty",
    cr: 1,
    count: 2,
    enemy: "",
    environment: "",
  };
  const generated = generateEncounter([{ ...blankCombatant(), cr: 1, xp: 200 }], filters, () => 0);
  assert.equal(generated.length, 1);
  assert.equal(
    generateEncounter(
      [{ ...blankCombatant(), cr: 0.25, xp: 50 }],
      { ...filters, mode: "cr", cr: 0.25 },
      () => 0,
    ).length,
    2,
  );
  assert.throws(() => generateEncounter([], filters));
  assert.throws(() => generateEncounter(e.combatants, { ...filters, level: 0 }));
  assert.equal(
    encounterSchema.safeParse({ ...e, combatants: [{ ...e.combatants[0], hp: 100, maxHp: 10 }] })
      .success,
    false,
  );
  assert.equal(
    encounterSchema.safeParse({ ...e, combatants: [e.combatants[0], e.combatants[0]] }).success,
    false,
  );
});
test("DM-only account persistence, stale drafts, manual rolls and campaign revocation", async () => {
  const { db, call, id } = await fixture();
  try {
    assert.equal((await call("dm", "")).encounters.length, 1);
    assert.equal((await call("player", "")).encounters.length, 0);
    for (const who of ["player", "stranger"]) {
      await assert.rejects(
        call(who, "/create", { id: crypto.randomUUID(), code: "BATTLE" }),
        (e) => e.status === 403,
      );
      for (const path of ["/detail", "/save", "/roll", "/conclude", "/award", "/log"])
        await assert.rejects(call(who, path, { id, revision: 0 }), (e) => e.status === 404);
    }
    const e = blankEncounter();
    e.name = "Saved ambush";
    await call("dm", "/save", { id, revision: 0, encounter: e });
    await assert.rejects(
      call("dm", "/save", { id, revision: 0, encounter: e }),
      (e) => e.status === 409,
    );
    assert.equal((await call("dm", "/detail", { id })).body.name, "Saved ambush");
    const roll = {
      id,
      revision: 1,
      formula: "1d20+3",
      manual: true,
      total: 18,
      requestKey: crypto.randomUUID(),
    };
    assert.equal((await call("dm", "/roll", roll)).source, "manual");
    await call("dm", "/roll", roll);
    assert.equal((await call("dm", "/log", { id })).rolls.length, 1);
    await assert.rejects(
      call("dm", "/roll", { ...roll, requestKey: crypto.randomUUID(), total: null }),
    );
    const auto = await call("dm", "/roll", {
      ...roll,
      requestKey: crypto.randomUUID(),
      manual: false,
    });
    assert.equal(auto.source, "server");
    assert.ok(auto.total >= 4 && auto.total <= 23);
    await db.prepare("UPDATE library_members SET token='revoked' WHERE user_id='dm'").run();
    for (const p of ["/detail", "/save", "/award", "/roll"])
      await assert.rejects(call("dm", p, { id, revision: 1 }), (e) => e.status === 403);
  } finally {
    db.close();
  }
});
test("loot tables resolve once, review precedes atomic award, and retries cannot duplicate inventory", async () => {
  const { db, call, id } = await fixture();
  try {
    const e = blankEncounter();
    e.loot = [{ ...blankLoot(), name: "Sword", purseId: "hero" }];
    e.coins.gp = 25;
    e.coinPurseId = "party";
    e.tables = [
      {
        id: "table",
        name: "Cache",
        entries: [{ weight: 1, loot: { ...blankLoot(), name: "Gem", purseId: "party" } }],
        selected: null,
      },
    ];
    await call("dm", "/save", { id, revision: 0, encounter: e });
    await assert.rejects(call("dm", "/award", { id, revision: 1 }));
    await assert.rejects(call("dm", "/conclude", { id, revision: 1 }));
    const draw = await call("dm", "/roll", {
      id,
      revision: 1,
      tableId: "table",
      requestKey: crypto.randomUUID(),
    });
    assert.equal(draw.selected, 0);
    const physical = { id, revision: 1, tableId: "table", manual: true, total: 1, requestKey: crypto.randomUUID() };
    const manualDraw = await call("dm", "/roll", physical);
    assert.equal(manualDraw.source, "manual");
    assert.deepEqual(manualDraw.dice, []);
    assert.equal(manualDraw.selected, 0);
    assert.deepEqual(await call("dm", "/roll", physical), manualDraw);
    await assert.rejects(call("dm", "/roll", { ...physical, total: 2, requestKey: crypto.randomUUID() }), /physical table total/);
    e.tables[0].selected = draw.selected;
    await call("dm", "/save", { id, revision: 1, encounter: e });
    await call("dm", "/conclude", { id, revision: 2 });
    const review = await call("dm", "/detail", { id });
    assert.equal(review.status, "review");
    assert.equal(review.body.loot.length, 2);
    assert.equal(review.body.loot[1].sourceTableId, "table");
    const before = JSON.parse(
      (await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind("BATTLE").first())
        .body,
    );
    assert.equal(before.table.holdings.length, 0);
    const award = await call("dm", "/award", { id, revision: 3 });
    const retry = await call("dm", "/award", { id, revision: 3 });
    assert.equal(award.award.receiptId, retry.award.receiptId);
    assert.equal(retry.duplicate, true);
    const after = await db
      .prepare("SELECT * FROM campaign_rooms WHERE code=?")
      .bind("BATTLE")
      .first();
    const room = JSON.parse(after.body);
    assert.equal(room.table.purses[0].coins.gp, 35);
    assert.equal(room.table.holdings.length, 2);
    assert.equal(room.table.ledger.length, 3);
    assert.equal(after.revision, 2);
    assert.equal(room.revision, 2);
    await assert.rejects(
      call("dm", "/save", { id, revision: 4, encounter: e }),
      (e) => e.status === 409,
    );
    assert.equal((await call("dm", "/detail", { id })).status, "awarded");
  } finally {
    db.close();
  }
});
test("invalid recipients, pending turns and lost DM turn cannot mutate campaign funds", async () => {
  const { db, call, id, room } = await fixture();
  try {
    const e = blankEncounter();
    e.coins.gp = 10;
    e.coinPurseId = "missing";
    await call("dm", "/save", { id, revision: 0, encounter: e });
    await call("dm", "/conclude", { id, revision: 1 });
    await assert.rejects(call("dm", "/award", { id, revision: 2 }));
    e.coinPurseId = "party";
    await call("dm", "/save", { id, revision: 2, encounter: e });
    room.drafts = { playerseat: [{}] };
    await db
      .prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
      .bind(JSON.stringify(room), "BATTLE")
      .run();
    await assert.rejects(call("dm", "/award", { id, revision: 3 }), (e) => e.status === 409);
    room.drafts = {};
    room.live = false;
    room.turn = 1;
    await db
      .prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
      .bind(JSON.stringify(room), "BATTLE")
      .run();
    await assert.rejects(call("dm", "/award", { id, revision: 3 }), (e) => e.status === 409);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM dm_encounter_awards").first()).n, 0);
  } finally {
    db.close();
  }
});
test("atomic receipt predicate rejects a concurrent room change and does not leave a false award", async () => {
  const { db, call, id } = await fixture();
  try {
    const e = blankEncounter();
    e.coins.gp = 10;
    e.coinPurseId = "party";
    await call("dm", "/save", { id, revision: 0, encounter: e });
    await call("dm", "/conclude", { id, revision: 1 });
    const original = db.batch.bind(db);
    db.batch = async (statements) => {
      const r = await db
        .prepare("SELECT * FROM campaign_rooms WHERE code=?")
        .bind("BATTLE")
        .first();
      const room = JSON.parse(r.body);
      room.revision++;
      await db
        .prepare("UPDATE campaign_rooms SET revision=?,body=? WHERE code=?")
        .bind(room.revision, JSON.stringify(room), "BATTLE")
        .run();
      return original(statements);
    };
    await assert.rejects(call("dm", "/award", { id, revision: 2 }), (e) => e.status === 409);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM dm_encounter_awards").first()).n, 0);
    assert.equal((await call("dm", "/detail", { id })).status, "review");
    const r = await db
      .prepare("SELECT body FROM campaign_rooms WHERE code=?")
      .bind("BATTLE")
      .first();
    assert.equal(JSON.parse(r.body).table.purses[0].coins.gp, 10);
  } finally {
    db.close();
  }
});
test("an inventory write failure rolls back receipt acquisition and the encounter remains reviewable", async () => {
  const { db, call, id } = await fixture();
  try {
    const e = blankEncounter();
    e.coins.gp = 10;
    e.coinPurseId = "party";
    await call("dm", "/save", { id, revision: 0, encounter: e });
    await call("dm", "/conclude", { id, revision: 1 });
    db.exec(
      "CREATE TRIGGER fail_award BEFORE UPDATE ON campaign_rooms BEGIN SELECT RAISE(ABORT, 'test write failure'); END;",
    );
    await assert.rejects(call("dm", "/award", { id, revision: 2 }));
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM dm_encounter_awards").first()).n, 0);
    assert.equal((await call("dm", "/detail", { id })).status, "review");
  } finally {
    db.close();
  }
});

test("account-only drafts require no DM membership and cannot change another user's campaign", async () => {
  const { db, call } = await fixture();
  try {
    const id = crypto.randomUUID();
    await call("stranger", "/create", { id, code: "personal" });
    const list = await call("stranger", "");
    assert.ok(list.campaigns.some((c) => c.code === "personal"));
    assert.ok(list.encounters.some((e) => e.id === id));
    let d = await call("stranger", "/detail", { id });
    assert.deepEqual(d.purses, []);
    await assert.rejects(call("player", "/detail", { id }), (e) => e.status === 404);
    d.body.name = "Account preparation";
    await call("stranger", "/save", { id, revision: 0, encounter: d.body });
    await assert.rejects(
      call("stranger", "/save", { id, revision: 0, encounter: d.body }),
      (e) => e.status === 409,
    );
    const key = crypto.randomUUID();
    const roll = { id, revision: 1, requestKey: key, manual: true, total: 12, formula: "1d20" };
    assert.equal((await call("stranger", "/roll", roll)).total, 12);
    await call("stranger", "/roll", roll);
    assert.equal((await call("stranger", "/log", { id })).rolls.length, 1);
    await call("stranger", "/start", { id, revision: 1 });
    await call("stranger", "/conclude", { id, revision: 2 });
    await assert.rejects(call("stranger", "/award", { id, revision: 3 }), /Import this draft/);
    // The same portable body can become a campaign-owned draft without changing its source.
    d = await call("stranger", "/detail", { id });
    const imported = crypto.randomUUID();
    await call("dm", "/create", { id: imported, code: "BATTLE", encounter: d.body });
    assert.equal((await call("dm", "/detail", { id: imported })).body.name, "Account preparation");
    assert.equal((await call("stranger", "/detail", { id })).status, "review");
  } finally {
    db.close();
  }
});
