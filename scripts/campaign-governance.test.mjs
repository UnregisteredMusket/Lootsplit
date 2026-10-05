import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";
import { characterSheet, statsOnly } from "../src/lib/characters/campaign-sheet.mjs";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { applyCommand } from "../src/lib/quire/commands.ts";
import { projectRecord } from "../src/lib/quire/session-records.ts";
import { campaignAnalytics } from "../src/lib/quire/analytics.ts";
import {
  openRoom,
  joinRoom,
  manageRoom,
  closeRoom,
  roomState,
  submitCommands,
} from "../src/lib/quire/cloud.server.ts";
import { readRoom } from "../src/lib/quire/room-store.server.ts";
import { handleCharacterPlay } from "../cloudflare/character-play.mjs";
import { campaignRecords } from "../cloudflare/campaign-records.mjs";
import { ownerTestMode } from "../cloudflare/test-mode.mjs";
import { siteGameAnalytics } from "../cloudflare/game-analytics.mjs";
const dm = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const player = { id: "p", token: "p", name: "Player", role: "player", purseIds: ["hero"] };
function fixture() {
  const sheet = {
    ...blankSheet(),
    name: "Hero",
    hp: 20,
    maxHp: 20,
    resources: [{ name: "Ki", current: 2, max: 2, recovery: "short" }],
    slots: [{ level: 1, max: 2, used: 0 }],
  };
  return {
    ...emptyCloudTable(),
    purses: [
      {
        id: "hero",
        name: "Hero",
        kind: "character",
        coins: { cp: 0, sp: 0, ep: 0, gp: 100, pp: 0 },
        sheet: statsOnly(sheet),
      },
      {
        id: "other",
        name: "Other",
        kind: "character",
        coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    ],
    holdings: [
      {
        id: "potion",
        purseId: "hero",
        name: "Potion",
        quantity: 2,
        unitCopper: 5000,
        kind: "item",
        category: "apothecary",
        notes: "",
        equipped: false,
      },
    ],
    shops: [
      {
        id: "inn",
        name: "Inn",
        category: "inn",
        keeper: "",
        place: "",
        notes: "",
        sellRate: 1,
        buyRate: 0.5,
        wealth: "modest",
        priceScale: 1,
      },
    ],
    stock: [
      {
        id: "lodging",
        shopId: "inn",
        name: "Room",
        copper: 100,
        baseCopper: 100,
        quantity: null,
        notes: "Service",
        rarity: "common",
        service: true,
        category: "inn",
      },
    ],
  };
}
const edit = (t, patch, seat = player) => {
  const before = characterSheet(t.purses[0], t.holdings);
  return applyCommand(t, seat, {
    id: crypto.randomUUID(),
    kind: "character",
    purseId: "hero",
    before,
    sheet: { ...before, ...patch },
  });
};
test("locked construction blocks forged scores, attacks, species and maxima while gameplay remains usable", () => {
  const t = fixture(),
    s = characterSheet(t.purses[0], t.holdings);
  for (const patch of [
    { species: "Forged subrace" },
    { scores: { ...s.scores, str: 30 } },
    { attacks: [{ name: "Attack", bonus: 100, damage: "1d20+100", notes: "" }] },
    { maxHp: 9999 },
    { ac: 99 },
    { proficiency: 20 },
    { resources: [{ ...s.resources[0], max: 9999 }] },
  ])
    assert.throws(() => edit(t, patch), /locked/);
  const played = edit(t, {
    hp: 12,
    conditions: "Poisoned",
    resources: [{ ...s.resources[0], current: 1 }],
    slots: [{ ...s.slots[0], used: 1 }],
    equipment: s.equipment.map((i) => ({ ...i, equipped: true, quantity: 1 })),
  });
  assert.equal(played.purses[0].sheet.hp, 12);
  assert.equal(played.holdings[0].quantity, 1);
  assert.equal(played.holdings[0].equipped, true);
  assert.throws(() => edit(t, { equipment: [{ ...s.equipment[0], quantity: 10 }] }), /Only the DM/);
});
test("DM opens and closes an editing window with a complete report and no financial grant", () => {
  let t = applyCommand(fixture(), dm, {
    id: "open",
    kind: "character-editing",
    purseId: "hero",
    allowed: true,
  });
  assert.throws(
    () =>
      applyCommand(t, player, {
        id: "unauthorized",
        kind: "character-editing",
        purseId: "hero",
        allowed: true,
      }),
    /Only the DM/,
  );
  t = edit(t, { species: "Elf", scores: { ...t.purses[0].sheet.scores, cha: 18 } });
  assert.throws(() => edit(t, { coins: { cp: 0, sp: 0, ep: 0, gp: 10000, pp: 0 } }), /Only the DM/);
  t = applyCommand(t, dm, {
    id: "close",
    kind: "character-editing",
    purseId: "hero",
    allowed: false,
  });
  assert.equal(t.journal.editReports.length, 1);
  assert.equal(t.journal.editReports[0].before.species, "");
  assert.equal(t.journal.editReports[0].after.species, "Elf");
  assert.equal(
    applyCommand(t, dm, { id: "retry", kind: "character-editing", purseId: "hero", allowed: false })
      .journal.editReports.length,
    1,
  );
  assert.throws(() => edit(t, { species: "Another" }), /locked/);
});
test("services never become resale inventory and category exceptions are DM configured", () => {
  const t = fixture(),
    bought = applyCommand(t, player, {
      id: "buy",
      kind: "buy",
      stockId: "lodging",
      purseId: "hero",
      quantity: 1,
    });
  assert.equal(bought.holdings.length, t.holdings.length);
  assert.equal(bought.purses[0].coins.gp, 99);
  assert.throws(
    () =>
      applyCommand(t, player, {
        id: "sell",
        kind: "sell",
        holdingId: "potion",
        shopId: "inn",
        quantity: 1,
      }),
    /category/,
  );
  t.shops[0].acceptedCategories = ["inn", "apothecary"];
  assert.equal(
    applyCommand(t, player, {
      id: "sell2",
      kind: "sell",
      holdingId: "potion",
      shopId: "inn",
      quantity: 1,
    }).holdings[0].quantity,
    1,
  );
  t.holdings[0].service = true;
  t.shops[0].acceptAnyCategory = true;
  assert.throws(
    () =>
      applyCommand(t, dm, {
        id: "sell3",
        kind: "sell",
        holdingId: "potion",
        shopId: "inn",
        quantity: 1,
      }),
    /Services/,
  );
});
test("session archive preserves financial analytics and private message contents are excluded from DM reports", () => {
  let t = fixture();
  t = applyCommand(t, dm, { id: "session", kind: "session", name: "Session 1", end: false });
  t = applyCommand(t, player, {
    id: "chat",
    kind: "message",
    to: "player",
    recipientId: "other",
    purseId: "hero",
    text: "SECRET PRIVATE MESSAGE",
  });
  t = applyCommand(t, player, {
    id: "spent",
    kind: "buy",
    stockId: "lodging",
    purseId: "hero",
    quantity: 1,
  });
  t = applyCommand(t, dm, { id: "ended", kind: "session", name: "Session 1", end: true });
  assert.equal(t.ledger.length, 0);
  assert.equal(t.notes.length, 0);
  assert.equal(t.journal.reports.length, 1);
  assert.equal(campaignAnalytics(t).purchaseCopper, 100);
  const report = projectRecord(t, dm).journal.reports[0];
  assert.ok(!report.snapshot.includes("SECRET PRIVATE MESSAGE"));
  assert.ok(report.snapshot.includes("Private message sent"));
  assert.ok(
    projectRecord(t, player).journal.reports[0].snapshot.includes("SECRET PRIVATE MESSAGE"),
  );
  assert.ok(
    !projectRecord(t, {
      role: "player",
      purseIds: ["unrelated"],
    }).journal.reports[0].snapshot.includes("SECRET PRIVATE MESSAGE"),
  );
});
test("journal visibility keeps DM notes and private player notes separate", () => {
  let t = fixture();
  for (const [seat, visibility, text] of [
    [dm, "dm", "DM SECRET"],
    [player, "player", "PLAYER SECRET"],
    [player, "party", "SHARED"],
  ])
    t = applyCommand(t, seat, {
      id: visibility,
      kind: "journal-note",
      title: visibility,
      text,
      visibility,
      purseId: "hero",
      reportIds: [],
    });
  assert.deepEqual(
    projectRecord(t, dm).journal.entries.map((e) => e.text),
    ["DM SECRET", "SHARED"],
  );
  assert.deepEqual(
    projectRecord(t, player).journal.entries.map((e) => e.text),
    ["PLAYER SECRET", "SHARED"],
  );
  assert.throws(
    () =>
      applyCommand(t, player, {
        id: "forged",
        kind: "journal-note",
        title: "x",
        text: "x",
        visibility: "dm",
        purseId: "hero",
        reportIds: [],
      }),
    /Only the DM/,
  );
});
async function users(db) {
  for (const user of ["owner", "player"])
    await db
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)",
      )
      .bind(user, user, user + "@example.test")
      .run();
  await db
    .prepare("INSERT INTO site_roles(user_id,role,granted_at) VALUES (?,?,0)")
    .bind("owner", "owner")
    .run();
}
async function linkedRoom(db) {
  await users(db);
  const opened = await openRoom({ name: "DM", table: fixture() });
  const joined = await joinRoom({ code: opened.code, purseId: "hero", name: "Player" });
  for (const [user, r] of [
    ["owner", opened],
    ["player", joined],
  ])
    await db
      .prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)")
      .bind(user, opened.code, r.seatId, r.token, "Test")
      .run();
  return { opened, joined };
}
test("leaving releases the seat; kick requires a fresh invite; ban blocks alternate character joins and reports", async () => {
  const db = localAccountDb();
  globalThis.__env__ = { DB: db };
  try {
    const { opened, joined } = await linkedRoom(db),
      code = opened.code,
      token = opened.token;
    await manageRoom({ code, token: joined.token, action: "leave", seatId: joined.seatId });
    await assert.rejects(roomState({ code, token: joined.token }), /not seated/);
    const rejoined = await joinRoom({ code, purseId: "hero", name: "Player", userId: "player" });
    await db
      .prepare("UPDATE library_members SET seat_id=?,token=? WHERE user_id=?")
      .bind(rejoined.seatId, rejoined.token, "player")
      .run();
    await submitCommands({
      code,
      token,
      batchId: "archive",
      commands: [
        { id: "start", kind: "session", name: "One", end: false },
        { id: "end", kind: "session", name: "One", end: true },
      ],
    });
    await manageRoom({ code, token, action: "kick", seatId: rejoined.seatId });
    assert.equal((await campaignRecords(db, "player")).reports.length, 1);
    await assert.rejects(
      joinRoom({ code, purseId: "other", name: "Player", userId: "player" }),
      /fresh invitation/,
    );
    await manageRoom({ code, token, action: "invite", seatId: rejoined.seatId });
    const invite = (await readRoom(code)).invitations.hero;
    const latest = await joinRoom({
      code,
      purseId: "hero",
      name: "Player",
      invitation: invite,
      userId: "player",
    });
    await db
      .prepare("UPDATE library_members SET seat_id=?,token=? WHERE user_id=?")
      .bind(latest.seatId, latest.token, "player")
      .run();
    await manageRoom({ code, token, action: "ban", seatId: latest.seatId });
    await assert.rejects(
      joinRoom({ code, purseId: "other", name: "Player", userId: "player" }),
      /banned/,
    );
    assert.equal((await campaignRecords(db, "player")).reports.length, 0);
  } finally {
    db.close();
    delete globalThis.__env__;
  }
});
test("closed rooms retain authorized reports but never return stale account character sheets", async () => {
  const db = localAccountDb();
  globalThis.__env__ = { DB: db };
  try {
    const { opened, joined } = await linkedRoom(db);
    const body = blankSheet();
    await db
      .prepare(
        "INSERT INTO play_characters(id,user_id,body,campaign_code,purse_id,updated_at) VALUES (?,?,?,?,?,0)",
      )
      .bind("profile", "player", JSON.stringify(body), opened.code, "hero")
      .run();
    await closeRoom({ code: opened.code, token: opened.token });
    await assert.rejects(roomState({ code: opened.code, token: joined.token }), /closed/);
    const call = (path, body = {}) =>
      handleCharacterPlay(db, "player", path, body, new URL("http://localhost/"));
    assert.equal((await call("sheets")).characters.length, 0);
    for (const path of ["sheets/detail", "sheets/save", "sheets/assign", "sheets/roll"])
      await assert.rejects(
        call(path, { id: "profile", sheet: body, code: "", purseId: "", revision: 0 }),
        (e) => e.status === 403,
      );
    assert.equal((await campaignRecords(db, "player")).reports.length, 1);
    assert.equal((await campaignRecords(db, "owner")).reports.length, 1);
  } finally {
    db.close();
    delete globalThis.__env__;
  }
});
test("owner Test mode rejects other accounts, excludes analytics, and resets only its own data", async () => {
  const db = localAccountDb();
  try {
    await users(db);
    await assert.rejects(
      ownerTestMode(db, "player", { action: "create" }),
      (e) => e.status === 403,
    );
    const m = await ownerTestMode(db, "owner", {
      action: "create",
      characters: 2,
      gold: 20,
      hp: 15,
    });
    let room = JSON.parse(
      (await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(m.code).first()).body,
    );
    assert.equal(room.table.purses.length, 2);
    assert.equal(room.testMode, true);
    room.table.ledger.push({
      id: "fake",
      purseId: room.table.purses[0].id,
      at: 1,
      shopId: null,
      summary: "purchase",
      copper: -100,
      transactionType: "purchase",
    });
    room.revision++;
    await db
      .prepare("UPDATE campaign_rooms SET body=?,revision=? WHERE code=?")
      .bind(JSON.stringify(room), room.revision, room.code)
      .run();
    assert.equal((await siteGameAnalytics(db)).sharedCampaigns, 0);
    assert.equal((await siteGameAnalytics(db)).metrics.spentCopper, 0);
    await ownerTestMode(db, "owner", { action: "reset", code: m.code, revision: room.revision });
    room = JSON.parse(
      (await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(m.code).first()).body,
    );
    assert.equal(room.table.ledger.length, 0);
    assert.equal(room.table.purses[0].coins.gp, 20);
  } finally {
    db.close();
  }
});

