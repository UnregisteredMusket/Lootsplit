import assert from "node:assert/strict";
import test from "node:test";
import { localAccountDb } from "./account-dev-db.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
import {
  choosePace,
  closeRoom,
  joinRoom,
  openRoom,
  roomState,
} from "../src/lib/quire/cloud.server.ts";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { blankPurse } from "../src/lib/quire/economy.ts";

test("account library reports authoritative mode and viewing access without resuming play", async () => {
  const DB = localAccountDb();
  const origin = "http://localhost:8080";
  const env = {
    DB,
    ACCOUNT_SECRET: "disposable-room-state-test-secret-12345678901234567890",
    ACCOUNT_ORIGIN: origin,
  };
  globalThis.__env__ = env;
  let requests = 0;
  const call = async (path, body, cookie = "") => {
    const response = await handleAccounts(
      new Request(`${origin}/api/account/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          "cf-connecting-ip": `192.0.2.${++requests}`,
          cookie,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return {
      data,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  };
  try {
    const dm = await call("auth/sign-up/email", {
      email: "room-state-dm@example.test",
      password: "long disposable test password",
      name: "DM",
    });
    const player = await call("auth/sign-up/email", {
      email: "room-state-player@example.test",
      password: "long disposable test password",
      name: "Player",
    });
    const dmId = (await call("library", undefined, dm.cookie)).data.user.id;
    const playerId = (await call("library", undefined, player.cookie)).data.user.id;
    const table = emptyCloudTable();
    table.purses = [
      {
        ...blankPurse("character"),
        id: "hero",
        name: "Hero",
        coins: { cp: 0, sp: 0, ep: 0, gp: 37, pp: 0 },
      },
    ];
    const opened = await openRoom({ name: "DM", table, userId: dmId });
    const initial = await roomState(opened);
    const joined = await joinRoom({
      code: opened.code,
      sessionId: initial.sessionId,
      purseId: "hero",
      name: "Player",
      userId: playerId,
    });
    const member = async (account) =>
      (await call("library", undefined, account.cookie)).data.members[0];
    const active = await member(dm);
    assert.equal(active.role, "dm");
    assert.equal(active.closed, false);
    assert.equal(active.viewOnly, false);
    assert.equal(active.live, false);
    assert.equal(
      "token" in active,
      false,
      "Presentation metadata does not expose seat credentials",
    );
    await choosePace({ ...opened, live: true });
    assert.equal((await member(player)).live, true);
    await closeRoom({ ...opened, keepOnline: true });
    for (const account of [dm, player]) {
      const paused = await member(account);
      assert.equal(paused.closed, false);
      assert.equal(paused.viewOnly, true);
      assert.equal(paused.live, true);
      assert.equal(paused.role, account === dm ? "dm" : "player");
      const resumed = await call("resume", { code: opened.code }, account.cookie);
      assert.equal(resumed.data.role, paused.role);
      const stillPaused = await roomState(
        account === dm ? opened : { code: opened.code, token: joined.token },
      );
      assert.equal(
        stillPaused.viewOnly,
        true,
        "Opening an account campaign only restores its seat",
      );
      assert.equal(
        stillPaused.revision,
        paused.room_revision,
        "Opening for viewing does not mutate room state",
      );
      assert.equal(stillPaused.table.purses[0].coins.gp, 37);
    }
    await closeRoom(opened);
    const closedDm = await member(dm);
    const closedPlayer = await member(player);
    assert.equal(closedDm.closed, true);
    assert.equal(closedDm.viewOnly, false);
    assert.equal(closedDm.role, "dm");
    assert.equal(closedPlayer.closed, true);
    assert.equal(
      closedPlayer.role,
      null,
      "Closing revokes player access while preserving the linked DM",
    );
    await assert.rejects(roomState({ code: opened.code, token: joined.token }), /closed/);
  } finally {
    delete globalThis.__env__;
    DB.close();
  }
});
