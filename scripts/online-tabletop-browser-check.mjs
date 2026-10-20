import {
  openMapSettings,
  closeMapSettings,
  selectWorkspaceMap,
  selectMapType,
  openMoreMapTools,
} from "./map-workspace-browser.mjs";
import assert from "node:assert/strict";
import { expect } from "playwright/test";
import { navigateApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";

export async function checkOnlineTabletop(dm, player, origin, width, output, journal) {
  await navigateApplication(dm, origin + "/maps");
  await selectMapType(dm, "property");
  await openMoreMapTools(dm);
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
  await closeMapSettings(player);
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
  await player.getByRole("button", { name: "Close inspector", exact: true }).click();
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
  await player.getByRole("button", { name: "Close inspector", exact: true }).click();
  await player.getByRole("button", { name: "Measure", exact: true }).click();
  await viewport.scrollIntoViewIfNeeded();
  const box = await viewport.boundingBox();
  await viewport.click({ position: { x: box.width * 0.3, y: box.height * 0.4 } });
  await viewport.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
  await expect(player.getByLabel("Measured distance", { exact: true })).not.toHaveText("0.0 ft");
  await player.getByRole("button", { name: "Cancel tool", exact: true }).click();
  await player.getByRole("button", { name: "Area template", exact: true }).click();
  await player.getByRole("button", { name: "Close tool options", exact: true }).click();
  await viewport.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect
    .poll(
      async () =>
        (await journal(dm)).world.maps.find((map) => map.id === "keep").tabletop.templates.length,
    )
    .toBe(1);
  await player.getByRole("button", { name: "Pan", exact: true }).click();
  assert.deepEqual(
    (await journal(dm)).events.filter((event) => event.kind !== "management"),
    money,
    "Visual tools do not advance time or create financial events",
  );
  await openMapSettings(dm);
  await dm.getByRole("button", { name: "Activate for players", exact: true }).click();
  await openMapSettings(player);
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
  await closeMapSettings(player);
  await openMoreMapTools(dm);
  await dm.getByRole("button", { name: "Fog rectangle", exact: true }).click();
  await dm.getByRole("button", { name: "Close tool options", exact: true }).click();
  const dmView = dm.getByRole("region", { name: "Interactive campaign map", exact: true });
  await dmView.scrollIntoViewIfNeeded();
  const rect = await dm.locator(".map-layer").boundingBox();
  await dm.mouse.move(rect.x + rect.width * 0.05, rect.y + rect.height * 0.12);
  await dm.mouse.down();
  await dm.mouse.move(rect.x + rect.width * 0.85, rect.y + rect.height * 0.7, { steps: 5 });
  await dm.mouse.up();
  await expect.poll(() => alpha(0.2, 0.2)).toBe(255);
  await expect.poll(() => alpha(0.95, 0.95)).toBe(0);
  await expect(ownToken).toBeVisible();
  await expect(player.locator(".campaign-maps")).not.toContainText("Hidden guard");
  await openMoreMapTools(dm);
  await dm.getByRole("button", { name: "Undo fog", exact: true }).click();
  await expect.poll(() => alpha(0.2, 0.2)).toBe(0);
  await dm.getByRole("button", { name: "Redo fog", exact: true }).click();
  await expect.poll(() => alpha(0.2, 0.2)).toBe(255);
  await openMapSettings(dm);
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
  await dm
    .locator(".map-session-bar")
    .getByRole("button", { name: "Player display", exact: true })
    .click();
  const displayControls = dm.getByRole("dialog", { name: "Player display", exact: true }),
    displayPopup = dm.waitForEvent("popup");
  await displayControls.getByRole("button", { name: "Open player window", exact: true }).click();
  const display = await displayPopup;
  await displayControls.getByRole("button", { name: "Show display", exact: true }).click();
  const displayMap = display.getByRole("img", { name: "Keep map", exact: true });
  await expect
    .poll(() => displayMap.evaluate((img) => (img.complete ? img.naturalWidth : 0)))
    .toBeGreaterThan(1);
  await expect
    .poll(() =>
      displayMap.evaluate(async (img) => {
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(
          Math.floor(canvas.width * 0.2),
          Math.floor(canvas.height * 0.2),
          1,
          1,
        ).data[3];
      }),
    )
    .toBe(255);
  assert.equal(
    await displayMap.evaluate(async (img) => {
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(
        Math.floor(canvas.width * 0.95),
        Math.floor(canvas.height * 0.95),
        1,
        1,
      ).data[3];
    }),
    0,
    "Optional display also receives baked visible pixels only",
  );
  await display.close();
  await displayControls.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(
    await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  // Import a real embedded raster and reviewed geometry through the production file control.
  await closeMapSettings(dm);
  await dm.getByRole("button", { name: "Pan", exact: true }).click();
  await openMapSettings(dm);
  await dm.getByRole("button", { name: "Import map", exact: true }).click();
  const editor = dm.getByRole("dialog", { name: "Map editor", exact: true });
  await editor.getByLabel("Map name", { exact: true }).fill("Imported media audit");
  const image = await dm.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 320;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#a52a2a";
    ctx.fillRect(0, 0, 320, 320);
    ctx.fillStyle = "#234b9a";
    ctx.fillRect(320, 0, 320, 320);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const uvtt = {
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 8, y: 4 }, pixels_per_grid: 80 },
    image,
    line_of_sight: [
      [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
      ],
    ],
    portals: [
      {
        bounds: [
          { x: 4, y: 0 },
          { x: 4, y: 4 },
        ],
        closed: true,
      },
    ],
    lights: [{ position: { x: 2, y: 2 }, range: 3, color: "ffaabbcc", intensity: 0.5 }],
  };
  await editor.getByLabel("Map artwork or video", { exact: true }).setInputFiles({
    name: "audit.dd2vtt",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(uvtt)),
  });
  await expect(editor.getByRole("region", { name: "Map import review" })).toContainText(
    "2 walls / doors",
  );
  await expect(
    editor.getByRole("checkbox", { name: "Share this map image with players", exact: true }),
  ).not.toBeChecked();
  await editor.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const imported = async () =>
    (await journal(dm)).world.maps.find((map) => map.name === "Imported media audit");
  await expect.poll(async () => !!(await imported())?.tabletop.media).toBe(true);
  const importedMap = await imported();
  assert.equal(importedMap.tabletop.media.width, 640);
  assert.equal(importedMap.grid.columns, 8);
  assert.equal(importedMap.visible, false);
  assert.equal(importedMap.tabletop.fog.enabled, true);
  await expect(player.locator(".campaign-maps")).not.toContainText("Imported media audit");
  await selectMapType(dm, "battle");
  await expect(
    dm.getByRole("img", { name: "Imported media audit", exact: true }).first(),
  ).toBeVisible();
  await expect
    .poll(() => dm.locator(".map-media-detail").evaluate((img) => img.naturalWidth))
    .toBe(640);
  await dm.screenshot({ path: `${output}/online-tabletop-import-${width}.png`, fullPage: true });
  const videoBase64 = await dm.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 160;
    const ctx = canvas.getContext("2d"),
      stream = canvas.captureStream(5),
      recorder = new MediaRecorder(stream, { mimeType: "video/webm" }),
      parts = [];
    recorder.ondataavailable = (event) => parts.push(event.data);
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    ctx.fillStyle = "#234b9a";
    ctx.fillRect(0, 0, 320, 160);
    recorder.start();
    // Capture actual animation frames; this bounded delay is the synthetic video's duration.
    await new Promise((resolve) => setTimeout(resolve, 300));
    ctx.fillStyle = "#a52a2a";
    ctx.fillRect(100, 0, 100, 160);
    await new Promise((resolve) => setTimeout(resolve, 300));
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.readAsDataURL(new Blob(parts, { type: "video/webm" }));
    });
  });
  await openMapSettings(dm);
  await dm.getByRole("button", { name: "Import map", exact: true }).click();
  await editor.getByLabel("Map name", { exact: true }).fill("Animated media audit");
  await editor.getByLabel("Map artwork or video", { exact: true }).setInputFiles({
    name: "animation.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(videoBase64, "base64"),
  });
  await expect(
    editor.getByText("Map image ready. Review the details, then save the map.", { exact: true }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Save map", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await selectMapType(dm, "");
  const animated = (await journal(dm)).world.maps.find(
    (map) => map.name === "Animated media audit",
  );
  await selectWorkspaceMap(dm, animated.id);
  await expect(dm.getByRole("button", { name: "Play map animation", exact: true })).toBeVisible();
  await expect(dm.locator("video.map-media-detail")).toHaveCount(0);
  await dm.getByRole("button", { name: "Play map animation", exact: true }).click();
  await expect(dm.locator("video.map-media-detail")).toBeVisible();
  await dm.emulateMedia({ reducedMotion: "reduce" });
  await expect(dm.locator("video.map-media-detail")).toHaveCount(0);
  await expect(dm.getByRole("img", { name: "Animated media audit", exact: true })).toBeVisible();
  await dm.emulateMedia({ reducedMotion: "no-preference" });
}
