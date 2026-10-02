import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";
const origin = "http://127.0.0.1:8080";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const db = localAccountDb("data/account-dev.sqlite"),
  users = [],
  pages = [],
  errors = [];
let roomCode = "";
await mkdir(process.env.PARTY_SCREENSHOTS || "test-results/party-sheets", { recursive: true });
const output = process.env.PARTY_SCREENSHOTS || "test-results/party-sheets";
async function actor(name, ip) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { "cf-connecting-ip": ip },
  });
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const response = await context.request.post(origin + "/api/account/auth/sign-up/email", {
    headers: { origin },
    data: {
      name,
      email: `party-${name}-${Date.now()}@example.com`,
      password: "disposable party integration password",
    },
  });
  assert.equal(response.status(), 200);
  const id = (await response.json()).user.id;
  users.push(id);
  const page = await context.newPage();
  pages.push(page);
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(e.message));
  await visit(page, "/");
  return { context, page, id };
}
async function visit(page, path) {
  await page.goto(origin + path);
  await page.locator(".role-chip:enabled").waitFor();
  await page.locator(".quire-dawn").waitFor({ state: "hidden" });
}
async function api(actor, path, data) {
  const response = await actor.context.request.post(origin + "/api/account/" + path, {
    headers: { origin },
    data,
  });
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}
async function finances(page) {
  return page.evaluate(async () => {
    const e = await import("/src/lib/quire/economy.ts");
    await e.ensureEconomy();
    return {
      purses: await e.listPurses(),
      holdings: await e.listHoldings(),
      ledger: await e.listLedger(),
    };
  });
}
try {
  const dm = await actor("dm", "192.0.2.241"),
    player = await actor("player", "192.0.2.242");
  const before = await finances(dm.page),
    purse = before.purses.find((p) => p.kind === "character");
  const ownSheet = {
    ...blankSheet(),
    name: "Local sentinel",
    classes: "Ranger",
    level: 5,
    hp: 31,
    maxHp: 40,
    ac: 16,
  };
  const { id } = await api(dm, "sheets/save", { sheet: ownSheet });
  await visit(dm.page, `/characters?id=${id}`);
  await dm.page.getByRole("heading", { name: ownSheet.name, exact: true }).waitFor();
  await dm.page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  await dm.page.getByRole("button", { name: "Character details", exact: true }).click();
  await dm.page.getByLabel("Assign campaign", { exact: true }).selectOption("device:main");
  await dm.page.getByLabel("Assign campaign character", { exact: true }).selectOption(purse.id);
  await dm.page.getByRole("button", { name: "Save campaign assignment", exact: true }).click();
  await dm.page.getByText(/Character linked to this device campaign/).waitFor();
  assert.deepEqual(await finances(dm.page), before, "Linking never transfers money or equipment");
  await dm.page.getByRole("button", { name: "Inventory & currency", exact: true }).click();
  await dm.page.getByText(/Device campaign ledger/).waitFor();
  await dm.page.getByRole("link", { name: "Open party inventory", exact: true }).click();
  await dm.page.getByRole("tab", { name: "Funds & inventory", exact: true }).waitFor();
  assert.equal(
    await dm.page
      .getByRole("tab", { name: "Funds & inventory", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await dm.page.getByRole("tab", { name: "Characters", exact: true }).click();
  const card = dm.page
    .locator(".party-profile")
    .filter({ has: dm.page.getByRole("heading", { name: purse.name, exact: true }) });
  await card.getByText("31 / 40 HP", { exact: false }).waitFor();
  assert.equal(
    await card.getByRole("link", { name: "Open sheet", exact: true }).getAttribute("href"),
    `/characters?id=${id}`,
  );
  await card.getByRole("link", { name: "Open sheet", exact: true }).click();
  await dm.page.getByRole("heading", { name: ownSheet.name, exact: true }).waitFor();
  await dm.page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  await dm.page.getByLabel("Current HP", { exact: true }).fill("27");
  await dm.page.getByRole("button", { name: "Save character", exact: true }).click();
  await dm.page.getByText("Saved character", { exact: true }).waitFor();
  await visit(dm.page, "/party");
  await card.getByText("27 / 40 HP", { exact: false }).waitFor();
  await dm.page.reload();
  await card.getByText("27 / 40 HP", { exact: false }).waitFor();
  await dm.page.screenshot({ path: output + "/linked-local.png" });
  await visit(dm.page, "/");
  const glance = dm.page.locator(".glance-strip").getByRole("link").filter({ hasText: "27/40" });
  await glance.waitFor();
  assert.equal(await glance.getAttribute("href"), `/characters?id=${id}`);
  await glance.click();
  await dm.page.getByRole("heading", { name: ownSheet.name, exact: true }).waitFor();
  await visit(dm.page, "/party");
  const references = await dm.page.evaluate(() =>
    Object.entries(localStorage).filter(([k]) => k.startsWith("lootsplit.party-sheets.v1.")),
  );
  await player.page.evaluate((entries) => {
    for (const [k, v] of entries) localStorage.setItem(k, v);
  }, references);
  await visit(player.page, "/party");
  await player.page.waitForTimeout(500);
  assert.equal(
    await player.page.getByRole("link", { name: "Open sheet", exact: true }).count(),
    0,
    "An account cannot resolve another account’s local reference",
  );
  // A second device campaign contains the same character identifiers, but no inherited links.
  await dm.page.evaluate(async () => {
    const campaigns = await import("/src/lib/quire/campaigns.ts"),
      e = await import("/src/lib/quire/economy.ts");
    const rows = await e.listPurses();
    campaigns.createCampaign("Unrelated campaign");
    await e.ensureEconomy();
    for (const p of rows) await e.savePurse(p);
  });
  await visit(dm.page, "/party");
  await dm.page.waitForTimeout(500);
  assert.equal(await dm.page.getByRole("link", { name: "Open sheet", exact: true }).count(), 0);
  await dm.page.evaluate(async () =>
    (await import("/src/lib/quire/campaigns.ts")).switchCampaign("main"),
  );
  await visit(dm.page, "/party");
  await card.getByText("27 / 40 HP", { exact: false }).waitFor();
  roomCode = await dm.page.evaluate(async () => {
    const c = await import("/src/lib/quire/cloud-client.ts"),
      a = await import("/src/lib/account/transfers.ts");
    await c.chooseTableMode("live");
    await a.linkCurrentCampaign();
    return c.getCloudTable().code;
  });
  await player.page.evaluate(
    async ({ code, purseId }) => {
      const c = await import("/src/lib/quire/cloud-client.ts"),
        a = await import("/src/lib/account/transfers.ts");
      await c.joinTable(code, purseId, "Sheet player");
      await a.linkCurrentCampaign();
    },
    { code: roomCode, purseId: purse.id },
  );
  const shared = await api(player, "sheets/save", {
    sheet: { ...ownSheet, name: "Shared sentinel", hp: 22 },
  });
  await api(player, "sheets/assign", {
    id: shared.id,
    code: roomCode,
    purseId: purse.id,
    revision: 0,
  });
  await visit(dm.page, "/party");
  await card.getByText("22 / 40 HP", { exact: false }).waitFor();
  await card.getByRole("link", { name: "Open sheet", exact: true }).click();
  await dm.page.getByRole("heading", { name: "Shared sentinel", exact: true }).waitFor();
  await dm.page.getByText("DM read-only view", { exact: true }).waitFor();
  await dm.page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  assert.equal(await dm.page.getByLabel("Current HP", { exact: true }).isEnabled(), false);
  await visit(dm.page, "/party");
  await card.getByText("22 / 40 HP", { exact: false }).waitFor();
  const revision = (
    await db.prepare("SELECT revision FROM campaign_rooms WHERE code=?").bind(roomCode).first()
  ).revision;
  await visit(player.page, `/characters?id=${shared.id}`);
  await player.page.getByRole("heading", { name: "Shared sentinel", exact: true }).waitFor();
  await player.page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  await player.page.getByLabel("Current HP", { exact: true }).fill("19");
  await player.page.getByRole("button", { name: "Save character", exact: true }).click();
  await player.page.getByText("Saved character", { exact: true }).waitFor();
  await dm.page.bringToFront();
  await card.getByText("19 / 40 HP", { exact: false }).waitFor();
  assert.equal(
    (await db.prepare("SELECT revision FROM campaign_rooms WHERE code=?").bind(roomCode).first())
      .revision,
    revision,
    "Sheet updates refresh without a financial-room revision",
  );
  await dm.page.screenshot({ path: output + "/linked-shared.png" });
  await visit(player.page, "/");
  await player.page.getByRole("heading", { name: "Shared sentinel", exact: true }).waitFor();
  await dm.page.setViewportSize({ width: 390, height: 844 });
  await visit(dm.page, "/party");
  await card.getByText("19 / 40 HP", { exact: false }).waitFor();
  assert.ok(await dm.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await dm.page.screenshot({ path: output + "/linked-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: local association/reload, exact party-to-sheet navigation, live HP refresh, scoped account/campaign references, unchanged finances, inventory routing, shared DM read-only access, correct player Home sheet and mobile fit.",
  );
} catch (error) {
  for (const page of pages)
    console.error(page.url(), (await page.locator("body").innerText()).slice(0, 3200));
  console.error(errors);
  throw error;
} finally {
  await browser.close();
  if (roomCode) await db.prepare("DELETE FROM campaign_rooms WHERE code=?").bind(roomCode).run();
  for (const user of users) await db.prepare("DELETE FROM user WHERE id=?").bind(user).run();
  db.close();
}
