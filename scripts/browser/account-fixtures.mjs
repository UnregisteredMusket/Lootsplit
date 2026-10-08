import { test as base, expect } from "playwright/test";
import { randomUUID } from "node:crypto";
import {
  openApplication,
  prepareDmFixture,
} from "../title-screen-navigation.mjs";
import { accountScenarios, externalAuditRequests } from "../account-scenarios.mjs";

export { expect };
export const test = base.extend({
  devices: async ({ context, page, browser, baseURL }, runFixture, testInfo) => {
    const contexts = [context];
    // A catch-all route forces every development module through a Node callback
    // during each account context reload. Match external URLs in the browser
    // instead, retaining the exact-origin boundary and blocking every other host.
    const externalOnly = externalAuditRequests(baseURL);
    const blockExternal = (route) => route.abort("blockedbyclient");
    await context.route(externalOnly, blockExternal);
    // Each synthetic device is a separate local client, including its rate-limit
    // identity. Faster independent tests must not share one localhost quota.
    const address = 40 + accountScenarios.indexOf(testInfo.title) * 4;
    await context.setExtraHTTPHeaders({ "cf-connecting-ip": `192.0.2.${address}` });
    const errors = [];
    function watch(p) {
      p.on("pageerror", (e) => errors.push(e.message));
    }
    watch(page);
    context.on("page", watch);
    const newDevice = async (width = 1280) => {
      const other = await browser.newContext({
        viewport: { width, height: 900 },
        extraHTTPHeaders: { "cf-connecting-ip": `192.0.2.${address + contexts.length}` },
      });
      await other.route(externalOnly, blockExternal);
      contexts.push(other);
      other.on("page", watch);
      return { context: other, page: await other.newPage() };
    };
    try {
      await runFixture({ context, page, newDevice });
      expect(errors, "Browser runtime errors").toEqual([]);
    } finally {
      for (const other of contexts.slice(1)) await other.close();
    }
  },
});

