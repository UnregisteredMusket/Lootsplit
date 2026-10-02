import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
await mkdir("test-results", { recursive: true });
const errors = [];
async function visit(page, url) {
  await page.goto(url);
  // Server-rendered controls appear before hydration; wait for the client to attach handlers.
  await page.waitForTimeout(1800);
}
async function open(width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await visit(page, origin);
  await page.getByRole("link", { name: "Party", exact: true }).first().waitFor();
  const skip = page.getByRole("button", { name: "Not now", exact: true });
  if (await skip.isVisible()) await skip.click();
  await page.getByText("Campaign treasury", { exact: true }).waitFor();
  await page.waitForTimeout(2000); // Initial Vite dependency optimization can reload once.
  await page.getByText("Campaign treasury", { exact: true }).waitFor();
  return page;
}
try {
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
  const player = await open();
  await visit(player, origin + "/share?join=" + code);
  await player.getByPlaceholder("Enter your code").waitFor();
  assert.equal(await player.getByPlaceholder("Enter your code").inputValue(), code);
  await player.getByRole("button", { name: "Find characters", exact: true }).click();
  await player.getByPlaceholder("What should the party call you?").fill("Audit player");
  await player.getByRole("button", { name: "Join room", exact: true }).click();
  await player.getByRole("button", { name: "Share join link", exact: true }).waitFor();
  await visit(player, origin + "/share?join=TEST1234");
  await player
    .getByText(`Invitation to TEST1234. You are currently connected to ${code}.`, { exact: true })
    .waitFor();
  await player.getByRole("button", { name: "Stay in this room", exact: true }).click();
  assert.equal(new URL(player.url()).searchParams.has("join"), false);
  // Interrupt only API transport so the app and saved queue can reload normally.
  await player.route("**/_serverFn/**", (route) => route.request().postData()?.includes("commands") ? route.abort("failed") : route.continue());
  await player.evaluate(async () => {
    const c = await import("/src/lib/quire/cloud-client.ts");
    const e = await import("/src/lib/quire/economy.ts");
    const p = (await e.listPurses()).find((p) => p.kind === "character");
    const stock = (await e.listStock()).find((s) => s.copper === 2);
    await c.queueCommand({ kind: "buy", purseId: p.id, stockId: stock.id, quantity: 1 });
  });
  assert.ok(
    await player.evaluate(() =>
      Object.values(localStorage).some((v) => v.includes("pending") && v.includes("stockId")),
    ),
  );
  await player.reload();
  await player.getByRole("heading", { name: "Multiplayer", exact: true }).waitFor();
  assert.ok(
    await player.evaluate(() =>
      Object.values(localStorage).some((v) => v.includes("pending") && v.includes("stockId")),
    ),
  );
  await player.unroute("**/_serverFn/**");
  await player.evaluate(async () => {
    const c = await import("/src/lib/quire/cloud-client.ts");
    await c.refreshShared();
    await c.retryPending();
  });
  const count = await player.evaluate(
    async () => (await import("/src/lib/quire/cloud-client.ts")).getCloudTable().pending,
  );
  assert.equal(count, 0);
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
    await page.screenshot({ path: `test-results/${page === dm ? "dm" : "player"}-mobile.png` });
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
  for (const [i, c] of browser.contexts().entries())
    for (const p of c.pages()) {
      await p.screenshot({ path: `test-results/failure-${i}.png` }).catch(() => {});
      console.error((await p.locator("body").innerText()).slice(-4500));
    }
  throw error;
} finally {
  await browser.close();
}
