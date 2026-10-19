import assert from "node:assert/strict";
import { expect } from "playwright/test";
import { navigateApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";

export async function checkOnlineTabletop(dm, player, origin, width, output, journal) {
  await navigateApplication(dm, origin + "/maps");
  await chooseOption(dm.getByLabel("Map type filter", { exact: true }), "property");
  await dm.getByRole("button", { name: "Inspector", exact: true }).click();
  const inspector = dm.getByRole("complementary", { name: "Map inspector" });
  await inspector.getByRole("button", { name: "Scene permissions & vision", exact: true }).click();
  await inspector
    .getByRole("checkbox", { name: "Allow assigned-player token movement", exact: true })
    .check();
  await inspector
    .getByRole("checkbox", { name: "Allow player area templates", exact: true })
    .check();
  await inspector.getByRole("button", { name: "Save scene settings", exact: true }).click();
  const ownToken = player.getByTitle("Combatant: Tile Hero", { exact: true });
  await ownToken.click();
  const playerInspector = player.getByRole("complementary", { name: "Map inspector" });
  await expect(
    playerInspector.getByRole("button", { name: "Move to exact position" }),
  ).toBeVisible();
  const before = await journal(dm),
    money = before.events.filter((event) => event.kind !== "management");
  await playerInspector.getByLabel("Column", { exact: true }).fill("6");
  await playerInspector.getByLabel("Row", { exact: true }).fill("4");
  await playerInspector
    .getByRole("button", { name: "Move to exact position", exact: true })
    .click();
  const hero = async () =>
    (await journal(dm)).world.maps
      .find((map) => map.id === "keep")
      .tokens.find((token) => token.entityId === "hero");
  await expect.poll(async () => (await hero()).column).toBe(5);
  const viewport = player.getByRole("region", { name: "Interactive campaign map", exact: true });
  await viewport.focus();
  await viewport.press("ArrowRight");
  await expect.poll(async () => (await hero()).column).toBe(6);
  await ownToken.scrollIntoViewIfNeeded();
  const start = await ownToken.boundingBox(),
    layer = await player.locator(".map-layer").boundingBox();
  await player.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await player.mouse.down();
  await player.mouse.move(layer.x + layer.width * 0.75, layer.y + layer.height * 0.35, {
    steps: 5,
  });
  await player.mouse.up();
  await expect.poll(async () => (await hero()).column).toBe(7);
  await player.getByRole("button", { name: "Measure", exact: true }).click();
  await viewport.scrollIntoViewIfNeeded();
  const box = await viewport.boundingBox();
  await viewport.click({ position: { x: box.width * 0.3, y: box.height * 0.4 } });
  await viewport.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
  await expect(player.getByLabel("Measured distance", { exact: true })).not.toHaveText("0.0 ft");
  await player.getByRole("button", { name: "Cancel tool", exact: true }).click();
  await player.getByRole("button", { name: "Area template", exact: true }).click();
  await viewport.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect
    .poll(
      async () =>
        (await journal(dm)).world.maps.find((map) => map.id === "keep").tabletop.templates.length,
    )
    .toBe(1);
  await player.getByRole("button", { name: "Cancel tool", exact: true }).click();
  assert.deepEqual(
    (await journal(dm)).events.filter((event) => event.kind !== "management"),
    money,
    "Visual tools do not advance time or create financial events",
  );
  await dm.getByRole("button", { name: "Activate for players", exact: true }).click();
  await expect(player.getByRole("region", { name: "Map session status" })).toContainText(
    "Players’ active scene: Keep map",
  );
  const transform = await player.locator(".map-layer").evaluate((node) => node.style.transform);
  await dm.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.equal(
    await player.locator(".map-layer").evaluate((node) => node.style.transform),
    transform,
    "DM preparation does not move remote cameras",
  );
  await dm.getByRole("button", { name: "Share this view", exact: true }).click();
  await expect
    .poll(() => player.locator(".map-layer").evaluate((node) => node.style.transform))
    .not.toBe(transform);
  await dm.getByRole("button", { name: "Fit map", exact: true }).click();
  await dm.getByRole("button", { name: "Exploration & lighting", exact: true }).click();
  await dm.getByRole("button", { name: "Conceal all", exact: true }).click();
  const scene = async () => (await journal(dm)).world.maps.find((map) => map.id === "keep");
  await expect
    .poll(async () => {
      const map = await scene();
      return map.tabletop.frames.some(
        (frame) => frame.audience === "party" && frame.revision === map.tabletop.revision,
      );
    })
    .toBe(true);
  await expect(ownToken).toHaveCount(0);
  const detail = player.locator(".map-layer > .map-media-detail").first();
  await expect(detail).toBeVisible();
  async function alpha(x, y) {
    return detail.evaluate(
      async (img, p) => {
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(
          Math.floor(p.x * canvas.width),
          Math.floor(p.y * canvas.height),
          1,
          1,
        ).data[3];
      },
      { x, y },
    );
  }
  await expect.poll(() => alpha(0.2, 0.2)).toBe(0);
  await dm.getByRole("button", { name: "Fog rectangle", exact: true }).click();
  const dmView = dm.getByRole("region", { name: "Interactive campaign map", exact: true });
  await dmView.scrollIntoViewIfNeeded();
  const rect = await dm.locator(".map-layer").boundingBox();
  await dm.mouse.move(rect.x + rect.width * 0.05, rect.y + rect.height * 0.05);
  await dm.mouse.down();
  await dm.mouse.move(rect.x + rect.width * 0.85, rect.y + rect.height * 0.7, { steps: 5 });
  await dm.mouse.up();
  await expect.poll(() => alpha(0.2, 0.2)).toBe(255);
  await expect.poll(() => alpha(0.95, 0.95)).toBe(0);
  await expect(ownToken).toBeVisible();
  await expect(player.locator(".campaign-maps")).not.toContainText("Hidden guard");
  await dm.getByRole("button", { name: "Undo fog", exact: true }).click();
  await expect.poll(() => alpha(0.2, 0.2)).toBe(0);
  await dm.getByRole("button", { name: "Redo fog", exact: true }).click();
  await expect.poll(() => alpha(0.2, 0.2)).toBe(255);
  await dm.getByRole("button", { name: "Player-view preview", exact: true }).click();
  await expect(dm.getByRole("img", { name: "Player view of Keep map", exact: true })).toBeVisible();
  await reloadApplication(player);
  await expect.poll(() => alpha(0.2, 0.2)).toBe(255);
  await expect.poll(() => alpha(0.95, 0.95)).toBe(0);
  await expect(ownToken).toBeVisible();
  await player.screenshot({
    path: `${output}/online-tabletop-player-${width}.png`,
    fullPage: true,
  });
  assert.equal(
    await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
}
