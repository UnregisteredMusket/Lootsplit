#!/usr/bin/env node
// SessionStart: make sure dependencies are installed before work starts, locally and in cloud
// sessions. A cloud environment setup script (see docs/AGENT-TOOLING.md) usually makes this a
// no-op; when it can't install, the agent is told to use CLAUDE.md's no-node_modules fallback.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const NO_PROXY_KEYS = ["NO_PROXY", "no_proxy", "npm_config_noproxy"];

/**
 * Some cloud sandboxes list registry.npmjs.org under NO_PROXY while direct DNS to it fails, yet
 * the HTTPS proxy reaches it. The retry drops only the npm registry from the no-proxy lists.
 */
export function viaProxyEnv(env) {
  if (!env.HTTPS_PROXY && !env.https_proxy) return null;
  const next = { ...env };
  let changed = false;
  for (const key of NO_PROXY_KEYS) {
    if (typeof next[key] !== "string") continue;
    const kept = next[key]
      .split(",")
      .filter((host) => !/(^|\.)registry\.npmjs\.org$/i.test(host.trim()))
      .join(",");
    if (kept !== next[key]) {
      next[key] = kept;
      changed = true;
    }
  }
  return changed ? next : null;
}

function npmCi(env) {
  return spawnSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 540_000,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lines = [];
  if (existsSync(join(root, "node_modules", ".package-lock.json"))) {
    lines.push("Dependencies: node_modules is present.");
  } else {
    let install = npmCi(process.env);
    const proxied = install.status === 0 ? null : viaProxyEnv(process.env);
    if (proxied) install = npmCi(proxied);
    if (install.status === 0)
      lines.push(
        proxied
          ? "Dependencies: installed with npm ci through the HTTPS proxy (direct registry access failed). " +
              "For later npm commands, run them with NO_PROXY, no_proxy and npm_config_noproxy " +
              "set without registry.npmjs.org."
          : "Dependencies: installed with npm ci.",
      );
    else
      lines.push(
        "Dependencies: npm ci failed, so node_modules is missing or incomplete. Follow CLAUDE.md " +
          "'Without node_modules', and say in the PR which tests, typecheck and lint could not run.",
        `npm ci exit ${install.status ?? "timeout"}: ${(install.stderr || "").trim().split("\n").slice(-3).join(" | ")}`,
      );
  }
  lines.push(
    "Guards active (.claude/hooks/guard.mjs): applied migrations, signing files, remote D1 writes, " +
      "manual deploys and direct pushes to main are blocked. See docs/AGENT-TOOLING.md.",
  );
  process.stdout.write(lines.join("\n") + "\n");
}
