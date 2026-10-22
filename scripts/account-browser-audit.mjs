import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { accountDurationSummary, noticeAnnotation } from "./account-durations.mjs";
import { createRequire } from "node:module";
import { selectAccountScenario, localAuditOrigin, accountShard } from "./account-scenarios.mjs";
const scenario = selectAccountScenario(process.argv.slice(2));
localAuditOrigin(process.env.ACCOUNT_AUDIT_ORIGIN || "http://127.0.0.1:8080");
const require = createRequire(import.meta.url);
const args = [
  join(dirname(require.resolve("playwright/package.json")), "cli.js"),
  "test",
  "--config=scripts/browser/playwright.config.mjs",
];
if (scenario) args.push("--grep", ` ${scenario}$`);
// CI runs the complete suite as two shards in parallel jobs (owner-approved 2026-10-21); together
// they cover every scenario and each keeps the 60s case / 170s suite deadlines.
const shard = accountShard(process.env.ACCOUNT_SHARD);
if (shard) {
  if (scenario) throw new Error("Choose either one scenario or a shard, not both.");
  args.push(`--shard=${shard}`);
}
const result = spawnSync(process.execPath, args, { stdio: "inherit", timeout: 175000 });
if (result.error) console.error(result.error.message);
// Per-case durations and the worker timeline as a readable annotation (see account-durations.mjs).
if (process.env.GITHUB_ACTIONS === "true") {
  const report = resolve(process.env.AUDIT_RESULTS_DIR || "test-results/account", "results.json");
  let summary;
  try {
    summary = accountDurationSummary(JSON.parse(readFileSync(report, "utf8")));
  } catch (error) {
    summary = `Account case durations unavailable: ${error.message}`;
  }
  console.log(noticeAnnotation(`Account case durations${shard ? ` shard ${shard}` : ""}`, summary));
}
process.exitCode = result.status === 0 ? 0 : 1;
