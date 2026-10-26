// Map controls (docs/MAP-TILES.md, "Map controls"): ← Back to the parent map, X Close map to the
// previous in-app screen, Backspace / Alt+↑, the Android Back order, the opening fit, and map
// chrome on app tokens. DM and player, both looks, at 1280×800, 1440×900, 390×844, 320×640 and
// 844×390. Panels and map changes never navigate away from the document or reload it.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import {
  openApplication,
  reloadApplication,
  navigateApplication,
} from "./title-screen-navigation.mjs";
import { checkMobileMapControls } from "./fullscreen-map-browser-check.mjs";
import { FANTASY_LOOKS, themeVars } from "../src/lib/quire/theme.ts";
import { buildWayfarers } from "./product-screenshot-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080",
  output = "test-results/map-controls",
  errors = [],
  checks = [];
assert.match(
  origin,
  /^http:\/\/(127\.0\.0\.1|localhost):/,
  "Map fixtures require a disposable server",
);
await mkdir(output, { recursive: true });
const SIZES = [
  [1280, 800],
  [1440, 900],
  [390, 844],
  [320, 640],
  [844, 390],
];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});

const fixture = buildWayfarers();
async function seedMaps(page) {
  await page.evaluate(async (table) => {
    const art = (fill, label) => {
      const canvas = Object.assign(document.createElement("canvas"), { width: 800, height: 600 });
      const c = canvas.getContext("2d");
      c.fillStyle = fill;
      c.fillRect(0, 0, 800, 600);
      c.fillStyle = "#f3e7c9";
      c.font = "italic 40px serif";
      c.fillText(label, 220, 300);
      return canvas.toDataURL("image/jpeg", 0.7);
    };
    const economy = await import("/src/lib/quire/economy.ts");
    const next = {
      ...table,
      journal: {
        ...table.journal,
        world: {
          ...(table.journal.world ?? {}),
          maps: [
            {
              id: "tide-cove",
              name: "Smugglers' cove",
              type: "dungeon",
              locationId: null,
              image: art("#3b3025", "Smugglers' cove"),
              visible: true,
              anchors: [],
              markers: [],
              connected: { parentMapId: "harbour", links: [], placements: [] },
            },
            {
              id: "harbour",
              name: "Brackenport harbour",
              type: "city",
              locationId: null,
              image: art("#24505f", "Brackenport harbour"),
              visible: true,
              anchors: [],
              markers: [],
              connected: {
                links: [
                  {
                    id: "l-cove",
                    x: 0.7,
                    y: 0.3,
                    targetMapId: "tide-cove",
                    label: "Cellar stairs",
                    visibility: "party",
                  },
                ],
                placements: [],
              },
            },
          ],
        },
      },
    };
    await economy.applyCloudTable(next);
  }, fixture);
}
async function look(page, appearance) {
  const theme = FANTASY_LOOKS[appearance];
  await page.evaluate(
    ({ theme, vars }) => {
      const root = document.documentElement;
      for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
      root.dataset.appearance = theme.appearance;
      root.dataset.fantasyTheme = theme.id;
      root.style.colorScheme = theme.appearance;
    },
    { theme, vars: themeVars(appearance, theme.accent, theme.ground) },
  );
}
const zoom = (page) => page.locator('[aria-label="Map zoom"]').textContent();
const percent = async (page) => Number.parseInt(await zoom(page), 10);
/** The current map's own name (the title also shows the parent in front of it). */
const mapName = (page) =>
  page.locator(".map-title-button > span").evaluate((el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(""),
  );
async function sameDocument(page, label) {
  assert.equal(
    await page.evaluate(() => window.mapControlsAudit),
    "same-document",
    `${label}: no reload`,
  );
  assert.equal(await page.locator(".loot-opening").count(), 0, `${label}: no title screen`);
}
async function expectMap(page, name) {
  await expect.poll(() => mapName(page)).toBe(name);
}

/** Layout, theme and naming checks for one role, look and size. */
async function checkChrome(page, { role, appearance, width, height }) {
  const tag = `${role}-${width}x${height}-${appearance}`;
  await page.setViewportSize({ width, height });
  await expect(page.locator(".map-title-capsule")).toBeVisible();
  await page.waitForTimeout(150);
  const facts = await page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el || !el.getClientRects().length) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    const capsule = document.querySelector(".map-title-capsule");
    return {
      scrollWidth: document.documentElement.scrollWidth,
      frameScroll: document.querySelector(".map-workspace").scrollWidth,
      title: box(".map-title-capsule"),
      search: box(".map-search"),
      actions: box(".map-top-actions"),
      close: box(".map-close-button"),
      hotbar: box(".map-hotbar-anchor"),
      stepper: document.querySelectorAll(".map-scene-stepper").length,
      capsuleBg: getComputedStyle(capsule).backgroundColor,
      font: getComputedStyle(document.querySelector(".map-workspace")).fontFamily,
      titleFont: getComputedStyle(document.querySelector(".map-title-button")).fontFamily,
      fg: getComputedStyle(capsule).color,
      appFg: getComputedStyle(document.body).color,
      zoomButtons: [...document.querySelectorAll(".map-navigation button")].map((b) => {
        const style = getComputedStyle(b);
        return `${style.backgroundImage}|${style.backgroundColor}`;
      }),
    };
  });
  const within = (b, what) =>
    assert.ok(
      b && b.left >= -1 && b.right <= width + 1 && b.top >= -1 && b.bottom <= height + 1,
      `${tag}: ${what} stays on screen`,
    );
  assert.ok(facts.scrollWidth <= width + 1, `${tag}: no horizontal page scroll`);
  assert.ok(facts.frameScroll <= width + 1, `${tag}: map workspace does not scroll sideways`);
  within(facts.title, "title");
  within(facts.actions, "top-right actions");
  within(facts.close, "X Close map");
  within(facts.hotbar, "tools hotbar");
  assert.ok(
    facts.title.right <= facts.actions.left - 4,
    `${tag}: title clears the top-right actions`,
  );
  if (width > 650 && facts.search) {
    assert.ok(facts.search.left >= facts.title.right + 4, `${tag}: search clears the title`);
    assert.ok(facts.search.right <= facts.actions.left - 4, `${tag}: search clears Settings/X`);
  }
  if (width <= 650 && height > 550)
    assert.ok(facts.hotbar.bottom >= height - 20, `${tag}: phone tools bar stays along the bottom`);
  assert.equal(facts.stepper, 0, `${tag}: the scene stepper is gone (Back and the title menu)`);
  assert.notEqual(facts.capsuleBg, "rgba(22, 26, 31, 0.82)", `${tag}: title uses theme tokens`);
  assert.equal(facts.fg, facts.appFg, `${tag}: title text uses the app foreground`);
  for (const zoomStyle of facts.zoomButtons)
    assert.equal(
      zoomStyle,
      "none|rgba(0, 0, 0, 0)",
      `${tag}: zoom controls are plain icon buttons`,
    );
  assert.match(facts.font, /Source Sans 3/, `${tag}: chrome uses Source Sans 3`);
  assert.match(facts.titleFont, /Cormorant Garamond/, `${tag}: map title uses Cormorant Garamond`);
  // Settings: the top-right toggle, or the first title-menu item at 340 px or less.
  const url = page.url();
  if (width <= 340) {
    await expect(page.locator(".map-top-actions .map-settings-toggle")).toBeHidden();
    await page.getByRole("button", { name: "Map navigation menu", exact: true }).click();
    await page.locator(".map-app-menu .map-menu-settings").click();
  } else await page.locator(".map-top-actions .map-settings-toggle").click();
  await expect(page.locator("#map-settings")).toBeVisible();
  assert.equal(page.url(), url, `${tag}: opening settings changes no route`);
  await sameDocument(page, `${tag} settings`);
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  if (width <= 650 && height > 550) await checkMobileMapControls(page);
  await page.screenshot({ path: `${output}/map-${tag}.png` });
  checks.push(`${tag}: layout, tokens, fonts, settings without navigation`);
}

