// Production-built Worker with disposable local D1 only. Never accepts a remote origin.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const origin = "http://127.0.0.1:8082";
const signup = await fetch(origin + "/api/account/auth/sign-up/email", {
  method: "POST",
  headers: { origin, "content-type": "application/json", "cf-connecting-ip": "192.0.2.211" },
  body: JSON.stringify({
    email: `monitor-worker-${Date.now()}@example.com`,
    name: "Worker Monitor Audit",
    password: "disposable worker audit password",
  }),
});
assert.equal(signup.status, 200);
const id = (await signup.json()).user.id;
assert.match(id, /^[a-zA-Z0-9_-]+$/);
const cookie = signup.headers
  .getSetCookie()
  .map((v) => v.split(";")[0])
  .join("; ");
function sql(command) {
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--command",
      command,
    ],
    { stdio: "pipe" },
  );
}
async function monitor() {
  return fetch(origin + "/api/account/monitor", { headers: { cookie } });
}
try {
  assert.equal((await monitor()).status, 403);
  sql(`INSERT INTO site_roles VALUES ('${id}','admin',${Date.now()})`);
  const response = await monitor();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.equal(result.status, "healthy", JSON.stringify(result));
  assert.ok(result.stats.accounts >= 1);
  assert.ok(result.checks.every((check) => check.status === "healthy"));
  sql(`UPDATE site_roles SET role='moderator' WHERE user_id='${id}'`);
  assert.equal((await monitor()).status, 403);
  console.log(
    "PASS: built Worker monitoring authenticates roles, reads D1, checks actual ASSETS, and denies revoked admin access.",
  );
} finally {
  sql(`DELETE FROM user WHERE id='${id}'`);
}
