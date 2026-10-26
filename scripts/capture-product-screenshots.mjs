// Run only against a disposable local server. These are real UI captures using
// synthetic data: the invented "Wayfarers" campaign built by the real command
// engine (product-screenshot-fixture.mjs) and real in-app flows on top of it.
// Run with: node --experimental-strip-types scripts/capture-product-screenshots.mjs
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { openApplication, reloadApplication, navigateApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";
import { closeMapSettings, selectMapType } from "./map-workspace-browser.mjs";
import { buildWayfarers } from "./product-screenshot-fixture.mjs";
import { autoAnswerThemedDialogs } from "./themed-dialogs.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Disposable local server required.");
const output = process.env.PRODUCT_SCREENSHOTS || "test-results/product";
// Full-page JPEG captures and a result list for reviewing framing; never committed.
const debug = process.env.PRODUCT_SCREENSHOT_DEBUG ?? "test-results/product-screenshots-debug";
const only = new Set((process.env.PRODUCT_SCREENSHOT_SHOTS || "").split(",").map((s) => s.trim()).filter(Boolean));
await mkdir(output, { recursive: true });
if (debug) {
  await rm(debug, { recursive: true, force: true });
  await mkdir(debug, { recursive: true });
}
const fixture = buildWayfarers();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const results = [];
const hex = () => crypto.randomUUID().slice(0, 4);

/** Seed the synthetic campaign in this device's real storage, then add play
 * that only the browser can perform (device encounters and their award). */
