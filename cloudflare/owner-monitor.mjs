import { assertActive, roleOf } from "./members.mjs";
import { serverMonitor } from "./monitoring.mjs";
import { ownerAnalytics } from "./game-analytics.mjs";

const repository = "UnregisteredMusket/Lootsplit";
const github = `https://api.github.com/repos/${repository}`;
const caches = new WeakMap();
export function providerErrorCode(error) {
  return /^HTTP_[1-5]\d\d(?:_RATE_LIMITED)?$/.test(error?.providerCode || "")
    ? error.providerCode
    : error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "SOURCE_TIMEOUT"
      : "SOURCE_UNAVAILABLE";
}
export function providerFailure(response) {
  const limited =
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after")));
  return Object.assign(new Error("Provider unavailable"), {
    providerCode: `HTTP_${response.status}${limited ? "_RATE_LIMITED" : ""}`,
  });
}
const unavailable = (error) => ({
  state: "unavailable",
  checkedAt: Date.now(),
  data: null,
  errorCode: providerErrorCode(error),
});
const disconnected = () => ({ state: "not-connected", checkedAt: null, data: null });
const number = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const label = (s) => (typeof s === "string" ? s.slice(0, 160) : "");

async function capture(operation) {
  let timer;
  try {
    const data = await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Monitoring timed out")), 5000);
      }),
    ]);
    return { state: "ready", checkedAt: Date.now(), data };
  } catch (error) {
    // Never forward provider errors, headers, credentials or raw response payloads.
    return unavailable(error);
  } finally {
    clearTimeout(timer);
  }
}
export async function json(fetcher, url, options = {}) {
  const response = await fetcher(url, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) throw providerFailure(response);
  return response.json();
}
const PROVIDER_CACHE_MS = 300000;
// While a workflow is running, the Agent activity companion refreshes about once a minute.
// A shorter provider cache keeps that meaningful. Each collection makes 3 GitHub requests, so at
// most ~66 collections (~200 requests) per hour per isolate while active and 12 (36 requests)
// otherwise, well within GitHub's 5,000 authenticated requests per hour.
export const ACTIVE_CACHE_MS = 55000;
async function cached(env, key, operation, lifetime = () => PROVIDER_CACHE_MS) {
  let cache = caches.get(env.DB);
  if (!cache) caches.set(env.DB, (cache = new Map()));
  const previous = cache.get(key);
  if (previous && Date.now() - previous.at < previous.ttl) return previous.promise;
  // Concurrent callers share the pending read; its lifetime is decided once it resolves.
  const entry = { at: Date.now(), ttl: PROVIDER_CACHE_MS };
  entry.promise = capture(operation).then((result) => {
    entry.ttl = lifetime(result);
    return result;
  });
  cache.set(key, entry);
  return entry.promise;
}

const timestamp = (value) => {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isSafeInteger(at) && at > 0 ? at : null;
};
const branchName = (value) =>
  typeof value === "string" && /^[\w./-]{1,160}$/.test(value) ? value : "";
function pullRequest(pr) {
  if (!Number.isSafeInteger(pr?.number) || pr.number <= 0) throw new Error("Invalid change");
  if (pr.merged_at !== undefined && pr.merged_at !== null && typeof pr.merged_at !== "string")
    throw new Error("Invalid change");
  return {
    number: pr.number,
    title: label(pr.title),
    draft: pr.draft === true,
    url: `https://github.com/${repository}/pull/${pr.number}`,
    headRef: branchName(pr.head?.ref),
    createdAt: timestamp(pr.created_at),
    closedAt: timestamp(pr.closed_at),
    mergedAt: timestamp(pr.merged_at),
  };
}

export const ACTIVITY_EVENT_LIMIT = 20;
const ACTIVE_EVENT_LIMIT = 5;
const short = (value, size) => (value.length > size ? `${value.slice(0, size - 1)}…` : value);
/**
 * Normalized, bounded, newest-first GitHub activity for the owner's Agent activity companion.
 * Only repository workflow runs and pull requests: it is not the development chat or local work.
 * state: ok (✓), active (! in progress), attention (! cancelled/closed/needs approval), fail (✕).
 */