test("individual grants apply immediately, remain scoped, and are revoked authoritatively", () => {
  let t = fixture();
  const grant = (permission, allowed = true) =>
    (t = applyCommand(t, dm, {
      id: crypto.randomUUID(),
      kind: "character-permission",
      purseId: "hero",
      permission,
      allowed,
    }));
  assert.throws(() =>
    applyCommand(t, player, {
      id: "escalate",
      kind: "character-permission",
      purseId: "hero",
      permission: "coins",
      allowed: true,
    }),
  );
  grant("species");
  t = edit(t, { species: "Elf" });
  assert.equal(t.purses[0].sheet.species, "Elf");
  assert.throws(() => edit(t, { maxHp: 99 }));
  assert.throws(() => edit(t, { coins: { cp: 0, sp: 0, ep: 0, gp: 999, pp: 0 } }));
  grant("coins");
  t = edit(t, { coins: { cp: 0, sp: 0, ep: 0, gp: 105, pp: 0 } });
  assert.equal(t.purses[0].coins.gp, 105);
  assert.match(t.ledger.at(-1).summary, /DM-authorized player/);
  assert.throws(() =>
    edit(t, {
      equipment: [{ name: "Unauthorized", quantity: 1, weight: 0, equipped: false, notes: "" }],
    }),
  );
  grant("equipment");
  t = edit(t, {
    equipment: [
      ...characterSheet(t.purses[0], t.holdings).equipment,
      {
        name: "Granted shield",
        quantity: 1,
        weight: 6,
        equipped: false,
        notes: "",
        unitCopper: 1000,
      },
    ],
  });
  assert.equal(t.holdings.at(-1).name, "Granted shield");
  grant("coins", false);
  grant("species", false);
  t = applyCommand(t, dm, {
    id: "edit-open",
    kind: "character-editing",
    purseId: "hero",
    allowed: true,
  });
  assert.throws(() => edit(t, { species: "Orc" }));
  assert.throws(() => edit(t, { coins: { cp: 0, sp: 0, ep: 0, gp: 999, pp: 0 } }));
  assert.throws(() =>
    applyCommand(
      t,
      { ...player, purseIds: ["other"] },
      {
        id: "other-edit",
        kind: "portrait",
        purseId: "hero",
        portrait: "/art/portrait-default.webp",
      },
    ),
  );
});

