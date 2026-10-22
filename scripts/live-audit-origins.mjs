// Runs one read-only live audit script once per approved origin: AUDIT_ORIGIN first, then each
// AUDIT_LEGACY_ORIGINS entry (comma-separated) that differs from it. Today the list resolves to
// the single website origin, so the audit runs exactly as before (audit P1-6).
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parseOriginList, validateOrigin } from "../src/lib/deployment/origins.mjs";

/** @param {{AUDIT_ORIGIN?: string, AUDIT_LEGACY_ORIGINS?: string}} env */
export function auditOrigins(env) {
  const primary = validateOrigin(env.AUDIT_ORIGIN, true);
  const legacy = parseOriginList(env.AUDIT_LEGACY_ORIGINS).map((origin) => validateOrigin(origin, true));
  return [...new Set([primary, ...legacy])];
}
/** Per-origin environment. The primary origin keeps the existing result paths; each additional
 * origin writes beside them in a folder named after its host, so no evidence is overwritten. */
export function auditEnv(env, origin, primary) {
  const next = { ...env, AUDIT_ORIGIN: origin };
  if (origin !== primary) {
    const host = new URL(origin).host.replace(/[^\w.-]/g, "_");
    next.WEBSITE_SCREENSHOTS = `${env.WEBSITE_SCREENSHOTS || "test-results/website"}/${host}`;
    next.LIVE_RELEASE_RESULTS = `${env.LIVE_RELEASE_RESULTS || "test-results/live-release"}/${host}`;
  }
  return next;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [script, ...args] = process.argv.slice(2);
  if (!script) throw new Error("Usage: node scripts/live-audit-origins.mjs SCRIPT [ARGS...]");
  const origins = auditOrigins(process.env);
  for (const origin of origins) {
    console.log(`Live audit ${script} against ${origin} (${origins.indexOf(origin) + 1}/${origins.length})`);
    const run = spawnSync(process.execPath, [script, ...args], { stdio: "inherit", env: auditEnv(process.env, origin, origins[0]) });
    if (run.status !== 0) {
      console.error(`${script} failed for ${origin}`);
      process.exit(run.status || 1);
    }
  }
}
