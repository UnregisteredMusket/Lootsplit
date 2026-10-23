import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { accountLegacyOrigins, accountRequestOrigin, deploymentOrigins, previousDeploymentOrigins, validateOrigin } from "../src/lib/deployment/origins.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
import { localAccountDb } from "./account-dev-db.mjs";
import { readFileSync } from "node:fs";
import { LIVE_AUDIT_WORKFLOWS, assertAuditWorkflow, assertWorkersDev, assertWranglerOrigins, checkDomainReadiness, topLevelValue } from "./domain-readiness.mjs";
import { releaseConfig } from "./release-artifact.mjs";
import { assertAccountOriginBindings } from "./production-preflight.mjs";
import { auditEnv, auditOrigins } from "./live-audit-origins.mjs";
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

// Domain cutover guards (docs/audit/2026-10-22-domain-migration-audit.md P1-1, P1-2, P1-3, P1-6).

const OLD = "https://lootsplit.oliverstorie2017.workers.dev";
const NEW = "https://lootsplitter.com";
// The repository is on the cutover configuration (website lootsplitter.com since 2026-10-23);
// `before` rebuilds the pre-cutover files so both states, and the move between them, stay tested.
const future = { website: NEW, nativeApi: OLD, legacy: [OLD] };
const before = { website: OLD, nativeApi: OLD, legacy: [OLD] };
const cutoverWrangler = readFileSync("wrangler.toml", "utf8");
const cutoverWorkflows = Object.fromEntries(LIVE_AUDIT_WORKFLOWS.map((path) => [path, readFileSync(path, "utf8")]));
const wrangler = cutoverWrangler
  .replace(`ACCOUNT_ORIGIN = "${NEW}"`, `ACCOUNT_ORIGIN = "${OLD}"`)
  .replace(`ACCOUNT_LEGACY_ORIGINS = "${OLD}"`, 'ACCOUNT_LEGACY_ORIGINS = ""');
const preWorkflow = (text) => text.replace(`AUDIT_ORIGIN: ${NEW}`, `AUDIT_ORIGIN: ${OLD}`).replace(`AUDIT_LEGACY_ORIGINS: "${OLD}"`, 'AUDIT_LEGACY_ORIGINS: ""');
const workflows = Object.fromEntries(Object.entries(cutoverWorkflows).map(([path, text]) => [path, preWorkflow(text)]));
const cutoverWorkflow = (text) => text.replace(`AUDIT_ORIGIN: ${OLD}`, `AUDIT_ORIGIN: ${NEW}`).replace('AUDIT_LEGACY_ORIGINS: ""', `AUDIT_LEGACY_ORIGINS: "${OLD}"`);

test("the repository is on the reviewed lootsplitter.com cutover configuration", () => {
  assert.deepEqual({ ...deploymentOrigins, legacy: [...deploymentOrigins.legacy] }, future);
  assert.deepEqual({ website: previousDeploymentOrigins.website, legacy: [...previousDeploymentOrigins.legacy] }, { website: OLD, legacy: [OLD] });
  assert.equal(wrangler === cutoverWrangler, false, "wrangler.toml must hold the cutover account origins");
  checkDomainReadiness({ wrangler: cutoverWrangler, workflows: cutoverWorkflows });
  for (const text of Object.values(cutoverWorkflows)) assert.equal(cutoverWorkflow(preWorkflow(text)), text);
});

test("workers.dev stays explicitly on in source and in the generated release config", () => {
  assert.equal(topLevelValue(wrangler, "workers_dev"), true);
  assertWorkersDev(wrangler);
  assertWorkersDev(releaseConfig(wrangler));
  const without = wrangler.replace(/^workers_dev = true\n/m, "");
  for (const config of [without, wrangler.replace("workers_dev = true", "workers_dev = false"), without + '\n[vars]\nworkers_dev = true\n'])
    assert.throws(() => assertWorkersDev(config), /workers_dev/);
  assert.throws(() => releaseConfig(without), /workers_dev/);
  // A custom domain route added later must not silently turn workers.dev off.
  const withRoute = wrangler.replace("workers_dev = true", 'workers_dev = true\nroutes = [{ pattern = "lootsplitter.com", custom_domain = true }]');
  assertWorkersDev(releaseConfig(withRoute));
});

test("ACCOUNT_LEGACY_ORIGINS equals legacy minus website, today and after a cutover", () => {
  assert.deepEqual(accountLegacyOrigins(), [OLD]);
  assert.deepEqual(accountLegacyOrigins(before), []);
  assertWranglerOrigins(wrangler, before);
  assertWranglerOrigins(cutoverWrangler);
  assert.deepEqual(accountLegacyOrigins(future), [OLD]);
  assertWranglerOrigins(cutoverWrangler, future);
  const two = { ...future, legacy: [OLD, "https://old.example.test"] };
  assertWranglerOrigins(cutoverWrangler.replace(`ACCOUNT_LEGACY_ORIGINS = "${OLD}"`, `ACCOUNT_LEGACY_ORIGINS = "https://old.example.test, ${OLD}"`), two);
  assert.throws(() => assertWranglerOrigins(wrangler, future), /primary website/);
  assert.throws(() => assertWranglerOrigins(cutoverWrangler.replace(`ACCOUNT_LEGACY_ORIGINS = "${OLD}"`, 'ACCOUNT_LEGACY_ORIGINS = ""'), future), /legacy origins other than the website/);
  assert.throws(() => assertWranglerOrigins(cutoverWrangler.replace(/^ACCOUNT_LEGACY_ORIGINS = .*\n/m, ""), future), /explicitly/);
  assert.throws(() => assertWranglerOrigins(cutoverWrangler.replace(`ACCOUNT_LEGACY_ORIGINS = "${OLD}"`, 'ACCOUNT_LEGACY_ORIGINS = "https://*.workers.dev"'), future));
});

