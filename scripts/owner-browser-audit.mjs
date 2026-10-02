import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8094";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin))
  throw Error("Disposable local development only");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext();
await mkdir("test-results", { recursive: true });
const errors = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
let id;
const DB = localAccountDb("data/account-dev.sqlite");
try {
  const signup = await context.request.post(origin + "/api/account/auth/sign-up/email", {
    headers: { origin },
    data: {
      email: `owner-audit-${Date.now()}@example.com`,
      password: "disposable test password only",
      name: "Audit Owner",
    },
  });
  assert.equal(signup.status(), 200);
  id = (await signup.json()).user.id;
  await DB.prepare("INSERT INTO site_roles VALUES (?,'owner',?)").bind(id, Date.now()).run();
  await page.goto(origin + "/account");
  await page.getByRole("heading", { name: "Owner controls", exact: true }).waitFor();
  await page.getByLabel("Donation page URL").fill("https://example.com/support");
  await page.getByRole("button", { name: "Save donation link", exact: true }).click();
  await page.getByText("Donation link is live on the Donate page.", { exact: true }).waitFor();
  await page.getByLabel("Announcement title", { exact: true }).fill("Test announcement");
  await page
    .getByLabel("Announcement message", { exact: true })
    .fill("Literal <script> text stays text.");
  await page.getByRole("button", { name: "Publish announcement", exact: true }).click();
  await page.getByText("Announcement published on the homepage.", { exact: true }).waitFor();
  await page.goto(origin + "/welcome");
  await page.getByText("Literal <script> text stays text.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Donate", exact: true }).first().click();
  const link = page.getByRole("link", { name: "Make a donation" });
  await link.waitFor();
  assert.equal(await link.getAttribute("href"), "https://example.com/support");
  await page.getByRole("link", { name: "Resources", exact: true }).first().click();
  assert.equal(
    await page.getByRole("link", { name: "Visit Open5e" }).getAttribute("href"),
    "https://open5e.com",
  );
  await page.goto(origin + "/account");
  await page.getByLabel("Donation page URL").fill("");
  await page.getByRole("button", { name: "Save donation link", exact: true }).click();
  await page.getByText("Donations are hidden until you add a link.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Save draft / hide announcement" }).click();
  await page.getByText("Announcement is hidden. Your draft is saved.", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator(".quire-dawn").waitFor({state:"hidden"});
  await page.screenshot({
    path: process.env.OWNER_SCREENSHOT || "test-results/owner-mobile.png",
    fullPage: true,
  });
  await DB.prepare("DELETE FROM site_roles WHERE user_id=?").bind(id).run();
  await page.reload();
  await page.getByRole("heading", { name: "Audit Owner’s library", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Owner controls", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("Owner browser audit passed");
} catch (error) {
 console.error(await page.locator("body").innerText()); throw error;
} finally {
  if (id) await DB.prepare("DELETE FROM user WHERE id=?").bind(id).run();
  DB.close();
  await browser.close();
}
