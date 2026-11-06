// 3D dice (owner request 2026-11-06) in a disposable device campaign: a guest opens the first
// party character's sheet and rolls from the dice tray and a quick roll. For d20, d100, 2d6, d4,
// d8, d10, d12 and a d20 with advantage, the dice appear, settle, and the caption shows exactly
// the recorded total (the same as the written result), with no "[dice]" mismatch warning from the
// library's own reading of the faces. The page stays clickable while dice roll, Close dice and
// Escape clear them, "Show 3D dice" off and reduced motion show none, and a 390 px phone never
// scrolls sideways. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, continueIntoApp } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const out = "test-results/dice-3d";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  // Software WebGL so the dice render on CI runners without a GPU.
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const errors = [];
const warnings = [];
const overlay = (page, state) => page.locator(`.dice-roll-overlay[data-${state}="true"]`);
const total = (text) => Number(/: (-?\d+)/.exec(text ?? "")?.[1]);

async function sheet(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.text().startsWith("[dice]") && warnings.push(m.text()));
  await openApplication(page, origin + "/party");
  await page.locator(".role-chip:enabled").waitFor();
  await page.locator(".quire-dawn").waitFor({ state: "hidden" });
  await page.locator(".party-profile").first().getByRole("link", { name: "Open sheet", exact: true }).click();
  await continueIntoApp(page);
  await page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  return page;
}

async function trayRoll(page, formula) {
  await page.getByLabel("Dice formula", { exact: true }).fill(formula);
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  await overlay(page, "settled").waitFor();
  const caption = await page.locator(".dice-roll-caption span").textContent();
  const written = await page.locator("form p[role=status]").textContent();
  assert.equal(total(caption), total(written), `${formula}: caption "${caption}" vs "${written}"`);
  return caption;
}

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width < 400 ? 844 : 860 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await sheet(context);
    for (const formula of ["1d20+3", "1d100", "2d6+1", "1d4", "1d8", "1d10", "1d12"]) {
      const caption = await trayRoll(page, formula);
      if (formula === "1d100") assert.match(caption, /\(\d+\)$/);
      await page.screenshot({ path: `${out}/${width}-${formula.replace(/\W/g, "_")}.png` });
      await page.getByRole("button", { name: "Close dice", exact: true }).click();
      await overlay(page, "open").waitFor({ state: "detached" }).catch(() => {});
      assert.equal(await overlay(page, "open").count(), 0, "Close dice clears the dice");
    }
    // The page stays usable while dice are in the air: a second roll replaces the first.
    await page.getByLabel("Dice formula", { exact: true }).fill("3d6");
    await page.getByRole("button", { name: "Roll dice", exact: true }).click();
    await overlay(page, "open").waitFor();
    await page.getByLabel("Dice formula", { exact: true }).fill("1d20");
    await page.getByRole("button", { name: "Roll dice", exact: true }).click();
    await overlay(page, "settled").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await overlay(page, "open").count(), 0, "Escape clears the dice");
    // Advantage from a quick roll: two d20s, the caption brackets the one discarded.
    await page.locator(".quick-roll select").first().selectOption("advantage");
    await page.locator(".quick-roll button").first().click();
    await overlay(page, "settled").waitFor();
    const adv = await page.locator(".dice-roll-caption span").textContent();
    assert.match(adv ?? "", /\(\d+\) \+ \d+|\d+ \+ \(\d+\)/, adv);
    assert.match(adv ?? "", /advantage\)$/);
    assert.equal(total(adv), Number((await page.locator(".quick-roll output").first().textContent())?.split(" ")[0]));
    assert.ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${width}: no sideways scroll`);
    await page.screenshot({ path: `${out}/${width}-advantage.png` });
    await page.keyboard.press("Escape");
    await context.close();
  }
  // Show 3D dice off: the roll is recorded as before, with no dice.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await context.addInitScript(() => {
      localStorage.setItem("quire.guide.offer.v3", "seen");
      const prefs = JSON.parse(localStorage.getItem("quire.prefs.v1") || "{}");
      localStorage.setItem("quire.prefs.v1", JSON.stringify({ ...prefs, diceAnimation: false }));
    });
    const page = await sheet(context);
    await page.getByLabel("Dice formula", { exact: true }).fill("1d20");
    await page.getByRole("button", { name: "Roll dice", exact: true }).click();
    await page.locator("form p[role=status]").waitFor();
    await page.waitForTimeout(1500);
    assert.equal(await overlay(page, "open").count(), 0, "setting off: no dice");
    await context.close();
  }
  // Reduced motion: no dice.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await sheet(context);
    await page.getByLabel("Dice formula", { exact: true }).fill("1d20");
    await page.getByRole("button", { name: "Roll dice", exact: true }).click();
    await page.locator("form p[role=status]").waitFor();
    await page.waitForTimeout(1500);
    assert.equal(await overlay(page, "open").count(), 0, "reduced motion: no dice");
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [], "the 3D dice landed on every recorded value");
  console.log("PASS: 3D dice for d4, d6, d8, d10, d12, d20, d100 and advantage match the recorded rolls; Close dice, Escape, setting off and reduced motion; no sideways scroll at 390 px.");
} finally {
  await browser.close();
}
