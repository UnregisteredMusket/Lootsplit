// Never run campaign fixtures against production. All scenarios run; no retries.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { localAuditOrigin } from "./account-scenarios.mjs";
if (process.argv.length !== 2)
  throw Error("This audit runs its complete scenario without filtering.");
localAuditOrigin(process.env.ACCOUNT_AUDIT_ORIGIN || "http://127.0.0.1:8080");
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [
    join(dirname(require.resolve("playwright/package.json")), "cli.js"),
    "test",
    "--config=scripts/browser/room-viewing.config.mjs",
  ],
  { stdio: "inherit", timeout: 155000 },
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 ? 0 : 1;
