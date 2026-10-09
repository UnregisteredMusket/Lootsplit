import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountScenarios, selectAccountScenario, localAuditOrigin, externalAuditRequests } from "./account-scenarios.mjs";

test("focused selection refuses unknown names and cannot narrow CI release coverage", () => {
  assert.equal(selectAccountScenario([], "true"), null);
  for (const name of accountScenarios) {
    assert.equal(selectAccountScenario(["--scenario", name], ""), name);
    assert.throws(() => selectAccountScenario(["--scenario", name], "true"), /every/);
  }
  for (const args of [
    ["--scenario", "typo"],
    ["--grep", "layout"],
    ["--scenario"],
    ["--scenario", "layout", "extra"],
  ])
    assert.throws(() => selectAccountScenario(args, ""));
});

test("destructive account audits refuse production and ambiguous target URLs", () => {
  assert.equal(localAuditOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  for (const origin of [
    "https://lootsplit.oliverstorie2017.workers.dev",
    "http://127.0.0.1.example.com:8080",
    "http://user:pass@localhost:8080",
    "http://localhost",
    "http://localhost:8080/foo",
    "http://localhost:8080?url=remote",
  ])
    assert.throws(() => localAuditOrigin(origin));
});

test("account network isolation intercepts external origins without routing local modules", () => {
  const external = externalAuditRequests("http://127.0.0.1:8080");
  for (const local of [
    "http://127.0.0.1:8080",
    "http://127.0.0.1:8080/",
    "http://127.0.0.1:8080/node_modules/.vite/deps/react.js?v=123",
    "http://127.0.0.1:8080/api/account/library",
  ]) assert.equal(external.test(local), false, local);
  for (const other of [
    "https://127.0.0.1:8080/",
    "http://127.0.0.1:8081/",
    "http://127.0.0.1:80801/",
    "http://127.0.0.1:8080.example.com/",
    "http://127.0.0.1.example.com:8080/",
    "http://localhost:8080/",
    "https://example.com/",
  ]) assert.equal(external.test(other), true, other);
  assert.equal(externalAuditRequests("http://localhost:8080").test("http://localhost:8080/src/router.tsx"), false);
  assert.throws(() => externalAuditRequests("https://example.com"));
});

test("account release audit retains all independent scenarios and failure evidence", () => {
  const source = readFileSync("scripts/browser/account.spec.mjs", "utf8");
  const names = [...source.matchAll(/^test\("([\w-]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(names, accountScenarios);
  assert.doesNotMatch(source, /test\.(only|skip|fixme)/);
  const config = readFileSync("scripts/browser/playwright.config.mjs", "utf8");
  assert.match(config, /forbidOnly: true/);
  assert.match(config, /retries: 0/);
  assert.match(config, /trace: "retain-on-failure"/);
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  assert.doesNotMatch(workflow, /account-browser-audit\.mjs --scenario/);
});

test("packaged Worker checks all belong to one required isolated group", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8")
    .split("  worker:\n")[1]
    .split("  standby:\n")[0];
  const assignments = [
    ...workflow.matchAll(
      /- name: (worker-[\w-]+|Verify title screen on the built artifact)\n\s+if: matrix.group == '([^']+)'/g,
    ),
  ];
  assert.equal(assignments.length, 14);
  assert.ok(assignments.some(([, name, group]) => name === "worker-properties" && group === "interface"));
  assert.ok(assignments.some(([, name, group]) => name === "worker-shop-stock" && group === "interface"));
  assert.ok(assignments.some(([, name, group]) => name === "worker-market-locations" && group === "interface"));
  assert.equal(new Set(assignments.map((m) => m[1])).size, 14);
  assert.ok(assignments.some(([, name, group]) => name === "worker-sound" && group === "interface"));
  for (const [, , group] of assignments) assert.ok(["accounts", "interface"].includes(group));
  assert.match(workflow, /group: \[accounts, interface\]/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /browser-audit-worker-\$\{\{ matrix.group \}\}/);
});
