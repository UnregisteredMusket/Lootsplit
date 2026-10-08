import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const pending = `await new Promise(resolve => setTimeout(() => { console.log('FINAL_ASSERTIONS_COMPLETED'); resolve(); }, 80).unref());`;
const run = (code) =>
  spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
    encoding: "utf8",
    timeout: 5000,
  });
test("standalone audit liveness retains pending async progress and releases after cleanup", () => {
  const source = new URL("./audit-liveness.mjs", import.meta.url).href;
  const completed = run(
    `import { finishAuditLiveness } from ${JSON.stringify(source)}; try { ${pending} } finally { finishAuditLiveness(); }`,
  );
  assert.equal(completed.error, undefined);
  assert.equal(completed.status, 0, completed.stderr);
  assert.match(completed.stdout, /FINAL_ASSERTIONS_COMPLETED/);
  const idle = run(pending);
  assert.equal(idle.error, undefined);
  assert.doesNotMatch(
    idle.stdout,
    /FINAL_ASSERTIONS_COMPLETED/,
    "Without a live handle an idle process must not be accepted as an audit pass",
  );
});
