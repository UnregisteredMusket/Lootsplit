// Community profiles and the Looking for Group directory, end to end on a disposable dev server:
// a member makes a profile from My account, visibility gates who sees it, another member
// reports it, staff hide it, and no email address ever reaches a community page.
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin))
  throw Error("Local disposable testing only");
const output = process.env.COMMUNITY_SCREENSHOTS || "test-results/community";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const DB = localAccountDb("data/account-dev.sqlite"),
  ids = [],
  errors = [];
const stamp = Date.now().toString(36);
const handle = `audit-dm-${stamp}`;
async function account(label, ip) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(20000);
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": ip });
  const email = `${label.toLowerCase().replaceAll(" ", "-")}-${stamp}@example.com`;
  const r = await context.request.post(origin + "/api/account/auth/sign-up/email", {
    headers: { origin },
    data: { email, name: label, password: "disposable community audit password" },
  });
  assert.equal(r.status(), 200);
  const id = (await r.json()).user.id;
  ids.push(id);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, id, email };
}
try {
  const dm = await account("Community DM", "192.0.2.211"),
    viewer = await account("Community Viewer", "192.0.2.212"),
    staff = await account("Community Staff", "192.0.2.213");
  await DB.prepare("INSERT INTO site_roles VALUES (?,'moderator',?)").bind(staff.id, Date.now()).run();
  const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const anonPage = await anon.newPage();
  anonPage.on("pageerror", (e) => errors.push(e.message));

  // 1. The DM sets up a members-only profile from My account.
  await openApplication(dm.page, origin + "/account#account-community");
  const card = dm.page.locator("#account-community");
  await card.getByRole("heading", { name: "Community profile", exact: true }).waitFor();
  await card.getByLabel("Signed-in Lootsplitter members").check();
  await card.getByLabel(/^Handle/).fill(handle);
  await card.getByLabel("I play as").selectOption("dm");
  await card.locator("label", { hasText: /^Looking for/ }).locator("select").selectOption("players");
  await card.getByLabel("Looking-for-group note").fill("Two seats open, Fridays.");
  await card.getByLabel(/^Games/).fill("D&D 5e, OSR");
  await card.getByLabel("Time zone").selectOption("America/New_York");
  await card.getByLabel(/^Discord username/).fill("audit_dm");
  await card.getByRole("button", { name: "Save community profile" }).click();
  await card.getByText(/^Community profile saved\./).waitFor();

  // 2. Members-only: hidden from a logged-out visitor, visible to a signed-in member.
  await openApplication(anonPage, `${origin}/community/${handle}`);
  await anonPage.getByRole("heading", { name: "Profile not found", level: 1 }).waitFor();
  await openApplication(viewer.page, origin + "/community");
  await viewer.page.getByRole("link", { name: /Community DM/ }).first().waitFor();
  await viewer.page.getByLabel("Role").selectOption("player");
  await viewer.page.getByRole("button", { name: "Search", exact: true }).click();
  await viewer.page.getByText("No profiles match yet.").waitFor();
  await viewer.page.getByLabel("Role").selectOption("dm");
  await viewer.page.getByRole("button", { name: "Search", exact: true }).click();
  await viewer.page.getByRole("link", { name: /Community DM/ }).first().click();
  await viewer.page.getByRole("heading", { name: "Community DM", level: 1 }).waitFor();
  const text = await viewer.page.locator("main").innerText();
  assert.match(text, /Two seats open, Fridays\./);
  assert.match(text, /D&D 5e, OSR/);
  assert.match(text, /audit_dm/);
  assert.doesNotMatch(text, /@example\.com/, "no email address on a community page");
  await viewer.page.screenshot({ path: output + "/profile-desktop.png", fullPage: true });

  // 3. Public: now the logged-out visitor sees it in the directory (phone width).
  await reloadApplication(dm.page);
  await card.getByLabel("Everyone, including search engines").check();
  await card.getByRole("button", { name: "Save community profile" }).click();
  await card.getByText(/^Community profile saved\./).waitFor();
  await openApplication(anonPage, origin + "/community");
  await anonPage.getByRole("link", { name: /Community DM/ }).first().waitFor();
  assert.equal(await anonPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.doesNotMatch(await anonPage.locator("main").innerText(), /@example\.com/);
  await anonPage.screenshot({ path: output + "/directory-mobile.png", fullPage: true });
  assert.equal(await anonPage.getByRole("button", { name: "Report this profile" }).count(), 0);

  // 4. A member reports it; staff hide it; it leaves the directory.
  await viewer.page.reload();
  await viewer.page.getByRole("button", { name: "Report this profile" }).click();
  await viewer.page.getByLabel("What is wrong with this profile?").fill("Audit report");
  await viewer.page.getByRole("button", { name: "Send report" }).click();
  await viewer.page.getByText("Thanks. Site staff will review this profile.").waitFor();
  await openApplication(staff.page, origin + "/account");
  const reports = staff.page.locator("section", { has: staff.page.getByRole("heading", { name: "Community profile reports" }) });
  await reports.getByText("“Audit report”", { exact: false }).waitFor();
  assert.equal(await reports.getByRole("button", { name: "Hide profile" }).first().isDisabled(), true, "a reason is required");
  await reports.getByLabel(/^Reason/).first().fill("Audit: spam");
  await reports.getByRole("button", { name: "Hide profile" }).first().click();
  await reports.getByText("No open reports.").waitFor();
  await anonPage.reload();
  await anonPage.getByText("No profiles match yet.").waitFor();
  await reloadApplication(dm.page);
  await dm.page.getByText(/Site staff have hidden your community profile/).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: community profile setup, members-only and public visibility, filters, no emails, report, staff hide, mobile directory.");
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages())
      console.error((await page.locator("body").innerText().catch(() => "")).slice(0, 2500));
  throw error;
} finally {
  for (const id of ids) await DB.prepare("DELETE FROM user WHERE id=?").bind(id).run();
  DB.close();
  await browser.close();
}
