import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { stepTelemetry } from "./monitor-publish.mjs";

export function atomicJson(path, value) {
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(path + ".tmp", path);
}

// Terminal color codes, built from the escape character (lint rejects control characters in regex literals).
const ANSI_COLOR = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

/** A GitHub `::error` workflow command carrying the last output lines of a failed step. */
/** Collects failing node:test/TAP cases ("not ok N - name" and a few detail lines) from a stream. */
export function failureCollector(limit = 12) {
  const failures = [];
  let partial = "",
    detail = 0;
  return {
    failures,
    push(text) {
      const lines = (partial + String(text).replace(ANSI_COLOR, "")).split(/\r?\n/);
      partial = lines.pop();
      for (const line of lines) {
        if (/^\s*not ok \d+ - /.test(line) && failures.length < limit) {
          failures.push(line.trim());
          detail = 6;
        } else if (detail > 0 && line.trim()) {
          detail -= 1;
          if (/error|expected|actual|message|location/i.test(line))
            failures.push("    " + line.trim().slice(0, 240));
        }
      }
    },
  };
}

export function failureAnnotation(id, status, output, failures = []) {
  const failed = failures.length ? "Failed tests:\n" + failures.join("\n") + "\n---\n" : "";
  const lines =
    failed +
    String(output)
      .replace(ANSI_COLOR, "")
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(-40)
      .join("\n")
      .slice(-3500);
  const escape = (value) => value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return `::error title=${escape(`${id} ${status}`).replace(/[:,]/g, " ")}::${escape(lines || "(no output)")}`;
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
  const publish = stepTelemetry({ id, seconds, startedAt: record.startedAt });
  void publish("running");
  console.log(`[recovery] START ${id}, deadline ${seconds}s`);
  // Output is passed through unchanged and its tail is kept, so a failure can be reported as a
  // GitHub annotation: annotations are readable through the API even where log downloads aren't.
  const child = spawn(command, args, {
    stdio: ["inherit", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let tail = "";
  const collector = failureCollector();
  const keep = (chunk, stream) => {
    stream.write(chunk);
    const text = chunk.toString("utf8");
    tail = (tail + text).slice(-6000);
    collector.push(text);
  };
  child.stdout?.on("data", (chunk) => keep(chunk, process.stdout));
  child.stderr?.on("data", (chunk) => keep(chunk, process.stderr));
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
  // GitHub cancellation sends SIGINT, then SIGTERM, then kills the runner a few seconds later.
  // Report the terminal state at once, in parallel with stopping the child, so a cancelled run
  // does not leave its step "testing" forever. Repeated signals are absorbed (not fatal) here.
  let terminal = null;
  const interrupt = () => {
    if (!reason)
      terminal = publish(
        "interrupted",
        "The workflow run was cancelled or interrupted before this step reported a result.",
      );
    stop("interrupted");
  };
  process.on("SIGTERM", interrupt);
  process.on("SIGINT", interrupt);
  const deadline = setTimeout(() => stop("timed_out"), seconds * 1000);
  const heartbeat = setInterval(() => {
    record.heartbeatAt = new Date().toISOString();
    save();
    void publish("running");
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
  if (record.status !== "passed" && process.env.GITHUB_ACTIONS === "true")
    console.log(failureAnnotation(id, record.status, tail, collector.failures));
  console.log(`[recovery] ${record.status.toUpperCase()} ${id}`);
  // An interruption was already reported; a second terminal event would be rejected.
  await (terminal ?? publish(record.status === "passed" ? "success" : record.status));
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
