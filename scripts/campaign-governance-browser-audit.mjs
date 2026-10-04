import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";
import { openApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(origin))
  throw Error("Governance audit requires a disposable local server.");
const output = "test-results/governance";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
});
const db = localAccountDb("data/account-dev.sqlite"),
  users = [],
  codes = [],
  errors = [];
const code = "G" + crypto.randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase();
codes.push(code);
async function actor(name, ip) {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 1000 },
    extraHTTPHeaders: { "cf-connecting-ip": ip },
  });
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const r = await context.request.post(origin + "/api/account/auth/sign-up/email", {
    headers: { origin },
    data: {
      email: `governance-${name}-${Date.now()}@example.test`,
      name,
      password: "disposable governance audit password",
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const id = (await r.json()).user.id;
  users.push(id);
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(e.message));
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
async function enabled(locator, wanted) {
  for (let n = 0; n < 80; n++) {
    if ((await locator.isEnabled()) === wanted) return;
    await locator.page().waitForTimeout(250);
  }
  assert.equal(await locator.isEnabled(), wanted);
}
async function save(page) {
  await page.getByRole("button", { name: "Save character", exact: true }).click();
  await page.getByText("Saved character", { exact: true }).waitFor();
}
try {
  const host = await actor("Owner", "192.0.2.211"),
    player = await actor("Player", "192.0.2.212");
  await db
    .prepare("INSERT INTO site_roles(user_id,role,granted_at) VALUES (?,'owner',?)")
    .bind(host.id, Date.now())
    .run();
  const sheet = { ...blankSheet(), name: "Governance hero", hp: 20, maxHp: 20, species: "Human" };
  const room = {
    code,
    revision: 1,
    live: true,
    turn: 0,
    seats: [
      { id: "dm", token: "host-token", name: "DM", role: "dm", purseIds: [] },
      { id: "player", token: "player-token", name: "Player", role: "player", purseIds: ["hero"] },
    ],
    seen: { gifts: [], sales: [] },
    table: {
      purses: [
        {
          id: "hero",
          name: sheet.name,
          kind: "character",
          coins: { cp: 0, sp: 0, ep: 0, gp: 50, pp: 0 },
          sheet,
        },
      ],
      holdings: [
        {
          id: "potion",
          purseId: "hero",
          name: "Potion",
          kind: "item",
          unitCopper: 5000,
          quantity: 2,
          notes: "",
          category: "apothecary",
        },
      ],
      shops: [],
      stock: [],
      ledger: [],
      listings: [],
      loans: [],
      sheets: [],
      notes: [],
      journal: {
        sessions: [
          {
            id: "audit-session",
            name: "Governance session",
            startedAt: Date.now(),
            startLedgerIds: [],
          },
        ],
        events: [],
        requests: [],
      },
    },
  };
  await db
    .prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,1,?)")
    .bind(code, JSON.stringify(room))
    .run();
  for (const [a, seatId, token] of [
    [host, "dm", "host-token"],
    [player, "player", "player-token"],
  ])
    await db
      .prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,?)")
      .bind(a.id, code, seatId, token, "Governance audit", Date.now())
      .run();
  for (const [a, seatId, token, role] of [
    [host, "dm", "host-token", "dm"],
    [player, "player", "player-token", "player"],
  ]) {
    await visit(a.page, "/party");
    await Promise.all([
      a.page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      a.page
        .evaluate(
          async (m) => (await import("/src/lib/quire/cloud-client.ts")).resumeAccountMembership(m),
          {
            userId: a.id,
            code,
            seatId,
            token,
            role,
            purseIds: role === "player" ? ["hero"] : [],
            name: "Governance audit",
          },
        )
        .catch((error) => {
          // Successful membership changes deliberately reload the document.
          // Require that navigation above; propagate every unrelated failure.
          if (!error.message.includes("Execution context was destroyed")) throw error;
        }),
    ]);
  }
  console.log("Governance audit: membership resumed; verify locked gameplay");
  await visit(player.page, "/characters?id=party%3Ahero");
  await player.page.getByRole("heading", { name: "Governance hero", exact: true }).waitFor();
  await player.page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  await player.page.getByRole("button", { name: "Character details", exact: true }).click();
  const species = player.page.getByLabel("Species", { exact: true });
  assert.equal(await species.isEnabled(), false);
  await player.page.getByRole("button", { name: "Combat", exact: true }).click();
  assert.equal(await player.page.getByLabel("Maximum HP", { exact: true }).isEnabled(), false);
  await player.page.getByLabel("Current HP", { exact: true }).fill("17");
  await save(player.page);
  await player.page.getByRole("button", { name: "Inventory & currency", exact: true }).click();
  await player.page.getByLabel("Equip Potion", { exact: true }).check();
  await player.page.getByLabel("Potion quantity", { exact: true }).fill("1");
  await save(player.page);
  assert.equal((await state(player.page)).holdings[0].quantity, 1);
  await visit(host.page, "/party");
  console.log("Governance audit: open/close editing and verify change report");
  await host.page.getByLabel("Allow character editing", { exact: true }).click();
  await player.page.getByRole("button", { name: "Character details", exact: true }).click();
  await enabled(species, true);
  await species.fill("Elf");
  await save(player.page);
  await host.page.getByLabel("Allow character editing", { exact: true }).click();
  await enabled(species, false);
  await host.page.screenshot({ path: output + "/party-desktop.png", fullPage: true });
  await visit(host.page, "/?view=overview#journal");
  const changes = host.page
    .locator(".loot-fold")
    .filter({ has: host.page.getByRole("button", { name: /^Character edit reports/ }) })
    .first();
  await changes.locator(":scope > div > button").first().click();
  await changes.getByText("Governance hero", { exact: false }).first().waitFor();
  await changes.locator("details > summary").click();
  await changes.getByText(/species.*Human.*Elf/).waitFor();
  const sessions = host.page.locator("#sessions");
  await sessions.locator(":scope > div > button").first().click();
  await sessions.getByRole("button", { name: "End session", exact: true }).click();
  for (let n = 0; n < 80 && !((await state(host.page)).journal.reports || []).length; n++)
    await host.page.waitForTimeout(250);
  assert.equal((await state(host.page)).journal.reports.length, 1);
  assert.equal((await state(host.page)).ledger.length, 0);
  await player.page.setViewportSize({ width: 390, height: 844 });
  await player.page.screenshot({ path: output + "/locked-player-mobile.png", fullPage: true });
  assert.equal(
    await player.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await visit(player.page, "/share");
  console.log("Governance audit: leave room and retain authorized reports");
  await player.page.getByRole("button", { name: "Leave room", exact: true }).click();
  await player.page
    .getByRole("dialog")
    .getByRole("button", { name: "Leave room", exact: true })
    .click();
  for (let n = 0; n < 80 && (await state(player.page)).purses.length; n++)
    await player.page.waitForTimeout(250);
  assert.equal((await state(player.page)).purses.length, 0);
  const records = await player.context.request.get(origin + "/api/account/records");
  assert.equal(records.status(), 200);
  assert.equal((await records.json()).reports.length, 1);
  await visit(host.page, "/settings");
  console.log("Governance audit: owner Test mode configuration and reset");
  const test = host.page
    .locator(".loot-fold")
    .filter({ has: host.page.getByRole("button", { name: /^Test mode/ }) })
    .first();
  await test.locator(":scope > div > button").first().click();
  await test.getByLabel("Characters", { exact: true }).fill("2");
  await Promise.all([
    host.page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    test.getByLabel("Enable Test mode", { exact: true }).click(),
  ]);
  await visit(host.page, "/");
  await host.page
    .getByRole("button", { name: "Reset Test mode — clear all data", exact: true })
    .waitFor();
  const testCode = await host.page.evaluate(
    async () => (await import("/src/lib/quire/cloud-client.ts")).getCloudTable().code,
  );
  codes.push(testCode);
  assert.notEqual(testCode, code);
  assert.equal((await state(host.page)).purses.length, 2);
  await host.page.evaluate(async () => {
    const e = await import("/src/lib/quire/economy.ts"),
      c = await import("/src/lib/quire/cloud-client.ts");
    const t = await e.economySnapshot();
    await c.queueCommand({
      kind: "buy",
      purseId: t.purses[0].id,
      stockId: "test-service",
      quantity: 1,
    });
  });
  assert.equal((await state(host.page)).ledger.length, 1);
  host.page.once("dialog", (d) => d.accept());
  await host.page
    .getByRole("button", { name: "Reset Test mode — clear all data", exact: true })
    .click();
  for (let n = 0; n < 80 && (await state(host.page)).ledger.length; n++)
    await host.page.waitForTimeout(250);
  assert.equal((await state(host.page)).ledger.length, 0);
  await host.page.setViewportSize({ width: 390, height: 844 });
  await host.page.screenshot({ path: output + "/test-mode-mobile.png", fullPage: true });
  assert.equal(
    await host.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile DM edit toggle and change report, locked construction, health/equip/consume gameplay, archival before clearing logs, voluntary leave, account reports, owner Test configurator/indicator/reset and isolated campaign data.",
  );
} finally {
  for (const code of codes)
    await db.prepare("DELETE FROM campaign_rooms WHERE code=?").bind(code).run();
  for (const user of users) await db.prepare("DELETE FROM user WHERE id=?").bind(user).run();
  db.close();
  await browser.close();
}
