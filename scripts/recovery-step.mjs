import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export function atomicJson(path, value) {
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(path + ".tmp", path);
}

// The runner never retries a command. A failed assertion must stay a failure;
// writes and deployments must be reconciled before anybody repeats them.
export async function runStep({
  id,
  seconds,
  command,
  args = [],
  directory = "test-results/recovery",
  heartbeatMs = 20000,
}) {
  if (!/^[a-z0-9-]+$/.test(id) || !Number.isFinite(seconds) || seconds <= 0 || !command)
    throw Error("Usage: recovery-step.mjs STEP TIMEOUT_SECONDS COMMAND [ARG...]");
  mkdirSync(directory, { recursive: true });
  let commit = process.env.GITHUB_SHA || "unknown";
  if (commit === "unknown") {
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
      /* non-git test fixture */
    }
  }
  const record = {
    schema: 1,
    id,
    commit,
    runId: process.env.GITHUB_RUN_ID || null,
    attempt: process.env.GITHUB_RUN_ATTEMPT || null,
    status: "running",
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    timeoutSeconds: seconds,
  };
  const path = join(directory, `${id}.json`);
  const save = () => atomicJson(path, record);
  save();
  console.log(`[recovery] START ${id}, deadline ${seconds}s`);
  const child = spawn(command, args, { stdio: "inherit", detached: process.platform !== "win32" });
  let reason, killTimer;
  const signalTree = (signal) => {
    if (!child.pid) return;
    try {
      process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const stop = (status) => {
    if (reason) return;
    reason = status;
    record.status = status;
    record.finishedAt = new Date().toISOString();
    save();
    signalTree("SIGTERM");
    killTimer = setTimeout(() => signalTree("SIGKILL"), 2000);
  };
  const interrupt = () => stop("interrupted");
  process.once("SIGTERM", interrupt);
  process.once("SIGINT", interrupt);
  const deadline = setTimeout(() => stop("timed_out"), seconds * 1000);
  const heartbeat = setInterval(() => {
    record.heartbeatAt = new Date().toISOString();
    save();
    console.log(
      `[recovery] ${id}: ${record.status}, ${Math.round((Date.now() - Date.parse(record.startedAt)) / 1000)}s elapsed`,
    );
  }, heartbeatMs);
  const outcome = await new Promise((done) => {
    child.once("error", (error) => done({ code: 1, error: error.code || "spawn_failed" }));
    child.once("close", (code, signal) => done({ code, signal }));
  });
  // Kill any descendants even if the parent handled TERM and exited first.
  signalTree("SIGKILL");
  clearTimeout(deadline);
  clearTimeout(killTimer);
  clearInterval(heartbeat);
  process.removeListener("SIGTERM", interrupt);
  process.removeListener("SIGINT", interrupt);
  Object.assign(record, outcome, {
    status: reason || (outcome.code === 0 ? "passed" : "failed"),
    finishedAt: new Date().toISOString(),
  });
  save();
  console.log(`[recovery] ${record.status.toUpperCase()} ${id}`);
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [id, seconds, command, ...args] = process.argv.slice(2);
  try {
    const result = await runStep({ id, seconds: Number(seconds), command, args });
    process.exitCode =
      result.status === "passed"
        ? 0
        : result.status === "timed_out"
          ? 124
          : result.status === "interrupted"
            ? 130
            : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
