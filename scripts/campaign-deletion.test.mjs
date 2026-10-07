import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("interrupted deletion recovery cannot overwrite newer campaign registry metadata", () => {
  const child=spawnSync(process.execPath,["--experimental-strip-types","scripts/campaign-deletion-fixture.mjs"],{encoding:"utf8",timeout:10000});
  assert.equal(child.error,undefined);
  assert.equal(child.status,0,child.stderr||child.stdout);
  assert.match(child.stdout,/preserves newer tab/);
});
