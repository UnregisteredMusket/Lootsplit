import { defineConfig } from "playwright/test";
import base from "./playwright.config.mjs";
import { resolve } from "node:path";
const output = process.env.AUDIT_RESULTS_DIR || "test-results/room-viewing";
export default defineConfig({
  ...base,
  testMatch: "room-viewing.spec.mjs",
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  globalTimeout: 150000,
  outputDir: resolve(output, "artifacts"),
  reporter: [
    ["line"],
    ["html", { outputFolder: resolve(output, "html"), open: "never" }],
    ["json", { outputFile: resolve(output, "results.json") }],
  ],
});
