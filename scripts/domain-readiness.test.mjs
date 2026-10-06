import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { accountRequestOrigin, deploymentOrigins, validateOrigin } from "../src/lib/deployment/origins.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
import { localAccountDb } from "./account-dev-db.mjs";
test("domain configuration rejects ambiguous, insecure and deceptive origins", () => {
  assert.equal(validateOrigin(deploymentOrigins.website), deploymentOrigins.website);
  for (const origin of ["https://good.test/", "https://good.test/path", "https://good.test?next=bad", "http://good.test", "https://user:password@good.test", "https://*.good.test", "https://localhost"])
    assert.throws(() => validateOrigin(origin));
  const env = { ACCOUNT_ORIGIN: "https://new.test", ACCOUNT_LEGACY_ORIGINS: "https://old.test" };
  assert.equal(accountRequestOrigin(env, "https://old.test/api/account/library"), "https://old.test");
  for (const origin of ["https://new.test.attacker.test", "https://attacker.test", "http://new.test"])
    assert.throws(() => accountRequestOrigin(env, origin));
});
test("two explicit origins keep independent host-only sign-ins and reject cross-site mutations", async () => {
  const db = localAccountDb();
  const env = { DB: db, ACCOUNT_SECRET: "disposable-origin-test-secret-123456789", ACCOUNT_ORIGIN: "https://new.test", ACCOUNT_LEGACY_ORIGINS: "https://old.test" };
  const request = (host, path, data, origin = host, extra = {}) => handleAccounts(new Request(host + "/api/account/" + path, { method: "POST", headers: { origin, "content-type": "application/json", ...extra }, body: JSON.stringify(data) }), env);
  try {
    const data = { name: "Origin tester", email: "origin@example.test", password: "disposable-test-password" };
    const signup = await request("https://old.test", "auth/sign-up/email", data);
    assert.equal(signup.status, 200, await signup.clone().text());
    const oldCookie = signup.headers.get("set-cookie");
    assert.match(oldCookie, /Secure/i);
    assert.doesNotMatch(oldCookie, /;\s*Domain=/i);
    const login = await request("https://new.test", "auth/sign-in/email", data);
    assert.equal(login.status, 200, await login.clone().text());
    assert.notEqual(login.headers.get("set-cookie"), oldCookie);
    assert.doesNotMatch(login.headers.get("set-cookie"), /;\s*Domain=/i);
    for (const attacker of ["https://new.test.attacker.test", "https://attacker.test", "http://new.test", "https://old.test"])
      assert.equal((await request("https://new.test", "auth/sign-in/email", data, attacker)).status, 403);
    assert.equal((await request("https://attacker.test", "auth/sign-in/email", data, "https://new.test", { "x-forwarded-host": "new.test" })).status, 403);
    const redirect = await request("https://new.test", "auth/sign-in/email", { ...data, callbackURL: "https://attacker.test" });
    assert.equal(redirect.status, 403);
    const native = await request("https://old.test", "auth/sign-in/email", data, "https://localhost");
    assert.equal(native.status, 200);
    assert.equal(native.headers.get("access-control-allow-origin"), "https://localhost");
  } finally { db.close(); }
});

test("deployment and read-only audit destinations match reviewed configuration", () => { execFileSync(process.execPath, ["scripts/domain-readiness.mjs"]); });
