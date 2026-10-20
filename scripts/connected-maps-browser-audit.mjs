import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { checkConnectedMaps } from "./connected-maps-browser-check.mjs";
const output = "test-results/connected-maps",
  started = Date.now();
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
try {
  const results = await checkConnectedMaps({
    browser,
    origin: process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080",
    output,
  });
  await writeFile(
    `${output}/result.json`,
    JSON.stringify({ durationMs: Date.now() - started, results }, null, 2),
  );
  console.log(JSON.stringify({ durationMs: Date.now() - started, results }));
} finally {
  await browser.close();
}
