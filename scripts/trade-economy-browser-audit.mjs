import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { tradeFixture } from "../src/lib/quire/test-fixtures/trade-economy.ts";
import { prepareTradeSeason, previewTradeSeason } from "../src/lib/quire/trade-economy.ts";
import { formatCopper, toCopper } from "../src/lib/quire/money.ts";
import { SEASON_NAMES } from "../src/lib/quire/scale.ts";
import {
  openApplication,
  reloadApplication,
  navigateApplication,
} from "./title-screen-navigation.mjs";
import { createAndSaveRoom } from "./browser/account-fixtures.mjs";
import { chooseOption } from "./search-select-browser.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(
  origin,
  /^http:\/\/(127\.0\.0\.1|localhost):/,
  "Economic fixtures require a disposable server",
);
const output = "test-results/trade-economy",
  started = Date.now(),
  errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
let current;
async function read(page) {
  return page.evaluate(async () => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((c) => c.id === active)
          ?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction("meta").objectStore("meta").get("journal");
        r.onsuccess = () => resolve(r.result.value);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
async function seed(page, table) {
  await page.evaluate(async (table) => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((c) => c.id === active)
          ?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(
          ["purses", "holdings", "shops", "stock", "ledger", "meta"],
          "readwrite",
        );
        for (const store of ["purses", "holdings", "shops", "stock", "ledger"]) {
          tx.objectStore(store).clear();
          for (const row of table[store]) tx.objectStore(store).put(row);
        }
        tx.objectStore("meta").put({ id: "journal", value: table.journal });
        tx.objectStore("meta").put({ id: "settings", ...table.realm });
        tx.objectStore("meta").put({ id: "listings", listings: [] });
        tx.objectStore("meta").put({ id: "loans", loans: [] });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, table);
}

async function economicState(page) {
  return page.evaluate(async () => {
    const active = localStorage.getItem("quire.campaign.v1");
    const name =
      JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((c) => c.id === active)
        ?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const stores = ["purses", "holdings", "ledger"];
      const tx = db.transaction(stores);
      const rows = await Promise.all(
        stores.map(
          (store) =>
            new Promise((resolve, reject) => {
              const request = tx.objectStore(store).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }),
        ),
      );
      return Object.fromEntries(stores.map((store, i) => [store, rows[i]]));
    } finally {
      db.close();
    }
  });
}

async function savedQueue(page) {
  return page.evaluate(() => {
    const campaign = localStorage.getItem("quire.campaign.v1") || "main";
    const session = JSON.parse(localStorage.getItem(`quire.cloud.v2.${campaign}`));
    return { batchId: session.batchId, commands: session.pending };
  });
}

async function extraDevice(width, guest = false) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    hasTouch: width === 390,
    serviceWorkers: "block",
    extraHTTPHeaders: {
      "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`,
    },
  });
  await context.route(
    (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
    (route) => route.abort(),
  );
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const page = await context.newPage();
  page.guestAccessAudit = guest;
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  current = page;
  return page;
}

function completeHistoryFixture() {
  const table = tradeFixture();
  const economy = table.journal.tradeEconomy;
  economy.receipts = Array.from({ length: 57 }, (_, i) => ({
    id: `history-receipt-${i + 1}`,
    at: 1700000000000 + i,
    epoch: 0,
    exchangeId: "harbor",
    commodityId: "timber",
    name: `Recorded timber ${i + 1}`,
    unit: "bundle",
    purseId: "a",
    direction: "buy",
    quantity: 1,
    copper: 100,
    origin: "shop",
  }));
  economy.history = Array.from({ length: 23 }, (_, i) => {
    const past = tradeFixture();
    past.journal.tradeEconomy.epoch = i;
    past.journal.tradeEconomy.commodities[0].name = `Original timber ${i + 1}`;
    past.journal.tradeEconomy.commodities[0].baseCopper = 200;
    past.journal.tradeEconomy.exchanges[0].name = `Recorded Harbor ${i + 1}`;
    prepareTradeSeason(past, { source: "local", random: () => 50 });
    const quote = previewTradeSeason(past, `history-season-${i + 1}`, 0);
    if (i === 1) quote.before = "older-opaque-fingerprint";
    const appliedExchanges = structuredClone(quote.exchanges);
    Object.assign(appliedExchanges[0].offers[0], {
      askCopper: 777,
      bidCopper: 500,
      stock: 77,
      supply: 89,
      demand: 144,
    });
    return {
      id: quote.id,
      at: 1700001000000 + i,
      day: i + 1,
      quote,
      appliedExchanges,
      realm: { ...quote.realm, season: 2, shortage: 1.5 },
      reason: `Recorded override ${i + 1}`,
      source: "manual",
    };
  });
  economy.epoch = 23;
  economy.commodities[0].name = "Current timber label";
  economy.exchanges[0].name = "Current Harbor Exchange";
  Object.assign(economy.exchanges[0].offers[0], { askCopper: 999, stock: 17 });
  table.realm.season = 4;
  table.realm.war = 2;
  return table;
}

