import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deploymentOrigins } from "../src/lib/deployment/origins.mjs";
import { EVIDENCE_HOSTS, links } from "../cloudflare/monitor-model.mjs";
import { standbyOrigin } from "../standby/state.mjs";

const lootsplitOrigins = [deploymentOrigins.website, deploymentOrigins.nativeApi, ...deploymentOrigins.legacy];

test("monitor evidence links accept every configured Lootsplit origin, GitHub and Cloudflare, and nothing else", () => {
  for (const origin of lootsplitOrigins) assert.ok(EVIDENCE_HOSTS.includes(new URL(origin).hostname), origin);
  for (const url of [...lootsplitOrigins.map((o) => o + "/account"), "https://github.com/x/y/pull/1", "https://dash.cloudflare.com/a"])
    assert.equal(links([{ label: "evidence", url }])[0].url, new URL(url).href);
  for (const url of ["https://evil.example/", "http://github.com/x", "https://user:pw@github.com/", "https://github.com.evil.example/"])
    assert.throws(() => links([{ label: "bad", url }]), /evidence URL/, url);
});

test("the standby refuses the primary website, native API and legacy origins", () => {
  for (const origin of lootsplitOrigins) assert.throws(() => standbyOrigin(origin + "/"), /standby origin/);
  assert.throws(() => standbyOrigin("http://standby.example"), /standby origin/);
  assert.equal(standbyOrigin("https://standby.example/path"), "https://standby.example");
});

test("origin users read the shared deployment config instead of a host literal", () => {
  for (const file of ["scripts/development-status.mjs", "scripts/monitor-publish.mjs", "cloudflare/monitor-model.mjs", "standby/server.mjs", "standby/state.mjs", "src/lib/quire/push.server.ts", "src/components/website/about.tsx"]) {
    const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    const literals = [...source.matchAll(/https:\/\/lootsplit\.oliverstorie2017\.workers\.dev[^"'`\s]*/g)].map((m) => m[0]);
    // The OIDC audience is an opaque identifier that GitHub signs; it deliberately stays fixed (audit #10/#12).
    assert.deepEqual(literals.filter((l) => l !== "https://lootsplit.oliverstorie2017.workers.dev/monitoring"), [], file);
  }
  const about = readFileSync(new URL("../src/components/website/about.tsx", import.meta.url), "utf8");
  assert.match(about, /\$\{deploymentOrigins\.website\}\/welcome/);
  assert.doesNotMatch(about, /API_ORIGIN/);
  const status = readFileSync(new URL("../scripts/development-status.mjs", import.meta.url), "utf8");
  assert.match(status, /Origin: deploymentOrigins\.website/);
});
