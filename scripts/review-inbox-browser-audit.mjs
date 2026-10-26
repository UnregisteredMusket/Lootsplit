// Review Inbox (design D2, QoL 5 and 13) in a disposable device campaign, at 1280, 390 and 320:
// "All caught up" with no empty section headers; a mixed queue sorted by age with type chips
// that filter, a single "Nothing else pending" line and search only above five requests; the shared
// card's Approve (primary) and Deny… (secondary) roles and styles; the inline stub after a decision
// with View receipt; deny with a saved reason; A / D / J / K on a focused card; "Approve all
// payments under N gp" through a themed confirmation, with a reload in the middle, charging each
// payment exactly once; the Desk readout and the Desk tab badge. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { continueIntoApp, openApplication } from "./title-screen-navigation.mjs";
import { themedDialog } from "./themed-dialogs.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/review-inbox`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const noOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
    `${label}: the page scrolls sideways`,
  );
const coins = (gp) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
const HOUR = 3600000;

/** A disposable campaign: three payments, a loan, a hire, a withdrawal and a training request. */
function fixture(now) {
  const item = {
    id: "audit-crate",
    purseId: "audit-ilsa",
    name: "Crate of candles",
    kind: "item",
    quantity: 4,
    unitCopper: 10,
    notes: "",
    custody: { kind: "property", propertyId: "audit-house" },
  };
  const site = {
    propertyId: "audit-house",
    templateKey: "warehouse",
    enabled: true,
    access: "party-members",
    accessPurseIds: [],
    capacityWeight: null,
    completedTemplates: [],
    notes: "",
  };
  return {
    site,
    purses: [
      { id: "audit-ilsa", name: "Ilsa Brann", kind: "character", coins: coins(50) },
      { id: "audit-tor", name: "Tor Ashby", kind: "character", coins: coins(20) },
      { id: "audit-npc", name: "Old Garrick", kind: "character", coins: coins(0) },
    ],
    holdings: [
      { id: "audit-house", purseId: "audit-ilsa", name: "Harbour house", kind: "property", quantity: 1, unitCopper: 0, notes: "" },
      item,
    ],
    requests: [
      { id: "audit-pay-ferry", purseId: "audit-tor", note: "Ferry crossing", copper: 300, at: now - 50 * HOUR, status: "pending" },
      { id: "audit-pay-inn", purseId: "audit-ilsa", note: "Inn bill", copper: 450, at: now - 30 * HOUR, status: "pending" },
      { id: "audit-pay-horse", purseId: "audit-ilsa", note: "Warhorse", copper: 4000, at: now - 2 * HOUR, status: "pending" },
    ],
    loans: [
      { id: "audit-loan", at: now - 40 * HOUR, purseId: "audit-tor", purseName: "Tor Ashby", copper: 1000, note: "Ship deposit", status: "pending" },
    ],
    window: {
      id: "audit-window",
      name: "Audit downtime",
      fromDay: 0,
      days: 1,
      settings: { hoursPerDay: 16, trainingHoursPerDay: 8 },
      budgets: [
        { purseId: "audit-ilsa", totalMinutes: 960, committedMinutes: 480 },
        { purseId: "audit-npc", totalMinutes: 960, committedMinutes: 480 },
      ],
    },
    training: {
      id: "audit-training",
      windowId: "audit-window",
      trainerId: "audit-ilsa",
      npcId: "audit-npc",
      trainerName: "Ilsa Brann",
      npcName: "Old Garrick",
      category: "martial",
      topic: "Longsword",
      description: "",
      className: "",
      minutes: 480,
      trainingHoursPerDay: 8,
      status: "pending",
      at: now - 10 * HOUR,
    },
    staff: {
      id: "audit-hire",
      propertyId: "audit-house",
      name: "Mara Quill",
      role: "Clerk",
      wageCopper: 70,
      periodDays: 7,
      status: "proposed",
      manager: false,
      duties: [],
      budgetCopper: 0,
      budgetPeriodDays: 7,
      budgetStartDay: 0,
      budgetSpentCopper: 0,
      notes: "Keeps the ledger.",
    },
    withdrawal: {
      id: "audit-withdrawal",
      propertyId: "audit-house",
      holdingId: "audit-crate",
      purseId: "audit-tor",
      requestedBy: "local",
      quantity: 2,
      itemBefore: JSON.stringify(item),
      status: "pending",
      reason: "",
    },
  };
}

