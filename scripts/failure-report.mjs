import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { requestJson } from "./recovery-http.mjs";

export function buildReport(run, jobs, liveCommit = "unconfirmed") {
  const failed = jobs.filter((j) =>
    ["failure", "timed_out", "cancelled", "action_required", "stale"].includes(j.conclusion),
  );
  const steps = failed.flatMap(
    (j) =>
      j.steps
        ?.filter((s) => s.conclusion && !["success", "skipped"].includes(s.conclusion))
        .map((s) => `${j.name}: ${s.name} (${s.conclusion})`) || [],
  );
  const url = `https://github.com/UnregisteredMusket/Lootsplit/actions/runs/${run.id}/attempts/${run.run_attempt}`;
  return {
    schema: 1,
    runId: run.id,
    attempt: run.run_attempt,
    workflow: run.name,
    result: run.conclusion,
    commit: run.head_sha,
    branch: run.head_branch,
    url,
    liveCommit,
    failedJobs: failed.map(({ id, name, conclusion }) => ({ id, name, conclusion })),
    failedSteps: steps,
    text: [
      `Lootsplit failure report`,
      `Workflow: ${run.name}`,
      `Result: ${run.conclusion}`,
      `Commit: ${run.head_sha}`,
      `Branch: ${run.head_branch}`,
      `Run: ${run.id}, attempt ${run.run_attempt}`,
      `Live commit observed: ${liveCommit}`,
      `Details: ${url}`,
      "",
      ...(steps.length
        ? steps
        : [
            "No failed step was reported; inspect the run for cancellation, timeout or runner loss.",
          ]),
      "",
      "Recovery: read docs/RECOVERY.md and run npm run recover:status. Inspect the failed stage; re-run only after reconciling current main and live identity.",
      "No deployment, rollback, data restore or retry of a gameplay operation was performed by this reporter.",
      "Chat session disconnects are not observable by GitHub; this report covers repository workflows.",
    ].join("\n"),
  };
}

export async function emailReport(report, env = process.env, request = requestJson) {
  const required = ["FAILURE_REPORT_EMAIL", "FAILURE_REPORT_FROM", "RESEND_API_KEY"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) return { status: "not_configured", missing };
  const delivery = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `lootsplit-failure/${report.runId}/${report.attempt}`,
    },
    body: JSON.stringify({
      from: env.FAILURE_REPORT_FROM,
      to: [env.FAILURE_REPORT_EMAIL],
      subject: `Lootsplit: ${report.result} — ${report.workflow}`,
      text: report.text,
    }),
  });
  if (!delivery.id) throw Error("Email provider did not confirm acceptance");
  return { status: "accepted", id: delivery.id };
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const run = event.workflow_run;
  if (
    !run ||
    !Number.isSafeInteger(run.id) ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.repository?.full_name !== "UnregisteredMusket/Lootsplit"
  )
    throw Error("Invalid source workflow");
  const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}` };
  const jobs = [];
  for (let page = 1; page <= 10; page++) {
    const data = await requestJson(
      `https://api.github.com/repos/UnregisteredMusket/Lootsplit/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
      { headers },
    );
    jobs.push(...data.jobs);
    if (data.jobs.length < 100) break;
    if (page === 10) throw Error("Workflow job report exceeded pagination limit");
  }
  let live = "unconfirmed";
  try {
    const identity = await requestJson(
      "https://lootsplit.oliverstorie2017.workers.dev/assets/release-identity.json",
      { cache: "no-store" },
    );
    if (/^[a-f0-9]{40}$/.test(identity.commit)) live = identity.commit;
  } catch {
    /* Explicitly report unknown when the site is unavailable. */
  }
  const report = buildReport(run, jobs, live);
  mkdirSync("test-results/failure-report", { recursive: true });
  const save = () => {
    writeFileSync("test-results/failure-report/report.json", JSON.stringify(report, null, 2));
    writeFileSync(
      "test-results/failure-report/report.txt",
      report.text + `\n\nEmail status: ${report.email?.status || "pending"}\n`,
    );
  };
  save();
  try {
    report.email = await emailReport(report);
  } catch (error) {
    report.email = { status: "failed", reason: error.message };
    process.exitCode = 1;
  }
  save();
  if (process.env.GITHUB_STEP_SUMMARY) {
    // Indented code avoids interpreting untrusted job/branch names as Markdown.
    const summary =
      report.text +
      `\n\nEmail status: ${report.email.status}` +
      (report.email.missing ? `\nMissing settings: ${report.email.missing.join(", ")}` : "");
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      summary
        .split("\n")
        .map((s) => `    ${s}`)
        .join("\n") + "\n",
    );
  }
  console.log(`Failure report saved. Email status: ${report.email.status}`);
  if (report.email.status === "not_configured")
    console.log(
      "::warning::Failure email is not configured; see the report summary for missing setting names.",
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
