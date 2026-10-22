# Agent tooling

This is what Claude Code sessions get when working in this repository, and what the owner sets up outside it. CLAUDE.md remains the rulebook; these tools enforce and support it.

## In the repository

| Piece | File | What it does |
| --- | --- | --- |
| Dependency install | `.claude/hooks/session-start.mjs` (SessionStart) | Runs `npm ci --prefer-offline` when `node_modules` is missing. On failure, it tells the agent to use CLAUDE.md's no-`node_modules` fallback and to report what could not run. |
| Rule guard | `.claude/hooks/guard.mjs` (PreToolUse) | Blocks the actions listed under "What the guard blocks" below. Tested by `scripts/agent-guard.test.mjs`. |
| Lint feedback | `.claude/hooks/lint-edited.mjs` (PostToolUse) | Runs ESLint, errors only, on each edited JS/TS file and hands errors back to the agent. It never reformats, because the repository isn't Prettier-normalized. |
| Money checklist | `.claude/skills/money-command/` | `/money-command`: the both-engines, whole-copper, idempotency, projection and test checklist for anything that moves money or items. |
| Shipping procedure | `.claude/skills/ship-pr/` | `/ship-pr`: CLAUDE.md's branch → verify → PR → CI → merge steps, including the REST-only `gh api` calls cloud sessions need. |
| Privacy reviewer | `.claude/agents/privacy-reviewer.md` | A read-only subagent that traces new data to every player-facing reader and checks server-side authorization. |
| MCP servers | `.mcp.json` | See the MCP servers table below. |

### What the guard blocks

- edits to migrations already on `main`;
- signing files (`*.jks`, `*.keystore`, `*.p12`, `keystore.properties`);
- `wrangler d1 migrations apply --remote`;
- remote `d1 execute` with `--file` or any write SQL;
- `wrangler deploy`, rollback, version upload or deploy, secret changes, and D1 create or delete;
- pushes to `main`;
- `git push --force` without `--force-with-lease`.

### MCP servers

| Server | Connects to | Notes |
| --- | --- | --- |
| `cloudflare-api` | `https://mcp.cloudflare.com/mcp` | The whole Cloudflare API in Code Mode. It replaces the deprecated Workers Bindings server. |
| `context7` | `https://mcp.context7.com/mcp` | Current library documentation (React 19, TanStack, Capacitor, Wrangler). |
| `playwright` | `@playwright/mcp@0.0.83` | Headless, isolated browser driving through accessibility snapshots. |
| `chrome-devtools` | `chrome-devtools-mcp@1.11.0` | Headless performance traces, network and console. |

MCP servers are pinned to exact versions; `scripts/agent-guard.test.mjs` refuses `@latest`. Update the pins deliberately.

Production D1 stays read-only through any of these: the guard and CLAUDE.md apply whichever tool issues the query.

## Testing and profiling tools

| Tool | How to run | What it does |
| --- | --- | --- |
| fast-check property tests | Part of `npm test` (`src/lib/quire/money-properties.test.ts`) | Generated inputs for whole-copper money and offline/shared engine parity. A failure prints the smallest counterexample. |
| Accessibility audit (axe-core) | `node scripts/a11y-browser-audit.mjs` against `npm run dev`; CI job "Accessibility (axe-core)" in `code-health.yml` | Checks public and DM screens at 1280 and 390 px against WCAG 2.1 A/AA. Writes `test-results/a11y/result.json` and a summary table. It is report-only; `A11Y_FAIL_IMPACT=critical` (or serious, moderate, minor) makes it fail at that level. |
| React Scan | `VITE_REACT_SCAN=1 npm run dev` | Highlights components as they re-render. It loads only in development and only when opted in, so production builds never include it. |
| Mutation testing (StrykerJS) | `npm run mutation` | Mutates `src/lib/quire/money.ts` and checks that a test fails for each change. Stryker installs on demand into `.stryker-tools/`. The HTML report is at `test-results/mutation/index.html`. The first baseline was a 46% score, with most survivors in formatting and price parsing. It's manual and not in CI; widen `mutate` in `stryker.config.mjs` deliberately. |

## Owner setup outside the repository

1. **Cloud environment setup script.**
   - Where: claude.ai, Claude Code, your environment's settings.
   - Network access: **Trusted**, which includes the npm registry.
   - Setup script: paste in `scripts/cloud-environment-setup.sh`.
   - Effect: the script warms the npm cache, Playwright Chromium and the pinned MCP servers, and is cached as a snapshot when it finishes within about five minutes. New sessions then start without the npm failures seen in October 2026.
2. **Cloudflare API MCP.** The first time an agent uses it, approve the OAuth prompt. Grant read access, plus anything you explicitly want agents to change.
3. **Context7 (optional).** A free API key from context7.com raises rate limits. Add it as a network secret or user-level MCP header, never in `.mcp.json`.
4. **Remote MCP hosts.** `mcp.cloudflare.com` and `mcp.context7.com` must be reachable from the environment. If a cloud session can't reach them, add them under the environment's allowed domains (Custom network access).

## Updating

- Hooks are plain Node scripts with no dependencies, so they run before `npm ci` succeeds.
- Keep them fast; hook timeouts are set in `.claude/settings.json`.
- Change `scripts/agent-guard.test.mjs` together with `guard.mjs`.