async function historyPages(width) {
  const page = await extraDevice(width);
  await openApplication(page, origin + "/features/economy");
  const fixture = completeHistoryFixture();
  const historic = fixture.journal.tradeEconomy.history[0];
  const baseline = JSON.parse(historic.quote.before);
  const historicCommodity = baseline.commodities[0];
  const beforeOffer = baseline.exchanges[0].offers[0];
  const proposedOffer = historic.quote.exchanges[0].offers[0];
  const appliedOffer = historic.appliedExchanges[0].offers[0];
  assert.notEqual(beforeOffer.askCopper, proposedOffer.askCopper);
  assert.notEqual(proposedOffer.askCopper, appliedOffer.askCopper);
  await seed(page, fixture);
  await reloadApplication(page);
  await page.getByText("Trade receipts · 57", { exact: true }).click();
  const receipts = page.getByRole("navigation", { name: "Trade receipt pages", exact: true });
  const receiptsEnd = page.getByRole("navigation", {
    name: "Trade receipt pages at end",
    exact: true,
  });
  await expect(receipts.getByRole("status")).toHaveText("1–50 of 57 · Page 1 of 2");
  await expect(receiptsEnd.getByRole("status")).toHaveText("1–50 of 57 · Page 1 of 2");
  const receiptIds = await page
    .locator('[id^="trade-receipt-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.equal(receiptIds.length, 50);
  await expect(receipts.getByRole("button", { name: "First", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("article", { name: "Trade: Recorded timber 57 · season 0", exact: true }),
  ).toBeVisible();
  await receipts.getByRole("button", { name: "Next", exact: true }).click();
  await expect(receipts.getByRole("status")).toHaveText("51–57 of 57 · Page 2 of 2");
  const olderReceiptIds = await page
    .locator('[id^="trade-receipt-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.equal(olderReceiptIds.length, 7);
  assert.deepEqual(
    [...receiptIds, ...olderReceiptIds].sort(),
    fixture.journal.tradeEconomy.receipts
      .map((r) => `trade-receipt-${encodeURIComponent(r.id)}`)
      .sort(),
    "Every stored receipt is reachable through the real pages",
  );
  await expect(
    page.getByRole("article", { name: "Trade: Recorded timber 1 · season 0", exact: true }),
  ).toBeVisible();
  await expect(receipts.getByRole("button", { name: "Last", exact: true })).toBeDisabled();
  await expect(receiptsEnd.getByRole("status")).toHaveText("51–57 of 57 · Page 2 of 2");
  await expect(receiptsEnd.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await receiptsEnd.getByRole("button", { name: "Previous", exact: true }).click();
  await receiptsEnd.getByRole("button", { name: "Last", exact: true }).click();
  await receipts.getByRole("button", { name: "First", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Trade: Recorded timber 57 · season 0", exact: true }),
  ).toBeVisible();
  await page.getByText("Trade receipts · 57", { exact: true }).click();
  await page.getByText("Seasonal history · 23", { exact: true }).click();
  const seasons = page.getByRole("navigation", { name: "Seasonal history pages", exact: true });
  const seasonsEnd = page.getByRole("navigation", {
    name: "Seasonal history pages at end",
    exact: true,
  });
  await expect(seasons.getByRole("status")).toHaveText("1–20 of 23 · Page 1 of 2");
  await expect(seasonsEnd.getByRole("status")).toHaveText("1–20 of 23 · Page 1 of 2");
  const historyIds = await page
    .locator('[id^="trade-season-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.equal(historyIds.length, 20);
  await expect(
    page.getByRole("region", { name: "Seasonal settlement record", exact: true }),
  ).toHaveCount(0);
  await seasons.getByRole("button", { name: "Next", exact: true }).click();
  await expect(seasons.getByRole("status")).toHaveText("21–23 of 23 · Page 2 of 2");
  await expect(seasonsEnd.getByRole("status")).toHaveText("21–23 of 23 · Page 2 of 2");
  await expect(seasonsEnd.getByRole("button", { name: "Last", exact: true })).toBeDisabled();
  const olderHistoryIds = await page
    .locator('[id^="trade-season-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.equal(olderHistoryIds.length, 3);
  assert.deepEqual(
    [...historyIds, ...olderHistoryIds].sort(),
    fixture.journal.tradeEconomy.history
      .map((h) => `trade-season-${encodeURIComponent(h.id)}`)
      .sort(),
    "Every stored settlement is reachable through the real pages",
  );
  const oldest = page.locator('[id="trade-season-history-season-1"]');
  await oldest.locator("summary").first().click();
  const record = oldest.getByRole("region", { name: "Seasonal settlement record", exact: true });
  await expect(
    record.getByText(
      `Proposed ${SEASON_NAMES[historic.quote.realm.season]} · Applied ${SEASON_NAMES[historic.realm.season]} · DM override recorded`,
      { exact: true },
    ),
  ).toBeVisible();
  const good = record.getByRole("article", {
    name: `${historicCommodity.name} seasonal quotes`,
    exact: true,
  });
  await expect(good.getByText(`Per ${historicCommodity.unit}`, { exact: true })).toBeVisible();
  await expect(
    record.getByText(`${historic.quote.exchanges[0].name} · recorded seasonal quotes`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    good
      .getByRole("region", { name: "Before offer", exact: true })
      .getByText(formatCopper(beforeOffer.askCopper), { exact: true }),
  ).toBeVisible();
  await expect(
    good
      .getByRole("region", { name: "Proposed offer", exact: true })
      .getByText(formatCopper(proposedOffer.askCopper), { exact: true }),
  ).toBeVisible();
  await expect(
    good
      .getByRole("region", { name: "Applied offer", exact: true })
      .getByText(formatCopper(appliedOffer.askCopper), { exact: true }),
  ).toBeVisible();
  for (const [label, offer] of [
    ["Before", beforeOffer],
    ["Proposed", proposedOffer],
    ["Applied", appliedOffer],
  ]) {
    const stage = good.getByRole("region", { name: `${label} offer`, exact: true });
    for (const [term, value] of [
      ["Stock", offer.stock],
      ["Supply", offer.supply],
      ["Demand", offer.demand],
    ])
      await expect(
        stage
          .getByRole("term")
          .filter({ hasText: new RegExp(`^${term}$`) })
          .locator("..")
          .getByRole("definition"),
      ).toHaveText(String(value));
  }
  await expect(record.getByText("Current timber label", { exact: true })).toHaveCount(0);
  await expect(record.getByText("Current Harbor Exchange", { exact: true })).toHaveCount(0);
  await record
    .getByText("Seasonal conditions · before, proposed and applied", { exact: true })
    .click();
  await expect(
    record
      .getByRole("region", { name: "Before seasonal conditions", exact: true })
      .getByText(SEASON_NAMES[baseline.realm.season], { exact: true }),
  ).toBeVisible();
  await expect(
    record
      .getByRole("region", { name: "Proposed seasonal conditions", exact: true })
      .getByText(SEASON_NAMES[historic.quote.realm.season], { exact: true }),
  ).toBeVisible();
  await expect(
    record
      .getByRole("region", { name: "Applied seasonal conditions", exact: true })
      .getByText(SEASON_NAMES[historic.realm.season], { exact: true }),
  ).toBeVisible();
  await expect(
    record
      .getByRole("region", { name: "Applied seasonal conditions", exact: true })
      .getByText(String(historic.realm.shortage), { exact: true }),
  ).toBeVisible();
  await fits(page);
  await page.screenshot({ path: `${output}/history-${width}.png`, fullPage: true });
  await oldest.locator("summary").first().click();
  const legacy = page.locator('[id="trade-season-history-season-2"]');
  const legacyRecord = fixture.journal.tradeEconomy.history[1];
  await legacy.locator("summary").first().click();
  await expect(legacy.getByText(/Original baseline unavailable for this record/)).toBeVisible();
  await expect(
    legacy.getByRole("heading", {
      name: legacyRecord.quote.exchanges[0].offers[0].commodityId,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    legacy.getByText("Unit not recorded in this historical baseline.", { exact: true }),
  ).toBeVisible();
  await expect(
    legacy
      .getByRole("region", { name: "Applied offer", exact: true })
      .getByText(formatCopper(legacyRecord.appliedExchanges[0].offers[0].askCopper), {
        exact: true,
      }),
  ).toBeVisible();
  await legacy.locator("summary").first().click();
  await seasonsEnd.getByRole("button", { name: "Previous", exact: true }).click();
  await seasonsEnd.getByRole("button", { name: "Last", exact: true }).click();
  await seasons.getByRole("button", { name: "First", exact: true }).click();
  await expect(seasons.getByRole("status")).toHaveText("1–20 of 23 · Page 1 of 2");
  assert.deepEqual(
    (await read(page)).tradeEconomy,
    fixture.journal.tradeEconomy,
    "Paging and reading history never mutate saved records",
  );
  await page.context().close();
}

async function reversalAndPlayerViews(page, width) {
  // The preceding season-approval assertion observes optimistic campaign state.
  // Start this independent transport fault only after that action is acknowledged.
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Live · Room online · Play active · Saved to room" }),
  ).toBeVisible();
  await expect.poll(async () => (await savedQueue(page)).commands.length).toBe(0);
  const beforeJournal = await read(page);
  const beforeState = await economicState(page);
  const [purchase, sale] = beforeJournal.tradeEconomy.receipts;
  await page.getByText("Trade receipts · 2", { exact: true }).click();
  const purchaseRow = page.locator(`[id="trade-receipt-${encodeURIComponent(purchase.id)}"]`);
  await purchaseRow.getByRole("button", { name: "Review reversal", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Review trade reversal", exact: true });
  const reason = modal.getByLabel("Reason for trade reversal", { exact: true });
  await reason.fill("Restore the original purchase after its goods changed");
  await modal.getByRole("button", { name: "Reverse trade", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText(
    "The traded items have changed or left this account.",
  );
  await expect(reason).toHaveValue("Restore the original purchase after its goods changed");
  assert.deepEqual(
    await economicState(page),
    beforeState,
    "Rejected reversal leaves all money, goods and ledger rows unchanged",
  );
  assert.deepEqual((await read(page)).tradeEconomy, beforeJournal.tradeEconomy);
  assert.equal(
    (await savedQueue(page)).commands.length,
    0,
    "A rejected reversal does not queue an action",
  );
  await modal.getByRole("button", { name: "Close reversal review", exact: true }).click();
  const saleRow = page.locator(`[id="trade-receipt-${encodeURIComponent(sale.id)}"]`);
  await saleRow.getByRole("button", { name: "Review reversal", exact: true }).click();
  await reason.fill("Correct the recorded timber sale");
  let blockedReversals = 0;
  let submittedReversals = 0;
  let releaseOnRetry = "";
  let holdReversal = true;
  // Hold only this action's transport. Keep the handler installed during recovery;
  // background reads continue normally and cannot acknowledge an unsent reversal.
  await page.route("**/_serverFn/**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) return route.fallback();
    if (!(request.postData() || "").includes('"ledger-void"')) return route.continue();
    if (
      holdReversal &&
      releaseOnRetry &&
      (await page.evaluate((key) => window[key] === true, releaseOnRetry))
    )
      holdReversal = false;
    if (holdReversal) {
      blockedReversals++;
      return route.abort("failed");
    }
    submittedReversals++;
    return route.continue();
  });
  await modal.getByRole("button", { name: "Reverse trade", exact: true }).click();
  await expect.poll(() => blockedReversals).toBeGreaterThan(0);
  await expect(
    modal.getByRole("status").filter({ hasText: "Action accepted as pending." }),
  ).toBeVisible();
  await expect.poll(async () => (await read(page)).tradeEconomy.receipts.length).toBe(3);
  await expect(reason).toHaveValue("Correct the recorded timber sale");
  await expect(modal.getByRole("button", { name: "Reverse trade", exact: true })).toBeDisabled();
  const pending = await savedQueue(page);
  assert.equal(
    pending.commands.length,
    1,
    `The pending queue contains only the reviewed reversal; found ${pending.commands.map((command) => command.kind).join(", ")}`,
  );
  assert.equal(pending.commands[0].kind, "ledger-void");
  assert.deepEqual(pending.commands[0].target, { kind: "trade", id: sale.id });
  assert.equal(pending.commands[0].reason, "Correct the recorded timber sale");
  await fits(page);
  await page.screenshot({ path: `${output}/reversal-pending-${width}.png`, fullPage: true });
  await modal.getByRole("button", { name: "Close reversal review", exact: true }).click();
  await navigateApplication(page, origin + "/share");
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  if (!(await retry.isVisible()))
    await page.getByRole("button", { name: /^Connection & recovery/ }).click();
  await expect(retry).toBeVisible();
  assert.deepEqual(
    await savedQueue(page),
    pending,
    "Navigation retains the exact pending reversal",
  );
  releaseOnRetry = `__lootsplitTradeRetry_${crypto.randomUUID()}`;
  await retry.evaluate((button, key) => {
    window[key] = false;
    button.addEventListener(
      "click",
      (event) => {
        window[key] = event.isTrusted;
      },
      { capture: true, once: true },
    );
    button.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  }, releaseOnRetry);
  await retry.click();
  assert.equal(await page.evaluate((key) => window[key], releaseOnRetry), true);
  await expect.poll(async () => (await savedQueue(page)).commands.length).toBe(0);
  assert.equal(submittedReversals, 1, "Retry submits the original reversal once");
  await page.evaluate((key) => {
    delete window[key];
  }, releaseOnRetry);
  releaseOnRetry = "";
  await navigateApplication(page, origin + "/features/economy");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Live · Room online · Play active · Saved to room" }),
  ).toBeVisible();
  await page.getByText("Trade receipts · 3", { exact: true }).click();
  const afterJournal = await read(page);
  const afterState = await economicState(page);
  const correction = afterJournal.tradeEconomy.receipts.at(-1);
  assert.equal(correction.reversalOf, sale.id);
  assert.equal(correction.epoch, 3);
  assert.equal(correction.reversalReason, "Correct the recorded timber sale");
  assert.deepEqual(
    afterJournal.tradeEconomy.receipts.slice(0, 2),
    beforeJournal.tradeEconomy.receipts,
    "Original trade receipts stay immutable",
  );
  assert.deepEqual(
    afterJournal.tradeEconomy.history,
    beforeJournal.tradeEconomy.history,
    "Correcting a past trade does not rewrite settled seasons",
  );
  assert.deepEqual(afterJournal.tradeEconomy.draws, beforeJournal.tradeEconomy.draws);
  assert.equal(
    afterJournal.tradeEconomy.exchanges[0].offers[0].stock,
    beforeJournal.tradeEconomy.exchanges[0].offers[0].stock - sale.quantity,
  );
  assert.equal(
    toCopper(afterState.purses.find((p) => p.id === "a").coins),
    toCopper(beforeState.purses.find((p) => p.id === "a").coins) - sale.copper,
  );
  assert.equal(
    toCopper(afterState.purses.find((p) => p.id === "exchange-treasury").coins),
    toCopper(beforeState.purses.find((p) => p.id === "exchange-treasury").coins) + sale.copper,
  );
  assert.equal(
    afterState.holdings.find((h) => h.commodityId).quantity,
    beforeState.holdings.find((h) => h.commodityId).quantity + sale.quantity,
  );
  await fits(page);
  await page.screenshot({ path: `${output}/reversal-${width}.png`, fullPage: true });
  await expect(saleRow.getByRole("button", { name: "Review reversal", exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("article", { name: "Reversal: Building timber · season 3", exact: true }),
  ).toContainText("Reversal of sale");
  // A separate owner's real trade proves the player receipt list is permission-scoped.
  const exchange = page.getByRole("region", { name: "Harbor Exchange", exact: true });
  await exchange.getByLabel("Trading account", { exact: true }).selectOption("b");
  await exchange.getByRole("button", { name: "Buy commodity", exact: true }).click();
  await expect.poll(async () => (await read(page)).tradeEconomy.receipts.length).toBe(4);
  const invitation = await page.evaluate(() => {
    const id = localStorage.getItem("quire.campaign.v1") || "main";
    const session = JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`));
    return { code: session.code, sessionId: session.sessionId };
  });
  const player = await extraDevice(width, true);
  await openApplication(
    player,
    `${origin}/share?join=${invitation.code}&session=${invitation.sessionId}`,
  );
  await player.getByRole("button", { name: "Find characters", exact: true }).click();
  await player.getByLabel("Your name", { exact: true }).fill("Trade history audit player");
  await player
    .getByRole("combobox", { name: "Choose your character", exact: true })
    .selectOption("a");
  await player.getByRole("button", { name: "Join room", exact: true }).click();
  await player.getByText("You joined as a player", { exact: true }).waitFor();
  await navigateApplication(player, origin + "/features/economy");
  const playerExchange = player.getByRole("region", { name: "Harbor Exchange", exact: true });
  await expect(
    playerExchange.getByText(
      "Exchange balance is private. Purchases and sales check available funds when submitted.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(playerExchange.getByText(/^Treasury /)).toHaveCount(0);
  await expect(
    playerExchange.getByText(
      "Seasonal history is private. Current exchange quotes, stock and indices are shown above.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(playerExchange.getByRole("table")).toHaveCount(0);
  await expect(playerExchange.getByText(/^Recorded quote data/)).toHaveCount(0);
  await player.getByText("Trade receipts · 3", { exact: true }).click();
  await expect(player.getByRole("article").filter({ hasText: "Account: Arden" })).toHaveCount(3);
  await expect(player.getByRole("article").filter({ hasText: "Account: Briar" })).toHaveCount(0);
  await expect(player.getByText(/^Seasonal history ·/)).toHaveCount(0);
  await expect(player.getByRole("button", { name: "Review reversal", exact: true })).toHaveCount(0);
  await playerExchange.getByLabel("Trade direction", { exact: true }).selectOption("sell");
  const lot = await playerExchange
    .getByLabel("Commodity lot", { exact: true })
    .locator("option")
    .nth(1)
    .getAttribute("value");
  await playerExchange.getByLabel("Commodity lot", { exact: true }).selectOption(lot);
  await expect(
    playerExchange.getByRole("button", { name: "Sell commodity", exact: true }),
  ).toBeEnabled();
  await fits(player);
  await player.screenshot({ path: `${output}/player-history-${width}.png`, fullPage: true });
  await player.context().close();
  current = page;
}

async function fits(page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Exchange controls fit the viewport",
  );
  assert.equal(await page.locator("[data-title-screen]").count(), 0);
}

async function commodityBoardViews(page, width) {
  const fixture = completeHistoryFixture(),
    economy = fixture.journal.tradeEconomy;
  for (const [id, name, category] of [
    ["grain", "Golden grain", "provisions"],
    ["iron", "Iron ingots", "smith"],
    ["cloth", "Woven cloth", "cloth"],
    ["herbs", "Healing herbs", "apothecary"],
  ]) {
    economy.commodities.push({
      ...economy.commodities[0],
      id,
      name,
      category,
      description: "Board audit goods",
      unit: "bundle",
    });
    economy.exchanges[0].offers.push({
      ...economy.exchanges[0].offers[0],
      commodityId: id,
      stock: 45,
      askCopper: 110,
      bidCopper: 55,
    });
  }
  economy.exchanges.push({
    ...structuredClone(economy.exchanges[0]),
    id: "inland",
    name: "Inland Exchange",
    locationId: "desert",
    open: false,
  });
  economy.exchanges.push({
    ...structuredClone(economy.exchanges[0]),
    id: "empty",
    name: "Empty Exchange",
    notes: "New exchange awaiting supplies",
    offers: [],
  });
  await seed(page, fixture);
  await reloadApplication(page);
  await page.getByText("Exchange directory · 3", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Empty Exchange exchange profile", exact: true }),
  ).toContainText("New exchange awaiting supplies");
  await page.getByText("Exchange directory · 3", { exact: true }).click();
  const board = page.getByRole("region", { name: "Commodity quotes", exact: true });
  const timber = page.getByRole("button", {
    name: "View Current timber label at Current Harbor Exchange",
    exact: true,
  });
  const grain = page.getByRole("button", {
    name: "View Golden grain at Current Harbor Exchange",
    exact: true,
  });
  await expect(board.getByRole("button", { name: /^View / })).toHaveCount(8);
  await page.getByRole("button", { name: "Show all 10 quotes", exact: true }).click();
  await expect(board.getByRole("button", { name: /^View / })).toHaveCount(10);
  await page.getByRole("button", { name: "Show fewer quotes", exact: true }).click();
  await expect(board.getByRole("button", { name: /^View / })).toHaveCount(8);
  await page.getByRole("button", { name: "Show all 10 quotes", exact: true }).click();
  await expect(timber).toContainText("+899.00%");
  const selected = page.getByRole("region", { name: "Current Harbor Exchange", exact: true });
  await selected.getByRole("button", { name: "All recorded", exact: true }).click();
  await selected.getByText("Recorded quote data · 24", { exact: true }).click();
  const prices = selected.getByRole("table");
  await expect(prices.getByRole("row")).toHaveCount(25);
  await expect(prices).toContainText(formatCopper(777));
  await expect(prices).not.toContainText(formatCopper(999));
  await selected.getByText("Recorded quote data · 24", { exact: true }).click();
  await selected.getByRole("button", { name: "Recent 12", exact: true }).click();
  await page.getByLabel("Search commodities", { exact: true }).fill("golden");
  await expect(board.getByRole("button", { name: /^View / })).toHaveCount(2);
  await grain.click();
  await selected.getByLabel("Trade quantity", { exact: true }).fill("7");
  await selected.getByLabel("Trading account", { exact: true }).selectOption("b");
  await page.getByLabel("Search commodities", { exact: true }).fill("");
  await timber.click();
  await grain.click();
  await expect(selected.getByLabel("Trade quantity", { exact: true })).toHaveValue("7");
  await expect(selected.getByLabel("Trading account", { exact: true })).toHaveValue("b");
  await selected.getByLabel("Trade quantity", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Smith", exact: true }).click();
  await expect(board.getByRole("button", { name: /^View / })).toHaveCount(2);
  await page.getByRole("button", { name: "All goods", exact: true }).click();
  await chooseOption(
    page.getByRole("combobox", { name: "Exchange filter", exact: true }),
    "inland",
  );
  await expect(board.getByRole("button", { name: /^View / })).toHaveCount(5);
  await page.getByLabel("Open & active only", { exact: true }).check();
  await expect(board).toContainText("No matching quotes");
  await page.getByLabel("Open & active only", { exact: true }).uncheck();
  await chooseOption(page.getByRole("combobox", { name: "Exchange filter", exact: true }), "");
  await timber.click();
  const frozen = JSON.stringify((await read(page)).tradeEconomy);
  await fits(page);
  await page.screenshot({ path: `${output}/commodity-board-dark-${width}.png`, fullPage: true });
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem("quire.prefs.v1") || "{}");
    localStorage.setItem(
      "quire.prefs.v1",
      JSON.stringify({ ...prefs, appearance: "light", accent: "#7c3224", ground: "#dfcca2" }),
    );
  });
  await reloadApplication(page);
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  await expect(timber).toBeVisible();
  await expect(selected.getByRole("button", { name: "Buy commodity", exact: true })).toBeVisible();
  if (width === 390) {
    await page.setViewportSize({ width: 320, height: 950 });
    await fits(page);
    await page.screenshot({ path: `${output}/commodity-board-light-320.png`, fullPage: true });
    await page.setViewportSize({ width, height: 950 });
  }
  await fits(page);
  await page.screenshot({ path: `${output}/commodity-board-light-${width}.png`, fullPage: true });
  await page.evaluate(() => {
    window.__commodityDocument = crypto.randomUUID();
  });
  const documentId = await page.evaluate(() => window.__commodityDocument);
  await page.getByRole("link", { name: "Market", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Global market", exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Global commodity quotes", exact: true }).getByRole("link"),
  ).toHaveCount(10);
  await expect(page.locator(".commodity-sector")).toHaveCount(5);
  if (width === 1440) {
    const sectors = await page
      .locator(".commodity-sectors")
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    assert.equal(sectors, 4, "Desktop groups global quotes into four columns");
  }
  await page.screenshot({ path: `${output}/global-market-${width}.png`, fullPage: true });
  await page
    .getByRole("link", { name: "View Iron ingots at Inland Exchange", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Inland Exchange", exact: true })
      .getByRole("heading", { name: "Iron ingots", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Exchange filter", exact: true }),
  ).toHaveAttribute("data-value", "inland");
  assert.equal(
    await page.evaluate(() => window.__commodityDocument),
    documentId,
    "Global quote links retain the running document",
  );
  assert.equal(await page.locator("[data-title-screen]").count(), 0);
  // A cold document hydrates campaign data after the board first mounts.
  // The linked exchange/good must still be selected once that data arrives.
  await reloadApplication(page);
  await expect(
    page
      .getByRole("region", { name: "Inland Exchange", exact: true })
      .getByRole("heading", { name: "Iron ingots", exact: true }),
  ).toBeVisible();
  assert.equal(
    JSON.stringify((await read(page)).tradeEconomy),
    frozen,
    "Browsing never changes the saved economy",
  );
  await page.evaluate(() => localStorage.removeItem("quire.prefs.v1"));
}
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      hasTouch: width === 390,
      serviceWorkers: "block",
    });
    await context.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (route) => route.abort(),
    );
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    current = page;
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/features/economy");
    await page.getByRole("heading", { name: "Trade Exchanges", exact: true }).waitFor();
    await commodityBoardViews(page, width);
    await seed(page, tradeFixture());
    await openApplication(page, origin + "/features/economy");
    const exchange = page.getByRole("region", { name: "Harbor Exchange" });
    await expect(
      exchange.getByRole("heading", { name: "Harbor Exchange", exact: true }),
    ).toBeVisible();
    await exchange.getByLabel("Trading account", { exact: true }).selectOption("a");
    await exchange.getByLabel("Purchase destination", { exact: true }).selectOption("warehouse");
    await exchange.getByLabel("Trade quantity", { exact: true }).fill("10");
    await exchange.getByRole("button", { name: "Buy commodity", exact: true }).click();
    await expect.poll(async () => (await read(page)).tradeEconomy.receipts.length).toBe(1);
    assert.equal((await read(page)).tradeEconomy.exchanges[0].offers[0].askCopper, 100);
    await exchange.getByLabel("Trade direction", { exact: true }).selectOption("sell");
    const lotId = await exchange
      .getByLabel("Commodity lot", { exact: true })
      .locator("option")
      .nth(1)
      .getAttribute("value");
    await exchange.getByLabel("Commodity lot", { exact: true }).selectOption(lotId);
    await exchange.getByLabel("Trade quantity", { exact: true }).fill("2");
    await exchange.getByRole("button", { name: "Sell commodity", exact: true }).click();
    await expect.poll(async () => (await read(page)).tradeEconomy.receipts.length).toBe(2);
    await fits(page);
    await page.screenshot({ path: `${output}/exchange-${width}.png`, fullPage: true });
    // Existing drafts are deliberately retained, so clear the quantity before navigation.
    await exchange.getByLabel("Trade quantity", { exact: true }).fill("1");
    await exchange.getByLabel("Commodity lot", { exact: true }).selectOption("");
    await exchange.getByLabel("Trade direction", { exact: true }).selectOption("buy");
    await exchange.getByLabel("Purchase destination", { exact: true }).selectOption("");
    await navigateApplication(page, origin + "/features/downtime");
    await page.getByText("Set downtime & review calculations", { exact: true }).click();
    await page
      .getByLabel("Downtime description", { exact: true })
      .fill("Session-end economic settlement");
    await page.getByLabel("In-game days", { exact: true }).fill("7");
    await page
      .getByRole("checkbox", {
        name: "Settle one new market season with this downtime",
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "Preview downtime", exact: true }).click();
    await expect(page.getByRole("region", { name: "Seasonal settlement preview" })).toBeVisible();
    const before = await read(page),
      draws = before.tradeEconomy.draws;
    await page.getByRole("button", { name: "Recalculate downtime", exact: true }).click();
    await expect.poll(async () => (await read(page)).finance.downtime.length).toBe(2);
    assert.deepEqual((await read(page)).tradeEconomy.draws, draws);
    await fits(page);
    await page.screenshot({ path: `${output}/downtime-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Approve downtime now", exact: true }).click();
    await expect.poll(async () => (await read(page)).tradeEconomy.epoch).toBe(1);
    assert.equal((await read(page)).finance.day, 7);
    await navigateApplication(page, origin + "/features/economy");
    await page.getByText("Manual season control & DM overrides", { exact: true }).click();
    await page.getByLabel("Next season", { exact: true }).selectOption("0");
    await page.getByRole("button", { name: "Prepare manual season", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Approve manual season", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve manual season", exact: true }).click();
    await expect.poll(async () => (await read(page)).tradeEconomy.epoch).toBe(2);
    assert.equal((await read(page)).finance.day, 7);
    // Exercise real account room persistence and authoritative planning, never a auth bypass.
    await createAndSaveRoom(page, origin, (p, o, path) => navigateApplication(p, o + path));
    await navigateApplication(page, origin + "/share");
    const live = page
      .getByRole("group", { name: "Session mode", exact: true })
      .getByRole("button", { name: "Live", exact: true });
    await expect(live).toHaveAttribute("aria-pressed", "true");
    await navigateApplication(page, origin + "/features/economy");
    // Mobile may open a fresh document when no visible link reaches this screen.
    // Await authoritative room hydration before opening controls: changing room
    // identity deliberately resets the feature screen's drafts.
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Live · Room online · Play active · Saved to room" }),
    ).toBeVisible();
    await page.getByText("Manual season control & DM overrides", { exact: true }).click();
    await page.getByRole("button", { name: "Prepare manual season", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Approve manual season", exact: true }),
    ).toBeVisible();
    const shared = await read(page);
    assert.ok(shared.tradeEconomy.draws.some((d) => d.epoch === 3 && d.source === "server"));
    await page.getByRole("button", { name: "Approve manual season", exact: true }).click();
    await expect.poll(async () => (await read(page)).tradeEconomy.epoch).toBe(3);
    // The epoch is optimistic. Wait for the authoritative acknowledgement before
    // the deliberate cold reload, so it cannot interrupt the approval transport.
    await expect
      .poll(async () => (await savedQueue(page)).commands.length, { timeout: 20000 })
      .toBe(0);
    await reloadApplication(page);
    await expect(page.getByRole("heading", { name: "Trade Exchanges", exact: true })).toBeVisible();
    assert.equal((await read(page)).tradeEconomy.epoch, 3);
    await fits(page);
    await reversalAndPlayerViews(page, width);
    await context.close();
    await historyPages(width);
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/summary.json`,
    JSON.stringify(
      {
        elapsedMs: Date.now() - started,
        widths: [1440, 390],
        canonicalTrades: true,
        stableRolls: true,
        downtimeApproval: true,
        manualOverride: true,
        sharedPersistence: true,
        completeHistoryPagination: true,
        frozenSeasonComparisons: true,
        reviewedReversal: true,
        retainedPendingReversal: true,
        playerReceiptPrivacy: true,
        commodityBoardSearchAndCategories: true,
        commodityExchangeFilters: true,
        retainedTradeDrafts: true,
        recordedPriceCharts: true,
        lightDarkAnd320pxLayout: true,
        globalMarketQuoteNavigation: true,
        runtimeErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(`Trade economy desktop/mobile audit passed (${Date.now() - started} ms).`);
} catch (error) {
  if (current) {
    console.error((await current.locator("body").innerText()).slice(-10000));
    await savedQueue(current)
      .then((queue) => writeFile(`${output}/failure-queue.json`, JSON.stringify(queue, null, 2)))
      .catch(() => {});
    await current.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
