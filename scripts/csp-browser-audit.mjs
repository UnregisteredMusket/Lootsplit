// Packaged-Worker check that the script Content-Security-Policy (audit S04) blocks nothing the
// app needs: the title screen and app hydrate, the account page renders, and OCR (blob: worker,
// same-origin importScripts, WebAssembly) reads a synthetic statblock. The room image GET keeps the
// headers and answers the Android app's preflight. Disposable servers only.
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

// robots.txt and sitemap.xml come from the built Worker, name the configured website (never the
// request host) and keep the security headers (audit P2-9).
{
  const { deploymentOrigins } = await import("../src/lib/deployment/origins.mjs");
  const robots = await fetch(origin + "/robots.txt", { headers: { "cf-connecting-ip": ip() } });
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type") ?? "", /^text\/plain/);
  assert.ok(robots.headers.get("content-security-policy")?.includes(SCRIPT_POLICY));
  const robotsText = await robots.text();
  assert.match(robotsText, /^User-agent: \*$/m);
  assert.match(robotsText, /^Disallow: \/api\/$/m);
  assert.ok(robotsText.includes(`Sitemap: ${deploymentOrigins.website}/sitemap.xml`), robotsText);
  const sitemap = await fetch(origin + "/sitemap.xml", { headers: { "cf-connecting-ip": ip() } });
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("content-type") ?? "", /^application\/xml/);
  const sitemapText = await sitemap.text();
  assert.ok(sitemapText.includes(`<loc>${deploymentOrigins.website}/welcome</loc>`), sitemapText);
  assert.doesNotMatch(sitemapText, /127\.0\.0\.1|\/account/);
}

// Seat-authorized room image GET (tabletop protocol 4): refusals carry the security headers and
// are never cached, and the Android app's WebView origin may call it (CORS preflight).
{
  const imagePath = `/api/room-image/AAAAAAAA/${"0".repeat(64)}`;
  const refused = await fetch(origin + imagePath, { headers: { "cf-connecting-ip": ip() } });
  assert.equal(refused.status, 403, `${imagePath} without a seat`);
  assert.equal(refused.headers.get("cache-control"), "no-store");
  assert.ok(refused.headers.get("content-security-policy")?.includes(SCRIPT_POLICY));
  const unknown = await fetch(origin + imagePath, {
    headers: { "cf-connecting-ip": ip(), "x-lootsplit-seat": "not-a-seat" },
  });
  assert.equal(unknown.status, 404, `${imagePath} for an unknown room`);
  const preflight = await fetch(origin + imagePath, {
    method: "OPTIONS",
    headers: {
      "cf-connecting-ip": ip(),
      origin: "https://localhost",
      "access-control-request-method": "GET",
      "access-control-request-headers": "x-lootsplit-seat, authorization",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://localhost");
  assert.match(preflight.headers.get("access-control-allow-headers") || "", /x-lootsplit-seat/);
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

  // /account is not a public page: a cold document load shows the title screen first, and the
  // account heading renders only after it is dismissed (as every other account audit does).
  await openApplication(page, origin + "/account");
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
