/** Synthetic account HTTP + actual shared-room boundary probes. No real data/network. */
import test from "node:test";
import assert from "node:assert/strict";
import { authorizationDatabase } from "./authorization-test-fixture.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";
import { statsOnly } from "../src/lib/characters/campaign-sheet.mjs";
import { closeRoom, roomState, characterRoll, manageRoom } from "../src/lib/quire/cloud.server.ts";
import { guardMemberSeat } from "../src/lib/quire/member-access.server.ts";

const origin = "http://localhost:8080";
const password = "synthetic-audit-password-for-local-only";

async function fixture() {
  const DB = await authorizationDatabase();
  const env = {
    DB,
    ACCOUNT_SECRET: "local-audit-only-secret-not-a-production-credential",
    ACCOUNT_ORIGIN: origin,
  };
  globalThis.__env__ = env;
  let ip = 0;
  async function call(path, body, cookie = "") {
    const headers = { origin, "cf-connecting-ip": `192.0.2.${++ip}` };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await handleAccounts(
      new Request(`${origin}/api/account/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
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
  }
  async function signup(label) {
    const email = `${label}-${crypto.randomUUID()}@example.com`;
    const r = await call("auth/sign-up/email", { email, password, name: label });
    assert.equal(r.status, 200);
    return { id: r.data.user.id, cookie: r.cookie, email };
  }
  const dm = await signup("AuditDM"),
    player = await signup("AuditPlayer"),
    other = await signup("AuditOther");
  const sheet = blankSheet();
  sheet.name = "Synthetic hero";
  const room = {
    code: "AUDIT123",
    ownerId: dm.id,
    sessionId: "synthetic-session",
    revision: 1,
    live: true,
    closed: false,
    turn: 0,
    seats: [
      {
        id: "dm",
        token: crypto.randomUUID(),
        userId: dm.id,
        role: "dm",
        name: "Audit DM",
        purseIds: [],
      },
      {
        id: "player",
        token: crypto.randomUUID(),
        userId: player.id,
        role: "player",
        name: "Audit Player",
        purseIds: ["hero"],
      },
    ],
    table: {
      purses: [
        {
          id: "hero",
          name: sheet.name,
          kind: "character",
          control: "player",
          sheet: statsOnly(sheet),
          sheetRevision: 0,
          coins: sheet.coins,
        },
        {
          id: "other-hero",
          name: "Other character",
          kind: "character",
          control: "player",
          sheet: statsOnly(blankSheet()),
          sheetRevision: 0,
          coins: sheet.coins,
        },
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
  };
  await DB.prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,?,?)")
    .bind(room.code, room.revision, JSON.stringify(room))
    .run();
  for (const [u, seat] of [
    [dm, room.seats[0]],
    [player, room.seats[1]],
  ])
    assert.equal(
      (
        await call(
          "link",
          { code: room.code, token: seat.token, name: "Synthetic audit campaign" },
          u.cookie,
        )
      ).status,
      200,
    );
  async function current() {
    return JSON.parse(
      (await DB.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(room.code).first())
        .body,
    );
  }
  async function persist(r) {
    await DB.prepare("UPDATE campaign_rooms SET body=?,revision=? WHERE code=?")
      .bind(JSON.stringify(r), r.revision, r.code)
      .run();
  }
  async function assignProfile() {
    const saved = await call("sheets/save", { sheet }, player.cookie);
    assert.equal(saved.status, 200);
    const key = crypto.randomUUID();
    assert.equal(
      (
        await call(
          "sheets/assign",
          { id: saved.data.id, code: room.code, purseId: "hero", revision: 0, requestKey: key },
          player.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await call("sheets/review-import", { id: key, decision: "approved" }, dm.cookie)).status,
      200,
    );
    return saved.data.id;
  }
  return {
    DB,
    env,
    call,
    dm,
    player,
    other,
    sheet,
    room,
    current,
    persist,
    assignProfile,
    close() {
      DB.close();
      delete globalThis.__env__;
    },
  };
}

test("new direct API controls: unrelated account/character/campaign access, forged DM policy, protected stats, read-only saves and rolls", async () => {
  const f = await fixture();
  try {
    const id = await f.assignProfile();
    for (const [path, body, user, expected] of [
      ["resume", { code: f.room.code, role: "dm" }, f.other, 404],
      ["sheets/detail", { id }, f.other, 403],
      ["sheets/detail", { id: `campaign:${f.room.code}:other-hero` }, f.player, 404],
      [
        "sheets/policy",
        { code: f.room.code, allowed: true, role: "dm", userId: f.dm.id },
        f.player,
        403,
      ],
      ["sheets/campaign", { code: f.room.code, role: "dm" }, f.player, 403],
    ])
      assert.equal((await f.call(path, body, user.cookie)).status, expected, path);
    const detail = (await f.call("sheets/detail", { id }, f.player.cookie)).data;
    const changed = structuredClone(detail.body);
    changed.species = "Forbidden change";
    assert.equal(
      (
        await f.call(
          "sheets/save",
          { id, revision: detail.revision, before: detail.body, sheet: changed },
          f.player.cookie,
        )
      ).status,
      409,
    );
    await closeRoom({ code: f.room.code, token: f.room.seats[0].token, keepOnline: true });
    const after = (await f.call("sheets/detail", { id }, f.player.cookie)).data;
    assert.equal(after.body.name, "Synthetic hero");
    assert.equal(
      (
        await f.call(
          "sheets/save",
          { id, revision: after.revision, before: after.body, sheet: after.body },
          f.player.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call(
          "sheets/roll",
          {
            id,
            revision: after.revision,
            kind: "ability",
            key: "str",
            requestKey: crypto.randomUUID(),
          },
          f.player.cookie,
        )
      ).status,
      403,
    );
  } finally {
    f.close();
  }
});

test("new direct revocation controls: linked site-ban, kicked seat, closed room, stale imports and other account edits", async () => {
  for (const mode of ["site-ban-linked", "kick", "close"]) {
    const f = await fixture();
    try {
      const id = await f.assignProfile();
      assert.equal(
        (await f.call("sheets/save", { id, sheet: f.sheet, revision: 1 }, f.other.cookie)).status,
        403,
      );
      assert.equal(
        (
          await f.call(
            "sheets/assign",
            {
              id,
              code: f.room.code,
              purseId: "hero",
              revision: 0,
              requestKey: crypto.randomUUID(),
            },
            f.player.cookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await f.call(
            "link",
            { code: f.room.code, token: "wrong-token", name: "Synthetic" },
            f.other.cookie,
          )
        ).status,
        403,
      );
      const old = { code: f.room.code, token: f.room.seats[1].token };
      if (mode === "site-ban-linked") {
        await f.DB.prepare("INSERT INTO site_roles VALUES (?,?,?)")
          .bind(f.dm.id, "owner", Date.now())
          .run();
        assert.equal(
          (
            await f.call(
              "staff/action",
              {
                id: f.player.id,
                action: "ban",
                until: null,
                reason: "Synthetic restriction control",
                revision: 0,
              },
              f.dm.cookie,
            )
          ).status,
          200,
        );
        await assert.rejects(guardMemberSeat(old), /restricted/);
      } else {
        if (mode === "kick")
          await manageRoom({
            code: f.room.code,
            token: f.room.seats[0].token,
            action: "kick",
            seatId: "player",
          });
        else await closeRoom({ code: f.room.code, token: f.room.seats[0].token });
        await assert.rejects(roomState(old), mode === "kick" ? /not seated/ : /closed/);
        assert.equal((await f.call("sheets/detail", { id }, f.player.cookie)).status, 403);
        assert.equal((await f.call("resume", { code: f.room.code }, f.player.cookie)).status, 403);
      }
    } finally {
      f.close();
    }
  }
});

test("account character detachment must preserve source room view-only restrictions", async () => {
  const f = await fixture();
  try {
    const id = await f.assignProfile();
    await closeRoom({ code: f.room.code, token: f.room.seats[0].token, keepOnline: true });
    const before = await f.current();
    const detail = (await f.call("sheets/detail", { id }, f.player.cookie)).data;
    const response = await f.call(
      "sheets/assign",
      { id, code: "", purseId: "", revision: detail.assignmentRevision },
      f.player.cookie,
    );
    const after = await f.current();
    assert.equal(response.status, 403, "View-only player detached a profile and mutated the room");
    assert.deepEqual(after, before, "Rejected detachment must not change the saved campaign");
  } finally {
    f.close();
  }
});

test("account character detachment must respect source turn and pending drafts", async () => {
  const outcomes = [];
  for (const mode of ["other-seat-turn", "pending-draft"]) {
    const f = await fixture();
    try {
      const id = await f.assignProfile();
      const r = await f.current();
      r.live = mode === "pending-draft";
      r.turn = 0;
      if (mode === "pending-draft")
        r.drafts = { player: [{ id: "unsubmitted-action", kind: "character" }] };
      await f.persist(r);
      const detail = (await f.call("sheets/detail", { id }, f.player.cookie)).data;
      const res = await f.call(
        "sheets/assign",
        { id, code: "", purseId: "", revision: detail.assignmentRevision },
        f.player.cookie,
      );
      outcomes.push(res.status);
      const after = await f.current();
      assert.deepEqual(after, r, "Rejected detachment must retain drafts, linkage and revision");
    } finally {
      f.close();
    }
  }
  assert.deepEqual(
    outcomes,
    [409, 409],
    "Source-room detach bypassed turn and pending-draft restrictions",
  );
});

test("profile owners can still detach during permitted Live play or their own turn", async () => {
  for (const live of [true, false]) {
    const f = await fixture();
    try {
      const id = await f.assignProfile();
      const before = await f.current();
      before.live = live;
      before.turn = 1;
      await f.persist(before);
      const detail = (await f.call("sheets/detail", { id }, f.player.cookie)).data;
      const response = await f.call(
        "sheets/assign",
        { id, code: "", purseId: "", revision: detail.assignmentRevision },
        f.player.cookie,
      );
      assert.equal(response.status, 200);
      const after = await f.current();
      assert.equal(after.table.purses[0].profileId, undefined);
      assert.equal(after.table.purses[0].sheetReadOnlyForDm, undefined);
      assert.equal(after.revision, before.revision + 1);
      assert.deepEqual(after.table.purses[0].coins, before.table.purses[0].coins);
      assert.deepEqual(after.table.holdings, before.table.holdings);
    } finally {
      f.close();
    }
  }
});

test("site ban must cover a player seat after the player removes its account-library entry", async () => {
  const f = await fixture();
  try {
    await f.DB.prepare("INSERT INTO site_roles VALUES (?,?,?)")
      .bind(f.dm.id, "owner", Date.now())
      .run();
    assert.equal(
      (await f.call("remove", { kind: "membership", id: f.room.code }, f.player.cookie)).status,
      200,
    );
    await f.DB.prepare("INSERT INTO push_subscriptions(endpoint,room_code,seat_id) VALUES (?,?,?)")
      .bind("https://example.com/synthetic-push-no-network", f.room.code, f.room.seats[1].id)
      .run();
    const banned = await f.call(
      "staff/action",
      { id: f.player.id, action: "ban", until: null, reason: "Synthetic audit ban", revision: 0 },
      f.dm.cookie,
    );
    assert.equal(banned.status, 200);
    assert.equal(
      (
        await f.DB.prepare(
          "SELECT COUNT(*) AS n FROM push_subscriptions WHERE room_code=? AND seat_id=?",
        )
          .bind(f.room.code, f.room.seats[1].id)
          .first()
      ).n,
      0,
      "Forgotten memberships must not leave notifications active after a ban",
    );
    assert.equal((await f.call("library", undefined, f.player.cookie)).status, 401);
    const old = {
      code: f.room.code,
      token: f.room.seats[1].token,
      purseId: "hero",
      revision: 0,
      kind: "ability",
      key: "str",
      requestKey: crypto.randomUUID(),
    };
    let blocked = false;
    try {
      await guardMemberSeat(old);
      await roomState(old);
      await characterRoll(old);
    } catch {
      blocked = true;
    }
    assert.equal(
      blocked,
      true,
      "Banned player bypasses restriction because library_members mapping was removed",
    );
  } finally {
    f.close();
  }
});
