import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failureAnnotation, runStep } from "./recovery-step.mjs";

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
