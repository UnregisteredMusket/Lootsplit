import { openApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";
const origin = "http://127.0.0.1:8080",
  output = process.env.PARTY_SCREENSHOTS || "test-results/party-sheets";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const db = localAccountDb("data/account-dev.sqlite"),
  users = [],
  pages = [],
  errors = [];
let code = "";
async function actor(name, ip) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { "cf-connecting-ip": ip },
  });
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const r = await context.request.post(origin + "/api/account/auth/sign-up/email", {
    headers: { origin },
    data: {
      name,
      email: `unified-${name}-${Date.now()}@example.com`,
      password: "disposable integration password",
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const id = (await r.json()).user.id;
  users.push(id);
  const page = await context.newPage();
  pages.push(page);
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  await visit(page, "/party");
  return { page, context, id };
}
async function visit(page, path) {
  await openApplication(page, origin + path);
  await page.locator(".role-chip:enabled").waitFor();
  await page.locator(".quire-dawn").waitFor({ state: "hidden" });
}
async function state(page) {
  return page.evaluate(async () => (await import("/src/lib/quire/economy.ts")).economySnapshot());
}
async function save(page) {
  await page.getByRole("button", { name: "Save character", exact: true }).click();
  await page.getByText("Saved character", { exact: true }).waitFor();
}
async function edit(page) {
  await page.getByRole("button", { name: "Edit sheet", exact: true }).click();
}
try {
  const dm = await actor("dm", "192.0.2.241"),
    player = await actor("player", "192.0.2.242");
  // Natural workflow: no account profile, no assignment or reference is required.
  await visit(dm.page, "/characters");
  await dm.page.locator(".character-library-controls > summary").click();
  await dm.page.getByRole("button", { name: "Create character", exact: true }).click();
  await dm.page.getByRole("heading", { name: "New adventurer", exact: true }).waitFor();
  await edit(dm.page);
  await dm.page.getByLabel("Maximum HP", { exact: true }).fill("115");
  await dm.page.getByLabel("Current HP", { exact: true }).fill("10");
  await dm.page.getByRole("button", { name: "Character details", exact: true }).click();
  await dm.page.getByLabel("Character name", { exact: true }).fill("Unified sentinel");
  await save(dm.page);
  let t = await state(dm.page),
    p = t.purses.find((p) => p.name === "Unified sentinel");
  assert.ok(p?.sheet);
  const id = p.id,
    href = `/characters?id=${encodeURIComponent(`party:${id}`)}`;
  await dm.page.getByRole("button", { name: "Inventory & currency", exact: true }).click();
  await dm.page.getByLabel("GP", { exact: true }).fill("17");
  await dm.page.getByRole("button", { name: "Add equipment", exact: true }).click();
  await dm.page.getByLabel("Item 1 name", { exact: true }).fill("Sentinel sword");
  await dm.page.getByLabel("Sentinel sword quantity", { exact: true }).fill("2");
  await save(dm.page);
  t = await state(dm.page);
  assert.equal(t.purses.find((p) => p.id === id).coins.gp, 17);
  assert.equal(t.holdings.find((h) => h.purseId === id).quantity, 2);
  await visit(dm.page, "/party");
  let card = dm.page.locator(".party-profile").filter({ hasText: "Unified sentinel" });
  await card.getByText("10 / 115 HP", { exact: false }).waitFor();
  assert.equal(
    await card.getByRole("link", { name: "Open sheet", exact: true }).getAttribute("href"),
    href,
  );
  await dm.page.getByRole("tab", { name: "Funds & inventory", exact: true }).click();
  const funds = dm.page
    .locator("section.rounded-xl")
    .filter({ has: dm.page.locator('input[aria-label="Funds name"][value="Unified sentinel"]') });
  await dm.page.locator(`#purse-${id} > summary`).click();
  await funds.getByLabel("Gold", { exact: true }).fill("23");
  await funds.getByRole("button", { name: "Set coins", exact: true }).click();
  await funds.getByText(/23 gp/).first().waitFor();
  await funds.getByRole("link", { name: "Open character sheet", exact: true }).click();
  await edit(dm.page);
  await dm.page.getByRole("button", { name: "Inventory & currency", exact: true }).click();
  assert.equal(await dm.page.getByLabel("GP", { exact: true }).inputValue(), "23");
  assert.equal(
    await dm.page.getByLabel("Sentinel sword quantity", { exact: true }).inputValue(),
    "2",
  );
  await dm.page.getByLabel("Equip Sentinel sword", { exact: true }).check();
  await save(dm.page);
  await visit(dm.page, "/");
  await dm.page.locator(".glance-strip").getByRole("link").filter({ hasText: "10/115" }).waitFor();
  // Persistence is campaign data, not a localStorage association. Restore into a new campaign.
  await dm.page.evaluate(async () => {
    const e = await import("/src/lib/quire/economy.ts"),
      c = await import("/src/lib/quire/campaigns.ts");
    const copy = await e.snapshot();
    c.createCampaign("Restored identity");
    await e.restore(copy);
  });
  await visit(dm.page, "/party");
  await card.getByText("10 / 115 HP", { exact: false }).waitFor();
  await dm.page.evaluate(async () =>
    (await import("/src/lib/quire/campaigns.ts")).switchCampaign("main"),
  );
  await visit(dm.page, "/party");
  // Old explicit local links migrate stats only. Money and tradeable items remain untouched.
  const old = (await state(dm.page)).purses.find((p) => p.kind === "character" && p.id !== id);
  const res = await dm.context.request.post(origin + "/api/account/sheets/save", {
    headers: { origin },
    data: {
      sheet: {
        ...blankSheet(),
        name: "Migrated profile",
        hp: 8,
        maxHp: 29,
        coins: { cp: 0, sp: 0, ep: 0, gp: 999, pp: 0 },
      },
    },
  });
  const profile = (await res.json()).id;
  const oldCoins = old.coins;
  await dm.page.evaluate(
    async ({ owner, profile, purse }) => {
      const links = await import("/src/lib/quire/party-sheet-links.ts");
      links.writePartySheetLink(owner, "main", profile, purse, [purse]);
    },
    { owner: dm.id, profile, purse: old.id },
  );
  await visit(dm.page, "/party");
  await dm.page
    .locator(".party-profile")
    .filter({ hasText: "Migrated profile" })
    .getByText("8 / 29 HP", { exact: false })
    .waitFor();
  assert.deepEqual((await state(dm.page)).purses.find((p) => p.id === old.id).coins, oldCoins);
  // Shared players edit the same character; DM receives HP and equipment changes.
  code = await dm.page.evaluate(async () => {
    const c = await import("/src/lib/quire/cloud-client.ts");
    await c.chooseTableMode("live");
    await (await import("/src/lib/account/transfers.ts")).linkCurrentCampaign();
    return c.getCloudTable().code;
  });
  await player.page.evaluate(
    async ({ code, id }) => {
      const c = await import("/src/lib/quire/cloud-client.ts");
      await c.joinTable(code, id, "Player");
      await (await import("/src/lib/account/transfers.ts")).linkCurrentCampaign();
    },
    { code, id },
  );
  await visit(player.page, href);
  await player.page.getByRole("heading", { name: "Unified sentinel", exact: true }).waitFor();
  await edit(player.page);
  await player.page.getByLabel("Current HP", { exact: true }).fill("7");
  await save(player.page);
  await player.page.getByRole("button", { name: "Inventory & currency", exact: true }).click();
  assert.equal(
    await player.page.getByLabel("Sentinel sword quantity", { exact: true }).isEnabled(),
    false,
  );
  assert.equal(
    await player.page.getByRole("button", { name: "Add equipment", exact: true }).count(),
    0,
  );
  await player.page.getByLabel("Equip Sentinel sword", { exact: true }).uncheck();
  await save(player.page);
  await visit(dm.page, "/party");
  await card.getByText("7 / 115 HP", { exact: false }).waitFor();
  assert.equal((await state(dm.page)).holdings.find((h) => h.purseId === id).equipped, false);
  await visit(player.page, "/");
  await player.page
    .getByRole("region", { name: "Interactive characters" })
    .getByRole("heading", { name: "Unified sentinel", exact: true })
    .waitFor();
  // Guest local mode retains full character sheets and device dice without registration.
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const gp = await guest.newPage();
  gp.on("pageerror", (e) => errors.push(e.message));
  await guest.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  await visit(gp, "/party");
  await gp
    .locator(".party-profile")
    .first()
    .getByRole("link", { name: "Open sheet", exact: true })
    .click();
  await edit(gp);
  await gp.getByRole("button", { name: "Roll dice", exact: true }).click();
  await gp.locator(".roll-log li").waitFor();
  assert.ok(await gp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await gp.screenshot({ path: output + "/guest-mobile.png", fullPage: true });
  await dm.page.setViewportSize({ width: 390, height: 844 });
  await visit(dm.page, "/party");
  await card.getByText("7 / 115 HP", { exact: false }).waitFor();
  await dm.page.screenshot({ path: output + "/party-mobile.png", fullPage: true });
  await dm.page.setViewportSize({ width: 1920, height: 1080 });
  await dm.page.screenshot({ path: output + "/party-desktop.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: natural character creation, direct party HP, both-way inventory and funds, backup identity, legacy migration without grants, shared player permissions and metadata, guest sheets/dice, mobile and desktop.",
  );
} catch (e) {
  for (const page of pages)
    console.error(page.url(), (await page.locator("body").innerText()).slice(0, 5000));
  throw e;
} finally {
  await browser.close();
  if (code) await db.prepare("DELETE FROM campaign_rooms WHERE code=?").bind(code).run();
  for (const id of users) await db.prepare("DELETE FROM user WHERE id=?").bind(id).run();
  db.close();
}
