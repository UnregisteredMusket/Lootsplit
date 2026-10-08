import { chromium } from "playwright";
import { expect } from "playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";
import { formatCopper, toCopper } from "../src/lib/quire/money.ts";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
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
const handoutText =
  "The map follows the old road beyond the gate.\n".repeat(250) + "Full handout final marker.";
codes.push(code);
async function blockExternal(context) {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
}
async function actor(name, ip) {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 1000 },
    extraHTTPHeaders: { "cf-connecting-ip": ip },
  });
  await blockExternal(context);
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
  await blockExternal(warmup.context());
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
        {
          id: "home-inn",
          purseId: "hero",
          name: "Player inn",
          kind: "property",
          quantity: 1,
          unitCopper: 20000,
          notes: "A small inn",
        },
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
      loans: [
        {
          id: "own-decided-application",
          at: 1,
          purseId: "hero",
          purseName: "Governance hero",
          copper: 20,
          note: "Original declined application",
          status: "denied",
        },
        {
          id: "other-decided-application",
          at: 1,
          purseId: "other-character",
          purseName: "Other character",
          copper: 30,
          note: "Another character's declined application",
          status: "denied",
        },
      ],
      sheets: [],
      notes: [],
      handouts: [
        { id: "governance-handout", title: "The complete campaign map", text: handoutText },
      ],
      journal: {
        finance: {
          day: 0,
          loans: [
            {
              id: "home-debt",
              name: "Bank test debt",
              purseId: "hero",
              lenderId: "",
              rateBps: 0,
              periodDays: 7,
              compound: false,
              payment: 0,
              principal: 100,
              interest: 0,
              due: 0,
              carryDays: 0,
              interestRemainder: 0,
              paid: 0,
            },
          ],
          rules: [
            {
              id: "home-income",
              name: "Inn revenue",
              purseId: "hero",
              kind: "income",
              copper: 20,
              periodDays: 7,
              holdingId: "home-inn",
              active: true,
              carryDays: 0,
              arrears: 0,
            },
          ],
          downtime: [],
        },
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
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await blockExternal(guestContext);
  await guestContext.addInitScript((code) => {
    localStorage.setItem("quire.guide.offer.v3", "seen");
    sessionStorage.setItem(
      "lootsplit.player.reconnect.v1",
      JSON.stringify({
        code,
        seatId: "guest",
        token: "guest-token",
        role: "player",
        purseIds: ["hero"],
      }),
    );
  }, code);
  const guestPage = await guestContext.newPage();
  guestPage.on("pageerror", (e) => errors.push(e.message));
  guestPage.guestAccessAudit = true;
  await openApplication(guestPage, origin + "/?as=player");
  await guestPage.getByRole("heading", { name: "Home", exact: true }).waitFor();
  await expect(
    guestPage.getByRole("region", { name: "Player features", exact: true }).getByRole("link"),
  ).toHaveText(["Character Sheet", "Bank", "My Finances", "Properties", "Journal", "Party chat"]);
  await expect(guestPage.locator('.shortcut-grid a[href^="/features/bank?"]')).toBeVisible();
  assert.equal(await guestPage.getByRole("button", { name: "Customize", exact: true }).count(), 0);
  assert.equal(
    await guestPage.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith("lootsplit.account-shortcuts")),
    ),
    false,
  );
  await guestPage
    .getByRole("region", { name: "Player features", exact: true })
    .getByRole("link", { name: "Party chat", exact: true })
    .click();
  await guestPage.locator("#chat-message").fill("Synthetic private guest message");
  await guestContext.route("**/_serverFn/**", (route) => route.abort("failed"));
  await guestPage.getByRole("button", { name: "Send", exact: true }).click();
  await guestPage.getByText("Failed — not confirmed", { exact: true }).waitFor();
  assert.equal(
    await guestPage.evaluate(() =>
      Object.entries(localStorage).some(
        ([key, value]) =>
          key.startsWith("lootsplit.chat.outbox.") ||
          value.includes("Synthetic private guest message"),
      ),
    ),
    false,
    "Guest failed messages remain in memory",
  );
  await guestContext.unroute("**/_serverFn/**");
  await guestPage.locator("#chat-message").fill("Retain this unsent guest draft");
  await guestPage.getByLabel("Conversation", { exact: true }).selectOption("dm");
  await guestPage.locator("#chat-message").fill("A separate private draft");
  await guestPage.getByLabel("Conversation", { exact: true }).selectOption("party");
  await expect(guestPage.locator("#chat-message")).toHaveValue("Retain this unsent guest draft");
  await guestPage
    .locator('nav[aria-label="Sections"]:visible')
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await guestPage
    .getByRole("region", { name: "Player features", exact: true })
    .getByRole("link", { name: "Party chat", exact: true })
    .click();
  await expect(guestPage.locator("#chat-message")).toHaveValue("Retain this unsent guest draft");
  await expect(guestPage.getByText("Failed — not confirmed", { exact: true })).toBeVisible();
  await guestPage.getByLabel("Conversation", { exact: true }).selectOption("dm");
  await expect(guestPage.locator("#chat-message")).toHaveValue("A separate private draft");
  await guestPage.screenshot({ path: output + "/guest-chat-memory-mobile.png", fullPage: true });
  await guestPage
    .locator('nav[aria-label="Sections"]:visible')
    .getByRole("link", { name: "Home", exact: true })
    .click();
  // The warning remains installed after Chat unmounts; closing a document would
  // lose its memory-only draft/outbox.
  assert.equal(
    await guestPage.evaluate(
      () => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ),
    true,
  );
  await guestPage.evaluate(() => (window.guestDraftDocument = "retained"));
  const closingWarning = guestPage.waitForEvent("dialog");
  // Chromium can leave the navigation waiter pending after cancelling a native
  // reload. Bound that expected blocked operation, then verify the old document.
  const cancelledReload = guestPage.reload({ timeout: 2000, waitUntil: "commit" }).then(
    () => "reloaded",
    (error) => error.message,
  );
  const warning = await closingWarning;
  assert.equal(warning.type(), "beforeunload");
  await warning.dismiss();
  assert.match(
    await cancelledReload,
    /ERR_ABORTED|Timeout/,
    "A cancelled native reload must not complete",
  );
  assert.equal(await guestPage.evaluate(() => window.guestDraftDocument), "retained");
  assert.equal(await guestPage.locator(".loot-opening").count(), 0);
  await guestPage
    .getByRole("region", { name: "Player features", exact: true })
    .getByRole("link", { name: "Bank", exact: true })
    .click();
  let blockedRepayments = 0;
  await guestContext.route("**/_serverFn/**", (route) => {
    if ((route.request().postData() || "").includes("bank-repay")) {
      blockedRepayments++;
      return route.abort("failed");
    }
    return route.continue();
  });
  await guestPage.getByLabel("Repayment in copper", { exact: true }).fill("1");
  await guestPage.getByRole("button", { name: "Make repayment", exact: true }).click();
  await expect.poll(() => blockedRepayments).toBe(1);
  await expect(guestPage.getByText(/Action accepted as pending/)).toBeVisible();
  await expect(guestPage.getByLabel("Repayment in copper", { exact: true })).toHaveValue("");
  const pendingGuest = await guestPage.evaluate(async () =>
    (await import("/src/lib/quire/cloud-client.ts")).pendingActions(),
  );
  assert.equal(pendingGuest.length, 1);
  assert.equal(pendingGuest[0].kind, "bank-repay");
  console.log(
    "Feature screens: player Home, bank repayment, property permissions and fixed feature buttons",
  );
  await player.page.setViewportSize({ width: 390, height: 844 });
  await visit(player.page, "/");
  await player.page.getByRole("heading", { name: "Home", exact: true }).waitFor();
  // Hold a local storage fault through background refreshes until Retry is tested.
  // A one-shot fault can be consumed by a concurrent campaign snapshot read.
  await player.page.evaluate(async () => {
    const db = await (await import("/src/lib/quire/db.ts")).quireDb();
    const prototype = Object.getPrototypeOf(db.transaction("meta").objectStore("meta"));
    const get = prototype.get;
    window.handoutReadFailures = 0;
    window.restoreHandoutReads = () => {
      prototype.get = get;
    };
    prototype.get = function (key) {
      if (
        this.name === "meta" &&
        key === "handouts" &&
        new Error().stack?.includes("loadHandouts")
      ) {
        window.handoutReadFailures++;
        throw Error("Synthetic handout read failure");
      }
      return get.call(this, key);
    };
  });
  await player.page
    .getByRole("region", { name: "Player features", exact: true })
    .getByRole("link", { name: "Character Sheet", exact: true })
    .click();
  const handouts = player.page.getByRole("region", { name: "Campaign handouts", exact: true });
  await expect(handouts.getByRole("alert")).toContainText("could not be loaded");
  assert.ok(
    await player.page.evaluate(() => window.handoutReadFailures > 0),
    "The storage fault must reach the actual handout reader",
  );
  await expect(handouts).not.toContainText("No handouts have been shared");
  await player.page.evaluate(() => window.restoreHandoutReads());
  await handouts.getByRole("button", { name: "Retry handouts", exact: true }).click();
  await expect(
    handouts.getByRole("button", {
      name: "Read full handout · The complete campaign map",
      exact: true,
    }),
  ).toBeVisible();
  await expect(handouts).not.toContainText("Full handout final marker.");
  await handouts.getByLabel("Search campaign handouts", { exact: true }).fill("final marker");
  await expect(handouts).toContainText("1 of 1 handouts");
  await handouts
    .getByRole("button", { name: "Read full handout · The complete campaign map", exact: true })
    .click();
  const handoutReader = player.page.getByRole("dialog", {
    name: "The complete campaign map",
    exact: true,
  });
  assert.equal(
    await handoutReader
      .getByRole("region", { name: "Full campaign handout", exact: true })
      .locator("p")
      .innerText(),
    handoutText,
  );
  await handoutReader
    .getByRole("button", { name: "Return to character sheet", exact: true })
    .click();
  await expect(handouts.getByLabel("Search campaign handouts", { exact: true })).toHaveValue(
    "final marker",
  );
  await handouts.getByRole("button", { name: "Read all handouts inline", exact: true }).click();
  await expect(handouts).toContainText("Full handout final marker.");
  await handouts.getByRole("button", { name: "Show handout index", exact: true }).click();
  await handouts
    .getByLabel("Search campaign handouts", { exact: true })
    .fill("does not occur in the map");
  await expect(handouts).toContainText("No handouts match.");
  await handouts.getByLabel("Search campaign handouts", { exact: true }).clear();
  await player.page
    .locator('nav[aria-label="Sections"]:visible')
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await player.page.evaluate(() => (window.featureDocumentMarker = "same-document"));
  await player.page.locator('.shortcut-grid a[href^="/features/bank?"]').click();
  const ownDecision = player.page.getByText("Original declined application", { exact: true });
  await expect(ownDecision).toBeVisible();
  await expect(
    player.page.getByText("Another character's declined application", { exact: true }),
  ).toHaveCount(0);
  await player.page.getByLabel("Financial request status", { exact: true }).selectOption("pending");
  await expect(ownDecision).toHaveCount(0);
  await player.page.getByLabel("Financial request status", { exact: true }).selectOption("decided");
  await player.page.getByLabel("Financial request type", { exact: true }).selectOption("loans");
  await player.page
    .getByLabel("Search financial requests", { exact: true })
    .fill("Original declined");
  await expect(ownDecision).toBeVisible();
  await player.page.getByRole("button", { name: "Clear request filters", exact: true }).click();
  await expect(player.page.getByLabel("Search financial requests", { exact: true })).toHaveValue(
    "",
  );
  await player.page.getByLabel("Loan amount", { exact: true }).fill("0 gp");
  await player.page
    .getByLabel("Loan reason", { exact: true })
    .fill("Keep this invalid application for correction");
  await player.page.getByRole("button", { name: "Request loan", exact: true }).click();
  await expect(
    player.page.getByRole("alert").filter({ hasText: "Enter a positive coin amount" }),
  ).toBeVisible();
  await expect(player.page.getByLabel("Loan amount", { exact: true })).toHaveValue("0 gp");
  await expect(player.page.getByLabel("Loan reason", { exact: true })).toHaveValue(
    "Keep this invalid application for correction",
  );
  await player.page.getByLabel("Loan amount", { exact: true }).fill("");
  await player.page.getByLabel("Loan reason", { exact: true }).fill("");
  await player.page.getByLabel("Repayment in copper", { exact: true }).fill("25");
  await player.page.getByRole("button", { name: "Make repayment", exact: true }).click();
  await expect
    .poll(async () => (await state(host.page)).journal.finance.loans[0].principal)
    .toBe(75);
  assert.equal(
    await player.page.getByLabel("Loan name", { exact: true }).count(),
    0,
    "Players cannot edit loan terms",
  );
  await player.page.getByRole("link", { name: "Return to Home", exact: true }).click();
  await player.page.locator('.shortcut-grid a[href^="/features/properties?"]').click();
  await player.page.getByLabel("Property name", { exact: true }).fill("Renamed player inn");
  await player.page.getByRole("button", { name: "Save property details", exact: true }).click();
  await expect
    .poll(async () => (await state(host.page)).holdings.find((h) => h.id === "home-inn").name)
    .toBe("Renamed player inn");
  assert.equal(
    (await state(host.page)).holdings.find((h) => h.id === "home-inn").unitCopper,
    20000,
  );
  assert.equal(await player.page.getByLabel("Property revenue (cp)", { exact: true }).count(), 0);
  await player.page.locator(".feature-return a").click();
  await player.page.locator('.shortcut-grid a[href^="/features/finances?"]').click();
  await player.page.getByText(/Inn revenue.*2 sp every 7 days/).waitFor();
  await player.page.screenshot({ path: output + "/player-finances-mobile.png", fullPage: true });
  await player.page.locator(".feature-return a").click();
  const playerFeatures = player.page.getByRole("region", { name: "Player features", exact: true });
  await expect(playerFeatures.getByRole("link")).toHaveText([
    "Character Sheet",
    "Bank",
    "My Finances",
    "Properties",
    "Journal",
    "Party chat",
  ]);
  assert.equal(
    await player.page.getByRole("button", { name: "Customize", exact: true }).count(),
    0,
  );
  assert.equal(
    await player.page.locator(".feature-cards").count(),
    0,
    "No duplicate player feature cards",
  );
  await playerFeatures.getByRole("link", { name: "Journal", exact: true }).click();
  await player.page.locator(".feature-return a").click();
  assert.equal(await player.page.evaluate(() => window.featureDocumentMarker), "same-document");
  assert.equal(await player.page.locator(".loot-opening").count(), 0);
  assert.ok(
    await player.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  );
  await player.page.screenshot({ path: output + "/player-home-mobile.png", fullPage: true });
  await player.page.setViewportSize({ width: 1360, height: 1000 });
  console.log("Governance audit: live account character receives loot and portrait without reload");
  await visit(player.page, `/characters?id=${encodeURIComponent(`campaign:${code}:hero`)}`);
  await player.page.getByRole("heading", { name: "Governance hero", exact: true }).waitFor();
  await player.page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  await player.page.getByRole("tab", { name: "Inventory & currency", exact: true }).click();
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
  await player.page.getByRole("tab", { name: "Character details", exact: true }).click();
  const species = player.page.getByLabel("Species", { exact: true });
  assert.equal(await species.isEnabled(), false);
  await player.page.getByRole("tab", { name: "Combat", exact: true }).click();
  assert.equal(await player.page.getByLabel("Maximum HP", { exact: true }).isEnabled(), false);
  await player.page.getByLabel("Current HP", { exact: true }).fill("17");
  await save(player.page);
  await player.page.getByRole("tab", { name: "Inventory & currency", exact: true }).click();
  await player.page.getByLabel("Equip Potion", { exact: true }).check();
  await player.page.getByLabel("Potion quantity", { exact: true }).fill("1");
  await save(player.page);
  assert.equal((await state(player.page)).holdings.find((h) => h.name === "Potion").quantity, 1);
  await visit(host.page, "/party");
  console.log("Governance audit: open/close editing and verify change report");
  await host.page.getByLabel("Allow character editing", { exact: true }).click();
  await player.page.getByRole("tab", { name: "Character details", exact: true }).click();
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
  await player.page.getByRole("tab", { name: "Combat", exact: true }).click();
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
  await visit(host.page, "/?view=overview");
  const sessions = host.page.locator("#sessions");
  await sessions.locator(":scope > div > button").first().click();
  await sessions.getByRole("button", { name: "End recorded session", exact: true }).click();
  for (let n = 0; n < 80 && !((await state(host.page)).journal.reports || []).length; n++)
    await host.page.waitForTimeout(250);
  assert.equal((await state(host.page)).journal.reports.length, 1);
  assert.equal((await state(host.page)).ledger.length, 0);
  await visit(host.page, "/features/journal");
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
  await visit(host.page, "/?view=overview");
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
  console.log("Governance audit: keep ended room viewable, leave as DM and resume");
  await visit(player.page, "/");
  await player.page
    .getByRole("region", { name: "Player features", exact: true })
    .getByRole("link", { name: "Properties", exact: true })
    .click();
  await player.page.getByLabel("Property name", { exact: true }).fill("Draft before session pause");
  await visit(host.page, "/share");
  await host.page.getByRole("button", { name: "End play & keep room online", exact: true }).click();
  await host.page
    .getByRole("alertdialog")
    .getByRole("button", { name: "End play & keep room online", exact: true })
    .click();
  await expect(
    host.page.getByRole("button", { name: "Leave room online", exact: true }),
  ).toBeVisible();
  await expect(
    host.page.getByRole("status").filter({
      hasText: /Live · Room online · Between sessions · players view only · Saved to room/,
    }),
  ).toBeVisible();
  await expect(
    player.page.getByRole("status").filter({ hasText: "Your draft is kept in this view" }),
  ).toBeVisible();
  await expect(player.page.getByLabel("Property name", { exact: true })).toHaveValue(
    "Draft before session pause",
  );
  await expect(player.page.getByLabel("Property name", { exact: true })).toBeDisabled();
  await expect(
    player.page.getByRole("button", { name: "Save property details", exact: true }),
  ).toBeDisabled();
  await expect(
    player.page.getByRole("status").filter({ hasText: "Your draft is kept in this view" }),
  ).toBeVisible();
  await player.page.screenshot({
    path: output + "/paused-property-draft-desktop.png",
    fullPage: true,
  });
  await player.page.getByRole("button", { name: "Reload details", exact: true }).click();
  await reloadApplication(player.page);
  await expect(
    player.page.getByRole("status").filter({ hasText: "Your draft is kept in this view" }),
  ).toBeVisible();
  assert.equal((await state(player.page)).purses.find((p) => p.id === "hero").sheet.maxHp, 25);
  const blocked = await player.page.evaluate(async () => {
    try {
      await (
        await import("/src/lib/quire/cloud-client.ts")
      ).queueCommand({ kind: "message", to: "party", purseId: "", text: "After session" });
      return "allowed";
    } catch (e) {
      return e.message;
    }
  });
  assert.match(blocked, /view-only/);
  await player.page.getByRole("link", { name: "Return to Home", exact: true }).click();
  await expect(
    player.page.getByRole("status").filter({
      hasText: /Live · Room online · Between sessions · players view only · Saved to room/,
    }),
  ).toBeVisible();
  const pausedHero = (await state(player.page)).purses.find((p) => p.id === "hero");
  await expect(
    player.page.getByText(`HP 17/25 · AC 10 · ${formatCopper(toCopper(pausedHero.coins))}`, {
      exact: true,
    }),
  ).toBeVisible();
  await player.page
    .getByRole("region", { name: "Player features", exact: true })
    .getByRole("link", { name: "Party chat", exact: true })
    .click();
  await expect(player.page.locator("#chat-message")).toBeDisabled();
  await expect(player.page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect(
    player.page.getByRole("status").filter({ hasText: "View-only until the DM resumes play" }),
  ).toBeVisible();
  await player.page.screenshot({ path: output + "/paused-chat-desktop.png", fullPage: true });
  await host.page.setViewportSize({ width: 390, height: 844 });
  await host.page.screenshot({ path: output + "/viewable-room-mobile.png", fullPage: true });
  await host.page.getByRole("button", { name: "Leave room online", exact: true }).click();
  await expect(host.page.getByRole("button", { name: "Start a room", exact: true })).toBeVisible();
  await expect(
    player.page.getByRole("status").filter({ hasText: "View-only until the DM resumes play" }),
  ).toBeVisible();
  await openApplication(host.page, origin + "/account");
  await host.page.getByRole("button", { name: "Open for viewing", exact: true }).first().click();
  await host.page.locator(".role-chip:enabled").waitFor();
  await visit(host.page, "/share");
  await host.page.getByRole("button", { name: "Resume play", exact: true }).click();
  await expect(
    player.page.getByRole("status").filter({ hasText: "View-only until the DM resumes play" }),
  ).toHaveCount(0);
  await expect(player.page.locator("#chat-message")).toBeEnabled();
  await player.page.locator("#chat-message").fill("Play resumed");
  await expect(player.page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await player.page.locator("#chat-message").fill("Account message awaiting confirmation");
  await player.context.route("**/_serverFn/**", (route) => route.abort("failed"));
  await player.page.getByRole("button", { name: "Send", exact: true }).click();
  await player.page.getByText("Failed — not confirmed", { exact: true }).waitFor();
  const savedOutbox = await player.page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) => key.startsWith("lootsplit.chat.outbox.v2.")),
  );
  assert.equal(savedOutbox.length, 1);
  assert.ok(
    decodeURIComponent(savedOutbox[0][0]).includes(player.id),
    "Persistent outbox is verified-account scoped",
  );
  const savedCommand = JSON.parse(savedOutbox[0][1])[0].command;
  assert.equal(savedCommand.text, "Account message awaiting confirmation");
  await player.context.unroute("**/_serverFn/**");
  await reloadApplication(player.page);
  await player.page.getByText("Failed — not confirmed", { exact: true }).waitFor();
  await player.page
    .getByRole("region", { name: "Live party chat", exact: true })
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(player.page.getByText("Failed — not confirmed", { exact: true })).toHaveCount(0);
  await expect
    .poll(async () => (await state(host.page)).notes.filter((n) => n.id === savedCommand.id).length)
    .toBe(1);
  // A real storage failure must leave a visible, exportable copy with the same
  // request ID; successful persistence is not a prerequisite for guest-like
  // memory recovery or delivery.
  await player.page.evaluate(() => {
    window.originalChatSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("lootsplit.chat.outbox.v2."))
        throw new DOMException("Synthetic full storage", "QuotaExceededError");
      return window.originalChatSetItem.call(this, key, value);
    };
  });
  await player.context.route("**/_serverFn/**", (route) => route.abort("failed"));
  await player.page.locator("#chat-message").fill("Account memory fallback message");
  await player.page.getByRole("button", { name: "Send", exact: true }).click();
  await player.page.getByText("Failed — not confirmed", { exact: true }).waitFor();
  await expect(
    player.page
      .getByRole("status")
      .filter({ hasText: "Could not save message recovery on this device" }),
  ).toBeVisible();
  const fallbackDownload = player.page.waitForEvent("download");
  await player.page.getByRole("button", { name: "Export unsent chat", exact: true }).click();
  const fallbackFile = output + "/account-chat-storage-failure.json";
  await (await fallbackDownload).saveAs(fallbackFile);
  const fallbackRecovery = JSON.parse(await readFile(fallbackFile, "utf8"));
  assert.equal(fallbackRecovery.commands.length, 1);
  assert.equal(fallbackRecovery.commands[0].text, "Account memory fallback message");
  assert.equal("token" in fallbackRecovery, false);
  await player.page.evaluate(() => {
    Storage.prototype.setItem = window.originalChatSetItem;
    delete window.originalChatSetItem;
  });
  await player.context.unroute("**/_serverFn/**");
  await player.page
    .getByRole("region", { name: "Live party chat", exact: true })
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(player.page.getByText("Failed — not confirmed", { exact: true })).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await state(host.page)).notes.filter((n) => n.id === fallbackRecovery.commands[0].id)
          .length,
    )
    .toBe(1);
  // Preserve another confirmed-account failure through departure, room closure,
  // and a fresh document. It must remain recoverable without room credentials.
  await player.context.route("**/_serverFn/**", (route) => route.abort("failed"));
  await player.page.locator("#chat-message").fill("Account closed-room recovery message");
  await player.page.getByRole("button", { name: "Send", exact: true }).click();
  await player.page.getByText("Failed — not confirmed", { exact: true }).waitFor();
  const closedOutbox = await player.page.evaluate(() =>
    Object.entries(localStorage).find(
      ([key, value]) =>
        key.startsWith("lootsplit.chat.outbox.v2.") &&
        value.includes("Account closed-room recovery message"),
    ),
  );
  assert.ok(closedOutbox);
  const closedCommand = JSON.parse(closedOutbox[1])[0].command;
  await player.context.unroute("**/_serverFn/**");
  await player.page
    .locator('nav[aria-label="Sections"]:visible')
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await visit(player.page, "/share");
  await host.page.setViewportSize({ width: 1360, height: 1000 });
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
  assert.equal((await records.json()).reports.length, 2);
  // Close through the actual DM control after all primary campaign assertions.
  // The guest's failed command was never staged/committed on the server.
  await visit(host.page, "/share");
  await host.page.getByRole("button", { name: "Close room & revoke access", exact: true }).click();
  await host.page
    .getByRole("alertdialog", { name: "Close room and revoke player access?", exact: true })
    .getByRole("button", { name: "Close room & revoke access", exact: true })
    .click();
  await guestPage.getByRole("button", { name: "Export unsent recovery", exact: true }).waitFor();
  await guestPage.screenshot({
    path: output + "/revoked-guest-actions-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await guestPage.evaluate(() => sessionStorage.getItem("lootsplit.player.reconnect.v1")),
    null,
  );
  const actionDownload = guestPage.waitForEvent("download");
  await guestPage.getByRole("button", { name: "Export unsent recovery", exact: true }).click();
  const actionFile = output + "/revoked-guest-action.json";
  await (await actionDownload).saveAs(actionFile);
  const actionRecovery = JSON.parse(await readFile(actionFile, "utf8"));
  assert.equal(actionRecovery.commands[0].id, pendingGuest[0].id);
  assert.equal(actionRecovery.commands[0].kind, "bank-repay");
  assert.equal("token" in actionRecovery, false);
  await guestPage.getByRole("button", { name: "Discard recovery copy", exact: true }).click();
  await guestPage
    .getByRole("alertdialog", { name: "Discard unsent recovery?", exact: true })
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  await expect(
    guestPage.getByRole("button", { name: "Export unsent recovery", exact: true }),
  ).toHaveCount(0);
  await guestPage
    .locator('nav[aria-label="Sections"]:visible')
    .getByRole("link", { name: "Campaign", exact: true })
    .click();
  await guestPage.getByRole("tab", { name: "Chat", exact: true }).click();
  await guestPage.getByRole("button", { name: "Export chat recovery", exact: true }).waitFor();
  await guestPage.screenshot({ path: output + "/revoked-guest-chat-mobile.png", fullPage: true });
  const chatDownload = guestPage.waitForEvent("download");
  await guestPage.getByRole("button", { name: "Export chat recovery", exact: true }).click();
  const chatFile = output + "/revoked-guest-chat.json";
  await (await chatDownload).saveAs(chatFile);
  const chatRecovery = JSON.parse(await readFile(chatFile, "utf8"));
  assert.equal(chatRecovery.commands[0].text, "Synthetic private guest message");
  assert.equal(chatRecovery.drafts.party, "Retain this unsent guest draft");
  assert.equal(chatRecovery.drafts.dm, "A separate private draft");
  assert.equal("token" in chatRecovery, false);
  assert.equal(
    await guestPage.evaluate(() =>
      Object.values(localStorage).some(
        (v) =>
          v.includes("Synthetic private guest message") ||
          v.includes("Retain this unsent guest draft") ||
          v.includes("A separate private draft"),
      ),
    ),
    false,
  );
  await guestPage.getByRole("button", { name: "Discard chat recovery", exact: true }).click();
  await guestPage
    .getByRole("alertdialog", { name: "Discard unsent chat recovery?", exact: true })
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  await expect(
    guestPage.getByRole("region", { name: "Unsent chat recovery", exact: true }),
  ).toHaveCount(0);
  await guestContext.close();
  await reloadApplication(player.page);
  await player.page.getByRole("tab", { name: "Chat", exact: true }).click();
  await player.page.getByRole("button", { name: "Export chat recovery", exact: true }).waitFor();
  const closedDownload = player.page.waitForEvent("download");
  await player.page.getByRole("button", { name: "Export chat recovery", exact: true }).click();
  const closedFile = output + "/account-chat-closed-room.json";
  await (await closedDownload).saveAs(closedFile);
  const closedRecovery = JSON.parse(await readFile(closedFile, "utf8"));
  assert.equal(closedRecovery.commands[0].id, closedCommand.id);
  assert.equal(closedRecovery.commands[0].text, "Account closed-room recovery message");
  assert.equal("token" in closedRecovery, false);
  await player.page.screenshot({
    path: output + "/account-chat-closed-room-mobile.png",
    fullPage: true,
  });
  await player.page.getByRole("button", { name: "Discard chat recovery", exact: true }).click();
  await player.page
    .getByRole("alertdialog", { name: "Discard unsent chat recovery?", exact: true })
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  assert.equal(
    await player.page.evaluate((key) => localStorage.getItem(key), closedOutbox[0]),
    null,
  );
  await reloadApplication(player.page);
  await player.page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(
    player.page.getByRole("button", { name: "Export chat recovery", exact: true }),
  ).toHaveCount(0);
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
    "PASS: guest Home without preferences, account player Home/repayment/property permissions/fixed buttons, desktop/mobile DM edit toggle and change report, locked construction, health/equip/consume gameplay, archival before clearing logs, voluntary leave, account reports, owner Test configurator/indicator/reset and isolated campaign data.",
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
