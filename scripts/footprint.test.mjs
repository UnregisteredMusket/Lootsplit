// Footprint check (docs/FOOTPRINT.md, owner decision 2026-11-01). The reference campaign (a synthetic
// year of weekly play, scripts/footprint-fixture.mjs) is played through the real server code and
// measured. A change that grows the stored live campaign, the DM's or a player's synced view, or the
// archive per session by more than 10% fails until its pull request updates
// scripts/footprint-baseline.json with the new values and a reason, and answers the footprint
// questions. Shrinking is welcome: lower the baseline in the same pull request to lock it in.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { measureReferenceCampaign, REFERENCE } from "./footprint-fixture.mjs";

export const FOOTPRINT_TOLERANCE = 0.1;
export const LIVE_CAP_BYTES = 4_000_000;

const baseline = JSON.parse(
  readFileSync(new URL("./footprint-baseline.json", import.meta.url), "utf8"),
);

test("the footprint baseline names its date and reason", () => {
  assert.match(baseline.measuredOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(baseline.reason?.trim().length >= 10, "say why the baseline is what it is");
  for (const key of ["liveStoredBytes", "dmViewBytes", "playerViewBytes", "archiveBytesPerSession"])
    assert.ok(Number.isSafeInteger(baseline.values[key]) && baseline.values[key] > 0, key);
});

test("a year of weekly play stays within the footprint baseline", async () => {
  const measured = await measureReferenceCampaign();
  assert.equal(measured.sessions, REFERENCE.sessions);
  const report = Object.entries(baseline.values).map(([key, before]) => {
    const now = measured[key];
    return { key, before, now, change: (now - before) / before };
  });
  console.log(
    "footprint:\n" +
      report
        .map((r) => `  ${r.key}: ${r.before} -> ${r.now} bytes (${(r.change * 100).toFixed(1)}%)`)
        .join("\n"),
  );
  const grown = report.filter((r) => r.change > FOOTPRINT_TOLERANCE);
  assert.deepEqual(
    grown.map((r) => r.key),
    [],
    `Grew more than ${FOOTPRINT_TOLERANCE * 100}%: ${grown.map((r) => `${r.key} ${r.before} -> ${r.now}`).join(", ")}. ` +
      "Answer the footprint questions (docs/FOOTPRINT.md) in the pull request and update scripts/footprint-baseline.json with the new values and a reason.",
  );
  assert.ok(
    measured.liveStoredBytes < LIVE_CAP_BYTES / 10,
    "the reference campaign uses under 10% of the live cap",
  );
});
