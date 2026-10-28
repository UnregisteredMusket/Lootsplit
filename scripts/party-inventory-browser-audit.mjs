// Party → Funds & inventory (design plan D3 for the DM, P6 for players) in a disposable device
// campaign seeded with the synthetic "Wayfarers" fixture (built by the real command engine):
// one inventory list (no second "Manage holdings & property" copy), shared record rows (icon,
// name, holder, quantity, value, ⋯ menu), the edit sheet saves only on Save, bulk Give / Move to
// pool / Remove apply exactly once (a reload mid-way and a lost reply both resume with the same
// command IDs), Sell to shop opens the shop counter with the item chosen, and for Mira's player
// seat the coin row sits in the first screen, identical rows stack (display only), Equipped
// filters and Add loot is not shown. Page length is bounded at 1280, 390, 320 and 844×390, with no
// sideways scrolling. Never targets a real campaign.
// Run with: node --experimental-strip-types scripts/party-inventory-browser-audit.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { continueIntoApp, openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { answerThemedDialog } from "./themed-dialogs.mjs";
import { buildWayfarers } from "./product-screenshot-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("The party inventory audit changes a disposable campaign; run it only locally.");
const out = "test-results/party-inventory";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
// Funds & inventory with the Wayfarers party (6 accounts, 29 holdings) was 11.8 screens at
// 1280×800, 14.7 at 390×844 and 29.5 at 844×390 (design audit dm #4). The one-list page measured
// 3.9 / 5.5 / 7.7 / 10.6 screens (DM) and 1.7 / 1.7 / 2.2 / 3.7 (Mira's player seat) at 1280, 390,
// 320 and 844×390; each bound adds about half a screen to a screen and a half of headroom.
const VIEWS = [
  { width: 1280, height: 800, dm: 4.5, player: 2.5 },
  { width: 390, height: 844, dm: 6, player: 2.5 },
  { width: 320, height: 760, dm: 8.5, player: 3 },
  { width: 844, height: 390, dm: 12, player: 5 },
];
const table = buildWayfarers();

const books = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    const t = await economySnapshot();
    return { holdings: t.holdings, events: t.journal?.events ?? [] };
  });
const noOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${label}: the page scrolls sideways`,
  );
const screens = (page) =>
  page.evaluate(() => {
    const panel = document.getElementById("party-panel-funds");
    const bottom = panel ? panel.getBoundingClientRect().bottom + scrollY : document.body.scrollHeight;
    return Math.round((bottom / innerHeight) * 10) / 10;
  });
const row = (page, name) =>
  page.locator(".inventory-record").filter({
    has: page.locator(":scope > .record-row-main .record-row-title strong", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( ×\\d+)?$`) }),
  });
const menu = async (page, name, item) => {
  await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).first().click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
};
const lengths = [];
/** Poll `check` (async) until it is true, up to `timeout` ms. */
async function until(page, check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw Error("Timed out waiting for the campaign to change.");
    await page.waitForTimeout(150);
  }
}