test("release preflight accepts unchanged origins and a reviewed transition, and fails closed otherwise", () => {
  const live = (website, legacy) => [{ name: "ACCOUNT_ORIGIN", type: "plain_text", text: website }, ...(legacy === undefined ? [] : [{ name: "ACCOUNT_LEGACY_ORIGINS", type: "plain_text", text: legacy }])];
  const previous = { website: OLD, legacy: [OLD] };
  // Unchanged configuration (today), with the legacy binding empty or not yet created.
  assert.equal(assertAccountOriginBindings(live(OLD, ""), { website: OLD, nativeApi: OLD, legacy: [OLD] }, previous), "current");
  assert.equal(assertAccountOriginBindings(live(OLD), { website: OLD, nativeApi: OLD, legacy: [OLD] }, previous), "current");
  // Defaults are the repository's own (cutover) origins: the first release after the move is a
  // transition from the old bindings, and every later release sees the new bindings as current.
  assert.equal(assertAccountOriginBindings(live(OLD, ""), undefined, previousDeploymentOrigins), "transition");
  assert.equal(assertAccountOriginBindings(live(OLD), undefined, previousDeploymentOrigins), "transition");
  assert.equal(assertAccountOriginBindings(live(NEW, OLD), undefined, previousDeploymentOrigins), "current");
  // The cutover release: live still has the previous values; the new legacy list keeps the old website.
  assert.equal(assertAccountOriginBindings(live(OLD, ""), future, previous), "transition");
  // A re-run after the cutover deployed: live already equals the new values.
  assert.equal(assertAccountOriginBindings(live(NEW, OLD), future, previous), "current");
  // Transition that drops the old website from legacy fails.
  assert.throws(() => assertAccountOriginBindings(live(OLD, ""), { website: NEW, nativeApi: OLD, legacy: [] }, previous), /keep the previous website/);
  assert.throws(() => assertAccountOriginBindings(live(OLD, ""), { website: NEW, nativeApi: OLD, legacy: ["https://other.test"] }, previous), /keep the previous website/);
  // Arbitrary mismatches fail.
  for (const bindings of [live("https://attacker.test", ""), live(OLD, "https://attacker.test"), live(NEW, ""), live(NEW, `${OLD},https://attacker.test`), []])
    assert.throws(() => assertAccountOriginBindings(bindings, future, previous), /match neither/);
});

test("live audits run once per approved origin, and workflow targets match origins.mjs", () => {
  assert.deepEqual(auditOrigins({ AUDIT_ORIGIN: OLD, AUDIT_LEGACY_ORIGINS: "" }), [OLD]);
  assert.deepEqual(auditOrigins({ AUDIT_ORIGIN: OLD }), [OLD]);
  assert.deepEqual(auditOrigins({ AUDIT_ORIGIN: OLD, AUDIT_LEGACY_ORIGINS: OLD }), [OLD]);
  assert.deepEqual(auditOrigins({ AUDIT_ORIGIN: NEW, AUDIT_LEGACY_ORIGINS: ` ${OLD} ,` }), [NEW, OLD]);
  for (const env of [{}, { AUDIT_ORIGIN: NEW, AUDIT_LEGACY_ORIGINS: "http://old.test" }, { AUDIT_ORIGIN: NEW, AUDIT_LEGACY_ORIGINS: `${OLD}/path` }])
    assert.throws(() => auditOrigins(env));
  assert.deepEqual(auditEnv({ AUDIT_ORIGIN: NEW, X: "1" }, NEW, NEW), { AUDIT_ORIGIN: NEW, X: "1" });
  const legacyEnv = auditEnv({ AUDIT_ORIGIN: NEW }, OLD, NEW);
  assert.equal(legacyEnv.AUDIT_ORIGIN, OLD);
  assert.equal(legacyEnv.WEBSITE_SCREENSHOTS, "test-results/website/lootsplit.oliverstorie2017.workers.dev");
  assert.equal(legacyEnv.LIVE_RELEASE_RESULTS, "test-results/live-release/lootsplit.oliverstorie2017.workers.dev");
  checkDomainReadiness({ origins: before, wrangler, workflows });
  checkDomainReadiness({ origins: future, wrangler: cutoverWrangler, workflows: Object.fromEntries(Object.entries(workflows).map(([path, text]) => [path, cutoverWorkflow(text)])) });
  for (const [path, text] of Object.entries(workflows)) {
    assert.throws(() => assertAuditWorkflow(text, future, path), /website origin/);
    assert.throws(() => assertAuditWorkflow(cutoverWorkflow(text).replace(`AUDIT_LEGACY_ORIGINS: "${OLD}"`, 'AUDIT_LEGACY_ORIGINS: ""'), future, path), /AUDIT_LEGACY_ORIGINS/);
    assert.throws(() => assertAuditWorkflow(text.replace("node scripts/live-audit-origins.mjs scripts/website-browser-audit.mjs", "node scripts/website-browser-audit.mjs"), before, path), /once per approved origin/);
  }
});
