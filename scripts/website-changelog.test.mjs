import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateWebsiteChangelog } from "./website-changelog.mjs";

const entries = JSON.parse(readFileSync("src/lib/website/changelog.json", "utf8"));
const release = JSON.parse(readFileSync("src/lib/website/release.json", "utf8"));

test("published website download has a complete changelog", () => {
  validateWebsiteChangelog(entries, release.version);
});

test("Android release cannot proceed with notes for only an older version", () => {
  assert.throws(() => validateWebsiteChangelog(entries, "99.0.0"), /before publishing/);
});

test("release notes require features, improvements and summarized fixes", () => {
  for (const category of ["features", "improvements", "fixes"]) {
    const incomplete = structuredClone(entries);
    incomplete[0][category] = [];
    assert.throws(() => validateWebsiteChangelog(incomplete, entries[0].version), /needs/);
  }
});

test("changelog rejects ambiguous versions and invalid publication dates", () => {
  assert.throws(
    () => validateWebsiteChangelog([...entries, entries[0]], entries[0].version),
    /unique/,
  );
  const invalid = structuredClone(entries);
  invalid[0].date = "2026-02-30";
  assert.throws(() => validateWebsiteChangelog(invalid, entries[0].version), /date/);
});
