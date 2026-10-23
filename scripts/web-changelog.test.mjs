import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HISTORY_FILE,
  OPT_OUT_LABEL,
  collectEntries,
  historyProblems,
  isUserVisible,
  noteCommits,
  noteProblems,
  pullRequestDecision,
  readNotes,
  stampNotes,
  withoutBookkeeping,
} from "./web-changelog.mjs";

const history = JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
const note = (title) => ({ title, summary: `${title} summary.`, items: [`${title} item.`] });

test("committed history and pending notes are valid and public-safe", () => {
  assert.deepEqual(historyProblems(history), []);
  readNotes(); // throws on any invalid note
  // Backfilled history runs from the October 7 release without gaps in its dates' order.
  const dates = history.map((entry) => entry.date);
  assert.deepEqual([...dates].sort(), dates);
  assert.equal(history[0].commit, "fb776325721f940143bc0c1bd3aadb3e147aa95d");
  assert.ok(history.length >= 14);
});

test("notes reject private or unhelpful content", () => {
  assert.deepEqual(noteProblems(note("Even coin splits")), []);
  assert.match(noteProblems({ ...note("x"), items: [] }).join(), /1 to 10/);
  assert.match(noteProblems({ ...note("x"), summary: "Mail owner@example.com" }).join(), /email/);
  assert.deepEqual(
    noteProblems({ ...note("x"), summary: "Write to support@lootsplitter.com." }),
    [],
  );
  assert.match(noteProblems({ ...note("x"), items: ["Fixes #123"] }).join(), /PR number/);
  assert.match(noteProblems({ ...note("x"), items: ["a".repeat(40) + " token"] }).join(), /token/);
  assert.match(noteProblems({ ...note("x"), commit: "abc" }).join(), /unknown fields/);
  assert.match(noteProblems({ ...note("x"), title: "t".repeat(81) }).join(), /limit 80/);
});

test("history rejects entries without deployed evidence", () => {
  const [entry] = history;
  assert.match(historyProblems([{ ...entry, commit: "fb77632" }]).join(), /full deployed commit/);
  assert.match(historyProblems([entry, entry]).join(), /unique id/);
  assert.match(historyProblems([{ ...entry, date: "2026-02-30" }]).join(), /invalid date/);
  assert.match(
    historyProblems([{ ...entry, evidence: entry.evidence.slice(0, 2) }]).join(),
    /Publication and live checks/,
  );
});

test("user-visible pull requests need a note or an explicit opt-out", () => {
  assert.equal(isUserVisible("src/components/website/updates.tsx"), true);
  assert.equal(isUserVisible("cloudflare/worker.mjs"), true);
  assert.equal(isUserVisible("src/lib/quire/commands.test.ts"), false);
  assert.equal(isUserVisible("docs/CODING-MANUAL.md"), false);
  assert.equal(isUserVisible(".github/workflows/verify.yml"), false);
  const code = ["src/routes/maps.tsx", "src/lib/help/content.ts"];
  assert.equal(pullRequestDecision({ files: ["docs/x.md", "scripts/a.mjs"] }).ok, true);
  const missing = pullRequestDecision({ files: code });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /web-changes\/<branch-name>\.json/);
  assert.equal(
    pullRequestDecision({ files: [...code, "src/lib/website/web-changes/feature-x.json"] }).ok,
    true,
  );
  assert.equal(pullRequestDecision({ files: [...code, HISTORY_FILE] }).ok, true);
  assert.equal(pullRequestDecision({ files: code, labels: [OPT_OUT_LABEL] }).ok, true);
  assert.equal(
    pullRequestDecision({ files: code, body: "## Notes\nWeb changelog: none — test-only refactor" })
      .ok,
    true,
  );
  // A bare "none" without a reason is not an opt-out.
  assert.equal(pullRequestDecision({ files: code, body: "Web changelog: none" }).ok, false);
});

const deploys = [
  { sha: "a".repeat(40), date: "2026-10-24T10:00:00Z", verifyRunId: 11, deployRunId: 21 },
  { sha: "b".repeat(40), date: "2026-10-24T15:00:00Z", verifyRunId: 12, deployRunId: 22 },
  { sha: "c".repeat(40), date: "2026-10-25T09:00:00Z", verifyRunId: 13, deployRunId: 23 },
];
// Linear history: note commit n is contained by every deploy from index n onward.
const containsBy = (map) => (deploySha, noteCommit) =>
  deploys.findIndex((d) => d.sha === deploySha) >= map[noteCommit];

