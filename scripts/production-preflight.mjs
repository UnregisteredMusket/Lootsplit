import { accountLegacyOrigins, deploymentOrigins, parseOriginList, previousDeploymentOrigins } from "../src/lib/deployment/origins.mjs";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { verifyArtifact } from "./release-artifact.mjs";
import { assertWorkersDev } from "./domain-readiness.mjs";

export function assertCurrentMain(sha, head) {
  assert.match(sha || "", /^[a-f0-9]{40}$/);
  assert.equal(head, sha, "Stale release: main has advanced; deploy the newer run");
}
export function assertMigrations(expected, applied) {
  assert.deepEqual([...applied].sort(), [...expected].sort(),
    "Production migrations differ from this release. The release job applies pending additive migrations first; read its production-migrations step.");
}
/** The live Worker's ACCOUNT_ORIGIN/ACCOUNT_LEGACY_ORIGINS bindings, read before deploy, must equal
 * either the reviewed source values this release deploys, or (a reviewed transition, audit P1-2)
 * the previous reviewed values recorded in origins.mjs, and then only when the new legacy list
 * keeps the previous website origin. Anything else fails closed. Never prints binding values
 * other than the public origins they are compared with.
 * @returns {"current" | "transition"} */
export function assertAccountOriginBindings(bindings, origins = deploymentOrigins, previous = previousDeploymentOrigins) {
  const live = {
    website: bindings.find(b => b.name === "ACCOUNT_ORIGIN")?.text,
    legacy: parseOriginList(bindings.find(b => b.name === "ACCOUNT_LEGACY_ORIGINS")?.text).sort(),
  };
  const matches = (reviewed) => live.website === reviewed.website && JSON.stringify(live.legacy) === JSON.stringify(accountLegacyOrigins(reviewed));
  if (matches(origins)) return "current";
  assert.ok(matches(previous), "Live account origins match neither this release nor the previous reviewed origins. Review ACCOUNT_ORIGIN and ACCOUNT_LEGACY_ORIGINS before deployment.");
  assert.ok(origins.legacy.includes(previous.website), "An origin transition must keep the previous website origin in the new legacy list.");
  return "transition";
}
export async function cfRequest(path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  // Never print response bodies: bindings may contain sensitive values.
  assert.ok(response.ok && result.success, `Cloudflare preflight request failed (HTTP ${response.status})`);
  return result.result;
}
if (process.argv[1]?.endsWith("/production-preflight.mjs")) {
  const releaseSha = process.env.RELEASE_SHA || process.env.GITHUB_SHA;
  assert.equal(process.env.GITHUB_REPOSITORY, "UnregisteredMusket/Lootsplit");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main");
  for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "GH_TOKEN"])
    assert.ok(process.env[key], `Missing GitHub Actions secret: ${key}`);
  const response = await fetch("https://api.github.com/repos/UnregisteredMusket/Lootsplit/git/ref/heads/main", {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, "Unable to verify current main");
  assertCurrentMain(releaseSha, (await response.json()).object.sha);
  const manifest = verifyArtifact("dist/website-release", releaseSha);
  const settings = await cfRequest("workers/scripts/lootsplit/settings");
  const bindings = settings.bindings;
  assert.equal(bindings.find(b => b.name === "DB")?.id ?? bindings.find(b => b.name === "DB")?.database_id, "0a200e96-ae2e-47b5-9869-c1f4d316148f");
  for (const [name, type] of [["ACCOUNT_SECRET", "secret_text"], ["ASSETS", "assets"], ["CF_VERSION_METADATA", "version_metadata"], ["ROOM_ENTRY_LIMIT", "ratelimit"]])
    assert.equal(bindings.find(b => b.name === name)?.type, type, `Missing existing ${name} binding`);
  const known = new Set(["DB", "ACCOUNT_SECRET", "ASSETS", "CF_VERSION_METADATA", "ROOM_ENTRY_LIMIT", "ACCOUNT_ORIGIN", "ACCOUNT_LEGACY_ORIGINS"]);
  assert.ok(bindings.every(b => known.has(b.name) || ["plain_text", "secret_text"].includes(b.type)), "New bindings require a reviewed release config update");
  const originState = assertAccountOriginBindings(bindings);
  const rows = await cfRequest("d1/database/0a200e96-ae2e-47b5-9869-c1f4d316148f/query", { sql: "SELECT name FROM d1_migrations ORDER BY name" });
  assertMigrations(Object.keys(manifest.files).filter(n => n.startsWith("migrations/")).map(n => n.slice(11)), rows[0].results.map(r => r.name));
  const deployments = await cfRequest("workers/scripts/lootsplit/deployments");
  mkdirSync("test-results", { recursive: true });
  const record = { commit: manifest.commit, previousDeployment: deployments.deployments[0], accountOrigins: originState, checkedAt: new Date().toISOString() };
  writeFileSync("test-results/production-preflight.json", JSON.stringify(record, null, 2) + "\n");
  // Ensure the serialized upload config remains pinned to the established Worker.
  const releaseConfig = readFileSync("dist/website-release/wrangler.toml", "utf8");
  assert.match(releaseConfig, /^name = "lootsplit"/);
  assertWorkersDev(releaseConfig, "dist/website-release/wrangler.toml");
  console.log(`Production preflight passed for ${manifest.commit}; no database writes performed.`);
}
