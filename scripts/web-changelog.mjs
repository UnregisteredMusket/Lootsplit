// Website and backend changelog: per-PR notes, stamped with the deploy that put them live.
//
// Every user-visible pull request adds one note, src/lib/website/web-changes/<branch>.json:
//   { "title": "…", "summary": "One sentence.", "items": ["…", "…"] }
// Notes carry no commit, date or run: nothing is known about the release while the PR is open.
//
// The main verification build (verify.yml, web-build step, LOOTSPLIT_WEB_CHANGELOG=release)
// stamps them. For each note it finds the commit that added it, then the first successful
// "Deploy verified website" run whose commit contains it, and groups notes by the UTC day of
// that deployed commit. Notes no successful deploy contains yet belong to the commit being
// built, which is what the page describes if that artifact goes live. The stamped entries are
// compiled into the artifact (Vite define), so the release job deploys them unchanged and
// never writes to the repository.
//
// `freeze` (run in an ordinary PR, any time) moves notes that are already live into the
// committed history, src/lib/website/web-releases.json, which keeps the API window short.
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPOSITORY = "UnregisteredMusket/Lootsplit";
export const NOTES_DIR = "src/lib/website/web-changes";
export const HISTORY_FILE = "src/lib/website/web-releases.json";
export const OPT_OUT_LABEL = "no-web-changelog";
const GITHUB = `https://github.com/${REPOSITORY}`;
const RELEASE_WORKFLOW = "website-release.yml";
const VERIFY_WORKFLOW = "verify.yml";

