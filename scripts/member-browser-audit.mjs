import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin))
  throw Error("Local disposable testing only");
const output = process.env.MEMBER_SCREENSHOTS || "test-results/members";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const DB = localAccountDb("data/account-dev.sqlite"),
  ids = [],
  errors = [];
async function account(label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(20000);
  // Each disposable actor models a separate client; avoid sharing other audits' IP budget.
  await context.setExtraHTTPHeaders({
    "cf-connecting-ip": label === "Staff Audit" ? "192.0.2.201" : "192.0.2.202",
  });
  const email = `${label.toLowerCase().replaceAll(" ", "-")}-${Date.now()}@example.com`;
  const r = await context.request.post(origin + "/api/account/auth/sign-up/email", {
    headers: { origin },
    data: { email, name: label, password: "disposable member audit password" },
  });
  assert.equal(r.status(), 200);
  const id = (await r.json()).user.id;
  ids.push(id);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, id, email };
}
try {
  const owner = await account("Staff Audit"),
    member = await account("Member Audit");
  await DB.prepare("INSERT INTO site_roles VALUES (?,'owner',?)").bind(owner.id, Date.now()).run();
  await openApplication(member.page, origin + "/account");
  await member.page.getByRole("heading", { name: "Profile & preferences" }).waitFor();
  await member.page.getByLabel("Introduction", { exact: true }).fill("A tabletop adventurer.");
  await member.page.getByLabel("Messaging email", { exact: true }).fill("messages@example.com");
  await member.page
    .getByLabel("I’d like email announcements and release updates", { exact: true })
    .check();
  await member.page.getByRole("button", { name: "Save member profile", exact: true }).click();
  await member.page.getByText("Profile saved.", { exact: true }).waitFor();
  await reloadApplication(member.page);
  await member.page.getByLabel("Introduction", { exact: true }).waitFor();
  assert.equal(
    await member.page.getByLabel("Introduction", { exact: true }).inputValue(),
    "A tabletop adventurer.",
  );
  assert.equal(
    await member.page.getByRole("heading", { name: "Member management", exact: true }).count(),
    0,
  );
  await openApplication(owner.page, origin + "/account");
  await owner.page.getByRole("heading", { name: "Member management", exact: true }).waitFor();
  await owner.page.getByLabel("Search members", { exact: true }).fill(member.email);
  await owner.page.getByRole("button", { name: "Search / refresh members" }).click();
  await owner.page.getByRole("button", { name: "Manage Member Audit", exact: true }).click();
  await owner.page.getByText("A tabletop adventurer.", { exact: true }).waitFor();
  assert.match(
    await owner.page
      .getByRole("link", { name: "Messaging email: messages@example.com" })
      .getAttribute("href"),
    /^mailto:/,
  );
  async function action(kind, reason, option) {
    await owner.page.getByLabel("Member action", { exact: true }).selectOption(kind);
    if (option)
      await owner.page.getByLabel(option.label, { exact: true }).selectOption(option.value);
    await owner.page.getByLabel("Moderation reason", { exact: true }).fill(reason);
    owner.page.once("dialog", (d) => d.accept());
    await owner.page.getByRole("button", { name: "Apply member action" }).click();
    await owner.page.getByText("Member action saved.", { exact: true }).waitFor();
  }
  await action("warn", "Please keep profiles friendly.");
  await reloadApplication(member.page);
  await member.page.getByText(/Staff warning.*Please keep profiles friendly/).waitFor();
  await owner.page.getByRole("button", { name: "Manage Member Audit", exact: true }).click();
  await action("ban", "Temporary test suspension.", { label: "Ban duration", value: "1" });
  const denied = await member.context.request.get(origin + "/api/account/library");
  assert.equal(denied.status(), 401);
  await owner.page.getByRole("button", { name: "Manage Member Audit", exact: true }).click();
  await action("restore", "Test complete, restore access.");
  await owner.page.getByRole("button", { name: "Manage Member Audit", exact: true }).click();
  await action("role", "Delegate moderation for testing.", {
    label: "Staff role",
    value: "moderator",
  });
  await owner.page.getByRole("button", { name: "Manage Member Audit", exact: true }).click();
  await action("role", "Remove test moderation access.", { label: "Staff role", value: "member" });
  const code = "AUDIT" + Date.now().toString(36).slice(-7).toUpperCase();
  const room = {
    code,
    revision: 1,
    turn: 0,
    live: false,
    seats: [
      { id: "audit-dm", token: "audit-dm-token", role: "dm", name: "Audit DM", purseIds: [] },
    ],
    table: {
      purses: [],
      holdings: [],
      shops: [],
      stock: [],
      ledger: [],
      notes: [],
      listings: [],
      loans: [],
      sheets: [],
    },
    seen: { gifts: [], sales: [] },
  };
  await DB.prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,1,?)")
    .bind(code, JSON.stringify(room))
    .run();
  const linked = await owner.context.request.post(origin + "/api/account/link", {
    headers: { origin },
    data: { code, token: "audit-dm-token", name: "Disposable shared campaign" },
  });
  assert.equal(linked.status(), 200);
  await reloadApplication(owner.page);
  await owner.page.getByRole("button", { name: "Delete shared campaign", exact: true }).waitFor();
  owner.page.once("dialog", (d) => d.accept(code));
  await owner.page.getByRole("button", { name: "Delete shared campaign", exact: true }).click();
  await owner.page
    .getByText("Shared campaign deleted. Its saved state is in Cloud backups.", { exact: true })
    .waitFor();
  assert.equal(
    await DB.prepare("SELECT code FROM campaign_rooms WHERE code=?").bind(code).first(),
    null,
  );
  await owner.page.getByRole("button", { name: "Restore as new", exact: true }).waitFor();
  await owner.page.setViewportSize({ width: 390, height: 844 });
  await owner.page
    .getByRole("heading", { name: "Member management", exact: true })
    .scrollIntoViewIfNeeded();
  assert.equal(
    await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await owner.page.screenshot({ path: output + "/staff-mobile.png" });
  await owner.page.setViewportSize({ width: 1280, height: 900 });
  await owner.page
    .getByRole("heading", { name: "Member management", exact: true })
    .scrollIntoViewIfNeeded();
  await owner.page.screenshot({ path: output + "/staff-desktop.png" });
  await member.page.setViewportSize({ width: 390, height: 844 });
  await member.page
    .getByRole("heading", { name: "Profile & preferences" })
    .scrollIntoViewIfNeeded();
  await member.page.screenshot({ path: output + "/profile-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: profile persistence, member isolation, warning, ban/session revocation, restore, staff grant/revoke, responsive staff UI.",
  );
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages())
      console.error((await page.locator("body").innerText()).slice(0, 2500));
  throw error;
} finally {
  for (const id of ids) await DB.prepare("DELETE FROM user WHERE id=?").bind(id).run();
  DB.close();
  await browser.close();
}