try {
  for (const view of VIEWS) {
    const label = `${view.width}x${view.height}`;
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      isMobile: view.width < 600 || view.height < 600,
      hasTouch: view.width < 600 || view.height < 600,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/", { waitUntil: "networkidle" });
    await page.evaluate(async (t) => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      // The fixture's Mira holds "Potion of healing" twice (×2 from her kit, ×1 from an award).
      await applyCloudTable(t);
    }, table);
    await page.goto(origin + "/party?section=funds");
    await continueIntoApp(page);
    await page.locator(".party-inventory").waitFor();

    // --- One FeatureHeader (design plan): eyebrow, title and the primary action together. The
    // full scenery banner greets the first visit; later visits use the compact band (dm-mobile #19).
    const header = page.locator("header.feature-header").first();
    await header.getByRole("heading", { level: 1, name: "Party", exact: true }).waitFor();
    await header.getByText("Party overview", { exact: true }).waitFor();
    const addLoot = header.getByRole("button", { name: "+ Add loot", exact: true });
    await addLoot.waitFor();
    const firstBanner = await page.locator(".submenu-workspace").first().getAttribute("data-banner");
    assert.ok([null, "full"].includes(firstBanner), `${label}: first visit banner is ${firstBanner}`);
    {
      const box = await addLoot.boundingBox();
      assert.ok(box && box.height >= 44 && box.y + box.height <= view.height, `${label}: Add loot is in the first screen`);
    }

    // --- DM: one list, row structure.
    await page.getByRole("heading", { name: "Inventory", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: /Manage holdings/ }).count(), 0, "no second holdings list");
    assert.equal(await page.locator("input[aria-label^='Category for']").count(), 0, "no always-open category editors");
    const t0 = await books(page);
    const party = new Set(["party", "mira", "bram", "rowan", "tamsin"]);
    // Every party holding is one row, except identical entries shown as one stack.
    const keyOf = (h) => [h.purseId, h.name.toLowerCase(), h.unitCopper, h.category ?? "", !!h.equipped, !!h.pool].join("|");
    const counts = new Map();
    for (const h of t0.holdings) counts.set(keyOf(h), (counts.get(keyOf(h)) ?? 0) + 1);
    assert.equal(counts.get(keyOf({ purseId: "mira", name: "Potion of healing", unitCopper: 5000, category: "apothecary" })), 2);
    for (const h of t0.holdings.filter((h) => party.has(h.purseId) && counts.get(keyOf(h)) === 1))
      assert.equal(await page.locator(`[id="holding-${encodeURIComponent(h.id)}"]`).count(), 1, `${h.name} is listed once`);
    const longbow = row(page, "Longbow");
    assert.equal(await longbow.count(), 1, "Longbow is listed once");
    assert.match(await longbow.locator(".record-row-meta").innerText(), /^Mira Ashfall · smith$/);
    await longbow.locator(".record-chip", { hasText: "Equipped" }).waitFor();
    await longbow.locator(".record-row-icon .fantasy-icon, .record-row-icon img").first().waitFor();
    assert.equal(await longbow.locator(".record-row-qty").innerText(), "×1");
    assert.match(await longbow.locator(".record-row-value").innerText(), /50 gp/);
    await page.getByRole("button", { name: "Actions for Longbow", exact: true }).waitFor();
    // Plural custom names use their item family's icon (an arrowhead), not the shop category's sword.
    assert.equal(await row(page, "Arrows").locator(".fantasy-icon").getAttribute("data-icon"), "lorc/arrowhead.svg");
    // Group by holder: one heading per holder; Category regroups.
    await page.getByRole("region", { name: "Mira Ashfall", exact: true }).waitFor();
    await page.getByRole("group", { name: "Group by" }).getByRole("button", { name: "Category", exact: true }).click();
    await page.getByRole("region", { name: "apothecary", exact: true }).waitFor();
    await page.getByRole("group", { name: "Group by" }).getByRole("button", { name: "Holder", exact: true }).click();
    await page.getByLabel("Holder", { exact: true }).selectOption("bram");
    assert.equal(await page.locator(".inventory-group").count(), 1);
    await page.getByLabel("Holder", { exact: true }).selectOption("");
    await page.getByLabel("Find inventory item", { exact: true }).fill("moonstone");
    assert.equal(await page.locator(".inventory-record").count(), 1);
    await page.getByLabel("Find inventory item", { exact: true }).fill("");
    await noOverflow(page, `DM ${label}`);
    const dmScreens = await screens(page);
    lengths.push(`DM ${label}: ${dmScreens} screens`);
    assert.ok(dmScreens <= view.dm, `DM Funds & inventory at ${label} is ${dmScreens} screens (bound ${view.dm})`);
    await page.screenshot({ path: `${out}/dm-${label}.png`, fullPage: true });

    if (view.width === 390) {
      // --- Edit sheet: nothing saves until Save; then a toast.
      await menu(page, "Hooded lantern", "Edit");
      const sheet = page.getByRole("dialog", { name: "Edit Hooded lantern", exact: true });
      await sheet.getByLabel("Category for Hooded lantern", { exact: true }).fill("light");
      await sheet.getByLabel("Item notes", { exact: true }).click();
      await page.waitForTimeout(400);
      assert.equal((await books(page)).holdings.find((h) => h.id === "mira-item-4").category, "general", "no save on blur");
      await sheet.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByText("Saved Hooded lantern.", { exact: true }).waitFor();
      assert.equal((await books(page)).holdings.find((h) => h.id === "mira-item-4").category, "light");
      await sheet.waitFor({ state: "detached" });

      // --- Bulk Give, with a reload while it runs: each entry moves exactly once.
      const names = ["Dwarven ale", "Lamp oil", "Ink and quills"];
      const before = (await books(page)).holdings.filter((h) => names.includes(h.name));
      assert.equal(before.length, 3);
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await page.getByLabel("Select Dwarven ale (Bram Stoneward)", { exact: true }).check();
      await page.getByLabel("Select Lamp oil (Bram Stoneward)", { exact: true }).check();
      await page.getByLabel("Select Ink and quills (Rowan Vale)", { exact: true }).check();
      await page.getByRole("region", { name: "Selected items" }).getByText("3 selected").waitFor();
      await page.getByRole("region", { name: "Selected items" }).getByRole("button", { name: "Give", exact: true }).click();
      const give = page.getByRole("dialog", { name: "Give selected items", exact: true });
      await give.getByLabel("Give selected items to", { exact: true }).selectOption("tamsin");
      await give.getByRole("button", { name: "Give 3 entries", exact: true }).click();
      // Reload as soon as the first entry has moved, while the rest may still be running.
      await until(page, async () => {
        const t = await books(page);
        return before.some((h) => !t.holdings.some((x) => x.id === h.id && x.purseId === h.purseId));
      });
      await reloadApplication(page);
      await page.locator(".party-inventory").waitFor();
      const resume = page.getByRole("button", { name: "Resume", exact: true });
      if (await resume.isVisible().catch(() => false)) await resume.click();
      await until(page, async () => {
        const t = await books(page);
        return before.every((h) => t.holdings.some((x) => x.name === h.name && x.purseId === "tamsin"));
      });
      const afterGive = await books(page);
      for (const h of before) {
        const at = afterGive.holdings.filter((x) => x.name === h.name);
        assert.deepEqual(at.map((x) => [x.purseId, x.quantity]), [["tamsin", h.quantity]], `${h.name} moved once`);
      }

      // --- A lost reply: the first pool command applied but the page never heard; Resume skips it.
      await page.evaluate(async () => {
        const { executeLocalCommand } = await import("/src/lib/quire/economy.ts");
        await executeLocalCommand({ id: "audit-pool-a", kind: "loot-pool-set", holdingId: "party-circlet", pooled: true });
        sessionStorage.setItem(
          "lootsplit.inventory-bulk.v1",
          JSON.stringify({
            id: "audit-run",
            action: "pool",
            items: [
              { holdingId: "party-circlet", purseId: "party", commandId: "audit-pool-a" },
              { holdingId: "party-moonstone", purseId: "party", commandId: "audit-pool-b" },
            ],
          }),
        );
      });
      await reloadApplication(page);
      await page.locator(".party-inventory").waitFor();
      await page.getByText(/Move to pool stopped after 0 of 2/).waitFor();
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await page.getByText("Put 1 entry in the treasure pool.", { exact: true }).waitFor();
      const pooled = await books(page);
      assert.deepEqual(
        pooled.holdings.filter((h) => h.pool).map((h) => h.id).sort(),
        ["party-circlet", "party-moonstone"],
      );
      for (const name of ["Sapphire circlet", "Moonstone"])
        assert.equal(
          pooled.events.filter((e) => String(e.summary ?? e.text ?? "").startsWith(`Put in the treasure pool: ${name}`)).length,
          1,
          `${name} pooled once`,
        );
      await row(page, "Moonstone").locator(".record-chip", { hasText: "In the pool" }).waitFor();

      // --- Bulk Remove asks with the themed confirmation, then removes once.
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await page.getByLabel("Select Tarnished bronze key (The Wayfarers’ purse)", { exact: true }).check();
      await page.getByRole("region", { name: "Selected items" }).getByRole("button", { name: "Remove", exact: true }).click();
      const asked = await answerThemedDialog(page);
      assert.match(asked, /Remove Tarnished bronze key\?/);
      await page.getByText("Removed 1 entry.", { exact: true }).waitFor();
      assert.equal((await books(page)).holdings.some((h) => h.id === "party-key"), false);

      // --- Sell to shop: the counter opens with the item chosen.
      await menu(page, "Arrows", "Sell to shop");
      await page.getByRole("dialog", { name: "Sell Arrows" }).getByRole("link", { name: /The Brass Lantern/ }).click();
      await page.waitForURL((url) => url.pathname === "/shop/lantern" && url.searchParams.get("sell") === "mira-item-2");
      assert.equal(await page.getByLabel("Item to sell", { exact: true }).getAttribute("data-value"), "mira-item-2");
      await page.goto(origin + "/party?section=funds");
      await continueIntoApp(page);
      await page.locator(".party-inventory").waitFor();
    }

    // --- Touch targets (design plan M1, A7): character cards have no 13 px checkboxes, and the
    // per-field permissions live in a sheet behind "Permissions…" with 44 px rows.
    await page.goto(origin + "/party?section=characters");
    await continueIntoApp(page);
    const card = page.locator(".party-profile").first();
    await card.waitFor();
    const boxes = (scope) =>
      scope.locator("input[type=checkbox]").evaluateAll((all) =>
        all
          .filter((e) => e.getClientRects().length)
          .map((e) => {
            const box = e.getBoundingClientRect(),
              row = e.closest("label")?.getBoundingClientRect();
            return { name: e.getAttribute("aria-label") || e.closest("label")?.textContent?.trim(), w: box.width, h: box.height, row: row?.height ?? 0 };
          }),
      );
    for (const box of await boxes(page.locator(".party-profile"))) {
      assert.ok(box.w >= 24 && box.h >= 24, `${label}: ${box.name} checkbox is ${box.w}×${box.h}`);
      assert.ok(box.row >= 44, `${label}: ${box.name} row is ${box.row} px`);
    }
    assert.equal(await page.locator(".party-profile details.character-permissions").count(), 0, "permissions moved to a sheet");
    await card.getByLabel("Allow character editing", { exact: true }).waitFor();
    await card.getByRole("button", { name: "Permissions…", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: /· Individual permissions$/ });
    await sheet.waitFor();
    const fields = await boxes(sheet);
    assert.ok(fields.length >= 5, `${label}: the sheet lists the per-field permissions`);
    for (const box of fields) {
      assert.ok(box.w >= 24 && box.h >= 24, `${label}: ${box.name} checkbox is ${box.w}×${box.h}`);
      assert.ok(box.row >= 44, `${label}: ${box.name} row is ${box.row} px`);
    }
    await noOverflow(page, `permissions sheet ${label}`);
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });

    // --- Mira's player seat.
    await page.evaluate(async () => {
      const { setSeat } = await import("/src/lib/quire/table.ts");
      setSeat({ role: "player", purseIds: ["mira"], shopIds: ["lantern"], openedAt: Date.now() });
    });
    await page.goto(origin + "/party?section=funds");
    await continueIntoApp(page);
    await page.locator(".party-inventory").waitFor();
    assert.equal(await page.getByRole("button", { name: "+ Add loot" }).count(), 0, "players do not see Add loot");
    // A revisit uses the compact banner, so the title stays high on the first screen.
    if (firstBanner)
      assert.equal(await page.locator(".submenu-workspace").first().getAttribute("data-banner"), "compact");
    {
      const title = await page.locator("header.feature-header h1").first().boundingBox();
      assert.ok(title && title.y + title.height <= Math.min(view.height, 360), `${label}: compact header title at ${title?.y}`);
    }
    const strip = page.getByRole("region", { name: "Coins", exact: true });
    await strip.getByRole("button", { name: "Give", exact: true }).waitFor();
    // Split runs on the DM's device or in a shared room, never on a player-only device link.
    assert.equal(await strip.getByRole("button", { name: "Split", exact: true }).count(), 0);
    for (const unit of ["pp", "gp", "ep", "sp", "cp"]) await strip.locator("abbr", { hasText: unit }).waitFor();
    if (view.height >= 760) {
      const box = await strip.boundingBox();
      assert.ok(box && box.y + box.height <= view.height, `${label}: the coin row is in the first screen`);
    }
    // Identical potions show as one stack that expands to the real entries.
    const potions = row(page, "Potion of healing");
    assert.equal(await potions.count(), 1);
    assert.equal(await potions.locator(".record-row-title strong").first().innerText(), "Potion of healing ×3");
    await page.getByRole("button", { name: "Show the 2 entries of Potion of healing", exact: true }).click();
    await page.locator('[id="holding-mira-item-3"]').waitFor();
    assert.equal(await potions.locator(".record-row-children > .record-row").count(), 2);
    // Equipped filter.
    await page.getByRole("button", { name: "Equipped · 2", exact: true }).click();
    assert.deepEqual(
      (await page.locator(".inventory-record .record-row-title strong").allInnerTexts()).sort(),
      ["Longbow", "Studded leather armour"],
    );
    await page.getByRole("button", { name: "Equipped · 2", exact: true }).click();
    // A player's menu has Give and Sell to shop, never the DM's edits.
    await page.getByRole("button", { name: "Actions for Arrows", exact: true }).click();
    await page.getByRole("menuitem", { name: "Give", exact: true }).waitFor();
    assert.equal(await page.getByRole("menuitem", { name: "Remove" }).count(), 0);
    assert.equal(await page.getByRole("menuitem", { name: "Edit" }).count(), 0);
    await page.keyboard.press("Escape");
    // The fold keeps the account details reachable.
    await page.getByText("Wallets, transfers & property", { exact: true }).waitFor();
    await noOverflow(page, `player ${label}`);
    const playerScreens = await screens(page);
    lengths.push(`player ${label}: ${playerScreens} screens`);
    assert.ok(playerScreens <= view.player, `player Funds & inventory at ${label} is ${playerScreens} screens (bound ${view.player})`);
    await page.screenshot({ path: `${out}/player-${label}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(lengths.join("\n"));
  console.log(
    "PASS: one inventory list with shared record rows, edit sheet saves on Save, bulk Give / Move to pool / Remove exactly once across a reload and a lost reply, Sell to shop preselects, player coin row in the first screen, stacking, Equipped filter, at 1280/390/320 and 844x390 without sideways scrolling.",
  );
} finally {
  await browser.close();
}
