// Read-only in production: no accounts, campaigns, room fixtures or database writes.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8082";
const expected = process.env.EXPECTED_RELEASE_SHA;
assert.match(expected || "", /^[a-f0-9]{40}$/);
let identity;
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await fetch(`${origin}/assets/release-identity.json?verify=${expected}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (response.ok && response.headers.get("content-type")?.includes("json")) {
    identity = await response.json();
    if (identity.commit === expected) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
assert.equal(identity?.commit, expected, "Live release does not match the verified artifact");
// Confirm the account service is configured and private data remains protected.
const session = await fetch(`${origin}/api/account/auth/get-session`, {
  signal: AbortSignal.timeout(15000),
});
assert.equal(session.status, 200);
assert.equal(await session.json(), null);
const privateLibrary = await fetch(`${origin}/api/account/library`, {
  signal: AbortSignal.timeout(15000),
});
assert.equal(privateLibrary.status, 401);
const privateSheets = await fetch(`${origin}/api/account/sheets`, {
  signal: AbortSignal.timeout(15000),
});
assert.equal(privateSheets.status, 401);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const errors = [];
await mkdir("test-results/live-release", { recursive: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      // Anonymous app startup probes account sheets; denial is the required policy.
      if (response.status() === 401 && path === "/api/account/sheets") return;
      if (response.url().startsWith(origin) && response.status() >= 400)
        errors.push(`${response.status()} ${path}`);
    });
    await page.goto(origin, { waitUntil: "networkidle" });
    const title = page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true });
    await title.waitFor();
    await page.waitForFunction(() => {
      const button = document.querySelector(".loot-opening");
      const traveler = document.querySelector(".loot-loader-traveler");
      return button && !button.disabled && traveler?.style.transform;
    });
    const sceneBox = await page.locator(".loot-opening-scene").boundingBox();
    const nameBox = await page.locator(".quire-dawn-name").boundingBox();
    assert.ok(sceneBox && nameBox);
    assert.ok(Math.abs(sceneBox.width - sceneBox.height) < 1, "Landscape stays square");
    assert.ok(nameBox.y + nameBox.height < sceneBox.y, "Title sits above landscape");
    if (width === 390)
      assert.ok(
        Math.abs(sceneBox.width - width) < 1,
        "Mobile landscape is flush with viewport edges",
      );

    assert.equal(
      await title.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(232, 212, 165)",
    );
    assert.equal(
      await page
        .locator(".quire-dawn-name")
        .evaluate((el) => getComputedStyle(el).animationIterationCount),
      "1",
    );
    await page.locator(".loot-loader-traveler").waitFor();
    await page.locator(".loot-loader-rogue").waitFor();
    const start = await page.locator(".loot-loader-traveler").evaluate((el) => el.style.transform);
    await page.waitForTimeout(3000);
    assert.notEqual(
      await page.locator(".loot-loader-traveler").evaluate((el) => el.style.transform),
      start,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `test-results/live-release/title-${width}.png` });
    await page.waitForFunction(() => {
      const time = Number(
        document.querySelector(".loot-loader-track")?.getAttribute("data-loop-time"),
      );
      return time >= 10.4 && time <= 11.2;
    });
    const rider = page.locator(".loot-mounted-hunter");
    assert.equal(await rider.evaluate((el) => getComputedStyle(el).visibility), "visible");
    const riderBox = await rider.boundingBox();
    const rogueBox = await page.locator(".loot-loader-rogue").boundingBox();
    assert.ok(
      riderBox && rogueBox && riderBox.x + riderBox.width < rogueBox.x,
      "Mounted hunter follows at a distance behind the rogue",
    );
    await page.locator(".hunter-map").waitFor();
    await page.screenshot({ path: `test-results/live-release/mounted-hunter-${width}.png` });
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
  assert.equal(
    await page.locator(".quire-dawn-name").evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await title.focus();
  await page.keyboard.press("Enter");
  await title.waitFor({ state: "detached" });
  await page.getByRole("link", { name: "Party", exact: true }).first().waitFor();
  await reduced.close();
  assert.deepEqual(errors, []);
  console.log(
    `PASS live commit ${expected}: parchment, single title fade, moving carrier/rogue, click and keyboard entry, reduced motion, desktop/mobile, no app errors.`,
  );
} catch (error) {
  await writeFile(
    "test-results/live-release/failure.json",
    JSON.stringify(
      {
        message: error instanceof Error ? error.message : "Live release check failed",
        errors,
      },
      null,
      2,
    ),
  );
  for (const [index, context] of browser.contexts().entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      await page
        .screenshot({ path: `test-results/live-release/failure-${index}-${pageIndex}.png` })
        .catch(() => undefined);
    }
  }
  throw error;
} finally {
  await browser.close();
}
