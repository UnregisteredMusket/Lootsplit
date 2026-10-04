import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const required = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim();
if (process.versions.node.split(".")[0] !== required) {
  throw new Error(`Use Node ${required} (nvm use or the repository dev container) before setup.`);
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npm, ["ci"], { stdio: "inherit", timeout: 300000 });
execFileSync(
  process.execPath,
  ["node_modules/playwright/cli.js", "install", "--with-deps", "chromium"],
  { stdio: "inherit", timeout: 300000 },
);
const { chromium } = await import("playwright");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
await browser.close();
console.log(`Node ${process.versions.node}, locked dependencies and Chromium are ready.`);
