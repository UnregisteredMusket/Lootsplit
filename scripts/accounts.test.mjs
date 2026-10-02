import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
const origin = "http://localhost:8080";
function setup() {
  const DB = localAccountDb();
  const env = {
    DB,
    ACCOUNT_SECRET: "only-a-disposable-test-secret-12345678901234567890",
    ACCOUNT_ORIGIN: origin,
  };
  let ip = 0;
  const call = async (path, body, cookie = "", requestOrigin = origin) => {
    const headers = { origin: requestOrigin, "cf-connecting-ip": `192.0.2.${++ip}` };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await handleAccounts(
      new Request(origin + "/api/account/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
    return {
      response,
      data: await response.json(),
      cookie: response.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    };
  };
  const signup = async (email) => {
    const r = await call("auth/sign-up/email", {
      email,
      password: "a long unique test password",
      name: "Test DM",
    });
    assert.equal(r.response.status, 200, JSON.stringify(r.data));
    assert.ok(r.cookie);
    return r;
  };
  return { DB, env, call, signup };
}
test("accounts enforce owner isolation, CSRF, durable sessions, and revoked memberships", async () => {
  const { DB, call, signup } = setup();
  try {
    const a = await signup("a@example.com"),
      b = await signup("b@example.com");
    assert.equal((await call("library")).response.status, 401);
    assert.equal(
      (await call("character", { name: "Stolen" }, a.cookie, "https://evil.example")).response
        .status,
      403,
    );
    const me = await call("library", undefined, a.cookie);
    assert.equal(me.data.user.email, "a@example.com");
    const room = {
      code: "TESTROOM",
      seats: [{ id: "dm-seat", token: "private-token", role: "dm", purseIds: [] }],
      table: {},
    };
    await DB.prepare("INSERT INTO campaign_rooms (code,revision,body) VALUES (?,1,?)")
      .bind(room.code, JSON.stringify(room))
      .run();
    assert.equal(
      (await call("link", { code: room.code, token: "wrong", name: "Game" }, a.cookie)).response
        .status,
      403,
    );
    assert.equal(
      (await call("link", { code: room.code, token: "private-token", name: "Game" }, a.cookie))
        .response.status,
      200,
    );
    assert.equal((await call("resume", { code: room.code }, b.cookie)).response.status, 404);
    assert.equal(
      (await call("link", { code: room.code, token: "private-token", name: "Game" }, b.cookie))
        .response.status,
      409,
    );
    assert.equal((await call("resume", { code: room.code }, a.cookie)).data.role, "dm");
    room.seats = [];
    await DB.prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
      .bind(JSON.stringify(room), room.code)
      .run();
    assert.equal((await call("resume", { code: room.code }, a.cookie)).response.status, 403);
    const payload = {
      kind: "quire",
      version: 2,
      purses: [],
      holdings: [],
      ledger: [],
      shops: [],
      stock: [],
      books: [],
      articles: [],
    };
    const backup = await call("backup", { name: "Campaign", payload }, a.cookie);
    assert.equal(backup.response.status, 200);
    assert.equal(
      (await call("read-backup", { id: backup.data.id }, b.cookie)).response.status,
      404,
    );
    await call("remove", { kind: "backup", id: backup.data.id }, b.cookie);
    assert.equal(
      (await call("read-backup", { id: backup.data.id }, a.cookie)).response.status,
      200,
    );
    assert.equal(
      (await call("backup", { name: "PDF", payload: { ...payload, books: [{}] } }, a.cookie))
        .response.status,
      400,
    );
    await call("character", { name: "Kaito", description: "Sword dancer" }, a.cookie);
    assert.equal((await call("library", undefined, b.cookie)).data.characters.length, 0);
    assert.equal((await call("library", undefined, a.cookie)).data.characters[0].name, "Kaito");
    await call("auth/sign-out", {}, a.cookie);
    assert.equal((await call("library", undefined, a.cookie)).response.status, 401);
  } finally {
    DB.close();
  }
});
test("recovery rotates the key, revokes sessions and rejects replay", async () => {
  const { DB, call, signup } = setup();
  try {
    const a = await signup("recover@example.com");
    const key = await call("recovery-key", {}, a.cookie);
    assert.equal(key.data.key.length, 64);
    const wrong = await call("recover", {
      email: "recover@example.com",
      key: "wrong",
      password: "replacement password here",
    });
    assert.equal(wrong.response.status, 401);
    const recovered = await call("recover", {
      email: "recover@example.com",
      key: key.data.key,
      password: "replacement password here",
    });
    assert.equal(recovered.response.status, 200, JSON.stringify(recovered.data));
    assert.equal((await call("library", undefined, a.cookie)).response.status, 401);
    assert.equal(
      (
        await call("recover", {
          email: "recover@example.com",
          key: key.data.key,
          password: "another replacement password",
        })
      ).response.status,
      401,
    );
    assert.equal(
      (
        await call("auth/sign-in/email", {
          email: "recover@example.com",
          password: "replacement password here",
        })
      ).response.status,
      200,
    );
  } finally {
    DB.close();
  }
});

test("signed native sessions work without third-party cookies; unsigned tokens fail", async () => {
  const { DB, env } = setup();
  try {
    const request = (path, body, token) =>
      handleAccounts(
        new Request(origin + "/api/account/" + path, {
          method: body ? "POST" : "GET",
          headers: {
            origin: "https://localhost",
            "content-type": "application/json",
            "cf-connecting-ip": "192.0.2.77",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        env,
      );
    const response = await request("auth/sign-up/email", {
      email: "native@example.com",
      name: "Native",
      password: "native password testing 2026",
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://localhost");
    const token = response.headers.get("set-auth-token");
    assert.ok(token);
    assert.equal((await request("library", undefined, token)).status, 200);
    assert.equal((await request("library", undefined, "forged-token")).status, 401);
    await request("auth/sign-out", {}, token);
    assert.equal((await request("library", undefined, token)).status, 401);
  } finally {
    DB.close();
  }
});

test("site owner grants are server-only, revocable, audited and conflict-safe", async () => {
  const { DB, call, signup } = setup();
  try {
    const a = await signup("owner@example.com"),
      b = await signup("member@example.com");
    const id = a.data.user.id;
    assert.equal((await call("owner")).response.status, 401);
    assert.equal((await call("owner", undefined, a.cookie)).response.status, 403);
    assert.equal((await call("library", undefined, a.cookie)).data.user.role, "member");
    await DB.prepare("INSERT INTO site_roles VALUES (?,'owner',?)").bind(id, Date.now()).run();
    assert.equal((await call("library", undefined, a.cookie)).data.user.role, "owner");
    const overview = await call("owner", undefined, a.cookie);
    assert.equal(overview.response.status, 200);
    assert.equal(overview.data.stats.accounts, 2);
    assert.equal(JSON.stringify(overview.data).includes("member@example.com"), false);
    const announcement = {
      title: "News",
      message: "Hello <b>party</b>",
      published: true,
      revision: 0,
    };
    assert.equal((await call("site-announcement")).data.announcement, null);
    assert.equal((await call("owner/announcement", announcement, b.cookie)).response.status, 403);
    assert.equal(
      (await call("owner/announcement", announcement, a.cookie, "https://evil.example")).response
        .status,
      403,
    );
    assert.equal((await call("owner/announcement", announcement, a.cookie)).response.status, 200);
    assert.equal((await call("owner/announcement", announcement, a.cookie)).response.status, 409);
    assert.deepEqual((await call("site-announcement")).data.announcement, {
      title: announcement.title,
      message: announcement.message,
    });
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM site_audit").first()).n, 1);
    assert.equal(
      (
        await call(
          "owner/announcement",
          { ...announcement, published: false, revision: 1 },
          a.cookie,
        )
      ).response.status,
      200,
    );
    assert.equal((await call("site-announcement")).data.announcement, null);
    assert.equal((await call("site-donations")).data.donationUrl, null);
    for (const donationUrl of [
      "javascript:alert(1)",
      "http://example.com",
      "https://user:password@example.com",
      "not a url",
    ]) {
      assert.equal(
        (await call("owner/donations", { donationUrl, revision: 0 }, a.cookie)).response.status,
        400,
      );
    }
    const donation = { donationUrl: "https://example.com/support", revision: 0 };
    assert.equal((await call("owner/donations", donation)).response.status, 401);
    assert.equal(
      (await call("owner/donations", { ...donation, userId: id }, b.cookie)).response.status,
      403,
    );
    assert.equal((await call("owner/donations", donation, a.cookie)).response.status, 200);
    assert.equal((await call("owner/donations", donation, a.cookie)).response.status, 409);
    assert.equal((await call("site-donations")).data.donationUrl, donation.donationUrl);
    assert.equal(
      (await call("owner/donations", { donationUrl: "", revision: 1 }, a.cookie)).response.status,
      200,
    );
    assert.equal((await call("site-donations")).data.donationUrl, null);
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM site_audit").first()).n, 4);
    await DB.prepare("DELETE FROM site_roles WHERE user_id=?").bind(id).run();
    assert.equal((await call("owner", undefined, a.cookie)).response.status, 403);
    assert.equal(
      (await call("owner/donations", { ...donation, revision: 2 }, a.cookie)).response.status,
      403,
    );
  } finally {
    DB.close();
  }
});

test("member moderation enforces role hierarchy, bans, revocation, and audit revisions", async () => {
  const { DB, call, signup } = setup();
  try {
    const owner = await signup("siteowner@example.com"),
      admin = await signup("admin@example.com"),
      mod = await signup("mod@example.com"),
      member = await signup("ordinary@example.com");
    for (const [u, role] of [
      [owner, "owner"],
      [admin, "admin"],
      [mod, "moderator"],
    ])
      await DB.prepare("INSERT INTO site_roles VALUES (?,?,?)")
        .bind(u.data.user.id, role, Date.now())
        .run();
    const id = member.data.user.id;
    assert.equal((await call("staff/members", undefined, member.cookie)).response.status, 403);
    const directory = await call("staff/members", undefined, owner.cookie);
    assert.equal(directory.data.total, 4);
    assert.ok(directory.data.members.every((m) => "member_since" in m && "last_online" in m));
    const act = (action, revision, extra = {}) => ({
      id,
      action,
      revision,
      reason: "Test moderation reason",
      ...extra,
    });
    assert.equal(
      (await call("staff/action", act("role", 0, { role: "admin" }), admin.cookie)).response.status,
      403,
    );
    assert.equal(
      (await call("staff/action", act("ban", 0, { until: null }), mod.cookie)).response.status,
      403,
    );
    assert.equal(
      (
        await call(
          "staff/action",
          { ...act("ban", 0, { until: null }), id: owner.data.user.id },
          admin.cookie,
        )
      ).response.status,
      403,
    );
    assert.equal((await call("staff/action", act("warn", 0), mod.cookie)).response.status, 200);
    assert.equal((await call("staff/action", act("warn", 0), mod.cookie)).response.status, 409);
    assert.equal(
      (await call("library", undefined, member.cookie)).data.notices[0].reason,
      "Test moderation reason",
    );
    assert.equal(
      (await call("staff/action", act("ban", 1, { until: Date.now() + 86400000 }), mod.cookie))
        .response.status,
      200,
    );
    assert.equal((await call("library", undefined, member.cookie)).response.status, 401);
    const login = () =>
      call("auth/sign-in/email", {
        email: "ordinary@example.com",
        password: "a long unique test password",
      });
    assert.equal((await login()).response.status, 403);
    await DB.prepare("UPDATE member_access SET ban_until=? WHERE user_id=?")
      .bind(Date.now() - 1, id)
      .run();
    assert.equal((await login()).response.status, 200);
    assert.equal(
      (await call("staff/action", act("ban", 2, { until: null }), admin.cookie)).response.status,
      200,
    );
    assert.equal((await login()).response.status, 403);
    assert.equal(
      (await call("staff/action", act("restore", 3), admin.cookie)).response.status,
      200,
    );
    const signed = await login();
    assert.equal(signed.response.status, 200);
    assert.equal((await call("staff/action", act("revoke", 4), admin.cookie)).response.status, 200);
    assert.equal((await login()).response.status, 403);
    assert.equal(
      (await DB.prepare("SELECT COUNT(*) AS n FROM user WHERE id=?").bind(id).first()).n,
      1,
    );
    assert.equal(
      (await call("staff/action", act("restore", 5), owner.cookie)).response.status,
      200,
    );
    assert.equal(
      (await call("staff/action", act("role", 6, { role: "moderator" }), owner.cookie)).response
        .status,
      200,
    );
    assert.equal((await call("staff/action", act("revoke", 7), admin.cookie)).response.status, 403);
    assert.equal(
      (await call("staff/action", act("role", 7, { role: "member" }), owner.cookie)).response
        .status,
      200,
    );
    assert.equal(
      (
        await DB.prepare("SELECT COUNT(*) AS n FROM moderation_audit WHERE target_id=?")
          .bind(id)
          .first()
      ).n,
      8,
    );
  } finally {
    DB.close();
  }
});

test("profile edits are private, validated, optimistic, and ignore role injection", async () => {
  const { DB, call, signup } = setup();
  try {
    const user = await signup("profile@example.com");
    const me = await call("library", undefined, user.cookie);
    assert.ok(me.data.profile.member_since);
    assert.ok(me.data.profile.last_online);
    const profile = {
      name: "Updated name",
      introduction: "Hello <script>literal</script>",
      portrait: "",
      contact_email: "contact@example.com",
      share_contact: false,
      email_opt_in: true,
      revision: 0,
      role: "owner",
    };
    assert.equal(
      (
        await call(
          "profile",
          { ...profile, portrait: "https://tracking.example.com/image" },
          user.cookie,
        )
      ).response.status,
      400,
    );
    assert.equal((await call("profile", profile, user.cookie)).response.status, 200);
    assert.equal(
      (await call("profile", { ...profile, name: "Conflict" }, user.cookie)).response.status,
      409,
    );
    const saved = await call("library", undefined, user.cookie);
    assert.equal(saved.data.user.role, "member");
    assert.equal(saved.data.profile.name, "Updated name");
    assert.equal(saved.data.profile.email_opt_in, 1);
    assert.equal(
      (await call("profile", { ...profile, email_opt_in: false, revision: 1 }, user.cookie))
        .response.status,
      200,
    );
    assert.equal(
      (await call("profile", { ...profile, revision: 2 }, user.cookie, "https://evil.example"))
        .response.status,
      403,
    );
  } finally {
    DB.close();
  }
});

test("campaign deletion requires linked DM, confirmation and current revision; saved state survives", async () => {
  const { DB, call, signup } = setup();
  try {
    const dm = await signup("campaign-dm@example.com"),
      player = await signup("campaign-player@example.com");
    const room = {
      code: "DELETE01",
      revision: 1,
      seats: [
        { id: "dm-seat", token: "dm-token", role: "dm", purseIds: [] },
        { id: "player-seat", token: "player-token", role: "player", purseIds: [] },
      ],
      table: { purses: [], holdings: [], ledger: [], shops: [], stock: [], notes: [] },
      drafts: {},
    };
    await DB.prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,1,?)")
      .bind(room.code, JSON.stringify(room))
      .run();
    for (const [u, token] of [
      [dm, "dm-token"],
      [player, "player-token"],
    ])
      assert.equal(
        (await call("link", { code: room.code, token, name: "Saved campaign" }, u.cookie)).response
          .status,
        200,
      );
    room.table.notes = [
      { id: "private", to: "player", text: "private message" },
      { id: "party", to: "party", text: "party message" },
    ];
    room.table.realm = { scale: 2 };
    await DB.prepare("UPDATE campaign_rooms SET body=? WHERE code=?")
      .bind(JSON.stringify(room), room.code)
      .run();
    const body = { code: room.code, action: "delete", confirm: room.code, revision: 1 };
    assert.equal((await call("campaign", body, player.cookie)).response.status, 403);
    assert.equal(
      (await call("campaign", { ...body, confirm: "wrong" }, dm.cookie)).response.status,
      400,
    );
    assert.equal(
      (await call("campaign", { ...body, revision: 0 }, dm.cookie)).response.status,
      409,
    );
    assert.equal(
      (await call("campaign", { action: "rename", code: room.code, name: "New title" }, dm.cookie))
        .response.status,
      200,
    );
    assert.equal((await call("campaign", body, dm.cookie)).response.status, 200);
    assert.equal(
      await DB.prepare("SELECT code FROM campaign_rooms WHERE code=?").bind(room.code).first(),
      null,
    );
    const library = await call("library", undefined, dm.cookie);
    assert.equal(library.data.members.length, 0);
    assert.equal(library.data.backups.length, 1);
    const saved = (await call("read-backup", { id: library.data.backups[0].id }, dm.cookie)).data
      .payload;
    assert.deepEqual(saved.notes, [{ id: "party", to: "party", text: "party message" }]);
    assert.deepEqual(saved.settings, { scale: 2 });
    assert.ok(saved.exportedAt);
    assert.equal(
      (await call("read-backup", { id: library.data.backups[0].id }, player.cookie)).response
        .status,
      404,
    );
  } finally {
    DB.close();
  }
});

test("server monitoring is owner/admin only, no-store and exposes aggregates without secrets", async () => {
  const { DB, env, call, signup } = setup();
  try {
    const member = await signup("monitor@example.com");
    const id = member.data.user.id;
    assert.equal((await call("monitor")).response.status, 401);
    assert.equal((await call("monitor", undefined, member.cookie)).response.status, 403);
    await DB.prepare("INSERT INTO site_roles VALUES (?,'moderator',?)").bind(id, Date.now()).run();
    assert.equal((await call("monitor", undefined, member.cookie)).response.status, 403);
    await DB.prepare("UPDATE site_roles SET role='admin' WHERE user_id=?").bind(id).run();
    env.ASSETS = {
      fetch: async (request) => {
        assert.equal(new URL(request.url).pathname, "/favicon.svg");
        assert.equal(request.method, "HEAD");
        assert.equal(request.headers.get("cookie"), null);
        return new Response(null, { headers: { "content-type": "image/svg+xml" } });
      },
    };
    env.CF_VERSION_METADATA = { id: "release-123", timestamp: "2026-10-02T00:00:00Z" };
    await DB.prepare("INSERT INTO push_config VALUES ('vapid',?)")
      .bind('{"privateKey":"DO-NOT-EXPOSE"}')
      .run();
    const result = await call("monitor", undefined, member.cookie);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
    assert.equal(result.data.status, "healthy");
    assert.equal(result.data.stats.accounts, 1);
    assert.equal(result.data.stats.active5m, 1);
    assert.equal(result.data.stats.pushConfigured, 1);
    assert.equal(result.data.stats.sharedCampaigns, 0);
    assert.equal(result.data.version.id, "release-123");
    assert.doesNotMatch(
      JSON.stringify(result.data),
      /DO-NOT-EXPOSE|monitor@example.com|privateKey|token/,
    );
    await DB.prepare("UPDATE site_roles SET role='owner' WHERE user_id=?").bind(id).run();
    assert.equal((await call("monitor", undefined, member.cookie)).response.status, 200);
    assert.equal(
      (await call("monitor", undefined, member.cookie, "https://evil.example")).response.status,
      403,
    );
    assert.equal((await call("monitor", {}, member.cookie)).response.status, 404);
    env.ASSETS.fetch = async () =>
      new Response("not an asset", { headers: { "content-type": "text/html" } });
    const failedAsset = await call("monitor", undefined, member.cookie);
    assert.equal(failedAsset.data.status, "degraded");
    assert.equal(failedAsset.data.checks[1].status, "unavailable");
    assert.equal(failedAsset.data.stats.accounts, 1);
    await DB.prepare("UPDATE site_roles SET role='moderator' WHERE user_id=?").bind(id).run();
    assert.equal((await call("monitor", undefined, member.cookie)).response.status, 403);
    await DB.prepare("UPDATE site_roles SET role='admin' WHERE user_id=?").bind(id).run();
    await DB.prepare("UPDATE member_access SET status='revoked' WHERE user_id=?").bind(id).run();
    assert.equal((await call("monitor", undefined, member.cookie)).response.status, 403);
  } finally {
    DB.close();
  }
});

test("server monitoring reports partial failure without leaking database exceptions", async () => {
  const { serverMonitor } = await import("../cloudflare/monitoring.mjs");
  const DB = {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes("site_roles")) return { role: "admin" };
          throw new Error("sensitive SQL and credentials");
        },
      };
    },
  };
  const result = await serverMonitor(
    {
      DB,
      ACCOUNT_ORIGIN: origin,
      ASSETS: {
        fetch: async () => new Response(null, { headers: { "content-type": "image/svg+xml" } }),
      },
    },
    "admin",
  );
  assert.equal(result.status, "degraded");
  assert.equal(result.stats, null);
  assert.equal(result.checks[0].status, "unavailable");
  assert.equal(result.checks[1].status, "healthy");
  assert.doesNotMatch(JSON.stringify(result), /sensitive|credentials/);
});

test("bug reports keep member data private, enforce quotas and safely audit triage", async () => {
  const { DB, call, signup } = setup();
  try {
    const a = await signup("bug-a@example.com"),
      b = await signup("bug-b@example.com");
    const payload = {
      requestKey: crypto.randomUUID(),
      title: "Shop stops responding",
      area: "shops",
      description: "<script>alert(1)</script>",
      steps: "Open shop",
      expected: "Items load",
      diagnostics: {
        appVersion: "1.3.1",
        platform: "web",
        browser: "test",
        viewport: "390 × 844",
        token: "must not store",
      },
      status: "fixed",
      user_id: b.data.user.id,
    };
    assert.equal((await call("reports")).response.status, 401);
    assert.equal(
      (await call("reports", payload, a.cookie, "https://evil.example")).response.status,
      403,
    );
    assert.equal(
      (await call("reports", { ...payload, title: "x".repeat(121) }, a.cookie)).response.status,
      400,
    );
    const first = await call("reports", payload, a.cookie);
    assert.equal(first.response.status, 201, JSON.stringify(first.data));
    const id = first.data.id;
    assert.equal((await call("reports", payload, a.cookie)).data.id, id);
    assert.equal((await call("reports", undefined, a.cookie)).data.reports.length, 1);
    assert.equal((await call("reports", undefined, b.cookie)).data.reports.length, 0);
    assert.equal((await call("reports/detail", { id }, b.cookie)).response.status, 404);
    const detail = (await call("reports/detail", { id }, a.cookie)).data;
    assert.equal(detail.status, "new");
    assert.equal(detail.diagnostics.token, undefined);
    assert.equal(detail.description, payload.description);
    assert.equal(detail.user_id, undefined);
    for (let i = 0; i < 4; i++)
      assert.equal(
        (await call("reports", { ...payload, requestKey: crypto.randomUUID() }, a.cookie)).response
          .status,
        201,
      );
    assert.equal(
      (await call("reports", { ...payload, requestKey: crypto.randomUUID() }, a.cookie)).response
        .status,
      429,
    );
    assert.equal((await call("reports", payload, a.cookie)).data.id, id);
    const update = {
      id,
      status: "reviewing",
      priority: "high",
      response: "Reproduced; investigating.",
      revision: 0,
    };
    assert.equal((await call("reports/update", update, a.cookie)).response.status, 403);
    await DB.prepare("INSERT INTO site_roles VALUES (?,'moderator',?)")
      .bind(b.data.user.id, Date.now())
      .run();
    assert.equal((await call("reports?scope=all", undefined, b.cookie)).response.status, 403);
    await DB.prepare("UPDATE site_roles SET role='admin' WHERE user_id=?")
      .bind(b.data.user.id)
      .run();
    assert.equal((await call("reports?scope=all", undefined, b.cookie)).data.reports.length, 5);
    assert.equal((await call("reports/update", update, b.cookie)).response.status, 200);
    assert.equal((await call("reports/update", update, b.cookie)).response.status, 409);
    const revised = (await call("reports/detail", { id }, a.cookie)).data;
    assert.equal(revised.response, update.response);
    assert.equal(revised.revision, 1);
    assert.equal(revised.history.length, 1);
    assert.equal(
      (await call("reports?status=reviewing", undefined, a.cookie)).data.reports.length,
      1,
    );
    assert.equal((await call("reports?offset=-1", undefined, a.cookie)).response.status, 400);
    await DB.prepare("UPDATE member_access SET status='revoked' WHERE user_id=?")
      .bind(b.data.user.id)
      .run();
    assert.equal((await call("reports?scope=all", undefined, b.cookie)).response.status, 403);
  } finally {
    DB.close();
  }
});

test("interactive sheets require active accounts and reject cross-origin changes", async () => {
  const { DB, call, signup } = setup();
  try {
    assert.equal((await call("sheets")).response.status, 401);
    const a = await signup("sheet-api@example.com");
    const { blankSheet } = await import("../src/lib/characters/model.mjs");
    const body = { sheet: blankSheet() };
    assert.equal(
      (await call("sheets/save", body, a.cookie, "https://evil.example")).response.status,
      403,
    );
    const saved = await call("sheets/save", body, a.cookie);
    assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
    assert.equal((await call("sheets", undefined, a.cookie)).data.characters.length, 1);
    await DB.prepare("UPDATE member_access SET status='revoked' WHERE user_id=?")
      .bind(a.data.user.id)
      .run();
    assert.equal(
      (
        await call(
          "sheets/roll",
          {
            id: saved.data.id,
            revision: 0,
            kind: "ability",
            key: "str",
            requestKey: crypto.randomUUID(),
          },
          a.cookie,
        )
      ).response.status,
      403,
    );
  } finally {
    DB.close();
  }
});
