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
import { chooseOption } from "./search-select-browser.mjs";

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
  [1280, 680],
  [568, 320],
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
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
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
      toolbar: box('[role="toolbar"][aria-label="Map tools"]'),
      orientation: document
        .querySelector('[role="toolbar"][aria-label="Map tools"]')
        ?.getAttribute("aria-orientation"),
      tabStops: [
        ...document.querySelectorAll('[role="toolbar"][aria-label="Map tools"] [data-map-tool]'),
      ].filter((b) => b.tabIndex === 0).length,
      zoom: box(".map-navigation"),
      setup: box('[role="toolbar"][aria-label="Map setup"]'),
      setupOrientation: document
        .querySelector('[role="toolbar"][aria-label="Map setup"]')
        ?.getAttribute("aria-orientation"),
      pills: document.querySelectorAll(".map-here-button,.map-plan-journey-button").length,
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
  within(facts.toolbar, "Map tools toolbar");
  within(facts.zoom, "zoom pill");
  // Quests (quest log map stage): the DM always has the tool (in the rail or its More menu, to add
  // pins and areas); a player only when a quest they know has something on this map (none here).
  if (role === "player")
    assert.equal(
      await page.locator('[aria-controls="map-quests"]').count(),
      0,
      `${tag}: no Quests tool for a player with no quests on this map`,
    );
  assert.equal(facts.tabStops, 1, `${tag}: the tools toolbar is one Tab stop (roving tabindex)`);
  assert.equal(facts.pills, 0, `${tag}: Here and Plan journey live in the tools bar, not floating`);
  assert.ok(facts.zoom.width > facts.zoom.height, `${tag}: zoom is a horizontal pill`);
  if (width <= 650 && height > 550) {
    assert.ok(facts.hotbar.bottom >= height - 20, `${tag}: phone tools bar stays along the bottom`);
    assert.equal(facts.orientation, "horizontal", `${tag}: phone tools bar is horizontal`);
  } else {
    // Desktop and landscape: a vertical rail at the right edge; nothing runs sideways.
    assert.equal(facts.orientation, "vertical", `${tag}: tools rail is vertical`);
    assert.ok(facts.toolbar.width <= 180, `${tag}: rail width ${facts.toolbar.width}`);
    assert.ok(facts.toolbar.height > facts.toolbar.width, `${tag}: rail is taller than wide`);
    assert.ok(facts.toolbar.right >= width - 24, `${tag}: rail hugs the right edge`);
    assert.ok(facts.toolbar.bottom <= facts.zoom.top + 1 || facts.toolbar.right <= facts.zoom.left + 1, `${tag}: rail clears the zoom pill`);
  }
  // Map setup (DM only): a left rail, or the phone's row-2 bar under the title row.
  if (role === "player") assert.equal(facts.setup, null, `${tag}: players get no setup rail`);
  else {
    within(facts.setup, "Map setup toolbar");
    if (width <= 650 && height > 550) {
      assert.equal(facts.setupOrientation, "horizontal", `${tag}: phone setup bar is horizontal`);
      assert.ok(facts.setup.top >= facts.title.bottom + 4, `${tag}: setup bar sits under row 1`);
      assert.ok(facts.setup.bottom <= facts.toolbar.top, `${tag}: setup bar above the tools bar`);
    } else {
      assert.equal(facts.setupOrientation, "vertical", `${tag}: setup rail is vertical`);
      assert.ok(facts.setup.left <= 24, `${tag}: setup rail hugs the left edge`);
      assert.ok(facts.setup.right <= facts.toolbar.left, `${tag}: setup and tools rails apart`);
    }
  }
  // Every tool is reachable at this size: in the bar or rail, or in More tools on short desktops.
  const more = page.getByRole("button", { name: "More tools", exact: true });
  if (width > 650 && height < 720 && height > 550) {
    await more.click();
    await expect(page.getByRole("toolbar", { name: "More tools", exact: true })).toBeVisible();
  }
  for (const name of ["Pan", "Ping", "Measure", "Draw & notes", "Plan journey", "Layers", /^Here/]) {
    const tool = page.getByRole("button", { name, exact: typeof name === "string" }).first();
    await tool.scrollIntoViewIfNeeded();
    await expect(tool).toBeVisible();
  }
  if (role === "dm")
    await expect(page.getByRole("button", { name: "Initiative", exact: true })).toBeVisible();
  else {
    const inspector = page.getByRole("button", { name: "Inspector", exact: true });
    await inspector.scrollIntoViewIfNeeded();
    await expect(inspector).toBeVisible();
  }
  if (await more.isVisible()) {
    if ((await more.getAttribute("aria-expanded")) === "true") await more.click();
  }
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
  // Phones, including narrow landscape (568×320): every control a 44 px unobstructed target.
  if (width <= 650) await checkMobileMapControls(page);
  await page.screenshot({ path: `${output}/map-${tag}.png` });
  checks.push(`${tag}: layout, tokens, fonts, settings without navigation`);
}