async function seed(page, mixed) {
  await page.evaluate(
    async ({ data, mixed }) => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const { estatePreset } = await import("/src/lib/quire/estate-catalogue.ts");
      await applyCloudTable({
        purses: mixed ? data.purses : [],
        holdings: mixed ? data.holdings : [],
        shops: [],
        stock: [],
        ledger: [],
        listings: [],
        loans: mixed ? data.loans : [],
        sheets: [],
        notes: [],
        journal: readJournal(
          mixed
            ? {
                requests: data.requests,
                downtimeActivities: { windows: [data.window], requests: [data.training] },
                propertyOperations: { templates: [estatePreset("warehouse")], sites: [data.site], staff: [data.staff], withdrawals: [data.withdrawal] },
              }
            : {},
        ),
      });
    },
    { data: fixture(Date.now()), mixed },
  );
}
const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    return economySnapshot();
  });

try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 400 ? (width < 380 ? 640 : 844) : 900 },
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const go = async (path) => {
      // A reload mid-command can abort the first navigation; the second one lands.
      await page.goto(origin + path).catch(async (e) => {
        if (!/ERR_ABORTED/.test(e.message)) throw e;
        await page.goto(origin + path);
      });
      await continueIntoApp(page);
    };
    page.on("dialog", (d) => {
      errors.push(`native ${d.type()}: ${d.message()}`);
      void d.dismiss();
    });
    await openApplication(page, origin + "/");
    await page.evaluate(async () => {
      const t = await import("/src/lib/quire/table.ts");
      t.setSeat({ ...t.getSeat(), role: "dm" });
    });

    // 1. Nothing pending: one "All caught up" state, no chips, filters or empty section headers.
    await seed(page, false);
    await go("/features/review");
    const inbox = page.locator("#review-inbox");
    await expect(page.getByRole("heading", { name: "Review Inbox", exact: true, level: 1 })).toBeVisible();
    await expect(inbox.getByRole("heading", { name: "All caught up", exact: true, level: 2 })).toBeVisible();
    await expect(inbox.locator(".loot-empty")).toContainText("Nothing is waiting for your review.");
    await expect(inbox.getByRole("link", { name: "Back to the Desk", exact: true })).toBeVisible();
    await expect(inbox.locator(".review-chips")).toHaveCount(0);
    await expect(inbox.getByLabel("Search requests", { exact: true })).toHaveCount(0);
    await expect(inbox.locator("[data-review-card]")).toHaveCount(0);
    await expect(inbox.locator(".review-nothing-else")).toHaveCount(0);
    // History stays one tap away, closed.
    await expect(inbox.locator("#review-history-fold")).not.toHaveAttribute("open", "");
    await noOverflow(page, `empty ${width}`);
    await page.screenshot({ path: `${output}/empty-${width}.png` });
    await page.getByRole("link", { name: "Return to Desk", exact: true }).click();
    await expect(page.locator(".readout").filter({ hasText: "Review Inbox" })).toContainText("All caught up");

    // 2. A mixed queue, oldest first, with chips and the collapsed line for empty types.
    await seed(page, true);
    await go("/features/review");
    const cards = inbox.locator("[data-review-card]");
    await expect(cards).toHaveCount(7);
    await expect(inbox.getByRole("heading", { name: "7 waiting for you", exact: true })).toBeVisible();
    const order = await cards.evaluateAll((els) => els.map((el) => el.querySelector(".review-who")?.textContent));
    // Ferry (50 h) · loan (40 h) · inn (30 h) · training (10 h) · horse (2 h) · then undated hire and withdrawal.
    assert.deepEqual(order.slice(0, 5), ["Tor Ashby", "Tor Ashby", "Ilsa Brann", "Ilsa Brann", "Ilsa Brann"]);
    await expect(cards.nth(0)).toContainText("Ferry crossing");
    await expect(cards.nth(1)).toContainText("Ship deposit");
    await expect(cards.nth(2)).toContainText("Inn bill");
    await expect(cards.nth(3)).toContainText("Longsword");
    await expect(cards.nth(4)).toContainText("Warhorse");
    await expect(cards.nth(5)).toContainText("Mara Quill");
    await expect(cards.nth(6)).toContainText("Crate of candles");
    // Amount and balance after on a payment card.
    await expect(cards.nth(2)).toContainText("Balance after 45 gp, 5 sp");
    const chips = inbox.getByRole("group", { name: "Show request types" });
    for (const [label, n] of [["All", 7], ["Payments", 3], ["Loans", 1], ["Hires", 1], ["Training", 1], ["Property", 1]])
      await expect(chips.getByRole("button", { name: `${label} ${n}`, exact: true })).toBeVisible();
    await expect(chips.getByRole("button", { name: /^Pool/ })).toHaveCount(0);
    await expect(inbox.locator(".review-nothing-else")).toHaveCount(1);
    await expect(inbox.locator(".review-nothing-else")).toContainText("Nothing else pending · Journeys, Services, Pool");
    // The queue comes before the history; no empty "None pending" headers above pending items.
    assert.equal(
      await inbox.evaluate((el) => {
        const first = el.querySelector("[data-review-card]"), fold = el.querySelector("#review-history-fold");
        return !!first && !!fold && !!(first.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
      true,
    );
    await chips.getByRole("button", { name: "Loans 1", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Ship deposit");
    await expect(inbox.locator(".review-nothing-else")).toHaveCount(0);
    await chips.getByRole("button", { name: "All 7", exact: true }).click();
    await expect(cards).toHaveCount(7);
    // Search appears above five requests.
    const search = inbox.getByLabel("Search requests", { exact: true });
    await search.fill("ferry");
    await expect(cards).toHaveCount(1);
    await search.fill("");
    await expect(cards).toHaveCount(7);
    await noOverflow(page, `queue ${width}`);
    await page.screenshot({ path: `${output}/queue-${width}.png`, fullPage: true });

    // 3. Approve is the primary button, Deny… the secondary one.
    const horse = cards.filter({ hasText: "Warhorse" });
    const approve = horse.getByRole("button", { name: "Approve payment", exact: true });
    const decline = horse.getByRole("button", { name: "Decline", exact: true });
    await expect(approve).toBeVisible();
    await expect(decline).toBeVisible();
    const look = (el) => el.evaluate((b) => ({ bg: getComputedStyle(b).backgroundColor, border: getComputedStyle(b).borderTopWidth }));
    const [a, d] = [await look(approve), await look(decline)];
    assert.notEqual(a.bg, d.bg, "Approve and Deny look different");
    assert.equal(d.border, "1px", "Deny is the outlined secondary button");

    // 4. Keyboard: J / K move between cards; D on the hire denies it (its command takes no reason).
    await cards.nth(0).focus();
    await page.keyboard.press("j");
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press("k");
    await expect(cards.nth(0)).toBeFocused();
    const hire = cards.filter({ hasText: "Mara Quill" });
    await hire.focus();
    const before = await page.evaluate(() => scrollY);
    await page.keyboard.press("d");
    await expect(hire.locator(".review-stub")).toContainText("Denied");
    await expect(cards).toHaveCount(7); // the stub stays in place
    assert.ok(Math.abs((await page.evaluate(() => scrollY)) - before) < 120, "the page does not jump");
    assert.equal((await books(page)).journal.propertyOperations.staff[0].status, "denied");

    // 5. Deny… with a reason; the reason is remembered for the next deny.
    const take = cards.filter({ hasText: "Crate of candles" });
    await take.getByRole("button", { name: "Deny withdrawal…", exact: true }).click();
    await take.getByLabel("Withdrawal decision reason (optional)", { exact: true }).fill("Collect it in person");
    await take.getByRole("button", { name: "Deny withdrawal", exact: true }).click();
    await expect(take.locator(".review-stub")).toContainText("Denied");
    assert.equal((await books(page)).journal.propertyOperations.withdrawals[0].reason, "Collect it in person");
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("lootsplit.review.deny-reasons.v1") || "[]")),
      ["Collect it in person"],
    );

    // 6. A on a focused payment approves it; the stub keeps its place with View receipt.
    await horse.focus();
    await page.keyboard.press("a");
    await expect(horse.locator(".review-stub")).toContainText("Approved");
    await expect(horse.getByRole("link", { name: "View receipt", exact: true })).toHaveAttribute("href", /\/features\/reports/);
    await expect(cards).toHaveCount(7);
    let state = await books(page);
    assert.equal(state.journal.requests.find((r) => r.id === "audit-pay-horse").status, "approved");
    await noOverflow(page, `stubs ${width}`);
    await page.screenshot({ path: `${output}/stubs-${width}.png`, fullPage: true });

    // 7. Approve all payments under 10 gp: one themed confirmation, one command per payment.
    const bulk = inbox.getByRole("group", { name: "Approve payments in bulk" });
    await bulk.getByLabel("Payment limit in gold pieces", { exact: true }).fill("10");
    await bulk.getByRole("button", { name: "Approve 2 · 7 gp, 5 sp…", exact: true }).click();
    const confirm = themedDialog(page);
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("Approve 2 payments under 10 gp?");
    await expect(confirm).toContainText("Total 7 gp, 5 sp");
    await expect(confirm).toContainText("Ferry crossing");
    await expect(confirm).toContainText("Inn bill");
    await page.screenshot({ path: `${output}/bulk-confirm-${width}.png` });
    // Slow the page down and reload as soon as the first approval lands, mid-run; then finish
    // what is left: nothing is approved twice.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 30 });
    await confirm.locator("[data-dialog-confirm]").click();
    await expect
      .poll(async () => (await books(page)).journal.requests.filter((r) => r.status === "approved").length, { timeout: 60000, intervals: [50] })
      .toBeGreaterThan(1);
    await go("/features/review");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const again = inbox.getByRole("group", { name: "Approve payments in bulk" });
    state = await books(page);
    const left = state.journal.requests.filter((r) => r.status === "pending" && r.copper < 1000);
    // The run was cut off: whatever is still pending is approved again, by bulk or on its card.
    if (left.length > 1) {
      await again.getByLabel("Payment limit in gold pieces", { exact: true }).fill("10");
      await again.getByRole("button", { name: /^Approve \d · / }).click();
      await themedDialog(page).locator("[data-dialog-confirm]").click();
      await expect(again.getByRole("status")).toContainText(`Approved ${left.length} of ${left.length}`);
    } else {
      await expect(again).toHaveCount(0); // fewer than two payments: no bulk control
      for (const r of left) {
        const card = cards.filter({ hasText: r.note });
        await card.getByRole("button", { name: "Approve payment", exact: true }).click();
        await expect(card.locator(".review-stub")).toContainText("Approved");
      }
    }
    console.log(`${width}: ${2 - left.length} of 2 bulk approvals landed before the reload`);
    state = await books(page);
    for (const id of ["audit-pay-ferry", "audit-pay-inn", "audit-pay-horse"])
      assert.equal(state.journal.requests.find((r) => r.id === id).status, "approved", id);
    const lines = state.ledger.filter((l) => /^Payment approved/.test(l.summary ?? l.note ?? ""));
    assert.equal(lines.length, 3, "each payment charged exactly once");
    const balance = (id) => {
      const c = state.purses.find((p) => p.id === id).coins;
      return c.cp + 10 * c.sp + 50 * c.ep + 100 * c.gp + 1000 * c.pp;
    };
    assert.equal(balance("audit-tor"), 2000 - 300);
    assert.equal(balance("audit-ilsa"), 5000 - 450 - 4000);

    // 8. The Desk tab carries the count (loan + training remain), described, not renamed.
    await go("/");
    const readout = page.locator(".readout").filter({ hasText: "Review Inbox" });
    await expect(readout).toContainText("Open Review Inbox");
    if (width < 1024) {
      const tab = page.locator("nav.fixed").getByRole("link", { name: "Desk", exact: true });
      await expect(tab.locator(".review-nav-badge")).toHaveText("2");
      await expect(tab).toHaveAccessibleDescription("2 requests waiting in Review Inbox");
      await page.screenshot({ path: `${output}/desk-badge-${width}.png` });
    }
    await noOverflow(page, `desk ${width}`);
    assert.deepEqual(errors, [], `${width}: page errors`);
    await context.close();
  }
  console.log(
    "PASS review inbox: all caught up, mixed queue by age, chips, nothing-else line, search above five, Approve/Deny roles and styles, stubs with receipts, saved deny reason, A/D/J/K, bulk approve exactly once across a reload, Desk badge (1280/390/320)",
  );
} finally {
  await browser.close();
}
