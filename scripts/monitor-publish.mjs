import { deploymentOrigins } from "../src/lib/deployment/origins.mjs";
/** Called by the actual bounded job runner. No credentials are printed or persisted. */
export function stepTelemetry({ id, seconds, startedAt }) {
  const enabled =
    process.env.LOOTSPLIT_MONITOR_TELEMETRY === "true" &&
    process.env.GITHUB_REF === "refs/heads/main" &&
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  let revision = 0,
    chain = Promise.resolve(),
    token = null,
    expires = 0,
    warned = false;
  const taskId =
    `run:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT}:${process.env.GITHUB_JOB}:${id}`.slice(
      0,
      120,
    );
  return (status, progress) => {
    if (!enabled) return Promise.resolve();
    chain = chain.then(async () => {
      try {
        if (!token || Date.now() > expires) {
          const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
          url.searchParams.set(
            "audience",
            "https://lootsplit.oliverstorie2017.workers.dev/monitoring",
          );
          const auth = await fetch(url, {
            headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
            signal: AbortSignal.timeout(2000),
            redirect: "error",
          });
          if (!auth.ok) throw Error("OIDC unavailable");
          token = (await auth.json()).value;
          expires = Date.now() + 120000;
        }
        const state =
          status === "running"
            ? /deploy|publish/.test(id)
              ? "deploying"
              : "testing"
            : status === "success"
              ? "completed"
              : "failed";
        const response = await fetch(
          new URL("/api/owner-telemetry", deploymentOrigins.website),
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            redirect: "error",
            signal: AbortSignal.timeout(3000),
            body: JSON.stringify({
              id: taskId,
              eventId: `${taskId}:${revision}:${status}`,
              revision,
              title: id,
              objective:
                "Run the existing required verification or release step and retain its real result.",
              state,
              phase: id,
              progress:
                progress ||
                (status === "running"
                  ? "The actual runner is executing this step."
                  : `Runner result: ${status}.`),
              expectedUntil:
                status === "running"
                  ? Math.max(Date.now() + 1000, Date.parse(startedAt) + seconds * 1000)
                  : null,
              nextAction:
                status === "running"
                  ? "Wait for the bounded step result; inspect its log if progress stops."
                  : state === "failed"
                    ? "Diagnose the retained failure before any retry."
                    : "Continue the next required gate.",
            }),
          },
        );
        if (!response.ok) throw Error("Telemetry rejected");
        revision = (await response.json()).revision;
      } catch {
        if (!warned) {
          console.warn(
            "[monitor] Development telemetry unavailable; verification continues and monitoring must show a coverage gap.",
          );
          warned = true;
        }
      }
    });
    return chain;
  };
}