test("portrait commands update canonical stats/revision and survive round trips", () => {
  const t = applyCommand(fixture(), dm, {
    id: "portrait-sync",
    kind: "portrait",
    purseId: "hero",
    portrait: "data:image/png;base64,YQ==",
  });
  assert.equal(t.purses[0].sheet.portrait, "data:image/png;base64,YQ==");
  assert.equal(t.purses[0].sheetRevision, 1);
  assert.equal(characterSheet(t.purses[0], t.holdings).portrait, t.purses[0].sheet.portrait);
});

test("zero downtime is an explicit persistent preference and cannot be changed by players", () => {
  const before = fixture();
  assert.throws(() =>
    applyCommand(before, player, { id: "p", kind: "downtime-preference", days: 0 }),
  );
  const after = applyCommand(before, dm, { id: "dm", kind: "downtime-preference", days: 0 });
  assert.deepEqual(after.journal.downtimePrompt, { enabled: false, days: 0 });
  assert.deepEqual(after.purses, before.purses);
  assert.deepEqual(after.ledger, before.ledger);
});

test("canonical inventory order is identical on devices and server after DM awards", () => {
  const t = fixture();
  const award = {
    id: "award-a",
    purseId: "hero",
    name: "Shield",
    kind: "item",
    quantity: 1,
    unitCopper: 1000,
    notes: "",
  };
  const server = [...t.holdings, award],
    device = [award, ...t.holdings];
  assert.deepEqual(characterSheet(t.purses[0], server), characterSheet(t.purses[0], device));
  const before = characterSheet(t.purses[0], device);
  t.holdings = server;
  const next = applyCommand(t, player, {
    id: "equip-after-award",
    kind: "character",
    purseId: "hero",
    before,
    sheet: {
      ...before,
      equipment: before.equipment.map((x) => (x.id === award.id ? { ...x, equipped: true } : x)),
    },
  });
  assert.equal(next.holdings.find((h) => h.id === award.id).equipped, true);
});
