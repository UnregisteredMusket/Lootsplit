import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticSeverity, monitorHash } from "./diagnostics-filter.ts";

test("widget count chip links open Diagnostics filtered to one severity", () => {
  assert.deepEqual(monitorHash("#monitor-diagnostics-critical"), {
    tab: "diagnostics",
    severity: "critical",
  });
  assert.deepEqual(monitorHash("#monitor-diagnostics-warning"), {
    tab: "diagnostics",
    severity: "warning",
  });
  assert.deepEqual(monitorHash("#monitor-diagnostics-info"), {
    tab: "diagnostics",
    severity: "info",
  });
  // Existing links keep working, unfiltered.
  assert.deepEqual(monitorHash("#monitor-diagnostics"), { tab: "diagnostics", severity: null });
  assert.deepEqual(monitorHash("#monitor-history"), { tab: "history", severity: null });
  assert.deepEqual(monitorHash("#monitor-diagnostics-everything"), { tab: null, severity: null });
  assert.deepEqual(monitorHash("#home-screen-widget"), { tab: null, severity: null });
  assert.deepEqual(monitorHash(""), { tab: null, severity: null });
});

test("severity follows the widget rule, preferring the server's value", () => {
  assert.equal(diagnosticSeverity({ color: "red" }), "critical");
  assert.equal(diagnosticSeverity({ color: "yellow", confirmedFailure: true }), "critical");
  assert.equal(diagnosticSeverity({ color: "yellow" }), "warning");
  assert.equal(diagnosticSeverity({ color: "yellow", coverageLimit: true }), "info");
  assert.equal(diagnosticSeverity({ color: "yellow", required: false }), "info");
  assert.equal(diagnosticSeverity({ color: "green" }), null);
  assert.equal(diagnosticSeverity({ color: "yellow", severity: "info" }), "info");
});