export function activityEvents(runs, openPulls, closedPulls, limit = ACTIVITY_EVENT_LIMIT) {
  const byRef = new Map();
  // An open pull request owns its branch; otherwise the most recently closed one does.
  for (const pr of [...closedPulls].sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0)))
    if (pr.headRef && pr.headRef !== "main") byRef.set(pr.headRef, pr);
  for (const pr of openPulls) if (pr.headRef && pr.headRef !== "main") byRef.set(pr.headRef, pr);
  const runEvents = [];
  for (const run of runs) {
    // Scheduled housekeeping and skipped conditional workflows are not development actions.
    if (run.event === "schedule" || run.conclusion === "skipped") continue;
    const pr = byRef.get(run.branch) || null;
    const where = pr ? `#${pr.number}` : run.branch || "unknown branch";
    const name = short(run.name || "Workflow", 40);
    const active = run.status !== "completed";
    const [kind, state, verb] = active
      ? ["run-started", "active", run.status === "in_progress" ? "running" : run.status]
      : run.conclusion === "success"
        ? ["run-succeeded", "ok", "passed"]
        : run.conclusion === "neutral"
          ? ["run-succeeded", "ok", "finished"]
          : ["failure", "timed_out", "startup_failure"].includes(run.conclusion)
            ? ["run-failed", "fail", run.conclusion === "timed_out" ? "timed out" : "failed"]
            : run.conclusion === "cancelled"
              ? ["run-cancelled", "attention", "cancelled"]
              : [
                  "run-attention",
                  "attention",
                  run.conclusion === "action_required"
                    ? "needs approval"
                    : (run.conclusion || "ended").replaceAll("_", " "),
                ];
    const at = active ? run.startedAt || run.updatedAt : run.updatedAt || run.startedAt;
    if (!at) continue;
    runEvents.push({
      id: `run:${run.id}:${run.status}:${run.conclusion || ""}`,
      kind,
      state,
      text: `${name} ${verb} on ${where}`,
      pr: pr?.number ?? null,
      title: pr ? short(pr.title, 80) : "",
      at,
      url: run.url,
    });
  }
  const pulls = new Map();
  for (const pr of openPulls) pulls.set(pr.number, pr);
  for (const pr of closedPulls) pulls.set(pr.number, pr); // The closed reading is the newer state.
  const pullEvents = [];
  for (const pr of pulls.values()) {
    const base = { pr: pr.number, title: short(pr.title, 80), url: pr.url };
    if (pr.createdAt)
      pullEvents.push({
        ...base,
        id: `pr:${pr.number}:opened`,
        kind: "pr-opened",
        state: "ok",
        text: `Opened ${pr.draft ? "draft " : ""}#${pr.number}`,
        at: pr.createdAt,
      });
    if (pr.mergedAt)
      pullEvents.push({
        ...base,
        id: `pr:${pr.number}:merged`,
        kind: "pr-merged",
        state: "ok",
        text: `Merged #${pr.number}`,
        at: pr.mergedAt,
      });
    else if (pr.closedAt)
      pullEvents.push({
        ...base,
        id: `pr:${pr.number}:closed`,
        kind: "pr-closed",
        state: "attention",
        text: `Closed #${pr.number} without merging`,
        at: pr.closedAt,
      });
  }
  const newest = (a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const bound = Math.max(0, Math.min(limit, ACTIVITY_EVENT_LIMIT));
  // Running workflows stay listed even when newer events would push them out of the window.
  const running = runEvents.filter((e) => e.state === "active").sort(newest);
  const kept = running.slice(0, Math.min(ACTIVE_EVENT_LIMIT, bound));
  const ids = new Set(kept.map((e) => e.id));
  for (const event of [...runEvents, ...pullEvents].sort(newest)) {
    if (kept.length >= bound) break;
    if (!ids.has(event.id)) kept.push(event);
  }
  return kept.sort(newest);
}

