import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const required = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim();
if (process.versions.node.split(".")[0] !== required) {
  throw new Error(`Use Node ${required} (nvm use or the repository dev container) before setup.`);
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const fingerprint = createHash("sha256")
  .update(readFileSync("package-lock.json"))
  .update(readFileSync("package.json"))
  .update(`${process.versions.node}-${process.platform}-${process.arch}`)
  .digest("hex");
const marker = "node_modules/.lootsplit-setup";
if (
  !existsSync(marker) ||
  readFileSync(marker, "utf8") !== fingerprint ||
  !existsSync("node_modules/playwright/cli.js")
) {
  execFileSync(npm, ["ci"], { stdio: "inherit", timeout: 300000 });
  writeFileSync(marker, fingerprint);
} else console.log("Locked dependency setup is unchanged; reusing installed packages.");
const { chromium } = await import("playwright");
async function launch() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox"],
    timeout: 15000,
  });
  await browser.close();
}
try {
  await launch();
} catch (error) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) throw error;
  execFileSync(
    process.execPath,
    ["node_modules/playwright/cli.js", "install", "--with-deps", "chromium"],
    { stdio: "inherit", timeout: 300000 },
  );
  await launch();
}
console.log(`Node ${process.versions.node}, locked dependencies and Chromium are ready.`);