// Paths whose changes reach people using the website, the app it serves or the backend.
const USER_VISIBLE = [/^src\//, /^cloudflare\//, /^public\//, /^server\//];
// Inside those, files that cannot change what anyone sees.
const NOT_USER_VISIBLE = [/\.test\.(?:[cm]?[jt]sx?)$/, /^cloudflare\/migrations\//];

/** True when a changed file needs a website changelog note. */
export function isUserVisible(file) {
  return USER_VISIBLE.some((p) => p.test(file)) && !NOT_USER_VISIBLE.some((p) => p.test(file));
}

/** True when the file is changelog content: a note or the committed history. */
export function isChangelogFile(file) {
  return file === HISTORY_FILE || new RegExp(`^${NOTES_DIR}/[^/]+\\.json$`).test(file);
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PUBLIC_EMAILS = new Set(["support@lootsplitter.com"]);
const SECRET_LIKE = /\b[a-f0-9]{32,}\b|\b(?:ghp|gho|ghs|sk|pk|re)_[A-Za-z0-9]{16,}\b/;

function textProblems(where, text, max) {
  const problems = [];
  if (typeof text !== "string" || !text.trim()) return [`${where} must be non-empty text`];
  if (text.length > max) problems.push(`${where} is ${text.length} characters (limit ${max})`);
  for (const email of text.match(EMAIL) ?? [])
    if (!PUBLIC_EMAILS.has(email.toLowerCase()))
      problems.push(`${where} contains an email address (${email}); the changelog is public`);
  if (SECRET_LIKE.test(text)) problems.push(`${where} contains a token-like string`);
  if (/#\d+\b/.test(text))
    problems.push(`${where} cites a PR number; write for players, links are added automatically`);
  return problems;
}

/** Problems with one pending note; an empty list means it is valid. */
export function noteProblems(note, name = "note") {
  if (!note || typeof note !== "object" || Array.isArray(note))
    return [`${name} must be a JSON object`];
  const problems = [];
  const extra = Object.keys(note).filter((key) => !["title", "summary", "items"].includes(key));
  if (extra.length) problems.push(`${name} has unknown fields: ${extra.join(", ")}`);
  problems.push(...textProblems(`${name} title`, note.title, 80));
  problems.push(...textProblems(`${name} summary`, note.summary, 300));
  if (!Array.isArray(note.items) || note.items.length < 1 || note.items.length > 10)
    problems.push(`${name} items must list 1 to 10 changes`);
  else
    note.items.forEach((item, i) =>
      problems.push(...textProblems(`${name} item ${i + 1}`, item, 300)),
    );
  return problems;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Problems with the committed published history. */
export function historyProblems(entries) {
  if (!Array.isArray(entries)) return ["history must be an array"];
  const problems = [];
  const ids = new Set();
  for (const [i, entry] of entries.entries()) {
    const at = `history entry ${i} (${entry?.id})`;
    if (!entry?.id || ids.has(entry.id)) problems.push(`${at} needs a unique id`);
    ids.add(entry?.id);
    if (entry.status !== "published") problems.push(`${at} must be published`);
    if (
      !DATE.test(entry.date) ||
      new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10) !== entry.date
    )
      problems.push(`${at} has an invalid date`);
    if (!/^[a-f0-9]{40}$/.test(entry.commit)) problems.push(`${at} needs a full deployed commit`);
    problems.push(...textProblems(`${at} title`, entry.title, 120));
    problems.push(...textProblems(`${at} summary`, entry.summary, 600));
    if (!Array.isArray(entry.improvements) || !entry.improvements.length)
      problems.push(`${at} needs improvements`);
    for (const label of [
      "Release details",
      "Complete main verification",
      "Publication and live checks",
    ])
      if (
        !entry.evidence?.some((item) => item.label === label && item.url?.startsWith(`${GITHUB}/`))
      )
        problems.push(`${at} needs a "${label}" link`);
  }
  return problems;
}

export function readNotes(root = ".") {
  const dir = join(root, NOTES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const path = `${NOTES_DIR}/${name}`;
      let note;
      try {
        note = JSON.parse(readFileSync(join(root, path), "utf8"));
      } catch (error) {
        throw new Error(`${path} is not valid JSON: ${error.message}`);
      }
      const problems = noteProblems(note, path);
      if (problems.length) throw new Error(problems.join("\n"));
      return { path, note };
    });
}

// ---- Pull request check ----------------------------------------------------------------

/**
 * Decide whether a pull request satisfies the changelog rule.
 * `files` are paths the PR adds or modifies (deleted paths excluded); `body` and `labels`
 * come from the pull_request event.
 */
export function pullRequestDecision({ files, body = "", labels = [] }) {
  const visible = files.filter(isUserVisible).filter((file) => !isChangelogFile(file));
  const notes = files.filter(isChangelogFile);
  if (!visible.length) return { ok: true, reason: "No user-visible files changed." };
  if (notes.length) return { ok: true, reason: `Changelog content: ${notes.join(", ")}.` };
  if (labels.includes(OPT_OUT_LABEL))
    return { ok: true, reason: `Opted out with the "${OPT_OUT_LABEL}" label.` };
  const optOut = /^[\s>*_-]*Web changelog:\s*none\b[\s:—–-]*(\S.{2,})$/im.exec(body ?? "");
  if (optOut) return { ok: true, reason: `Opted out in the PR description: ${optOut[1].trim()}` };
  return {
    ok: false,
    reason:
      `User-visible files changed (${visible.slice(0, 5).join(", ")}${visible.length > 5 ? ", …" : ""}) ` +
      `but no website changelog note was added. Add ${NOTES_DIR}/<branch-name>.json ` +
      `({"title","summary","items"}, plain language for players), or, if nobody can see the change, ` +
      `add the line "Web changelog: none — <reason>" to the PR description or the "${OPT_OUT_LABEL}" label.`,
  };
}

function checkPullRequest() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const pr = event.pull_request;
  // The pull_request checkout is the test merge commit; its first parent is the base branch.
  const files = git(["diff", "--name-only", "--diff-filter=ACMR", "HEAD^1", "HEAD"])
    .split("\n")
    .filter(Boolean);
  const changedNotes = files.filter((file) => isChangelogFile(file) && file !== HISTORY_FILE);
  const problems = changedNotes.flatMap((file) =>
    noteProblems(JSON.parse(readFileSync(file, "utf8")), file),
  );
  if (files.includes(HISTORY_FILE))
    problems.push(...historyProblems(JSON.parse(readFileSync(HISTORY_FILE, "utf8"))));
  const decision = pullRequestDecision({
    files,
    body: pr?.body ?? "",
    labels: (pr?.labels ?? []).map((label) => label.name),
  });
  const ok = decision.ok && !problems.length;
  const lines = [decision.reason, ...problems];
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Website changelog\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`,
    );
  for (const line of lines) console.log(ok ? line : `::error title=Website changelog::${line}`);
  process.exitCode = ok ? 0 : 1;
}

// ---- Stamping --------------------------------------------------------------------------

function git(args, root = ".") {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function utcDay(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

function joinTitles(titles) {
  if (titles.length <= 3) return titles.join(" · ");
  return `${titles.slice(0, 3).join(" · ")} · ${titles.length - 3} more`;
}

/**
 * Group notes by the deploy that first carried them.
 *
 * notes:    [{ path, note, commit, pr }] where commit is the main commit that added the note
 * deploys:  successful deploys, oldest first: [{ sha, date, verifyRunId, deployRunId }]
 * contains: (deploySha, noteCommit) => boolean, true when the deploy includes the note commit
 * current:  { sha, date, verifyRunId } for the build in progress, or null
 *
 * Returns published entries, oldest first (the order of web-releases.json). A note no deploy contains yet is stamped with
 * `current`; without `current` it is left out (it is not live anywhere).
 */
export function stampNotes({ notes, deploys, contains, current = null }) {
  const groups = new Map();
  for (const item of notes) {
    const deploy =
      deploys.find((candidate) => contains(candidate.sha, item.commit)) ??
      (current ? { ...current, deployRunId: null, current: true } : null);
    if (!deploy) continue;
    const day = utcDay(deploy.date);
    const group = groups.get(day) ?? { day, items: [], deploys: [] };
    group.items.push(item);
    if (!group.deploys.some((d) => d.sha === deploy.sha)) group.deploys.push(deploy);
    groups.set(day, group);
  }
  const order = (deploy) =>
    deploy.current ? Infinity : deploys.findIndex((d) => d.sha === deploy.sha);
  return [...groups.values()]
    .map((group) => {
      group.deploys.sort((a, b) => order(a) - order(b));
      const first = group.deploys[0];
      const last = group.deploys.at(-1);
      const firstIndex = first.current
        ? deploys.length
        : deploys.findIndex((d) => d.sha === first.sha);
      const base = deploys[firstIndex - 1];
      const prs = [...new Set(group.items.map((item) => item.pr).filter(Boolean))];
      const details =
        prs.length === 1
          ? `${GITHUB}/pull/${prs[0]}`
          : base
            ? `${GITHUB}/compare/${base.sha.slice(0, 12)}...${last.sha.slice(0, 12)}`
            : `${GITHUB}/commit/${last.sha}`;
      const notesInGroup = group.items.map((item) => item.note);
      return {
        id: `${group.day}-web-${last.sha.slice(0, 8)}`,
        status: "published",
        date: group.day,
        commit: last.sha,
        title: joinTitles(notesInGroup.map((note) => note.title)),
        summary: notesInGroup.map((note) => note.summary).join(" "),
        improvements: notesInGroup.flatMap((note) => note.items),
        // Build-time bookkeeping (which note files made this entry); stripped before rendering.
        notes: group.items.map((item) => item.path),
        evidence: [
          { label: "Release details", url: details },
          {
            label: "Complete main verification",
            url: `${GITHUB}/actions/runs/${last.verifyRunId}`,
          },
          {
            label: "Publication and live checks",
            // The release job for the commit being built has not started yet; until the next
            // main build fills in its exact run, link the publisher's main history.
            url: last.deployRunId
              ? `${GITHUB}/actions/runs/${last.deployRunId}`
              : `${GITHUB}/actions/workflows/${RELEASE_WORKFLOW}?query=branch%3Amain`,
          },
        ],
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function githubJson(path, { attempts = 3 } = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return await response.json();
      lastError = new Error(`GitHub ${path}: HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  throw lastError;
}

async function successfulRuns(workflow, since, extra = "") {
  const runs = [];
  for (let page = 1; page <= 30; page++) {
    const data = await githubJson(
      `actions/workflows/${workflow}/runs?branch=main&status=success&per_page=100&page=${page}` +
        `&created=${encodeURIComponent(`>=${since}`)}${extra}`,
    );
    runs.push(...data.workflow_runs);
    if (data.workflow_runs.length < 100) return runs;
  }
  throw new Error(
    `More than 3000 ${workflow} runs since ${since}; run "node scripts/web-changelog.mjs freeze".`,
  );
}

/** Git facts for every pending note: the main commit that added it and its PR number. */
export function noteCommits(notes, root = ".") {
  return notes.map((item) => {
    const line = git(
      ["log", "--diff-filter=A", "--format=%H%x09%cI%x09%s", "-1", "--", item.path],
      root,
    );
    if (!line) return { ...item, commit: null };
    const [commit, date, subject] = line.split("\t");
    return { ...item, commit, date, pr: Number(/\(#(\d+)\)\s*$/.exec(subject)?.[1]) || null };
  });
}

/**
 * Build-time entries. mode "release" (main build) reads deploys from GitHub and fails on any
 * error; mode "preview" stamps every note as if HEAD were live, for local review only.
 */
export async function collectEntries({ mode, root = "." }) {
  const notes = readNotes(root);
  if (!notes.length || !mode) return [];
  const head = git(["rev-parse", "HEAD"], root);
  const headDate = git(["show", "-s", "--format=%cI", "HEAD"], root);
  if (mode === "preview")
    return stampNotes({
      notes: notes.map((item) => ({ ...item, commit: head })),
      deploys: [],
      contains: () => false,
      current: { sha: head, date: headDate, verifyRunId: "preview" },
    }).map((entry) => ({ ...entry, id: `preview-${entry.id}` }));
  if (mode !== "release") throw new Error(`Unknown LOOTSPLIT_WEB_CHANGELOG mode: ${mode}`);
  const runId = process.env.GITHUB_RUN_ID;
  if (!runId)
    throw new Error("Release stamping runs only in the main verification build (GITHUB_RUN_ID).");
  if (git(["rev-parse", "--is-shallow-repository"], root) === "true")
    throw new Error("Stamping the website changelog needs full history (checkout fetch-depth: 0).");
  const located = noteCommits(notes, root);
  const missing = located.filter((item) => !item.commit);
  if (missing.length)
    throw new Error(`Notes not committed on this branch: ${missing.map((m) => m.path).join(", ")}`);
  const oldest = located.map((item) => item.date).sort()[0];
  const since = new Date(Date.parse(oldest) - 2 * 86_400_000).toISOString().slice(0, 10);
  const [releases, verifications] = await Promise.all([
    successfulRuns(RELEASE_WORKFLOW, since),
    successfulRuns(VERIFY_WORKFLOW, since, "&event=push"),
  ]);
  const verifyRun = new Map();
  for (const run of verifications.sort((a, b) => a.created_at.localeCompare(b.created_at)))
    if (!verifyRun.has(run.head_sha)) verifyRun.set(run.head_sha, run.id);
  const seen = new Set();
  const deploys = [];
  for (const run of releases.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (seen.has(run.head_sha) || !verifyRun.has(run.head_sha)) continue;
    let date;
    try {
      date = git(["show", "-s", "--format=%cI", run.head_sha], root);
    } catch {
      continue; // Not in this history (for example a commit later rewritten away).
    }
    seen.add(run.head_sha);
    deploys.push({
      sha: run.head_sha,
      date,
      verifyRunId: verifyRun.get(run.head_sha),
      deployRunId: run.id,
    });
  }
  const contains = (deploySha, noteCommit) => {
    try {
      git(["merge-base", "--is-ancestor", noteCommit, deploySha], root);
      return true;
    } catch {
      return false;
    }
  };
  return stampNotes({
    notes: located,
    deploys,
    contains,
    current: { sha: process.env.GITHUB_SHA || head, date: headDate, verifyRunId: runId },
  });
}

/** An entry as rendered: without the build-time list of note files. */
export function withoutBookkeeping({ notes: _notes, ...entry }) {
  return entry;
}

/** Move notes that are already live into the committed history and delete them. */
async function freeze(root = ".") {
  const live = await collectEntries({ mode: "release", root }).catch((error) => {
    throw new Error(`freeze needs GitHub access and full history: ${error.message}`);
  });
  const settled = live.filter(
    (entry) => !entry.evidence.some((e) => e.url.includes("/workflows/")),
  );
  if (!settled.length)
    return console.log("Nothing to freeze: no note is in a completed deploy yet.");
  const history = JSON.parse(readFileSync(join(root, HISTORY_FILE), "utf8"));
  const known = new Set(history.map((entry) => entry.id));
  const added = settled.filter((entry) => !known.has(entry.id));
  const frozenNotes = added.flatMap((entry) => entry.notes);
  writeFileSync(
    join(root, HISTORY_FILE),
    `${JSON.stringify([...history, ...added.map(withoutBookkeeping)], null, 2)}\n`,
  );
  for (const path of frozenNotes) unlinkSync(join(root, path));
  console.log(`Froze ${added.length} entries; removed ${frozenNotes.length} notes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  try {
    if (command === "check-pr") checkPullRequest();
    else if (command === "validate") {
      const notes = readNotes();
      const problems = historyProblems(JSON.parse(readFileSync(HISTORY_FILE, "utf8")));
      if (problems.length) throw new Error(problems.join("\n"));
      console.log(`${notes.length} pending notes and the published history are valid.`);
    } else if (command === "preview")
      console.log(
        JSON.stringify(await collectEntries({ mode: process.argv[3] || "preview" }), null, 2),
      );
    else if (command === "freeze") await freeze();
    else {
      console.error(
        "Usage: node scripts/web-changelog.mjs check-pr | validate | preview [release] | freeze",
      );
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
