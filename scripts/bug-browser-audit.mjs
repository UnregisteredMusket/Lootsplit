import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
const origin = "http://127.0.0.1:8080",
  output = process.env.BUG_SCREENSHOTS || "test-results/bugs";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const DB = localAccountDb("data/account-dev.sqlite"),
  ids = [],
  errors = [];
try {
  async function actor(role, ip) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { "cf-connecting-ip": ip },
    });
    const result = await context.request.post(origin + "/api/account/auth/sign-up/email", {
      headers: { origin },
      data: {
        email: `bug-${role}-${Date.now()}@example.com`,
        password: "disposable bug audit password",
        name: `Bug ${role}`,
      },
    });
    assert.equal(result.status(), 200);
    const id = (await result.json()).user.id;
    ids.push(id);
    if (role === "admin")
      await DB.prepare("INSERT INTO site_roles VALUES (?,'admin',?)").bind(id, Date.now()).run();
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/account#bug-reports");
    await page.locator("#bug-reports h2").waitFor();
    await page.locator(".quire-dawn").waitFor({ state: "hidden" });
    return { page, context };
  }
  const member = await actor("member", "192.0.2.220"),
    page = member.page;
  await page.getByText("Report a bug", { exact: true }).click();
  await page.getByLabel("Bug title", { exact: true }).fill("Shop inventory freezes");
  await page.getByLabel("Bug area", { exact: true }).selectOption("shops");
  await page
    .getByLabel("What went wrong?", { exact: true })
    .fill("Inventory does not appear. <script>window.bugUnsafe=true</script>");
  await page.getByLabel("Steps to reproduce", { exact: true }).fill("Open the campaign shop.");
  await page.getByLabel("Include device details shown below", { exact: true }).check();
  // Simulate a response lost after the server commits: retry must not create a duplicate.
  let lost = false;
  await page.route("**/api/account/reports", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Submit bug report", exact: true }).click();
  await page.locator("#bug-reports [role=alert]").waitFor();
  assert.equal(
    await page.getByLabel("Bug title", { exact: true }).inputValue(),
    "Shop inventory freezes",
  );
  await page.getByRole("button", { name: "Submit bug report", exact: true }).click();
  await page.getByText(/Report received. Reference:/).waitFor();
  await page.locator(".bug-list button").waitFor();
  assert.equal(await page.locator(".bug-list li").count(), 1);
  await page.locator(".bug-list button").click();
  await page.getByText("No response yet.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.bugUnsafe), undefined);
  assert.equal(await page.getByLabel("Report inbox", { exact: true }).count(), 0);
  const admin = await actor("admin", "192.0.2.221");
  await admin.page.getByLabel("Report inbox", { exact: true }).selectOption("all");
  await admin.page.getByRole("button", { name: /Shop inventory freezes/ }).click();
  await admin.page.getByLabel("Report status", { exact: true }).selectOption("reviewing");
  await admin.page.getByLabel("Report priority", { exact: true }).selectOption("high");
  await admin.page
    .getByLabel("Response to reporter", { exact: true })
    .fill("Thanks. We reproduced the issue.");
  await admin.page.getByRole("button", { name: "Save report update", exact: true }).click();
  await admin.page.getByText("Report updated.", { exact: true }).waitFor();
  await admin.page.locator(".bug-detail").scrollIntoViewIfNeeded();
  await admin.page.screenshot({ path: output + "/admin-desktop.png" });
  await page.getByRole("button", { name: "Reload report", exact: true }).click();
  await page.getByText("Thanks. We reproduced the issue.", { exact: true }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator("#bug-title").scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + "/member-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: private member submission, optional diagnostics, lost-response retry deduplication, admin triage, reporter response, escaped HTML and mobile layout.",
  );
} finally {
  for (const id of ids) {
    await DB.prepare("DELETE FROM bug_reports WHERE user_id=?").bind(id).run();
    await DB.prepare("DELETE FROM user WHERE id=?").bind(id).run();
  }
  DB.close();
  await browser.close();
}