async function seedCampaign(page) {
  await page.evaluate(async (table) => {
    // A procedurally drawn cove for the map workspace (no third-party art).
    function drawCove() {
      const w = 1280, h = 960, cols = 16, rows = 12, tile = w / cols;
      const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
      const c = canvas.getContext("2d");
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      c.fillStyle = "#1b1712";
      c.fillRect(0, 0, w, h);
      const floor = (x, y, cw, ch) => {
        for (let i = x; i < x + cw; i++)
          for (let j = y; j < y + ch; j++) {
            const v = 120 + Math.floor(rnd() * 26);
            c.fillStyle = `rgb(${v},${v - 10},${v - 26})`;
            c.fillRect(i * tile + 1, j * tile + 1, tile - 2, tile - 2);
          }
      };
      // Rooms and corridors (tile units).
      floor(1, 1, 6, 5); // storeroom
      floor(9, 1, 6, 4); // captain's office
      floor(7, 2, 2, 2); // corridor
      floor(3, 6, 2, 2); // stair corridor
      floor(1, 8, 14, 3); // quay
      floor(11, 5, 2, 3); // corridor down
      // Water channel along the bottom.
      const water = c.createLinearGradient(0, 11 * tile, 0, h);
      water.addColorStop(0, "#1f4f63");
      water.addColorStop(1, "#0d2733");
      c.fillStyle = water;
      c.fillRect(0, 11 * tile, w, h - 11 * tile);
      c.strokeStyle = "rgba(170,220,235,0.25)";
      c.lineWidth = 2;
      for (let i = 0; i < 18; i++) {
        const x = rnd() * w, y = 11 * tile + 10 + rnd() * (h - 11 * tile - 20);
        c.beginPath();
        c.arc(x, y, 18 + rnd() * 30, Math.PI * 1.1, Math.PI * 1.9);
        c.stroke();
      }
      // Walls.
      c.strokeStyle = "#3a2f24";
      c.lineWidth = 10;
      for (const [x, y, cw, ch] of [[1, 1, 6, 5], [9, 1, 6, 4], [1, 8, 14, 3]])
        c.strokeRect(x * tile, y * tile, cw * tile, ch * tile);
      // Crates, barrels and a moored boat.
      for (const [x, y] of [[1.3, 1.3], [2.3, 1.3], [1.3, 2.3], [5.4, 4.4], [13.4, 8.3]]) {
        c.fillStyle = "#7a5530";
        c.fillRect(x * tile, y * tile, tile * 0.8, tile * 0.8);
        c.strokeStyle = "#3d2a17";
        c.lineWidth = 4;
        c.strokeRect(x * tile, y * tile, tile * 0.8, tile * 0.8);
        c.beginPath();
        c.moveTo(x * tile, y * tile);
        c.lineTo((x + 0.8) * tile, (y + 0.8) * tile);
        c.stroke();
      }
      for (const [x, y] of [[4.5, 1.5], [5.2, 1.6], [10.3, 3.5]]) {
        c.fillStyle = "#5d3f22";
        c.beginPath();
        c.arc(x * tile, y * tile, tile * 0.32, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#2c1d10";
        c.stroke();
      }
      c.fillStyle = "#6b4a2b";
      c.beginPath();
      c.ellipse(6 * tile, 11.6 * tile, tile * 2.4, tile * 0.55, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#2c1d10";
      c.lineWidth = 5;
      c.stroke();
      // Desk and map table in the captain's office.
      c.fillStyle = "#4a3320";
      c.fillRect(11 * tile, 1.6 * tile, tile * 2.4, tile * 1.1);
      c.fillStyle = "#c9b48a";
      c.fillRect(11.3 * tile, 1.8 * tile, tile * 0.9, tile * 0.6);
      // Labels.
      c.fillStyle = "rgba(240,226,190,0.85)";
      c.font = "italic 26px Georgia, serif";
      c.fillText("Storeroom", 2.2 * tile, 5.6 * tile);
      c.fillText("Captain's office", 10 * tile, 4.6 * tile);
      c.fillText("Smugglers' quay", 6 * tile, 9.6 * tile);
      c.fillText("Tide channel", 11.5 * tile, 11.8 * tile);
      for (const quality of [0.8, 0.7, 0.6, 0.5]) {
        const url = canvas.toDataURL("image/jpeg", quality);
        if (url.length < 480000) return url;
      }
      throw Error("Map image too large.");
    }
    const ally = (id, name, initiative, hp, maxHp, ac, conditions = "") => ({
      id, name, side: "ally", hp, maxHp, ac, initiative, initiativeBonus: 0, conditions, notes: "", cr: 0, xp: 0, source: "Party character", sourceKey: "",
    });
    const enemy = (id, name, initiative, hp, maxHp, ac, cr, xp, conditions = "") => ({
      id, name, side: "enemy", hp, maxHp, ac, initiative, initiativeBonus: 1, conditions, notes: "", cr, xp, source: "Custom content", sourceKey: "",
    });
    table.journal.world = {
      ...(table.journal.world || {}),
      maps: [
        {
          id: "tide-cove",
          name: "Smugglers' cove beneath the lighthouse",
          type: "dungeon",
          locationId: null,
          image: drawCove(),
          visible: true,
          anchors: [],
          markers: [
            { id: "m-chest", x: 0.16, y: 0.2, label: "Locked strongbox", description: "DC 15 to pick.", visibility: "party" },
            { id: "m-trap", x: 0.47, y: 0.27, label: "Tripwire", description: "Alarm bells in the office.", visibility: "dm" },
          ],
          grid: { columns: 16, rows: 12, feetPerTile: 5, diagonal: "equal", x: 0, y: 0, width: 1, height: 1 },
          tokens: [
            { id: "t-mira", label: "Mira Ashfall", kind: "character", entityId: "mira", column: 4, row: 9, visibility: "party" },
            { id: "t-bram", label: "Bram Stoneward", kind: "character", entityId: "bram", column: 6, row: 9, visibility: "party" },
            { id: "t-rowan", label: "Rowan Vale", kind: "character", entityId: "rowan", column: 3, row: 10, visibility: "party" },
            { id: "t-tamsin", label: "Tamsin Reed", kind: "character", entityId: "tamsin", column: 7, row: 8, visibility: "party" },
            { id: "t-captain", label: "Captain Vey", kind: "creature", encounterId: "local-boarding", combatantId: "captain", column: 11, row: 9, visibility: "party" },
            { id: "t-s1", label: "Smuggler", kind: "creature", encounterId: "local-boarding", combatantId: "smuggler-1", column: 9, row: 9, visibility: "party" },
            { id: "t-s2", label: "Smuggler", kind: "creature", encounterId: "local-boarding", combatantId: "smuggler-2", column: 10, row: 8, visibility: "party" },
            { id: "t-s3", label: "Smuggler", kind: "creature", encounterId: "local-boarding", combatantId: "smuggler-3", column: 12, row: 10, visibility: "party" },
          ],
          encounterId: "local-boarding",
        },
      ],
    };
    const economy = await import("/src/lib/quire/economy.ts");
    await economy.applyCloudTable(table);
    const campaigns = await import("/src/lib/quire/campaigns.ts");
    campaigns.renameCampaign(campaigns.getCampaigns().activeId, "The Wayfarers");
    const { localEncounterRequest: call } = await import("/src/lib/encounters/local.ts");
    const { blankEncounter, blankLoot } = await import("/src/lib/encounters/model.mjs");
    const loot = (name, quantity, unitCopper, purseId, notes = "") => ({ ...blankLoot(), name, quantity, unitCopper, purseId, notes });
    const party = [
      ally("mira", "Mira Ashfall", 21, 38, 44, 16),
      ally("tamsin", "Tamsin Reed", 19, 31, 33, 15),
      ally("bram", "Bram Stoneward", 12, 47, 52, 18),
      ally("rowan", "Rowan Vale", 8, 24, 29, 12, "Concentrating: Haste"),
    ];
    // 1. An earlier fight this session, concluded and awarded (real award receipt).
    const tide = {
      ...blankEncounter(),
      name: "Ambush on the tide stairs",
      notes: "Black Gull lookouts waiting on the lighthouse stairs.",
      level: 5,
      partySize: 4,
      difficulty: "medium",
      round: 4,
      combatants: [...party, enemy("lookout-1", "Black Gull lookout", 14, 0, 22, 13, 0.5, 100), enemy("lookout-2", "Black Gull lookout", 9, 0, 22, 13, 0.5, 100)],
      coins: { cp: 0, sp: 40, ep: 0, gp: 180, pp: 0 },
      coinPurseId: "party",
      loot: [
        loot("Black Gull signet ring", 1, 2500, "party", "Marks the bearer as crew of the Black Gull."),
        loot("Potion of climbing", 2, 7500, "tamsin"),
        loot("Fine cutlass", 1, 2500, "bram"),
        loot("Coded smuggler's ledger", 1, 0, "rowan", "Half the pages are in a cipher."),
      ],
    };
    await call("encounters/create", { id: "tide", encounter: tide });
    await call("encounters/conclude", { id: "local-tide", revision: 0 });
    await call("encounters/award", { id: "local-tide", revision: 1 });
    // 2. A concluded fight whose loot is waiting for DM review.
    const vault = {
      ...blankEncounter(),
      name: "The smugglers' strongroom",
      notes: "Recovered after the boarding party fled.",
      level: 5,
      partySize: 4,
      difficulty: "hard",
      round: 5,
      combatants: [...party, enemy("guard-1", "Strongroom guard", 13, 0, 32, 16, 1, 200), enemy("mastiff", "Smuggler's mastiff", 15, 0, 18, 12, 0.25, 50)],
      coins: { cp: 0, sp: 260, ep: 0, gp: 340, pp: 6 },
      coinPurseId: "party",
      loot: [
        loot("Pearl necklace", 1, 25000, "party", "Appraised at the Brass Lantern."),
        loot("Cloak of elvenkind", 1, 50000, "tamsin", "Attunement required."),
        loot("+1 longbow", 1, 40000, "mira"),
        loot("Wand of magic missiles", 1, 30000, "rowan", "7 charges."),
        loot("Ironwood shield", 1, 4000, "bram"),
        loot("Casks of contraband brandy", 6, 1200, "party", "Worth more in Gullhaven."),
      ],
    };
    await call("encounters/create", { id: "vault", encounter: vault });
    await call("encounters/conclude", { id: "local-vault", revision: 0 });
    // 3. The fight in progress: round 3, Bram's turn.
    const boarding = {
      ...blankEncounter(),
      name: "Boarding the Black Gull",
      notes: "The smugglers cut the mooring lines when the alarm bell rang.",
      level: 5,
      partySize: 4,
      difficulty: "hard",
      round: 3,
      activeId: "bram",
      combatants: [
        party[0],
        enemy("captain", "Captain Vey", 20, 41, 65, 15, 2, 450, "Frightened (until end of turn)"),
        party[1],
        enemy("smuggler-1", "Black Gull smuggler", 16, 4, 16, 12, 0.5, 100),
        party[2],
        enemy("smuggler-2", "Black Gull smuggler", 11, 16, 16, 12, 0.5, 100, "Prone"),
        party[3],
        enemy("smuggler-3", "Black Gull smuggler", 6, 9, 16, 12, 0.5, 100),
      ],
      tables: [],
    };
    await call("encounters/create", { id: "boarding", encounter: boarding });
    await call("encounters/start", { id: "local-boarding", revision: 0 });
  }, fixture);
}

async function newDevice({ width = 1280, height = 800, scale = 1 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    isMobile: width < 600,
    hasTouch: width < 600,
    colorScheme: "dark",
    serviceWorkers: "block",
    extraHTTPHeaders: { "cf-connecting-ip": `2001:db8:${hex()}:${hex()}::1` },
  });
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => console.log(`  page error: ${e.message}`));
  page.on("dialog", (d) => void d.accept());
  await autoAnswerThemedDialogs(page); // themed confirmations (window.confirm is banned)
  return { context, page };
}

