import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { blankSheet } from "../src/lib/characters/model.mjs";
import { blankEncounter, blankCombatant } from "../src/lib/encounters/model.mjs";

const baseline = process.argv.includes("--baseline"),
  compare = process.argv.includes("--compare");
const output = process.env.DESKTOP_SCREENSHOTS || "test-results/desktop";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):/);
await mkdir(`${output}/${baseline ? "before" : "after"}`, { recursive: true });
const context = await chromium.launchPersistentContext("test-results/desktop-profile", {
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
  viewport: { width: 390, height: 844 },
});
const page = context.pages()[0] || (await context.newPage()),
  errors = [];
page.setDefaultTimeout(20000);
page.on("pageerror", (e) => errors.push(e.message));
await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
// Layout-only fixtures; authorization and writes use the separate real-server audits.
const sheet = {
  ...blankSheet(),
  name: "Mira Ashfall",
  species: "Elf",
  classes: "Ranger",
  level: 5,
  hp: 32,
  maxHp: 40,
  ac: 16,
  attacks: [
    { name: "Longbow", bonus: 6, damage: "1d8+3", notes: "150/600 ft" },
    { name: "Shortsword", bonus: 6, damage: "1d6+3", notes: "Finesse" },
  ],
  resources: [{ name: "Focus", current: 2, max: 3 }],
};
const row = { id: "layout-hero", body: sheet, revision: 1, campaign_code: "", purse_id: "" };
const encounter = {
  ...blankEncounter(),
  name: "Ambush on the northern road",
  round: 3,
  activeId: "enemy-0",
  combatants: Array.from({ length: 5 }, (_, i) => ({
    ...blankCombatant(),
    id: `enemy-${i}`,
    name: i ? `Goblin scout ${i}` : "Goblin captain",
    initiative: 18 - i,
    hp: 8 + i,
    maxHp: 15,
    ac: 14,
  })),
};
const campaign = { code: "LAYOUT", name: "The northern road", purses: [] };
await context.route("**/api/account/sheets", (r) =>
  r.fulfill({ json: { characters: [row], campaigns: [] } }),
);
await context.route("**/api/account/sheets/detail", (r) =>
  r.fulfill({ json: { ...row, editable: true, assignmentError: "", campaign: null } }),
);
await context.route("**/api/account/sheets/log", (r) =>
  r.fulfill({ json: { rolls: [], more: false } }),
);
await context.route("**/api/account/encounters", (r) =>
  r.fulfill({
    json: {
      campaigns: [campaign],
      encounters: [
        {
          id: "layout-encounter",
          code: campaign.code,
          name: encounter.name,
          status: "active",
          updated_at: 1790956800000,
        },
      ],
    },
  }),
);
await context.route("**/api/account/encounters/detail", (r) =>
  r.fulfill({
    json: {
      id: "layout-encounter",
      code: campaign.code,
      body: encounter,
      revision: 1,
      status: "active",
      purses: [],
      award: null,
    },
  }),
);
await context.route("**/api/account/encounters/log", (r) =>
  r.fulfill({ json: { rolls: [], more: false } }),
);
async function visit(path) {
  await page.goto(origin + path);
  await page.locator(".role-chip:enabled").waitFor();
  await page.locator(".quire-dawn").waitFor({ state: "hidden" });
  await page.evaluate(() => document.fonts.ready);
  if (path.startsWith("/characters"))
    await page.getByRole("heading", { name: "Mira Ashfall", exact: true }).waitFor();
  if (path.startsWith("/encounters"))
    await page.getByRole("button", { name: "Save encounter", exact: true }).waitFor();
  await page.waitForTimeout(150);
}
async function capture(name, mobile = false) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${name}: overflow`,
  );
  const expected = compare && mobile ? await readFile(`${output}/before/${name}.png`) : null;
  const image = await page.screenshot({
    path: `${output}/${baseline ? "before" : "after"}/${name}.png`,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
  if (!expected || image.equals(expected)) return;
  // Chromium occasionally changes a few rounded-edge pixels by one color value.
  // Allow only that rasterization noise, never a dimension, spacing or text change.
  const difference = await page.evaluate(
    async (images) => {
      const decoded = await Promise.all(
        images.map(async (data) => {
          const bitmap = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${data}`)).blob(),
          );
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(bitmap, 0, 0);
          return {
            width: bitmap.width,
            height: bitmap.height,
            data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
          };
        }),
      );
      const [a, b] = decoded;
      if (a.width !== b.width || a.height !== b.height)
        return { pixels: Infinity, shade: Infinity };
      let pixels = 0,
        shade = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        const delta = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(a.data[i + c] - b.data[i + c])));
        if (delta) pixels++;
        shade = Math.max(shade, delta);
      }
      return { pixels, shade };
    },
    [expected.toString("base64"), image.toString("base64")],
  );
  assert.ok(
    difference.pixels <= 16 && difference.shade <= 1,
    `${name}: mobile screenshot changed (${JSON.stringify(difference)})`,
  );
  console.log(`${name}: layout unchanged; ${difference.pixels} edge pixels differ by one shade.`);
}
async function role(value) {
  await page.evaluate(async (role) => {
    const e = await import("/src/lib/quire/economy.ts"),
      t = await import("/src/lib/quire/table.ts");
    await e.ensureEconomy();
    const purses = await e.listPurses();
    const shops = await e.listShops();
    t.setSeat({
      ...t.getSeat(),
      role,
      purseIds: purses
        .filter((p) => p.kind === "character")
        .slice(0, 1)
        .map((p) => p.id),
      shopIds: shops.map((s) => s.id),
    });
  }, value);
}
try {
  await visit("/");
  // Keep one disposable saved campaign identical across before/after captures.
  await page.evaluate(async () => {
    if (localStorage.getItem("desktop-layout-fixture")) return;
    const e = await import("/src/lib/quire/economy.ts");
    await e.ensureEconomy();
    const purses = await e.listPurses();
    for (let i = 0; i < 6; i++)
      await e.postCopper(
        purses[i % purses.length].id,
        100 * (i + 1),
        [
          "Roadside supplies",
          "Quest reward",
          "Recovered silver",
          "Town provisions",
          "Equipment sale",
          "Shared treasure",
        ][i],
      );
    localStorage.setItem("desktop-layout-fixture", "yes");
  });
  for (const seat of ["dm", "player"]) {
    await role(seat);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [name, path] of [
      ["home", seat === "dm" ? "/" : "/characters"],
      ["party", "/party"],
      ["market", "/market"],
      ["library", "/library"],
      ["fifth", seat === "dm" ? "/encounters?resume=1" : "/share"],
    ]) {
      await visit(path);
      await capture(`${seat}-390-${name}`, true);
    }
    await page.getByRole("button", { name: "Settings & Management", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await capture(`${seat}-390-settings`, true);
    await page.keyboard.press("Escape");
    for (const width of [320, 768, 1023]) {
      await page.setViewportSize({ width, height: 900 });
      await visit(seat === "dm" ? "/" : "/characters");
      await capture(`${seat}-${width}`, true);
    }
    if (!baseline)
      for (const width of [1024, 1440, 1920, 2560]) {
        await page.setViewportSize({ width, height: 1080 });
        for (const [name, path] of [
          ["home", seat === "dm" ? "/" : "/characters"],
          ["party", "/party"],
          ["market", "/market"],
          ["library", "/library"],
          ["fifth", seat === "dm" ? "/encounters?resume=1" : "/share"],
        ]) {
          await visit(path);
          await capture(`${seat}-${width}-${name}`);
          const bounds = await page.locator(".concept-main").boundingBox();
          assert.ok(bounds.x + bounds.width >= width - 1, `${name} main fills the monitor`);
          if (name === "home" && seat === "dm")
            await page.getByRole("heading", { name: "Recent activity", exact: true }).waitFor();
          if (name === "home" && seat === "player") {
            const a = await page.locator(".play-surface").boundingBox(),
              b = await page.locator(".sheet-edit-fields").boundingBox();
            assert.ok(
              b.x >= a.x + a.width,
              `Dice and play panels sit alongside each other at ${width}px`,
            );
          }
        }
      }
  }
  assert.deepEqual(errors, []);
  console.log(
    baseline
      ? "PASS: mobile baselines captured."
      : `PASS: desktop fills 1024–2560px; DM panels and player tools visible; no overflow/runtime errors${compare ? "; all 18 mobile screenshots match (at most 16 edge pixels may differ by one shade)" : ""}.`,
  );
} finally {
  await context.close();
}
