import assert from "node:assert/strict";
import { expect } from "playwright/test";

// Included in the existing dev/immutable-Worker sound gate, with real media playback.
export async function checkLocalAudio(page, context, width) {
  const origin = new URL(page.url()).origin;
  await page
    .locator('nav[aria-label="Sections"]:visible')
    .getByRole("link", { name: "Desk", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Campaign control", exact: true })).toBeVisible();
  await page.evaluate(() => {
    if (!window.__loops) {
      window.__loops = new Set();
      const start = AudioBufferSourceNode.prototype.start,
        stop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.start = function (...args) {
        if (this.loop) window.__loops.add(this);
        return start.apply(this, args);
      };
      AudioBufferSourceNode.prototype.stop = function (...args) {
        window.__loops.delete(this);
        return stop.apply(this, args);
      };
    }
  });
  const management = page.getByRole("dialog", { name: "Settings & Management", exact: true });
  if (!(await management.isVisible())) await page.locator(".settings-trigger").click();
  const appearance = management.getByRole("button", {
    name: "Appearance & notifications",
    exact: true,
  });
  if ((await appearance.getAttribute("aria-expanded")) !== "true") await appearance.click();
  const menus = management.getByRole("group", { name: "Menu music and ambience", exact: true });
  await menus.getByLabel("Enable menu music").check();
  await menus.getByLabel("Ambient sound volume", { exact: true }).fill("12");
  await menus.getByLabel("Enable ambient sound").check();
  await page.keyboard.press("Escape");
  await page
    .locator(".dm-tool-groups")
    .getByRole("link", { name: "Music & Ambience →", exact: true })
    .click();
  const panel = page.locator(".local-audio-panel"),
    player = page.getByRole("region", { name: "Playlist player", exact: true });
  await expect(page.getByRole("heading", { name: "Music & Ambience", exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Exploration 2 tracks", exact: true }),
  ).toBeVisible();
  assert.equal(await page.locator(".loot-opening").count(), 0);
  await page.evaluate(() => {
    const play = HTMLMediaElement.prototype.play;
    window.__localPlayCalls = 0;
    HTMLMediaElement.prototype.play = function (...args) {
      window.__localMedia = this;
      window.__localPlayCalls++;
      return play.apply(this, args);
    };
  });
  await player
    .getByLabel("Ambience while playlist is active", { exact: true })
    .selectOption("fire");
  await expect(panel.getByRole("status")).toHaveText("Saved on this device.");
  await player.getByRole("button", { name: "Play playlist", exact: true }).click();
  await expect(player.getByText("NOW PLAYING · playing", { exact: true })).toBeVisible();
  await page.waitForFunction(() => window.__loops.size === 1);
  await page
    .locator('nav[aria-label="Sections"]:visible')
    .getByRole("link", { name: "Market", exact: true })
    .click();
  await page.waitForFunction(() => window.__loops.size === 1);
  await page
    .getByRole("complementary", { name: "Active local playlist" })
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await page.waitForFunction(() => window.__loops.size === 2);
  await page
    .locator('nav[aria-label="Sections"]:visible')
    .getByRole("link", { name: "Desk", exact: true })
    .click();
  await page
    .locator(".dm-tool-groups")
    .getByRole("link", { name: "Music & Ambience →", exact: true })
    .click();
  await player.getByRole("button", { name: "Play playlist", exact: true }).click();
  await expect(player.getByText("NOW PLAYING · playing", { exact: true })).toBeVisible();
  await page.waitForFunction(
    () => window.__localMedia && !window.__localMedia.paused && window.__localMedia.currentTime > 0,
  );
  await player.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(player.getByText("NOW PLAYING · paused", { exact: true })).toBeVisible();
  const pausedTime = await page.evaluate(() => window.__localMedia.currentTime);
  await player.getByRole("button", { name: "Play playlist", exact: true }).click();
  await page.waitForFunction(
    (time) => window.__localMedia.currentTime > time && !window.__localMedia.paused,
    pausedTime,
  );
  await player.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    player.getByRole("heading", { name: "Soft Strings and Flutes", exact: true }),
  ).toBeVisible();
  await expect(player.getByText("NOW PLAYING · playing", { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => window.__localPlayCalls);
  await player.getByLabel("Playlist music volume", { exact: true }).fill("23");
  await expect(panel.getByRole("status")).toHaveText("Saved on this device.");
  await page.waitForFunction(() => Math.abs(window.__localMedia.volume - 0.23) < 0.001);
  assert.equal(
    await page.evaluate(() => window.__localPlayCalls),
    calls,
    "Volume does not restart custom audio",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(player.getByText("NOW PLAYING · paused", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.__localMedia.paused), true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(player.getByText("NOW PLAYING · paused", { exact: true })).toBeVisible();
  await player.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Active local playlist" })).toHaveCount(0);

  await panel.getByLabel("New playlist name", { exact: true }).fill("Road music");
  await panel.getByRole("button", { name: "Create playlist", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Road music 0 tracks", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // A valid 15-second PCM WAV ensures imported Blob media really decodes and advances.
  const samples = 8000 * 15,
    wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 220) / 8000) * 1000), 44 + i * 2);
  const writes = [];
  const capture = (request) => {
    if (request.method() !== "GET" && request.method() !== "HEAD")
      writes.push({ url: request.url(), body: request.postData() });
  };
  page.on("request", capture);
  await panel
    .locator('input[type="file"]')
    .setInputFiles({ name: "Road Theme.wav", mimeType: "audio/wav", buffer: wav });
  await panel.getByLabel("Creator", { exact: true }).fill("Local audit composer");
  await panel
    .getByLabel("Source link (optional)", { exact: true })
    .fill("https://example.com/road-theme");
  await panel.getByLabel("License", { exact: true }).selectOption("Original work");
  await panel
    .getByLabel("Attribution / permission notes", { exact: true })
    .fill("Composed for this disposable test.");
  await panel.getByLabel("I have permission to use this file.", { exact: true }).check();
  await panel.getByRole("button", { name: "Add audio to Road music", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Audio added to your device library.");
  assert.equal(
    writes.some((x) => x.body?.includes("Local audit composer") || x.body?.includes("Road Theme")),
    false,
    "Audio import is never uploaded",
  );
  page.off("request", capture);
  await context.setOffline(true);
  await player.locator(".local-audio-track").filter({ hasText: "Road Theme" }).click();
  await expect(player.getByText("NOW PLAYING · playing", { exact: true })).toBeVisible();
  await page.waitForFunction(
    () =>
      window.__localMedia.src.startsWith("blob:") &&
      !window.__localMedia.paused &&
      window.__localMedia.currentTime > 0,
  );
  await player.getByRole("button", { name: "Stop", exact: true }).click();
  await context.setOffline(false);
  await player.getByLabel("Add a library track", { exact: true }).selectOption("town");
  await expect(player.locator(".local-audio-tracks li")).toHaveCount(2);
  await player.getByRole("button", { name: "Move Town Theme RPG up", exact: true }).click();
  await expect(player.locator(".local-audio-tracks li").first()).toContainText("Town Theme RPG");
  await player
    .getByRole("button", { name: "Remove Town Theme RPG from playlist", exact: true })
    .click();
  await expect(player.locator(".local-audio-tracks li")).toHaveCount(1);
  await panel.getByLabel("Loop playlist", { exact: true }).click();
  await expect(panel.getByLabel("Loop playlist", { exact: true })).not.toBeChecked();
  await expect(panel.getByRole("status")).toHaveText("Saved on this device.");
  await panel.getByLabel("Shuffle", { exact: true }).click();
  await expect(panel.getByLabel("Shuffle", { exact: true })).toBeChecked();
  await expect(panel.getByRole("status")).toHaveText("Saved on this device.");
  await panel.getByLabel("Dungeon / encounters", { exact: true }).selectOption("combat");
  await expect(panel.getByRole("status")).toHaveText("Saved on this device.");
  await panel.getByLabel("Follow assigned scene playlists", { exact: true }).click();
  await expect(panel.getByLabel("Follow assigned scene playlists", { exact: true })).toBeChecked();
  await expect(panel.getByRole("status")).toHaveText("Saved on this device.");
  await player.getByRole("button", { name: "Play playlist", exact: true }).click();
  await expect(player.getByText("NOW PLAYING · playing", { exact: true })).toBeVisible();
  await page
    .locator('nav[aria-label="Sections"]:visible')
    .getByRole("link", { name: "Encounters", exact: true })
    .click();
  await expect(page.getByRole("complementary", { name: "Active local playlist" })).toContainText(
    "Dark and Mysterious",
  );
  assert.equal(await page.locator(".loot-opening").count(), 0);
  await page
    .getByRole("complementary", { name: "Active local playlist" })
    .getByRole("link")
    .click();
  await player.getByRole("button", { name: "Stop", exact: true }).click();
  await page.screenshot({
    path: `test-results/sound/local-playlists-${width}.png`,
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true }).waitFor();
  assert.equal(
    await page.locator(".local-audio-mini").count(),
    0,
    "A fresh document does not autoplay local playlists",
  );
  await page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true }).click();
  await panel.getByRole("button", { name: "Road music 1 tracks", exact: true }).click();
  await expect(player.locator(".local-audio-tracks li")).toContainText("Road Theme");
  await expect(player.getByLabel("Playlist music volume", { exact: true })).toHaveValue("23");
  await expect(panel.getByLabel("Shuffle", { exact: true })).toBeChecked();
  const imported = panel.getByRole("region", { name: "Imported audio files", exact: true });
  await imported.locator("summary").click();
  await expect(imported).toContainText("Local audit composer");
  await expect(imported).toContainText("Composed for this disposable test.");
  await imported.getByRole("button", { name: "Delete local file", exact: true }).click();
  await imported.getByRole("button", { name: "Confirm delete file", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Road music 0 tracks", exact: true }),
  ).toBeVisible();
  await expect(player.locator(".local-audio-tracks li")).toHaveCount(0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // 320px also checks the file picker, long credits and transport width without changing coverage.
  if (width === 390) {
    await page.setViewportSize({ width: 320, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: "test-results/sound/local-playlists-320.png", fullPage: true });
  }
  assert.equal(new URL(page.url()).origin, origin);
  if (width === 390) {
    const anonymous = await context.browser().newContext();
    try {
      const guest = await anonymous.newPage();
      await guest.goto(origin + "/features/music");
      const title = guest.getByRole("button", {
        name: "Lootsplit. Click to continue",
        exact: true,
      });
      await title.waitFor({ state: "visible" });
      await title.click();
      await expect(
        guest.getByText(
          "Create an account or sign in to proceed as a Dungeon Master in your own campaign",
        ),
      ).toBeVisible();
      assert.equal(await guest.locator(".local-audio-panel").count(), 0);
      assert.equal(
        await guest.evaluate(async () =>
          (await indexedDB.databases()).some((x) => x.name === "lootsplit.local-audio.v1"),
        ),
        false,
      );
      await guest.goto(origin + "/resources");
      await expect(
        guest.getByRole("heading", { name: /Resources/, exact: false }).first(),
      ).toBeVisible();
      assert.equal(
        await guest.evaluate(async () =>
          (await indexedDB.databases()).some((x) => x.name === "lootsplit.local-audio.v1"),
        ),
        false,
        "Anonymous public pages never open DM audio storage",
      );
    } finally {
      await anonymous.close();
    }
  }
}
