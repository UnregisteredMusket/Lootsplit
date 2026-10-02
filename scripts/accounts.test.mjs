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
