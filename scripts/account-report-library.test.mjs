import test from "node:test";
import assert from "node:assert/strict";
import { filterAccountReports } from "../src/lib/account/report-library.ts";

test("account report filters retain distinct campaigns and untouched authorized snapshots", () => {
  const reports = [
    {
      code: "AAA",
      campaign: "Same name",
      name: "Arrival",
      at: 1,
      snapshot: { authorized: "first" },
    },
    {
      code: "BBB",
      campaign: "Same name",
      name: "Arrival",
      at: 2,
      snapshot: { authorized: "second" },
    },
  ];
  const before = structuredClone(reports);
  const all = { search: "", campaign: "all", after: "", before: "" };
  assert.deepEqual(filterAccountReports(reports, all), reports);
  assert.deepEqual(filterAccountReports(reports, { ...all, campaign: "BBB" }), [reports[1]]);
  assert.deepEqual(filterAccountReports(reports, { ...all, search: " aaa " }), [reports[0]]);
  assert.equal(filterAccountReports(reports, { ...all, search: "absent" }).length, 0);
  assert.deepEqual(reports, before);
});

test("report dates include the complete local through-date and exclude the next day", () => {
  const stamp = (date) => new Date(date).getTime();
  const reports = [
    { code: "A", campaign: "One", name: "Before", at: stamp("2026-10-07T23:59:59") },
    { code: "A", campaign: "One", name: "Start", at: stamp("2026-10-08T00:00:00") },
    { code: "A", campaign: "One", name: "End", at: stamp("2026-10-08T23:59:59") },
    { code: "A", campaign: "One", name: "After", at: stamp("2026-10-09T00:00:00") },
  ];
  const filters = { search: "", campaign: "all", after: "2026-10-08", before: "2026-10-08" };
  assert.deepEqual(
    filterAccountReports(reports, filters).map((r) => r.name),
    ["Start", "End"],
  );
  assert.equal(filterAccountReports(reports, { ...filters, after: "2026-10-09" }).length, 0);
  assert.equal(
    filterAccountReports(reports, { ...filters, after: "invalid", before: "invalid" }).length,
    4,
  );
});
