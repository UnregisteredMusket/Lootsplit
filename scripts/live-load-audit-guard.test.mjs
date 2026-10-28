// The live-campaign load audit runs only when the owner authorizes it (owner, 2026-10-28:
// "Ensure this audit does not repeat without my authorization"). This test keeps it out of every
// workflow, schedule and npm script, and proves each script refuses to start without the owner's
// authorization or under CI. It never runs the audit itself.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const AUDIT_SCRIPTS = [
  "scripts/live-load-audit.mjs",
  "scripts/live-load-browser-audit.mjs",
  "scripts/live-load-ratelimit-check.mjs",
  "scripts/live-load-receipts-check.mjs",
];

test("no workflow, schedule or npm script starts the live-campaign load audit", () => {
  const workflows = readdirSync(".github/workflows").filter((f) => /\.ya?ml$/.test(f));
  for (const file of workflows)
    assert.doesNotMatch(readFileSync(`.github/workflows/${file}`, "utf8"), /live-load/, file);
  assert.doesNotMatch(JSON.stringify(JSON.parse(readFileSync("package.json", "utf8")).scripts), /live-load/);
  for (const file of ["wrangler.toml", "render.yaml"])
    assert.doesNotMatch(readFileSync(file, "utf8"), /live-load/, file);
});

test("each load-audit script refuses to start without the owner's authorization, and in CI", () => {
  for (const script of AUDIT_SCRIPTS) {
    const source = readFileSync(script, "utf8");
    assert.match(source, /OWNER AUTHORIZATION REQUIRED/, script);
    const run = (env) =>
      spawnSync(process.execPath, ["--experimental-strip-types", script], {
        env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
        encoding: "utf8",
        timeout: 20000,
      });
    const missing = run({});
    assert.notEqual(missing.status, 0, `${script} ran without authorization`);
    assert.match(missing.stderr, /Owner authorization required|never runs in CI|Never in CI/, script);
    const ci = run({ CI: "true", LOOTSPLIT_LOAD_AUDIT: "owner-2026-10-28" });
    assert.notEqual(ci.status, 0, `${script} ran in CI`);
    assert.match(ci.stderr, /CI/, script);
  }
});