export async function visit(page, origin, path) {
  await openApplication(page, origin + path);
  await expect(page.locator("main")).toBeVisible();
  if (path === "/account") {
    await expect(page.getByRole("button", { name: /^(Sign out|Sign in)$/ }).last()).toBeVisible();
  } else if (["/welcome", "/downloads", "/help", "/updates"].includes(path)) {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  // Vite may replace the document after its first dependency optimization.
  // waitForFunction survives that navigation while still requiring loaded fonts.
  await page.waitForFunction(() => document.fonts.status === "loaded");
}

// Routine DM transitions explicitly opt in. Storage-interruption, guest entry,
// account handoffs and other deliberate cold-load checks keep using visit().
export async function navigateAccountScenario(page, origin, path) {
  const target = new URL(path, origin);
  const current = new URL(page.url());
  if (
    current.origin !== origin ||
    (current.pathname === "/account" && target.pathname === "/account")
  ) {
    // A library already open on device two needs a real refresh after device
    // one saves another membership. A same-route link would retain stale cards.
    await visit(page, origin, path);
    return;
  }
  if (target.pathname !== "/account" && !page.guestAccessAudit) await prepareDmFixture(page, origin);
  // Already-confirmed success notices have a real close control. Use it before
  // header navigation: hovering a notice otherwise pauses its dismissal timer.
  const successes = page.locator('[data-sonner-toast][data-type="success"]:not([data-removed="true"])');
  let remaining = await successes.count();
  while (remaining > 0) {
    await successes.first().getByRole("button", { name: "Close toast", exact: true }).click();
    await expect.poll(() => successes.count()).toBeLessThan(remaining);
    remaining = await successes.count();
  }
  const marker = randomUUID();
  await page.evaluate((value) => (window.accountNavigationAudit = value), marker);
  if (target.pathname !== "/account") {
    const openApp = page.getByRole("link", { name: "Open app", exact: true });
    if (await openApp.isVisible()) {
      await openApp.click();
      await page.waitForURL((url) => url.pathname === "/");
    }
  }
  // A routine return to the account library can follow the first DM claim too;
  // answer its delayed guide before opening any campaign navigation control.
  if (new URL(page.url()).pathname === "/") await waitForDmCampaign(page);
  if (["/party", "/characters"].includes(target.pathname)) {
    if (new URL(page.url()).pathname !== "/party") {
      await page
        .locator('nav[aria-label="Sections"]:visible')
        .getByRole("link", { name: "Party", exact: true })
        .click();
      await page.waitForURL((url) => url.pathname === "/party");
    }
    const section =
      target.pathname === "/characters"
        ? "characters"
        : target.searchParams.get("section");
    if (section) {
      const tab = page.getByRole("tab", {
        name: section === "funds" ? "Funds & inventory" : "Characters",
        exact: true,
      });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
  }
  if (new URL(page.url()).pathname !== target.pathname) {
    // Resolve the existing visible link in one browser round trip, rather than
    // serially querying every anchor and then scanning them again to click it.
    const selector = await page.locator("a[href]:visible").evaluateAll((links, href) => {
      const link = links.find((a) => new URL(a.getAttribute("href"), document.baseURI).href === href);
      return link ? `a[href="${CSS.escape(link.getAttribute("href"))}"]:visible` : null;
    }, target.href);
    if (selector) {
      await page.locator(selector).first().click();
      await page.waitForURL((url) => url.href === target.href);
    } else if (["/account", "/share"].includes(target.pathname)) {
      await page.getByRole("button", { name: "Select campaign", exact: true }).click();
      const campaigns = page.getByRole("dialog", { name: "Campaigns", exact: true });
      await campaigns
        .getByRole("link", {
          name:
            target.pathname === "/account"
              ? "Saved account campaigns →"
              : "Room, invitations & connections →",
          exact: true,
        })
        .click();
      await page.waitForURL((url) => url.pathname === target.pathname);
      if (await campaigns.isVisible()) await page.keyboard.press("Escape");
    } else {
      throw new Error(`No visible account-scenario navigation to ${path}`);
    }
  }
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator(".loot-opening"), "Internal navigation must not replay startup").toHaveCount(0);
  expect(await page.evaluate(() => window.accountNavigationAudit), "Internal navigation must retain the document").toBe(marker);
  if (target.pathname === "/account") {
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  }
  await page.waitForFunction(() => document.fonts.status === "loaded");
}

export async function waitForDmCampaign(page) {
  // The legitimate first-use guide appears after a short animation delay. Wait
  // for the resumed desk, then answer the actual offer before querying roles
  // hidden by the modal. Do not race an immediate isVisible() check.
  await expect(page.getByText("Campaign control", { exact: true })).toBeAttached();
  if (await page.evaluate(() => !localStorage.getItem("quire.guide.offer.v3"))) {
    await page.getByRole("button", { name: "Not now", exact: true }).click();
  }
  await expect(
    page.getByRole("button", { name: "Dungeon master. Change role.", exact: true }),
  ).toBeVisible();
}

export function credentials() {
  return {
    email: `audit-${randomUUID()}@example.com`,
    password: "disposable browser password 2026",
    name: "Test adventurer",
  };
}

export async function accountPost(context, origin, path, data) {
  const response = await context.request.post(`${origin}/api/account/${path}`, {
    headers: { origin },
    data,
  });
  expect(response.ok(), `Fixture request ${path}: ${response.status()}`).toBeTruthy();
  return response.json();
}

// Reuse the real account endpoints. Only unrelated setup bypasses the UI;
// the library scenario still verifies signup, sign-in, and account linking by clicking them.
export async function signedInDevices(devices, origin) {
  const user = credentials();
  await accountPost(devices.context, origin, "auth/sign-up/email", user);
  const other = await devices.newDevice();
  await accountPost(other.context, origin, "auth/sign-in/email", user);
  // Both devices are already independently authenticated. Their initial read-only
  // library loads share no ordered state, so retain both cold visits in parallel.
  await Promise.all([
    visit(devices.page, origin, "/account"),
    visit(other.page, origin, "/account"),
  ]);
  await expect(devices.page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(other.page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  return { ...user, other: other.page };
}

export async function createAndSaveRoom(page, origin, visitFn = visit) {
  await visitFn(page, origin, "/share");
  const skip = page.getByRole("button", { name: "Not now", exact: true });
  if (await skip.isVisible()) await skip.click();
  await page.getByRole("button", { name: "Start a room", exact: true }).click();
  await expect(page.locator('.multiplayer-hub[aria-busy="false"]')).toBeVisible();
  const separate = page.getByRole("checkbox", {
    name: "Create a separate room from this device’s copy",
    exact: true,
  });
  if (await separate.isVisible()) await separate.check();
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  const ready = page.getByRole("button", { name: "Share join link", exact: true });
  const error = page.locator('[data-sonner-toast][data-type="error"]').first();
  await expect(ready.or(error).first()).toBeVisible();
  if (await error.isVisible()) throw new Error(`Room creation: ${await error.innerText()}`);
  await expect(ready).toBeVisible();
  await expect(page.locator('.multiplayer-hub[aria-busy="false"]')).toBeVisible();
  await visitFn(page, origin, "/account");
  await page.getByRole("button", { name: "Save current membership", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "This membership is saved" }),
  ).toBeVisible();
  const library = await page.context().request.get(`${origin}/api/account/library`);
  expect(library.ok()).toBeTruthy();
  return (await library.json()).members;
}

export async function endSession(page, origin, visitFn = visit) {
  await visitFn(page, origin, "/share");
  await expect(
    page.getByRole("status").filter({ hasText: /Room online.*Play active.*Saved to room/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close room & revoke access", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Close room & revoke access", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Start a room", exact: true })).toBeVisible();
  await expect(page.locator('.multiplayer-hub[aria-busy="false"]')).toBeVisible();
}
