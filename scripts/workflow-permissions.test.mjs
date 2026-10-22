import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Minimal reader for this repository's workflow layout (2-space YAML, no anchors): enough to pin
// which permissions each job holds without a YAML dependency.
function permissionBlock(lines, indent) {
  const result = {};
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(new RegExp(`^ {${indent}}([\\w-]+):\\s*(\\S+)`));
    if (!match) break;
    result[match[1]] = match[2];
  }
  return result;
}

function readWorkflow(name) {
  const text = readFileSync(`.github/workflows/${name}`, "utf8");
  const lines = text.split("\n");
  const permissionsAt = lines.findIndex((line) => /^permissions:/.test(line));
  const workflow =
    permissionsAt < 0
      ? null
      : /^permissions:\s*\{\}/.test(lines[permissionsAt])
        ? {}
        : permissionBlock(lines.slice(permissionsAt + 1), 2);
  const jobsAt = lines.indexOf("jobs:");
  const jobs = {};
  let current = null;
  for (const line of lines.slice(jobsAt + 1)) {
    const header = line.match(/^ {2}([\w-]+):\s*$/);
    if (header) {
      current = jobs[header[1]] = { lines: [] };
      continue;
    }
    if (/^\S/.test(line)) break;
    current?.lines.push(line);
  }
  for (const job of Object.values(jobs)) {
    const at = job.lines.findIndex((line) => /^ {4}permissions:\s*$/.test(line));
    job.permissions = at < 0 ? null : permissionBlock(job.lines.slice(at + 1), 6);
    job.body = job.lines.join("\n");
  }
  return { text, workflow, jobs };
}

// Release and verification workflows (audit C01/C02). Other workflows are reviewed separately.
const workflows = [
  "verify.yml",
  "website-release.yml",
  "standby-release.yml",
  "verify-live.yml",
  "android-release.yml",
  "android-widget.yml",
  "android-test-apk.yml",
];
// The only OIDC consumer is scripts/monitor-publish.mjs, reached through scripts/recovery-step.mjs.
const publishesTelemetry = (job) =>
  /scripts\/recovery-step\.mjs/.test(job.body) || /uses: \.\/\.github\/workflows\/verify\.yml/.test(job.body);

test("no workflow grants an OIDC token or write access at workflow level", () => {
  for (const name of workflows) {
    const { workflow } = readWorkflow(name);
    if (!workflow) continue;
    assert.equal(workflow["id-token"], undefined, `${name}: id-token belongs on the jobs that use it`);
    for (const [scope, level] of Object.entries(workflow))
      assert.notEqual(level, "write", `${name}: ${scope}: write belongs on the jobs that use it`);
  }
});

test("only jobs that publish recovery-step telemetry hold id-token: write, and all of them do", () => {
  for (const name of workflows) {
    const { workflow, jobs } = readWorkflow(name);
    for (const [id, job] of Object.entries(jobs)) {
      const effective = job.permissions ?? workflow ?? {};
      if (publishesTelemetry(job))
        assert.equal(effective["id-token"], "write", `${name} ${id}: telemetry needs id-token: write`);
      else assert.equal(effective["id-token"], undefined, `${name} ${id}: no step uses OIDC`);
    }
  }
});

test("release jobs keep the write and artifact access their steps need", () => {
  const website = readWorkflow("website-release.yml").jobs.deploy.permissions;
  assert.deepEqual(website, { contents: "read", actions: "read", "id-token": "write" });
  const standby = readWorkflow("standby-release.yml").jobs.publish.permissions;
  assert.deepEqual(standby, { contents: "write", actions: "read", "id-token": "write" });
  const live = readWorkflow("verify-live.yml");
  assert.equal(live.jobs.verify.permissions, null);
  assert.deepEqual(live.workflow, { contents: "read", actions: "read" });
});

test("Android signing, emulator upgrade gate and release publishing run in separate jobs", () => {
  const { jobs } = readWorkflow("android-release.yml");
  const signing = Object.entries(jobs).filter(([, job]) => /secrets\.ANDROID_KEYSTORE_BASE64/.test(job.body));
  assert.deepEqual(signing.map(([id]) => id), ["release-apk"]);
  const writers = Object.entries(jobs).filter(([, job]) => job.permissions?.contents === "write");
  assert.deepEqual(writers.map(([id]) => id), ["publish-apk"]);

  const sign = jobs["release-apk"];
  assert.deepEqual(sign.permissions, { contents: "read", "id-token": "write" });
  assert.doesNotMatch(sign.body, /android-emulator-runner|gh release create/);
  // The certificate check precedes the recorded hash that pins the published file.
  const fingerprint = sign.body.indexOf("expected_fingerprint=baca95a880d14d0d8c422c397decd4c9bf0e7f710a3fd6a5be1e47abd3f730a0");
  const hash = sign.body.indexOf('echo "apk-sha256=$apk_sha256" >> "$GITHUB_OUTPUT"');
  assert.ok(fingerprint > 0 && hash > fingerprint);

  const gate = jobs["upgrade-gate"];
  assert.deepEqual(gate.permissions, { contents: "read" });
  assert.doesNotMatch(gate.body, /secrets\./);
  assert.match(gate.body, /needs: \[release-apk\]/);

  const publish = jobs["publish-apk"];
  assert.deepEqual(publish.permissions, { contents: "write", "id-token": "write" });
  assert.match(publish.body, /needs: \[release-apk, upgrade-gate\]/);
  assert.doesNotMatch(publish.body, /secrets\.|setup-android|setup-java|android-emulator-runner|npm ci|gradlew/);

  for (const job of [gate, publish]) {
    assert.match(job.body, /if: needs\.release-apk\.outputs\.skip != 'true'/);
    const check = job.body.indexOf("sha256sum --check --strict");
    assert.match(job.body, /EXPECTED_APK_SHA256: \$\{\{ needs\.release-apk\.outputs\.apk-sha256 \}\}/);
    assert.ok(check > job.body.indexOf("name: lootsplit-signed-apk-candidate"));
  }
  const publishCheck = publish.body.indexOf("sha256sum --check --strict");
  assert.ok(publishCheck < publish.body.indexOf("name: lootsplit-release-apk"));
  assert.ok(publishCheck < publish.body.indexOf("android-publish 180 gh release create"));
  assert.ok(gate.body.indexOf("sha256sum --check --strict") < gate.body.indexOf("android-emulator-runner"));
});
