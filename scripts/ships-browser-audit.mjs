import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  openApplication,
  reloadApplication,
  navigateApplication,
} from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";
import { createAndSaveRoom } from "./browser/account-fixtures.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(
  origin,
  /^http:\/\/(127\.0\.0\.1|localhost):/,
  "Ship fixtures require a disposable server",
);
const output = "test-results/ships",
  started = Date.now(),
  errors = [];
await mkdir(output, { recursive: true });
let currentPage;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
async function readJournal(page) {
  return page.evaluate(async () => {
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
      return await new Promise((resolve, reject) => {
        const r = db.transaction("meta").objectStore("meta").get("journal");
        r.onsuccess = () => resolve(r.result?.value);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
async function fits(page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Ship controls fit viewport",
  );
}
async function submit(form, label = "Save", accepted) {
  const page = form.page();
  const before = page.guestAccessAudit ? null : JSON.stringify(await readJournal(page));
  await form.getByRole("button", { name: label, exact: true }).click();
  if (accepted) await accepted();
  else await expect.poll(async () => JSON.stringify(await readJournal(page))).not.toBe(before);
  await expect(form.getByRole("alert")).toHaveCount(0);
}

async function previewApply(page, n, name) {
  await navigateApplication(page, origin + "/features/downtime");
  await page.locator("summary").filter({ hasText: "Set downtime & review calculations" }).click();
  await page.getByLabel("In-game days", { exact: true }).fill(String(n));
  await page.getByRole("button", { name: "Preview downtime", exact: true }).click();
  await expect
    .poll(async () => (await readJournal(page)).finance.downtime.at(-1)?.status)
    .toBe("pending");
  await page.getByRole("button", { name: /^(Play sessions|Session ·)/ }).click();
  await page.getByLabel("Session name", { exact: true }).fill(name);
  await page.getByRole("checkbox", { name: /I approve the downtime plan/ }).check();
  await page.getByRole("button", { name: "Approve downtime & start session", exact: true }).click();
  await expect
    .poll(async () => (await readJournal(page)).finance.downtime.at(-1).status)
    .toBe("applied");
  await navigateApplication(page, origin + "/features/properties");
}
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      serviceWorkers: "block",
    });
    await context.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (route) => route.abort(),
    );
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/features/properties");
    await page.getByRole("heading", { name: "Owned properties", exact: true }).waitFor();
    await page.evaluate(async () => {
      const active = localStorage.getItem("quire.campaign.v1"),
        name =
          JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find(
            (r) => r.id === active,
          )?.db || "quire";
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
          for (const name of ["purses", "holdings", "shops", "stock", "ledger"])
            tx.objectStore(name).clear();
          for (const [id, kind, name] of [
            ["party", "party", "Party treasury"],
            ["hero", "character", "Sailor Hero"],
          ])
            tx.objectStore("purses").put({
              id,
              kind,
              name,
              coins: { cp: 500000, sp: 0, ep: 0, gp: 0, pp: 0 },
            });
          tx.objectStore("holdings").put({
            id: "ship",
            name: "Dawn Trader",
            kind: "property",
            purseId: "party",
            quantity: 1,
            unitCopper: 10000,
            notes: "Synthetic ship",
            locationId: "port",
            property: { type: "other" },
          });
          tx.objectStore("holdings").put({
            id: "cargo",
            name: "Trade goods",
            kind: "item",
            purseId: "hero",
            quantity: 10,
            unitCopper: 10,
            weight: 2,
            notes: "Synthetic cargo",
          });
          for (const id of ["listings", "loans", "sheets", "handouts"])
            tx.objectStore("meta").put({ id, [id]: [] });
          tx.objectStore("meta").put({
            id: "journal",
            value: {
              sessions: [],
              requests: [],
              events: [],
              market: {
                currentLocationId: "port",
                locations: [
                  { id: "region", name: "Coast", kind: "region", parentId: null, description: "" },
                  { id: "port", name: "Port", kind: "city", parentId: "region", description: "" },
                  {
                    id: "far",
                    name: "Far Port",
                    kind: "city",
                    parentId: "region",
                    description: "",
                  },
                ],
              },
            },
          });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
    await reloadApplication(page);
    const ship = page.locator("#property-ship");
    await ship
      .getByRole("button", { name: "Configure this property as a ship", exact: true })
      .click();
    const settings = ship.getByRole("form", { name: "Review ship settings", exact: true });
    await settings
      .getByLabel("Daily sailing maintenance/provisions (cp)", { exact: true })
      .fill("100");
    await settings.getByLabel("Daily docked maintenance (cp)", { exact: true }).fill("20");
    await settings
      .getByLabel("Private DM ship notes", { exact: true })
      .fill("Synthetic private navigation clue");
    await submit(settings);
    await expect(
      ship.getByRole("heading", { name: "Ship · Dawn Trader", exact: true }),
    ).toBeVisible();
    await ship.getByRole("button", { name: /^Ship stat block/ }).click();
    await expect(ship).toContainText("STR 20 (+5)");
    await expect(ship.locator("table")).toContainText("200/200");
    await ship.getByRole("button", { name: /^Storage & material staging/ }).click();
    const cargo = ship.getByRole("form", { name: "Move stored goods", exact: true });
    await chooseOption(cargo.getByLabel("Acting / receiving character"), "hero");
    await cargo.getByLabel("Item quantity", { exact: true }).fill("10");
    await submit(cargo, "Deposit items");
    await expect(ship).toContainText("10 × Trade goods");
    await ship.getByRole("button", { name: "DM damage & teleport overrides", exact: true }).click();
    const damage = ship.getByRole("form", { name: "Record ship damage", exact: true });
    await damage.getByLabel("Incoming damage", { exact: true }).fill("40");
    await submit(damage);
    await expect(ship.locator("table")).toContainText("160/200");
    await page.getByRole("button", { name: /^DM estate workshop/ }).click();
    await page.getByRole("button", { name: "Docks & shipyards", exact: true }).click();
    await page.getByRole("button", { name: "Add dock / shipyard", exact: true }).click();
    const yard = page.getByRole("form", { name: "Review dock / shipyard", exact: true });
    await chooseOption(yard.getByLabel("Facility location", { exact: true }), "port");
    await submit(yard);
    await ship.getByRole("button", { name: "Docks, dry storage & shipyards", exact: true }).click();
    const berth = ship.getByRole("form", { name: "Change ship storage / launch", exact: true });
    const yardId = (await readJournal(page)).fleet.facilities[0].id;
    await chooseOption(berth.getByLabel("Ship facility", { exact: true }), yardId);
    await berth.getByLabel("Ship storage mode").selectOption("shipyard");
    await submit(berth);
    await ship.getByRole("button", { name: "Repairs & ship upgrades", exact: true }).click();
    const work = ship.getByRole("form", { name: "Propose ship work", exact: true });
    await work.getByLabel("HP to repair", { exact: true }).fill("20");
    assert.equal(
      await work
        .getByLabel("Ship work payer", { exact: true })
        .evaluate((el) => el.closest(".record-select").querySelector("select").value),
      "party",
      "DM repair quotes default to the ship owner, rather than unrelated city treasuries",
    );
    await chooseOption(work.getByLabel("Ship work payer", { exact: true }), "hero");
    await submit(work);
    await ship.getByRole("button", { name: /^Construction, upgrades & downtime work/ }).click();
    const job = ship.locator(".estate-record").filter({
      has: page.getByRole("heading", { name: "Repair Hull: 20 HP · draft", exact: true }),
    });
    await job.getByRole("button", { name: "Approve / resume", exact: true }).click();
    await expect
      .poll(async () => (await readJournal(page)).propertyOperations.jobs[0].status)
      .toBe("active");
    await previewApply(page, 1, "Repair the Dawn Trader");
    await expect
      .poll(async () => (await readJournal(page)).fleet.vessels[0].stats.components[0].hp)
      .toBe(180);
    await ship.getByRole("button", { name: "Crew & passengers", exact: true }).click();
    const boarding = ship.getByRole("form", {
      name: "Move character aboard / ashore",
      exact: true,
    });
    await chooseOption(boarding.getByLabel("Boarding character", { exact: true }), "hero");
    await submit(boarding, "Board character");
    await ship.getByRole("button", { name: "Docks, dry storage & shipyards", exact: true }).click();
    const afloat = ship.getByRole("form", { name: "Change ship storage / launch", exact: true });
    await afloat.getByLabel("Ship storage mode").selectOption("docked");
    await submit(afloat);
    await ship.getByRole("button", { name: "Downtime voyages", exact: true }).click();
    const travel = ship.getByRole("form", { name: "Propose downtime voyage", exact: true });
    await chooseOption(travel.getByLabel("Voyage destination", { exact: true }), "far");
    await travel.getByLabel("Voyage downtime days", { exact: true }).fill("2");
    await travel.getByLabel("Maximum travel budget (cp)", { exact: true }).fill("1000");
    await travel
      .getByRole("checkbox", { name: "Sailor Hero works as sailing crew", exact: true })
      .check();
    await submit(travel);
    await submit(ship.getByRole("form", { name: "Approve / resume voyage", exact: true }));
    await previewApply(page, 1, "Sail to Far Port");
    await expect
      .poll(async () => (await readJournal(page)).fleet.voyages[0].elapsedMinutes)
      .toBe(1440);
    await ship.getByRole("button", { name: "DM damage & teleport overrides", exact: true }).click();
    const teleport = ship.getByRole("form", { name: "DM Override · Teleport Ship", exact: true });
    await chooseOption(teleport.getByLabel("Teleport destination", { exact: true }), "far");
    await teleport
      .getByLabel("Teleport reason (optional)", { exact: true })
      .fill("Reviewed magic portal");
    await submit(teleport, "Teleport ship, cargo and occupants");
    const result = await readJournal(page);
    assert.equal(result.fleet.voyages[0].status, "dm-overridden");
    assert.equal(
      result.world.characterPositions.find((p) => p.purseId === "hero").locationId,
      "far",
    );
    assert.equal(result.fleet.aboard[0].propertyId, "ship");
    await ship.getByRole("button", { name: /^Ship stat block/ }).click();
    await fits(page);
    await page.screenshot({ path: `${output}/dm-ship-${width}.png`, fullPage: true });
    // Share the complete canonical fleet and exercise a real in-memory player seat.
    await createAndSaveRoom(page, origin, (p, o, path) => navigateApplication(p, o + path));
    await navigateApplication(page, origin + "/share");
    const live = page.getByRole("button", { name: "Live", exact: true });
    if ((await live.getAttribute("aria-pressed")) !== "true") {
      await live.click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Change mode", exact: true })
        .click();
    }
    await expect(live).toHaveAttribute("aria-pressed", "true");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Room online.*Play active.*Saved to room/ })
        .first(),
    ).toBeVisible();
    await page.evaluate(() =>
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data) => {
          window.shipInvite = data.url;
        },
      }),
    );
    await page.getByRole("button", { name: "Share join link", exact: true }).click();
    const invite = await page.evaluate(() => window.shipInvite);
    const guestContext = await browser.newContext({
      viewport: { width, height: 950 },
      serviceWorkers: "block",
      extraHTTPHeaders: {
        "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`,
      },
    });
    await guestContext.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (route) => route.abort(),
    );
    const guest = await guestContext.newPage();
    currentPage = guest;
    guest.guestAccessAudit = true;
    guest.on("pageerror", (e) => errors.push(e.message));
    await openApplication(guest, invite);
    await guest.getByRole("button", { name: "Find characters", exact: true }).click();
    await guest.getByPlaceholder("What should the party call you?").fill("Ship guest");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(guest.locator(".room-code")).toBeVisible();
    await navigateApplication(guest, origin + "/features/properties");
    const guestShip = guest.locator("#property-ship");
    await expect(
      guestShip.getByRole("heading", { name: "Ship · Dawn Trader", exact: true }),
    ).toBeVisible();
    await expect(
      guestShip.getByRole("button", { name: "DM damage & teleport overrides", exact: true }),
    ).toHaveCount(0);
    await expect(
      guestShip.getByRole("button", { name: "DM ship settings", exact: true }),
    ).toHaveCount(0);
    await expect(guestShip).not.toContainText("Synthetic private navigation clue");
    const naming = guestShip.getByRole("form", { name: "Name your ship", exact: true });
    await naming.getByLabel("Ship name", { exact: true }).fill("Silver Wake");
    await submit(naming, "Save", async () =>
      expect(
        guestShip.getByRole("heading", { name: "Ship · Silver Wake", exact: true }),
      ).toBeVisible(),
    );
    await guestShip.getByRole("button", { name: /^Ship stat block/ }).click();
    await fits(guest);
    await guest.screenshot({ path: `${output}/player-ship-${width}.png`, fullPage: true });
    assert.equal(
      await guest.evaluate(() =>
        Object.keys(localStorage).some((k) => k.startsWith("quire.cloud.v2.")),
      ),
      false,
      "Guest fleet stays in memory",
    );
    await guestContext.close();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      widths: [1280, 390],
      durationMs: Date.now() - started,
      errors,
      flows: [
        "configure",
        "damage",
        "berth",
        "repair",
        "board",
        "voyage",
        "teleport",
        "shared-player",
        "privacy",
        "guest-memory",
      ],
    }),
  );
} catch (error) {
  if (currentPage && !currentPage.guestAccessAudit)
    await writeFile(
      `${output}/failure-state.json`,
      JSON.stringify(await readJournal(currentPage), null, 2),
    ).catch(() => {});
  if (currentPage)
    await currentPage.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/failure.txt`, String(error.stack || error));
  throw error;
} finally {
  await browser.close();
}
