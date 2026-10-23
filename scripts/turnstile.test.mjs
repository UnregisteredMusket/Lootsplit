import test from "node:test";
import assert from "node:assert/strict";
import { captchaConfig, verifyCaptcha, TURNSTILE_SITE_KEY } from "../cloudflare/turnstile.mjs";

const env = { TURNSTILE_SECRET_KEY: "secret-test" };
const post = (headers = {}) =>
  new Request("https://lootsplitter.com/api/account/auth/sign-up/email", {
    method: "POST",
    headers: { "cf-connecting-ip": "203.0.113.9", ...headers },
  });
const opts = (over = {}) => ({
  path: "/api/account/auth/sign-up/email",
  native: false,
  hostnames: ["lootsplitter.com"],
  ...over,
});
function siteverify(result, calls = []) {
  return async (url, init) => {
    calls.push({ url, body: Object.fromEntries(new URLSearchParams(init.body)) });
    return new Response(JSON.stringify(result), { status: 200 });
  };
}

test("off without the secret; the config never exposes the secret", async () => {
  assert.deepEqual(captchaConfig({}), { required: false, siteKey: "" });
  assert.deepEqual(captchaConfig(env), { required: true, siteKey: TURNSTILE_SITE_KEY });
  assert.doesNotMatch(JSON.stringify(captchaConfig(env)), /secret-test/);
  assert.equal(await verifyCaptcha({}, post(), opts()), "not-configured");
});

test("only sign-up, sign-in and recovery-key reset are protected", async () => {
  assert.equal(await verifyCaptcha(env, post(), opts({ path: "/api/account/library" })), "not-protected");
  assert.equal(await verifyCaptcha(env, post(), opts({ path: "/api/account/auth/sign-out" })), "not-protected");
});

test("installed Android apps are exempt", async () => {
  assert.equal(await verifyCaptcha(env, post(), opts({ native: true })), "native-app");
});

test("a missing token is refused before Cloudflare is asked", async () => {
  const calls = [];
  await assert.rejects(verifyCaptcha(env, post(), opts({ fetchImpl: siteverify({}, calls) })), (e) => e.status === 400);
  assert.equal(calls.length, 0);
});

test("a valid token for this host and action passes, and the IP and secret are sent", async () => {
  const calls = [];
  const fetchImpl = siteverify({ success: true, hostname: "lootsplitter.com", action: "signup" }, calls);
  assert.equal(await verifyCaptcha(env, post({ "x-captcha-response": "tok" }), opts({ fetchImpl })), "verified");
  assert.deepEqual(calls[0].body, { secret: "secret-test", response: "tok", remoteip: "203.0.113.9" });
  assert.equal(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
});

test("failed, wrong-host and wrong-action tokens are refused", async () => {
  for (const result of [
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    { success: true, hostname: "evil.example", action: "signup" },
    { success: true, hostname: "lootsplitter.com", action: "signin" },
  ])
    await assert.rejects(
      verifyCaptcha(env, post({ "x-captcha-response": "tok" }), opts({ fetchImpl: siteverify(result) })),
      (e) => e.status === 403,
      JSON.stringify(result),
    );
});

test("when Cloudflare cannot be reached the request is refused (fail closed)", async () => {
  const fetchImpl = async () => {
    throw new Error("network");
  };
  await assert.rejects(
    verifyCaptcha(env, post({ "x-captcha-response": "tok" }), opts({ fetchImpl })),
    (e) => e.status === 503,
  );
});

test("the account API refuses a website sign-up without the check and accepts the app and a solved check", async () => {
  const { localAccountDb } = await import("./account-dev-db.mjs");
  const { handleAccounts } = await import("../cloudflare/accounts.mjs");
  const origin = "http://localhost:8080";
  const env = {
    DB: localAccountDb(),
    ACCOUNT_SECRET: "only-a-disposable-test-secret-12345678901234567890",
    ACCOUNT_ORIGIN: origin,
    TURNSTILE_SECRET_KEY: "secret-test",
  };
  globalThis.__env__ = env;
  let ip = 0;
  const signUp = (email, headers = {}) =>
    handleAccounts(
      new Request(origin + "/api/account/auth/sign-up/email", {
        method: "POST",
        headers: { origin, "content-type": "application/json", "cf-connecting-ip": `192.0.2.${++ip}`, ...headers },
        body: JSON.stringify({ email, password: "a long unique test password", name: "Human" }),
      }),
      env,
    );
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    String(url).startsWith("https://challenges.cloudflare.com/")
      ? new Response(JSON.stringify({ success: new URLSearchParams(init.body).get("response") === "good", hostname: "localhost", action: "signup" }))
      : realFetch(url, init);
  try {
    const config = await handleAccounts(new Request(origin + "/api/account/captcha", { headers: { origin } }), env);
    assert.deepEqual(await config.json(), { required: true, siteKey: TURNSTILE_SITE_KEY });
    const bare = await signUp("bot@example.com");
    assert.equal(bare.status, 400);
    assert.match((await bare.json()).error, /human check/);
    assert.equal((await signUp("bad@example.com", { "x-captcha-response": "bad" })).status, 403);
    assert.equal((await signUp("human@example.com", { "x-captcha-response": "good" })).status, 200);
    // Installed Android apps keep working without the widget.
    assert.equal((await signUp("app@example.com", { origin: "https://localhost" })).status, 200);
    const users = await env.DB.prepare("SELECT email FROM user ORDER BY email").all();
    assert.deepEqual(users.results.map((u) => u.email), ["app@example.com", "human@example.com"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Cloudflare's testing secret is accepted locally with its example.com answer; real secrets are not", async () => {
  const answer = { success: true, hostname: "example.com" };
  const testing = { TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" };
  assert.equal(
    await verifyCaptcha(testing, post({ "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" }), opts({ fetchImpl: siteverify(answer) })),
    "verified",
  );
  await assert.rejects(
    verifyCaptcha(env, post({ "x-captcha-response": "tok" }), opts({ fetchImpl: siteverify(answer) })),
    (e) => e.status === 403,
  );
});
