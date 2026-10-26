// The human check (Turnstile) must be on the form in every mode: sign in, create account and
// recovery key, including after switching between them once the script is cached. A bug left
// the form with no widget after a recovery reset, locking the owner out (2026-10-25).
// Cloudflare's script and the server's captcha config are stubbed so this runs offline.
import { openApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin))
  throw Error("Local disposable testing only");

const FAKE_TURNSTILE = `
window.turnstile = {
  _n: 0,
  render(el, o) {
    const id = "w" + ++this._n;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Fake human check (" + o.action + ")";
    b.dataset.widget = id;
    b.onclick = () => o.callback("token-" + o.action + "-" + id);
    el.append(b);
    return id;
  },
  reset() {},
  remove(id) { document.querySelector('[data-widget="' + id + '"]')?.remove(); },
};`;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const errors = [];
let userId = "";
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(20000);
  await context.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: FAKE_TURNSTILE }),
  );
  await context.route("**/api/account/captcha", (route) =>
    route.fulfill({ json: { required: true, siteKey: "1x00000000000000000000AA" } }),
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  // A disposable account with a recovery key, to replay the owner's path: recover, then sign in.
  const email = `human-check-${Date.now().toString(36)}@example.com`;
  const signup = await context.request.post(origin + "/api/account/auth/sign-up/email", {
    headers: { origin, "cf-connecting-ip": "192.0.2.231" },
    data: { email, name: "Human Check", password: "disposable human check password" },
  });
  assert.equal(signup.status(), 200);
  userId = (await signup.json()).user.id;
  const recovery = await context.request.post(origin + "/api/account/recovery-key", {
    headers: { origin },
    data: {},
  });
  assert.equal(recovery.status(), 200);
  const recoveryKey = (await recovery.json()).key;
  await context.request.post(origin + "/api/account/auth/sign-out", {
    headers: { origin },
    data: {},
  });
  await context.clearCookies();
  await openApplication(page, origin + "/account");
  const check = (action) => page.getByRole("button", { name: `Fake human check (${action})` });

  await check("signin").waitFor();
  await page.getByRole("button", { name: "Forgot your password? Use a recovery key" }).click();
  await check("recover").waitFor();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await check("signin").waitFor();
  await page
    .getByRole("tab", { name: "Create account" })
    .or(page.getByRole("button", { name: "Create account", exact: true }))
    .first()
    .click();
  await check("signup").waitFor();
  await page
    .getByRole("tab", { name: "Sign in" })
    .or(page.getByRole("button", { name: "Sign in", exact: true }))
    .first()
    .click();
  await check("signin").waitFor();
  assert.equal(await page.locator("[data-widget]").count(), 1, "exactly one widget on the form");

  // The owner's path: reset the password with the recovery key, then sign in with the new one.
  await page.getByRole("button", { name: "Forgot your password? Use a recovery key" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Recovery key").fill(recoveryKey);
  await page.getByLabel("New password").fill("replacement human check password");
  await check("recover").click();
  await page.locator("form button.portal-button").click();
  await page
    .getByText("Password changed. Save your replacement recovery key, then sign in.")
    .waitFor();
  await check("signin").waitFor({ timeout: 5000 });
  await page.getByLabel("Password").fill("replacement human check password");
  await check("signin").click();
  await page.locator("form button.portal-button").click();
  await page.getByRole("button", { name: "Sign out" }).waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();
  await check("signin").waitFor();

  // Without passing it the form says so; after passing it the request carries the token.
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("not a real password");
  await page.locator("form button.portal-button").click();
  await page.getByText("Complete the human check, then try again.").waitFor();
  await check("signin").click();
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/account/auth/sign-in/email"));
  await page.locator("form button.portal-button").click();
  assert.match((await sent).headers()["x-captcha-response"] ?? "", /^token-signin-w\d+$/);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: human check present in sign-in, recovery and sign-up, including after switching modes.",
  );
} finally {
  if (userId) {
    const DB = localAccountDb("data/account-dev.sqlite");
    await DB.prepare("DELETE FROM user WHERE id=?").bind(userId).run();
    DB.close();
  }
  await browser.close();
}
