#!/usr/bin/env node
// PostToolUse: lint the file Claude just edited and hand ESLint errors back to the agent.
// It never reformats: the repository is not Prettier-normalized, so whole-file formatting
// would bury real changes in noise. Warnings stay quiet; only errors are reported.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const input = JSON.parse(await new Promise((done) => {
  let text = "";
  process.stdin.on("data", (chunk) => (text += chunk));
  process.stdin.on("end", () => done(text || "{}"));
}));
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const target = input.tool_input?.file_path;
const eslint = join(root, "node_modules", ".bin", "eslint");
if (typeof target !== "string" || !/\.(m|c)?(j|t)sx?$/.test(target) || !existsSync(eslint))
  process.exit(0);

const result = spawnSync(eslint, ["--quiet", "--no-warn-ignored", resolve(root, target)], {
  cwd: root,
  encoding: "utf8",
  timeout: 60_000,
});
if (result.status === 1) {
  process.stderr.write(`ESLint errors in ${target}:\n${result.stdout}${result.stderr}`);
  process.exit(2);
}
process.exit(0);
