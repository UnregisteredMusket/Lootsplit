import { chromium } from "playwright";
import { expect } from "playwright/test";
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
  // Stabilize Vite's first dependency discovery before collecting application errors.
  const warmup = await browser.newPage();
  await openApplication(warmup, origin + "/settings#appearance");
  await warmup.getByLabel("Accent color", { exact: true }).waitFor();
  await warmup.waitForLoadState("networkidle");
  await warmup.close();
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
      { id: "guest", token: "guest-token", name: "Guest", role: "player", purseIds: ["hero"] },
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
        {id:"home-inn",purseId:"hero",name:"Player inn",kind:"property",quantity:1,unitCopper:20000,notes:"A small inn"},
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
        finance:{day:0,loans:[{id:"home-debt",name:"Bank test debt",purseId:"hero",lenderId:"",rateBps:0,periodDays:7,compound:false,payment:0,principal:100,interest:0,due:0,carryDays:0,interestRemainder:0,paid:0}],rules:[{id:"home-income",name:"Inn revenue",purseId:"hero",kind:"income",copper:20,periodDays:7,holdingId:"home-inn",active:true,carryDays:0,arrears:0}],downtime:[]},
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
    // DOMContentLoaded precedes the async client entry. Let the new document
    // hydrate before a later visit can cancel its module request.
    await a.page.locator(".role-chip:enabled").waitFor();
    await a.page.locator(".quire-dawn").waitFor({ state: "hidden" });
    await a.page.waitForLoadState("networkidle");
  }
  const guestContext=await browser.newContext({viewport:{width:390,height:844}});
  await guestContext.addInitScript(()=>localStorage.setItem("quire.guide.offer.v3","seen"));
  const guestPage=await guestContext.newPage();
  guestPage.guestAccessAudit=true;
  await openApplication(guestPage,origin+"/?as=player");
  await Promise.all([
    guestPage.waitForNavigation({waitUntil:"domcontentloaded"}),
    guestPage.evaluate(async code=>(await import("/src/lib/quire/cloud-client.ts")).resumeAccountMembership({userId:"",code,seatId:"guest",token:"guest-token",role:"player",purseIds:["hero"],name:"Guest feature fixture"}),code).catch(e=>{if(!e.message.includes("Execution context was destroyed"))throw e;})
  ]);
  await guestPage.getByRole("heading",{name:"Home",exact:true}).waitFor();
  await expect(guestPage.locator('.feature-cards a[href^="/features/bank?"]')).toBeVisible();
  assert.equal(await guestPage.getByRole("button",{name:"Customize",exact:true}).count(),0);
  assert.equal(await guestPage.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith("lootsplit.account-shortcuts"))),false);
  await guestContext.close();
  console.log("Feature screens: player Home, bank repayment, property permissions and account shortcuts");
  await player.page.setViewportSize({width:390,height:844});
  await visit(player.page,"/");
  await player.page.getByRole("heading",{name:"Home",exact:true}).waitFor();
  await player.page.evaluate(()=>window.featureDocumentMarker="same-document");
  await player.page.locator('.feature-cards a[href^="/features/bank?"]').click();
  await player.page.getByLabel("Repayment in copper",{exact:true}).fill("25");
  await player.page.getByRole("button",{name:"Make repayment",exact:true}).click();
  await expect.poll(async()=> (await state(host.page)).journal.finance.loans[0].principal).toBe(75);
  assert.equal(await player.page.getByLabel("Loan name",{exact:true}).count(),0,"Players cannot edit loan terms");
  await player.page.getByRole("link",{name:"Return to Home",exact:true}).click();
  await player.page.locator('.feature-cards a[href^="/features/properties?"]').click();
  await player.page.getByLabel("Property name",{exact:true}).fill("Renamed player inn");
  await player.page.getByRole("button",{name:"Save property details",exact:true}).click();
  await expect.poll(async()=> (await state(host.page)).holdings.find(h=>h.id==="home-inn").name).toBe("Renamed player inn");
  assert.equal((await state(host.page)).holdings.find(h=>h.id==="home-inn").unitCopper,20000);
  assert.equal(await player.page.getByLabel("Property revenue (cp)",{exact:true}).count(),0);
  await player.page.locator(".feature-return a").click();
  await player.page.locator('.feature-cards a[href^="/features/finances?"]').click();
  await player.page.getByText(/Inn revenue.*2 sp every 7 days/).waitFor();
  await player.page.screenshot({path:output+"/player-finances-mobile.png",fullPage:true});
  await player.page.locator(".feature-return a").click();
  await player.page.getByRole("button",{name:"Customize",exact:true}).click();
  await player.page.getByLabel("Button 1",{exact:true}).selectOption("bank");
  await player.page.getByLabel("Label",{exact:true}).first().fill("Personal bank");
  await player.page.getByRole("button",{name:"Save shortcuts",exact:true}).click();
  await expect(player.page.locator(".shortcut-button").first()).toContainText("Personal bank");
  const second=await browser.newContext({storageState:await player.context.storageState(),extraHTTPHeaders:{"cf-connecting-ip":"192.0.2.215"}});
  const read=await second.request.get(origin+"/api/account/shortcuts?role=player");
  assert.equal((await read.json()).items[0].label,"Personal bank","Another signed-in browser receives account shortcuts");
  await second.close();
  assert.equal(await player.page.evaluate(()=>window.featureDocumentMarker),"same-document");
  assert.equal(await player.page.locator(".loot-opening").count(),0);
  assert.ok(await player.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await player.page.screenshot({path:output+"/player-home-mobile.png",fullPage:true});
  await player.page.setViewportSize({width:1360,height:1000});
  console.log("Governance audit: live account character receives loot and portrait without reload");
  await visit(player.page, `/characters?id=${encodeURIComponent(`campaign:${code}:hero`)}`);
  await player.page.getByRole("heading", { name: "Governance hero", exact: true }).waitFor();
  await player.page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  await player.page.getByRole("button", { name: "Inventory & currency", exact: true }).click();
  await visit(host.page, "/party");
  await host.page
    .getByRole("button", { name: "Add characters, party funds & loot", exact: true })
    .click();
  await host.page.getByRole("button", { name: /^Add loot/ }).click();
  await host.page.getByLabel("Holding name", { exact: true }).fill("Live award shield");
  await host.page.getByLabel("Holding value", { exact: true }).fill("10 gp");
  await host.page.getByLabel("Holding owner", { exact: true }).selectOption("hero");
  await host.page.getByRole("button", { name: "Add holding", exact: true }).click();
  await expect(player.page.locator('input[value="Live award shield"]')).toBeVisible({
    timeout: 10000,
  });

  await host.page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await host.page.locator("#purse-hero > summary").click();
  const secondDevice = await browser.newContext({
    storageState: { cookies: await player.context.cookies(), origins: [] },
    viewport: { width: 390, height: 844 },
  });
  await secondDevice.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const secondPage = await secondDevice.newPage();
  await visit(secondPage, `/characters?id=${encodeURIComponent(`campaign:${code}:hero`)}`);
  await secondPage.getByRole("heading", { name: "Governance hero", exact: true }).waitFor();
  const portrait = host.page.locator("#purse-hero .portrait-picker input[type=file]");
  // A tiny synthetic PNG, never a real campaign portrait.
  const picture = await host.page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const x = c.getContext("2d");
    x.fillStyle = "red";
    x.fillRect(0, 0, 8, 8);
    return c.toDataURL("image/png").split(",")[1];
  });
  await portrait.setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: Buffer.from(picture, "base64"),
  });
  await expect(
    host.page.locator("[data-sonner-toast]").filter({ hasText: "Portrait saved" }),
  ).toBeVisible();
  await expect(player.page.getByAltText("Character portrait", { exact: true })).toHaveAttribute(
    "src",
    /^data:image/,
    { timeout: 10000 },
  );
  await expect(secondPage.getByAltText("Character portrait", { exact: true })).toHaveAttribute(
    "src",
    /^data:image/,
    { timeout: 15000 },
  );
  await secondDevice.close();
  await host.page.getByRole("link", { name: "Open character sheet", exact: true }).click();
  await expect(
    host.page.locator("[data-sonner-toast]").filter({ hasText: "Portrait saved" }),
  ).toHaveCount(0);

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
  assert.equal((await state(player.page)).holdings.find((h) => h.name === "Potion").quantity, 1);
  await visit(host.page, "/party");
  console.log("Governance audit: open/close editing and verify change report");
  await host.page.getByLabel("Allow character editing", { exact: true }).click();
  await player.page.getByRole("button", { name: "Character details", exact: true }).click();
  await enabled(species, true);
  await species.fill("Elf");
  await save(player.page);
  await host.page.getByLabel("Allow character editing", { exact: true }).click();
  await enabled(species, false);
  console.log("Governance audit: independent immediate permission grant");
  await host.page.locator(".settings-trigger").click();
  const permissionsMenu = host.page.getByRole("dialog", { name: "Settings & Management" });
  await permissionsMenu.getByRole("button", { name: /^Players & permissions/ }).click();
  await permissionsMenu
    .getByText("Governance hero · Individual permissions", { exact: true })
    .click();
  const maxPermission = permissionsMenu.getByLabel("Governance hero: Maximum HP", { exact: true });
  await maxPermission.click();
  await expect(maxPermission).toBeChecked();
  await player.page.getByRole("button", { name: "Combat", exact: true }).click();
  await enabled(player.page.getByLabel("Maximum HP", { exact: true }), true);
  assert.equal(await player.page.getByLabel("Armor class", { exact: true }).isEnabled(), false);
  await player.page.getByLabel("Maximum HP", { exact: true }).fill("25");
  await save(player.page);
  await expect
    .poll(async () => (await state(host.page)).purses.find((p) => p.id === "hero").sheet.maxHp)
    .toBe(25);
  await maxPermission.click();
  await expect(maxPermission).not.toBeChecked();
  await enabled(player.page.getByLabel("Maximum HP", { exact: true }), false);
  await permissionsMenu.getByRole("button", { name: "Close", exact: true }).click();
  await host.page.screenshot({ path: output + "/party-desktop.png", fullPage: true });
  await visit(host.page, "/features/reports");
  const changes = host.page
    .locator(".loot-fold")
    .filter({ has: host.page.getByRole("button", { name: /^Character edit reports/ }) })
    .first();
  await changes.locator(":scope > div > button").first().click();
  await changes.getByText("Governance hero", { exact: false }).first().waitFor();
  await changes.locator("details > summary").click();
  await changes.getByText(/species.*Human.*Elf/).waitFor();
  await visit(host.page,"/?view=overview");
  const sessions = host.page.locator("#sessions");
  await sessions.locator(":scope > div > button").first().click();
  await sessions.getByRole("button", { name: "End session", exact: true }).click();
  for (let n = 0; n < 80 && !((await state(host.page)).journal.reports || []).length; n++)
    await host.page.waitForTimeout(250);
  assert.equal((await state(host.page)).journal.reports.length, 1);
  assert.equal((await state(host.page)).ledger.length, 0);
  await visit(host.page,"/features/journal");
  await host.page.getByLabel("Journal entry title", { exact: true }).fill("The first chronicle");
  await host.page
    .getByLabel("Journal entry text", { exact: true })
    .fill("We found the ancient gate. The party will return at dawn.");
  await host.page.getByLabel("Journal visibility", { exact: true }).selectOption("party");
  await host.page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(host.page.locator(".journal-reading")).toContainText("ancient gate");
  await host.page.locator(".journal-book").screenshot({ path: output + "/journal-desktop.png" });
  await host.page.setViewportSize({ width: 390, height: 844 });
  await host.page.locator(".journal-book").screenshot({ path: output + "/journal-mobile.png" });
  await host.page.setViewportSize({ width: 1360, height: 1000 });
  await visit(host.page,"/?view=overview");
  await sessions.locator(":scope > div > button").first().click();
  await sessions.getByLabel("Session name", { exact: true }).fill("Next session");
  await sessions.getByRole("button", { name: "Start session", exact: true }).click();
  const downtimeDialog = host.page.getByRole("dialog", {
    name: "Set downtime before this session",
  });
  await expect(downtimeDialog).toBeVisible();
  await downtimeDialog.getByLabel("Downtime days", { exact: true }).fill("0");
  await downtimeDialog
    .getByRole("button", { name: "Use 0 days & start session", exact: true })
    .click();
  await expect(downtimeDialog).toBeHidden();
  await expect
    .poll(async () => (await state(host.page)).journal.downtimePrompt?.enabled)
    .toBe(false);
  await player.page.setViewportSize({ width: 390, height: 844 });
  await player.page.screenshot({ path: output + "/locked-player-mobile.png", fullPage: true });
  assert.equal(
    await player.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await visit(player.page, "/share");
  const [memberLibrary] = await Promise.all([
    player.page.waitForResponse(
      (response) => response.url().endsWith("/api/account/library") && response.ok(),
    ),
    player.page.locator(".settings-trigger").click(),
  ]);
  assert.equal((await memberLibrary.json()).user.role, "member");
  await player.page.getByRole("dialog").waitFor();
  await player.page.waitForLoadState("networkidle");
  assert.equal(
    await player.page
      .getByRole("dialog")
      .getByRole("button", { name: /^Test mode/ })
      .count(),
    0,
  );
  await player.page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  console.log("Governance audit: leave room and retain authorized reports");
  await player.page.getByRole("button", { name: "Leave room", exact: true }).click();
  await player.page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Leave room", exact: true })
    .click();
  for (let n = 0; n < 80 && (await state(player.page)).purses.length; n++)
    await player.page.waitForTimeout(250);
  assert.equal((await state(player.page)).purses.length, 0);
  const records = await player.context.request.get(origin + "/api/account/records");
  assert.equal(records.status(), 200);
  assert.equal((await records.json()).reports.length, 1);
  // Test controls belong inside the bottom of the actual gear menu on mobile.
  await host.page.setViewportSize({ width: 390, height: 844 });
  const menuUrl = host.page.url();
  await host.page.locator(".settings-trigger").click();
  const menu = host.page.getByRole("dialog", { name: "Settings & Management" });
  await menu.getByRole("button", { name: /^Test mode/ }).click();
  assert.equal(await host.page.locator(".loot-opening").count(), 0);
  assert.equal(host.page.url(), menuUrl);
  console.log("Governance audit: owner Test mode configuration and reset");
  const test = menu
    .locator(".loot-fold")
    .filter({ has: host.page.getByRole("button", { name: /^Test mode/ }) })
    .first();
  await test.getByLabel("Characters", { exact: true }).waitFor();
  assert.equal(
    await menu
      .locator(".management-panel > :last-child")
      .getByLabel("Enable Test mode", { exact: true })
      .count(),
    1,
  );
  assert.equal(
    await menu.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
    false,
  );
  await test.scrollIntoViewIfNeeded();
  await host.page.screenshot({ path: output + "/test-settings-menu-mobile.png", fullPage: true });
  await host.page.setViewportSize({ width: 1360, height: 1000 });
  await test.scrollIntoViewIfNeeded();
  await host.page.screenshot({ path: output + "/test-settings-menu-desktop.png", fullPage: true });
  await test.getByLabel("Characters", { exact: true }).fill("2");
  await Promise.all([
    host.page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    test.getByLabel("Enable Test mode", { exact: true }).click(),
  ]);
  await host.page.locator(".role-chip:enabled").waitFor();
  await host.page.locator(".quire-dawn").waitFor({ state: "hidden" });
  await host.page.waitForLoadState("networkidle");
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
  await host.page.locator(".settings-trigger").click();
  const activeMenu = host.page.getByRole("dialog", { name: "Settings & Management" });
  await activeMenu.getByRole("button", { name: /^Test mode/ }).click();
  const activeToggle = activeMenu.getByLabel("Enable Test mode", { exact: true });
  await activeToggle.waitFor();
  assert.equal(await activeToggle.isChecked(), true);
  await activeToggle.scrollIntoViewIfNeeded();
  await host.page.screenshot({ path: output + "/test-menu-mobile.png", fullPage: true });
  assert.equal(await host.page.locator(".loot-opening").count(), 0);
  assert.equal(
    await host.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: guest Home without preferences, account player Home/repayment/property permissions/shortcuts, desktop/mobile DM edit toggle and change report, locked construction, health/equip/consume gameplay, archival before clearing logs, voluntary leave, account reports, owner Test configurator/indicator/reset and isolated campaign data.",
  );
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages())
      console.error(
        "Synthetic sync diagnostic",
        await page
          .evaluate(async () => {
            const x = (await import("/src/lib/quire/cloud-client.ts")).getCloudTable();
            return { status: x.status, error: x.error, pending: x.pending };
          })
          .catch(() => null),
      );
  for (const [index, context] of browser.contexts().entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      await page
        .screenshot({ path: `${output}/failure-${index}-${pageIndex}.png`, fullPage: true })
        .catch(() => {});
    }
  }
  throw error;
} finally {
  for (const code of codes)
    await db.prepare("DELETE FROM campaign_rooms WHERE code=?").bind(code).run();
  for (const user of users) await db.prepare("DELETE FROM user WHERE id=?").bind(user).run();
  db.close();
  await browser.close();
}
