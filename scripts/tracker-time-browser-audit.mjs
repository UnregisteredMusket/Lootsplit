// Encounter tracker on phones and Session Time quick chips (design plan D10 / dm #21, Q6) in a
// disposable device campaign seeded with the synthetic "Wayfarers" fixture:
// - the tracker's instructions sit behind "?" (still there, collapsed);
// - each combatant shows its side with a stripe and a glyph (◆ ally, ✕ enemy) and an accessible
//   name, so sides differ without colour;
// - a sticky bar "◀ Previous turn · Round N · Next turn ▶" stays on screen above the phone tab
//   bar and steps the turn order both ways (the same model as the map's initiative panel);
// - Session Time chips (+1 h, +4 h, Long rest 8 h, Next morning) only fill the existing form.
// Runs at 1280, 390, 320 and 844×390. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { continueIntoApp, openApplication } from "./title-screen-navigation.mjs";
import { autoAnswerThemedDialogs } from "./themed-dialogs.mjs";
import { buildWayfarers } from "./product-screenshot-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("The tracker audit changes a disposable campaign; run it only locally.");
const out = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/tracker-time`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const VIEWS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
  { width: 844, height: 390 },
];
const table = buildWayfarers();
const noOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
    `${label}: the page scrolls sideways`,
  );
const box = (locator) => locator.evaluate((el) => el.getBoundingClientRect().toJSON());

try {
  for (const view of VIEWS) {
    const label = `${view.width}x${view.height}`;
    const phone = view.width < 1000;
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      isMobile: phone,
      hasTouch: phone,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await autoAnswerThemedDialogs(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/", { waitUntil: "networkidle" });
    await page.evaluate(async (t) => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      await applyCloudTable(t);
    }, table);

    // --- Tracker.
    await page.goto(origin + "/encounters");
    await continueIntoApp(page);
    await page.getByRole("button", { name: "New encounter", exact: true }).click();
    for (const [name, side] of [
      ["Audit warden", "ally"],
      ["Audit ghoul", "enemy"],
      ["Audit wolf", "enemy"],
    ]) {
      await page.getByRole("button", { name: "Add combatant", exact: true }).click();
      const row = page.locator(".encounter-combatant").last();
      await row.getByLabel("Name", { exact: true }).fill(name);
      // The label wraps the select, so its accessible name includes the options.
      await row.locator(".encounter-vitals label", { hasText: /^Side/ }).locator("select").selectOption(side);
    }
    // Instructions are behind "?", collapsed but present.
    const help = page.locator("#encounter-tracker-help");
    await expect(help).toBeHidden();
    const toggle = page.getByRole("button", { name: "How the tracker works", exact: true });
    await toggle.click();
    await expect(help).toBeVisible();
    await expect(help).toContainText("Sort initiative");
    await toggle.click();
    await expect(help).toBeHidden();
    // Sides: a glyph with a name, and a coloured stripe.
    const side = (name) =>
      page
        .locator(".encounter-combatant")
        .filter({ has: page.locator(".combat-identity strong", { hasText: name }) })
        .locator(".combat-side");
    await expect(side("Audit warden")).toHaveAccessibleName("Ally");
    await expect(side("Audit warden")).toHaveText("◆");
    await expect(side("Audit ghoul")).toHaveAccessibleName("Enemy");
    await expect(side("Audit ghoul")).toHaveText("✕");
    const stripe = await page
      .locator(".encounter-combatant.side-ally")
      .first()
      .evaluate((el) => getComputedStyle(el).borderLeftWidth);
    assert.equal(stripe, "4px", `${label}: ally stripe`);
    // The turn bar: Previous · Round · Next, on screen above the phone tab bar.
    const bar = page.getByRole("group", { name: "Turn order", exact: true });
    const active = () => page.locator(".encounter-combatant.is-active .combat-identity strong").textContent();
    const next = bar.getByRole("button", { name: "Next turn", exact: true });
    const prev = bar.getByRole("button", { name: "Previous turn", exact: true });
    await next.click();
    await expect.poll(active).toBe("Audit warden");
    await next.click();
    await next.click();
    await expect.poll(active).toBe("Audit wolf");
    await next.click();
    await expect.poll(active).toBe("Audit warden");
    await expect(bar).toContainText("Round 2");
    await prev.click();
    await expect.poll(active).toBe("Audit wolf");
    await expect(bar).toContainText("Round 1");
    await page.evaluate(() => scrollTo(0, 0));
    await bar.scrollIntoViewIfNeeded();
    const barBox = await box(bar);
    const tabs = page.locator("nav.fixed[aria-label='Sections']");
    const tabTop =
      (await tabs.isVisible()) && (await box(tabs)).width > view.width / 2
        ? (await box(tabs)).top
        : view.height;
    assert.ok(barBox.bottom <= tabTop + 1, `${label}: the turn bar sits above the tab bar`);
    assert.ok(barBox.top >= 0, `${label}: the turn bar is on screen`);
    await noOverflow(page, `tracker ${label}`);
    await page.screenshot({ path: `${out}/tracker-${label}.png` });

    // --- Session Time chips fill the form; nothing advances until Approve.
    await page.goto(origin + "/features/time");
    await continueIntoApp(page);
    const chips = page.getByRole("group", { name: "Quick time", exact: true });
    const hours = page.getByLabel("Hours to advance", { exact: true });
    const clock = await page.evaluate(async () => {
      const { economySnapshot } = await import("/src/lib/quire/economy.ts");
      const t = await economySnapshot();
      return { day: t.journal.finance?.day, minute: t.journal.finance?.minuteOfDay ?? 0 };
    });
    await chips.getByRole("button", { name: "+4 h", exact: true }).click();
    await expect(hours).toHaveValue("4");
    await expect(chips.getByRole("button", { name: "+4 h", exact: true })).toHaveAttribute("aria-pressed", "true");
    await chips.getByRole("button", { name: "Long rest · 8 h", exact: true }).click();
    await expect(hours).toHaveValue("8");
    await expect(page.getByLabel("Award rest", { exact: true })).toHaveValue("long");
    await chips.getByRole("button", { name: "Next morning", exact: true }).click();
    const minute = clock.minute;
    const target = minute < 360 ? 360 : 1440 + 360;
    await expect(hours).toHaveValue(String(Math.min(24, Math.max(1, Math.ceil((target - minute) / 60)))));
    await chips.getByRole("button", { name: "+1 h", exact: true }).click();
    await expect(hours).toHaveValue("1");
    const after = await page.evaluate(async () => {
      const { economySnapshot } = await import("/src/lib/quire/economy.ts");
      const t = await economySnapshot();
      return { day: t.journal.finance?.day, minute: t.journal.finance?.minuteOfDay ?? 0 };
    });
    assert.deepEqual(after, clock, `${label}: chips alone never advance the clock`);
    await noOverflow(page, `session time ${label}`);
    await page.screenshot({ path: `${out}/session-time-${label}.png` });

    assert.deepEqual(errors, [], `${label}: no page errors`);
    await context.close();
    console.log(`tracker-time ${label}: ok`);
  }
} finally {
  await browser.close();
}
