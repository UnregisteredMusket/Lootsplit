// History on demand (sectioned storage step 4, tabletop protocol 12). A disposable DM shares a
// synthetic campaign with a long party ledger and chat (about 2.5 MB, stored in history pages)
// and one archived session, live. Checks: the DM's Full activity lists the newest entries and
// "Load earlier entries" adds older ones; a search covers earlier entries (loaded as it runs); an
// archived session is listed without its contents until "Load this session"; a player's chat at
// 320 px offers "Load earlier messages" at its oldest end; Download a copy holds the whole
// history; closing the room to Local Mode from a fresh tab keeps the whole campaign on the
// device, and hosting it again uploads it complete (a partial table is refused); nothing scrolls
// sideways; no page errors. Never targets a real campaign.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { openApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):/, "Disposable local server required.");
const output = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/history-on-demand`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const errors = [];
const ip = () => `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
const LINES = 7000;

async function device(label, width, options = {}) {
  const context = await browser.newContext({
    viewport: { width, height: width < 400 ? 700 : 900 },
    serviceWorkers: "block",
    extraHTTPHeaders: { "cf-connecting-ip": ip() },
    ...options,
  });
  await context.route(
    (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
    (route) => route.abort(),
  );
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  return { context, page };
}
/** Counts history reads (readCloudHistory) a page makes. */
async function countHistory(context) {
  const counts = { history: 0 };
  await context.route("**/_serverFn/**", async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes('"before"') || body.includes('"report"')) counts.history++;
    await route.continue();
  });
  return counts;
}
const fits = async (page, label) =>
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${label}: the page scrolls sideways`,
  );
/** Opens a Fold (a click before the page is interactive is lost, so it is repeated). */
async function openFold(button) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await expect(button).toBeVisible();
    if ((await button.getAttribute("aria-expanded")) === "true") return;
    await button.click();
    try {
      await expect(button).toHaveAttribute("aria-expanded", "true", { timeout: 10000 });
      return;
    } catch {
      /* not interactive yet: try again */
    }
  }
  throw Error("A section did not open.");
}
const recordCount = async (page) => {
  const text = await page.getByText(/^\d+ of \d+ records$/).first().textContent();
  return Number(/of (\d+) records/.exec(text ?? "")?.[1] ?? 0);
};

try {
  const dm = await device("dm", 1280);
  const dmReads = await countHistory(dm.context);
  dm.page.setDefaultTimeout(90000); // The first visit compiles the development server's modules.
  await openApplication(dm.page, origin + "/party");
  dm.page.setDefaultTimeout(30000);
  await dm.page.evaluate(async (lines) => {
    const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
    const { readJournal } = await import("/src/lib/quire/journal.ts");
    const coins = (gp) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
    const purses = [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins(400) },
      { id: "mira", name: "Mira", kind: "character", coins: coins(12) },
    ];
    const base = { purses, holdings: [], shops: [], stock: [], listings: [], loans: [], sheets: [] };
    // One archived session, with its own short ledger and chat.
    const archived = {
      ...base,
      ledger: Array.from({ length: 40 }, (_, i) => ({ id: `old-${i}`, at: 1_600_000_000_000 + i, purseId: "hoard", shopId: null, summary: `First road toll ${i}`, copper: 0, transactionType: "adjustment" })),
      notes: [{ id: "old-note", at: 1_600_000_000_000, from: "dm", to: "party", purseId: "", text: "The first road begins." }],
      journal: { sessions: [], requests: [], events: [] },
    };
    await applyCloudTable({
      ...base,
      // A long party history: about 1.4 MB of ledger and 1.1 MB of chat.
      ledger: Array.from({ length: lines }, (_, i) => ({ id: `l-${i}`, at: 1_700_000_000_000 + i, purseId: "hoard", shopId: null, summary: `Road supplies ${i}: rope, lantern oil and rations`, copper: 0, transactionType: "adjustment" })),
      notes: Array.from({ length: lines }, (_, i) => ({ id: `n-${i}`, at: 1_700_000_000_000 + i, from: "dm", to: "party", purseId: "", text: `Day ${i}: the caravan moves north at dawn.` })),
      journal: readJournal({
        sessions: [{ id: "first-road", name: "The First Road", startedAt: 1_600_000_000_000, endedAt: 1_600_000_100_000 }],
        requests: [],
        events: [],
        reports: [{ id: "first-road", name: "The First Road", at: 1_600_000_100_000, snapshot: JSON.stringify(archived) }],
      }),
    });
    const c = await import("/src/lib/quire/cloud-client.ts");
    await c.chooseTableMode("live");
  }, LINES);
  const room = await dm.page.evaluate(async () => {
    const { getCloudTable } = await import("/src/lib/quire/cloud-client.ts");
    const view = getCloudTable();
    return { code: view.code, sessionId: view.sessionId };
  });
  assert.match(room.code, /^[A-Z0-9]{4,12}$/);
  // The room view holds the newest lines only.
  const held = await dm.page.evaluate(async () => {
    const { pullCloudTable } = await import("/src/lib/quire/room-transport.ts");
    const { roomCredentials } = await import("/src/lib/quire/cloud-client.ts");
    const s = roomCredentials();
    const view = await pullCloudTable({ data: { tabletopProtocol: 12, code: s.code, token: s.token } });
    return { ledger: view.table.ledger.length, notes: view.table.notes.length, cursors: Object.keys(view.history ?? {}), report: view.table.journal.reports[0] };
  });
  assert.ok(held.ledger < 1024 && held.notes < 1024, `the view holds the newest lines (${held.ledger}, ${held.notes})`);
  assert.deepEqual(held.cursors.sort(), ["ledger", "notes", "projection"]);
  assert.equal(held.report.deferred, true);
  assert.equal(held.report.snapshot, "");

  // 1. DM, Full activity: newest entries, then Load earlier entries.
  await openApplication(dm.page, origin + "/features/reports");
  // The page has read the room (its history cursors are known) before anything is opened.
  await expect
    .poll(() =>
      dm.page.evaluate(async () => (await import("/src/lib/quire/room-history.ts")).getRoomHistory().ledger.more),
    )
    .toBe(true);
  const fold = dm.page.getByRole("button", { name: /Full activity/ });
  await openFold(fold);
  await openFold(fold);
  const before = await recordCount(dm.page).catch(async (error) => {
    await dm.page.screenshot({ path: `${output}/records-failure.png` });
    throw Error(`${error.message}\nexpanded=${await fold.getAttribute("aria-expanded")} errors=${JSON.stringify(errors)}`);
  });
  assert.ok(before < 1100, `Full activity starts with the newest entries (${before})`);
  // The device holds the newest lines of the stored ledger, contiguously. (A DM device stores its
  // ledger by ID, so the shared campaign's ledger is in ID order: "l-6999" < "l-7".)
  const order = Array.from({ length: LINES }, (_, i) => `l-${i}`).sort();
  const holding = await dm.page.evaluate(async () => {
    const { snapshot } = await import("/src/lib/quire/economy.ts");
    return (await snapshot()).ledger.map((l) => l.id).sort();
  });
  assert.ok(holding.length < 1024);
  assert.deepEqual(holding, order.slice(LINES - holding.length), "the newest stored lines, contiguously");
  const loadEarlier = dm.page.getByRole("button", { name: "Load earlier entries", exact: true });
  // On a slow runner the section can re-render closed while the page settles: reopen and retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await loadEarlier.isVisible()) break;
    await openFold(fold);
    await loadEarlier.waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
  }
  await expect(loadEarlier)
    .toBeVisible({ timeout: 10000 })
    .catch(async (error) => {
      await dm.page.screenshot({ path: `${output}/activity-failure.png`, fullPage: true });
      const state = await dm.page.evaluate(async () => {
        const h = await import("/src/lib/quire/room-history.ts");
        return { state: h.getRoomHistory(), test: h.roomHistoryForTests().scopeKey };
      });
      throw Error(`${error.message}\nHistory state: ${JSON.stringify(state)}`);
    });
  await loadEarlier.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await dm.page.screenshot({ path: `${output}/activity-load-earlier-1280.png` });
  await loadEarlier.click();
  await expect.poll(() => recordCount(dm.page)).toBeGreaterThan(before);
  await fits(dm.page, "activity 1280");
  assert.ok(dmReads.history >= 1);
  // A search covers earlier entries, loading them as it runs.
  await dm.page.getByRole("textbox", { name: "Search full activity", exact: true }).fill("Road supplies 12:");
  await expect(dm.page.locator(".journal-entry").filter({ hasText: "Road supplies 12: rope" }))
    .toBeVisible({ timeout: 180000 })
    .catch(async (error) => {
      await dm.page.screenshot({ path: `${output}/search-failure.png` });
      throw error;
    });
  await dm.page.screenshot({ path: `${output}/activity-search-1280.png` });
  await dm.page.getByRole("textbox", { name: "Search full activity", exact: true }).fill("");

  // 2. DM, an archived session: listed without contents until loaded.
  const reports = dm.page.getByRole("button", { name: /^Archived session reports/ });
  await openFold(reports);
  const session = dm.page.getByRole("group", { name: "Archived session The First Road", exact: true }).last();
  await expect(session).toBeVisible();
  await session.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await dm.page.screenshot({ path: `${output}/archived-session-1280.png` });
  const loadSession = session.getByRole("button", { name: "Load this session", exact: true });
  const read = dm.page.getByRole("button", { name: "Read session report", exact: true }).first();
  // A click before the page is interactive is lost: repeat it while the session is not loaded.
  for (let attempt = 0; attempt < 3 && !(await read.isEnabled().catch(() => false)); attempt++) {
    if (await loadSession.isVisible().catch(() => false)) await loadSession.click().catch(() => undefined);
    await expect(read).toBeEnabled({ timeout: 10000 }).catch(() => undefined);
  }
  await expect(read).toBeEnabled({ timeout: 10000 });
  await read.click();
  await expect(dm.page.getByRole("dialog", { name: "The First Road" })).toContainText("Financial activity · 40 records");
  await dm.page.keyboard.press("Escape");

  // 3. A player's chat at 320 px: Load earlier messages at the oldest end.
  const phone = await device("player 320", 320);
  const phoneReads = await countHistory(phone.context);
  await openApplication(phone.page, `${origin}/share?join=${room.code}&session=${room.sessionId}`);
  await phone.page.getByRole("combobox", { name: "Choose your character", exact: true }).selectOption("mira");
  await phone.page.getByLabel("Your name", { exact: true }).fill("History audit player");
  await phone.page.getByRole("button", { name: "Join room", exact: true }).click();
  await phone.page.waitForURL((u) => u.pathname === "/" && u.searchParams.get("view") === "home", { timeout: 60000 });
  await openApplication(phone.page, origin + "/share?tab=chat");
  const log = phone.page.getByRole("log", { name: "Messages" });
  const messages = log.locator(".chat-message");
  await expect(messages.first()).toBeVisible();
  const shown = await messages.count();
  const earlier = log.getByRole("button", { name: "Load earlier messages", exact: true });
  await earlier.scrollIntoViewIfNeeded();
  await expect(earlier).toBeVisible();
  await fits(phone.page, "chat 320");
  await log.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await phone.page.screenshot({ path: `${output}/chat-load-earlier-320.png` });
  await earlier.click();
  await expect.poll(() => messages.count(), { timeout: 30000 }).toBeGreaterThan(shown);
  assert.ok(phoneReads.history >= 1);
  await fits(phone.page, "chat 320 after loading");
  await log.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await phone.page.screenshot({ path: `${output}/chat-loaded-320.png` });

  // 4. Download a copy (the DM's device copy): the whole history, as before.
  const copy = await dm.page.evaluate(async () => {
    const { captureDeviceBackup } = await import("/src/lib/quire/cloud-client.ts");
    const file = await captureDeviceBackup();
    return { ledger: file.ledger.length, notes: file.notes?.length ?? 0, reports: file.journal?.reports?.map((r) => [r.deferred ?? false, r.snapshot.length]) };
  });
  assert.ok(copy.ledger >= LINES, `the copy holds every ledger line (${copy.ledger})`);
  assert.ok(copy.notes >= LINES, `the copy holds every message (${copy.notes})`);
  assert.deepEqual(copy.reports.map(([deferred]) => deferred), [false]);
  assert.ok(copy.reports[0][1] > 1000, "the archived session is complete in the copy");

  // 5. Review finding 1: the DM closes the room to Local Mode from a fresh tab (nothing loaded
  // yet). The device keeps the whole campaign: every line and the archived session's contents.
  await openApplication(dm.page, origin + "/party");
  const local = await dm.page.evaluate(async () => {
    const c = await import("/src/lib/quire/cloud-client.ts");
    const { pullCloudTable } = await import("/src/lib/quire/room-transport.ts");
    const { applyCloudTable, economySnapshot: deviceTable } = await import("/src/lib/quire/economy.ts");
    // This device holds only the room's working view (as a DM's second device does): the newest
    // lines and archived sessions without their contents.
    const s = c.roomCredentials();
    const working = await pullCloudTable({ data: { tabletopProtocol: 12, code: s.code, token: s.token } });
    await applyCloudTable(working.table);
    const before = (await deviceTable()).ledger.length;
    await c.chooseTableMode("local");
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return {
      before,
      joined: c.getCloudTable().joined,
      ledger: t.ledger.length,
      notes: t.notes.length,
      reports: t.journal.reports.map((r) => [r.deferred ?? false, r.snapshot.length]),
      notice: t.notes.some((n) => n.id === c.DEVICE_HISTORY_NOTICE_ID),
    };
  });
  assert.ok(local.before < 1024, `the device held the working view only (${local.before} ledger lines)`);
  assert.equal(local.joined, false, "the room is closed");
  assert.ok(local.ledger >= LINES, `the local campaign holds every ledger line (${local.ledger})`);
  assert.ok(local.notes >= LINES, `the local campaign holds every message (${local.notes})`);
  assert.ok(local.reports.length >= 1 && local.reports.every(([deferred, length]) => !deferred && length > 1000), "every archived session, complete");
  assert.equal(local.notice, false, "complete: no incomplete-copy notice");
  // Hosting it again uploads the whole campaign; the new room serves it complete.
  const rehosted = await dm.page.evaluate(async () => {
    const c = await import("/src/lib/quire/cloud-client.ts");
    await c.chooseTableMode("live");
    const { pullCloudTable } = await import("/src/lib/quire/room-transport.ts");
    const s = c.roomCredentials();
    const old = await pullCloudTable({ data: { tabletopProtocol: 11, code: s.code, token: s.token } });
    return { ledger: old.table.ledger.length, notes: old.table.notes.length, reports: old.table.journal.reports.map((r) => r.snapshot.length) };
  });
  assert.ok(rehosted.ledger >= LINES && rehosted.notes >= LINES, `the new room holds every line (${rehosted.ledger}, ${rehosted.notes})`);
  assert.ok(rehosted.reports.every((length) => length > 1000), "archived sessions uploaded complete");
  // A table whose archived sessions are not loaded is never uploaded.
  const refused = await dm.page.evaluate(async () => {
    const { openCloudTable } = await import("/src/lib/quire/room-transport.ts");
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    t.journal.reports = t.journal.reports.map((r) => ({ ...r, snapshot: "", deferred: true }));
    try {
      await openCloudTable({ data: { name: "Partial", table: t } });
      return "accepted";
    } catch (error) {
      return String(error.message);
    }
  });
  assert.match(refused, /not loaded on this device/);

  assert.deepEqual(errors, []);
  console.log(`History on demand audit passed; screenshots in ${output}`);
} finally {
  await browser.close();
}
