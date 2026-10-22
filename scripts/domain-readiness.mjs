import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountLegacyOrigins, deploymentOrigins, parseOriginList, previousDeploymentOrigins, validateOrigin } from "../src/lib/deployment/origins.mjs";

export const LIVE_AUDIT_WORKFLOWS = Object.freeze([".github/workflows/website-release.yml", ".github/workflows/verify-live.yml"]);
const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

/** A scalar key written before the first [table] of a TOML file (string, boolean or number). */
export function topLevelValue(config, key) {
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (/^\[/.test(line)) return undefined;
    const match = line.match(/^([\w-]+)\s*=\s*(.+)$/);
    if (match?.[1] === key) return JSON.parse(match[2]);
  }
  return undefined;
}
/** A string value inside one [table] of a TOML file. */
export function tableString(config, table, key) {
  let current = "";
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    const heading = line.match(/^\[+([\w.]+)\]+$/);
    if (heading) current = heading[1];
    else if (current === table) {
      const match = line.match(/^([\w-]+)\s*=\s*("[^"]*")$/);
      if (match?.[1] === key) return JSON.parse(match[2]);
    }
  }
  return undefined;
}
/** workers.dev must stay explicitly on: adding routes or a custom domain otherwise turns it off
 * on the next deploy, which breaks installed APKs, widgets and old invitations (audit P1-1). */
export function assertWorkersDev(config, label = "wrangler.toml") {
  assert.equal(topLevelValue(config, "workers_dev"), true, `${label} must set top-level workers_dev = true so the legacy workers.dev host stays attached.`);
}
/** Wrangler account vars must match the reviewed origins (audit P1-3). */
export function assertWranglerOrigins(config, origins = deploymentOrigins) {
  assert.equal(tableString(config, "vars", "ACCOUNT_ORIGIN"), origins.website, "Review Wrangler and the primary website origin together.");
  const legacy = tableString(config, "vars", "ACCOUNT_LEGACY_ORIGINS");
  assert.equal(typeof legacy, "string", "wrangler.toml [vars] must set ACCOUNT_LEGACY_ORIGINS explicitly (empty when no other origin is served).");
  for (const origin of parseOriginList(legacy)) validateOrigin(origin);
  assert.ok(sameSet(parseOriginList(legacy), accountLegacyOrigins(origins)), "ACCOUNT_LEGACY_ORIGINS must list exactly the legacy origins other than the website.");
}
/** Live audits target the website plus every other legacy origin, through the per-origin runner (audit P1-6). */
export function assertAuditWorkflow(workflow, origins = deploymentOrigins, label = "workflow") {
  assert.equal(workflow.match(/AUDIT_ORIGIN: (https:\/\/\S+)/)?.[1], origins.website, `${label}: review live audit targets when changing the website origin.`);
  const legacy = workflow.match(/AUDIT_LEGACY_ORIGINS: "([^"]*)"/)?.[1];
  assert.equal(typeof legacy, "string", `${label}: set AUDIT_LEGACY_ORIGINS explicitly (empty when no other origin is served).`);
  assert.ok(sameSet(parseOriginList(legacy), accountLegacyOrigins(origins)), `${label}: AUDIT_LEGACY_ORIGINS must list exactly the legacy origins other than the website.`);
  for (const script of ["live-release-audit.mjs", "website-browser-audit.mjs"]) {
    const lines = workflow.split("\n").filter((line) => line.includes(`scripts/${script}`));
    assert.ok(lines.length > 0, `${label}: missing ${script}`);
    for (const line of lines) assert.match(line, /node scripts\/live-audit-origins\.mjs /, `${label}: run ${script} once per approved origin through live-audit-origins.mjs`);
  }
}
export function checkDomainReadiness({ origins = deploymentOrigins, previous = previousDeploymentOrigins, wrangler, workflows }) {
  for (const origin of [origins.website, origins.nativeApi, ...origins.legacy, previous.website, ...previous.legacy]) validateOrigin(origin);
  assertWorkersDev(wrangler);
  assertWranglerOrigins(wrangler, origins);
  for (const [path, text] of Object.entries(workflows)) assertAuditWorkflow(text, origins, path);
}

if (process.argv[1]?.endsWith("/domain-readiness.mjs")) {
  checkDomainReadiness({
    wrangler: readFileSync("wrangler.toml", "utf8"),
    workflows: Object.fromEntries(LIVE_AUDIT_WORKFLOWS.map((path) => [path, readFileSync(path, "utf8")])),
  });
  console.log(JSON.stringify({ ok: true, activated: false, origins: deploymentOrigins, previousOrigins: previousDeploymentOrigins, workersDev: true, accountLegacyOrigins: accountLegacyOrigins(), remaining: ["Owner-selected domain and approved DNS/TLS activation", "Registrar and Cloudflare account security review", "Real two-host cutover, legacy APK and rollback rehearsal before activation"] }, null, 2));
}
