import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { requestJson } from "./recovery-http.mjs";
const repo = "UnregisteredMusket/Lootsplit";
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
const directory = "test-results/recovery";
const checkpoints = existsSync(directory)
  ? readdirSync(directory)
      .filter((p) => p.endsWith(".json"))
      .map((p) => JSON.parse(readFileSync(`${directory}/${p}`, "utf8")))
  : [];
const result = {
  head,
  dirty,
  checkpoints,
  remote: null,
  instructions:
    "Read docs/RECOVERY.md. Never infer a failed upload from a chat timeout. Local checkpoints are diagnostic only; release gates always run fresh.",
};
try {
  const headers = process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {};
  const [branch, runs, live] = await Promise.all([
    requestJson(`https://api.github.com/repos/${repo}/branches/main`, { headers }),
    requestJson(`https://api.github.com/repos/${repo}/actions/runs?per_page=20`, { headers }),
    requestJson("https://lootsplit.oliverstorie2017.workers.dev/assets/release-identity.json", {
      cache: "no-store",
    }),
  ]);
  result.remote = {
    main: branch.commit.sha,
    live: live.commit,
    matchesMain: live.commit === branch.commit.sha,
    runs: runs.workflow_runs.map(({ id, name, status, conclusion, head_sha, html_url }) => ({
      id,
      name,
      status,
      conclusion,
      commit: head_sha,
      url: html_url,
    })),
  };
} catch (error) {
  result.remoteError = error.message;
  process.exitCode = 1;
}
console.log(JSON.stringify(result, null, 2));
