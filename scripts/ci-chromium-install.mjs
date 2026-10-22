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

const PACKAGE = /^[a-z0-9][a-z0-9.+-]*(:[a-z0-9]+)?$/;
function checked(packages) {
  for (const name of packages) if (!PACKAGE.test(name)) throw Error(`Unexpected package name: ${name}`);
  return packages;
}

/**
 * Reads `playwright install-deps --dry-run chromium`. Playwright 1.63 simulates the install
 * (`apt-get install -s`) and reports what is missing; earlier versions print the apt command,
 * whose package list is then checked with dpkg. Returns null when the output is unrecognized
 * (for example the simulation failed on missing package lists).
 */
export function parseDryRun(output) {
  if (/All system dependencies are installed\./.test(output)) return { missing: [] };
  const report = /Missing system dependencies \(\d+\):\n((?:[ \t]+\S+[ \t]*(?:\n|$))+)/.exec(output);
  if (report) return { missing: checked(report[1].trim().split(/\s+/)) };
  const command = /apt-get install -y --no-install-recommends ([^"&;|]+)/.exec(output);
  if (command) return { packages: checked(command[1].trim().split(/\s+/)) };
  return null;
}

/** True when every package is an optional font package (fonts-*, xfonts-*). */
export function fontsOnly(packages) {
  return packages.length > 0 && packages.every((name) => /^(fonts|xfonts)-/.test(name));
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
  let updated = false;
  let libraries = 0;
  const update = () => {
    if (updated) return;
    const [cmd, ...args] = apt("update");
    libraries += bounded("apt-get update", cmd, args, { seconds: 120 });
    updated = true;
  };
  const dryRun = () => {
    const result = spawnSync(node, [cli, "install-deps", "--dry-run", "chromium"], {
      encoding: "utf8",
      timeout: 120000,
    });
    return { text: `${result.stdout || ""}\n${result.stderr || ""}`, parsed: parseDryRun(result.stdout || "") };
  };
  let check = dryRun();
  // The simulation needs current package lists; refresh them once and ask again.
  if (!check.parsed) {
    update();
    check = dryRun();
  }
  if (!check.parsed) throw Error(`Unrecognized Playwright dependency check: ${check.text.trim().slice(0, 600)}`);
  let missing = check.parsed.missing;
  let total;
  if (!missing) {
    const packages = check.parsed.packages;
    const query = spawnSync("dpkg-query", ["-W", "-f", "${Package} ${db:Status-Abbrev}\\n", ...packages], {
      encoding: "utf8",
    });
    // dpkg-query exits 1 when a package is unknown; its stdout still lists the known ones.
    missing = missingPackages(packages, query.stdout || "");
    total = packages.length;
  }
  let fontGap = "";
  if (missing.length) {
    update();
    const [cmd, ...args] = apt("install", "-y", "--no-install-recommends", "--fix-missing", ...missing);
    try {
      libraries += bounded("apt-get install", cmd, args, { seconds: 180 });
    } catch (first) {
      // A mirror that changed under the runner's package lists fails the install outright; refresh
      // the lists and try once more, then fall back to Playwright's own installer.
      updated = false;
      update();
      try {
        libraries += bounded("apt-get install (fresh lists)", cmd, args, { seconds: 180, attempts: 1 });
      } catch {
        try {
          libraries += bounded("playwright install-deps", node, [cli, "install-deps", "chromium"], {
            seconds: 300,
            attempts: 1,
          });
        } catch {
          // Only optional font packages missing: the headless shell runs with the image's own
          // fonts, so continue with an explicit warning rather than fail every audit on a mirror.
          if (!fontsOnly(missing)) throw first;
          fontGap = ` (font packages unavailable from the mirror, continued without them)`;
          console.log(`::warning title=Chromium install::Optional font packages could not be installed: ${missing.join(" ")}`);
        }
      }
    }
  }
  const shell = bounded("headless shell", node, [cli, "install", "--only-shell", "chromium"], { seconds: 120 });
  const cache = process.env.CHROMIUM_CACHE_HIT === "true" ? "restored from cache" : "downloaded";
  const summary =
    (missing.length
      ? `System libraries: ${missing.length} missing${total ? ` of ${total}` : ""} (${missing.join(" ")}), apt took ${libraries}s${fontGap}`
      : `System libraries: all present${updated ? ` after a ${libraries}s apt-get update` : ", apt skipped"}`) +
    `. Headless shell ${cache}, ready in ${shell}s.`;
  console.log(`::notice title=Chromium install::${summary}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    // Job logs are not always readable; the annotation carries the reason.
    const text = String(error?.stack || error).slice(0, 1500).replace(/%/g, "%25").replace(/\r?\n/g, "%0A");
    console.log(`::error title=Chromium install failed::${text}`);
    process.exitCode = 1;
  }
}