test("notes are stamped with the first successful deploy that contains them, grouped by day", () => {
  const notes = [
    { path: "n/one.json", note: note("One"), commit: "n1", pr: 301 },
    { path: "n/two.json", note: note("Two"), commit: "n2", pr: 302 },
    { path: "n/three.json", note: note("Three"), commit: "n3", pr: 303 },
    { path: "n/four.json", note: note("Four"), commit: "n4", pr: 304 },
  ];
  const current = { sha: "d".repeat(40), date: "2026-10-25T20:00:00Z", verifyRunId: 14 };
  const entries = stampNotes({
    notes,
    deploys,
    contains: containsBy({ n1: 0, n2: 1, n3: 2, n4: 99 }),
    current,
  });
  assert.deepEqual(
    entries.map((e) => [e.date, e.commit[0], e.title]),
    [
      ["2026-10-24", "b", "One · Two"],
      ["2026-10-25", "d", "Three · Four"],
    ],
  );
  const [day1, day2] = entries;
  assert.deepEqual(day1.improvements, ["One item.", "Two item."]);
  assert.equal(day1.summary, "One summary. Two summary.");
  assert.deepEqual(day1.notes, ["n/one.json", "n/two.json"]);
  assert.deepEqual(
    day1.evidence.map((e) => e.url.replace("https://github.com/UnregisteredMusket/Lootsplit/", "")),
    ["commit/" + "b".repeat(40), "actions/runs/12", "actions/runs/22"],
  );
  // Day 2 spans a finished deploy and the build in progress: compare from the last deploy of
  // day 1, exact verification of this build, publisher history until its run exists.
  assert.deepEqual(
    day2.evidence.map((e) => e.url.replace("https://github.com/UnregisteredMusket/Lootsplit/", "")),
    [
      `compare/${"b".repeat(12)}...${"d".repeat(12)}`,
      "actions/runs/14",
      "actions/workflows/website-release.yml?query=branch%3Amain",
    ],
  );
  assert.deepEqual(Object.keys(withoutBookkeeping(day1)).includes("notes"), false);
  assert.deepEqual(historyProblems(entries.map(withoutBookkeeping)), []);
});

test("a single-PR group links its pull request; nothing is published without a deploy", () => {
  const notes = [{ path: "n/one.json", note: note("One"), commit: "n1", pr: 301 }];
  const [entry] = stampNotes({ notes, deploys, contains: containsBy({ n1: 2 }) });
  assert.equal(entry.evidence[0].url, "https://github.com/UnregisteredMusket/Lootsplit/pull/301");
  assert.equal(entry.commit, "c".repeat(40));
  assert.deepEqual(stampNotes({ notes, deploys, contains: () => false }), []);
});

test("release mode reads note commits from git and refuses to stamp without history", async () => {
  const root = mkdtempSync(join(tmpdir(), "web-changelog-"));
  const run = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  run("init", "-q", "-b", "main");
  run("config", "user.email", "test@example.invalid");
  run("config", "user.name", "Test");
  mkdirSync(join(root, "src/lib/website/web-changes"), { recursive: true });
  writeFileSync(join(root, "src/lib/website/web-changes/a.json"), JSON.stringify(note("A")));
  run("add", ".");
  run("commit", "-qm", "Add A (#401)");
  const [located] = noteCommits(readNotes(root), root);
  assert.equal(located.commit, run("rev-parse", "HEAD"));
  assert.equal(located.pr, 401);
  // Development and pull request builds stamp nothing.
  assert.deepEqual(await collectEntries({ mode: "", root }), []);
  const preview = await collectEntries({ mode: "preview", root });
  assert.equal(preview.length, 1);
  assert.match(preview[0].id, /^preview-/);
  const saved = process.env.GITHUB_RUN_ID;
  delete process.env.GITHUB_RUN_ID;
  try {
    await assert.rejects(collectEntries({ mode: "release", root }), /GITHUB_RUN_ID|GitHub/);
  } finally {
    if (saved !== undefined) process.env.GITHUB_RUN_ID = saved;
  }
});
