import { assertActive, roleOf } from "./members.mjs";
import { serverMonitor } from "./monitoring.mjs";
import { ownerAnalytics } from "./game-analytics.mjs";

const repository = "UnregisteredMusket/Lootsplit";
const github = `https://api.github.com/repos/${repository}`;
const caches = new WeakMap();
const unavailable = () => ({ state: "unavailable", checkedAt: Date.now(), data: null });
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
  } catch {
    // Never forward provider errors, headers, credentials or raw response payloads.
    return unavailable();
  } finally {
    clearTimeout(timer);
  }
}
async function json(fetcher, url, options = {}) {
  const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error("Provider unavailable");
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
      };
    });
    return {
      // Explicit bounded scope: not evidence about unsubmitted local/Codex work.
      scannedRuns: runs.length,
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

export async function cloudflareTraffic(env, fetcher = fetch) {
  const token = env.OWNER_MONITOR_CLOUDFLARE_TOKEN;
  const account = env.OWNER_MONITOR_CLOUDFLARE_ACCOUNT_ID;
  if (!token || !/^[a-f0-9]{32}$/.test(account || "")) return disconnected();
  return cached(env, "cloudflare", async () => {
    const until = new Date().toISOString();
    const since = new Date(Date.now() - 86400000).toISOString();
    const response = await json(fetcher, "https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query ($account: string, $since: string, $until: string) {
          viewer { accounts(filter: {accountTag: $account}) {
            workersInvocationsAdaptive(limit: 1, filter: {scriptName: "lootsplit", datetime_geq: $since, datetime_leq: $until}) {
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
  });
}

export async function ownerMonitor(env, userId, sessionId) {
  async function authorize() {
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
  await authorize();
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
  // Role, account and session revocations during provider reads must fail closed.
  await authorize();
  const account = await env.DB.prepare("SELECT name,email FROM user WHERE id=?")
    .bind(userId)
    .first();
  if (!account) throw Object.assign(new Error("Sign in again."), { status: 401 });
  return { checkedAt: Date.now(), account, health, analytics, development, traffic, release };
}
