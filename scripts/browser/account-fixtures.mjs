import { test as base, expect } from "playwright/test";
import { randomUUID } from "node:crypto";
import { openApplication } from "../title-screen-navigation.mjs";
import { accountScenarios } from "../account-scenarios.mjs";

export { expect };
export const test = base.extend({
  devices: async ({ context, page, browser }, runFixture, testInfo) => {
    const contexts = [context];
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
  await visit(devices.page, origin, "/account");
  await visit(other.page, origin, "/account");
  await expect(devices.page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(other.page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  return { ...user, other: other.page };
}

export async function createAndSaveRoom(page, origin) {
  await visit(page, origin, "/share");
  const skip = page.getByRole("button", { name: "Not now", exact: true });
  if (await skip.isVisible()) await skip.click();
  await page.getByRole("button", { name: "Start a room", exact: true }).click();
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  const ready = page.getByRole("button", { name: "Share join link", exact: true });
  const error = page.locator('[data-sonner-toast][data-type="error"]').first();
  await expect(ready.or(error).first()).toBeVisible();
  if (await error.isVisible()) throw new Error(`Room creation: ${await error.innerText()}`);
  await expect(ready).toBeVisible();
  await visit(page, origin, "/account");
  await page.getByRole("button", { name: "Save current membership", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "This membership is saved" }),
  ).toBeVisible();
  const library = await page.context().request.get(`${origin}/api/account/library`);
  expect(library.ok()).toBeTruthy();
  return (await library.json()).members;
}

export async function endSession(page, origin) {
  await visit(page, origin, "/share");
  await expect(
    page.getByRole("status").filter({ hasText: "Connected · All changes saved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "End session", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Start a room", exact: true })).toBeVisible();
  await expect(page.locator('.multiplayer-hub[aria-busy="false"]')).toBeVisible();
}
