import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, cp, symlink, realpath, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { createServer } from "node:net";
const root = process.cwd(),
  snapshot = await mkdtemp(join(tmpdir(), "lootsplit-world-")),
  output = resolve("test-results/world-local"),
  children = [];
await mkdir(output, { recursive: true });
const stop = () => {
  for (const c of children)
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      /* already stopped */
    }
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const deadline = setTimeout(() => {
  stop();
  process.exitCode = 1;
}, 300000);
try {
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
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  await symlink(await realpath("node_modules"), join(snapshot, "node_modules"), "dir");
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const origin = `http://127.0.0.1:${port}`,
    log = createWriteStream(join(output, "server.log"));
  const server = spawn(
    "npm",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: snapshot,
      env: {
        ...process.env,
        VITE_AUTH_ENABLED: "false",
        LOOTSPLIT_VITE_CACHE_DIR: join(snapshot, ".vite-cache"),
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(server);
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw Error("Disposable server exited; inspect server.log");
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(2000) })).ok) {
        ready = true;
        break;
      }
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw Error("Disposable server did not become ready");
  const started = Date.now(),
    audit = spawn(process.execPath, ["scripts/world-features-browser-audit.mjs"], {
      cwd: snapshot,
      env: { ...process.env, AUDIT_ORIGIN: origin },
      detached: true,
      stdio: "inherit",
    });
  children.push(audit);
  const [code] = await once(audit, "exit");
  await cp(join(snapshot, "test-results/world-features"), join(output, "browser"), {
    recursive: true,
  });
  await writeFile(
    join(output, "summary.json"),
    JSON.stringify(
      { status: code === 0 ? "passed" : "failed", durationMs: Date.now() - started, snapshot },
      null,
      2,
    ),
  );
  if (code !== 0) throw Error("World browser audit failed");
  console.log(`Disposable world check PASS (${Date.now() - started}ms)`);
} finally {
  clearTimeout(deadline);
  stop();
}
