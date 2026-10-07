import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { localAccountDb } from "./account-dev-db.mjs";
import { d1Database } from "../standby/database.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { blankPurse } from "../src/lib/quire/economy.ts";
import { blankSheet } from "../src/lib/characters/model.mjs";
import { blankEncounter } from "../src/lib/encounters/model.mjs";
import {
  accountRestoreRequest,
  acknowledgeAccountRestore,
} from "../src/lib/account/restore-request.ts";
import { characterRoll } from "../src/lib/quire/cloud.server.ts";

async function setup(kind) {
  let DB;
  if (kind === "libsql") {
    const client = createClient({ url: ":memory:" });
    for (const name of readdirSync(new URL("../cloudflare/migrations/", import.meta.url))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await client.executeMultiple(
        readFileSync(new URL("../cloudflare/migrations/" + name, import.meta.url), "utf8"),
      );
    DB = d1Database(client);
  } else DB = localAccountDb();
  const origin = "http://localhost:8080",
    env = {
      DB,
      ACCOUNT_ORIGIN: origin,
      ACCOUNT_SECRET: "only-synthetic-campaign-recovery-test-secret",
    };
  let ip = 0;
  async function call(path, body, cookie = "") {
    const response = await handleAccounts(
      new Request(`${origin}/api/account/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          cookie,
          "content-type": "application/json",
          "cf-connecting-ip": `192.0.2.${++ip}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    };
  }
  async function signup(name) {
    const r = await call("auth/sign-up/email", {
      email: `${name}@example.invalid`,
      name,
      password: "synthetic recovery password 2026",
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { id: r.data.user.id, cookie: r.cookie };
  }
  const dm = await signup("recovery-dm"),
    player = await signup("recovery-player");
  const table = emptyCloudTable(),
    hero = {
      ...blankPurse("character"),
      id: "hero",
      name: "Shared hero",
      sheet: { ...blankSheet(), name: "Shared hero", notes: "Shared character history" },
      profileId: "player-profile",
      sheetReadOnlyForDm: true,
    };
  hero.coins.gp = 73;
  table.purses = [hero];
  table.notes = [
    {
      id: "party-message",
      at: 1,
      from: "player",
      to: "party",
      text: "Public party message",
      purseId: "hero",
    },
    {
      id: "private-message",
      at: 2,
      from: "player",
      to: "player",
      text: "Private player text must not leak",
      purseId: "hero",
      targetId: "other",
    },
  ];
  const code = "RECOVERY01",
    room = {
      code,
      ownerId: dm.id,
      revision: 1,
      live: true,
      closed: false,
      turn: 0,
      seats: [
        {
          id: "dm-seat",
          token: "old-dm-bearer-do-not-export",
          userId: dm.id,
          name: "Original DM",
          role: "dm",
          purseIds: [],
        },
        {
          id: "player-seat",
          token: "old-player-bearer-do-not-export",
          userId: player.id,
          name: "Player",
          role: "player",
          purseIds: ["hero"],
        },
      ],
      table,
      seen: { gifts: ["old-gift-receipt"], sales: ["old-sale-receipt"] },
    };
  await DB.prepare("INSERT INTO campaign_rooms VALUES (?,1,?)")
    .bind(code, JSON.stringify(room))
    .run();
  for (const [user, seat] of [
    [dm, room.seats[0]],
    [player, room.seats[1]],
  ])
    assert.equal(
      (await call("link", { code, token: seat.token, name: "Recovery campaign" }, user.cookie))
        .status,
      200,
    );
  const privateProfile = {
    ...blankSheet(),
    name: "Private future profile",
    notes: "UNSHARED-PROFILE-TEXT",
    coins: { cp: 0, sp: 0, ep: 0, gp: 9999, pp: 0 },
  };
  await DB.prepare(
    "INSERT INTO play_characters(id,user_id,body,campaign_code,purse_id,updated_at) VALUES (?,?,?,?,?,1)",
  )
    .bind("player-profile", player.id, JSON.stringify(privateProfile), code, "hero")
    .run();
  await DB.prepare("INSERT INTO play_policies VALUES (?,1,1)").bind(code).run();
  return { DB, env, call, dm, player, code, room };
}

// Each primary request passes real account authentication and preflight. Pause
// only its final write batch, then finish a second real handler request first.
// The outer handler has already captured the wrapper; the intervening handler
// uses the base DB, avoiding recursive barriers for moderation's own batch.
function beforeCommit(fixture, barrier) {
  const { DB, env } = fixture,
    batch = DB.batch.bind(DB);
  let crossed = false;
  env.DB = {
    ...DB,
    async batch(statements) {
      assert.equal(crossed, false, "The destructive request has one transaction boundary");
      crossed = true;
      env.DB = DB;
      await barrier();
      return batch(statements);
    },
  };
  return () => assert.equal(crossed, true, "The test crossed the actual commit boundary");
}

async function revokeBeforeCommit(fixture, action) {
  const { DB, call, dm, player, code } = fixture;
  if (["ban", "revoke"].includes(action)) {
    await DB.prepare("INSERT INTO site_roles VALUES (?,'admin',?)")
      .bind(player.id, Date.now())
      .run();
    const { revision } = await DB.prepare("SELECT revision FROM member_access WHERE user_id=?")
      .bind(dm.id)
      .first();
    const result = await call(
      "staff/action",
      { id: dm.id, action, revision, until: null, reason: "Synthetic recovery commit barrier" },
      player.cookie,
    );
    assert.equal(result.status, 200, JSON.stringify(result.data));
  } else if (action === "forget") {
    assert.equal((await call("remove", { kind: "membership", id: code }, dm.cookie)).status, 200);
  } else if (action === "sign-out") {
    assert.equal((await call("auth/sign-out", {}, dm.cookie)).status, 200);
  } else if (action === "expired") {
    // Expiry is an external clock event, simulated after authentication. Actual
    // BetterAuth ISO-date storage must be evaluated by the write SQL, not JS.
    await DB.prepare("UPDATE session SET expiresAt='1970-01-01T00:00:00.000Z' WHERE userId=?")
      .bind(dm.id)
      .run();
  } else if (action === "restricted-session-retained") {
    // Isolate the access predicate from moderation's usual session revocation.
    await DB.prepare("UPDATE member_access SET status='revoked' WHERE user_id=?").bind(dm.id).run();
    assert.ok(await DB.prepare("SELECT id FROM session WHERE userId=?").bind(dm.id).first());
  } else assert.fail(`Unknown synthetic barrier ${action}`);
}

for (const kind of ["sqlite", "libsql"]) {
  test(`${kind}: shared restore rejects diagnostic archive placeholders without creating or erasing records`, async () => {
    const { DB, call, dm, code } = await setup(kind);
    try {
      const deleted = await call(
        "campaign",
        { action: "delete", code, confirm: code, revision: 1 },
        dm.cookie,
      );
      assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
      const backupId = deleted.data.backupId;
      const row = await DB.prepare("SELECT body FROM library_backups WHERE id=?")
        .bind(backupId).first();
      for (const error of ["Unreadable original archive", ""]) {
        const payload = JSON.parse(row.body);
        payload.journal = {
          reports: [{
            id: "diagnostic-only", name: "Damaged historical record", at: 1,
            snapshot: JSON.stringify(emptyCloudTable()), error,
          }],
        };
        const original = JSON.stringify(payload);
        await DB.prepare("UPDATE library_backups SET body=? WHERE id=?")
          .bind(original, backupId).run();
        const restored = await call("restore-backup", {
          id: backupId, requestKey: crypto.randomUUID(),
        }, dm.cookie);
        assert.equal(restored.status, 409, JSON.stringify(restored.data));
        assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM campaign_rooms").first()).n, 0);
        assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM campaign_recoveries").first()).n, 0);
        assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM library_members").first()).n, 0);
        assert.equal((await DB.prepare("SELECT body FROM library_backups WHERE id=?")
          .bind(backupId).first()).body, original);
        assert.ok(await DB.prepare("SELECT backup_id FROM campaign_deletion_backups WHERE backup_id=?")
          .bind(backupId).first());
      }
    } finally {
      await DB.close();
    }
  });

  test(`${kind}: deletion rechecks ban, revocation, Forget, sign-out and expiry at commit`, async () => {
    for (const action of [
      "ban",
      "revoke",
      "forget",
      "sign-out",
      "expired",
      "restricted-session-retained",
    ]) {
      const fixture = await setup(kind),
        { DB, call, dm, code } = fixture;
      try {
        const originalRoom = await DB.prepare("SELECT body FROM campaign_rooms WHERE code=?")
            .bind(code)
            .first(),
          originalProfile = await DB.prepare(
            "SELECT * FROM play_characters WHERE id='player-profile'",
          ).first();
        const crossed = beforeCommit(fixture, () => revokeBeforeCommit(fixture, action));
        const deleted = await call(
          "campaign",
          { action: "delete", code, confirm: code, revision: 1 },
          dm.cookie,
        );
        crossed();
        assert.equal(deleted.status, 409, `${action}: ${JSON.stringify(deleted.data)}`);
        assert.match(deleted.data.error, /not deleted/);
        assert.deepEqual(
          await DB.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(code).first(),
          originalRoom,
          `${action}: original campaign remains byte-for-byte intact`,
        );
        assert.deepEqual(
          await DB.prepare("SELECT * FROM play_characters WHERE id='player-profile'").first(),
          originalProfile,
          `${action}: linked profile assignment is not detached`,
        );
        assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM library_backups").first()).n, 0);
        assert.equal(
          (await DB.prepare("SELECT COUNT(*) AS n FROM campaign_deletion_backups").first()).n,
          0,
        );
      } finally {
        await DB.close();
      }
    }
  });

  test(`${kind}: restore rechecks current account access at commit and preserves its private backup`, async () => {
    for (const action of ["ban", "revoke", "sign-out", "expired", "restricted-session-retained"]) {
      const fixture = await setup(kind),
        { DB, call, dm, code } = fixture;
      try {
        const deleted = await call(
          "campaign",
          { action: "delete", code, confirm: code, revision: 1 },
          dm.cookie,
        );
        assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
        const originalBackup = await DB.prepare("SELECT * FROM library_backups WHERE id=?")
          .bind(deleted.data.backupId)
          .first();
        const crossed = beforeCommit(fixture, () => revokeBeforeCommit(fixture, action));
        const restored = await call(
          "restore-backup",
          { id: deleted.data.backupId, requestKey: crypto.randomUUID() },
          dm.cookie,
        );
        crossed();
        assert.equal(restored.status, 409, `${action}: ${JSON.stringify(restored.data)}`);
        assert.deepEqual(
          await DB.prepare("SELECT * FROM library_backups WHERE id=?")
            .bind(deleted.data.backupId)
            .first(),
          originalBackup,
          `${action}: original full private backup remains byte-for-byte intact`,
        );
        for (const table of ["campaign_rooms", "campaign_recoveries", "library_members"])
          assert.equal(
            (await DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,
            0,
            `${action}: no ${table}`,
          );
        assert.equal(
          (await DB.prepare("SELECT COUNT(*) AS n FROM campaign_deletion_backups").first()).n,
          1,
        );
      } finally {
        await DB.close();
      }
    }
  });

  test(`${kind}: missing linked shared sheet refuses deletion without archiving private profile text`, async () => {
    const { DB, call, dm, code, room } = await setup(kind);
    try {
      delete room.table.purses[0].sheet;
      const originalRoom = JSON.stringify(room);
      await DB.prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
        .bind(originalRoom, code)
        .run();
      const originalProfile = await DB.prepare(
        "SELECT * FROM play_characters WHERE id='player-profile'",
      ).first();
      const refused = await call(
        "campaign",
        { action: "delete", code, confirm: code, revision: 1 },
        dm.cookie,
      );
      assert.equal(refused.status, 409, JSON.stringify(refused.data));
      assert.match(refused.data.error, /Resume.*linked shared character sheets.*not deleted/);
      assert.equal(
        (await DB.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(code).first()).body,
        originalRoom,
      );
      assert.deepEqual(
        await DB.prepare("SELECT * FROM play_characters WHERE id='player-profile'").first(),
        originalProfile,
      );
      assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM library_backups").first()).n, 0);
      // Reading a linked campaign sheet is a normal supported resume/hydration
      // path. Once that canonical sheet has been saved to the room, deletion can
      // snapshot exactly the newly visible shared state rather than a fallback.
      const hydrated = await call("sheets/detail", { id: `campaign:${code}:hero` }, dm.cookie);
      assert.equal(hydrated.status, 200, JSON.stringify(hydrated.data));
      const currentRoom = await DB.prepare("SELECT revision,body FROM campaign_rooms WHERE code=?")
        .bind(code)
        .first();
      assert.equal(currentRoom.revision, 2);
      const deleted = await call(
        "campaign",
        { action: "delete", code, confirm: code, revision: currentRoom.revision },
        dm.cookie,
      );
      assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
      const backup = (await call("read-backup", { id: deleted.data.backupId }, dm.cookie)).data
        .payload;
      assert.equal(
        backup.campaignRecovery.assignments[0].body.notes,
        JSON.parse(currentRoom.body).table.purses[0].sheet.notes,
      );
      assert.equal(backup.purses[0].coins.gp, 73);
      assert.equal(backup.campaignRecovery.assignments[0].body.coins.gp, 0);
    } finally {
      await DB.close();
    }
  });

  test(`${kind}: deletion and authenticated shared restore retain records, wealth, privacy and receipts`, async () => {
    const { DB, call, dm, player, code, room } = await setup(kind);
    try {
      const encounterId = crypto.randomUUID(),
        encounter = blankEncounter();
      encounter.notes = "Complete encounter notes";
      encounter.coins.gp = 7;
      encounter.coinPurseId = "hero";
      encounter.loot = [
        {
          id: "gem",
          name: "Recovery gem",
          quantity: 1,
          unitCopper: 200,
          notes: "A unique recovered item",
          catalogId: "",
          sourceTableId: "",
          purseId: "hero",
        },
      ];
      assert.equal(
        (await call("encounters/create", { id: encounterId, code }, dm.cookie)).status,
        200,
      );
      assert.equal(
        (await call("encounters/save", { id: encounterId, revision: 0, encounter }, dm.cookie))
          .status,
        200,
      );
      assert.equal(
        (
          await call(
            "encounters/roll",
            {
              id: encounterId,
              revision: 1,
              formula: "1d20",
              manual: true,
              total: 12,
              requestKey: crypto.randomUUID(),
            },
            dm.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await call("encounters/conclude", { id: encounterId, revision: 1 }, dm.cookie)).status,
        200,
      );
      assert.equal(
        (await call("encounters/award", { id: encounterId, revision: 2 }, dm.cookie)).status,
        200,
      );
      const savedRoll = await DB.prepare("SELECT body FROM dm_encounter_rolls WHERE encounter_id=?")
        .bind(encounterId)
        .first();
      await DB.batch(
        Array.from({ length: 80 }, (_, index) =>
          DB.prepare(
            "INSERT INTO dm_encounter_rolls(encounter_id,request_key,body,created_at) VALUES (?,?,?,?)",
          ).bind(encounterId, crypto.randomUUID(), savedRoll.body, index + 10),
        ),
      );
      await DB.prepare(
        "INSERT INTO play_rolls(id,user_id,character_id,code,request_key,body,created_at) VALUES (?,?,?,?,?,?,2)",
      )
        .bind(
          "character-roll",
          player.id,
          `campaign:${code}:hero`,
          code,
          crypto.randomUUID(),
          JSON.stringify({
            id: "character-roll",
            characterId: `campaign:${code}:hero`,
            actor: "Player",
            total: 14,
          }),
        )
        .run();
      await DB.prepare(
        "INSERT INTO play_rolls(id,user_id,character_id,code,request_key,body,created_at) VALUES (?,?,?,?,?,?,2)",
      )
        .bind(
          "profile-character-roll",
          player.id,
          "player-profile",
          code,
          crypto.randomUUID(),
          JSON.stringify({
            id: "profile-character-roll",
            characterId: "player-profile",
            actor: "Player",
            total: 17,
          }),
        )
        .run();
      for (const status of ["pending", "denied"])
        await DB.prepare("INSERT INTO character_imports VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(
            `${status}-import`,
            player.id,
            "player-profile",
            code,
            "hero",
            0,
            2,
            "player-seat",
            "secret-import-seat-token",
            "old-session",
            JSON.stringify({ ...blankSheet(), name: `Historical ${status} proposal` }),
            status,
            3,
            status === "pending" ? null : 4,
            status === "pending" ? null : dm.id,
          )
          .run();
      const before = JSON.parse(
        (await DB.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(code).first()).body,
      );
      const deletion = { action: "delete", code, confirm: code, revision: before.revision };
      assert.equal((await call("campaign", deletion, player.cookie)).status, 403);
      assert.equal((await call("campaign", { ...deletion, revision: 0 }, dm.cookie)).status, 409);
      const deleted = await call("campaign", deletion, dm.cookie);
      assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
      assert.equal((await call("campaign", deletion, dm.cookie)).status, 404);
      const backupId = deleted.data.backupId;
      assert.equal((await call("read-backup", { id: backupId }, player.cookie)).status, 404);
      const payload = (await call("read-backup", { id: backupId }, dm.cookie)).data.payload;
      assert.equal(payload.campaignRecovery.encounters.length, 1);
      assert.equal(payload.campaignRecovery.encounterAwards.length, 1);
      assert.equal(
        payload.campaignRecovery.encounterRolls.length,
        81,
        "Complete backup includes history beyond the first log page",
      );
      assert.equal(payload.campaignRecovery.characterRolls.length, 2);
      assert.equal(payload.campaignRecovery.imports.length, 2);
      assert.equal(payload.campaignRecovery.assignments.length, 1);
      assert.doesNotMatch(
        JSON.stringify(payload),
        /old-dm-bearer|old-player-bearer|secret-import-seat-token|Private player text|UNSHARED-PROFILE-TEXT/,
      );
      assert.equal(
        (
          await DB.prepare(
            "SELECT campaign_code FROM play_characters WHERE id='player-profile'",
          ).first()
        ).campaign_code,
        "",
      );
      const markers = new Map();
      const storage = {
        getItem: (k) => markers.get(k) || null,
        setItem: (k, v) => markers.set(k, v),
        removeItem: (k) => markers.delete(k),
      };
      const request = { id: backupId, requestKey: accountRestoreRequest(dm.id, backupId, storage) };
      assert.equal((await call("restore-backup", request, player.cookie)).status, 404);
      const restored = await call("restore-backup", request, dm.cookie);
      assert.equal(restored.status, 200, JSON.stringify(restored.data));
      // The committed response is lost. A fresh document reads only the durable
      // account retry ID and sends the same request, rather than creating a copy.
      const afterReload = {
        id: backupId,
        requestKey: accountRestoreRequest(dm.id, backupId, storage),
      };
      assert.deepEqual(afterReload, request);
      const resumed = (await call("restore-backup", afterReload, dm.cookie)).data;
      assert.deepEqual(
        resumed,
        restored.data,
        "Lost response replay returns the same room and credentials",
      );
      assert.notEqual(
        accountRestoreRequest(player.id, backupId, storage),
        request.requestKey,
        "Markers never cross accounts",
      );
      acknowledgeAccountRestore(dm.id, backupId, request.requestKey, storage);
      assert.ok([...markers.keys()].every((k) => !k.includes(dm.id)));
      const next = JSON.parse(
        (
          await DB.prepare("SELECT body FROM campaign_rooms WHERE code=?")
            .bind(resumed.code)
            .first()
        ).body,
      );
      assert.equal(next.viewOnly, true);
      assert.equal(next.seats.length, 1);
      assert.equal(next.seats[0].userId, dm.id);
      assert.notEqual(next.seats[0].token, room.seats[0].token);
      assert.deepEqual(next.invitations, {});
      assert.deepEqual(next.seen, before.seen);
      assert.deepEqual(next.table.purses[0].coins, before.table.purses[0].coins);
      assert.deepEqual(next.table.holdings, before.table.holdings);
      assert.deepEqual(next.table.ledger, before.table.ledger);
      assert.equal(next.table.purses[0].profileId, undefined);
      const encounters = (await call("encounters", undefined, dm.cookie)).data.encounters;
      const saved = encounters.find((e) => e.code === resumed.code);
      assert.ok(saved);
      assert.notEqual(saved.id, encounterId);
      const detail = (await call("encounters/detail", { id: saved.id }, dm.cookie)).data;
      assert.equal(detail.body.notes, encounter.notes);
      assert.equal(detail.status, "awarded");
      const duplicate = await call(
        "encounters/award",
        { id: saved.id, revision: detail.revision },
        dm.cookie,
      );
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.data.duplicate, true);
      assert.equal(duplicate.data.award.code, resumed.code);
      assert.equal(
        (await call("encounters/log", { id: saved.id }, dm.cookie)).data.rolls[0].total,
        12,
      );
      const firstPage = (await call("encounters/log", { id: saved.id }, dm.cookie)).data;
      assert.equal(firstPage.rolls.length, 50);
      assert.equal(firstPage.more, true);
      const secondPage = (
        await call(
          "encounters/log",
          { id: saved.id, before: firstPage.rolls.at(-1).seq },
          dm.cookie,
        )
      ).data;
      assert.equal(secondPage.rolls.length, 31);
      assert.equal(secondPage.more, false);
      assert.equal(new Set([...firstPage.rolls, ...secondPage.rolls].map((r) => r.seq)).size, 81);
      assert.deepEqual(
        (await call("sheets/log", { code: resumed.code }, dm.cookie)).data.rolls
          .map((r) => r.total)
          .sort(),
        [14, 17],
      );
      const previousEnv = globalThis.__env__;
      try {
        globalThis.__env__ = { DB };
        const characterHistory = await characterRoll({
          code: resumed.code,
          token: resumed.token,
          purseId: "hero",
          log: true,
        });
        assert.deepEqual(
          characterHistory.rolls.map((r) => r.total).sort(),
          [14, 17],
          "Profile-ID and canonical rolls remain in the actual shared character log",
        );
      } finally {
        globalThis.__env__ = previousEnv;
      }
      const history = await call("recovery-records", { code: resumed.code }, dm.cookie);
      assert.deepEqual(history.data.records.imports, payload.campaignRecovery.imports);
      assert.deepEqual(history.data.records.assignments, payload.campaignRecovery.assignments);
      assert.equal(
        (await call("recovery-records", { code: resumed.code }, player.cookie)).status,
        404,
      );
      assert.equal((await call("resume", { code: resumed.code }, player.cookie)).status, 404);
      assert.equal(
        (
          await DB.prepare("SELECT COUNT(*) AS n FROM character_imports WHERE code=?")
            .bind(resumed.code)
            .first()
        ).n,
        0,
        "Old seat approval requests stay archived, never active",
      );
      assert.equal((await call("library", undefined, dm.cookie)).data.backups.length, 1);
      const final = JSON.parse(
        (
          await DB.prepare("SELECT body FROM campaign_rooms WHERE code=?")
            .bind(resumed.code)
            .first()
        ).body,
      );
      assert.deepEqual(
        final.table.purses[0].coins,
        next.table.purses[0].coins,
        "Restored award receipts cannot award wealth twice",
      );
    } finally {
      await DB.close();
    }
  });

  test(`${kind}: full snapshot includes writes immediately before deletion and rejects oversized recovery without data loss`, async () => {
    const { DB, env, call, dm, code } = await setup(kind);
    try {
      const batch = DB.batch.bind(DB);
      let inserted = false;
      env.DB = {
        ...DB,
        async batch(statements) {
          if (!inserted) {
            inserted = true;
            await DB.prepare(
              "INSERT INTO play_rolls(id,user_id,character_id,code,request_key,body,created_at) VALUES (?,NULL,?,?,?,?,1)",
            )
              .bind("late-roll", "hero", code, "late-roll-request", JSON.stringify({ total: 19 }))
              .run();
          }
          return batch(statements);
        },
      };
      const deleted = await call(
        "campaign",
        { action: "delete", code, confirm: code, revision: 1 },
        dm.cookie,
      );
      assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
      const backup = (await call("read-backup", { id: deleted.data.backupId }, dm.cookie)).data
        .payload;
      assert.equal(backup.campaignRecovery.characterRolls[0].body.total, 19);
      const restored = await call(
        "restore-backup",
        { id: deleted.data.backupId, requestKey: crypto.randomUUID() },
        dm.cookie,
      );
      assert.equal(restored.status, 200);
      await DB.prepare(
        "INSERT INTO play_rolls(id,user_id,character_id,code,request_key,body,created_at) VALUES (?,NULL,?,?,?,?,1)",
      )
        .bind(
          "large-roll",
          "hero",
          restored.data.code,
          "large-roll-request",
          JSON.stringify({ text: "x".repeat(1_910_000) }),
        )
        .run();
      const large = await call(
        "campaign",
        { action: "delete", code: restored.data.code, confirm: restored.data.code, revision: 1 },
        dm.cookie,
      );
      assert.equal(large.status, 409, JSON.stringify(large.data));
      assert.match(large.data.error, /not deleted/);
      assert.ok(
        await DB.prepare("SELECT code FROM campaign_rooms WHERE code=?")
          .bind(restored.data.code)
          .first(),
      );
      assert.equal((await call("library", undefined, dm.cookie)).data.backups.length, 1);
    } finally {
      await DB.close();
    }
  });

  test(`${kind}: failed restore rolls back everything and uploaded recovery markers cannot grant server restore`, async () => {
    const { DB, call, dm, code } = await setup(kind);
    try {
      const id = crypto.randomUUID();
      assert.equal((await call("encounters/create", { id, code }, dm.cookie)).status, 200);
      const deleted = await call(
        "campaign",
        { action: "delete", code, confirm: code, revision: 1 },
        dm.cookie,
      );
      assert.equal(deleted.status, 200);
      const request = { id: deleted.data.backupId, requestKey: crypto.randomUUID() };
      await DB.exec(
        "CREATE TRIGGER fail_restored_encounter BEFORE INSERT ON dm_encounters BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
      );
      assert.equal((await call("restore-backup", request, dm.cookie)).status, 500);
      assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM campaign_rooms").first()).n, 0);
      assert.equal(
        (await DB.prepare("SELECT COUNT(*) AS n FROM campaign_recoveries").first()).n,
        0,
      );
      await DB.exec("DROP TRIGGER fail_restored_encounter;");
      assert.equal((await call("restore-backup", request, dm.cookie)).status, 200);
      const payload = (await call("read-backup", { id: request.id }, dm.cookie)).data.payload;
      const uploaded = await call("backup", { name: "Uploaded marker", payload }, dm.cookie);
      assert.equal(uploaded.status, 200);
      assert.equal(
        (
          await call(
            "restore-backup",
            { id: uploaded.data.id, requestKey: crypto.randomUUID() },
            dm.cookie,
          )
        ).status,
        404,
      );
    } finally {
      await DB.close();
    }
  });

  test(`${kind}: malformed history and a same-revision seat change cannot create a misleading deletion backup`, async () => {
    const { DB, env, call, dm, code } = await setup(kind);
    try {
      const id = crypto.randomUUID();
      assert.equal((await call("encounters/create", { id, code }, dm.cookie)).status, 200);
      await DB.prepare("UPDATE dm_encounters SET body=? WHERE id=?")
        .bind(JSON.stringify({ broken: true }), id)
        .run();
      const request = { action: "delete", code, confirm: code, revision: 1 };
      assert.equal((await call("campaign", request, dm.cookie)).status, 409);
      assert.ok(
        await DB.prepare("SELECT code FROM campaign_rooms WHERE code=?").bind(code).first(),
      );
      assert.equal((await call("library", undefined, dm.cookie)).data.backups.length, 0);
      await DB.prepare("UPDATE dm_encounters SET body=? WHERE id=?")
        .bind(JSON.stringify(blankEncounter()), id)
        .run();
      const original = JSON.parse(
        (await DB.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(code).first()).body,
      );
      original.table.journal = {
        reports: [
          { id: "broken-archive", name: "Unreadable old archive", at: 1, snapshot: "not JSON" },
        ],
      };
      await DB.prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
        .bind(JSON.stringify(original), code)
        .run();
      assert.equal((await call("campaign", request, dm.cookie)).status, 409);
      assert.equal((await call("library", undefined, dm.cookie)).data.backups.length, 0);
      delete original.table.journal;
      await DB.prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
        .bind(JSON.stringify(original), code)
        .run();
      const batch = DB.batch.bind(DB);
      env.DB = {
        ...DB,
        async batch(statements) {
          const next = structuredClone(original);
          next.seats = next.seats.filter((s) => s.role !== "dm");
          await DB.prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
            .bind(JSON.stringify(next), code)
            .run();
          return batch(statements);
        },
      };
      assert.equal((await call("campaign", request, dm.cookie)).status, 409);
      assert.ok(
        await DB.prepare("SELECT code FROM campaign_rooms WHERE code=?").bind(code).first(),
      );
      assert.equal((await call("library", undefined, dm.cookie)).data.backups.length, 0);
    } finally {
      await DB.close();
    }
  });
}