export async function developmentActivity(env, fetcher = fetch) {
  if (env.OWNER_MONITOR_GITHUB !== "true") return disconnected();
  return cached(
    env,
    "github",
    async () => {
      const headers = {
        Accept: "application/vnd.github+json",
        "User-Agent": "Lootsplit-owner-monitor",
        ...(env.OWNER_MONITOR_GITHUB_TOKEN
          ? { Authorization: `Bearer ${env.OWNER_MONITOR_GITHUB_TOKEN}` }
          : {}),
      };
      const [workflows, pulls, closed] = await Promise.all([
        json(fetcher, `${github}/actions/runs?per_page=100`, { headers }),
        json(fetcher, `${github}/pulls?state=open&per_page=100`, { headers }),
        json(fetcher, `${github}/pulls?state=closed&sort=updated&direction=desc&per_page=20`, {
          headers,
        }),
      ]);
      if (
        !Array.isArray(workflows.workflow_runs) ||
        !Array.isArray(pulls) ||
        !Array.isArray(closed)
      )
        throw new Error("Invalid activity");
      const runs = workflows.workflow_runs.map((run) => {
        if (
          !Number.isSafeInteger(run.id) ||
          !["queued", "in_progress", "completed", "waiting", "pending", "requested"].includes(
            run.status,
          )
        )
          throw new Error("Invalid run");
        return {
          id: run.id,
          name: label(run.name),
          status: run.status,
          conclusion: label(run.conclusion) || null,
          // A re-run reuses the run id; its attempt tells which step telemetry it supersedes.
          attempt:
            Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0 ? run.run_attempt : null,
          branch: label(run.head_branch),
          event: label(run.event).slice(0, 40),
          commit: /^[a-f0-9]{40}$/.test(run.head_sha) ? run.head_sha : null,
          url: `https://github.com/${repository}/actions/runs/${run.id}`,
          deployment: run.path === ".github/workflows/website-release.yml",
          startedAt: Date.parse(run.run_started_at || run.created_at) || null,
          updatedAt: Date.parse(run.updated_at) || null,
        };
      });
      const open = pulls.map(pullRequest),
        recent = closed.map(pullRequest);
      const active = runs.filter((run) => run.status !== "completed");
      return {
        // Explicit bounded scope: not evidence about unsubmitted local/Codex work.
        scannedRuns: runs.length,
        scannedClosedPulls: recent.length,
        runs,
        active,
        // Running development workflows (not scheduled housekeeping) drive the fast refresh.
        activeActivity: active.filter((run) => run.event !== "schedule").length,
        latestDeployment: runs.find((run) => run.deployment) || null,
        // headRef lets diagnostics tell a branch with an open pull request from a finished one.
        openPulls: open.map(({ number, title, draft, url, headRef }) => ({
          number,
          title,
          draft,
          url,
          headRef,
        })),
        closedPulls: recent.map(({ number, headRef, closedAt, mergedAt }) => ({
          number,
          headRef,
          closedAt,
          mergedAt,
        })),
        events: activityEvents(runs, open, recent),
      };
    },
    (result) => (result.data?.activeActivity > 0 ? ACTIVE_CACHE_MS : PROVIDER_CACHE_MS),
  );
}

