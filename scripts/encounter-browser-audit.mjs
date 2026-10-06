import { scanFixture, scannedPdf } from "./ocr-browser-fixtures.mjs";
import { characterPdf, characterPdfFields } from "./character-pdf-fixtures.mjs";
import { expect } from "playwright/test";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { generateEncounter } from "../src/lib/encounters/model.mjs";
import { localAccountDb } from "./account-dev-db.mjs";
const origin = process.env.ENCOUNTER_ORIGIN || process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = process.env.ENCOUNTER_SCREENSHOTS || "test-results/encounters";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const db = localAccountDb("data/account-dev.sqlite");
const errors = [],
  code = "E" + Date.now().toString().slice(-10),
  users = [];
try {
  async function actor(name, ip) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { "cf-connecting-ip": ip },
    });
    const res = await context.request.post(origin + "/api/account/auth/sign-up/email", {
      headers: { origin },
      data: {
        email: `encounter-${name}-${Date.now()}@example.com`,
        name,
        password: "Disposable encounter test password 123",
      },
    });
    assert.equal(res.status(), 200, await res.text());
    const id = (await res.json()).user.id;
    users.push(id);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    return { context, page, id };
  }
  const dm = await actor("DM", "192.0.2.221"),
    player = await actor("Player", "192.0.2.222");
  const room = {
    code,
    revision: 1,
    turn: 0,
    live: true,
    seats: [
      { id: "dmseat", token: "dm-token", role: "dm", name: "DM", purseIds: [] },
      {
        id: "playerseat",
        token: "player-token",
        role: "player",
        name: "Hero",
        purseIds: ["hero"],
      },
    ],
    table: {
      purses: [
        {
          id: "party",
          name: "Party fund",
          kind: "party",
          coins: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
        },
        {
          id: "hero",
          name: "Hero",
          kind: "character",
          coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        },
      ],
      holdings: [],
      ledger: [],
      shops: [],
      stock: [],
      notes: [],
      sheets: [],
      loans: [],
      listings: [],
    },
    drafts: {},
    seen: { gifts: [], sales: [] },
  };
  await db
    .prepare("INSERT INTO campaign_rooms VALUES (?,1,?)")
    .bind(code, JSON.stringify(room))
    .run();
  for (const [a, s, t] of [
    [dm, "dmseat", "dm-token"],
    [player, "playerseat", "player-token"],
  ])
    await db
      .prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)")
      .bind(a.id, code, s, t, "The northern road")
      .run();
  const p = dm.page;
  // A deterministic index keeps browser interaction tests independent of Open5e uptime.
  // Server authorization, normalization and generation are exercised in encounters.test.mjs.
  if (process.env.ENCOUNTER_LIVE_INDEX !== "1") {
    const goblin = {
      id: "audit-goblin",
      name: "Goblin",
      side: "enemy",
      hp: 7,
      maxHp: 7,
      ac: 15,
      initiative: null,
      initiativeBonus: 2,
      conditions: "",
      cr: 0.25,
      xp: 50,
      sourceKey: "audit-goblin",
      source: "Browser test fixture",
      notes: "",
      type: "Humanoid",
      environments: "Forest",
    };
    await p.route("**/api/account/encounters/index", async (route) => {
      assert.equal(route.request().postDataJSON().filters.enemy, "goblin");
      await route.fulfill({ json: { creatures: [goblin], more: false } });
    });
    await p.route("**/api/account/encounters/generate", async (route) => {
      const input = route.request().postDataJSON().filters;
      await route.fulfill({
        json: { combatants: generateEncounter([goblin], input) },
      });
    });
  }
  await openApplication(p, origin + "/encounters");
  await p.getByLabel("Save in", { exact: true }).selectOption(code);
  await p.getByRole("button", { name: "New encounter", exact: true }).click();
  await p.getByRole("button", { name: "Add combatant", exact: true }).waitFor();
  await p.locator(".quire-dawn").waitFor({ state: "hidden" });
  const skip = p.getByRole("button", { name: /skip for now/i });
  if (await skip.isVisible()) await skip.click();
  await p.getByRole("button", { name: "Add combatant", exact: true }).click();
  await p.getByLabel("Name", { exact: true }).fill("Rimrock ghoul");
  await p.getByLabel("Initiative", { exact: true }).fill("17");
  await p.getByLabel("HP", { exact: true }).fill("8");
  await p.getByLabel("Conditions", { exact: true }).fill("Prone");
  await p.getByRole("button", { name: "Save encounter", exact: true }).click();
  await p.getByText("Encounter saved.", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Start encounter", exact: true }).click();
  await p.getByRole("button", { name: "Next turn", exact: true }).click();
  await p.getByRole("button", { name: "Save encounter", exact: true }).click();
  await p.getByText("Encounter saved.", { exact: true }).waitFor();
  await p.screenshot({ path: output + "/desktop-battle.png", fullPage: true });
  await p.getByRole("button", { name: "Roll history", exact: true }).click();
  await p.getByLabel("Roll source", { exact: true }).selectOption("manual");
  await p.getByLabel("Manual total", { exact: true }).fill("18");
  await p.getByRole("button", { name: "Record manual roll", exact: true }).click();
  await p.getByText(/Encounter roll: 18/).waitFor();
  assert.ok((await p.locator(".encounter-rolls").innerText()).includes("Manual"));
  await p.getByRole("button", { name: "Builder & generator", exact: true }).click();
  const scan = await scanFixture(p, [
    "Goblin",
    "Small humanoid, neutral evil",
    "Armor Class 15 (leather armor)",
    "Hit Points 7 (2d6)",
    "Speed 30 ft.",
    "Challenge 1/4 (50 XP)",
    "Actions",
    "Scimitar. +4 to hit, 1d6+2 slashing.",
  ]);
  await p
    .getByLabel("Import statblock picture", { exact: true })
    .setInputFiles({ name: "goblin.png", mimeType: "image/png", buffer: scan });
  const review = p.getByRole("dialog", { name: "Review statblock" });
  await expect(review).toBeVisible({ timeout: 90000 });
  await expect(review).toContainText("Goblin · AC 15 · HP 7");
  await review.getByRole("button", { name: "Add reviewed creature", exact: true }).click();
  await p.getByRole("button", { name: "Builder & generator", exact: true }).click();
  await p.getByLabel("Encounter name", { exact: true }).fill("Ambush on the northern road");
  await p.getByLabel("Party size", { exact: true }).fill("5");
  await p.getByLabel("Party level", { exact: true }).fill("3");
  await p.getByLabel("Enemy name or type", { exact: true }).fill("goblin");
  await p.getByRole("button", { name: "Search enemy index", exact: true }).click();
  await p.getByRole("button", { name: "Add Goblin", exact: true }).waitFor({ timeout: 90000 });
  await p.getByRole("button", { name: "Generate & add enemies", exact: true }).click();
  await p.getByText(/Added .* enemies/).waitFor({ timeout: 90000 });
  await p.getByRole("button", { name: "Save encounter", exact: true }).click();
  await p.getByText("Encounter saved.", { exact: true }).waitFor();
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await p.screenshot({ path: output + "/mobile-builder.png", fullPage: true });
  await p.getByRole("button", { name: "Loot & rewards", exact: true }).click();
  await p.getByLabel("GP", { exact: true }).fill("25");
  await p.getByRole("button", { name: "Add custom loot", exact: true }).click();
  await p.getByLabel("Item name", { exact: true }).fill("Silver signet");
  await p.getByRole("button", { name: "Assign all to party inventory", exact: true }).click();
  await p.getByRole("button", { name: "Attach loot table", exact: true }).click();
  await p.getByLabel("Result name", { exact: true }).fill("Hidden gem");
  await p.getByLabel(/^Selected result/).selectOption("0");
  await p.getByRole("button", { name: "Save encounter", exact: true }).click();
  await p.getByText("Encounter saved.", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Conclude & review loot", exact: true }).click();
  await p.getByRole("button", { name: "Transfer loot once", exact: true }).waitFor();
  await p.getByRole("button", { name: "Assign all to party inventory", exact: true }).click();
  await p.getByRole("button", { name: "Save encounter", exact: true }).click();
  await p.getByText("Encounter saved.", { exact: true }).waitFor();
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await p.screenshot({
    path: output + "/mobile-loot-review.png",
    fullPage: true,
  });
  const d = await db
    .prepare("SELECT id,revision FROM dm_encounters WHERE user_id=?")
    .bind(dm.id)
    .first();
  let lost = false;
  await p.route("**/api/account/encounters/award", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await p.getByRole("button", { name: "Transfer loot once", exact: true }).click();
  await p.getByRole("alert").waitFor();
  await p.getByRole("button", { name: "Transfer loot once", exact: true }).click();
  await p.getByText(/locked against a second award/).waitFor();
  const updated = JSON.parse(
    (await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(code).first()).body,
  );
  assert.equal(updated.table.holdings.length, 2);
  assert.equal(updated.table.purses[0].coins.gp, 35);
  await reloadApplication(p);
  await p.getByLabel("Save in", { exact: true }).selectOption(code);
  await p.getByRole("button", { name: /Ambush on the northern road/ }).click();
  await p.getByText(/locked against a second award/).waitFor();
  await openApplication(player.page, origin + "/encounters");
  await player.page.getByLabel("Save in", { exact: true }).selectOption("personal");
  assert.equal(
    await player.page
      .getByLabel("Save in", { exact: true })
      .locator(`option[value="${code}"]`)
      .count(),
    0,
  );
  const denied = await player.context.request.post(origin + "/api/account/encounters/detail", {
    headers: { origin },
    data: { id: d.id },
  });
  assert.equal(denied.status(), 404);
  // A website account can prepare its own drafts even while its local campaign seat is a player.
  await player.page.evaluate(async () => {
    const t = await import("/src/lib/quire/table.ts");
    const e = await import("/src/lib/quire/economy.ts");
    const purses = await e.listPurses();
    t.setSeat({
      ...t.getSeat(),
      role: "player",
      purseIds: [purses.find((p) => p.kind === "character").id],
    });
  });
  await openApplication(player.page, origin + "/account");
  await player.page.getByRole("link", { name: "Open DM encounters", exact: true }).click();
  // The select mounts before the account request populates its options. Its
  // DOM value is temporarily empty even though the requested scope is personal.
  await expect(player.page.getByLabel("Save in", { exact: true })).toHaveValue("personal");
  assert.equal(
    await player.page
      .getByLabel("Save in", { exact: true })
      .locator('option[value="device"]')
      .count(),
    0,
  );
  await player.page.getByRole("button", { name: "New encounter", exact: true }).click();
  await player.page.getByRole("button", { name: "Builder & generator", exact: true }).click();
  await player.page.getByLabel("Encounter name", { exact: true }).fill("Account-only preparation");
  await player.page.getByRole("button", { name: "Save encounter", exact: true }).click();
  await player.page.getByText("Encounter saved.", { exact: true }).waitFor();
  const downloaded = player.page.waitForEvent("download");
  await player.page.getByRole("button", { name: "Export draft", exact: true }).click();
  const portable = await (await downloaded).path();
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await guest.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const app = await guest.newPage();
  await openApplication(app, origin + "/encounters");
  await app.getByLabel("Import encounter JSON").setInputFiles(portable);
  await app.getByRole("heading", { name: "Account-only preparation", exact: true }).waitFor();
  await app.getByText("Saved on this device", { exact: true }).waitFor();
  await guest.close();
  // A signed-in player can find and import a personal sheet; no campaign grant is required.
  await openApplication(player.page, origin + "/characters");
  const characterScan = await scanFixture(
    player.page,
    [
      "Character Name: Scan Hero",
      "Class and Level: Fighter 4",
      "Race: Human",
      "Armor Class: 19",
      "Hit Points: 47 / 53",
      "Strength: 20",
      "Dexterity: 18",
      "Constitution: 20",
      "Intelligence: 8",
      "Wisdom: 9",
      "Charisma: 12",
      "Equipment:",
      "Shield",
      "Potion x 2",
    ],
    "image/jpeg",
  );
  await player.page.getByLabel("Import a new character", { exact: true }).setInputFiles({
    name: "scanned-sheet.pdf",
    mimeType: "application/pdf",
    buffer: scannedPdf(characterScan),
  });
  const characterReview = player.page.getByRole("dialog", { name: "Review imported character" });
  await expect(characterReview).toBeVisible({ timeout: 90000 });
  await expect(characterReview).toContainText("Scan Hero");
  await expect(characterReview).toContainText("HP 47/53 · AC 19");
  await characterReview
    .getByRole("button", { name: "Use reviewed character", exact: true })
    .click();
  await expect(characterReview).toBeHidden();
  await expect(player.page.getByRole("heading", { name: "Scan Hero", exact: true, level: 2 })).toBeVisible();
  await player.page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  await expect(player.page.getByLabel("Maximum HP", { exact: true })).toHaveValue("53");
  // Both normal form indexes and orphaned filled page widgets must work through the real picker.
  for (const indexed of [false, true]) {
    const name = indexed ? "Indexed hero" : "Widget hero";
    await openApplication(player.page, origin + "/characters");
    await player.page.getByLabel("Import a new character", { exact: true }).setInputFiles({
      name: "filled-sheet.pdf",
      mimeType: "application/pdf",
      buffer: characterPdf({ indexed, fields: { ...characterPdfFields, CharacterName: name } }),
    });
    const review = player.page.getByRole("dialog", { name: "Review imported character" });
    await expect(review).toBeVisible();
    const extracted = JSON.parse(await review.locator("pre").textContent());
    assert.equal(extracted.name, name);
    assert.equal(extracted.classes, "Fighter 4");
    assert.equal(extracted.species, "Variant Human");
    assert.deepEqual(extracted.scores, { str: 19, dex: 10, con: 18, int: 8, wis: 10, cha: 12 });
    assert.equal(extracted.hitDice, "4d10");
    assert.equal(extracted.maxHp, 44);
    assert.equal(extracted.attacks[0].damage, "5");
    assert.deepEqual(extracted.equipment, []);
    assert.deepEqual(extracted.spells, []);
    assert.match(extracted.features, /First feature[\s\S]*Third feature/);
    assert.match(extracted.notes, /First action[\s\S]*Second action/);
    await review.getByRole("button", { name: "Use reviewed character", exact: true }).click();
    // The review also contains the name: wait for its async save before reloading.
    await expect(review).toBeHidden();
    await expect(player.page.getByRole("heading", { name, exact: true, level: 2 })).toBeVisible();
    await reloadApplication(player.page);
    await expect(player.page.getByRole("heading", { name, exact: true, level: 2 })).toBeVisible();
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      desktop: true,
      mobile: true,
      manualRoll: true,
      generator: true,
      lootReview: true,
      lostResponseExactlyOnce: true,
      playerDenied: true,
      screenshots: output,
    }),
  );
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      await page.screenshot({ path: output + "/failure.png", fullPage: true }).catch(() => {});
      console.error((await page.locator("body").innerText()).slice(-5000));
    }
  throw error;
} finally {
  await browser.close();
  await db
    .prepare(
      "DELETE FROM dm_encounter_rolls WHERE encounter_id IN (SELECT id FROM dm_encounters WHERE code=?)",
    )
    .bind(code)
    .run();
  await db
    .prepare(
      "DELETE FROM dm_encounter_awards WHERE encounter_id IN (SELECT id FROM dm_encounters WHERE code=?)",
    )
    .bind(code)
    .run();
  await db.prepare("DELETE FROM dm_encounters WHERE code=?").bind(code).run();
  await db.prepare("DELETE FROM library_members WHERE code=?").bind(code).run();
  await db.prepare("DELETE FROM campaign_rooms WHERE code=?").bind(code).run();
  for (const id of users) await db.prepare("DELETE FROM user WHERE id=?").bind(id).run();
  db.close();
}
