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
  "Location fixtures require a disposable server",
);
const output = "test-results/market-locations";
await mkdir(output, { recursive: true });
const upload = {
  name: "shared-market.webp",
  mimeType: "image/webp",
  buffer: await readFile("public/art/shop-default.webp"),
};
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const errors = [],
  contexts = [];
let currentPage;
async function device(width, player = false) {
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
  page.guestAccessAudit = player;
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => errors.push(error.message));
  return page;
}
async function rows(page, store) {
  return page.evaluate(async (store) => {
    const active = localStorage.getItem("quire.campaign.v1");
    const name =
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
async function market(page) {
  return (await rows(page, "meta")).find((row) => row.id === "journal")?.value?.market;
}
async function savedQueue(page) {
  return page.evaluate(() => {
    const campaign = localStorage.getItem("quire.campaign.v1") || "main";
    const session = JSON.parse(localStorage.getItem(`quire.cloud.v2.${campaign}`));
    return { batchId: session.batchId, commands: session.pending };
  });
}
async function importState(page) {
  const [locations, shops, stock, purses, ledger, queue] = await Promise.all([
    market(page),
    rows(page, "shops"),
    rows(page, "stock"),
    rows(page, "purses"),
    rows(page, "ledger"),
    savedQueue(page),
  ]);
  return { locations, shops, stock, purses, ledger, queue };
}
async function importResponseFaults(page, code) {
  const fault = {
    reads: false,
    readUrl: "",
    incompleteReads: 0,
    loseImportName: "",
    lostSubmission: null,
    submitted: [],
  };
  // Keep the handler installed through recovery. Toggling the fault avoids
  // unroute races with an in-flight background read; context cleanup removes it.
  await page.route("**/_serverFn/**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) return route.fallback();
    const body = request.postData() || "";
    const sameRoom = body.includes(JSON.stringify(code)) && body.includes('"token"');
    const commands = sameRoom && body.includes('"commands"');
    // During this Market flow, the code/token-only operation is the room pull.
    // Learn its actual URL so this works with both development and packaged IDs.
    if (
      !fault.readUrl &&
      request.method() === "POST" &&
      sameRoom &&
      !commands &&
      !["action", "endpoint", "live", "purseId", "table", "endTurn"].some((key) =>
        body.includes(JSON.stringify(key)),
      )
    )
      fault.readUrl = request.url();
    if (commands) {
      const queue = await savedQueue(page);
      fault.submitted.push(queue);
      if (fault.loseImportName && body.includes(fault.loseImportName)) {
        assert.equal(fault.lostSubmission, null, "The user submits this import only once");
        assert.equal(queue.commands.length, 1);
        assert.equal(queue.commands[0].kind, "market-name-import");
        assert.ok(body.includes(JSON.stringify(queue.commands[0].id)));
        assert.ok(body.includes(JSON.stringify(queue.batchId)));
        fault.lostSubmission = queue;
        fault.loseImportName = "";
        // Hold reads before forwarding the write: a background poll must not
        // acknowledge the saved action before the real Retry is exercised.
        fault.reads = true;
        const response = await route.fetch();
        assert.ok(response.ok(), "The real command request reached the local server");
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
    }
    if (fault.reads && request.url() === fault.readUrl) {
      fault.incompleteReads++;
      // A JSON response without TanStack's result envelope deserializes to an
      // undefined room view. It must be rejected before touching saved state.
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.continue();
  });
  return fault;
}
function largeHierarchyFile(width) {
  const region = `Recovery Coast ${width}`;
  const source = ["region,city,town,area,shop", `${region},,,,`];
  for (let i = 0; i < 482; i++)
    source.push(`${region},,Recovery Town ${width} ${i % 25},Recovery Area ${width} ${i},`);
  // 483 source rows create 1 region + 25 towns + 482 areas = 508 locations.
  return {
    name: "synthetic-hierarchy-483.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(source.join("\n")),
  };
}
async function decode(locator) {
  await expect(locator).toBeVisible();
  await expect
    .poll(() => locator.evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true);
}
async function createLocation(page, kind, name, parentId) {
  await page.getByRole("button", { name: "Create location", exact: true }).click();
  const form = page.getByRole("form", { name: "Location configuration" });
  await form.getByLabel("Location type", { exact: true }).selectOption(kind);
  if (parentId) await form.getByLabel("Parent location", { exact: true }).selectOption(parentId);
  await form.getByLabel("Location name", { exact: true }).fill(name);
  await form.getByLabel("Location description", { exact: true }).fill(`${name} shared description`);
  await form.getByLabel("Location image", { exact: true }).setInputFiles(upload);
  await decode(form.getByAltText("Location image preview"));
  await form.getByRole("button", { name: "Save location", exact: true }).click();
  await expect(form).toHaveCount(0);
  return (await market(page)).locations.find((location) => location.name === name).id;
}
async function newShop(page, name, locationId) {
  await page.getByRole("button", { name: "New shop", exact: true }).click();
  await page.getByRole("heading", { name: "New shop", exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const shopId = new URL(page.url()).pathname.split("/").at(-1);
  await page.getByLabel("Shop name", { exact: true }).fill(name);
  await page.getByLabel("Shop name", { exact: true }).press("Tab");
  await expect
    .poll(async () => (await rows(page, "shops")).find((shop) => shop.id === shopId)?.name)
    .toBe(name);
  const form = page.getByRole("form", { name: "Shop location and image" });
  await form.getByLabel("Shop availability", { exact: true }).selectOption(locationId);
  await form.getByLabel("Shop image", { exact: true }).setInputFiles(upload);
  await decode(form.getByAltText("Shop image preview"));
  await form.getByRole("button", { name: "Save shop location and image", exact: true }).click();
  await expect(
    form.getByRole("button", { name: "Save shop location and image", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("New item", { exact: true }).fill("Location audit good");
  await page.getByLabel("New price", { exact: true }).fill("13 cp");
  await page.getByLabel("New quantity", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect
    .poll(async () => (await rows(page, "stock")).filter((stock) => stock.shopId === shopId).length)
    .toBe(1);
  await page.getByRole("link", { name: "Market", exact: true }).first().click();
  assert.equal(await page.locator(".loot-opening").count(), 0);
  return shopId;
}
try {
  for (const width of [1280, 390]) {
    const dm = await device(width);
    currentPage = dm;
    await openApplication(dm, origin + "/market");
    await dm.getByRole("button", { name: "New shop", exact: true }).waitFor();
    // Funds are an unrelated prerequisite; the audited trade still uses the real counter.
    await dm.evaluate(async () => {
      const active = localStorage.getItem("quire.campaign.v1");
      const name =
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
          const tx = db.transaction("purses", "readwrite"),
            store = tx.objectStore("purses"),
            read = store.getAll();
          read.onsuccess = () => {
            for (const purse of read.result)
              if (purse.kind === "character")
                store.put({ ...purse, coins: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 } });
          };
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
    await reloadApplication(dm);
    await dm.getByRole("button", { name: /^Manage regions, cities, towns and areas/ }).click();
    await dm.getByRole("button", { name: "Import names", exact: true }).click();
    const importDialog = dm.getByRole("dialog", { name: "Import location and shop names" });
    const namesFile = {
      name: "world.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `region,city,town,area,shop\nImported Coast ${width},Imported Port ${width},,Imported Docks ${width},Imported Forge ${width}\nImported Coast ${width},,Imported Village ${width},,Imported Inn ${width}`,
      ),
    };
    await importDialog.getByLabel("Import names file", { exact: true }).setInputFiles(namesFile);
    await importDialog.getByRole("button", { name: "Review import", exact: true }).click();
    await expect(
      importDialog.getByText("4 new locations · 2 new shops", { exact: true }),
    ).toBeVisible();
    await dm.screenshot({ path: `${output}/import-preview-${width}.png` });
    await importDialog.getByRole("button", { name: "Close", exact: true }).click();
    await dm.getByRole("button", { name: /^Manage regions, cities, towns and areas/ }).click();
    await dm.getByRole("button", { name: "Import names", exact: true }).click();
    await expect(importDialog.getByLabel("Names to import", { exact: true })).toHaveValue(
      namesFile.buffer.toString(),
    );
    await expect(
      importDialog.getByText("4 new locations · 2 new shops", { exact: true }),
    ).toBeVisible();
    await importDialog.getByRole("button", { name: "Import 6 new entries", exact: true }).click();
    await expect(importDialog).toHaveCount(0);
    await dm.getByRole("button", { name: /^Manage regions, cities, towns and areas/ }).click();
    const importedShop = (await rows(dm, "shops")).find(
      (shop) => shop.name === `Imported Forge ${width}`,
    );
    assert.ok(importedShop.closed);
    assert.equal(
      (await rows(dm, "stock")).filter((stock) => stock.shopId === importedShop.id).length,
      0,
    );
    const importedLocations = (await market(dm)).locations;
    assert.equal(importedLocations.length, 4);
    await dm.getByRole("button", { name: "Import names", exact: true }).click();
    await importDialog.getByLabel("Import names file", { exact: true }).setInputFiles(namesFile);
    await importDialog.getByRole("button", { name: "Review import", exact: true }).click();
    await expect(
      importDialog.getByText("0 new locations · 0 new shops", { exact: true }),
    ).toBeVisible();
    await expect(
      importDialog.getByRole("button", { name: "Import 0 new entries", exact: true }),
    ).toBeDisabled();
    await importDialog.getByLabel("Import names file", { exact: true }).setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('[{"city":"Orphan"}]'),
    });
    await importDialog.getByRole("button", { name: "Review import", exact: true }).click();
    await expect(importDialog.getByRole("alert")).toContainText("choose a region");
    assert.deepEqual((await market(dm)).locations, importedLocations);
    await importDialog.getByRole("button", { name: "Clear import", exact: true }).click();
    await importDialog.getByRole("button", { name: "Close", exact: true }).click();
    const region = await createLocation(dm, "region", `Coast ${width}`);
    const city = await createLocation(dm, "city", `Port ${width}`, region);
    const area = await createLocation(dm, "area", `Docks ${width}`, city);
    const other = await createLocation(dm, "region", `Desert ${width}`);
    await dm.getByLabel("Party location", { exact: true }).selectOption(area);
    await expect.poll(async () => (await market(dm)).currentLocationId).toBe(area);
    for (const name of [`Coast ${width}`, `Port ${width}`, `Docks ${width}`])
      await decode(dm.getByAltText(name, { exact: true }));
    const localShop = await newShop(dm, `Dock shop ${width}`, area);
    const remoteShop = await newShop(dm, `Desert shop ${width}`, other);
    await dm
      .locator(".market-grid")
      .getByRole("link")
      .filter({ hasText: `Dock shop ${width}` })
      .click();
    await dm.getByRole("button", { name: "Edit", exact: true }).click();
    const assignment = dm.getByRole("form", { name: "Shop location and image" });
    await assignment.getByLabel("Shop availability", { exact: true }).selectOption(other);
    // Emulate an independent writer after the form captured its baseline.
    async function competingAssignment(locationId) {
      await dm.evaluate(
        async ({ shopId, locationId }) => {
          const active = localStorage.getItem("quire.campaign.v1");
          const name =
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
              const tx = db.transaction("shops", "readwrite"),
                store = tx.objectStore("shops"),
                read = store.get(shopId);
              read.onsuccess = () => store.put({ ...read.result, locationId });
              tx.oncomplete = resolve;
              tx.onerror = () => reject(tx.error);
            });
          } finally {
            db.close();
          }
        },
        { shopId: localShop, locationId },
      );
    }
    await competingAssignment(region);
    await assignment
      .getByRole("button", { name: "Save shop location and image", exact: true })
      .click();
    await expect(assignment.getByRole("alert")).toContainText("changed elsewhere");
    assert.equal(
      await assignment.getByLabel("Shop availability", { exact: true }).inputValue(),
      other,
      "Conflict retains the unfinished draft",
    );
    assert.equal(
      (await rows(dm, "shops")).find((shop) => shop.id === localShop).locationId,
      region,
      "Stale form cannot overwrite the newer assignment",
    );
    await decode(assignment.getByAltText("Shop image preview"));
    await competingAssignment(area);
    await assignment
      .getByRole("button", { name: "Save shop location and image", exact: true })
      .click();
    await expect(
      assignment.getByRole("button", { name: "Save shop location and image", exact: true }),
    ).toBeDisabled();
    await assignment.getByLabel("Shop availability", { exact: true }).selectOption(area);
    await assignment
      .getByRole("button", { name: "Save shop location and image", exact: true })
      .click();
    await expect(
      assignment.getByRole("button", { name: "Save shop location and image", exact: true }),
    ).toBeDisabled();
    await dm.getByRole("link", { name: "Market", exact: true }).first().click();
    await dm.getByLabel("Available at the party's location", { exact: true }).check();
    await expect(
      dm
        .locator(".market-grid")
        .getByRole("link")
        .filter({ hasText: `Dock shop ${width}` }),
    ).toHaveCount(1);
    await expect(
      dm
        .locator(".market-grid")
        .getByRole("link")
        .filter({ hasText: `Desert shop ${width}` }),
    ).toHaveCount(0);
    await reloadApplication(dm);
    assert.equal((await market(dm)).currentLocationId, area);
    const before = (await rows(dm, "shops")).find((shop) => shop.id === localShop);
    assert.match(before.image, /^data:image\/webp;base64,/);
    assert.equal(before.locationId, area);
    await navigateApplication(dm, origin + "/share");
    await dm.getByRole("button", { name: "Start a room", exact: true }).click();
    await expect(dm.locator('.multiplayer-hub[aria-busy="false"]')).toBeVisible();
    await dm.getByRole("button", { name: "Create room", exact: true }).click();
    await dm.getByRole("button", { name: "Share join link", exact: true }).waitFor();
    const invitation = await dm.evaluate(() => {
      const id = localStorage.getItem("quire.campaign.v1") || "main";
      const session = JSON.parse(localStorage.getItem(`quire.cloud.v2.${id}`));
      return { code: session.code, sessionId: session.sessionId };
    });
    const player = await device(width, true);
    currentPage = player;
    await openApplication(
      player,
      `${origin}/share?join=${invitation.code}&session=${invitation.sessionId}`,
    );
    await player.getByRole("button", { name: "Find characters", exact: true }).click();
    await player.getByLabel("Your name", { exact: true }).fill("Location audit player");
    await player.getByRole("button", { name: "Join room", exact: true }).click();
    await player.getByText("You joined as a player", { exact: true }).waitFor();
    await navigateApplication(player, origin + "/market");
    await expect(
      player.getByRole("button", { name: /^Manage regions, cities, towns and areas/ }),
    ).toHaveCount(0);
    await expect(player.getByRole("button", { name: "New shop", exact: true })).toHaveCount(0);
    await expect(player.getByRole("button", { name: "Import names", exact: true })).toHaveCount(0);
    for (const name of [`Coast ${width}`, `Port ${width}`, `Docks ${width}`])
      await decode(player.getByAltText(name, { exact: true }));
    await expect(
      player
        .locator(".market-grid")
        .getByRole("link")
        .filter({ hasText: `Desert shop ${width}` }),
    ).toHaveCount(0);
    await player
      .locator(".market-grid")
      .getByRole("link")
      .filter({ hasText: `Dock shop ${width}` })
      .click();
    await decode(player.getByAltText(`Dock shop ${width}`, { exact: true }));
    await player.getByRole("button", { name: /^Buy / }).first().click();
    await expect
      .poll(
        async () => (await rows(dm, "stock")).find((stock) => stock.shopId === localShop)?.quantity,
      )
      .toBe(6);
    await navigateApplication(dm, origin + "/market");
    await dm.getByLabel("Party location", { exact: true }).selectOption(other);
    await player.getByRole("heading", { name: "Missing shop", exact: true }).waitFor();
    await player.getByRole("link", { name: "Back to the market", exact: true }).click();
    await decode(player.getByAltText(`Desert ${width}`, { exact: true }));
    await expect(
      player
        .locator(".market-grid")
        .getByRole("link")
        .filter({ hasText: `Dock shop ${width}` }),
    ).toHaveCount(0);
    await expect(
      player
        .locator(".market-grid")
        .getByRole("link")
        .filter({ hasText: `Desert shop ${width}` }),
    ).toHaveCount(1);
    await reloadApplication(player);
    await decode(player.getByAltText(`Desert ${width}`, { exact: true }));
    assert.equal(
      (await player.evaluate(() => indexedDB.databases())).length,
      0,
      "Guest campaign stays in memory",
    );
    const after = (await rows(dm, "shops")).find((shop) => shop.id === localShop);
    assert.deepEqual(after, before, "Movement preserves full shop configuration and image");
    assert.equal(
      (await rows(dm, "stock")).find((stock) => stock.shopId === remoteShop).quantity,
      7,
    );
    currentPage = dm;
    const responseFault = await importResponseFaults(dm, invitation.code);
    // The shared DM imports a plain shop list through the actual server command path.
    await dm.getByRole("button", { name: /^Manage regions, cities, towns and areas/ }).click();
    await dm.getByRole("button", { name: "Import names", exact: true }).click();
    await importDialog.getByLabel("Imported name type", { exact: true }).selectOption("shop");
    await importDialog.getByLabel("Import parent location", { exact: true }).selectOption(other);
    await importDialog
      .getByLabel("Names to import", { exact: true })
      .fill(`Shared Imported Shop ${width}`);
    await importDialog.getByRole("button", { name: "Review import", exact: true }).click();
    await expect(
      importDialog.getByText("0 new locations · 1 new shops", { exact: true }),
    ).toBeVisible();
    await importDialog.getByRole("button", { name: "Import 1 new entries", exact: true }).click();
    await expect(importDialog).toHaveCount(0);
    await expect(
      player
        .locator(".market-grid")
        .getByRole("link")
        .filter({ hasText: `Shared Imported Shop ${width}` }),
    ).toHaveCount(1);
    await reloadApplication(dm);
    assert.equal(
      (await rows(dm, "shops")).filter((shop) => shop.name === `Shared Imported Shop ${width}`)
        .length,
      1,
    );
    assert.equal(
      (await market(dm)).locations.filter((location) => location.name === `Imported Coast ${width}`)
        .length,
      1,
    );
    // The server may save the import even though the caller receives no result.
    // Retain that exact queued action and recover with the visible Retry control.
    currentPage = dm;
    const recoveredShopName = `Recovered Imported Shop ${width}`;
    await dm.getByRole("button", { name: "Import names", exact: true }).click();
    await importDialog.getByLabel("Imported name type", { exact: true }).selectOption("shop");
    await importDialog.getByLabel("Import parent location", { exact: true }).selectOption(other);
    await importDialog.getByLabel("Names to import", { exact: true }).fill(recoveredShopName);
    await importDialog.getByRole("button", { name: "Review import", exact: true }).click();
    await expect(
      importDialog.getByText("0 new locations · 1 new shops", { exact: true }),
    ).toBeVisible();
    const beforeLostResponse = await importState(dm);
    const submissionsBefore = responseFault.submitted.length;
    responseFault.loseImportName = recoveredShopName;
    await dm.screenshot({ path: `${output}/import-before-lost-response-${width}.png` });
    await importDialog.getByRole("button", { name: "Import 1 new entries", exact: true }).click();
    await expect(importDialog).toHaveCount(0);
    await expect.poll(async () => (await savedQueue(dm)).commands.length).toBe(1);
    assert.ok(responseFault.lostSubmission, "The real import response was replaced");
    assert.deepEqual(
      await savedQueue(dm),
      responseFault.lostSubmission,
      "Action and batch IDs survive",
    );
    await expect(
      player.locator(".market-grid").getByRole("link").filter({ hasText: recoveredShopName }),
    ).toHaveCount(1);
    await navigateApplication(dm, origin + "/share");
    const retry = dm.getByRole("button", { name: "Retry", exact: true });
    if (!(await retry.isVisible()))
      await dm.getByRole("button", { name: /^Connection & recovery/ }).click();
    await expect(retry).toBeVisible();
    await expect(dm.getByText(/shared campaign response was incomplete/i)).toBeVisible();
    assert.deepEqual(
      await savedQueue(dm),
      responseFault.lostSubmission,
      "Navigation preserves the same queued action",
    );
    await dm.screenshot({ path: `${output}/import-lost-response-retry-${width}.png` });
    responseFault.reads = false;
    await retry.click();
    await expect.poll(async () => (await savedQueue(dm)).commands.length).toBe(0);
    assert.equal(
      responseFault.submitted.length,
      submissionsBefore + 1,
      "Retry acknowledges the committed action without submitting another import",
    );
    const importedActionId = responseFault.lostSubmission.commands[0].id;
    const journal = (await rows(dm, "meta")).find((row) => row.id === "journal").value;
    assert.equal(
      journal.events.filter((event) => event.id.startsWith(`${importedActionId}-event-`)).length,
      1,
    );
    const recoveredShops = (await rows(dm, "shops")).filter(
      (shop) => shop.name === recoveredShopName,
    );
    assert.equal(recoveredShops.length, 1);
    assert.ok(recoveredShops[0].closed);
    assert.deepEqual(await rows(dm, "stock"), beforeLostResponse.stock);
    assert.deepEqual(await rows(dm, "purses"), beforeLostResponse.purses);
    assert.deepEqual(await rows(dm, "ledger"), beforeLostResponse.ledger);
    assert.deepEqual(await market(dm), beforeLostResponse.locations);
    await navigateApplication(dm, origin + "/market");
    await dm.getByRole("button", { name: "Import names", exact: true }).click();
    await importDialog.getByLabel("Imported name type", { exact: true }).selectOption("shop");
    await importDialog.getByLabel("Import parent location", { exact: true }).selectOption(other);
    await importDialog.getByLabel("Names to import", { exact: true }).fill(recoveredShopName);
    await importDialog.getByRole("button", { name: "Review import", exact: true }).click();
    await expect(
      importDialog.getByText("0 new locations · 0 new shops", { exact: true }),
    ).toBeVisible();
    await expect(
      importDialog.getByRole("button", { name: "Import 0 new entries", exact: true }),
    ).toBeDisabled();
    await importDialog.getByRole("button", { name: "Clear import", exact: true }).click();
    await importDialog.getByRole("button", { name: "Close", exact: true }).click();
    // A complete hierarchy must survive an unreadable preflight room response.
    // Use only synthetic names; the user's resource-book CSV remains private.
    currentPage = dm;
    const largeFile = largeHierarchyFile(width);
    await dm.getByRole("button", { name: "Import names", exact: true }).click();
    await importDialog.getByLabel("Import names file", { exact: true }).setInputFiles(largeFile);
    await importDialog.getByRole("button", { name: "Review import", exact: true }).click();
    await expect(
      importDialog.getByText("508 new locations · 0 new shops", { exact: true }),
    ).toBeVisible();
    await dm.screenshot({ path: `${output}/import-before-incomplete-${width}.png` });
    await expect.poll(async () => (await savedQueue(dm)).commands.length).toBe(0);
    const beforeIncomplete = await importState(dm);
    const submittedBeforeIncomplete = responseFault.submitted.length;
    const readsBeforeIncomplete = responseFault.incompleteReads;
    responseFault.reads = true;
    await importDialog.getByRole("button", { name: "Import 508 new entries", exact: true }).click();
    await expect(importDialog.getByRole("alert")).toContainText(
      /shared campaign response was incomplete/i,
    );
    assert.ok(
      responseFault.incompleteReads > readsBeforeIncomplete,
      "The actual preflight pull was interrupted",
    );
    assert.equal(
      responseFault.submitted.length,
      submittedBeforeIncomplete,
      "A failed preflight sends no import command",
    );
    await expect(importDialog.getByLabel("Names to import", { exact: true })).toHaveValue(
      largeFile.buffer.toString(),
    );
    await expect(
      importDialog.getByText("508 new locations · 0 new shops", { exact: true }),
    ).toBeVisible();
    assert.deepEqual(
      await importState(dm),
      beforeIncomplete,
      "The campaign and queue are unchanged",
    );
    await dm.screenshot({ path: `${output}/import-incomplete-retained-${width}.png` });
    responseFault.reads = false;
    await importDialog.getByRole("button", { name: "Import 508 new entries", exact: true }).click();
    await expect(importDialog).toHaveCount(0);
    await expect.poll(async () => (await savedQueue(dm)).commands.length).toBe(0);
    assert.equal(
      (await market(dm)).locations.length,
      beforeIncomplete.locations.locations.length + 508,
    );
    assert.deepEqual(await rows(dm, "shops"), beforeIncomplete.shops);
    assert.deepEqual(await rows(dm, "stock"), beforeIncomplete.stock);
    assert.deepEqual(await rows(dm, "purses"), beforeIncomplete.purses);
    assert.deepEqual(await rows(dm, "ledger"), beforeIncomplete.ledger);
    assert.equal(
      (await market(dm)).currentLocationId,
      beforeIncomplete.locations.currentLocationId,
    );
    await dm.getByRole("button", { name: "Import names", exact: true }).click();
    await importDialog.getByLabel("Import names file", { exact: true }).setInputFiles(largeFile);
    await importDialog.getByRole("button", { name: "Review import", exact: true }).click();
    await expect(
      importDialog.getByText("0 new locations · 0 new shops", { exact: true }),
    ).toBeVisible();
    await expect(
      importDialog.getByRole("button", { name: "Import 0 new entries", exact: true }),
    ).toBeDisabled();
    await importDialog.getByRole("button", { name: "Clear import", exact: true }).click();
    await importDialog.getByRole("button", { name: "Close", exact: true }).click();

    await player.screenshot({ path: `${output}/player-${width}.png`, fullPage: true });
    await dm.screenshot({ path: `${output}/dm-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile reviewed CSV/plain and 483-row hierarchy imports, malformed preflight draft retention, saved-command response recovery through real Retry, invalid JSON/duplicate protection, closed empty shops, shared server import and reload; DM hierarchy/images, player trade, live location changes and memory-only guest access.",
  );
} catch (error) {
  console.error(error);
  if (currentPage && !currentPage.isClosed()) {
    if (await currentPage.locator("main").count())
      console.error((await currentPage.locator("main").innerText()).slice(-4000));
    await currentPage.screenshot({ path: `${output}/failure.png`, fullPage: true });
  }
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
