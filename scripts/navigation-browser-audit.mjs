import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { tradeFixture } from "../src/lib/quire/test-fixtures/trade-economy.ts";
import { prepareTradeSeason, previewTradeSeason } from "../src/lib/quire/trade-economy.ts";
import { featureScreens } from "../src/lib/quire/feature-navigation.ts";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):/, "Disposable navigation fixtures only");
const output = "test-results/navigation";
await mkdir(output, { recursive: true });
const started = Date.now(),
  checks = [],
  errors = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
let current;

async function seed(page, table) {
  await page.evaluate(async (table) => {
    const active = localStorage.getItem("quire.campaign.v1") || "main";
    const name =
      JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((c) => c.id === active)
        ?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(
          ["purses", "holdings", "shops", "stock", "ledger", "meta"],
          "readwrite",
        );
        for (const store of ["purses", "holdings", "shops", "stock", "ledger"]) {
          tx.objectStore(store).clear();
          for (const row of table[store]) tx.objectStore(store).put(row);
        }
        tx.objectStore("meta").put({ id: "journal", value: table.journal });
        tx.objectStore("meta").put({ id: "settings", ...table.realm });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, table);
}

async function stillOpen(page) {
  assert.equal(await page.evaluate(() => window.navigationAuditDocument), "same-document");
  await expect(page.locator(".loot-opening")).toHaveCount(0);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "No horizontal overflow",
  );
}