try {
  for (const role of ["dm", "player"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      serviceWorkers: "block",
      extraHTTPHeaders: {
        "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`,
      },
    });
    await context.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (route) => route.abort(),
    );
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(process.env.CI ? 20000 : 60000);
    page.on("pageerror", (e) => errors.push(`${role}: ${e.message}`));
    await openApplication(page, origin + "/party");
    await seedMaps(page);
    if (role === "player")
      await page.evaluate(async () => {
        const { setSeat, getSeat } = await import("/src/lib/quire/table.ts");
        setSeat({ ...getSeat(), role: "player", purseIds: ["mira"], openedAt: Date.now() });
      });
    await reloadApplication(page);
    await page.evaluate(() => (window.mapControlsAudit = "same-document"));
    // In-app entry from Party: the first map opens with the opening fit (phone: at most 200 %).
    await page.locator('a[href="/maps"]:visible').first().waitFor();
    await navigateApplication(page, origin + "/maps");
    await expect(page.getByRole("region", { name: "Interactive campaign map" })).toBeVisible();
    await expectMap(page, "Smugglers' cove");
    await sameDocument(page, `${role} entry from Party`);
    await expect.poll(() => percent(page)).toBeGreaterThan(0);
    const phoneZoom = await percent(page);
    assert.ok(phoneZoom >= 100 && phoneZoom <= 200, `${role}: phone opening zoom ${phoneZoom}%`);
    checks.push(`${role}: phone opening view ${phoneZoom}% (fit, at most 200%)`);

    // ← Back: names the parent, opens it in the same document, then disappears (no parent).
    await page.setViewportSize({ width: 1280, height: 800 });
    const back = page.getByRole("button", { name: "Back to Brackenport harbour", exact: true });
    await expect(back).toBeVisible();
    await expect(page.locator(".map-title-parent")).toHaveText(/Brackenport harbour/);
    await back.click();
    await expectMap(page, "Brackenport harbour");
    await expect.poll(() => new URL(page.url()).searchParams.get("map")).toBe("harbour");
    await sameDocument(page, `${role} Back`);
    await expect(page.locator(".map-back-button")).toHaveCount(0);
    await expect.poll(() => zoom(page)).toBe("100%");
    checks.push(
      `${role}: Back opens the parent; desktop opening view fits at 100%; no Back without a parent`,
    );

    // Backspace and Alt+↑ go back up; never from a text field.
    const enterCove = async () => {
      const menu = page.getByRole("button", { name: "Map navigation menu", exact: true });
      if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
      await page
        .locator(".map-connected-scene-list")
        .getByRole("button", { name: "Smugglers' cove", exact: true })
        .click();
      await expectMap(page, "Smugglers' cove");
    };
    await enterCove();
    await page.getByRole("combobox", { name: "Search maps and places", exact: true }).focus();
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(200);
    await expectMap(page, "Smugglers' cove");
    await page.getByRole("region", { name: "Interactive campaign map" }).focus();
    await page.keyboard.press("Backspace");
    await expectMap(page, "Brackenport harbour");
    await enterCove();
    // On the map canvas Alt+arrows keep panning (existing); from the controls Alt+↑ is Back.
    await page.getByRole("region", { name: "Interactive campaign map" }).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await page.waitForTimeout(200);
    await expectMap(page, "Smugglers' cove");
    await page.locator(".map-title-button").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expectMap(page, "Brackenport harbour");
    await sameDocument(page, `${role} keyboard Back`);
    checks.push(
      `${role}: Backspace and Alt+ArrowUp open the parent; ignored in text fields; Alt+arrows still pan the canvas`,
    );

    // Every role, look and size.
    await enterCove();
    for (const appearance of ["dark", "light"]) {
      await look(page, appearance);
      for (const [width, height] of SIZES)
        await checkChrome(page, { role, appearance, width, height });
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Android Back (the shell's interceptor chain): panel → parent map → close to Party.
    const androidBack = () =>
      page.evaluate(async () =>
        (await import("/src/lib/mobile/back-handlers.ts")).runBackHandlers(),
      );
    await page.locator(".map-top-actions .map-settings-toggle").click();
    await expect(page.locator("#map-settings")).toBeVisible();
    assert.equal(await androidBack(), true);
    await expect(page.locator("#map-settings")).toBeHidden();
    await expectMap(page, "Smugglers' cove");
    assert.equal(await androidBack(), true);
    await expectMap(page, "Brackenport harbour");
    await sameDocument(page, `${role} Android Back`);
    assert.equal(await androidBack(), true);
    await page.waitForURL((u) => u.pathname === "/party");
    await sameDocument(page, `${role} Android Back close`);
    checks.push(
      `${role}: Android Back closes the panel, then opens the parent, then leaves to Party`,
    );

    // X Close map returns to the screen Maps was opened from, without a reload.
    await navigateApplication(page, origin + "/maps");
    await expect(page.getByRole("link", { name: "Close map", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Close map", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/party");
    await sameDocument(page, `${role} Close map`);
    checks.push(`${role}: X Close map returns to Party in the same document`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/checks.json`, JSON.stringify({ checks }, null, 2));
  console.log(`Map controls audit passed (${checks.length} checks).`);
} catch (error) {
  for (const context of browser.contexts())
    for (const open of context.pages())
      await open.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
