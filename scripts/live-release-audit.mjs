// Read-only in production: no accounts, campaigns, room fixtures or database writes.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8082";
const expected = process.env.EXPECTED_RELEASE_SHA;
assert.match(expected || "", /^[a-f0-9]{40}$/);
let identity;
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await fetch(`${origin}/assets/release-identity.json?verify=${expected}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (response.ok && response.headers.get("content-type")?.includes("json")) {
    identity = await response.json();
    if (identity.commit === expected) break;
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
assert.equal(identity?.commit, expected, "Live release does not match the verified artifact");
// Confirm the account service is configured and private data remains protected.
const session = await fetch(`${origin}/api/account/auth/get-session`, { signal: AbortSignal.timeout(15000) });
assert.equal(session.status, 200);
assert.equal(await session.json(), null);
const privateLibrary = await fetch(`${origin}/api/account/library`, { signal: AbortSignal.timeout(15000) });
assert.equal(privateLibrary.status, 401);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ["--no-sandbox"] });
const errors = [];
await mkdir("test-results/live-release", { recursive: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => {
      if (response.url().startsWith(origin) && response.status() >= 400)
        errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    await page.goto(origin, { waitUntil: "networkidle" });
    const title = page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true });
    await title.waitFor();
    assert.equal(await title.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(232, 212, 165)");
    assert.equal(await page.locator(".quire-dawn-name").evaluate(el => getComputedStyle(el).animationIterationCount), "1");
    await page.locator(".loot-loader-traveler").waitFor();
    await page.locator(".loot-loader-rogue").waitFor();
    const start = await page.locator(".loot-loader-traveler").evaluate(el => el.style.transform);
    await page.waitForTimeout(3000);
    assert.notEqual(await page.locator(".loot-loader-traveler").evaluate(el => el.style.transform), start);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/live-release/title-${width}.png` });
    await title.click();
    await title.waitFor({ state: "detached" });
    await page.getByRole("link", { name: "Party", exact: true }).first().waitFor();
    await page.screenshot({ path: `test-results/live-release/app-${width}.png` });
    await context.close();
  }
  const reduced = await browser.newContext({ reducedMotion: "reduce" });
  const page = await reduced.newPage();
  await page.goto(origin, { waitUntil: "networkidle" });
  const title = page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true });
  await title.waitFor();
  assert.equal(await page.locator(".quire-dawn-name").evaluate(el => getComputedStyle(el).animationName), "none");
  await title.focus();
  await page.keyboard.press("Enter");
  await title.waitFor({ state: "detached" });
  await page.getByRole("link", { name: "Party", exact: true }).first().waitFor();
  await reduced.close();
  assert.deepEqual(errors, []);
  console.log(`PASS live commit ${expected}: parchment, single title fade, moving carrier/rogue, click and keyboard entry, reduced motion, desktop/mobile, no app errors.`);
} finally { await browser.close(); }