async function destination(page, href, label) {
  const target = new URL(href, origin);
  await page.waitForURL(
    (url) =>
      url.pathname === target.pathname &&
      url.hash === target.hash &&
      [...target.searchParams].every(([key, value]) => url.searchParams.get(key) === value),
  );
  await expect(page.locator("main").first()).toBeVisible();
  if (target.pathname === "/maps") {
    const workspace = page.getByRole("region", { name: "Map workspace", exact: true });
    await expect(workspace).toBeVisible();
    const bounds = await workspace.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(
      bounds &&
        viewport &&
        Math.abs(bounds.width - viewport.width) <= 1 &&
        Math.abs(bounds.height - viewport.height) <= 1,
      "Maps fills the viewport after real navigation",
    );
  }
  if (target.pathname.startsWith("/features/")) {
    await expect(
      page.getByRole("heading", {
        name: featureScreens[target.pathname.split("/")[2]].title,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("This screen is available to the campaign DM.", { exact: true }),
    ).toHaveCount(0);
  }
  if (target.pathname === "/party" && target.searchParams.get("section") === "funds")
    await expect(page.locator("#party-panel-funds")).toBeVisible();
  if (target.pathname === "/share") {
    const tab =
      target.searchParams.get("chat") === "1"
        ? "Chat"
        : { room: "Room", chat: "Chat", rolls: "Rolls", notifications: "Alerts" }[
            target.searchParams.get("tab")
          ] || "Room";
    await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`) })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  if (target.pathname === "/catalog" && target.searchParams.has("pane")) {
    const name = { goods: "Items", open5e: "Open5e", names: "Names", book: "Book" }[
      target.searchParams.get("pane")
    ];
    await expect(
      page
        .getByRole("group", { name: "Catalog section", exact: true })
        .getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    if (target.searchParams.has("kind"))
      await expect(
        page.getByRole("combobox", { name: "Reference section", exact: true }),
      ).toHaveValue(target.searchParams.get("kind"));
  }
  if (target.hash && ["/account", "/settings", "/market", "/library"].includes(target.pathname))
    await expect(page.locator(target.hash)).toBeVisible();
  await stillOpen(page);
  checks.push({
    width: await page.evaluate(() => innerWidth),
    label,
    destination: target.pathname + target.search + target.hash,
  });
}

async function click(page, link, label) {
  const href = await link.getAttribute("href");
  assert.ok(href, label);
  await link.click();
  await destination(page, href, label);
}

async function back(page) {
  await page.goBack();
  await expect(page.locator(".settings-trigger")).toBeVisible();
  await stillOpen(page);
}

async function library(page, role) {
  await click(
    page,
    page
      .locator('nav[aria-label="Sections"]:visible')
      .getByRole("link", { name: "Library", exact: true }),
    `${role} Library`,
  );
  const links = await page
    .locator(".library-tiles a")
    .evaluateAll((links) =>
      links.map((link) => ({ href: link.getAttribute("href"), text: link.textContent.trim() })),
    );
  for (const item of links) {
    await click(
      page,
      page.locator(".library-tiles a").filter({ hasText: item.text }),
      `${role} Library: ${item.text}`,
    );
    await back(page);
  }
  await click(
    page,
    page
      .locator('nav[aria-label="Sections"]:visible')
      .getByRole("link", { name: role === "dm" ? "Desk" : "Home", exact: true }),
    `${role} Library return`,
  );
}

async function menus(page, role) {
  await page.locator(".settings-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Settings & Management", exact: true });
  const groups = await dialog.locator(".management-category").allTextContents();
  await page.keyboard.press("Escape");
  async function expand(name) {
    const category = dialog.getByRole("button", { name: name.trim(), exact: true });
    if ((await category.getAttribute("aria-expanded")) !== "true") await category.click();
  }
  for (const name of groups) {
    await page.locator(".settings-trigger").click();
    await expand(name);
    const labels = await dialog.locator(".management-content .settings-link").allTextContents();
    await page.keyboard.press("Escape");
    for (const text of labels) {
      await page.locator(".settings-trigger").click();
      await expand(name);
      const link = dialog
        .locator(".management-content .settings-link")
        .filter({ hasText: text.trim() });
      const href = await link.getAttribute("href");
      // Account administration remains role-gated; a member has no staff sections.
      if (href === "/account#account-administration") {
        await link.click();
        await page.waitForURL((url) => url.pathname === "/account");
        await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
        await expect(page.locator(".owner-controls, .staff-controls")).toHaveCount(0);
        await stillOpen(page);
        checks.push({ role, label: text.trim(), destination: href, restricted: true });
      } else await click(page, link, `${role} settings: ${text.trim()}`);
      await back(page);
    }
  }
}

try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      serviceWorkers: "block",
      extraHTTPHeaders: {
        "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`,
      },
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    current = page;
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await openApplication(page, origin);
    const table = tradeFixture();
    prepareTradeSeason(table, { source: "local", random: () => 50 });
    const economy = table.journal.tradeEconomy;
    const quote = previewTradeSeason(table, "navigation-season", 0);
    economy.history.push({
      id: quote.id,
      at: 1,
      day: 1,
      quote,
      appliedExchanges: structuredClone(quote.exchanges),
      realm: quote.realm,
      reason: "Synthetic approved season",
      source: "manual",
    });
    economy.epoch = 1;
    economy.exchanges[0].offers[0].askCopper = 130;
    economy.exchanges[0].offers[0].bidCopper = 80;
    await seed(page, table);
    await reloadApplication(page); // Deliberate fixture hydration, before navigation assertions.
    await page.evaluate(() => {
      window.navigationAuditDocument = "same-document";
    });
    await page
      .locator(".information-selectors")
      .getByRole("button", { name: "Market", exact: true })
      .click();
    const panel = page.getByRole("region", { name: "Market information", exact: true });
    await expect(panel).toContainText("Season 1");
    await expect(panel).toContainText("Automatic economy");
    await expect(panel).toContainText("City ·");
    await expect(panel).toContainText("Ask 1 gp, 3 sp");
    await expect(panel).toContainText("Bid 8 sp");
    await expect(panel).toContainText("+30.00% ask vs prior season");
    await panel.screenshot({ path: `${output}/market-${width}.png` });
    await click(
      page,
      panel.getByRole("link", { name: "Open global market →", exact: true }),
      "Global market readout",
    );
    await back(page);
    await page
      .locator(".information-selectors")
      .getByRole("button", { name: "Market", exact: true })
      .click();
    const quoteLink = panel.locator(".information-market-quotes a").first();
    const selected = new URL(await quoteLink.getAttribute("href"), origin);
    await click(page, quoteLink, "Exact commodity/exchange readout");
    await expect(page.locator(".commodity-detail:visible")).toContainText("Building timber");
    assert.equal(
      new URL(page.url()).searchParams.get("exchange"),
      selected.searchParams.get("exchange"),
    );
    await page.getByRole("link", { name: "Return to Desk", exact: true }).click();
    await stillOpen(page);
    // Reading global DM prices does not make wilderness trading available.
    table.journal.market.currentLocationId = "desert";
    await seed(page, table);
    await reloadApplication(page);
    await page.evaluate(() => {
      window.navigationAuditDocument = "same-document";
    });
    await page
      .locator(".information-selectors")
      .getByRole("button", { name: "Market", exact: true })
      .click();
    await expect(panel).toContainText("Closed here · visit a city");
    await expect(panel).toContainText("Ask 1 gp, 3 sp");
    await click(
      page,
      panel.getByRole("link", { name: "Open global market →", exact: true }),
      "Closed-location global market",
    );
    await expect(
      page.getByRole("region", { name: "Global market access", exact: true }),
    ).toContainText("Closed here");
    await back(page);
    table.journal.market.currentLocationId = "dock";
    await seed(page, table);
    await reloadApplication(page);
    await page.evaluate(() => {
      window.navigationAuditDocument = "same-document";
    });
    await menus(page, "dm");
    await page.locator(".settings-trigger").click();
    const management = page.getByRole("dialog", { name: "Settings & Management", exact: true });
    const dashboard = management.getByRole("button", { name: "Dashboard", exact: true });
    if ((await dashboard.getAttribute("aria-expanded")) !== "true") await dashboard.click();
    await management.getByRole("link", { name: "Saved shortcut settings →", exact: true }).click();
    await page.getByLabel("Button 1", { exact: true }).selectOption("character");
    await page.getByRole("button", { name: "Save shortcuts", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Customize shortcuts", exact: true }),
    ).toBeHidden();
    await click(
      page,
      page.locator(".shortcut-button").first(),
      "DM saved Character Sheet shortcut",
    );
    await expect(
      page.getByRole("heading", { name: "Character sheets", exact: true }),
    ).toBeVisible();
    await page
      .locator('nav[aria-label="Sections"]:visible')
      .getByRole("link", { name: "Desk", exact: true })
      .click();
    await stillOpen(page);
    // Every grouped DM feature entry, including disclosures.
    const groups = page.locator(".dm-tool-groups");
    await groups.getByRole("button", { name: /^Economy & properties/ }).click();
    const features = await groups.locator("a").allTextContents();
    for (const text of features) {
      const link = groups.getByRole("link", { name: text.trim(), exact: true });
      if (!(await link.isVisible()))
        await groups.getByRole("button", { name: /^Economy & properties/ }).click();
      await click(page, link, `DM tool: ${text.trim()}`);
      await page.getByRole("link", { name: /^Return to Desk/ }).click();
      await stillOpen(page);
    }
    await page.getByRole("button", { name: /^Campaign treasury/ }).click();
    for (const label of ["Recorded holdings", "Review requests", "Economy rules"]) {
      const link = page.getByRole("link").filter({ hasText: label }).first();
      await click(page, link, label);
      if (label === "Review requests")
        await expect(page.getByLabel("Payment account", { exact: true })).toHaveCount(0);
      if (label === "Economy rules")
        await expect(page.getByRole("slider", { name: /^Inflation amount / })).toBeVisible();
      await back(page);
      const treasury = page.getByRole("button", { name: /^Campaign treasury/ });
      if ((await treasury.getAttribute("aria-expanded")) !== "true") await treasury.click();
    }
    for (const label of ["Encounters", "Party", "Market", "Library", "Maps", "Desk"]) {
      const inMaps = new URL(page.url()).pathname === "/maps";
      if (inMaps)
        await page.getByRole("button", { name: "Map navigation menu", exact: true }).click();
      const nav = page.locator('nav[aria-label="Sections"]:visible');
      await click(
        page,
        nav.getByRole("link", { name: label, exact: true }),
        `DM primary: ${label}`,
      );
    }
    await library(page, "dm");
    // Runtime role presentation is scoped to synthetic owned device data. Shared
    // guest/ownership/turn permissions remain covered by the full account/mode suites.
    await page.evaluate(() => {
      const active = localStorage.getItem("quire.campaign.v1") || "main";
      localStorage.setItem(
        active === "main" ? "quire.seat.v1" : `quire.seat.v1.${active}`,
        JSON.stringify({ role: "player", purseIds: ["a"], shopIds: [], openedAt: Date.now() }),
      );
    });
    await reloadApplication(page);
    await page.evaluate(() => {
      window.navigationAuditDocument = "same-document";
    });
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    await expect(page.locator(".information-strip")).toHaveCount(0);
    const services = await page.locator(".shortcut-button").allTextContents();
    for (const label of services) {
      await click(
        page,
        page.getByRole("link", { name: label.trim(), exact: true }),
        `Player service: ${label.trim()}`,
      );
      await back(page);
    }
    await menus(page, "player");
    await library(page, "player");
    for (const role of ["player"]) {
      const nav = page.locator('nav[aria-label="Sections"]:visible');
      const labels = await nav.locator("a").allTextContents();
      for (const label of labels) {
        if (new URL(page.url()).pathname === "/maps")
          await click(
            page,
            page.getByRole("link", { name: "Back to Lootsplit", exact: true }),
            `${role} Maps return before desktop feature navigation`,
          );
        await click(
          page,
          nav.getByRole("link", { name: label.trim(), exact: true }),
          `${role} primary: ${label.trim()}`,
        );
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/checks.json`,
    JSON.stringify(
      {
        startedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        checks,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${checks.length} exact navigation actions, DM/player menus, feature returns, selected commodity quotes, same-document title preservation and desktop/mobile layouts.`,
  );
} catch (error) {
  if (current && !current.isClosed())
    await current.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify({ error: error.message, checks, errors }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
