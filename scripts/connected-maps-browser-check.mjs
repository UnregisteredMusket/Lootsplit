import { checkMapWorkspace } from "./map-workspace-browser-check.mjs";
import {
  openMapSettings,
  closeMapSettings,
  openMapNavigation,
  mapBack,
  openMoreMapTools,
} from "./map-workspace-browser.mjs";
import assert from "node:assert/strict";
import { blankEncounter, blankCombatant } from "../src/lib/encounters/model.mjs";
import { expect } from "playwright/test";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";
import { checkPlaceHub, noHorizontalScroll } from "./place-hub-browser-check.mjs";
export async function checkConnectedMaps({ browser, origin, output }) {
  assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):/);
  const results = [];
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block",
      }),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route(
      (url) => url.origin !== origin && !["data:", "blob:"].includes(url.protocol),
      (r) => r.abort(),
    );
    await context.addInitScript(() => {
      localStorage.setItem("quire.guide.offer.v3", "seen");
      Object.defineProperty(Element.prototype, "requestFullscreen", {
        value: () => Promise.reject(Error("Diagnostic fallback")),
      });
    });
    try {
      await openApplication(page, origin + "/maps");
      await page.evaluate(
        async (encounter) => {
          const id =
              sessionStorage.getItem("quire.window.campaign.v1") ||
              localStorage.getItem("quire.campaign.v1"),
            name =
              JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]").find(
                (c) => c.id === id,
              )?.db || "quire";
          const db = await new Promise((res, rej) => {
            const r = indexedDB.open(name);
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
          const canvas = document.createElement("canvas");
          canvas.width = 1200;
          canvas.height = 800;
          const c = canvas.getContext("2d");
          c.fillStyle = "#52654f";
          c.fillRect(0, 0, 1200, 800);
          c.fillStyle = "#c5b18a";
          c.fillRect(200, 250, 800, 300);
          const image = canvas.toDataURL();
          const scene = (id, name, type, locationId) => ({
            id,
            name,
            type,
            locationId,
            image,
            visible: true,
            anchors: [],
            markers: [],
          });
          const region = scene("region-map", "The Green March", "regional", "region"),
            town = scene("town-map", "Brackenford", "city", "town"),
            battle = scene("battle-map", "Old Watchtower", "battle", "town");
          region.anchors = [{ locationId: "town", x: 0.5, y: 0.55 }];
          region.connected = { links: [], placements: [] };
          town.anchors = [{ locationId: "town", x: 0.5, y: 0.5 }];
          town.connected = {
            parentMapId: region.id,
            defaultForLocation: "local",
            placements: [
              {
                id: "forge-pin",
                record: { kind: "shop", id: "forge" },
                visibility: "party",
                x: 0.3,
                y: 0.6,
              },
              {
                id: "mara-pin",
                record: { kind: "npc", id: "mara" },
                visibility: "party",
                x: 0.62,
                y: 0.32,
              },
            ],
            links: [
              {
                id: "tower",
                targetMapId: battle.id,
                label: "Watchtower gate",
                visibility: "party",
                x: 0.72,
                y: 0.6,
              },
            ],
          };
          battle.connected = {
            parentMapId: town.id,
            defaultForLocation: "battle",
            placements: [],
            links: [],
          };
          battle.grid = {
            columns: 12,
            rows: 8,
            feetPerTile: 5,
            diagonal: "equal",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          };
          try {
            await new Promise((res, rej) => {
              const tx = db.transaction(
                ["purses", "holdings", "shops", "stock", "ledger", "meta"],
                "readwrite",
              );
              for (const name of ["purses", "holdings", "shops", "stock", "ledger"])
                tx.objectStore(name).clear();
              tx.objectStore("purses").put({
                id: "hero",
                name: "Mira",
                kind: "character",
                coins: { cp: 10000, sp: 0, ep: 0, gp: 0, pp: 0 },
              });
              tx.objectStore("purses").put({
                id: "mara",
                name: "Mara",
                kind: "character",
                control: "npc",
                nonParty: true,
                coins: { cp: 500, sp: 0, ep: 0, gp: 0, pp: 0 },
              });
              for (const [id, name] of [
                ["forge", "Ash & Anvil"],
                ["inn", "The Lantern Inn"],
              ])
                tx.objectStore("shops").put({
                  id,
                  name,
                  keeper: "Clerk",
                  place: "Town",
                  locationId: "town",
                  notes: "Synthetic map service",
                  sellRate: 1,
                  buyRate: 0.5,
                  wealth: "modest",
                  category: "general",
                  priceScale: 1,
                });
              tx.objectStore("stock").put({
                id: "sword",
                shopId: "forge",
                name: "Iron sword",
                quantity: 3,
                copper: 500,
                baseCopper: 500,
                notes: "",
              });
              tx.objectStore("meta").put({ id: "localEncounters", rows: [encounter] });
              tx.objectStore("meta").put({
                id: "journal",
                value: {
                  sessions: [],
                  events: [],
                  requests: [],
                  market: {
                    currentLocationId: "town",
                    locations: [
                      {
                        id: "region",
                        name: "The Green March",
                        kind: "region",
                        parentId: null,
                        description: "",
                      },
                      {
                        id: "town",
                        name: "Brackenford",
                        kind: "town",
                        parentId: "region",
                        description: "",
                      },
                    ],
                  },
                  world: {
                    maps: [region, town, battle],
                    npcs: [
                      {
                        id: "mara",
                        name: "Mara",
                        description: "Herbalist of the square",
                        locationId: "town",
                        visible: true,
                        barterAllowed: true,
                        controllerPurseId: null,
                      },
                    ],
                  },
                },
              });
              for (const id of ["listings", "loans", "sheets", "handouts"])
                tx.objectStore("meta").put({ id, [id]: [] });
              tx.oncomplete = res;
              tx.onerror = () => rej(tx.error);
            });
          } finally {
            db.close();
          }
        },
        {
          id: `local-connected-${width}`,
          code: "device",
          body: {
            ...blankEncounter(),
            name: "Watchtower patrol",
            combatants: [{ ...blankCombatant(), id: "scout", name: "Watchtower scout" }],
          },
          revision: 0,
          status: "draft",
          updated_at: Date.now(),
          rolls: [],
          award: null,
        },
      );
      await reloadApplication(page);
      await openMapNavigation(page);
      await chooseOption(page.getByLabel("Map", { exact: true }), "region-map");

      const frame = page.getByRole("region", { name: "Map workspace", exact: true });
      await expect(frame).toHaveClass(/map-fullscreen/);
      await frame.getByRole("button", { name: "Zoom in", exact: true }).click();
      const camera = await frame.locator(".map-layer").getAttribute("style");
      await frame.getByRole("button", { name: "Location: 1 record", exact: true }).click();
      await expect(frame.getByRole("img", { name: "Brackenford", exact: true })).toBeVisible();
      await expect(frame).toHaveClass(/map-fullscreen/);
      await mapBack(page);
      await expect(frame.getByRole("img", { name: "The Green March", exact: true })).toBeVisible();
      await expect(frame.locator(".map-layer")).toHaveAttribute("style", camera);
      await frame.getByRole("button", { name: "Location: 1 record", exact: true }).click();
      await expect(frame.getByRole("img", { name: "Brackenford", exact: true })).toBeVisible();
      await frame.getByRole("button", { name: "Fit map", exact: true }).click();
      await frame.locator('button[title="Shop: Ash & Anvil"]').click();
      // One record with a service opens straight into its place card.
      const details = frame.getByRole("region", { name: "Map record details", exact: true });
      await expect(details.getByRole("heading", { name: "Ash & Anvil", exact: true })).toBeVisible();
      await details.getByRole("button", { name: /^Buy / }).click();
      await expect(details).toContainText("Purchase recorded.");
      await details.getByRole("button", { name: "Edit", exact: true }).click();
      await details.getByRole("button", { name: "Remove shop", exact: true }).click();
      const confirmation = page.getByRole("alertdialog", {
        name: "Remove this shop?",
        exact: true,
      });
      await expect(confirmation).toBeVisible();
      const cancel = confirmation.getByRole("button", { name: "Cancel", exact: true });
      assert.ok(
        await cancel.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }),
        "Service confirmation belongs to the fullscreen top layer",
      );
      await cancel.click();
      await expect(confirmation).toHaveCount(0);
      await expect(frame).toHaveClass(/map-fullscreen/);
      await details.getByRole("button", { name: "Close details", exact: true }).click();
      // The place hub steps end on Brackenford (their last links name map=town-map).
      const placeHubFlows = await checkPlaceHub(page, origin, width);
      await expect(frame.getByRole("img", { name: "Brackenford", exact: true })).toBeVisible();
      await frame.getByRole("button", { name: "Fit map", exact: true }).click();
      await frame.locator('button[title="Map: Watchtower gate"]').click();
      await expect(frame.getByRole("img", { name: "Old Watchtower", exact: true })).toBeVisible();
      await expect(frame.locator(".map-tile-grid")).toBeVisible();
      await mapBack(page);
      await expect(frame.getByRole("img", { name: "Brackenford", exact: true })).toBeVisible();
      await openMapSettings(page);
      await frame.getByRole("button", { name: "Connected maps & places", exact: true }).click();
      await chooseOption(frame.getByLabel("Record to place", { exact: true }), "inn");
      await frame.getByRole("button", { name: "Choose record position", exact: true }).click();
      const viewport = frame.getByRole("region", { name: "Interactive campaign map", exact: true }),
        box = await viewport.boundingBox(),
        layer = await frame.locator(".map-layer").boundingBox();
      await viewport.click({
        position: {
          x: layer.x - box.x + layer.width * 0.55,
          y: layer.y - box.y + layer.height * 0.65,
        },
      });
      await frame.getByRole("button", { name: "Place record on map", exact: true }).click();
      await expect(frame.locator("#map-settings")).toContainText("Recorded.");
      await closeMapSettings(page);
      const points = await frame
        .locator('button[title="Shop: Ash & Anvil"],button[title="Shop: The Lantern Inn"]')
        .evaluateAll((es) => es.map((e) => e.parentElement.style.cssText));
      assert.equal(points.length, 2);
      assert.notEqual(points[0], points[1]);
      await openMoreMapTools(page);
      await frame.getByRole("button", { name: "Start encounter here", exact: true }).click();
      const combat = frame.getByRole("region", { name: "Encounter map panel", exact: true });
      await chooseOption(
        combat.getByLabel("Saved encounter to start", { exact: true }),
        `local-connected-${width}`,
      );
      await chooseOption(combat.getByLabel("Encounter map", { exact: true }), "battle-map");
      await combat.getByLabel("Combat presentation", { exact: true }).selectOption("grid");
      await combat.getByRole("checkbox", { name: /I reviewed 5 ft per tile/ }).check();
      await combat.getByRole("button", { name: "Start saved encounter here", exact: true }).click();
      await expect(frame.getByRole("img", { name: "Old Watchtower", exact: true })).toBeVisible();
      await expect(combat).toContainText("The encounter map is open.");
      await openMapSettings(page);
      await expect(combat).toHaveCount(0);
      await expect(
        frame.getByRole("button", { name: "Encounter grid active", exact: true }),
      ).toBeDisabled();
      await openMoreMapTools(page);
      await frame.getByRole("button", { name: "Open encounter map controls", exact: true }).click();
      await combat.getByRole("button", { name: "Open encounter tracker", exact: true }).click();
      page.once("dialog", (dialog) => dialog.accept());
      await combat.getByRole("button", { name: "Conclude & review loot", exact: true }).click();
      await expect(combat).toContainText(
        "Encounter concluded. Review recipients and loot before transferring.",
      );
      await combat.getByRole("button", { name: "Return to exploration", exact: true }).click();
      await expect(frame.getByRole("img", { name: "Brackenford", exact: true })).toBeVisible();
      await combat.getByRole("button", { name: "Close encounter panel", exact: true }).click();
      await expect(frame).toHaveClass(/map-fullscreen/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `${output}/connected-${width}.png` });
      if (width === 390) {
        for (const viewport of [
          { width: 320, height: 640 },
          { width: 844, height: 390 },
        ]) {
          await page.setViewportSize(viewport);
          await frame.getByRole("button", { name: "Fit map", exact: true }).click();
          await frame.locator('button[title="Shop: Ash & Anvil"]').click();
          const panel = frame.getByRole("region", { name: "Map record details", exact: true });
          await expect(
            panel.getByRole("heading", { name: "Ash & Anvil", exact: true }).first(),
          ).toBeVisible();
          const close = panel.getByRole("button", { name: "Close details", exact: true });
          await close.scrollIntoViewIfNeeded();
          assert.ok(
            await close.evaluate((e) => {
              const r = e.getBoundingClientRect();
              return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
            }),
            "Service close control remains reachable above the map",
          );
          await close.click();
          await expect(frame).toHaveClass(/map-fullscreen/);
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          );
          // The NPC hub as a bottom sheet at this width.
          await frame.getByRole("button", { name: "Fit map", exact: true }).click();
          await frame.locator('button[title="NPC: Mara"]').click();
          await expect(panel.getByRole("region", { name: "Talk to Mara", exact: true })).toBeVisible();
          assert.ok(await noHorizontalScroll(page), `NPC sheet fits at ${viewport.width}px`);
          const npcClose = panel.getByRole("button", { name: "Close details", exact: true });
          assert.ok(
            await npcClose.evaluate((e) => {
              const r = e.getBoundingClientRect();
              return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
            }),
            "NPC sheet close control remains reachable above the map",
          );
          await npcClose.click();
          await frame.getByRole("button", { name: /^Here/ }).click();
          const hereSheet = frame.getByRole("region", { name: "Here", exact: true });
          await expect(hereSheet).toContainText("Ash & Anvil");
          assert.ok(await noHorizontalScroll(page), `Here sheet fits at ${viewport.width}px`);
          await hereSheet.getByRole("button", { name: "Close Here", exact: true }).click();
        }
      }
      await page.setViewportSize({ width, height: 900 });
      const workspaceFlows = await checkMapWorkspace(page, origin, output, width);
      assert.deepEqual(errors, []);
      results.push({
        width,
        flows: [
          ...workspaceFlows,
          ...placeHubFlows,
          "fullscreen-linked-navigation",
          "camera-return",
          "canonical-shop-purchase",
          "battle-grid",
          "individual-placement",
          "encounter-start-conclude-return",
        ],
        errors,
      });
    } catch (error) {
      await page
        .screenshot({ path: `${output}/connected-failure-${width}.png`, fullPage: true })
        .catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
  return results;
}
