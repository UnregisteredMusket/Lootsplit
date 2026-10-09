import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import {
  openApplication,
  reloadApplication,
  navigateApplication,
} from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
assert.match(
  origin,
  /^http:\/\/(127\.0\.0\.1|localhost):/,
  "Property fixtures require a disposable server",
);
const output = "test-results/properties";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const contexts = [],
  errors = [];
let currentPage;
async function device(width, guest = false) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    serviceWorkers: "block",
    extraHTTPHeaders: {
      "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`,
    },
  });
  contexts.push(context);
  await context.route(
    (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
    (route) => route.abort(),
  );
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const page = await context.newPage();
  page.guestAccessAudit = guest;
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  return page;
}
async function rows(page, store) {
  return page.evaluate(async (store) => {
    const active = localStorage.getItem("quire.campaign.v1"),
      name =
        JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find(
          (row) => row.id === active,
        )?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, store);
}
async function listings(page) {
  return (await rows(page, "meta")).find((row) => row.id === "listings")?.listings || [];
}
async function decode(image) {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true);
}
async function overflow(page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "Property view fits the viewport",
  );
  for (const dialog of await page.getByRole("dialog").all()) {
    assert.ok(
      await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      "Property dialog fits its available width",
    );
  }
}
async function lightAppearance(page) {
  await page.evaluate(() => {
    window.propertyAppearanceDocument = "same-document";
  });
  await page.locator(".settings-trigger").click();
  const preferences = page.getByRole("dialog", { name: "Settings & Management", exact: true });
  await preferences.getByRole("button", { name: /^Appearance/ }).click();
  await preferences.getByLabel("Theme", { exact: true }).selectOption("light");
  await page.waitForFunction(
    () => document.documentElement.dataset.fantasyTheme === "adventurers-ledger",
  );
  await preferences.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("heading", { name: "Property Management", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.propertyAppearanceDocument), "same-document");
  assert.equal(await page.locator(".loot-opening").count(), 0);
  const contrast = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const luminance = (color) => {
      const channels = color
        .trim()
        .match(/[a-f\d]{2}/gi)
        .map((value) => parseInt(value, 16) / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(root.getPropertyValue("--color-fg"));
    const background = luminance(root.getPropertyValue("--color-subtle"));
    return {
      ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      darkInk: foreground < background,
    };
  });
  assert.ok(contrast.ratio >= 4.5, "Property text uses the readable shared theme palette");
  assert.ok(contrast.darkInk, "Light property surfaces use dark text");
}
async function join(width, invitation, character) {
  const page = await device(width, true);
  currentPage = page;
  await openApplication(
    page,
    `${origin}/share?join=${invitation.code}&session=${invitation.sessionId}`,
  );
  await page.getByRole("button", { name: "Find characters", exact: true }).click();
  await page.getByLabel("Your name", { exact: true }).fill(`${character} player`);
  await page.getByLabel(/^Choose your character/).selectOption(character);
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await page.getByText("You joined as a player", { exact: true }).waitFor();
  return page;
}
try {
  for (const width of [1280, 390]) {
    const dm = await device(width);
    currentPage = dm;
    await openApplication(dm, origin + "/features/properties");
    await dm.getByRole("button", { name: "New property listing", exact: true }).waitFor();
    // Location, broker and funds are prerequisites; listing edits, purchases, transfers and sales use real UI/service paths.
    await dm.evaluate(async () => {
      const active = localStorage.getItem("quire.campaign.v1"),
        name =
          JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find(
            (row) => row.id === active,
          )?.db || "quire";
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(
            ["purses", "holdings", "shops", "stock", "ledger", "meta"],
            "readwrite",
          );
          for (const store of ["purses", "holdings", "shops", "stock", "ledger"])
            tx.objectStore(store).clear();
          for (const id of ["buyer", "recipient"])
            tx.objectStore("purses").put({
              id,
              name: id === "buyer" ? "Álwen Oak" : "Borin Stone",
              kind: "character",
              coins: { cp: 0, sp: 0, ep: 0, gp: id === "buyer" ? 1000 : 0, pp: 0 },
            });
          tx.objectStore("shops").put({
            id: "broker",
            name: "Estate broker",
            keeper: "Steward",
            place: "Guildhall",
            notes: "",
            sellRate: 1,
            buyRate: 0.5,
            wealth: "rich",
            category: "mixed",
            priceScale: 1,
          });
          tx.objectStore("meta").put({ id: "listings", listings: [] });
          tx.objectStore("meta").put({
            id: "journal",
            value: {
              sessions: [],
              requests: [],
              events: [],
              market: {
                currentLocationId: "area",
                locations: [
                  {
                    id: "region",
                    kind: "region",
                    parentId: null,
                    name: "Green Coast",
                    description: "Roads and woodland",
                  },
                  {
                    id: "city",
                    kind: "city",
                    parentId: "region",
                    name: "Oakport",
                    description: "A bustling harbor",
                  },
                  {
                    id: "area",
                    kind: "area",
                    parentId: "city",
                    name: "Docks",
                    description: "Waterfront homes",
                  },
                  {
                    id: "remote",
                    kind: "region",
                    parentId: null,
                    name: "Ashlands",
                    description: "Distant mountains",
                  },
                ],
              },
            },
          });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
    await reloadApplication(dm);
    async function createProperty(name, location, type, price, images = false) {
      await dm.getByRole("button", { name: "New property listing", exact: true }).click();
      const dialog = dm.getByRole("dialog", { name: "Post a property deed" });
      await dialog.getByLabel("Listing name", { exact: true }).fill(name);
      await dialog.getByLabel("Listing asking price", { exact: true }).fill(price);
      await dialog
        .getByLabel("Listing description", { exact: true })
        .fill("An adventurer's refuge, with a welcoming hearth and a walled garden.");
      await dialog.getByLabel("Property location", { exact: true }).selectOption(location);
      await dialog.getByLabel("Property type", { exact: true }).selectOption(type);
      await dialog.getByLabel("Property condition", { exact: true }).selectOption("maintained");
      await dialog.getByLabel("Rooms", { exact: true }).fill("8");
      await dialog
        .getByLabel("Property features", { exact: true })
        .fill("Stable, Cellar, Walled garden");
      if (images) {
        await dialog.locator(".property-image-editor summary").click();
        await dialog.getByLabel("Property image 1", { exact: true }).setInputFiles({
          name: "estate.webp",
          mimeType: "image/webp",
          buffer: await readFile("public/art/property-default.webp"),
        });
        await decode(dialog.getByAltText("Property image 1 preview"));
      }
      await dialog.getByRole("button", { name: "Save property listing", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      return (await listings(dm)).find((listing) => listing.name === name).id;
    }
    const innName = `Lantern & Oak ${width}`,
      towerName = `Ashlands Watchtower ${width}`;
    const innId = await createProperty(innName, "area", "inn", "750 gp", true);
    const towerId = await createProperty(towerName, "remote", "tower", "1500 gp");
    await dm.getByLabel("Listing location", { exact: true }).selectOption("city");
    await expect(dm.locator(".property-card")).toHaveCount(1);
    await dm.getByRole("button", { name: "Clear property filters", exact: true }).click();
    await dm.getByRole("button", { name: `Compare ${innName}`, exact: true }).click();
    await dm.getByRole("button", { name: `Compare ${towerName}`, exact: true }).click();
    await expect(dm.getByRole("region", { name: "Compare properties" })).toContainText(
      "Green Coast / Oakport / Docks",
    );
    await overflow(dm);
    await dm.screenshot({ path: `${output}/register-${width}.png`, fullPage: true });
    await dm.getByRole("button", { name: "Clear comparison", exact: true }).click();
    await lightAppearance(dm);
    await overflow(dm);
    await dm.screenshot({ path: `${output}/register-light-${width}.png`, fullPage: true });
    await dm.getByRole("button", { name: "New property listing", exact: true }).click();
    const lightEditor = dm.getByRole("dialog", { name: "Post a property deed", exact: true });
    await expect(lightEditor).toBeVisible();
    await overflow(dm);
    if (width === 390) {
      await dm.setViewportSize({ width: 320, height: 950 });
      await overflow(dm);
      await dm.screenshot({ path: `${output}/editor-light-320.png`, fullPage: true });
      await dm.setViewportSize({ width, height: 950 });
    }
    await lightEditor.getByRole("button", { name: "Close", exact: true }).click();
    await dm.getByRole("button", { name: `Edit ${towerName} listing`, exact: true }).click();
    const editor = dm.getByRole("dialog", { name: "Edit property listing" });
    await editor.getByLabel("Listing status", { exact: true }).selectOption("reserved");
    await editor.getByRole("button", { name: "Save property listing", exact: true }).click();
    await expect(editor).toHaveCount(0);
    assert.equal((await listings(dm)).find((l) => l.id === towerId).status, "reserved");
    await reloadApplication(dm);
    assert.equal((await listings(dm)).find((l) => l.id === innId).property.rooms, 8);
    await navigateApplication(dm, origin + "/share");
    await dm.getByRole("button", { name: "Start a room", exact: true }).click();
    await expect(dm.locator('.multiplayer-hub[aria-busy="false"]')).toBeVisible();
    await dm.getByRole("button", { name: "Live", exact: true }).click();
    await dm.getByRole("button", { name: "Create room", exact: true }).click();
    await dm.getByRole("button", { name: "Share join link", exact: true }).waitFor();
    const invitation = await dm.evaluate(() => {
      const id = localStorage.getItem("quire.campaign.v1") || "main";
      const room = JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`));
      return { code: room.code, sessionId: room.sessionId };
    });
    const buyer = await join(width, invitation, "buyer"),
      recipient = await join(width, invitation, "recipient");
    currentPage = buyer;
    await navigateApplication(buyer, origin + "/market");
    await buyer
      .getByRole("link", { name: "Property listings · deeds & dwellings →", exact: true })
      .click();
    assert.equal(await buyer.locator(".loot-opening").count(), 0);
    await expect(buyer.locator(".property-card")).toHaveCount(1);
    await expect(
      buyer.getByRole("button", { name: "New property listing", exact: true }),
    ).toHaveCount(0);
    await buyer.getByRole("button", { name: `View ${innName}`, exact: true }).click();
    const viewing = buyer.getByRole("dialog", { name: innName, exact: true });
    await decode(viewing.getByAltText(`${innName} · view 1`));
    await viewing.getByRole("button", { name: "Review property purchase", exact: true }).click();
    await expect(viewing).toContainText("After purchase");
    await viewing.getByRole("button", { name: "Confirm purchase · 750 gp", exact: true }).click();
    await expect(
      viewing.getByRole("status").filter({ hasText: "Property purchased" }),
    ).toBeVisible();
    await expect.poll(async () => (await rows(dm, "holdings")).length).toBe(1);
    const purchased = (await rows(dm, "holdings"))[0];
    assert.equal(purchased.deed.ownerName, "Álwen Oak");
    assert.equal(purchased.deed.location, "Green Coast / Oakport / Docks");
    assert.equal(purchased.deed.totalCopper, 75000);
    await viewing.getByRole("button", { name: "Close", exact: true }).click();
    await buyer.getByRole("link", { name: "Owned properties ↓", exact: true }).click();
    await buyer.getByRole("button", { name: `View deed for ${innName}`, exact: true }).click();
    const deed = buyer.getByRole("dialog", { name: `Deed · ${innName}`, exact: true });
    await decode(deed.locator(".property-deed-preview"));
    const deedMarkup = await deed.locator(".property-deed-preview").getAttribute("src");
    assert.ok(decodeURIComponent(deedMarkup).includes("Álwen Oak"));
    assert.ok(decodeURIComponent(deedMarkup).includes("Green Coast / Oakport / Docks"));
    await overflow(buyer);
    await buyer.screenshot({ path: `${output}/deed-${width}.png`, fullPage: true });
    await deed.getByRole("button", { name: "Close", exact: true }).click();
    await lightAppearance(buyer);
    await buyer.getByRole("button", { name: `View deed for ${innName}`, exact: true }).click();
    await decode(deed.locator(".property-deed-preview"));
    assert.equal(
      await deed.locator(".property-deed-preview").getAttribute("src"),
      deedMarkup,
      "Appearance changes preserve the recorded deed image",
    );
    await overflow(buyer);
    await buyer.screenshot({ path: `${output}/deed-light-${width}.png`, fullPage: true });
    await deed
      .getByRole("link", { name: "Transfer through Give to a player", exact: true })
      .click();
    assert.equal(await buyer.locator(".loot-opening").count(), 0);
    const give = buyer.getByRole("dialog", { name: "Give to a player", exact: true });
    await give.getByLabel("Give to", { exact: true }).selectOption("recipient");
    await give.getByLabel("Holding to give", { exact: true }).selectOption(purchased.id);
    await give.getByRole("button", { name: "Give", exact: true }).click();
    await expect.poll(async () => (await rows(dm, "holdings"))[0]?.purseId).toBe("recipient");
    await give.getByRole("button", { name: "Close", exact: true }).click();
    await expect(buyer.locator(".inventory-panel .property-deed-thumbnail")).toHaveCount(0);
    currentPage = recipient;
    await navigateApplication(recipient, origin + "/party?section=funds");
    await expect(recipient.locator(".inventory-panel .property-deed-thumbnail")).toHaveCount(1);
    await recipient
      .locator(".inventory-panel")
      .getByRole("button", { name: `View deed for ${innName}`, exact: true })
      .click();
    await expect(recipient.getByRole("dialog")).toContainText("Registered holder: Borin Stone");
    await recipient.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await reloadApplication(recipient);
    await expect(recipient.locator(".inventory-panel .property-deed-thumbnail")).toHaveCount(1);
    await overflow(recipient);
    if (width === 390) {
      await recipient.setViewportSize({ width: 320, height: 950 });
      await overflow(recipient);
      await recipient.screenshot({ path: `${output}/inventory-320.png`, fullPage: true });
      await recipient.setViewportSize({ width, height: 950 });
    }
    await navigateApplication(recipient, origin + "/market");
    await recipient
      .locator(".market-grid")
      .getByRole("link")
      .filter({ hasText: "Estate broker" })
      .click();
    await recipient.getByRole("button", { name: "Sell", exact: true }).click();
    await expect.poll(async () => (await rows(dm, "holdings")).length).toBe(0);
    await navigateApplication(recipient, origin + "/party?section=funds");
    await expect(recipient.locator(".inventory-panel .property-deed-thumbnail")).toHaveCount(0);
    assert.equal((await rows(dm, "purses")).find((p) => p.id === "recipient").coins.gp, 375);
    const receipt = (await rows(dm, "ledger")).find((line) => line.listingPurchase);
    assert.equal(receipt.listingPurchase.holding.deed.ownerName, "Álwen Oak");
    for (const guest of [buyer, recipient])
      assert.equal(
        (await guest.evaluate(() => indexedDB.databases())).length,
        0,
        "Guest deeds stay in session memory",
      );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile property publishing/images, shared light/dark themes, 320px editor fit, location filters, comparison, reserve/reload, real shared purchase and deed rendering, character transfer, recipient reload, sale removal, receipt preservation and memory-only guests.",
  );
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
    console.error((await currentPage.locator("main").innerText()).slice(-4500));
  }
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
