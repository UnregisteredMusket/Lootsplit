// `npm run mutation`: mutation testing with StrykerJS (config: stryker.config.mjs).
// Stryker is installed on demand into .stryker-tools/ (git-ignored) instead of the project's
// dependencies, so every CI job's `npm ci` stays small. Stryker resolves `typescript` from its own
// install, so the project's TypeScript version is installed beside it.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const STRYKER = "10.0.0";
const root = process.cwd();
const tools = join(root, ".stryker-tools");
const typescript = JSON.parse(readFileSync(join(root, "node_modules/typescript/package.json"), "utf8")).version;
const installed = (name) => {
  const file = join(tools, "node_modules", name, "package.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).version : null;
};
if (installed("@stryker-mutator/core") !== STRYKER || installed("typescript") !== typescript) {
  const npm = spawnSync(
    "npm",
    ["install", "--prefix", tools, "--no-save", "--no-audit", "--no-fund",
      `@stryker-mutator/core@${STRYKER}`, `typescript@${typescript}`],
    { stdio: "inherit" },
  );
  if (npm.status !== 0) process.exit(npm.status ?? 1);
}
const run = spawnSync(join(tools, "node_modules", ".bin", "stryker"), ["run", ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(run.status ?? 1);
