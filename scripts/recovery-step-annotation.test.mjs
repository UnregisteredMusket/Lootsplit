import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failureAnnotation, failureCollector, runStep } from "./recovery-step.mjs";

test("failed steps report their last output lines as a single GitHub error annotation", () => {
  const output = Array.from({ length: 60 }, (_, i) => `line ${i} 100%`).join("\n");
  const annotation = failureAnnotation("dev-campaign-governance", "failed", "\x1b[31m" + output);
  assert.match(annotation, /^::error title=dev-campaign-governance failed::/);
  assert.equal(annotation.split("\n").length, 1, "one workflow command line");
  assert.match(annotation, /line 59 100%25$/);
  assert.doesNotMatch(annotation, /line 19 /, "only the last 40 lines");
  assert.ok(!annotation.includes("\x1b"), "color codes removed");
  assert.match(failureAnnotation("x", "timed_out", ""), /\(no output\)$/);
});

test("output still reaches the log and a failing command stays failed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "recovery-step-"));
  const record = await runStep({
    id: "annotation-check",
    seconds: 20,
    command: process.execPath,
    args: ["-e", "console.log('visible'); console.error('boom'); process.exit(3)"],
    directory,
  });
  assert.equal(record.status, "failed");
  assert.equal(record.code, 3);
});

test("failing test names are listed first even when they scrolled out of the tail", () => {
  const collector = failureCollector();
  collector.push("ok 1 - fine\n# Subtest: broken\nnot ok 2 - property imp");
  collector.push("orts stay fresh\n  ---\n  error: 'Expected values to be strictly equal'\n  location: 'x.test.ts:9:3'\n  ...\n");
  for (let i = 3; i < 200; i += 1) collector.push(`ok ${i} - passing ${i}\n`);
  assert.deepEqual(collector.failures.slice(0, 1), ["not ok 2 - property imports stay fresh"]);
  assert.ok(collector.failures.some((line) => line.includes("Expected values to be strictly equal")));
  const annotation = failureAnnotation("unit-tests", "failed", "ok 199 - passing 199", collector.failures);
  assert.match(annotation, /::Failed tests:%0Anot ok 2 - property imports stay fresh/);
  assert.equal(annotation.split("\n").length, 1);
});
