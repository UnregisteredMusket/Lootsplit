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
async function json(fetcher, url, options = {}) {
  const response = await fetcher(url, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) throw providerFailure(response);
  return response.json();
}
async function cached(env, key, operation) {
  let cache = caches.get(env.DB);
  if (!cache) caches.set(env.DB, (cache = new Map()));
  const previous = cache.get(key);
  if (previous && Date.now() - previous.at < 300000) return previous.promise;
  const promise = capture(operation);
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

export async function developmentActivity(env, fetcher = fetch) {
  if (env.OWNER_MONITOR_GITHUB !== "true") return disconnected();
  return cached(env, "github", async () => {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "Lootsplit-owner-monitor",
      ...(env.OWNER_MONITOR_GITHUB_TOKEN
        ? { Authorization: `Bearer ${env.OWNER_MONITOR_GITHUB_TOKEN}` }
        : {}),
    };
    const [workflows, pulls] = await Promise.all([
      json(fetcher, `${github}/actions/runs?per_page=100`, { headers }),
      json(fetcher, `${github}/pulls?state=open&per_page=100`, { headers }),
    ]);
    if (!Array.isArray(workflows.workflow_runs) || !Array.isArray(pulls))
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
        branch: label(run.head_branch),
        commit: /^[a-f0-9]{40}$/.test(run.head_sha) ? run.head_sha : null,
        url: `https://github.com/${repository}/actions/runs/${run.id}`,
        deployment: run.path === ".github/workflows/website-release.yml",
        startedAt: Date.parse(run.run_started_at || run.created_at) || null,
        updatedAt: Date.parse(run.updated_at) || null,
      };
    });
    return {
      // Explicit bounded scope: not evidence about unsubmitted local/Codex work.
      scannedRuns: runs.length,
      runs,
      active: runs.filter((run) => run.status !== "completed"),
      latestDeployment: runs.find((run) => run.deployment) || null,
      openPulls: pulls.map((pr) => {
        if (!Number.isSafeInteger(pr.number)) throw new Error("Invalid change");
        return {
          number: pr.number,
          title: label(pr.title),
          draft: pr.draft === true,
          url: `https://github.com/${repository}/pull/${pr.number}`,
        };
      }),
    };
  });
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
  return { ...snapshot, account };
}
