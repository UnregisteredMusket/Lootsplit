import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  HISTORY_BRANCH,
  CAPTURE_START,
  collectRun,
  recordRegressions,
  jsonLines,
  parseLines,
  renderRegressions,
  validateMeasurement,
  applyResolution,
} from "./performance-history.mjs";

const REPO = "UnregisteredMusket/Lootsplit";
const HISTORY_FILES = [
  "state.json",
  "baselines.json",
  "regressions.jsonl",
  "resolutions.jsonl",
  "PERFORMANCE-REGRESSIONS.md",
];
export function githubClient(token = process.env.GH_TOKEN) {
  return async (path, { method = "GET", body, missing = false } = {}) => {
    const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
}

export async function paginate(api, path, property) {
  const results = [];
  for (let page = 1; page <= 100; page++) {
    const data = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    // Filtered Actions searches cap at 1,000. Fail visibly instead of silently losing history.
    if (property === "workflow_runs" && data.total_count >= 1000)
      throw Error(
        "Performance catch-up exceeds GitHub's search limit; split the date window before advancing the cursor",
      );
    results.push(...data[property]);
    if (data[property].length < 100) return results;
  }
  throw Error("Performance pagination limit reached; cursor was not advanced");
}

async function readHistory(api) {
  const ref = await api(`/git/ref/heads/${HISTORY_BRANCH}`, { missing: true });
  if (!ref) return { sha: null, tree: null, files: {} };
  const commit = await api(`/git/commits/${ref.object.sha}`);
  const tree = await api(`/git/trees/${commit.tree.sha}`);
  const files = {};
  await Promise.all(
    HISTORY_FILES.map(async (path) => {
      const entry = tree.tree.find((e) => e.path === path);
      if (entry) {
        const blob = await api(`/git/blobs/${entry.sha}`);
        files[path] = Buffer.from(blob.content, "base64").toString("utf8");
      }
    }),
  );
  return { sha: ref.object.sha, tree: commit.tree.sha, files };
}

export async function syncHistory({
  api,
  publish = false,
  triggerId,
  now = new Date().toISOString(),
  manual = [],
  resolutions = [],
  output = "test-results/performance",
}) {
  const history = await readHistory(api);
  const state = history.files["state.json"]
    ? JSON.parse(history.files["state.json"])
    : { schema: 1, scanAfter: CAPTURE_START, pending: [], processed: [] };
  const processed = new Set(state.processed);
  const baselines = JSON.parse(history.files["baselines.json"] || "{}");
  const measurements = new Map();
  const manualProcessed = new Set(state.manualProcessed || []);
  // One-minute overlap tolerates pagination races. Pending runs survive even long outages.
  const since = new Date(Date.parse(state.scanAfter) - 60000).toISOString();
  const listed = await paginate(
    api,
    `/actions/runs?created=${encodeURIComponent(`>=${since}`)}`,
    "workflow_runs",
  );
  const runs = new Map(listed.map((r) => [r.id, r]));
  const required = new Set([...state.pending, ...(triggerId ? [Number(triggerId)] : [])]);
  for (const id of required) if (!runs.has(id)) runs.set(id, await api(`/actions/runs/${id}`));
  const pending = [];
  for (const run of runs.values()) {
    // Metadata only; never download or execute a triggering PR's code, artifacts or logs.
    if (
      run.path === ".github/workflows/performance-log.yml" ||
      run.head_repository?.full_name !== REPO
    )
      continue;
    if (run.status !== "completed") {
      pending.push(run.id);
      continue;
    }
    for (let attempt = 1; attempt <= (run.run_attempt || 1); attempt++) {
      const id = `${run.id}:${attempt}`;
      if (processed.has(id)) continue;
      const attemptRun =
        attempt === run.run_attempt
          ? run
          : await api(`/actions/runs/${run.id}/attempts/${attempt}`);
      const jobs = await paginate(api, `/actions/runs/${run.id}/attempts/${attempt}/jobs`, "jobs");
      for (const row of collectRun(attemptRun, jobs)) measurements.set(row.id, row);
      processed.add(id);
    }
  }
  for (const row of manual) {
    validateMeasurement(row);
    if (manualProcessed.has(row.id)) continue;
    measurements.set(row.id, row);
    manualProcessed.add(row.id);
  }
  const rows = [...measurements.values()];
  const recorded = recordRegressions(baselines, rows);
  const previousRegressions = parseLines(history.files["regressions.jsonl"] || "");
  const regressions = new Map(previousRegressions.map((r) => [r.id, r]));
  for (const row of recorded.regressions)
    if (!regressions.has(row.id)) regressions.set(row.id, row);
  const slowdowns = [...regressions.values()];
  const resolutionHistory = new Map(
    parseLines(history.files["resolutions.jsonl"] || "").map((r) => [r.id, r]),
  );
  const previousResolutionCount = resolutionHistory.size;
  for (const resolution of resolutions) {
    if (!resolutionHistory.has(resolution.id))
      resolutionHistory.set(resolution.id, applyResolution(recorded.baselines, resolution));
  }
  const resolved = [...resolutionHistory.values()];
  const changed =
    resolved.length !== previousResolutionCount ||
    processed.size !== state.processed.length ||
    manualProcessed.size !== (state.manualProcessed || []).length ||
    JSON.stringify(pending.sort()) !== JSON.stringify([...state.pending].sort());
  const files = {
    "state.json":
      JSON.stringify(
        {
          schema: 1,
          scanAfter: changed ? now : state.scanAfter,
          pending: pending.sort(),
          processed: [...processed].sort(),
          manualProcessed: [...manualProcessed].sort(),
        },
        null,
        2,
      ) + "\n",
    "baselines.json": JSON.stringify(recorded.baselines, null, 2) + "\n",
    "regressions.jsonl": jsonLines(slowdowns),
    "resolutions.jsonl": jsonLines(resolved),
    "PERFORMANCE-REGRESSIONS.md": renderRegressions(slowdowns, resolved),
  };
  mkdirSync(output, { recursive: true });
  for (const [path, content] of Object.entries(files)) writeFileSync(`${output}/${path}`, content);
  if (publish && Object.entries(files).some(([path, content]) => content !== history.files[path])) {
    // Only this data branch is writable here; no main commits, merges, deploys or reruns.
    const parent = history.sha || (await api("/git/ref/heads/main")).object.sha;
    const tree = await api("/git/trees", {
      method: "POST",
      body: {
        ...(history.tree ? { base_tree: history.tree } : {}),
        tree: Object.entries(files).map(([path, content]) => ({
          path,
          mode: "100644",
          type: "blob",
          content,
        })),
      },
    });
    const commit = await api("/git/commits", {
      method: "POST",
      body: { message: "Record measured performance history", tree: tree.sha, parents: [parent] },
    });
    if (history.sha)
      await api(`/git/refs/heads/${HISTORY_BRANCH}`, {
        method: "PATCH",
        body: { sha: commit.sha, force: false },
      });
    else
      await api("/git/refs", {
        method: "POST",
        body: { ref: `refs/heads/${HISTORY_BRANCH}`, sha: commit.sha },
      });
  }
  return {
    compared: rows.length,
    regressions: slowdowns.length,
    addedRegressions: slowdowns.length - previousRegressions.length,
    staleResolutions: resolved.filter((r) => r.status === "stale_reference").length,
    pending: pending.length,
    published: publish,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some((a) => !["--publish"].includes(a)))
      throw Error("Usage: performance-sync.mjs [--publish]");
    if (args.includes("--publish") && !process.env.GH_TOKEN)
      throw Error("Publishing requires GH_TOKEN with contents:write");
    const event = process.env.GITHUB_EVENT_PATH
      ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
      : {};
    const manual = existsSync("performance/manual-measurements.jsonl")
      ? parseLines(readFileSync("performance/manual-measurements.jsonl", "utf8"))
      : [];
    const resolutions = existsSync("performance/resolutions.jsonl")
      ? parseLines(readFileSync("performance/resolutions.jsonl", "utf8"))
      : [];
    console.log(
      JSON.stringify(
        await syncHistory({
          api: githubClient(),
          publish: args.includes("--publish"),
          triggerId: event.workflow_run?.id,
          manual,
          resolutions,
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
