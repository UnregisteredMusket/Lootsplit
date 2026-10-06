import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deploymentOrigins, validateOrigin } from "../src/lib/deployment/origins.mjs";
for (const origin of [deploymentOrigins.website, deploymentOrigins.nativeApi, ...deploymentOrigins.legacy]) validateOrigin(origin);
const wrangler = readFileSync("wrangler.toml", "utf8");
assert.equal(wrangler.match(/^ACCOUNT_ORIGIN = "([^"]+)"/m)?.[1], deploymentOrigins.website, "Review Wrangler and the primary website origin together.");
for (const path of [".github/workflows/website-release.yml", ".github/workflows/verify-live.yml"]) {
  const workflow = readFileSync(path, "utf8");
  assert.equal(workflow.match(/AUDIT_ORIGIN: (https:\/\/\S+)/)?.[1], deploymentOrigins.website, "Review live audit targets when changing the website origin.");
}
console.log(JSON.stringify({ ok: true, activated: false, origins: deploymentOrigins, remaining: ["Owner-selected domain and approved DNS/TLS activation", "Registrar and Cloudflare account security review", "Real two-host cutover, legacy APK and rollback rehearsal before activation"] }, null, 2));
