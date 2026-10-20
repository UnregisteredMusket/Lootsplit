import assert from "node:assert/strict";
import { expect } from "playwright/test";
import { mapCamera, expectMapFillsScreen } from "./fullscreen-map-browser-check.mjs";
import { openMapSettings, closeMapSettings, selectWorkspaceMap } from "./map-workspace-browser.mjs";
import { chooseOption } from "./search-select-browser.mjs";
import { navigateApplication, reloadApplication } from "./title-screen-navigation.mjs";

/** Extends the real connected-map fixture; no production data or account secrets. */
export async function checkMapWorkspace(page, origin, output, width) {
  assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):/);
  const canvas = page.getByRole("region", { name: "Interactive campaign map", exact: true });
  await expectMapFillsScreen(page);
  await expect(
    page.getByRole("button", { name: /^(Fullscreen map|Enter fullscreen|Exit fullscreen)$/ }),
  ).toHaveCount(0);
  await selectWorkspaceMap(page, "region-map");
  await expect(page.getByRole("img", { name: "The Green March", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await canvas.press("ArrowRight");
  await canvas.press("ArrowDown");
  const before = await mapCamera(page);
  await navigateApplication(page, origin + "/?view=home");
  await navigateApplication(page, origin + "/maps");
  await expect(page.getByRole("img", { name: "The Green March", exact: true })).toBeVisible();
  const same = async () => {
    const after = await mapCamera(page);
    return (
      Math.abs(after.x - before.x) < 0.001 &&
      Math.abs(after.y - before.y) < 0.001 &&
      after.zoom === before.zoom
    );
  };
  await expect.poll(same).toBe(true);
  await reloadApplication(page);
  await expect(page.getByRole("img", { name: "The Green March", exact: true })).toBeVisible();
  await expect.poll(same).toBe(true);
  const search = page.getByRole("combobox", { name: "Search maps and places", exact: true });
  await search.fill("Ash & Anvil");
  const result = page.getByRole("option").filter({ hasText: "Brackenford" });
  await expect(result).toHaveCount(1);
  await page.screenshot({ path: `${output}/workspace-search-${width}.png` });
  await result.click();
  await expect(page.getByRole("img", { name: "Brackenford", exact: true })).toBeVisible();
  await expect.poll(async () => Math.abs((await mapCamera(page)).x - 0.3) < 0.001).toBe(true);
  // A hidden Settings form is kept mounted: closing/reopening must not prompt or erase it.
  await openMapSettings(page);
  const connected = page.getByRole("button", { name: "Connected maps & places", exact: true });
  if ((await connected.getAttribute("aria-expanded")) !== "true") await connected.click();
  const parent = page.getByRole("combobox", { name: "Parent map", exact: true });
  await chooseOption(parent, "");
  let dialogs = 0;
  const reject = (dialog) => {
    dialogs++;
    void dialog.dismiss();
  };
  page.on("dialog", reject);
  await closeMapSettings(page);
  await openMapSettings(page);
  await expect(parent).toHaveAttribute("data-value", "");
  assert.equal(dialogs, 0, "Reopening the same Settings draft never discards it");
  page.off("dialog", reject);
  await chooseOption(parent, "region-map");
  await closeMapSettings(page);
  // Direct tools work without Settings. Freehand notes stay personal and undo/redo works.
  const moreTools = page.getByRole("button", { name: "More map tools", exact: true });
  await moreTools.click();
  await expect(moreTools).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(moreTools).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  await page.getByRole("button", { name: "Drawing & annotations", exact: true }).click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".map-personal-sketches polyline")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  await expect(page.locator(".map-personal-sketches polyline")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo drawing", exact: true }).click();
  await expect(page.locator(".map-personal-sketches polyline")).toHaveCount(1);
  await page.getByRole("button", { name: "Text annotation", exact: true }).click();
  await page.getByLabel("Annotation text", { exact: true }).fill("My route");
  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.35 } });
  await expect(page.locator(".map-personal-sketches text")).toHaveText("My route");
  await canvas.press("Escape");
  await page.getByRole("button", { name: "Map navigation menu", exact: true }).click();
  const nav = page.getByRole("region", { name: "Map and application navigation", exact: true });
  for (const label of ["Desk", "Encounters", "Party", "Market", "Library", "Maps"])
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Encounters", exact: true }).click();
  await expect(page).toHaveURL(origin + "/encounters");
  await expect(page.locator(".loot-opening")).toHaveCount(0);
  await navigateApplication(page, origin + "/maps");
  // Router transitions may retain the map's open menu. Open it deliberately
  // instead of toggling an already-open menu closed before Hide interface.
  const menu = page.getByRole("button", { name: "Map navigation menu", exact: true });
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await nav.getByRole("button", { name: "Hide interface", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show interface", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show interface", exact: true }).click();
  await page.screenshot({ path: `${output}/workspace-${width}.png` });

  // Disposable fixture only: restore after deletion, then exercise a revoked player scene.
  await selectWorkspaceMap(page, "region-map");
  await page.evaluate(async () => {
    const campaign =
      sessionStorage.getItem("quire.window.campaign.v1") ||
      localStorage.getItem("quire.campaign.v1");
    const name =
      JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((c) => c.id === campaign)
        ?.db || "quire";
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("meta", "readwrite"),
          store = tx.objectStore("meta"),
          r = store.get("journal");
        r.onsuccess = () => {
          const row = r.result;
          row.value.world.maps = row.value.world.maps.filter((m) => m.id !== "region-map");
          store.put(row);
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  await reloadApplication(page);
  await expect(page.getByRole("img", { name: "Brackenford", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const campaign =
      sessionStorage.getItem("quire.window.campaign.v1") ||
      localStorage.getItem("quire.campaign.v1");
    const name =
      JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find((c) => c.id === campaign)
        ?.db || "quire";
    localStorage.setItem(
      campaign === "main" ? "quire.seat.v1" : `quire.seat.v1.${campaign}`,
      JSON.stringify({ role: "player", purseIds: ["hero"], shopIds: [], openedAt: Date.now() }),
    );
    // Same key format as the audited writer; account/campaign identity comes from the actual rendered fixture.
    const oldKey = Object.keys(localStorage).find(
      (k) => k.startsWith("lootsplit.map-view.v1:") && !k.includes(":sketches:"),
    );
    if (oldKey) {
      const fields = JSON.parse(oldKey.slice("lootsplit.map-view.v1:".length));
      fields[4] = "player";
      fields[5] = ["hero"];
      localStorage.setItem(
        "lootsplit.map-view.v1:" + JSON.stringify(fields),
        JSON.stringify({
          lastMapId: "town-map",
          cameras: { "town-map": { x: 0.3, y: 0.6, zoom: 1.5 } },
        }),
      );
    }
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("meta", "readwrite"),
          store = tx.objectStore("meta"),
          r = store.get("journal");
        r.onsuccess = () => {
          const row = r.result;
          row.value.world.maps.find((m) => m.id === "town-map").visible = false;
          row.value.world.tabletop = {
            activeMapId: "battle-map",
            activationId: "restricted-scene",
            playerBrowsing: false,
          };
          store.put(row);
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  await reloadApplication(page);
  await expect(page.getByRole("img", { name: "Old Watchtower", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Place marker", exact: true })).toHaveCount(0);
  await search.fill("Brackenford");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("No accessible maps or places found.")).toBeVisible();
  await search.press("Escape");
  await page.getByRole("button", { name: "Map navigation menu", exact: true }).click();
  for (const label of ["Home", "Inventory", "Campaign", "Market", "Library", "Maps"])
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  return [
    "direct-map-entry",
    "last-map-camera-route-refresh",
    "cross-map-search-focus",
    "settings-draft-retained",
    "personal-drawing-text-undo-redo",
    "six-destination-menu",
    "hide-interface",
    "deleted-map-fallback",
    "revoked-player-scene-fallback",
  ];
}
