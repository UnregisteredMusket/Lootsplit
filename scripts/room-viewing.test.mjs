import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
import { campaignAction, resumeCampaignMembership } from "../cloudflare/account-campaigns.mjs";
import {
  openRoom,
  joinRoom,
  choosePace,
  closeRoom,
  roomState,
  submitCommands,
  passTurn,
  manageRoom,
  previewRoom,
  characterRoll,
} from "../src/lib/quire/cloud.server.ts";
import { readRoom } from "../src/lib/quire/room-store.server.ts";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { blankSheet } from "../src/lib/characters/model.mjs";
import { isRoomViewOnly, canReadRoom } from "../src/lib/quire/room-access.ts";
const origin = "http://localhost:8080";
async function fixture(live = true) {
  const DB = localAccountDb();
  const env = {
    DB,
    ACCOUNT_SECRET: "disposable-viewing-test-secret-12345678901234567890",
    ACCOUNT_ORIGIN: origin,
  };
  globalThis.__env__ = env;
  let ip = 0;
  const call = async (path, body, cookie = "") => {
    const r = await handleAccounts(
      new Request(`${origin}/api/account/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          cookie,
          "cf-connecting-ip": `192.0.2.${++ip}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    };
  };
  const signup = async (name) => {
    const result = await call("auth/sign-up/email", {
      email: `${name}@example.com`,
      password: "viewing tests long disposable password",
      name,
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return { ...result, id: result.data.user.id };
  };
  const dmUser = await signup("dm"),
    playerUser = await signup("player"),
    outsider = await signup("outsider");
  const sheet = blankSheet("Viewing hero");
  sheet.hp = 13;
  sheet.maxHp = 25;
  const dm = await openRoom({
    name: "DM",
    userId: dmUser.id,
    table: {
      ...emptyCloudTable(),
      purses: [
        {
          id: "hero",
          name: "Viewing hero",
          kind: "character",
          coins: { cp: 3, sp: 2, ep: 0, gp: 27, pp: 0 },
          sheet,
          editingAllowed: true,
        },
        {
          id: "other",
          name: "Other hero",
          kind: "character",
          coins: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
          sheet: blankSheet("Private second sheet"),
        },
      ],
    },
  });
  const sessionId = (await readRoom(dm.code)).sessionId;
  const player = await joinRoom({
    code: dm.code,
    purseId: "hero",
    name: "Player",
    userId: playerUser.id,
    sessionId,
  });
  const guest = await joinRoom({ code: dm.code, purseId: "other", name: "Guest", sessionId });
  if (live) await choosePace({ ...dm, live: true });
  const p = { code: dm.code, token: player.token };
  const g = { code: dm.code, token: guest.token };
  const sheetId = `campaign:${dm.code}:hero`;
  const cleanup = () => {
    delete globalThis.__env__;
    DB.close();
  };
  return {
    DB,
    env,
    call,
    dmUser,
    playerUser,
    outsider,
    dm,
    player,
    guest,
    p,
    g,
    sheetId,
    sessionId,
    cleanup,
  };
}

test("legacy closed rooms stay closed, only explicit ended-viewing state permits reads", () => {
  assert.equal(canReadRoom(null), false);
  for (const room of [{ closed: true }, { closed: true, viewOnly: false }]) {
    assert.equal(canReadRoom(room), false);
    assert.equal(isRoomViewOnly(room), false);
  }
  assert.equal(canReadRoom({}), true);
  assert.equal(isRoomViewOnly({ viewOnly: true, closed: false }), false);
  assert.equal(canReadRoom({ viewOnly: true, closed: true }), true);
});

for (const live of [true, false]) {
  test(`${live ? "Live" : "Turn-based"}: DM ends play, existing account/guest readers keep permitted sheets; every gameplay mutation is denied`, async () => {
    const f = await fixture(live);
    try {
      const before = await readRoom(f.dm.code);
      await assert.rejects(closeRoom({ ...f.p, keepViewable: true }), /Only/);
      await closeRoom({ ...f.dm, keepViewable: true });
      const after = await readRoom(f.dm.code);
      assert.equal(after.closed, true);
      assert.equal(after.viewOnly, true);
      assert.equal(after.live, live, "Keep intended play mode for reopening, not active play");
      assert.equal(after.table.journal.reports.length, 1);
      assert.equal(after.table.purses[0].editingAllowed, false);
      assert.deepEqual(after.table.purses[0].coins, before.table.purses[0].coins);
      await closeRoom({ ...f.dm, keepViewable: true });
      assert.deepEqual(
        await readRoom(f.dm.code),
        after,
        "Ambiguous close retries don't rearchive or update again",
      );
      for (const credentials of [f.p, f.g]) {
        const projected = await roomState(credentials);
        assert.equal(projected.readOnly, true);
        assert.equal(projected.live, false);
        assert.equal(projected.mine, false);
        const owned = projected.purseIds[0];
        assert.ok(projected.table.purses.find((p) => p.id === owned).sheet);
        assert.equal(projected.table.purses.find((p) => p.id !== owned).sheet, undefined);
        const archived = JSON.parse(projected.table.journal.reports[0].snapshot);
        assert.deepEqual(
          archived.purses.map((p) => p.id),
          [owned],
          "Archived sheets retain seat privacy",
        );
      }
      const state = await f.call("library", undefined, f.playerUser.cookie);
      assert.equal(state.data.members[0].role, "player");
      assert.equal(state.data.members[0].viewOnly, true);
      const resume = await f.call(
        "resume",
        { code: f.dm.code, reopen: true, revision: after.revision, role: "dm" },
        f.playerUser.cookie,
      );
      assert.equal(resume.status, 200);
      assert.equal(resume.data.role, "player");
      assert.equal(resume.data.reopened, false);
      assert.deepEqual(
        await readRoom(f.dm.code),
        after,
        "Player cannot reopen by supplying DM arguments",
      );
      const detail = await f.call("sheets/detail", { id: f.sheetId }, f.playerUser.cookie);
      assert.equal(detail.status, 200, JSON.stringify(detail.data));
      assert.equal(detail.data.campaign.readOnly, true);
      assert.equal(detail.data.editable, false);
      assert.equal(detail.data.campaign.editingAllowed, false);
      assert.equal(detail.data.body.hp, 13);
      assert.equal(detail.data.body.coins.gp, 27);
      const list = await f.call("sheets", undefined, f.playerUser.cookie);
      assert.equal(list.status, 200);
      assert.equal(list.data.campaigns[0].readOnly, true);
      assert.deepEqual(
        list.data.campaigns[0].purses.map((p) => p.id),
        ["hero"],
      );
      assert.equal(
        (await f.call("sheets/detail", { id: `campaign:${f.dm.code}:other` }, f.playerUser.cookie))
          .status,
        404,
      );
      assert.equal((await f.call("resume", { code: f.dm.code }, f.outsider.cookie)).status, 404);
      await assert.rejects(roomState({ code: f.dm.code, token: "not-a-seat" }), /not seated/);
      const noWrites = [
        () => submitCommands({ ...f.p, batchId: "end", commands: [], endTurn: true }),
        () => submitCommands({ ...f.p, batchId: "draft", commands: [], stage: true }),
        () =>
          submitCommands({
            ...f.p,
            batchId: "chat",
            commands: [
              { id: "chat", kind: "message", to: "party", purseId: "hero", text: "no mutations" },
            ],
          }),
        () => choosePace({ ...f.dm, live: !live }),
        () => passTurn(f.dm),
        () =>
          manageRoom({ ...f.dm, action: "permission", seatId: f.player.seatId, allowParty: true }),
        () => manageRoom({ ...f.p, action: "discard", seatId: f.player.seatId }),
        () =>
          characterRoll({
            ...f.p,
            purseId: "hero",
            requestKey: "readonly-roll-123456",
            kind: "ability",
            key: "str",
          }),
        () => previewRoom(f.dm.code, f.sessionId),
        () =>
          joinRoom({
            code: f.dm.code,
            purseId: "hero",
            name: "Player",
            userId: f.playerUser.id,
            sessionId: f.sessionId,
          }),
      ];
      for (const work of noWrites) await assert.rejects(work, /view-only/);
      assert.deepEqual(await characterRoll({ ...f.p, purseId: "hero", policy: true }), {
        manualAllowed: false,
      });
      assert.ok(Array.isArray((await characterRoll({ ...f.p, purseId: "hero", log: true })).rolls));
      for (const [path, body] of [
        [
          "sheets/save",
          {
            id: f.sheetId,
            sheet: detail.data.body,
            revision: detail.data.revision,
            before: detail.data.body,
          },
        ],
        ["sheets/assign", { id: f.sheetId, code: "", purseId: "", revision: 0 }],
        ["sheets/roll", { id: f.sheetId }],
        ["sheets/policy", { code: f.dm.code, allowed: true }],
      ]) {
        const result = await f.call(path, body, f.playerUser.cookie);
        assert.equal(result.status, 403, `${path}: ${JSON.stringify(result.data)}`);
        assert.match(result.data.error, /view-only/);
      }
      assert.deepEqual(
        await readRoom(f.dm.code),
        after,
        "Denied actions leave the saved campaign untouched",
      );
      // Existing account access still honors moderation, even while viewing.
      await f.DB.prepare("UPDATE member_access SET status='revoked',reason='test' WHERE user_id=?")
        .bind(f.playerUser.id)
        .run();
      assert.equal((await f.call("resume", { code: f.dm.code }, f.playerUser.cookie)).status, 403);
    } finally {
      f.cleanup();
    }
  });
}

test("unsent server turn blocks ending for view-only without discarding any draft", async () => {
  const f = await fixture(false);
  try {
    await submitCommands({
      ...f.dm,
      batchId: "staged-dm",
      commands: [{ id: "pending", kind: "patch", changes: [] }],
      stage: true,
    });
    const before = await readRoom(f.dm.code);
    await assert.rejects(closeRoom({ ...f.dm, keepViewable: true }), /pending/);
    assert.deepEqual(await readRoom(f.dm.code), before);
  } finally {
    f.cleanup();
  }
});

test("a viewer can leave their own seat but not another seat; full-close revokes remaining viewers without deleting campaign", async () => {
  const f = await fixture();
  try {
    await closeRoom({ ...f.dm, keepViewable: true });
    await assert.rejects(
      manageRoom({ ...f.p, action: "leave", seatId: f.guest.seatId }),
      /own seat/,
    );
    await manageRoom({ ...f.g, action: "leave", seatId: f.guest.seatId });
    await assert.rejects(roomState(f.g), /not seated/);
    const before = await readRoom(f.dm.code);
    await assert.rejects(
      campaignAction(f.DB, f.playerUser.id, {
        code: f.dm.code,
        action: "close-viewing",
        revision: before.revision,
      }),
      /Only/,
    );
    await assert.rejects(
      campaignAction(f.DB, f.dmUser.id, { code: f.dm.code, action: "close-viewing", revision: 0 }),
      /changed/,
    );
    await campaignAction(f.DB, f.dmUser.id, {
      code: f.dm.code,
      action: "close-viewing",
      revision: before.revision,
    });
    const closed = await readRoom(f.dm.code);
    assert.equal(closed.closed, true);
    assert.equal(closed.viewOnly, false);
    assert.deepEqual(closed.table, before.table);
    await assert.rejects(roomState(f.p), /closed/);
    assert.equal((await f.call("resume", { code: f.dm.code }, f.playerUser.cookie)).status, 403);
    const library = await f.call("library", undefined, f.playerUser.cookie);
    assert.equal(library.data.members[0].role, null);
  } finally {
    f.cleanup();
  }
});

test("reopen resumes play only for DM, fresh invitations required, stale close cannot overwrite reopened room", async () => {
  const f = await fixture();
  try {
    await closeRoom({ ...f.dm, keepViewable: true });
    const before = await readRoom(f.dm.code);
    await assert.rejects(
      resumeCampaignMembership(f.DB, f.dmUser.id, { code: f.dm.code }),
      /Reopen as DM/,
    );
    await resumeCampaignMembership(f.DB, f.dmUser.id, {
      code: f.dm.code,
      reopen: true,
      revision: before.revision,
    });
    const after = await readRoom(f.dm.code);
    assert.equal(after.closed, false);
    assert.equal(after.viewOnly, false);
    assert.equal(after.live, true);
    assert.notEqual(after.sessionId, f.sessionId);
    assert.deepEqual(after.table, before.table);
    for (const p of [f.p, f.g]) await assert.rejects(roomState(p), /not seated/);
    await assert.rejects(previewRoom(f.dm.code, f.sessionId), /expired/);
    await assert.rejects(
      campaignAction(f.DB, f.dmUser.id, {
        code: f.dm.code,
        action: "close-viewing",
        revision: before.revision,
      }),
      /changed/,
    );
    assert.deepEqual(await readRoom(f.dm.code), after);
    const joined = await joinRoom({
      code: f.dm.code,
      purseId: "hero",
      name: "Player",
      userId: f.playerUser.id,
      sessionId: after.sessionId,
    });
    assert.notEqual(joined.token, f.player.token);
    assert.equal((await roomState({ code: f.dm.code, token: joined.token })).readOnly, false);
  } finally {
    f.cleanup();
  }
});

test("original End session still fully revokes player access", async () => {
  const f = await fixture();
  try {
    await closeRoom(f.dm);
    await assert.rejects(roomState(f.p), /closed/);
    assert.equal((await f.call("resume", { code: f.dm.code }, f.playerUser.cookie)).status, 403);
    assert.equal(
      (await f.call("sheets/detail", { id: f.sheetId }, f.playerUser.cookie)).status,
      403,
    );
  } finally {
    f.cleanup();
  }
});
