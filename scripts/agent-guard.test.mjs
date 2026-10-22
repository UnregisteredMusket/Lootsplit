import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

// The Claude Code guard hook must block what CLAUDE.md forbids and allow ordinary work.
const root = new URL("..", import.meta.url).pathname;
const run = (payload) =>
  spawnSync(process.execPath, [".claude/hooks/guard.mjs"], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
const bash = (command) => run({ tool_name: "Bash", tool_input: { command } });
const edit = (file_path) => run({ tool_name: "Edit", tool_input: { file_path } });

test("blocks edits to committed migrations and allows new ones", () => {
  const applied = readdirSync(new URL("../cloudflare/migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort()[0];
  const tracked = spawnSync("git", ["-C", root, "cat-file", "-e", `HEAD:cloudflare/migrations/${applied}`]);
  if (tracked.status === 0) {
    // Committed on main in CI and normal clones; the hook checks origin/main, then main.
    const onMain = ["origin/main", "main"].some(
      (ref) =>
        spawnSync("git", ["-C", root, "cat-file", "-e", `${ref}:cloudflare/migrations/${applied}`]).status === 0,
    );
    if (onMain) assert.equal(edit(`cloudflare/migrations/${applied}`).status, 2);
  }
  assert.equal(edit("cloudflare/migrations/9999_new_table.sql").status, 0);
  assert.equal(edit("src/lib/quire/commands.ts").status, 0);
});

test("blocks signing material", () => {
  assert.equal(edit("android/app/release.jks").status, 2);
  assert.equal(edit("android/keystore.properties").status, 2);
});

test("keeps production D1 read-only and deploys in the release workflows", () => {
  assert.equal(bash("npx wrangler d1 migrations apply lootsplit --remote").status, 2);
  assert.equal(bash('npx wrangler d1 execute lootsplit --remote --command "DELETE FROM x"').status, 2);
  assert.equal(bash("npx wrangler d1 execute lootsplit --remote --file seed.sql").status, 2);
  assert.equal(bash("cd cloudflare && npx wrangler deploy").status, 2);
  assert.equal(bash("npx wrangler secret put TOKEN").status, 2);
  assert.equal(bash('npx wrangler d1 execute lootsplit --remote --command "SELECT COUNT(*) FROM campaign_rooms"').status, 0);
  assert.equal(bash("npx wrangler d1 migrations apply lootsplit --local").status, 0);
});

test("main changes only through pull requests", () => {
  assert.equal(bash("git push origin main").status, 2);
  assert.equal(bash("git push origin HEAD:main").status, 2);
  assert.equal(bash("git push --force origin fix/x").status, 2);
  assert.equal(bash("git push -u origin fix/main-menu").status, 0);
  assert.equal(bash("git push --force-with-lease origin fix/x").status, 0);
  assert.equal(bash("npm test").status, 0);
});

test("project settings wire every hook", () => {
  const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"));
  const commands = Object.values(settings.hooks)
    .flat()
    .flatMap((entry) => entry.hooks.map((hook) => hook.command))
    .join("\n");
  for (const hook of ["session-start.mjs", "guard.mjs", "lint-edited.mjs"]) assert.match(commands, new RegExp(hook));
  const mcp = JSON.parse(readFileSync(new URL("../.mcp.json", import.meta.url), "utf8"));
  for (const server of Object.values(mcp.mcpServers))
    for (const arg of server.args ?? []) assert.doesNotMatch(arg, /@latest$/, "pin MCP server versions");
});

test("the install hook retries through the HTTPS proxy without touching other no-proxy hosts", async () => {
  const { viaProxyEnv } = await import("../.claude/hooks/session-start.mjs");
  const env = {
    HTTPS_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "localhost,registry.npmjs.org,api.anthropic.com",
    no_proxy: "localhost,registry.npmjs.org",
    npm_config_noproxy: "registry.npmjs.org",
  };
  const next = viaProxyEnv(env);
  assert.equal(next.NO_PROXY, "localhost,api.anthropic.com");
  assert.equal(next.no_proxy, "localhost");
  assert.equal(next.npm_config_noproxy, "");
  assert.equal(viaProxyEnv({ NO_PROXY: "registry.npmjs.org" }), null, "no proxy configured");
  assert.equal(viaProxyEnv({ HTTPS_PROXY: "http://x", NO_PROXY: "localhost" }), null, "nothing to change");
});
