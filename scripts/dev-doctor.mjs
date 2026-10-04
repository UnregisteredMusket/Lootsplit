import { readFileSync } from "node:fs";
const required = readFileSync(".nvmrc", "utf8").trim();
const results = [
  {
    check: "Node",
    ok: process.versions.node.split(".")[0] === required,
    detail: `${process.version}; required major ${required}`,
  },
];
try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox"],
    timeout: 15000,
  });
  await browser.close();
  results.push({ check: "Dependencies and Chromium", ok: true });
} catch (error) {
  results.push({ check: "Dependencies and Chromium", ok: false, detail: error.message });
}
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => !r.ok)) {
  console.error(
    `Select Node ${required}, then npm run dev:setup. CHROMIUM_EXECUTABLE_PATH may point to an already installed compatible browser.`,
  );
  process.exitCode = 1;
}