/** A signed-in DM device holding the seeded Wayfarers campaign. */
async function campaignDevice(options) {
  const device = await newDevice(options);
  const signup = await device.context.request.post(origin + "/api/account/auth/sign-up/email", {
    headers: { origin },
    data: { name: "Wayfarers GM", email: `gm-${crypto.randomUUID()}@example.com`, password: "disposable screenshot password 2026" },
  });
  if (!signup.ok()) throw Error(`Signup ${signup.status()}: ${await signup.text()}`);
  await openApplication(device.page, origin + "/");
  await device.page.getByText("Campaign control", { exact: true }).waitFor();
  await seedCampaign(device.page);
  await reloadApplication(device.page);
  await device.page.getByText("Campaign control", { exact: true }).waitFor();
  return device;
}

async function settle(page) {
  await page.addStyleTag({
    content: "[data-sonner-toaster]{display:none!important} *{caret-color:transparent!important}",
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

async function save(page, name) {
  await settle(page);
  await page.screenshot({ path: `${output}/${name}.png`, animations: "disabled" });
}

/** Desktop shots that also get a 390-wide phone capture, `<name>-phone` (W-4): the website
 * serves it below 700 px so phone visitors can read the screen. Same synthetic campaign. */
const PHONE_VARIANTS = new Set(["loot", "party", "trade", "barter", "ships", "ledger", "character", "market", "maps", "encounter", "properties", "downtime", "room", "journal"]);
const PHONE = { width: 390, height: 560, scale: 2 };

async function shot(name, options, fn) {
  await captureShot(name, options, fn);
  if (PHONE_VARIANTS.has(name)) await captureShot(`${name}-phone`, PHONE, fn);
}

async function captureShot(name, options, fn) {
  if (only.size && !only.has(name)) return;
  const started = Date.now();
  let device;
  try {
    device = await campaignDevice(options);
    await fn(device.page);
    await save(device.page, name);
    results.push(`PASS ${name} (${Math.round((Date.now() - started) / 1000)}s)`);
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = String(error?.message || error).split("\n").slice(0, 8).join(" | ");
    results.push(`FAIL ${name}: ${message}`);
    console.log(`FAIL ${name}: ${message}`);
  } finally {
    if (debug && device?.page && !device.page.isClosed())
      await device.page
        .screenshot({ path: `${debug}/${name}-full.jpg`, fullPage: true, type: "jpeg", quality: 50 })
        .catch(() => {});
    await device?.context.close().catch(() => {});
  }
}

async function scrollTo(page, locator, offset = 80) {
  await locator.first().waitFor();
  await locator.first().evaluate((el, offset) => {
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "instant" });
  }, offset);
}

try {
  // 1. DM Desk: treasury and the session ledger (loot award, split, purchases, trade).
  await shot("ledger", {}, async (page) => {
    const activity = page.getByRole("button", { name: /^Activity & balances/ });
    await activity.click();
    await page.getByRole("heading", { name: "Recent activity", exact: true }).first().waitFor();
    await scrollTo(page, activity, 84);
  });

  // 2. Encounter loot review before the one-time transfer.
  await shot("loot", {}, async (page) => {
    await navigateApplication(page, origin + "/encounters?review=1");
    // Phones also render a hidden copy of the status; wait for the visible one.
    await page.getByText("READY FOR LOOT REVIEW", { exact: false }).locator("visible=true").first().waitFor();
    await scrollTo(page, page.getByText("Transfer reviewed loot", { exact: false }), 96);
  });

  // 3. Party with characters, funds and inventory.
  await shot("party", {}, async (page) => {
    await navigateApplication(page, origin + "/party");
    await page.getByRole("heading", { name: "Party", exact: true }).waitFor();
    await page.getByText("Mira Ashfall", { exact: true }).first().waitFor();
    await page.getByRole("tab", { name: /Funds/ }).click();
    await scrollTo(page, page.getByText("Combined wealth", { exact: false }), 100);
  });

  // 4. Character sheet with dice tray and roll history.
  await shot("character", {}, async (page) => {
    await navigateApplication(page, origin + "/characters?id=" + encodeURIComponent("party:mira"));
    await page.getByRole("heading", { name: "Mira Ashfall", exact: true }).first().waitFor();
    await page.getByText("Mira Ashfall · Stealth", { exact: false }).first().waitFor();
    await scrollTo(page, page.getByText("Saved character", { exact: true }), 84);
  });

  // 5. A shop with stock, prices and buy/sell.
  await shot("market", {}, async (page) => {
    await navigateApplication(page, origin + "/shop/lantern");
    await page.getByText("Potion of healing", { exact: false }).first().waitFor();
    await chooseOption(page.getByLabel("Paying from", { exact: true }), "party").catch(() => {});
    await scrollTo(page, page.getByText("Eastmarch / Brackenport / Dock Ward", { exact: true }), 90);
  });

  // 6. Trade Exchanges with commodity quotes and recorded price history.
  await shot("trade", {}, async (page) => {
    await navigateApplication(page, origin + "/features/economy");
    const board = page.getByRole("region", { name: "Commodity quotes", exact: true });
    await board.waitFor();
    const oil = page.getByRole("button", { name: /^View Lamp oil\b.*Brackenport Exchange/ });
    if (await oil.count()) await oil.click();
    await scrollTo(page, board, 150);
  });

  // 7. Trading & Barter between two characters.
  await shot("barter", {}, async (page) => {
    await navigateApplication(page, origin + "/features/trading");
    await page.getByRole("button", { name: "New barter offer", exact: true }).click();
    await chooseOption(page.getByLabel("Your offering account", { exact: true }), "tamsin");
    await chooseOption(page.getByLabel("Other participant", { exact: true }), "bram");
    await page.getByRole("button", { name: "Add Silvered dagger to First side offer", exact: true }).click();
    await page.getByRole("button", { name: "Add Caltrops to First side offer", exact: true }).click();
    await page.getByRole("button", { name: /^Add Fine cutlass .*Second side offer$/ }).click();
    await page.getByLabel("First side coins (copper)", { exact: true }).fill("500");
    await page.evaluate(() => document.activeElement?.blur());
    await scrollTo(page, page.locator(".barter-workspace"), 70);
  });

  // 8. Maps workspace with the cove scene, grid and tokens.
  await shot("maps", {}, async (page) => {
    await navigateApplication(page, origin + "/maps");
    await selectMapType(page, "dungeon");
    await closeMapSettings(page);
    await page.getByRole("img", { name: "Smugglers' cove beneath the lighthouse", exact: true }).waitFor();
    await page.getByRole("button", { name: "Fit map", exact: true }).click();
  });

  // 9. Initiative tracker mid-combat.
  await shot("encounter", {}, async (page) => {
    await navigateApplication(page, origin + "/encounters?resume=1");
    await page.locator(".encounter-combatant.is-active").first().waitFor();
    await scrollTo(page, page.locator(".encounter-combatant").first(), 150);
  });

  // 10. Downtime preview awaiting DM approval.
  await shot("downtime", {}, async (page) => {
    await navigateApplication(page, origin + "/features/downtime");
    await page.locator("summary").filter({ hasText: "Set downtime & review calculations" }).click();
    await page.getByLabel("In-game days", { exact: true }).fill("7");
    await page.getByRole("button", { name: "Preview downtime", exact: true }).click();
    const preview = page.getByText(/Between sessions · 7 days/).first();
    await preview.waitFor();
    await scrollTo(page, preview, 150);
  });

  // 11. Property Management: the party's storehouse with operations and staff.
  await shot("properties", {}, async (page) => {
    await navigateApplication(page, origin + "/features/properties");
    const storehouse = page.locator("#property-storehouse");
    await storehouse.waitFor();
    const staff = storehouse.getByRole("button", { name: "Staff & managers", exact: true });
    if (await staff.count()) await staff.click();
    await scrollTo(page, storehouse.getByText("Operations enabled", { exact: false }), 130);
  });

  // 12. Ships: configure the party's ship, load cargo and board crew.
  await shot("ships", {}, async (page) => {
    await navigateApplication(page, origin + "/features/properties");
    const ship = page.locator("#property-heron");
    await ship.getByRole("button", { name: "Configure this property as a ship", exact: true }).click();
    const settings = ship.getByRole("form", { name: "Review ship settings", exact: true });
    await settings.getByLabel("Daily sailing maintenance/provisions (cp)", { exact: true }).fill("150");
    await settings.getByLabel("Daily docked maintenance (cp)", { exact: true }).fill("25");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(ship.getByRole("heading", { name: "Ship · The Gilded Heron", exact: true })).toBeVisible();
    const dmSettings = ship.getByRole("button", { name: "DM ship settings", exact: true });
    if ((await dmSettings.getAttribute("aria-expanded")) === "true") await dmSettings.click();
    await ship.getByRole("button", { name: /^Storage & material staging/ }).click();
    const cargo = ship.getByRole("form", { name: "Move stored goods", exact: true });
    await chooseOption(cargo.getByLabel("Acting / receiving character"), "bram");
    await page.waitForTimeout(300);
    await chooseOption(cargo.getByLabel("Item lot"), { label: "Lamp oil · 6 available" });
    await cargo.getByLabel("Item quantity", { exact: true }).fill("6");
    await cargo.getByRole("button", { name: "Deposit items", exact: true }).click();
    await page.waitForTimeout(800);
    await ship.getByRole("button", { name: "Crew & passengers", exact: true }).click();
    const boarding = ship.getByRole("form", { name: "Move character aboard / ashore", exact: true });
    for (const id of ["mira", "bram"]) {
      await chooseOption(boarding.getByLabel("Boarding character", { exact: true }), id);
      await boarding.getByRole("button", { name: "Board character", exact: true }).click();
      await page.waitForTimeout(800);
    }
    const statBlock = ship.getByRole("button", { name: /^Ship stat block/ });
    if ((await statBlock.getAttribute("aria-expanded")) !== "true") await statBlock.click();
    await scrollTo(page, ship.getByRole("heading", { name: "Ship · The Gilded Heron", exact: true }), 90);
  });

  // 13. Journal book view with a session report.
  await shot("journal", {}, async (page) => {
    await navigateApplication(page, origin + "/features/journal");
    await page.getByText("The Drowned Archive", { exact: false }).first().waitFor();
    await page.locator(".journal-contents button").filter({ hasText: "The Drowned Archive" }).first().click();
    await scrollTo(page, page.locator(".journal-book"), 80);
  });

  // 14. Multiplayer room: a player joins from a second device and the party chats.
  await shot("room", {}, async (page) => {
    await navigateApplication(page, origin + "/share");
    const skip = page.getByRole("button", { name: "Not now", exact: true });
    if (await skip.isVisible()) await skip.click();
    await page.getByRole("button", { name: "Start a room", exact: true }).click();
    await page.locator('.multiplayer-hub[aria-busy="false"]').waitFor();
    await page.getByRole("button", { name: "Create room", exact: true }).click();
    await page.getByRole("button", { name: "Share join link", exact: true }).waitFor();
    const invitation = await page.evaluate(() => {
      const id = localStorage.getItem("quire.campaign.v1") || "main";
      const session = JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`));
      return { code: session.code, sessionId: session.sessionId };
    });
    const guest = await newDevice({ width: 1280, height: 800 });
    try {
      guest.page.guestAccessAudit = true;
      await openApplication(guest.page, `${origin}/share?join=${invitation.code}&session=${invitation.sessionId}`);
      await guest.page.getByRole("button", { name: "Find characters", exact: true }).click();
      await guest.page.getByLabel("Your name", { exact: true }).fill("Tamsin's player");
      await guest.page.getByRole("combobox", { name: "Choose your character", exact: true }).selectOption("tamsin");
      await guest.page.getByRole("button", { name: "Join room", exact: true }).click();
      await guest.page.getByText("You joined as a player", { exact: true }).waitFor();
      await navigateApplication(guest.page, origin + "/share?tab=chat");
      // The host's view of the live room: the player has joined and the party chats.
      await reloadApplication(page);
      await navigateApplication(page, origin + "/share?tab=chat");
      await page.locator("#chat-message").fill("Roll Sleight of Hand with advantage. The lock is old but well oiled.");
      await page.locator(".chat-composer").evaluate((form) => form.requestSubmit());
      const sent = await page.getByText("The lock is old but well oiled.", { exact: false }).first()
        .waitFor({ timeout: 20000 }).then(() => true, () => false);
      console.log(`  room host message ${sent ? "delivered" : "not shown"}`);
      await page.evaluate(() => document.activeElement?.blur());
      await scrollTo(page, page.getByRole("tab", { name: /^Chat/ }), 90);
    } finally {
      if (debug)
        await guest.page.screenshot({ path: `${debug}/room-guest.jpg`, fullPage: true, type: "jpeg", quality: 50 }).catch(() => {});
      await guest.context.close().catch(() => {});
    }
  });

  // 15. Player Home on a phone (this device switched to Mira's player seat).
  await shot("phone-home", { width: 390, height: 844, scale: 2 }, async (page) => {
    await page.evaluate(async () => {
      const { setSeat, getSeat } = await import("/src/lib/quire/table.ts");
      setSeat({ ...getSeat(), role: "player", purseIds: ["mira"], shopIds: ["lantern", "forge"], openedAt: Date.now() });
    });
    await reloadApplication(page);
    await page.getByRole("heading", { name: "Home", exact: true }).first().waitFor();
  });

  // 16–19. Split view: two screens in one window (desktop and tablet landscape).
  const playerSeat = (page) =>
    page.evaluate(async () => {
      const { setSeat, getSeat } = await import("/src/lib/quire/table.ts");
      setSeat({ ...getSeat(), role: "player", purseIds: ["mira"], shopIds: ["lantern", "forge"], openedAt: Date.now() });
    });
  const sheetBesideShop = async (page) => {
    await openApplication(
      page,
      `${origin}/characters?id=${encodeURIComponent("party:mira")}&beside=${encodeURIComponent("/shop/lantern")}`,
    );
    const shop = page.getByRole("region", { name: "Right pane: Shop", exact: true });
    await shop.getByText("Potion of healing", { exact: false }).first().waitFor();
    await page
      .getByRole("region", { name: "Left pane: Character sheet", exact: true })
      .getByRole("heading", { name: "Mira Ashfall", exact: true })
      .first()
      .waitFor();
    const row = shop.locator("li").filter({ has: page.getByLabel("Quantity of Torches (bundle of 5)", { exact: true }) });
    const buy = row.getByRole("button", { name: /^Buy / });
    if (await buy.isEnabled().catch(() => false)) {
      await buy.click();
      await row.getByText(/Purchase recorded|pending/i).first().waitFor({ timeout: 8000 }).catch(() => {});
    }
    await page.locator('[data-split-pane="primary"]').click({ position: { x: 30, y: 90 } });
    // Frame each pane like the approved mockup: the sheet's vitals and the shop's header.
    await page.evaluate(() => {
      const scroll = (side, selector, offset) => {
        const pane = document.querySelector(`[data-split-scroll="${side}"]`);
        const target = pane?.querySelector(selector);
        if (!pane || !target) return;
        pane.scrollTop += target.getBoundingClientRect().top - pane.getBoundingClientRect().top - offset;
      };
      scroll("primary", ".character-title, .character-heading", 12);
      const shop = document.querySelector('[data-split-scroll="secondary"]');
      if (shop) shop.scrollTop = 0;
      scroll("secondary", "h1", 44);
    });
  };
  await shot("split-player", { width: 1440, height: 900 }, async (page) => {
    await playerSeat(page);
    await sheetBesideShop(page);
  });
  await shot("split-light", { width: 1440, height: 900 }, async (page) => {
    await playerSeat(page);
    await page.evaluate(() => {
      const prefs = JSON.parse(localStorage.getItem("quire.prefs.v1") || "{}");
      // The Light · Adventurer's Ledger look, as chosen in Settings.
      localStorage.setItem(
        "quire.prefs.v1",
        JSON.stringify({ ...prefs, appearance: "light", accent: "#7c3224", ground: "#dfcca2" }),
      );
    });
    await sheetBesideShop(page);
  });
  await shot("split-open-beside", { width: 1440, height: 900 }, async (page) => {
    await playerSeat(page);
    await openApplication(page, `${origin}/characters?id=${encodeURIComponent("party:mira")}`);
    await page.getByRole("heading", { name: "Mira Ashfall", exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Open beside", exact: true }).click();
    await page.getByRole("menu", { name: "Open beside" }).waitFor();
  });
  await shot("split-tablet", { width: 1194, height: 834 }, async (page) => {
    await page.evaluate(() =>
      localStorage.setItem(
        "lootsplit.split-view.v1",
        JSON.stringify({ open: true, beside: "/encounters?resume=1", ratio: 0.6, recent: ["/encounters?resume=1"] }),
      ),
    );
    await openApplication(page, `${origin}/maps?beside=${encodeURIComponent("/encounters?resume=1")}`);
    await page.getByRole("region", { name: "Right pane: Encounters", exact: true }).waitFor();
    await selectMapType(page, "dungeon");
    await closeMapSettings(page);
    await page.getByRole("img", { name: "Smugglers' cove beneath the lighthouse", exact: true }).waitFor();
    await page.getByRole("button", { name: "Fit map", exact: true }).click();
    await page.locator(".encounter-combatant.is-active").first().waitFor();
    await page.evaluate(() => {
      const pane = document.querySelector('[data-split-scroll="secondary"]');
      const active = pane?.querySelector(".encounter-combatant");
      if (pane && active)
        pane.scrollTop += active.getBoundingClientRect().top - pane.getBoundingClientRect().top - 150;
    });
  });
} finally {
  await browser.close();
  const summary = results.join("\n");
  if (debug) await writeFile(`${debug}/results.txt`, summary + "\n");
  console.log("\n" + summary);
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
}
