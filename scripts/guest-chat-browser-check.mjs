// Party chat between a DM and players who joined a shared room: a guest who
// joined from an invitation without an account, and a signed-in player. Every
// message must reach both sides; guests keep their outbox in memory only.
// Run only against a disposable local server:
//   node --experimental-strip-types scripts/guest-chat-browser-check.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir } from "node:fs/promises";
import { smithFixture } from "../src/lib/quire/test-fixtures/blacksmith.ts";
import { openApplication, reloadApplication, navigateApplication } from "./title-screen-navigation.mjs";
import { createRoom } from "./browser/account-fixtures.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "Chat check requires a disposable server");
const output = "test-results/guest-chat";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const errors = [];
const pages = [];
const delivery = 20000;
const ip = () =>
  `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;

async function device(label, width = 1280) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    serviceWorkers: "block",
    extraHTTPHeaders: { "cf-connecting-ip": ip() },
  });
  await context.route(
    (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
    (r) => r.abort(),
  );
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [${label} console] ${m.text().slice(0, 300)}`);
  });
  pages.push([label, page]);
  return { context, page };
}
async function seed(page, table) {
  await page.evaluate(async (table) => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((r) => r.id === active)
          ?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["purses", "holdings", "shops", "stock", "ledger", "meta"], "readwrite");
        for (const key of ["purses", "holdings", "shops", "stock", "ledger"]) {
          tx.objectStore(key).clear();
          for (const row of table[key]) tx.objectStore(key).put(row);
        }
        for (const key of ["listings", "loans", "sheets", "handouts"])
          tx.objectStore("meta").put({ id: key, [key]: table[key] ?? [] });
        tx.objectStore("meta").put({ id: "journal", value: table.journal });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, table);
}
async function probeScopes(page) {
  await page.evaluate(async () => {
    const m = await import("/src/lib/quire/cloud-client.ts");
    window.__scopes = [];
    let last = "";
    const rec = () => {
      const v = m.getCloudTable();
      const k = JSON.stringify([sessionStorage.getItem("lootsplit.verified-account") || "", v.code, v.seatId, v.sessionId, v.joined]);
      if (k !== last) { window.__scopes.push(Date.now() % 100000 + " " + k); last = k; }
    };
    rec();
    setInterval(rec, 50);
  });
}
const chat = (page) => page.getByRole("region", { name: "Live party chat", exact: true });
async function openChat(page) {
  await navigateApplication(page, origin + "/share?tab=chat");
  await expect(page.locator("#chat-message")).toBeEnabled();
  await page.getByLabel("Conversation", { exact: true }).selectOption("party");
}
/** Sends through the real composer, then requires the confirmed bubble on every device. */
async function sendAndExpect(label, sender, readers, text, how) {
  await sender.locator("#chat-message").fill(text);
  if (how === "keyboard") await sender.locator("#chat-message").press("Control+Enter");
  else if (how === "submit") await sender.locator(".chat-composer").evaluate((f) => f.requestSubmit());
  else await chat(sender).getByRole("button", { name: "Send", exact: true }).click();
  await expect(sender.locator("#chat-message")).toHaveValue("");
  const started = Date.now();
  await expect(
    chat(sender).locator(".chat-message.own").filter({ hasText: text }).getByText("Sent", { exact: false }),
  ).toBeVisible({ timeout: delivery });
  await expect(chat(sender).getByText("Failed — not confirmed", { exact: true })).toHaveCount(0);
  for (const reader of readers)
    await expect(chat(reader).getByText(text, { exact: true })).toBeVisible({ timeout: delivery });
  console.log(`  ${label}: delivered to ${readers.length} other device(s) in ${Date.now() - started} ms`);
}