async function journalMaps(page) {
  return page.evaluate(async () => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((c) => c.id === active)
          ?.db || "quire",
      db = await new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    try {
      return await new Promise((res, rej) => {
        const r = db.transaction("meta").objectStore("meta").get("journal");
        r.onsuccess = () => res(r.result.value.world.maps);
        r.onerror = () => rej(r.error);
      });
    } finally {
      db.close();
    }
  });
}

/** DM setup rail: Marker and Entrance (with the entry view picked on the destination) open their
 * own panels after placing, save through the same commands, stay armed, and never navigate away. */
async function checkSetupRail(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const setupBar = page.getByRole("toolbar", { name: "Map setup", exact: true });
  const viewport = page.getByRole("region", { name: "Interactive campaign map", exact: true });
  const clickMap = async (fx, fy) => {
    const layer = await viewport.locator(".map-layer").boundingBox();
    await page.mouse.click(layer.x + layer.width * fx, layer.y + layer.height * fy);
  };
  const markers = async () => (await journalMaps(page)).find((m) => m.id === "tide-cove").markers;
  const before = (await markers()).length;
  const url = page.url();
  const marker = setupBar.getByRole("button", { name: "Place marker", exact: true });
  await marker.click();
  await expect(marker).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".map-active-tool")).toContainText("Marker: click the map to place it");
  await clickMap(0.42, 0.4);
  const panel = page.getByRole("dialog", { name: "Marker", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Marker name", { exact: true })).toBeFocused();
  await expect(page.locator("#map-settings")).toBeHidden();
  await panel.getByLabel("Marker name", { exact: true }).fill("Smugglers' cache");
  await panel.getByRole("button", { name: "Save live marker", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(async () => (await markers()).length).toBe(before + 1);
  await expect(marker).toHaveAttribute("aria-pressed", "true");
  // Armed again: a second click opens a fresh panel; Esc closes it, a second Esc disarms.
  await clickMap(0.6, 0.6);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(marker).toHaveAttribute("aria-pressed", "true");
  await viewport.focus();
  await page.keyboard.press("Escape");
  await expect(marker).toHaveAttribute("aria-pressed", "false");
  assert.equal(page.url(), url, "Marker placement changes no route");
  await sameDocument(page, "dm marker panel");

  // Entrance (⇧E): place, name, choose the destination, pick its entry view there, come back.
  await viewport.focus();
  await page.keyboard.press("Shift+E");
  await expect(setupBar.getByRole("button", { name: "Entrance", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await clickMap(0.3, 0.7);
  const entrance = page.getByRole("dialog", { name: "Entrance", exact: true });
  await expect(entrance).toBeVisible();
  await entrance.getByLabel("Entrance name", { exact: true }).fill("Sea cave");
  await chooseOption(entrance.getByLabel("Entrance destination", { exact: true }), "harbour");
  await entrance
    .getByRole("button", { name: "Pick the entry view on the destination", exact: true })
    .click();
  const pick = page.getByRole("region", { name: "Pick the entry view", exact: true });
  await expect(pick).toBeVisible();
  await expectMap(page, "Brackenport harbour");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await pick.getByRole("button", { name: "Use this view", exact: true }).click();
  await expectMap(page, "Smugglers' cove");
  await expect(entrance).toBeVisible();
  await expect(entrance.getByLabel("Entrance name", { exact: true })).toHaveValue("Sea cave");
  await expect(entrance.getByRole("checkbox", { name: /destination entry camera/ })).toBeChecked();
  await entrance.getByRole("button", { name: "Add map entrance", exact: true }).click();
  await expect(entrance).toHaveCount(0);
  await expect
    .poll(async () => {
      const link = (await journalMaps(page))
        .find((m) => m.id === "tide-cove")
        .connected.links.find((l) => l.label === "Sea cave");
      return !!link && link.targetMapId === "harbour" && link.entry?.zoom > 1;
    })
    .toBe(true);
  await page.keyboard.press("Escape");
  await sameDocument(page, "dm entrance panel");

  // Initiative (I): the turn-order panel; with no encounter on this map it offers to start one.
  await page.getByRole("button", { name: "Initiative", exact: true }).click();
  const initiative = page.getByRole("dialog", { name: "Initiative", exact: true });
  await expect(initiative).toContainText("No encounter is running on this map.");
  await expect(initiative.getByRole("button", { name: "Start encounter here", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(initiative).toHaveCount(0);

  // Reveal, Combat and Objects (map controls PR 4): options beside the setup rail.
  await expect(page.getByRole("button", { name: "More map tools", exact: true })).toHaveCount(0);
  for (const group of ["Place", "Reveal", "Combat", "Objects"])
    await expect(setupBar.getByRole("group", { name: group, exact: true })).toBeVisible();
  const options = page.getByRole("complementary", { name: "Tool options", exact: true });
  await setupBar.getByRole("button", { name: "Fog brush", exact: true }).click();
  await expect(options).toBeVisible();
  await expect(options.getByRole("button", { name: "Undo fog", exact: true })).toBeVisible();
  await expect(options.getByRole("button", { name: "Consolidate fog…", exact: true })).toBeVisible();
  const optionsBox = await options.boundingBox();
  assert.ok(optionsBox.x < 640, "Fog options open beside the setup rail (left)");
  await page.keyboard.press("Control+z");
  // A fog rectangle drawn after closing its options is saved.
  const fogShapes = async () =>
    (await journalMaps(page)).find((m) => m.id === "tide-cove").tabletop?.fog?.shapes?.length ?? 0;
  const shapesBefore = await fogShapes();
  await setupBar.getByRole("button", { name: "Fog rectangle", exact: true }).click();
  await options.getByRole("button", { name: "Close tool options", exact: true }).click();
  const layerBox = await viewport.locator(".map-layer").boundingBox();
  await page.mouse.move(layerBox.x + layerBox.width * 0.4, layerBox.y + layerBox.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(layerBox.x + layerBox.width * 0.7, layerBox.y + layerBox.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await expect.poll(fogShapes).toBe(shapesBefore + 1);
  await setupBar.getByRole("button", { name: "Walls & doors", exact: true }).click();
  await expect(options.getByRole("region", { name: "Walls and doors on this map" })).toBeVisible();
  await setupBar.getByRole("button", { name: "Lights", exact: true }).click();
  await expect(options.getByRole("region", { name: "Lights on this map" })).toBeVisible();
  await setupBar.getByRole("button", { name: "Grid & scale", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Grid & scale", exact: true })).toBeVisible();
  await viewport.focus();
  await page.keyboard.press("Shift+T");
  await expect(page.getByRole("dialog", { name: "Combat token", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await setupBar.getByRole("button", { name: "Objects & inspector", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Map inspector" })).toBeVisible();
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  assert.equal(page.url(), url, "Reveal and combat panels change no route");
  await sameDocument(page, "dm reveal and combat panels");

  // Phone: row-2 setup bar, Search as a row-1 icon, the panel is a bottom sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  const search = page.getByRole("combobox", { name: "Search maps and places", exact: true });
  await expect(search).toBeHidden();
  await page.getByRole("button", { name: "Search maps and places", exact: true }).click();
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await setupBar.getByRole("button", { name: "Place marker", exact: true }).click();
  await clickMap(0.5, 0.5);
  await expect(panel).toBeVisible();
  const sheet = await panel.boundingBox();
  assert.ok(sheet.y + sheet.height >= 840 && sheet.width >= 388, "Phone panel is a bottom sheet");
  await page.getByRole("button", { name: "Close Marker panel", exact: true }).click();
  await viewport.focus();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${output}/setup-dm-390x844.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  checks.push(
    "dm: setup rail Marker and Entrance panels (pick on destination), armed after save, Esc twice, phone sheet and search icon, no navigation",
  );
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

    // Tools rail (desktop): tool names on first use, roving focus, Layers, Ping options.
    await enterCove();
    const tools = page.getByRole("toolbar", { name: "Map tools", exact: true });
    const railWidth = () => tools.evaluate((el) => el.getBoundingClientRect().width);
    const hint = page.getByRole("region", { name: "Tool names are showing", exact: true });
    await expect(hint).toBeVisible();
    assert.ok((await railWidth()) > 140, `${role}: first use shows a labelled rail`);
    await expect(tools.locator(".map-tool-label", { hasText: "Plan journey" })).toBeVisible();
    await hint.getByRole("button", { name: "Keep showing", exact: true }).click();
    await expect(hint).toHaveCount(0);
    const pan = tools.getByRole("button", { name: "Pan", exact: true });
    await pan.focus();
    await page.keyboard.press("ArrowDown");
    await expect(tools.getByRole("button", { name: "Select / move", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    assert.equal(
      await tools.evaluate((el) => el.contains(document.activeElement)),
      true,
      `${role}: End stays in the toolbar`,
    );
    const url = page.url();
    await tools.getByRole("button", { name: "Layers", exact: true }).click();
    const layers = page.getByRole("dialog", { name: "Layers", exact: true });
    await expect(layers).toBeVisible();
    await expect(layers.getByRole("group", { name: "Show on map" })).toBeVisible();
    await layers.getByRole("button", { name: "Hide all", exact: true }).click();
    await layers.getByRole("button", { name: "Show all", exact: true }).click();
    assert.equal(page.url(), url, `${role}: Layers changes no route`);
    await sameDocument(page, `${role} Layers`);
    await page.keyboard.press("Escape");
    await expect(layers).toHaveCount(0);
    await tools.getByRole("button", { name: "Ping", exact: true }).click();
    await expect(page.getByLabel("Ping color for this tool", { exact: true })).toBeVisible();
    await tools.getByRole("button", { name: "Pan", exact: true }).click();
    await tools.getByRole("button", { name: /^Here/ }).click();
    await expect(page.getByRole("region", { name: "Here", exact: true })).toBeVisible();
    await tools.getByRole("button", { name: /^Here/ }).click();
    await expect(page.getByRole("region", { name: "Here", exact: true })).toHaveCount(0);
    await sameDocument(page, `${role} Here`);
    checks.push(
      `${role}: labelled rail on first use, roving arrows, Layers/Here/Ping options without navigation`,
    );

    // All map settings: grouped, searchable, opened without navigation (map controls PR 5).
    await page.locator(".map-top-actions .map-settings-toggle").click();
    const drawer = page.locator("#map-settings");
    await expect(drawer.getByText("All map settings", { exact: true })).toBeVisible();
    const groups = ["This map", "Places & party", "Players & display", "Combat", "View", "Shortcuts & help"];
    for (const name of role === "dm" ? [...groups, "Exploration"] : groups)
      await expect(drawer.getByRole("region", { name, exact: true })).toBeVisible();
    if (role === "player")
      await expect(drawer.getByRole("region", { name: "Exploration", exact: true })).toHaveCount(0);
    const search = drawer.getByRole("searchbox", { name: "Search settings", exact: true });
    await search.fill(role === "dm" ? "lighting" : "ping color");
    await expect(
      drawer.getByRole("region", { name: role === "dm" ? "Exploration" : "View", exact: true }),
    ).toBeVisible();
    await expect(drawer.getByRole("region", { name: "Places & party", exact: true })).toBeHidden();
    await search.fill("no such setting zz");
    await expect(drawer.getByText("No settings match. Try another word.")).toBeVisible();
    await search.fill("");
    await drawer
      .getByRole("navigation", { name: "Settings groups" })
      .getByRole("button", { name: "Shortcuts & help", exact: true })
      .click();
    await expect(drawer.getByRole("region", { name: "Shortcuts & help", exact: true })).toBeInViewport();
    await expect(drawer.getByText("Plan journey", { exact: true })).toBeVisible();
    assert.equal(page.url().includes("map=tide-cove"), true, `${role}: settings keep the map`);
    await sameDocument(page, `${role} grouped settings`);
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    checks.push(`${role}: grouped settings with search, group index and shortcuts, no navigation`);

    // Every role, look and size: names shown (dark), then hidden from Settings (light).
    for (const appearance of ["dark", "light"]) {
      await look(page, appearance);
      if (appearance === "light") {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.locator(".map-top-actions .map-settings-toggle").click();
        await page.getByLabel("Show tool names (desktop)", { exact: true }).uncheck();
        await page.getByRole("button", { name: "Close settings", exact: true }).click();
        assert.ok((await railWidth()) <= 64, `${role}: icon-only rail once names are hidden`);
      }
      for (const [width, height] of SIZES)
        await checkChrome(page, { role, appearance, width, height });
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    if (role === "dm") await checkSetupRail(page);

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
