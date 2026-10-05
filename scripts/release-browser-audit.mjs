import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
await mkdir("test-results", { recursive: true });
const errors = [];
const diagnostic = process.env.AUDIT_RECOVERY_DIAGNOSTICS === "1" || process.env.CI === "true";
const activeRequests = new Map();
async function bounded(label, work) {
  let timer;
  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function visit(page, url) {
  await openApplication(page, url);
  // Server-rendered controls appear before hydration; wait for the client to attach handlers.
  await page.locator(".role-chip:enabled").waitFor();
}
async function open(width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
  });
  context.setDefaultTimeout(20000);
  context.setDefaultNavigationTimeout(30000);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await visit(page, origin);
  const skip = page.getByRole("button", { name: "Not now", exact: true });
  // Fresh contexts show the guide dialog, which makes navigation inert until dismissed.
  await skip.waitFor();
  await skip.click();
  await page.getByRole("link", { name: "Party", exact: true }).first().waitFor();
  await page.getByRole("heading", { name: "Campaign control", exact: true }).waitFor();
  await page.waitForTimeout(2000); // Initial Vite dependency optimization can reload once.
  await page.getByRole("heading", { name: "Campaign control", exact: true }).waitFor();
  if (await skip.isVisible()) await skip.click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  return page;
}
try {
  // Warm Vite's lazy dependency optimizer before collecting application errors.
  // The first development navigation may be invalidated by dependency discovery.
  const warmup = await browser.newPage();
  warmup.setDefaultTimeout(20000);
  warmup.setDefaultNavigationTimeout(30000);
  await visit(warmup, origin);
  await warmup.waitForTimeout(4000);
  await warmup.close();
  console.log("Audit: open DM");
  const dm = await open();
  // Disposable local test server only. Provision known balances without changing app defaults.
  await dm.evaluate(async () => {
    const e = await import("/src/lib/quire/economy.ts");
    await e.ensureEconomy();
    const p = (await e.listPurses()).find((p) => p.kind === "character");
    await e.savePurse({ ...p, coins: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 } });
  });
  await visit(dm, origin + "/share");
  await dm.getByRole("button", { name: "Start a room", exact: true }).click();
  await dm.getByRole("button", { name: "Create room", exact: true }).click();
  await dm.getByRole("button", { name: "Share join link", exact: true }).waitFor();
  const code = await dm.evaluate(
    async () => (await import("/src/lib/quire/cloud-client.ts")).getCloudTable().code,
  );
  assert.match(code, /^[A-Z2-9]{8}$/);
  console.log("Audit: room created; open player");
  const player = await open();
  if (diagnostic) {
    player.on("request", (request) => activeRequests.set(request, Date.now()));
    player.on("requestfinished", (request) => activeRequests.delete(request));
    player.on("requestfailed", (request) => activeRequests.delete(request));
  }
  await visit(player, origin + "/share?join=" + code);
  await player.getByPlaceholder("Enter your code").waitFor();
  assert.equal(await player.getByPlaceholder("Enter your code").inputValue(), code);
  await player.getByRole("button", { name: "Find characters", exact: true }).click();
  await player.getByPlaceholder("What should the party call you?").fill("Audit player");
  await player.getByRole("button", { name: "Join room", exact: true }).click();
  await player.getByRole("button", { name: "Share join link", exact: true }).waitFor();
  console.log("Audit: player joined; test conflicting invitation");
  await visit(player, origin + "/share?join=TEST1234");
  await player
    .getByText(`Invitation to TEST1234. You are currently connected to ${code}.`, { exact: true })
    .waitFor();
  await player.getByRole("button", { name: "Stay in this room", exact: true }).click();
  assert.equal(new URL(player.url()).searchParams.has("join"), false);
  console.log("Audit: interrupt purchase and restore queue");
  // Interrupt only API transport so the app and saved queue can reload normally.
  let interruptCommands = true;
  await player.route("**/_serverFn/**", (route) =>
    interruptCommands && route.request().postData()?.includes("commands")
      ? route.abort("failed")
      : route.continue(),
  );
  await bounded("queue interrupted purchase", () =>
    player.evaluate(async () => {
      const c = await import("/src/lib/quire/cloud-client.ts");
      const e = await import("/src/lib/quire/economy.ts");
      const p = (await e.listPurses()).find((p) => p.kind === "character");
      const stock = (await e.listStock()).find((s) => s.copper === 2);
      await c.queueCommand({
        kind: "buy",
        purseId: p.id,
        stockId: stock.id,
        quantity: 1,
      });
    }),
  );
  console.log("Audit: interrupted command returned; reload saved queue");
  assert.ok(
    await player.evaluate(() =>
      Object.values(localStorage).some((v) => v.includes("pending") && v.includes("stockId")),
    ),
  );
  await reloadApplication(player);
  // The SSR heading is present before the restored client room is ready. Wait
  // for hydration and the persisted membership before invoking recovery APIs.
  await player.locator(".role-chip:enabled").waitFor();
  await player.getByRole("button", { name: "Share join link", exact: true }).waitFor();
  await player.getByRole("heading", { name: "Campaign", exact: true }).waitFor();
  assert.ok(
    await player.evaluate(() =>
      Object.values(localStorage).some((v) => v.includes("pending") && v.includes("stockId")),
    ),
  );
  // Keep the handler installed while the restored client's background reads are
  // active. Restore transport by changing the fault, not by removing interception
  // during an in-flight poll. Browser context cleanup removes the handler later.
  interruptCommands = false;
  console.log("Audit: saved queue restored; retry transport");
  await bounded("import restored client", () =>
    player.evaluate(async () => {
      await import("/src/lib/quire/cloud-client.ts");
      return true;
    }),
  );
  console.log("Audit: recovery client imported; refresh room");
  await bounded("refresh restored room", () =>
    player.evaluate(async () => {
      const c = await import("/src/lib/quire/cloud-client.ts");
      await c.refreshShared();
    }),
  );
  console.log("Audit: restored room refreshed; retry purchase");
  await bounded("retry restored purchase", () =>
    player.evaluate(async () => {
      const c = await import("/src/lib/quire/cloud-client.ts");
      await c.retryPending();
    }),
  );
  const count = await player.evaluate(
    async () => (await import("/src/lib/quire/cloud-client.ts")).getCloudTable().pending,
  );
  assert.equal(count, 0);
  console.log("Audit: recovery passed; inspect responsive routes");
  // Player and DM responsive entry points remain rendered.
  for (const page of [dm, player]) {
    for (const route of ["/", "/party", "/market", "/share", "/settings"]) {
      await visit(page, origin + route);
      await page.locator("main").waitFor();
      await page.waitForTimeout(300);
      assert.ok((await page.locator("main").innerText()).trim());
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        route,
      );
    }
    await visit(page, origin + "/");
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `test-results/${page === dm ? "dm" : "player"}-mobile.png`,
    });
  }
  const desktop = await open(1280);
  await visit(desktop, origin + "/");
  await desktop.waitForTimeout(500);
  await desktop.screenshot({ path: "test-results/dm-desktop.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: fresh invitation, restored-room explanation, interrupted purchase queue/reload/retry, DM/player responsive routes, clean runtime.",
  );
} catch (error) {
  console.error("Browser runtime errors:", errors);
  if (diagnostic)
    console.error(
      "Pending browser requests:",
      [...activeRequests].map(([r, at]) => ({
        path: new URL(r.url()).pathname,
        method: r.method(),
        elapsed: Date.now() - at,
      })),
    );
  for (const [i, c] of browser.contexts().entries())
    for (const p of c.pages()) {
      if (diagnostic)
        console.error(
          "Browser state:",
          await p
            .evaluate(async () => ({
              ready: document.readyState,
              visibility: document.visibilityState,
              locks: await navigator.locks.query(),
            }))
            .catch(() => null),
        );
      await p.screenshot({ path: `test-results/failure-${i}.png` }).catch(() => {});
      console.error((await p.locator("body").innerText()).slice(-4500));
    }
  throw error;
} finally {
  await browser.close();
}
