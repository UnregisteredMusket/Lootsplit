#!/bin/bash
# Lootsplit cloud environment setup script for Claude Code cloud sessions.
# Paste this into claude.ai -> Claude Code -> your environment -> Setup script (network: Trusted).
# It runs before the session starts and the result is cached as a snapshot, so every session begins
# with a warm npm cache, Playwright Chromium and the pinned MCP servers. The repository's
# SessionStart hook then runs `npm ci --prefer-offline`, which installs from that cache.
# Every step is non-fatal: a setup script that exits non-zero stops the session from starting.
set -u
work=/tmp/lootsplit-warm
rm -rf "$work"
git clone --depth 1 https://github.com/UnregisteredMusket/Lootsplit "$work" || exit 0
cd "$work" || exit 0
npm ci --ignore-scripts --no-audit --no-fund || true
npx playwright install --with-deps chromium || true
npm cache add @playwright/mcp@0.0.83 chrome-devtools-mcp@1.11.0 knip@6.42.1 || true
cd / && rm -rf "$work"
exit 0
