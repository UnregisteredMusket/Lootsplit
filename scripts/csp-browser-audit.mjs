// Packaged-Worker check that the script Content-Security-Policy (audit S04) blocks nothing the
// app needs: the title screen and app hydrate, the account page renders, and OCR (blob: worker,
// same-origin importScripts, WebAssembly) reads a synthetic statblock. Disposable servers only.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { SCRIPT_POLICY } from "../cloudflare/release-assets.mjs";
import { scanFixture } from "./ocr-browser-fixtures.mjs";
import { openApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8082";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("The CSP audit creates a disposable DM and runs only against a local server.");
const output = "test-results/csp";
await mkdir(output, { recursive: true });
const ip = () =>
  `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;

for (const path of ["/", "/welcome", "/account", "/encounters", "/ocr/v7/worker.min.js"]) {
  const response = await fetch(origin + path, { headers: { "cf-connecting-ip": ip() } });
  assert.ok(
    response.headers.get("content-security-policy")?.includes(SCRIPT_POLICY),
    `${path} lacks the script policy: ${response.headers.get("content-security-policy")}`,
  );
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [];
const evalProbes = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "cf-connecting-ip": ip() },
  });
  await context.addInitScript(() => {
    localStorage.setItem("quire.guide.offer.v3", "seen");
    window.__lootsplitCsp = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.__lootsplitCsp.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        source: event.sourceFile,
        line: event.lineNumber,
      }),
    );
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text()))
      (/eval/i.test(message.text()) ? evalProbes : errors).push(message.text().slice(0, 300));
  });
  const violations = async (label) => {
    for (const v of await page.evaluate(() => window.__lootsplitCsp || [])) {
      if (v.blocked === "eval") evalProbes.push({ label, ...v });
      else errors.push(`${label}: ${JSON.stringify(v)}`);
    }
  };

  // Title screen, hydration and the signed-in app (openApplication provisions a disposable DM).
  await openApplication(page, origin + "/");
  await page.getByText("Campaign control", { exact: true }).waitFor();
  await violations("app");

  await page.goto(origin + "/account");
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.screenshot({ path: `${output}/account.png` });
  await violations("account");

  // OCR: Tesseract's blob: worker, same-origin worker/core scripts and WebAssembly.
  await openApplication(page, origin + "/encounters");
  await page.getByRole("button", { name: "New encounter", exact: true }).click();
  await page.getByRole("button", { name: "Add combatant", exact: true }).waitFor();
  const skip = page.getByRole("button", { name: /skip for now/i });
  if (await skip.isVisible()) await skip.click();
  await page.getByRole("button", { name: "Builder & generator", exact: true }).click();
  const scan = await scanFixture(page, [
    "Goblin",
    "Small humanoid, neutral evil",
    "Armor Class 15 (leather armor)",
    "Hit Points 7 (2d6)",
    "Speed 30 ft.",
    "Challenge 1/4 (50 XP)",
  ]);
  await page
    .getByLabel("Import statblock picture", { exact: true })
    .setInputFiles({ name: "goblin.png", mimeType: "image/png", buffer: scan });
  const review = page.getByRole("dialog", { name: "Review statblock" });
  await expect(review).toBeVisible({ timeout: 90000 });
  await expect(review).toContainText("Goblin · AC 15 · HP 7");
  await page.screenshot({ path: `${output}/ocr.png` });
  await violations("ocr");
  await context.close();

  if (evalProbes.length)
    console.log(`Refused string-eval probes (expected fallback): ${JSON.stringify(evalProbes)}`);
  assert.deepEqual(errors, []);
  console.log(
    "PASS script policy: served on pages and OCR assets; app, account page and OCR run with no blocked scripts.",
  );
} finally {
  await browser.close();
}