export async function cloudflareTraffic(env, fetcher = fetch, window = null) {
  const token = env.OWNER_MONITOR_CLOUDFLARE_TOKEN;
  const account = env.OWNER_MONITOR_CLOUDFLARE_ACCOUNT_ID;
  if (!token || !/^[a-f0-9]{32}$/.test(account || "")) return disconnected();
  const operation = async () => {
    const until = new Date(window?.end ?? Date.now()).toISOString();
    const since = new Date(window?.start ?? Date.now() - 86400000).toISOString();
    const response = await json(fetcher, "https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query ($account: string, $since: string, $until: string) {
          viewer { accounts(filter: {accountTag: $account}) {
            workersInvocationsAdaptive(limit: 1, filter: {scriptName: "lootsplit", datetime_geq: $since, datetime_lt: $until}) {
              sum { requests errors }
            }
          } }
        }`,
        variables: { account, since, until },
      }),
    });
    const accounts = response.data?.viewer?.accounts;
    const rows = accounts?.[0]?.workersInvocationsAdaptive;
    if (
      response.errors?.length ||
      accounts?.length !== 1 ||
      !Array.isArray(rows) ||
      rows.length > 1
    )
      throw new Error("Invalid analytics");
    // A valid empty query is different from a failed/malformed provider response.
    const sum = rows.length === 0 ? { requests: 0, errors: 0 } : rows[0].sum;
    if (!number(sum?.requests) || !number(sum?.errors)) throw new Error("Invalid totals");
    return { requests: sum.requests, errors: sum.errors, since, until };
  };
  return window ? capture(operation) : cached(env, "cloudflare", operation);
}

export async function authorizeOwner(env, userId, sessionId) {
  await assertActive(env.DB, userId);
  if ((await roleOf(env.DB, userId)) !== "owner")
    throw Object.assign(new Error("Owner access is required."), { status: 403 });
  const session = await env.DB.prepare(
    "SELECT id FROM session WHERE id=? AND userId=? AND julianday(expiresAt)>julianday('now')",
  )
    .bind(sessionId, userId)
    .first();
  if (!session)
    throw Object.assign(new Error("Sign in again to view monitoring."), { status: 401 });
}
export async function collectOwnerMonitor(env, userId) {
  const [health, analytics, development, traffic, release] = await Promise.all([
    serverMonitor(env, userId),
    capture(() => ownerAnalytics(env.DB, userId)),
    developmentActivity(env),
    cloudflareTraffic(env),
    capture(async () => {
      if (!env.ASSETS) throw new Error("No release binding");
      const response = await env.ASSETS.fetch(
        new Request(new URL("/assets/release-identity.json", env.ACCOUNT_ORIGIN)),
      );
      if (!response.ok) throw new Error("No release identity");
      const data = await response.json();
      if (!/^[a-f0-9]{40}$/.test(data.commit)) throw new Error("Invalid release");
      return { commit: data.commit };
    }),
  ]);
  return { checkedAt: Date.now(), health, analytics, development, traffic, release };
}
export async function ownerMonitor(env, userId, sessionId, request) {
  await authorizeOwner(env, userId, sessionId);
  const device = request?.headers.get("x-lootsplit-device");
  if (device && /^[a-f0-9-]{36}$/.test(device)) {
    const { monitorApi } = await import("./monitor-journal.mjs");
    await monitorApi(
      env,
      userId,
      sessionId,
      new Request(new URL("/api/account/owner/monitor/device", env.ACCOUNT_ORIGIN), {
        method: "POST",
      }),
      {
        id: device,
        snapshotId: Number(request.headers.get("x-lootsplit-snapshot")) || 0,
        version: request.headers.get("x-lootsplit-version") || "unknown",
        delivery: "Refresh requested; reports the previously received snapshot",
      },
    );
  }
  const { monitorSnapshot } = await import("./monitor-journal.mjs");
  const snapshot = await monitorSnapshot(env, userId);
  // Role, account and session revocations during provider reads must fail closed.
  await authorizeOwner(env, userId, sessionId);
  const account = await env.DB.prepare("SELECT name,email FROM user WHERE id=?")
    .bind(userId)
    .first();
  if (!account) throw Object.assign(new Error("Sign in again."), { status: 401 });
  const view = request?.url ? new URL(request.url).searchParams.get("view") : null;
  return view === "widget" ? widgetSnapshot({ ...snapshot, account }) : { ...snapshot, account };
}
/**
 * The compact form the Android widgets request (`?view=widget`). It drops only bulky lists the
 * widgets never read: the 100 scanned workflow runs (their derived events, running workflows,
 * open pull requests and latest deployment stay), closed pull requests and other devices' reports.
 * Each omission is stated with its count, so nothing reads as zero. The full snapshot, history
 * and dashboard are unchanged.
 */
export function widgetSnapshot(snapshot) {
  const out = { ...snapshot, view: "widget" };
  const data = snapshot.development?.data;
  if (data && typeof data === "object") {
    const { runs, closedPulls, ...kept } = data;
    out.development = {
      ...snapshot.development,
      data: {
        ...kept,
        omitted: {
          runs: Array.isArray(runs) ? runs.length : 0,
          closedPulls: Array.isArray(closedPulls) ? closedPulls.length : 0,
        },
      },
    };
  }
  if (Array.isArray(snapshot.devices)) {
    delete out.devices;
    out.omitted = { devices: snapshot.devices.length };
  }
  return out;
}
