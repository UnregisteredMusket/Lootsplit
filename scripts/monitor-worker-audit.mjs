import { blankSheet } from "../src/lib/characters/model.mjs";
// Production-built Worker with disposable local D1 only. Never accepts a remote origin.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { openApplication } from "./title-screen-navigation.mjs";
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
  const overview = () => fetch(origin + "/api/account/owner/monitor", { headers: { cookie } });
  assert.equal((await overview()).status, 403);
  assert.equal(result.status, "healthy", JSON.stringify(result));
  assert.ok(result.stats.accounts >= 1);
  assert.ok(result.checks.every((check) => check.status === "healthy"));
  const report = await fetch(origin + "/api/account/reports", {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({
      requestKey: crypto.randomUUID(),
      title: "Worker report test",
      area: "website",
      description: "Disposable test",
      steps: "",
      expected: "",
    }),
  });
  assert.equal(report.status, 201);
  const reportId = (await report.json()).id;
  const update = await fetch(origin + "/api/account/reports/update", {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({
      id: reportId,
      status: "fixed",
      priority: "normal",
      response: "Verified on built Worker",
      revision: 0,
    }),
  });
  assert.equal(update.status, 200);
  const detail = await fetch(origin + "/api/account/reports/detail", {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({ id: reportId }),
  });
  const reportData = await detail.json();
  assert.equal(reportData.status, "fixed");
  assert.equal(reportData.history.length, 1);
  const api = async (path, body) => {
    const r = await fetch(origin + "/api/account/" + path, {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  const character = await api("sheets/save", { sheet: blankSheet() });
  const request = {
    id: character.id,
    revision: 0,
    kind: "ability",
    key: "str",
    requestKey: crypto.randomUUID(),
  };
  const dice = await api("sheets/roll", request);
  assert.equal(dice.source, "server");
  assert.ok(dice.total >= 1 && dice.total <= 20);
  assert.equal((await api("sheets/roll", request)).id, dice.id);
  assert.equal((await api("sheets/log", { id: character.id })).rolls.length, 1);
  sql(`UPDATE site_roles SET role='moderator' WHERE user_id='${id}'`);
  assert.equal((await monitor()).status, 403);
  assert.equal((await overview()).status, 403);
  sql(`UPDATE site_roles SET role='owner' WHERE user_id='${id}'`);
  const ownerResponse = await overview();
  assert.equal(ownerResponse.status, 200);
  assert.equal(ownerResponse.headers.get("cache-control"), "no-store");
  const owner = await ownerResponse.json();
  assert.equal(owner.account.name, "Worker Monitor Audit");
  assert.equal(owner.health.status, "healthy");
  assert.ok(owner.health.stats.accounts >= 1);
  assert.equal(owner.traffic.state, "not-connected");
  assert.ok(["ready", "unavailable", "not-connected"].includes(owner.development.state));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies(
      cookie.split("; ").map((pair) => {
        const index = pair.indexOf("=");
        return { name: pair.slice(0, index), value: pair.slice(index + 1), url: origin };
      }),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openApplication(page, origin + "/account");
    const field = page.locator(".owner-monitor");
    await field.getByText("Worker Monitor Audit", { exact: true }).waitFor();
    await field.getByText("Services responding", { exact: true }).waitFor();
    await mkdir("test-results/monitor-worker", { recursive: true });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await field.scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await field.screenshot({ path: `test-results/monitor-worker/owner-${width}.png` });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
  console.log(
    "PASS: built Worker monitoring authenticates roles, reads D1, checks actual ASSETS, and denies revoked admin access.",
  );
} finally {
  sql(`DELETE FROM play_rolls WHERE user_id='${id}'`);
  sql(`DELETE FROM bug_reports WHERE user_id='${id}'`);
  sql(`DELETE FROM user WHERE id='${id}'`);
}
