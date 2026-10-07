import { defineConfig } from "playwright/test";
import { resolve } from "node:path";
import { localAuditOrigin } from "../account-scenarios.mjs";

export default defineConfig({
  testDir: ".",
  testMatch: ["account.spec.mjs", "account-resume.spec.mjs"],
  forbidOnly: true,
  retries: 0,
  // Scenarios own their accounts, rooms, browser storage and rate-limit identities.
  // Keep concurrency bounded: each scenario may open several simulated devices.
  fullyParallel: true,
  workers: 2,
  timeout: 60000,
  globalTimeout: 170000,
  expect: { timeout: 15000 },
  outputDir: resolve(process.env.AUDIT_RESULTS_DIR || "test-results/account", "artifacts"),
  reporter: [
    ["line"],
    [
      "html",
      {
        outputFolder: resolve(process.env.AUDIT_RESULTS_DIR || "test-results/account", "html"),
        open: "never",
      },
    ],
    [
      "json",
      {
        outputFile: resolve(
          process.env.AUDIT_RESULTS_DIR || "test-results/account",
          "results.json",
        ),
      },
    ],
  ],
  use: {
    baseURL: localAuditOrigin(process.env.ACCOUNT_AUDIT_ORIGIN || "http://127.0.0.1:8080"),
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox"],
    },
  },
});
