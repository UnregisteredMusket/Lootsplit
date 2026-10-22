#!/usr/bin/env node
// SessionStart: make sure dependencies are installed before work starts, locally and in cloud
// sessions. A cloud environment setup script (see docs/AGENT-TOOLING.md) usually makes this a
// no-op; when it can't install, the agent is told to use CLAUDE.md's no-node_modules fallback.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const lines = [];
if (existsSync(join(root, "node_modules", ".package-lock.json"))) {
  lines.push("Dependencies: node_modules is present.");
} else {
  const install = spawnSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], {
    cwd: root,
    encoding: "utf8",
    timeout: 540_000,
  });
  if (install.status === 0) lines.push("Dependencies: installed with npm ci.");
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
