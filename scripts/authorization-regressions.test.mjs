import test from "node:test";
import assert from "node:assert/strict";
import { authorizationDatabase } from "./authorization-test-fixture.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";

const origin = "http://localhost:8080";
const password = "disposable audit password with length";
async function setup() {
  const DB = await authorizationDatabase();
  const env = {
    DB,
    ACCOUNT_SECRET: "disposable-audit-secret-123456789012345678901234",
    ACCOUNT_ORIGIN: origin,
  };
  let ip = 0;
  async function call(path, body, cookie = "") {
    const headers = { origin, "cf-connecting-ip": `192.0.2.${++ip}` };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await handleAccounts(
      new Request(`${origin}/api/account/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    };
  }
  async function signup(name, email) {
    const account = await call("auth/sign-up/email", { name, email, password });
    assert.equal(account.status, 200);
    return account;
  }
  async function role(account, value) {
    await DB.prepare(
      "INSERT INTO site_roles VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role",
    )
      .bind(account.data.user.id, value, Date.now())
      .run();
  }
  const profile = (name, revision = 0) => ({
    name,
    revision,
    introduction: "",
    portrait: "",
    contact_email: "private.contact@example.com",
    share_contact: false,
    email_opt_in: false,
  });
  return { DB, env, call, signup, role, profile };
}

test("staff directory searches only fields the role may view, including result counts", async () => {
  const { DB, call, signup, role, profile } = await setup();
  try {
    const moderator = await signup("Moderator", "staff.audit@example.com");
    const admin = await signup("Admin", "admin.audit@example.com");
    const owner = await signup("Owner", "owner.audit@example.com");
    const target = await signup("Name_100%", "private-login-271828@example.com");
    await role(moderator, "moderator");
    await role(admin, "admin");
    await role(owner, "owner");
    assert.equal((await call("profile", profile("Name_100%"), target.cookie)).status, 200);
    for (const query of [
      "private-login-271828@example.com",
      "private-login-271828",
      "private.contact@example.com",
    ]) {
      const found = await call(
        "staff/members?q=" + encodeURIComponent(query),
        undefined,
        moderator.cookie,
      );
      assert.equal(found.status, 200);
      assert.equal(found.data.total, 0, "private fields must not select or count a member");
      assert.deepEqual(found.data.members, []);
    }
    assert.equal(
      (await call("staff/member", { id: target.data.user.id }, moderator.cookie)).data.profile
        .contact_email,
      "",
    );
    for (const query of ["Name_100%", "_", "%"]) {
      const found = await call(
        "staff/members?q=" + encodeURIComponent(query),
        undefined,
        moderator.cookie,
      );
      assert.equal(found.data.total, 1, "wildcards are ordinary literal search text");
      assert.equal(found.data.members[0].id, target.data.user.id);
      assert.equal(found.data.members[0].email, "");
    }
    for (const staff of [admin, owner]) {
      const found = await call(
        "staff/members?q=private-login-271828%40example.com",
        undefined,
        staff.cookie,
      );
      assert.equal(found.data.total, 1);
      assert.equal(found.data.members[0].email, "private-login-271828@example.com");
    }
    assert.equal(
      (await call("profile", { ...profile("Name_100%", 1), share_contact: true }, target.cookie))
        .status,
      200,
    );
    const shared = await call(
      "staff/members?q=private.contact%40example.com",
      undefined,
      moderator.cookie,
    );
    assert.equal(shared.data.total, 1);
    assert.equal(shared.data.members[0].id, target.data.user.id);
  } finally {
    DB.close();
  }
});

test("all exposed profile-name writers bound names and share the optimistic profile revision", async () => {
  const { DB, call, signup, profile } = await setup();
  try {
    const target = await signup("Profile Original", "profile.audit@example.com");
    for (const name of ["", "   ", "N".repeat(81), "N".repeat(15000)]) {
      assert.equal((await call("profile", profile(name), target.cookie)).status, 400);
      assert.equal(
        (await call("auth/update-user", { name, revision: 0 }, target.cookie)).status,
        400,
      );
      assert.equal(
        (
          await call("auth/sign-up/email", {
            email: crypto.randomUUID() + "@example.com",
            name,
            password,
          })
        ).status,
        400,
      );
    }
    assert.equal((await call("auth/update-user", { name: "New name" }, target.cookie)).status, 400);
    assert.equal(
      (
        await call(
          "auth/update-user",
          { name: "  " + "N".repeat(80) + "  ", revision: 0, role: "owner" },
          target.cookie,
        )
      ).status,
      200,
    );
    const after = await call("library", undefined, target.cookie);
    assert.equal(after.data.profile.name, "N".repeat(80));
    assert.equal(after.data.profile.revision, 1);
    assert.equal(after.data.user.role, "member");
    assert.equal((await call("profile", profile("Stale draft", 0), target.cookie)).status, 409);
    assert.equal(
      (await call("auth/update-user", { name: "Stale generic edit", revision: 0 }, target.cookie))
        .status,
      409,
    );
    assert.equal((await call("profile", profile("App edit", 1), target.cookie)).status, 200);
    assert.equal(
      (
        await call(
          "auth/update-user",
          { image: "https://example.com/avatar.png", revision: 2 },
          target.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await DB.prepare("SELECT image FROM user WHERE id=?").bind(target.data.user.id).first())
        .image,
      "https://example.com/avatar.png",
    );
    assert.equal(
      (await call("auth/update-user", { image: null, revision: 3 }, target.cookie)).status,
      200,
    );
    assert.equal((await call("auth/update-user", null, target.cookie)).status, 400);
    assert.equal((await call("library", undefined, target.cookie)).data.profile.revision, 4);
    const boundary = await signup("A".repeat(80), "boundary.name@example.com");
    assert.equal((await call("library", undefined, boundary.cookie)).data.profile.name.length, 80);
  } finally {
    DB.close();
  }
});

test("in-flight staff actions fail atomically after actor demotion, suspension, session revocation or expiry", async () => {
  for (const action of ["role", "ban", "sessions", "expiry"]) {
    const { DB, call, signup, role } = await setup();
    try {
      const owner = await signup("Owner", "owner.race@example.com");
      const admin = await signup("Admin", "admin.race@example.com");
      const target = await signup("Target", "target.race@example.com");
      await role(owner, "owner");
      await role(admin, "admin");
      const originalBatch = DB.batch.bind(DB);
      let held = false,
        arrive,
        resume;
      const arrived = new Promise((resolve) => {
        arrive = resolve;
      });
      const released = new Promise((resolve) => {
        resume = resolve;
      });
      DB.batch = async (statements) => {
        if (!held) {
          held = true;
          arrive();
          await released;
        }
        return originalBatch(statements);
      };
      const ban = call(
        "staff/action",
        {
          id: target.data.user.id,
          action: "ban",
          until: null,
          revision: 0,
          reason: "Synthetic in-flight request",
        },
        admin.cookie,
      );
      await arrived;
      if (action === "expiry") {
        await DB.prepare("UPDATE session SET expiresAt=? WHERE userId=?")
          .bind(new Date(Date.now() - 1000).toISOString(), admin.data.user.id)
          .run();
      } else {
        const revoke = await call(
          "staff/action",
          {
            id: admin.data.user.id,
            action,
            role: "member",
            until: null,
            revision: 0,
            reason: "Synthetic owner revocation",
          },
          owner.cookie,
        );
        assert.equal(revoke.status, 200);
      }
      resume();
      assert.equal((await ban).status, 409, "stale staff authority must not commit");
      const untouched = await DB.prepare(
        "SELECT status,revision FROM member_access WHERE user_id=?",
      )
        .bind(target.data.user.id)
        .first();
      assert.equal(untouched.status, "active");
      assert.equal(untouched.revision, 0);
      assert.equal(
        (
          await DB.prepare("SELECT COUNT(*) AS n FROM moderation_audit WHERE target_id=?")
            .bind(target.data.user.id)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await call(
            "staff/action",
            {
              id: target.data.user.id,
              action: "restore",
              revision: 0,
              reason: "Synthetic follow-up",
            },
            admin.cookie,
          )
        ).status,
        401,
      );
    } finally {
      DB.close();
    }
  }
});

test("passing control: role injection and cross-user profile edits are rejected or ignored", async () => {
  const { DB, call, signup, profile } = await setup();
  try {
    const a = await signup("A", "a.control@example.com");
    const b = await signup("B", "b.control@example.com");
    const injection = await call(
      "profile",
      { ...profile("Updated A"), id: b.data.user.id, userId: b.data.user.id, role: "owner" },
      a.cookie,
    );
    assert.equal(injection.status, 200);
    const me = await call("library", undefined, a.cookie);
    const other = await call("library", undefined, b.cookie);
    assert.equal(me.data.user.role, "member");
    assert.equal(me.data.profile.name, "Updated A");
    assert.equal(other.data.profile.name, "B");
    assert.equal((await call("staff/members", undefined, a.cookie)).status, 403);
    assert.equal((await call("staff/member", { id: b.data.user.id }, a.cookie)).status, 403);
    assert.equal((await call("monitor", undefined, a.cookie)).status, 403);
    assert.equal((await call("owner", undefined, a.cookie)).status, 403);
  } finally {
    DB.close();
  }
});

test("passing control: owner grants require fresh authentication and target revisions", async () => {
  const { DB, call, signup, role } = await setup();
  try {
    const owner = await signup("Owner", "fresh.owner@example.com");
    const target = await signup("Member", "fresh.target@example.com");
    await role(owner, "owner");
    await DB.prepare("UPDATE session SET createdAt=? WHERE userId=?")
      .bind(Date.now() - 601000, owner.data.user.id)
      .run();
    const body = {
      id: target.data.user.id,
      action: "role",
      role: "admin",
      revision: 0,
      reason: "Synthetic grant",
    };
    assert.equal((await call("staff/action", body, owner.cookie)).status, 403);
    const fresh = await call("auth/sign-in/email", { email: "fresh.owner@example.com", password });
    assert.equal(fresh.status, 200);
    assert.equal((await call("staff/action", body, fresh.cookie)).status, 200);
    assert.equal((await call("staff/action", body, fresh.cookie)).status, 409);
    assert.equal(
      (
        await DB.prepare("SELECT COUNT(*) AS n FROM moderation_audit WHERE target_id=?")
          .bind(target.data.user.id)
          .first()
      ).n,
      1,
    );
  } finally {
    DB.close();
  }
});

test("passing control: recovery revokes both account sessions and enforces single use", async () => {
  const { DB, call, signup } = await setup();
  try {
    const account = await signup("Recovery", "recovery.control@example.com");
    const second = await call("auth/sign-in/email", {
      email: "recovery.control@example.com",
      password,
    });
    const key = await call("recovery-key", {}, account.cookie);
    assert.equal(key.status, 200);
    const reset = await call("recover", {
      email: "recovery.control@example.com",
      key: key.data.key,
      password: "new disposable recovery password",
    });
    assert.equal(reset.status, 200);
    assert.equal((await call("library", undefined, account.cookie)).status, 401);
    assert.equal((await call("library", undefined, second.cookie)).status, 401);
    assert.equal(
      (
        await call("recover", {
          email: "recovery.control@example.com",
          key: key.data.key,
          password: "another disposable recovery password",
        })
      ).status,
      401,
    );
    assert.equal(
      (await call("auth/sign-in/email", { email: "recovery.control@example.com", password }))
        .status,
      401,
    );
  } finally {
    DB.close();
  }
});

test("other privileged mutators cannot commit after their verified session is revoked", async () => {
  for (const path of [
    "reports/update",
    "owner/announcement",
    "owner/donations",
    "owner/test-mode-create",
    "owner/test-mode-reset",
  ]) {
    const { DB, call, signup, role } = await setup();
    try {
      const owner = await signup("Owner", "owner.mutator@example.com");
      const member = await signup("Member", "member.mutator@example.com");
      await role(owner, "owner");
      let body,
        endpoint = path;
      if (path === "reports/update") {
        const created = await call(
          "reports",
          {
            title: "Synthetic report",
            description: "Fixture only",
            steps: "",
            expected: "",
            area: "general",
            requestKey: crypto.randomUUID(),
          },
          member.cookie,
        );
        assert.equal(created.status, 201);
        body = {
          id: created.data.id,
          status: "fixed",
          priority: "normal",
          response: "Synthetic response",
          revision: 0,
        };
      } else if (path === "owner/announcement")
        body = {
          title: "Synthetic",
          message: "No external publication",
          published: true,
          revision: 0,
        };
      else if (path === "owner/donations")
        body = { donationUrl: "https://example.com/donate", revision: 0 };
      else {
        endpoint = "owner/test-mode";
        if (path.endsWith("reset")) {
          const created = await call(endpoint, { action: "create" }, owner.cookie);
          assert.equal(created.status, 200);
          body = { action: "reset", code: created.data.code, revision: 1 };
        } else body = { action: "create" };
      }
      const beforeRooms = (await DB.prepare("SELECT COUNT(*) AS n FROM campaign_rooms").first()).n;
      const originalBatch = DB.batch.bind(DB);
      let arrive, resume;
      const arrived = new Promise((resolve) => {
        arrive = resolve;
      });
      const released = new Promise((resolve) => {
        resume = resolve;
      });
      DB.batch = async (statements) => {
        arrive();
        await released;
        return originalBatch(statements);
      };
      const pending = call(endpoint, body, owner.cookie);
      await arrived;
      assert.equal((await call("auth/sign-out", {}, owner.cookie)).status, 200);
      resume();
      assert.equal((await pending).status, 409, path);
      assert.equal(
        (await DB.prepare("SELECT COUNT(*) AS n FROM campaign_rooms").first()).n,
        beforeRooms,
      );
      assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM site_audit").first()).n, 0);
      assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM bug_report_audit").first()).n, 0);
      if (path === "reports/update")
        assert.equal(
          (await DB.prepare("SELECT status FROM bug_reports WHERE id=?").bind(body.id).first())
            .status,
          "new",
        );
      if (path.endsWith("reset"))
        assert.equal(
          (
            await DB.prepare("SELECT revision FROM campaign_rooms WHERE code=?")
              .bind(body.code)
              .first()
          ).revision,
          1,
        );
    } finally {
      DB.close();
    }
  }
});
