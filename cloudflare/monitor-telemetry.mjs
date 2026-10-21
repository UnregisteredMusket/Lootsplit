import { initializeMonitor, updateTask } from "./monitor-journal.mjs";
import { clean, fail } from "./monitor-model.mjs";

const ISSUER = "https://token.actions.githubusercontent.com";
const REPOSITORY = "UnregisteredMusket/Lootsplit";
// GitHub repositories created after July 15, 2026 use immutable subject IDs.
// Both exact forms retain the independent signed owner/repository ID checks below.
const SUBJECT_REPOSITORIES = [
  `repo:${REPOSITORY}`,
  "repo:UnregisteredMusket@336285553/Lootsplit@1398794793",
];
const ALLOWED = new Set([
  "verify.yml",
  "website-release.yml",
  "android-release.yml",
  "android-widget.yml",
  "standby-release.yml",
  "verify-live.yml",
  "android-test-apk.yml",
]);
const keys = new WeakMap();
function bytes(value) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
}
export async function verifyTelemetryToken(token, env, now = Date.now(), fetcher = fetch) {
  if (typeof token !== "string" || token.length > 16000)
    fail("Workflow authorization required.", 401);
  let header, claim, parts;
  try {
    parts = token.split(".");
    if (parts.length !== 3) throw Error();
    header = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    claim = JSON.parse(new TextDecoder().decode(bytes(parts[1])));
  } catch {
    fail("Invalid workflow authorization.", 401);
  }
  const workflow = `${REPOSITORY}/.github/workflows/`;
  const ref = claim.job_workflow_ref || claim.workflow_ref;
  const name =
    typeof ref === "string" && ref.startsWith(workflow) && ref.endsWith("@refs/heads/main")
      ? ref.slice(workflow.length, -"@refs/heads/main".length)
      : "";
  if (
    header.alg !== "RS256" ||
    header.typ !== "JWT" ||
    typeof header.kid !== "string" ||
    claim.iss !== ISSUER ||
    claim.aud !== "https://lootsplit.oliverstorie2017.workers.dev/monitoring" ||
    claim.repository !== REPOSITORY ||
    claim.repository_id !== "1398794793" ||
    claim.repository_owner_id !== "336285553" ||
    claim.ref !== "refs/heads/main" ||
    !SUBJECT_REPOSITORIES.some(
      (subject) =>
        claim.sub === `${subject}:ref:refs/heads/main` ||
        (name === "website-release.yml" && claim.sub === `${subject}:environment:production`),
    ) ||
    !ALLOWED.has(name) ||
    !["push", "workflow_run", "workflow_dispatch", "schedule"].includes(claim.event_name) ||
    !Number.isFinite(claim.exp) ||
    claim.exp * 1000 <= now ||
    !Number.isFinite(claim.iat) ||
    claim.iat * 1000 > now + 30000 ||
    now - claim.iat * 1000 > 10 * 60000 ||
    (claim.nbf && claim.nbf * 1000 > now + 30000) ||
    !/^\d+$/.test(claim.run_id || "") ||
    !/^\d+$/.test(claim.run_attempt || "")
  )
    fail("This workflow is not authorized to publish owner telemetry.", 403);
  let cached = keys.get(env.DB);
  if (!cached || cached.until < now || !cached.value.some((k) => k.kid === header.kid)) {
    const response = await fetcher(`${ISSUER}/.well-known/jwks`, {
      signal: AbortSignal.timeout(4000),
      redirect: "manual",
    });
    if (!response.ok || Number(response.headers.get("content-length")) > 65536)
      fail("Workflow signing keys unavailable.", 503);
    const text = await response.text();
    if (text.length > 65536) fail("Invalid signing keys.", 503);
    const value = JSON.parse(text).keys;
    if (!Array.isArray(value) || value.length > 20) fail("Invalid signing keys.", 503);
    cached = { value, until: now + 3600000 };
    keys.set(env.DB, cached);
  }
  const jwk = cached.value.find(
    (k) => k.kid === header.kid && k.kty === "RSA" && (!k.use || k.use === "sig"),
  );
  if (!jwk) fail("Unknown workflow signing key.", 401);
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      bytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1]),
    ))
  )
    fail("Invalid workflow signature.", 401);
  return claim;
}
export async function telemetryResponse(request, env) {
  if (new URL(request.url).pathname !== "/api/owner-telemetry") return null;
  const reply = (body, status = 200) =>
    Response.json(body, { status, headers: { "cache-control": "no-store" } });
  try {
    if (request.method !== "POST" || request.headers.get("origin"))
      fail("Workflow POST required.", 405);
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    const claim = await verifyTelemetryToken(token, env);
    const reader = request.body?.getReader();
    if (!reader) fail("Telemetry body required.");
    let raw = "";
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        if (raw.length > 12000) fail("Telemetry payload too large.", 413);
      }
      raw += decoder.decode();
    } finally {
      await reader.cancel();
    }
    const input = JSON.parse(raw);
    const id = clean(input.id, 120);
    // A workflow can only modify its own run/attempt task namespace.
    if (!id.startsWith(`run:${claim.run_id}:${claim.run_attempt}:`))
      fail("Telemetry task must belong to this workflow run.", 403);
    const settings = await initializeMonitor(env.DB);
    const task = await updateTask(
      env.DB,
      {
        ...input,
        source: "workflow",
        branch: "main",
        commit: claim.sha,
        links: [
          {
            label: "Workflow run",
            url: `https://github.com/${REPOSITORY}/actions/runs/${claim.run_id}`,
          },
        ],
      },
      Date.now(),
      settings,
    );
    return reply({ accepted: true, revision: task.revision });
  } catch (error) {
    return reply(
      { error: error.status ? error.message : "Telemetry could not be stored." },
      error.status || 503,
    );
  }
}
