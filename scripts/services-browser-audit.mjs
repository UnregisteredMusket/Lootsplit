// NPC services (docs/SERVICES.md): the hub's Services reply, the temple (instant and DM review),
// the workshop (downtime work and collection) and DM setup. Real clicks and number keys on a
// disposable device campaign at 1280, 390 and 320 px, in Ironbound and Parchment.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir } from "node:fs/promises";
import { smithFixture, smithDm } from "../src/lib/quire/test-fixtures/blacksmith.ts";
import { applyCommand } from "../src/lib/quire/commands.ts";
import { defaultSmith } from "../src/lib/quire/blacksmith-schema.ts";
import { validateWorld } from "../src/lib/quire/world.ts";
import { servicesFixture, workshopFixture, innFixture, linksFixture, svcDm } from "../src/lib/quire/test-fixtures/services.ts";
import { openApplication, reloadApplication, navigateApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
// Local diagnostics only: SERVICES_AUDIT_ONLY=links runs one section (CI always runs everything).
const only = process.env.SERVICES_AUDIT_ONLY || "";
const runs = (section) => !only || only.split(",").includes(section);
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "Service fixtures require a disposable server");
const output = "test-results/services",
  started = Date.now(),
  errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});

async function seed(page, table) {
  await page.evaluate(async (data) => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((r) => r.id === active)?.db ||
        "quire";
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
          for (const row of data[key]) tx.objectStore(key).put(row);
        }
        for (const key of ["listings", "loans", "sheets", "handouts"])
          tx.objectStore("meta").put({ id: key, [key]: data[key] ?? [] });
        tx.objectStore("meta").put({ id: "journal", value: data.journal });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, table);
}
async function readJournal(page) {
  return page.evaluate(async () => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((r) => r.id === active)?.db ||
        "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const read = (store, key) =>
        new Promise((resolve, reject) => {
          const r = key ? db.transaction(store).objectStore(store).get(key) : db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      return { journal: (await read("meta", "journal")).value, ledger: await read("ledger"), holdings: await read("holdings") };
    } finally {
      db.close();
    }
  });
}
async function fits(page, label) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${label}: no horizontal scroll`,
  );
}
/** Aster runs two forges: one in the city, one at the region's hall above it. */
function twoForges() {
  let t = smithFixture();
  t = {
    ...t,
    shops: [...t.shops, { ...t.shops[0], id: "hall-forge", name: "Hall Forge", locationId: "region" }],
  };
  return applyCommand(t, smithDm, {
    id: "profile-hall",
    kind: "smith-profile",
    shopId: "hall-forge",
    before: null,
    profile: defaultSmith("hall-forge", "maker"),
  });
}
let npcName = "Aster";
const talk = (page) => page.getByRole("region", { name: `Talk to ${npcName}`, exact: true });
const reply = (page, text) => talk(page).locator(".npc-talk-reply").filter({ hasText: text });
async function open(page, fixture, npc = "maker", name = "Aster") {
  npcName = name;
  validateWorld(fixture);
  await seed(page, fixture);
  await reloadApplication(page);
  await navigateApplication(page, origin + `/features/npcs?npc=${npc}`);
  await expect(talk(page)).toBeVisible();
}
const said = (page, text) => talk(page).locator(".sr-only").getByText(text, { exact: true }).last();

/** Approve campaign downtime on this device, the same way the DM does at the table. */
async function approveDowntime(page, days) {
  await navigateApplication(page, origin + "/features/downtime");
  const summary = page.locator("summary").filter({ hasText: "Set downtime & review calculations" });
  if (!(await summary.locator("..").evaluate((el) => el.open))) await summary.click();
  await page.getByLabel("In-game days", { exact: true }).fill(String(days));
  await page.getByRole("button", { name: /^(Preview|Recalculate) downtime$/ }).click();
  await expect(page.locator("main")).toContainText("Workshop commissions");
  await expect(page.locator("main")).toContainText("Commissions ·");
  const id = (await readJournal(page)).journal.finance.downtime.at(-1).id;
  await page.getByRole("button", { name: /^(Play sessions|Session ·)/ }).click();
  await page.getByLabel("Session name", { exact: true }).fill("Brewing days");
  await page.getByRole("checkbox", { name: /I approve the downtime plan/ }).check();
  await page.getByRole("button", { name: "Approve downtime & start session", exact: true }).click();
  await expect
    .poll(async () => (await readJournal(page)).journal.finance.downtime.find((d) => d.id === id)?.status)
    .toBe("applied");
}

/** Workshop: three potions with herbs, approved downtime, then collect once at the workshop. */
async function workshop(page, width) {
  await open(page, workshopFixture(), "tamsin", "Old Tamsin");
  await reply(page, "Can you brew something for me?").click();
  await reply(page, "Potion of Healing").click();
  const drawer = talk(page).locator(".npc-talk-drawer");
  await drawer.getByRole("button", { name: "More how many" }).click();
  await drawer.getByRole("button", { name: "More how many" }).click();
  await expect(drawer.getByLabel(/Bring your own: Healing herbs/)).toBeChecked();
  // Bring two of the three bundles; Tamsin supplies the third.
  await drawer.getByRole("button", { name: "Fewer healing herbs you bring" }).click();
  await expect(drawer.locator(".svc-total")).toContainText("100 gp");
  await expect(drawer).toContainText("3 approved downtime days");
  await fits(page, `${width} brew`);
  await page.screenshot({ path: `${output}/workshop-order-${width}.png`, fullPage: true });
  const commission = reply(page, "Let's do it.");
  await expect(commission).toContainText("ready after 3 downtime days");
  await commission.click();
  await expect.poll(async () => (await readJournal(page)).journal.services.orders.at(-1)?.status).toBe("active");
  let state = await readJournal(page);
  const order = state.journal.services.orders.at(-1);
  assert.equal(state.holdings.find((h) => h.id === "herbs").quantity, 1, "two bundles handed over once");

  // The Market register follows the order while travelling.
  await navigateApplication(page, origin + "/market");
  await page.getByText("Service commission register", { exact: true }).click();
  await expect(page.getByRole("article", { name: "Commission Potion of Healing ×3" })).toContainText("0/3 approved downtime days");
  await fits(page, `${width} register`);

  await approveDowntime(page, 3);
  await expect.poll(async () => (await readJournal(page)).journal.services.orders.at(-1).status).toBe("ready");
  await navigateApplication(page, origin + "/features/npcs?npc=tamsin");
  const hub = reply(page, "Can you brew something for me?");
  await expect(hub).toContainText("Your Potion of Healing is ready to collect.");
  await hub.click();
  await reply(page, "Collect · Potion of Healing ×3").click();
  await expect(talk(page)).toContainText("Collected into Kael's inventory");
  state = await readJournal(page);
  const crafted = state.holdings.filter((h) => h.id === order.id + "-crafted");
  assert.equal(crafted.length, 1);
  assert.equal(crafted[0].quantity, 3);
  assert.equal(state.journal.services.orders.at(-1).status, "claimed");
  await fits(page, `${width} collected`);
  await page.screenshot({ path: `${output}/workshop-collected-${width}.png`, fullPage: true });
}

/** Inn: book two nights for the party, then buy a rumour delivered to the private thread. */
async function inn(page, width) {
  await open(page, innFixture(), "bram", "Bram Tolliver");
  await reply(page, "We need rooms, and a meal.").click();
  const drawer = talk(page).locator(".npc-talk-drawer");
  await expect(drawer.getByRole("button", { name: /^Comfortable/ })).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.getByRole("button", { name: /^Wren/ })).toBeDisabled();
  await drawer.getByRole("button", { name: "More nights" }).click();
  await expect(drawer.locator(".svc-total")).toContainText("Rooms · 2 guests × 2 nights × 8 sp");
  await expect(drawer.locator(".svc-total")).toContainText("4 gp, 8 sp");
  await fits(page, `${width} inn booking`);
  await page.screenshot({ path: `${output}/inn-booking-${width}.png`, fullPage: true });
  const bookIt = reply(page, "We'll take it.");
  await expect(bookIt).toContainText("Book");
  await bookIt.click();
  await expect(talk(page).getByLabel("Receipt: Rooms and meals")).toContainText("Buying a room doesn't grant a rest");
  let state = await readJournal(page);
  assert.equal(state.ledger.filter((l) => l.copper === -480).length, 1, "booked and paid once");

  await reply(page, "Heard anything interesting?").click();
  await expect(reply(page, "Lights at the old mill.")).toContainText("5 sp");
  await expect(talk(page)).not.toContainText("lanterns in the old mill");
  await reply(page, "Lights at the old mill.").click();
  await expect(said(page, "SECRET: lanterns in the old mill three nights running.")).toBeAttached();
  await expect(reply(page, "Lights at the old mill.")).toBeDisabled();
  await talk(page).getByRole("button", { name: "Share in party chat" }).click();
  await expect(talk(page).getByRole("button", { name: "Shared in party chat" })).toBeVisible();
  await expect(page.locator(".world-message.svc-rumour")).toContainText("lanterns in the old mill");
  state = await readJournal(page);
  assert.deepEqual(state.journal.services.providers.find((p) => p.id === "goose-inn").rumours.find((r) => r.id === "mill").buyers, ["kael"]);
  await fits(page, `${width} rumour`);
  await page.screenshot({ path: `${output}/inn-rumour-${width}.png`, fullPage: true });
}

/** DM setup on the shop page: edit an offer's price and save; the change is one DM command. */
async function setup(page) {
  await navigateApplication(page, origin + "/shop/temple");
  const section = page.getByRole("region", { name: "Services at this shop" });
  await section.getByText("Configure Temple", { exact: true }).click();
  const row = section.locator(".svc-offer-row").filter({ hasText: "Cure Wounds" });
  await row.locator("summary").click();
  await row.getByLabel("Price (copper)").fill("4500");
  await section.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect
    .poll(async () => (await readJournal(page)).journal.services.providers[0].offers.find((o) => o.key === "cure-wounds").priceCopper)
    .toBe(4500);
  const events = (await readJournal(page)).journal.events.filter((e) => e.summary.startsWith("Service updated"));
  assert.ok(events.length >= 1 && events.every((e) => e.dmOnly), "provider changes are DM-only events");
  await page.screenshot({ path: `${output}/temple-setup-1280.png`, fullPage: true });
}

/** Temple: an instant offer paid at once, then Raise Dead requested, approved in the inbox. */
async function temple(page, width) {
  await open(page, servicesFixture(), "aldous", "Brother Aldous");
  const services = reply(page, "I need a priest's help.");
  await expect(services).toContainText("[Services · Temple]");
  await services.click();
  await expect(said(page, "Say what ails you, and who. The faithful ask an offering for each blessing.")).toBeAttached();
  // Resurrection is listed but locked: Harrowgate is a town.
  await expect(reply(page, "Resurrection")).toBeDisabled();
  await expect(reply(page, "Resurrection")).toContainText("Only in a city. Harrowgate is a town.");
  await expect(talk(page)).not.toContainText("Greater Restoration");
  await fits(page, `${width} temple offers`);
  await page.screenshot({ path: `${output}/temple-offers-${width}.png`, fullPage: true });

  await reply(page, "Remove Curse").click();
  const drawer = talk(page).locator(".npc-talk-drawer");
  await drawer.getByRole("button", { name: /^Thorn/ }).click();
  await expect(drawer.getByRole("button", { name: /^Wren/ })).toBeDisabled();
  await expect(drawer.locator(".svc-total")).toContainText("300 gp");
  const pay = reply(page, "Here's the offering.");
  await expect(pay).toContainText("Pay 300 gp");
  await fits(page, `${width} remove curse`);
  await pay.click();
  await expect(talk(page).getByLabel("Receipt: Remove Curse")).toContainText("Recorded only. The DM updates Thorn's sheet");
  let state = await readJournal(page);
  assert.equal(state.journal.services.orders.at(-1).status, "completed");
  assert.equal(state.ledger.filter((l) => l.id.endsWith("-payment") && l.copper === -30000).length, 1, "paid once");

  // Raise Dead: bring the diamond, ask the priest; nothing moves until the DM approves.
  await reply(page, "Raise Dead").click();
  await drawer.getByRole("button", { name: /^Thorn/ }).click();
  await expect(drawer.getByLabel(/Bring your own: Diamond \(500 gp\)/)).toBeChecked();
  await expect(drawer.locator(".svc-choice.blocked")).toContainText("Worth less than 500 gp.");
  await expect(drawer.locator(".svc-total")).toContainText("Charged when approved");
  await fits(page, `${width} raise dead`);
  await page.screenshot({ path: `${output}/temple-raise-dead-${width}.png`, fullPage: true });
  await reply(page, "Please. Here is what we bring.").click();
  await expect(talk(page)).toContainText("Sent to the DM's queue. Nothing has been charged");
  state = await readJournal(page);
  const request = state.journal.services.orders.at(-1);
  assert.equal(request.status, "requested");
  assert.ok(state.holdings.some((h) => h.id === "diamond-500"), "the diamond stays until approval");
  await expect(reply(page, "Forget I asked.")).toBeVisible();

  await navigateApplication(page, origin + "/features/review");
  const row = page.getByRole("article", { name: "Service request Raise Dead" });
  await expect(row).toContainText("Thorn is at Harrowgate");
  await fits(page, `${width} inbox`);
  await page.screenshot({ path: `${output}/temple-inbox-${width}.png`, fullPage: true });
  await row.getByLabel(/Note to the player/).fill("Thorn's soul answers. He wakes at dusk.");
  await row.getByRole("button", { name: /^Approve · charge 2000 gp/ }).click();
  await expect.poll(async () => (await readJournal(page)).journal.services.orders.at(-1).status).toBe("completed");
  state = await readJournal(page);
  assert.ok(!state.holdings.some((h) => h.id === "diamond-500"), "the diamond is consumed once");
  assert.equal(state.ledger.filter((l) => l.id === request.id + "-payment").length, 1);

  // The shop page lists the temple's offers and the order.
  await navigateApplication(page, origin + "/shop/temple");
  const section = page.getByRole("region", { name: "Services at this shop" });
  await expect(section).toContainText("Raise Dead");
  await expect(section).toContainText("completed");
  await fits(page, `${width} shop services`);
  await page.screenshot({ path: `${output}/temple-shop-${width}.png`, fullPage: true });
}

/** Wave 2 links: the fence opens its Sell tab; the bank a loan request; hire a staff proposal. */
async function links(page, width) {
  const t = applyCommand(linksFixture(), svcDm, { id: "bm-on", kind: "black-market", before: false, active: true });
  await open(page, t, "rook", "Rook");
  const fence = reply(page, "What will you give me for these?");
  await expect(fence).toContainText("Services · Fence ↗");
  await expect(fence).toHaveAttribute("href", /\/shop\/back-room#sell$/);
  await fits(page, `${width} fence`);
  await page.screenshot({ path: `${output}/links-fence-${width}.png`, fullPage: true });
  await fence.click();
  await expect(page).toHaveURL(/\/shop\/back-room#sell$/);
  await expect(page.locator("#sell")).toContainText("merchant rate 30%");
  await fits(page, `${width} fence sell tab`);

  // A player at the Counting House: Bank and Hire in one sub-list.
  await open(page, t, "ottilie", "Ottilie Grane");
  await page.evaluate(async () => {
    const seat = await import("/src/lib/quire/table.ts");
    seat.setSeat({ ...seat.getSeat(), role: "player", purseIds: ["kael"] });
  });
  const services = reply(page, "Do you offer any services?");
  await expect(services).toContainText("Services · Bank, Hire");
  await services.click();
  const bank = reply(page, "I'd like to borrow some coin.");
  await expect(bank).toContainText("Services · Bank · Harrowgate Counting House ↗");
  await expect(bank).toContainText("5% simple per 30 days, up to 500 gp");
  await fits(page, `${width} bank and hire`);
  await page.screenshot({ path: `${output}/links-sublist-${width}.png`, fullPage: true });
  await reply(page, "Do you have work for hire? I need hands.").click();
  const guard = reply(page, "I need a guard.");
  await expect(guard).toContainText("Hire · Guard");
  await guard.click();
  const drawer = talk(page).locator(".npc-talk-drawer");
  await expect(drawer.getByRole("button", { name: "Townhouse on Mill Lane" })).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.getByLabel("Name on the contract")).toHaveValue("Brannoc");
  await expect(drawer.locator(".svc-total")).toContainText("Nothing");
  await fits(page, `${width} hire`);
  await page.screenshot({ path: `${output}/links-hire-${width}.png`, fullPage: true });
  const coinsBefore = JSON.stringify((await readJournal(page)).ledger);
  await reply(page, "Send word when they can start.").click();
  await expect(talk(page)).toContainText("Staff contract proposed: Brannoc, Guard at Townhouse on Mill Lane");
  const state = await readJournal(page);
  const staff = state.journal.propertyOperations.staff;
  assert.equal(staff.length, 1);
  assert.deepEqual([staff[0].status, staff[0].wageCopper, staff[0].npcId], ["proposed", 200, "brannoc"]);
  assert.equal(JSON.stringify(state.ledger), coinsBefore, "a hire proposal moves no money");

  // The bank link opens the existing loan request with the bank named.
  await reply(page, "Never mind.").click();
  await reply(page, "Do you offer any services?").click();
  await reply(page, "I'd like to borrow some coin.").click();
  await expect(page).toHaveURL(/\/features\/bank\?bank=ottilie-bank/);
  await expect(page.getByLabel("Loan reason")).toHaveValue("Loan from Harrowgate Counting House (Ottilie Grane). ");
  await expect(page.locator("main")).toContainText("From Harrowgate Counting House");
  await fits(page, `${width} loan request`);
  await page.screenshot({ path: `${output}/links-loan-${width}.png`, fullPage: true });
  await page.evaluate(async () => {
    const seat = await import("/src/lib/quire/table.ts");
    seat.setSeat({ ...seat.getSeat(), role: "dm", purseIds: [] });
  });
}

try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: "block" });
    await context.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (route) => route.abort(),
    );
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/market");
    if (width === 390) {
      await navigateApplication(page, origin + "/settings#appearance");
      await page.getByRole("button", { name: "Light · Adventurer’s Ledger", exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.fantasyTheme === "adventurers-ledger");
    }
    if (runs("hub")) {
    // One forge: the Services reply opens it directly.
    await open(page, smithFixture());
    const forge = reply(page, "Do you take commissions?");
    await expect(forge).toContainText("[Services · Blacksmith]");
    await expect(forge).toHaveAttribute("href", /\/shop\/forge$/);
    await fits(page, `${width} single`);
    await page.screenshot({ path: `${output}/hub-single-${width}.png`, fullPage: true });
    await forge.click();
    await expect(page).toHaveURL(/\/shop\/forge$/);

    // The DM switched the NPC's permission off: the hub runs the real check and says why,
    // instead of opening a shop page that then refuses.
    const off = smithFixture();
    off.journal.world.npcs[0].blacksmithServices = false;
    await open(page, off);
    const locked = reply(page, "Do you take commissions?");
    await expect(locked).toBeDisabled();
    await expect(locked).toContainText("The DM has not enabled this NPC's blacksmith services.");
    await fits(page, `${width} locked`);
    await page.screenshot({ path: `${output}/hub-locked-${width}.png`, fullPage: true });

    // Two forges: a sub-list with one numbered reply per provider; Never mind returns.
    await open(page, twoForges());
    const services = reply(page, "Do you offer any services?");
    await expect(services).toContainText("2 services here");
    await services.focus();
    await page.keyboard.press("3");
    await expect(reply(page, "Opens Dawn Forge's commissions.")).toBeVisible();
    await expect(reply(page, "Opens Hall Forge's commissions.")).toBeVisible();
    await fits(page, `${width} sub-list`);
    await page.screenshot({ path: `${output}/hub-list-${width}.png`, fullPage: true });
    await reply(page, "Never mind.").click();
    await expect(reply(page, "Do you offer any services?")).toBeVisible();
    await reply(page, "Do you offer any services?").click();
    await reply(page, "Opens Hall Forge's commissions.").focus();
    await page.keyboard.press("2");
    await expect(page).toHaveURL(/\/shop\/hall-forge$/);

    }
    // Ironbound (the default) at 1280 and 320; Parchment (Adventurer's Ledger) at 390.
    if (runs("temple")) await temple(page, width);
    if (width === 1280 && runs("setup")) await setup(page);
    if (runs("workshop")) await workshop(page, width);
    if (runs("inn")) await inn(page, width);
    if (runs("links")) await links(page, width);
    await context.close();
  }
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(`Services audit passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await browser.close();
}
