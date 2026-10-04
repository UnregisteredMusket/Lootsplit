import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
const origin = "http://127.0.0.1:8080",
  output = process.env.CHARACTER_SCREENSHOTS || "test-results/characters";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const db = localAccountDb("data/account-dev.sqlite"),
  ids = [],
  errors = [];
const code = "CH" + Date.now().toString().slice(-10);
try {
  async function actor(name, ip) {
    const context = await browser.newContext({
      viewport: { width: 1360, height: 980 },
      extraHTTPHeaders: { "cf-connecting-ip": ip },
    });
    const r = await context.request.post(origin + "/api/account/auth/sign-up/email", {
      headers: { origin },
      data: {
        email: `character-${name}-${Date.now()}@example.com`,
        name,
        password: "disposable character test password",
      },
    });
    assert.equal(r.status(), 200);
    const id = (await r.json()).user.id;
    ids.push(id);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    return { context, page, id };
  }
  const player = await actor("Player", "192.0.2.230"),
    dm = await actor("DM", "192.0.2.231");
  const room = {
    code,
    revision: 1,
    live: true,
    turn: 0,
    seats: [
      {
        id: "player",
        token: "player-token",
        role: "player",
        name: "Player",
        purseIds: ["hero"],
      },
      { id: "dm", token: "dm-token", role: "dm", name: "DM", purseIds: [] },
    ],
    table: {
      sheets: [],
      ledger: [],
      purses: [
        {
          id: "hero",
          name: "Campaign hero",
          editingAllowed: true,
          kind: "character",
          coins: { cp: 3, sp: 2, ep: 0, gp: 17, pp: 0 },
        },
      ],
      holdings: [
        {
          id: "sword",
          purseId: "hero",
          name: "Campaign sword",
          quantity: 1,
          kind: "item",
          unitCopper: 100,
          notes: "",
        },
      ],
    },
  };
  await db
    .prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,1,?)")
    .bind(code, JSON.stringify(room))
    .run();
  for (const [a, seat, token] of [
    [player, "player", "player-token"],
    [dm, "dm", "dm-token"],
  ])
    await db
      .prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)")
      .bind(a.id, code, seat, token, "Test adventure")
      .run();
  const page = player.page;
  await openApplication(page, origin + "/characters");
  await page.locator(".character-library-controls > summary").click();
  await page.getByRole("button", { name: "Create account-only character", exact: true }).click();
  await page.getByRole("heading", { name: "New adventurer", exact: true }).waitFor();
  await page.locator(".quire-dawn").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  await page.getByRole("button", { name: "Character details", exact: true }).click();
  await page.getByLabel("Character name", { exact: true }).fill("Mira Ashfall");
  await page.getByLabel("Species", { exact: true }).fill("Elf");
  await page.getByLabel("Classes / subclasses", { exact: true }).fill("Ranger");
  await page.getByLabel("Background", { exact: true }).fill("Scout");
  await page.getByRole("button", { name: "Save character", exact: true }).click();
  await page.getByText("Saved character", { exact: true }).waitFor();
  await page.getByLabel("Assign campaign", { exact: true }).selectOption(code);
  await page.getByLabel("Assign campaign character", { exact: true }).selectOption("hero");
  await page.getByRole("button", { name: "Save campaign assignment", exact: true }).click();
  await page.getByText(/Character assigned\./).waitFor();
  await page.getByRole("button", { name: "Abilities & skills", exact: true }).click();
  await page.getByLabel("DEX", { exact: true }).fill("16");
  await page.getByLabel("Stealth proficiency", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Save character", exact: true }).click();
  await page.getByText("Saved character", { exact: true }).waitFor();
  await page.getByLabel("Roll DEX +3 mode", { exact: true }).selectOption("advantage");
  let lost = false;
  await page.route("**/api/account/sheets/roll", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Roll DEX +3", exact: true }).click();
  await page
    .locator(".quick-roll output")
    .filter({ hasText: /fetch|network/i })
    .waitFor();
  await page.getByRole("button", { name: "Roll DEX +3", exact: true }).click();
  await page.locator(".roll-log li").waitFor();
  assert.equal(await page.locator(".roll-log li").count(), 1);
  const saved = await db.prepare("SELECT body FROM play_rolls WHERE code=?").bind(code).first();
  assert.equal(JSON.parse(saved.body).modifier, 3);
  assert.equal(JSON.parse(saved.body).dice.length, 2);
  assert.equal(await page.getByLabel("Enter a manual total", { exact: true }).isEnabled(), false);
  await page.getByRole("button", { name: "Combat", exact: true }).click();
  await page.getByLabel("Temporary HP", { exact: true }).fill("3");
  await page.getByLabel("Damage / healing amount", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Apply damage", exact: true }).click();
  await page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  assert.equal(await page.getByLabel("Current HP", { exact: true }).inputValue(), "8");
  assert.equal(await page.getByLabel("Temporary HP", { exact: true }).inputValue(), "0");
  await page.getByRole("button", { name: "Add attack", exact: true }).click();
  await page.getByLabel("Attack 1 name", { exact: true }).fill("Longbow");
  await page.getByLabel("Longbow attack bonus", { exact: true }).fill("5");
  await page.getByLabel("Longbow damage dice", { exact: true }).fill("1d8+3");
  await page.getByRole("button", { name: "Add resource", exact: true }).click();
  await page.getByLabel("Resource 1 name", { exact: true }).fill("Focus");
  await page.getByRole("button", { name: "Save character", exact: true }).click();
  await page.getByText("Saved character", { exact: true }).waitFor();
  await page.screenshot({ path: output + "/desktop.png" });
  await page.getByRole("button", { name: "Spells", exact: true }).click();
  await page.getByRole("button", { name: "Add custom spell", exact: true }).click();
  await page.getByText("New spell · Cantrip", { exact: false }).click();
  await page.getByLabel("Spell 1 name", { exact: true }).fill("Spark");
  await page.getByLabel("Spark roll formula", { exact: true }).fill("1d6");
  await page.getByLabel("Prepare Spark", { exact: true }).check();
  await page.getByRole("button", { name: "Add spell slot level", exact: true }).click();
  await page.getByLabel("Level 1 slots maximum", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Use level 1 slot", exact: true }).click();
  await page.getByRole("button", { name: "Save character", exact: true }).click();
  await page.getByText("Saved character", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Inventory & currency", exact: true }).click();
  await page.getByText("Campaign sword × 1", { exact: true }).waitFor();
  await page.getByText("17 gp", { exact: true }).waitFor();
  await openApplication(dm.page, origin + "/characters");
  await dm.page.getByLabel("Allow manual rolls in this campaign", { exact: true }).check();
  await page.getByRole("button", { name: "Reload sheet", exact: true }).click();
  await page.getByLabel("Enter a manual total", { exact: true }).waitFor();
  await page.getByLabel("Enter a manual total", { exact: true }).check();
  await page.getByLabel("Manual roll total", { exact: true }).fill("18");
  await page.getByRole("button", { name: "Record manual roll", exact: true }).click();
  await page.getByText(/Custom roll: 18 · Manual result/).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("quire.prefs.v1")).rollMode), "manual");
  await page.getByRole("button", { name: "Abilities & skills", exact: true }).click();
  const physical = page.getByLabel("Roll DEX +3 manual total", { exact: true });
  await physical.fill("19");
  await page.locator(".quick-roll").filter({ has: physical }).getByRole("button", { name: "Record DEX +3", exact: true }).click();
  await page.locator(".quick-roll output").filter({ hasText: "19 · Manual result" }).waitFor();
  await dm.page.getByRole("button", { name: "Refresh roll log", exact: true }).last().click();
  await dm.page.getByText(/MANUAL RESULT · 1d20\+3/).waitFor();
  await dm.page.getByRole("button", { name: "Mira Ashfall · View sheet", exact: true }).click();
  await dm.page.getByText("DM read-only view", { exact: true }).waitFor();
  await dm.page.getByRole("button", { name: "Edit sheet", exact: true }).last().click();
  assert.equal(await dm.page.getByLabel("Current HP", { exact: true }).last().isEnabled(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Combat", exact: true }).click();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await page.getByRole("button", { name: "Play sheet", exact: true }).click();
  await page.locator(".play-action-row").filter({ hasText: "Longbow" }).waitFor();
  await page.getByRole("button", { name: "Spells", exact: true }).click();
  await page.locator(".play-action-row").filter({ hasText: "Spark" }).waitFor();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page.locator(".character-title").scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + "/mobile.png" });
  await reloadApplication(page);
  await page.getByRole("heading", { name: "Mira Ashfall", exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit sheet", exact: true }).click();
  assert.equal(await page.getByLabel("Current HP", { exact: true }).inputValue(), "8");
  await page.evaluate(async () => {
    const t = await import("/src/lib/quire/table.ts");
    const e = await import("/src/lib/quire/economy.ts");
    const purse = (await e.listPurses()).find((p) => p.kind === "character");
    t.setSeat({
      role: "player",
      purseIds: [purse.id],
      shopIds: [],
      openedAt: Date.now(),
    });
  });
  await openApplication(page, origin + "/");
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await page.getByRole("heading", { name: "Character sheets", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: account character creation, editing/reload, campaign inventory, derived/advantage rolls, lost-response deduplication, HP, attacks, spells/slots, resources, DM manual policy and log, readonly DM roster, player home and mobile layout.",
  );
} finally {
  await db
    .prepare("DELETE FROM play_rolls WHERE code=? OR user_id IN (?,?)")
    .bind(code, ...ids)
    .run();
  for (const id of ids) await db.prepare("DELETE FROM user WHERE id=?").bind(id).run();
  await db.prepare("DELETE FROM play_policies WHERE code=?").bind(code).run();
  await db.prepare("DELETE FROM campaign_rooms WHERE code=?").bind(code).run();
  db.close();
  await browser.close();
}
