import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.ENCOUNTER_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
await mkdir("test-results/local-encounters", { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openApplication(page, origin + "/encounters");
  await page.getByRole("button", { name: "New encounter", exact: true }).click();
  await page.getByRole("button", { name: "Add combatant", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Local ghoul");
  await page.getByRole("button", { name: "Save encounter", exact: true }).click();
  await page.getByText("Encounter saved.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Builder & generator", exact: true }).click();
  await page.route("https://api.open5e.com/v2/creatures/**", (route) =>
    route.fulfill({
      json: {
        results: [
          {
            key: "srd-2014_goblin",
            name: "Goblin",
            document: { key: "srd-2014" },
            hit_points: 7,
            armor_class: 15,
            challenge_rating: 0.25,
            experience_points: 50,
            initiative_bonus: 2,
            type: { name: "Humanoid" },
            environments: [{ name: "Forest" }],
            traits: [],
            actions: [],
          },
        ],
        next: null,
      },
    }),
  );
  await page.getByLabel("Enemy name or type", { exact: true }).fill("goblin");
  await page.getByRole("button", { name: "Search enemy index", exact: true }).click();
  await page.getByRole("button", { name: "Add Goblin", exact: true }).waitFor();
  await page.getByRole("button", { name: "Generate & add enemies", exact: true }).click();
  await page.getByText(/Added .* enemies/).waitFor();
  await page.getByLabel("Encounter name", { exact: true }).fill("Device ambush");
  await page.getByRole("button", { name: "Save encounter", exact: true }).click();
  await page.getByText("Encounter saved.", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/local-encounters/desktop.png", fullPage: true });
  await reloadApplication(page);
  await page.getByRole("button", { name: /Device ambush/ }).click();
  await page.getByText("Saved on this device", { exact: true }).waitFor();
  // Exercise local persistence, validation, transactions, recipient checks, and role enforcement.
  const result = await page.evaluate(async () => {
    const { localEncounterRequest: call } = await import("/src/lib/encounters/local.ts");
    const { blankEncounter, blankLoot } = await import("/src/lib/encounters/model.mjs");
    const { snapshot, restore } = await import("/src/lib/quire/economy.ts");
    const { getSeat, setSeat } = await import("/src/lib/quire/table.ts");
    const list = await call("encounters");
    const id = list.encounters[0].id;
    let d = await call("encounters/detail", { id });
    const original = d.revision;
    await call("encounters/save", { id, revision: original, encounter: d.body });
    let stale = false;
    try {
      await call("encounters/save", { id, revision: original, encounter: d.body });
    } catch {
      stale = true;
    }
    d = await call("encounters/detail", { id });
    const key = crypto.randomUUID();
    const roll = {
      id,
      revision: d.revision,
      requestKey: key,
      formula: "1d20",
      manual: true,
      total: 17,
    };
    await call("encounters/roll", roll);
    await call("encounters/roll", roll);
    const logs = await call("encounters/log", { id });
    const p = d.purses.find((p) => p.kind === "party");
    d.body.coins.gp = 7;
    d.body.coinPurseId = p.id;
    d.body.loot = [{ ...blankLoot(), name: "Local relic", purseId: "missing-recipient" }];
    await call("encounters/save", { id, revision: d.revision, encounter: d.body });
    d = await call("encounters/detail", { id });
    await call("encounters/conclude", { id, revision: d.revision });
    d = await call("encounters/detail", { id });
    const before = await snapshot();
    let invalid = false;
    try {
      await call("encounters/award", { id, revision: d.revision });
    } catch {
      invalid = true;
    }
    const afterFailed = await snapshot();
    d.body.loot[0].purseId = p.id;
    await call("encounters/save", { id, revision: d.revision, encounter: d.body });
    d = await call("encounters/detail", { id });
    // Concurrent retries must share a single transaction receipt.
    const awards = await Promise.all([
      call("encounters/award", { id, revision: d.revision }),
      call("encounters/award", { id, revision: d.revision }),
    ]);
    const after = await snapshot();
    await restore(after);
    const restored = await call("encounters/detail", { id });
    const { setCloudWatch, getCloudWatch } = await import("/src/lib/quire/cloud-turn.ts");
    const tableBody = blankEncounter();
    tableBody.tables = [
      {
        id: "test-table",
        name: "Local table",
        selected: null,
        entries: [{ weight: 3, loot: { ...blankLoot(), purseId: p.id } }],
      },
    ];
    const tableId = (await call("encounters/create", { encounter: tableBody })).id;
    let unresolved = false;
    try {
      await call("encounters/conclude", { id: tableId, revision: 0 });
    } catch {
      unresolved = true;
    }
    const drawn = await call("encounters/roll", {
      id: tableId,
      revision: 0,
      tableId: "test-table",
      requestKey: crypto.randomUUID(),
    });
    tableBody.tables[0].selected = drawn.selected;
    await call("encounters/save", { id: tableId, revision: 0, encounter: tableBody });
    await call("encounters/conclude", { id: tableId, revision: 1 });
    await call("encounters/conclude", { id: tableId, revision: 2 });
    const resolved = await call("encounters/detail", { id: tableId });
    const watch = getCloudWatch();
    setCloudWatch({ joined: true, mine: true, live: true, who: "DM" }, false);
    let sharedBlocked = false;
    try {
      await call("encounters/award", { id: tableId, revision: resolved.revision });
    } catch {
      sharedBlocked = true;
    }
    setCloudWatch(watch, false);
    const remainsReview = (await call("encounters/detail", { id: tableId })).status === "review";
    const oldSeat = getSeat();
    setSeat({ ...oldSeat, role: "player" });
    let denied = false;
    try {
      await call("encounters");
    } catch {
      denied = true;
    }
    setSeat(oldSeat);
    return {
      unresolved,
      sharedBlocked,
      remainsReview,
      resolvedLoot: resolved.body.loot.length,
      stale,
      invalid,
      denied,
      logCount: logs.rolls.length,
      manual: logs.rolls[0].source,
      failedCoinsUnchanged: JSON.stringify(before.purses) === JSON.stringify(afterFailed.purses),
      failedHoldingsUnchanged:
        JSON.stringify(before.holdings) === JSON.stringify(afterFailed.holdings),
      coinsAdded:
        after.purses.find((x) => x.id === p.id).coins.gp -
        before.purses.find((x) => x.id === p.id).coins.gp,
      itemsAdded: after.holdings.length - before.holdings.length,
      oneReceipt: awards[0].award.receiptId === awards[1].award.receiptId,
      restoredStatus: restored.status,
      body: blankEncounter(),
    };
  });
  assert.equal(result.unresolved, true);
  assert.equal(result.sharedBlocked, true);
  assert.equal(result.remainsReview, true);
  assert.equal(result.resolvedLoot, 1);
  assert.equal(result.stale, true);
  assert.equal(result.invalid, true);
  assert.equal(result.denied, true);
  assert.equal(result.logCount, 1);
  assert.equal(result.manual, "manual");
  assert.equal(result.failedCoinsUnchanged, true);
  assert.equal(result.failedHoldingsUnchanged, true);
  assert.equal(result.coinsAdded, 7);
  assert.equal(result.itemsAdded, 1);
  assert.equal(result.oneReceipt, true);
  assert.equal(result.restoredStatus, "awarded");
  // Import a portable account-style export without an account, then build offline.
  result.body.name = "Imported account draft";
  await page.getByLabel("Import encounter JSON").setInputFiles({
    name: "encounter.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ body: result.body, status: "awarded", award: { receiptId: "foreign" } }),
    ),
  });
  await page.getByRole("heading", { name: "Imported account draft", exact: true }).waitFor();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add combatant", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Offline enemy");
  await page.getByRole("button", { name: "Save encounter", exact: true }).click();
  await page.getByText("Encounter saved.", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "test-results/local-encounters/mobile.png", fullPage: true });
  await context.setOffline(false);
  await reloadApplication(page);
  await page.getByRole("button", { name: /Imported account draft/ }).click();
  await page.getByLabel("Name", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "Offline enemy");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: guest create/edit/reload, offline save, portable import, manual rolls, stale revisions, atomic award/retries/rollback, backup restore, player denial, desktop/mobile UI.",
  );
} finally {
  await browser.close();
}
