import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, mkdir, cp, symlink, realpath, rm, writeFile } from "node:fs/promises";
import { createWriteStream, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { accountScenarios } from "./account-scenarios.mjs";

const scenario = process.argv[2];
if (process.argv.length !== 3 || !["accounts", ...accountScenarios].includes(scenario))
  throw new Error(`Usage: npm run verify:focus -- ${["accounts", ...accountScenarios].join("|")}`);
if (process.env.CI)
  throw new Error("Focused checks are local diagnostics, never a CI release gate.");
const required = readFileSync(".nvmrc", "utf8").trim();
if (process.versions.node.split(".")[0] !== required)
  throw new Error(`Use Node ${required}; run npm run dev:doctor for setup guidance.`);

const root = process.cwd();
const snapshot = await mkdtemp(join(tmpdir(), "lootsplit-focus-"));
const output = resolve("test-results/focused", `${Date.now()}-${scenario}`);
await mkdir(output, { recursive: true });
const children = [];
let interrupted = false;
const stop = (signal = "SIGTERM") => {
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  }
};
const interrupt = () => {
  interrupted = true;
  stop();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const startedAt = new Date().toISOString();
const record = {
  scenario,
  startedAt,
  status: "running",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
};
const save = () => writeFile(join(output, "checkpoint.json"), JSON.stringify(record, null, 2));
await save();
const deadline = setTimeout(() => {
  interrupted = true;
  record.status = "timed_out";
  stop("SIGKILL");
}, 300000);
try {
  // Include current edits/untracked source, never a developer's DB, secrets, or browser profiles.
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  for (const file of new Set(files)) {
    if (
      /^(data|node_modules|test-results|dist|\.git|\.wrangler)(\/|$)/.test(file) ||
      /(^|\/)\.env($|\.)/.test(file)
    )
      continue;
    const target = join(snapshot, file);
    await mkdir(dirname(target), { recursive: true });
    try {
      await cp(join(root, file), target, { dereference: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } // tracked deletion
  }
  await symlink(await realpath("node_modules"), join(snapshot, "node_modules"), "dir");
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const log = createWriteStream(join(output, "server.log"));
  const server = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: snapshot,
      env: {
        ...process.env,
        VITE_AUTH_ENABLED: "false",
        LOOTSPLIT_VITE_CACHE_DIR: join(snapshot, ".vite-cache"),
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(server);
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  let spawnError;
  server.on("error", (e) => {
    spawnError = e;
  });
  const readyDeadline = Date.now() + 90000;
  while (true) {
    if (interrupted) throw new Error("Focused check interrupted");
    if (spawnError || server.exitCode !== null)
      throw spawnError || new Error("Disposable server exited; inspect server.log");
    try {
      if ((await fetch(origin + "/welcome", { signal: AbortSignal.timeout(2000) })).ok) break;
    } catch {
      /* bounded readiness poll */
    }
    if (Date.now() > readyDeadline)
      throw new Error("Disposable server did not become ready within 90 seconds");
    await new Promise((done) => setTimeout(done, 250));
  }
  console.log(`Focused ${scenario}: disposable server ready; diagnostics: ${output}`);
  const args = [
    "scripts/account-browser-audit.mjs",
    ...(scenario === "accounts" ? [] : ["--scenario", scenario]),
  ];
  const check = spawn(process.execPath, args, {
    cwd: snapshot,
    env: { ...process.env, ACCOUNT_AUDIT_ORIGIN: origin, AUDIT_RESULTS_DIR: output },
    detached: process.platform !== "win32",
    stdio: "inherit",
  });
  children.push(check);
  const [code] = await once(check, "exit");
  if (interrupted || code !== 0)
    throw new Error(`Focused ${scenario} did not pass. Inspect ${output}`);
  record.status = "passed";
} catch (error) {
  record.status =
    record.status === "timed_out" ? "timed_out" : interrupted ? "interrupted" : "failed";
  record.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  stop("SIGKILL");
  record.finishedAt = new Date().toISOString();
  await save();
  await rm(snapshot, { recursive: true, force: true });
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
