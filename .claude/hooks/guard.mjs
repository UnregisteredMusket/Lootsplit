#!/usr/bin/env node
// PreToolUse guard for Claude Code sessions in this repository.
// Enforces CLAUDE.md rules that must never depend on an agent remembering them:
// applied migrations are immutable, signing material stays out of the repo, production D1
// is read-only, deploys go through the release workflows, and main changes only through PRs.
// Exit code 2 blocks the tool call and shows the reason to the agent.
import { execFileSync } from "node:child_process";
import { relative, resolve, basename } from "node:path";

const input = JSON.parse(await new Promise((done) => {
  let text = "";
  process.stdin.on("data", (chunk) => (text += chunk));
  process.stdin.on("end", () => done(text || "{}"));
}));
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const tool = input.tool_name || "";
const args = input.tool_input || {};

function block(reason) {
  process.stderr.write(`Blocked by .claude/hooks/guard.mjs: ${reason}\n`);
  process.exit(2);
}

function onMain(path) {
  for (const ref of ["origin/main", "main"]) {
    try {
      execFileSync("git", ["-C", root, "cat-file", "-e", `${ref}:${path}`], { stdio: "ignore" });
      return true;
    } catch {
      // Not present on this ref (or the ref is missing in a shallow clone); try the next one.
    }
  }
  return false;
}

if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
  const target = args.file_path || args.notebook_path;
  if (typeof target === "string" && target) {
    const path = relative(root, resolve(root, target)).split("\\").join("/");
    if (/^cloudflare\/migrations\/\d{4}_[^/]+\.sql$/.test(path) && onMain(path))
      block(
        `${path} is an applied migration. Never edit or renumber it; add a new additive ` +
          "cloudflare/migrations/NNNN_*.sql in this PR instead (CLAUDE.md, Schema).",
      );
    if (/\.(jks|keystore|p12)$/i.test(path) || basename(path) === "keystore.properties")
      block(`${path} is signing material. Never generate or commit keys (CLAUDE.md, Android).`);
  }
}

if (tool === "Bash" && typeof args.command === "string") {
  // Judge each shell segment separately so `cd x && wrangler ...` is still checked.
  for (const segment of args.command.split(/&&|\|\||;|\n/)) {
    const cmd = segment.trim();
    if (!/\bwrangler\b|\bgit\b/.test(cmd)) continue;
    if (/\bwrangler\b.*\bd1\s+migrations\s+apply\b/.test(cmd) && /--remote\b/.test(cmd))
      block(
        "only the release job applies migrations to production D1 (scripts/production-migrations.mjs). " +
          "Use --local for local checks.",
      );
    if (/\bwrangler\b.*\bd1\s+execute\b/.test(cmd) && /--remote\b/.test(cmd)) {
      const writes = /\b(insert|update|delete|replace|drop|alter|create|vacuum|reindex|attach)\b/i;
      if (/--file\b/.test(cmd) || writes.test(cmd))
        block("production D1 is read-only. Remote queries must be single SELECT statements (CLAUDE.md rules).");
    }
    if (/\bwrangler\s+(deploy|publish|rollback|versions\s+(deploy|upload)|secret\s+(put|delete|bulk)|d1\s+(create|delete))\b/.test(cmd))
      block(
        "production changes ship only through the release workflows after main verification " +
          "(CLAUDE.md, How a change ships). Open a PR instead.",
      );
    if (/\bgit\s+push\b/.test(cmd) && /(\s|:|\+)(main|master)(\s|$)/.test(cmd))
      block("main changes only through a pull request. Push a fix/, feature/ or dev/ branch and open a PR.");
    if (/\bgit\s+push\b/.test(cmd) && /\s(--force|-f)(\s|$)/.test(cmd) && !/--force-with-lease/.test(cmd))
      block("use --force-with-lease on your own branch instead of --force.");
  }
}

process.exit(0);