try {
  const dm = await device("dm");
  await openApplication(dm.page, origin + "/share");
  await seed(dm.page, smithFixture());
  await reloadApplication(dm.page);
  await createRoom(dm.page, origin, (p, o, path) => navigateApplication(p, o + path));
  await expect(
    dm.page.getByRole("status").filter({ hasText: /Room online.*Play active/ }).first(),
  ).toBeVisible();
  const invitation = await dm.page.evaluate(() => {
    const id = localStorage.getItem("quire.campaign.v1") || "main";
    const session = JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`));
    return { code: session.code, sessionId: session.sessionId };
  });
  const invite = `${origin}/share?join=${invitation.code}&session=${invitation.sessionId}`;
  console.log(`Guest chat check: room ${invitation.code}`);

  // 1. A guest (no account) joins from the invitation and chats with the party.
  const guest = await device("guest", 390);
  guest.page.guestAccessAudit = true;
  await openApplication(guest.page, invite);
  await guest.page.getByRole("button", { name: "Find characters", exact: true }).click();
  await guest.page.getByLabel("Your name", { exact: true }).fill("Guest player");
  await guest.page.getByRole("combobox", { name: "Choose your character", exact: true }).selectOption("hero");
  await guest.page.getByRole("button", { name: "Join room", exact: true }).click();
  await guest.page.getByText("You joined as a player", { exact: true }).waitFor();
  await openApplication(guest.page, origin + "/share?tab=chat");
  await probeScopes(guest.page);
  await guest.page.locator("#chat-message").fill("Typed right after load");
  await guest.page.waitForTimeout(3000);
  console.log("guest scopes", await guest.page.evaluate(() => window.__scopes));
  console.log("guest draft after hydrate:", await guest.page.locator("#chat-message").inputValue().catch(e=>e.message));
  await openChat(guest.page);
  await openChat(dm.page);
  await sendAndExpect("guest party message (Send)", guest.page, [dm.page], "Guest check one: the door is trapped.", "click");
  await sendAndExpect("guest party message (Ctrl+Enter)", guest.page, [dm.page], "Guest check two: disarming it now.", "keyboard");
  await sendAndExpect("DM party reply", dm.page, [guest.page], "DM check: roll with advantage.", "submit");
  assert.equal(
    await guest.page.evaluate(() =>
      Object.entries(localStorage).some(
        ([key, value]) => key.startsWith("lootsplit.chat.outbox.") || value.includes("Guest check"),
      ),
    ),
    false,
    "Guest chat stays in memory only",
  );
  // The same guest after the DM reloads (the screenshot sequence that first showed the report).
  await reloadApplication(dm.page);
  await openChat(dm.page);
  await expect(chat(dm.page).getByText("Guest check two: disarming it now.", { exact: true })).toBeVisible();
  await sendAndExpect("guest party message after DM reload", guest.page, [dm.page], "Guest check three: after the DM reloaded.", "submit");

  // 2. A signed-in player joins the same room and every party member sees every message.
  const member = await device("member");
  const signUp = await member.context.request.post(origin + "/api/account/auth/sign-up/email", {
    headers: { origin },
    data: {
      email: `guest-chat-${Date.now()}@example.test`,
      name: "Chat member",
      password: "disposable guest chat check password",
    },
  });
  assert.equal(signUp.status(), 200, await signUp.text());
  await openApplication(member.page, invite);
  await member.page.getByRole("button", { name: "Find characters", exact: true }).click();
  await member.page.getByLabel("Your name", { exact: true }).fill("Signed-in player");
  await member.page.getByRole("combobox", { name: "Choose your character", exact: true }).selectOption("other");
  await member.page.getByRole("button", { name: "Join room", exact: true }).click();
  await member.page.getByText("You joined as a player", { exact: true }).waitFor();
  await probeScopes(member.page);
  await openChat(member.page);
  await member.page.waitForTimeout(3000);
  console.log("member scopes", await member.page.evaluate(() => window.__scopes));
  await sendAndExpect("signed-in player party message", member.page, [dm.page, guest.page], "Member check: I keep watch.", "click");
  await sendAndExpect("guest party message with a second player", guest.page, [dm.page, member.page], "Guest check four: thanks for watching.", "click");
  await guest.page.screenshot({ path: output + "/guest-chat-mobile.png", fullPage: true });
  await dm.page.screenshot({ path: output + "/dm-chat-desktop.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Guest chat check passed");
  console.log("FINAL guest", await guest.page.evaluate(() => window.__scopes));
  console.log("FINAL member", await member.page.evaluate(() => window.__scopes));
  process.exitCode = 1;
} catch (error) {
  for (const [label, page] of pages) {
    const region = await chat(page).innerText({ timeout: 2000 }).catch(() => "(no chat region)");
    const notices = await page
      .locator("[data-sonner-toast], [role=alert], [aria-label='Unsent chat recovery']")
      .allInnerTexts()
      .catch(() => []);
    console.log(`--- ${label} ${page.url()}\n${region.replace(/\s+/g, " ").slice(-500)}`);
    if (notices.length) console.log(`  notices: ${notices.join(" | ").replace(/\s+/g, " ")}`);
    await page.screenshot({ path: `${output}/failure-${label}.png`, fullPage: true }).catch(() => {});
  }
  if (errors.length) console.log("Page errors:", errors);
  console.error(String(error?.stack || error).split("\n").slice(0, 12).join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
