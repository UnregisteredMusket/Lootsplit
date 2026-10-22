// CI-only installation of the browser every Playwright audit launches (all launch headless, which
// Playwright serves from the Chromium headless shell). Replaces `playwright install --with-deps
// chromium`, which took 9-12 minutes on some runners (October 2026) and pushed jobs past their
// timeouts. Phases are bounded and measured separately and the outcome is published as a notice
// annotation, readable through the API where job logs are not:
//   1. system libraries: the exact package list Playwright would install (its own dry run), of
//      which only the ones missing from the runner image go to apt, with bounded retries;
//   2. headless shell: restored from the actions/cache entry keyed on the Playwright version,
//      otherwise downloaded (a no-op when the cache was restored).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Packages from `playwright install-deps --dry-run chromium` output. */
export function aptPackages(dryRun) {
  const match = /apt-get install -y --no-install-recommends ([^"&;|]+)/.exec(dryRun);
  if (!match) throw Error(`Unrecognized Playwright dependency command: ${dryRun.trim().slice(0, 300)}`);
  const packages = match[1].trim().split(/\s+/);
  for (const name of packages)
    if (!/^[a-z0-9][a-z0-9.+-]*(:[a-z0-9]+)?$/.test(name)) throw Error(`Unexpected package name: ${name}`);
  return packages;
}

/** Packages that `dpkg-query -W -f '${Package} ${db:Status-Abbrev}\n'` did not report installed. */
export function missingPackages(packages, dpkgOutput) {
  const installed = new Set(
    dpkgOutput
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter(([, status]) => status === "ii")
      .map(([name]) => name.replace(/:[a-z0-9]+$/, "")),
  );
  return packages.filter((name) => !installed.has(name.replace(/:[a-z0-9]+$/, "")));
}

/** Runs a command with a per-attempt deadline, retrying once; returns the elapsed seconds. */
export function bounded(label, command, args, { seconds, attempts = 2, run = spawnSync, env } = {}) {
  const started = Date.now();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = run(command, args, {
      stdio: "inherit",
      timeout: seconds * 1000,
      killSignal: "SIGKILL",
      env: env ? { ...process.env, ...env } : process.env,
    });
    if (result.status === 0) return Math.round((Date.now() - started) / 1000);
    const why = result.error?.code === "ETIMEDOUT" ? `exceeded ${seconds}s` : `exited ${result.status ?? result.signal}`;
    console.log(`::warning title=Chromium install::${label} attempt ${attempt} of ${attempts} ${why}`);
  }
  throw Error(`${label} failed after ${attempts} attempts`);
}

function main() {
  const require = createRequire(resolve("package.json"));
  const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
  const node = process.execPath;
  const dryRun = spawnSync(node, [cli, "install-deps", "--dry-run", "chromium"], { encoding: "utf8" });
  if (dryRun.status !== 0) throw Error(`Playwright dry run failed: ${dryRun.stderr}`);
  const packages = aptPackages(dryRun.stdout);
  const query = spawnSync("dpkg-query", ["-W", "-f", "${Package} ${db:Status-Abbrev}\\n", ...packages], {
    encoding: "utf8",
  });
  // dpkg-query exits 1 when a package is unknown; its stdout still lists the known ones.
  const missing = missingPackages(packages, query.stdout || "");
  let libraries = 0;
  if (missing.length) {
    const sudo = process.getuid?.() === 0 ? [] : ["sudo"];
    const apt = (...args) => [
      ...sudo,
      "env",
      "DEBIAN_FRONTEND=noninteractive",
      "apt-get",
      // Fail over a stalled mirror instead of waiting on it, and wait a bounded time for the
      // image's own apt activity to release the lock.
      "-o", "Acquire::Retries=3",
      "-o", "Acquire::http::Timeout=30",
      "-o", "Acquire::https::Timeout=30",
      "-o", "DPkg::Lock::Timeout=120",
      ...args,
    ];
    const [cmd, ...updateArgs] = apt("update");
    libraries += bounded("apt-get update", cmd, updateArgs, { seconds: 120 });
    const [cmd2, ...installArgs] = apt("install", "-y", "--no-install-recommends", ...missing);
    libraries += bounded("apt-get install", cmd2, installArgs, { seconds: 180 });
  }
  const shell = bounded("headless shell", node, [cli, "install", "--only-shell", "chromium"], { seconds: 120 });
  const cache = process.env.CHROMIUM_CACHE_HIT === "true" ? "restored from cache" : "downloaded";
  const summary =
    `System libraries: ${missing.length} of ${packages.length} missing` +
    (missing.length ? ` (${missing.join(" ")}), installed in ${libraries}s` : ", apt skipped") +
    `. Headless shell ${cache}, ready in ${shell}s.`;
  console.log(`::notice title=Chromium install::${summary}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
