import assert from "node:assert/strict";
import { expect } from "playwright/test";

export async function mapCamera(page) {
  return page.locator(".map-view-frame .map-viewport").evaluate((el) => {
    const viewport = el.getBoundingClientRect(),
      image = el.querySelector(".map-layer").getBoundingClientRect();
    return {
      x: (viewport.x + viewport.width / 2 - image.x) / image.width,
      y: (viewport.y + viewport.height / 2 - image.y) / image.height,
      zoom: document.querySelector('[aria-label="Map zoom"]').textContent,
    };
  });
}
export async function expectMapFillsScreen(page, overlayOpen = false) {
  await expect
    .poll(async () =>
      page.locator(".map-view-frame .map-viewport").evaluate((el, overlayOpen) => {
        const r = el.getBoundingClientRect(),
          frame = el.closest("dialog");
        return (
          Math.abs(r.x) <= 1 &&
          Math.abs(r.y) <= 1 &&
          Math.abs(r.width - innerWidth) <= 1 &&
          Math.abs(r.height - innerHeight) <= 1 &&
          frame.scrollHeight <= frame.clientHeight + 1 &&
          frame.scrollWidth <= frame.clientWidth + 1 &&
          (overlayOpen ? frame : el).contains(
            document.elementFromPoint(innerWidth / 2, innerHeight / 2),
          )
        );
      }, overlayOpen),
    )
    .toBe(true);
}

/** Used by both retained world/map audits; every action runs on disposable data. */
export async function checkFullscreenMap(page, output, width) {
  const viewport = page.viewportSize(),
    region = page.getByRole("region", { name: "Interactive campaign map" }),
    frame = page.locator(".map-view-frame");
  await expectMapFillsScreen(page);
  await expect(page.getByRole("button", { name: "Map tools", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await region.focus();
  await region.press("Alt+ArrowRight");
  const before = await mapCamera(page);
  await page.getByRole("button", { name: "Map tools", exact: true }).click();
  const drawer = page.locator("#fullscreen-map-tools");
  await expect(drawer).toBeVisible();
  await expectMapFillsScreen(page, true);
  await expect
    .poll(async () => {
      const after = await mapCamera(page);
      return (
        Math.abs(after.x - before.x) < 0.001 &&
        Math.abs(after.y - before.y) < 0.001 &&
        after.zoom === before.zoom
      );
    })
    .toBe(true);
  await drawer.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  assert.equal(await frame.evaluate((el) => el.scrollTop), 0, "Only the tools drawer scrolls");
  await drawer.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.getByRole("button", { name: "Close tools", exact: true }).click();
  await expect(region).toBeFocused();
  await page.screenshot({ path: `${output}/fullscreen-canvas-${width}.png` });
  // Browser-controlled exit and denied native fullscreen both keep a usable map.
  const native = await page.evaluate(() => Boolean(document.fullscreenElement));
  if (native) await page.evaluate(() => document.exitFullscreen());
  else await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  const enter = page.getByRole("button", { name: "Fullscreen map", exact: true });
  await expect(enter).toBeFocused();
  await expect
    .poll(async () => {
      const after = await mapCamera(page);
      return (
        Math.abs(after.x - before.x) < 0.001 &&
        Math.abs(after.y - before.y) < 0.001 &&
        after.zoom === before.zoom
      );
    })
    .toBe(true);
  await page.evaluate(() => {
    window.fullscreenDescriptor = Object.getOwnPropertyDescriptor(
      document.documentElement,
      "requestFullscreen",
    );
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: () => Promise.reject(new Error("Fullscreen unavailable in embedded browser")),
    });
  });
  await enter.click();
  await expectMapFillsScreen(page);
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false);
  // Chromium cannot resize a native fullscreen window via setWindowBounds.
  // Exercise rotation/resizing in the embedded-browser fallback after testing native exit.
  if (width < 600) {
    await page.setViewportSize({ width: 844, height: 390 });
    await expectMapFillsScreen(page);
    await expect
      .poll(async () => {
        const after = await mapCamera(page);
        return (
          Math.abs(after.x - before.x) < 0.001 &&
          Math.abs(after.y - before.y) < 0.001 &&
          after.zoom === before.zoom
        );
      })
      .toBe(true);
    await page.screenshot({ path: `${output}/fullscreen-landscape.png` });
    await page.setViewportSize({ width: 320, height: 700 });
    await expectMapFillsScreen(page);
    await expect(
      page.getByRole("button", { name: "Exit fullscreen", exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: `${output}/fullscreen-narrow.png` });
    await page.setViewportSize(viewport);
    await expectMapFillsScreen(page);
  }
  await page.screenshot({ path: `${output}/fullscreen-fallback-${width}.png` });
  await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await expect(enter).toBeFocused();
  await page.evaluate(() => {
    if (window.fullscreenDescriptor)
      Object.defineProperty(
        document.documentElement,
        "requestFullscreen",
        window.fullscreenDescriptor,
      );
    else delete document.documentElement.requestFullscreen;
    delete window.fullscreenDescriptor;
  });
  await enter.click();
  await expectMapFillsScreen(page);
}
