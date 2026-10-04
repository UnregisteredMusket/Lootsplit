import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { selectAccountScenario, localAuditOrigin } from "./account-scenarios.mjs";
const scenario = selectAccountScenario(process.argv.slice(2));
localAuditOrigin(process.env.ACCOUNT_AUDIT_ORIGIN || "http://127.0.0.1:8080");
const require = createRequire(import.meta.url);
const args = [
  join(dirname(require.resolve("playwright/package.json")), "cli.js"),
  "test",
  "--config=scripts/browser/playwright.config.mjs",
];
if (scenario) args.push("--grep", ` ${scenario}$`);
const result = spawnSync(process.execPath, args, { stdio: "inherit", timeout: 175000 });
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 ? 0 : 1;
