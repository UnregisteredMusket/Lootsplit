// Loading screen for a large shared campaign (sectioned storage step 3C). A disposable DM shares a
// synthetic campaign of about 3.7 MB live: a long party ledger and chat (1.1 MB, whose older lines
// current clients load on demand since step 4) and 2.5 MB of journal notes, which every view holds
// (more than one section batch, so progress is seen rising); players join
// at 320 px and 1280 px. Section downloads are slowed in the browser so the screen is observable. Checks: the
// screen appears with the brand chase (adventurer and kobold running in place, centred), "Loading
// your campaign…" with an "N%/100%" value that rises and matches role=progressbar, MB and parts as
// secondary detail, a 10 % polite announcement and both choices; Keep waiting
// continues behind a progress pill and the campaign arrives complete; Go back returns to the
// previous screen and pauses downloads until Continue loading; reduced motion shows the still
// mascot (no stride, dust or streaks) and no bar animation; nothing scrolls sideways; no page errors. Never targets a real campaign.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { openApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):/, "Disposable local server required.");
const output = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/campaign-loading`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const errors = [];
const ip = () => `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
const CAMPAIGN = "The Long Road";
const players = [
  { id: "mira", name: "Mira" },
  { id: "kael", name: "Kael" },
];

async function device(label, width, options = {}) {
  const context = await browser.newContext({
    viewport: { width, height: width < 400 ? 700 : 900 },
    serviceWorkers: "block",
    extraHTTPHeaders: { "cf-connecting-ip": ip() },
    ...options,
  });
  await context.route(
    (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
    (route) => route.abort(),
  );
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  return { context, page };
}
/** Slows section downloads (readCloudSections) so the loading screen can be observed. */
async function slowSections(context, ms) {
  const counts = { sections: 0 };
  await context.route("**/_serverFn/**", async (route) => {
    if (route.request().postData()?.includes('"hashes"')) {
      counts.sections++;
      await new Promise((done) => setTimeout(done, ms));
    }
    await route.continue();
  });
  return counts;
}
const PERCENT = /^(\d{1,3})%\/100%$/;
/** The shown "N%/100%" value, checked against the progressbar. */
async function shownPercent(screen) {
  const text = (await screen.locator("[data-campaign-loading-percent]").first().textContent()).trim();
  const match = PERCENT.exec(text);
  assert.ok(match, `percentage in the owner's format: ${text}`);
  const value = Number(match[1]);
  assert.ok(value >= 0 && value <= 100, `0–100: ${value}`);
  return value;
}
/** The chase's two layers: loaded, centred on the screen, and their transforms over time. */
async function chase(page) {
  return page.locator("[data-campaign-loading-chase]").evaluate(async (stage) => {
    const imgs = [...stage.querySelectorAll("img")];
    await Promise.all(imgs.map((img) => img.decode().catch(() => {})));
    const rect = stage.getBoundingClientRect();
    const sample = () => imgs.map((img) => getComputedStyle(img).transform);
    const first = sample();
    await new Promise((done) => setTimeout(done, 170));
    const second = sample();
    return {
      layers: imgs.map((img) => img.getAttribute("src")),
      loaded: imgs.every((img) => img.complete && img.naturalWidth > 0),
      animations: imgs.map((img) => getComputedStyle(img).animationName),
      moved: first.some((t, i) => t !== second[i]),
      transforms: second,
      offCentre: Math.abs(rect.left + rect.width / 2 - innerWidth / 2),
      decor: [...stage.querySelectorAll(".chase-dust, .chase-streak, .chase-ground")].map(
        (el) => getComputedStyle(el).display,
      ),
    };
  });
}
const fits = async (page, label) =>
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${label}: the page scrolls sideways`,
  );

try {
  const dm = await device("dm", 1280);
  dm.page.setDefaultTimeout(90000); // The first visit compiles the development server's modules.
  await openApplication(dm.page, origin + "/party");
  dm.page.setDefaultTimeout(30000);
  await dm.page.evaluate(
    async ({ campaign, players }) => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const { blankSheet } = await import("/src/lib/characters/model.mjs");
      const coins = (gp) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins: coins(400) },
          ...players.map((p) => ({ id: p.id, name: p.name, kind: "character", coins: coins(12), sheet: { ...blankSheet(), name: p.name, hp: 10, maxHp: 12 } })),
        ],
        holdings: [],
        shops: [],
        stock: [],
        // A long party history: about 0.6 MB of ledger and 0.5 MB of chat.
        ledger: Array.from({ length: 3000 }, (_, i) => ({ id: `l-${i}`, at: 1_700_000_000_000 + i, purseId: "hoard", shopId: null, summary: `Road supplies ${i}: rope, lantern oil and rations`, copper: 0, transactionType: "adjustment" })),
        listings: [],
        loans: [],
        sheets: [],
        notes: Array.from({ length: 3000 }, (_, i) => ({ id: `n-${i}`, at: 1_700_000_000_000 + i, from: "dm", to: "party", purseId: "", text: `Day ${i}: the caravan moves north at dawn.` })),
        // Party journal notes every view holds (the ledger and chat above are history on demand).
        journal: readJournal({
          entries: Array.from({ length: 4200 }, (_, i) => ({ id: `e-${i}`, at: 1_700_000_000_000 + i, authorId: "dm", purseId: "", visibility: "party", title: `Road log ${i}`, text: `Day ${i}: `.padEnd(560, "the road winds on through the hills. "), reportIds: [] })),
        }),
      });
      const { getCampaigns, renameCampaign } = await import("/src/lib/quire/campaigns.ts");
      renameCampaign(getCampaigns().activeId, campaign);
      const c = await import("/src/lib/quire/cloud-client.ts");
      await c.chooseTableMode("live");
    },
    { campaign: CAMPAIGN, players },
  );
  const room = await dm.page.evaluate(async () => {
    const { getCloudTable } = await import("/src/lib/quire/cloud-client.ts");
    const view = getCloudTable();
    return { code: view.code, sessionId: view.sessionId };
  });
  assert.match(room.code, /^[A-Z0-9]{4,12}$/);
  const joinLink = `${origin}/share?join=${room.code}&session=${room.sessionId}`;

  // 1. A phone (320 px) joins: the loading screen, then Keep waiting.
  const phone = await device("player 320", 320);
  const slowPhone = await slowSections(phone.context, 1500);
  await openApplication(phone.page, joinLink);
  await phone.page.getByRole("combobox", { name: "Choose your character", exact: true }).selectOption("mira");
  await phone.page.getByLabel("Your name", { exact: true }).fill("Loading audit player");
  await phone.page.getByRole("button", { name: "Join room", exact: true }).click();
  const screen = phone.page.getByRole("dialog", { name: "Loading your campaign…", exact: true });
  await expect(screen).toBeVisible();
  await expect(screen.getByRole("heading", { level: 2 })).toHaveText(/^Loading your campaign… \d{1,3}%\/100%$/);
  const running = await chase(phone.page);
  assert.deepEqual(running.layers, ["/brand/chase-adventurer.webp", "/brand/chase-kobold.webp"]);
  assert.ok(running.loaded, "both chase layers loaded");
  assert.deepEqual(running.animations, ["chase-stride-adventurer", "chase-stride-kobold"]);
  assert.ok(running.moved, "the runners move in place");
  assert.ok(running.offCentre <= 2, `the chase is centred (${running.offCentre}px off)`);
  assert.ok(running.decor.every((d) => d !== "none"), "dust, streaks and ground show");
  const bar = screen.getByRole("progressbar", { name: "Campaign download" });
  await expect(bar).toHaveAttribute("aria-valuemin", "0");
  await expect(bar).toHaveAttribute("aria-valuemax", "100");
  await expect(bar).toHaveAttribute("aria-valuetext", /^\d{1,3}% · [\d.]+ MB of [\d.]+ MB · \d+ of \d+ parts$/);
  const firstPercent = await shownPercent(screen);
  assert.ok(firstPercent < 100, "100% only when complete");
  assert.equal(Number(await bar.getAttribute("aria-valuenow")), firstPercent, "progressbar matches the text");
  await expect(screen.locator(".campaign-loading-detail")).toHaveText(/^[\d.]+ MB of [\d.]+ MB · \d+ of \d+ parts$/);
  await expect(screen.getByRole("status")).toHaveText(/^Loading your campaign: (\d0|0|100)% loaded\.$/);
  await expect(screen.getByRole("button", { name: "Keep waiting", exact: true })).toBeFocused();
  await expect(screen.getByRole("button", { name: "Go back", exact: true })).toBeVisible();
  await fits(phone.page, "loading screen 320");
  await phone.page.screenshot({ path: `${output}/loading-320.png` });
  await expect.poll(() => shownPercent(screen), { timeout: 30000 }).toBeGreaterThan(firstPercent);
  const laterPercent = await shownPercent(screen);
  assert.equal(Number(await bar.getAttribute("aria-valuenow")), laterPercent, "progressbar follows the text");
  await screen.getByRole("button", { name: "Keep waiting", exact: true }).click();
  const pill = phone.page.locator('[data-campaign-loading="background"]');
  await expect(pill).toBeVisible();
  await expect(pill.getByRole("progressbar")).toBeVisible();
  await expect(pill).toContainText(/Loading your campaign… \d{1,3}%\/100%/);
  await fits(phone.page, "background pill 320");
  await phone.page.screenshot({ path: `${output}/background-320.png` });
  await expect(phone.page.locator("[data-campaign-loading]")).toHaveCount(0, { timeout: 60000 });
  await phone.page.waitForURL((u) => u.pathname === "/" && u.searchParams.get("view") === "home");
  assert.ok(slowPhone.sections >= 1, "sections were downloaded");
  const arrived = await phone.page.evaluate(async () => {
    const { snapshot } = await import("/src/lib/quire/economy.ts");
    const t = await snapshot();
    return { ledger: t.ledger.length, entries: t.journal?.entries?.length ?? 0 };
  });
  assert.equal(arrived.entries, 4200, "every journal note arrived");
  assert.ok(arrived.ledger >= 512, `the newest party ledger lines arrived (${arrived.ledger}); earlier ones load on demand`);

  // 2. A desktop player with reduced motion: Go back pauses, Continue loading finishes.
  const desk = await device("player 1280", 1280, { reducedMotion: "reduce" });
  await slowSections(desk.context, 1500);
  await openApplication(desk.page, joinLink);
  await desk.page.getByRole("combobox", { name: "Choose your character", exact: true }).selectOption("kael");
  await desk.page.getByLabel("Your name", { exact: true }).fill("Desktop loading audit player");
  await desk.page.getByRole("button", { name: "Join room", exact: true }).click();
  const deskScreen = desk.page.getByRole("dialog", { name: "Loading your campaign…", exact: true });
  await expect(deskScreen).toBeVisible();
  const still = await chase(desk.page);
  assert.ok(still.loaded, "reduced motion: the mascot layers show");
  assert.deepEqual(still.animations, ["none", "none"], "reduced motion: no stride");
  assert.deepEqual(still.transforms, ["none", "none"], "reduced motion: the still mascot");
  assert.ok(!still.moved, "reduced motion: nothing moves");
  assert.ok(still.decor.every((d) => d === "none"), "reduced motion: no dust, streaks or ground");
  assert.ok(still.offCentre <= 2, "reduced motion: centred");
  await shownPercent(deskScreen);
  const transition = await deskScreen
    .locator(".campaign-loading-bar > span")
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  assert.equal(transition, "0s", "reduced motion: the bar does not animate");
  await fits(desk.page, "loading screen 1280");
  await desk.page.screenshot({ path: `${output}/loading-1280.png` });
  await deskScreen.getByRole("button", { name: "Go back", exact: true }).click();
  const paused = desk.page.locator('[data-campaign-loading="paused"]');
  await expect(paused).toBeVisible().catch(async (error) => {
    await desk.page.screenshot({ path: `${output}/paused-failure.png` });
    throw Error(`${error.message}\nURL: ${desk.page.url()}`);
  });
  assert.equal(new URL(desk.page.url()).origin, origin, "Go back stays in Lootsplitter");
  await expect(paused).toContainText("Loading this large campaign is paused.");
  await expect(deskScreen).toHaveCount(0);
  await expect(desk.page.locator(".loot-route-loading")).toHaveCount(0);
  await fits(desk.page, "paused 1280");
  await desk.page.screenshot({ path: `${output}/paused-1280.png` });
  await paused.getByRole("button", { name: "Continue loading", exact: true }).click();
  await expect(desk.page.locator('[data-campaign-loading="paused"]')).toHaveCount(0);
  await expect
    .poll(
      async () =>
        desk.page.evaluate(async () => {
          const { snapshot } = await import("/src/lib/quire/economy.ts");
          return (await snapshot()).journal?.entries?.length ?? 0;
        }),
      { timeout: 60000 },
    )
    .toBeGreaterThanOrEqual(4200);
  await expect(desk.page.locator("[data-campaign-loading]")).toHaveCount(0, { timeout: 60000 });

  assert.deepEqual(errors, []);
  console.log(`Campaign loading audit passed; screenshots in ${output}`);
} finally {
  await browser.close();
}
