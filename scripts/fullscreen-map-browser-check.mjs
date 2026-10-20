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
      renderedWidth: image.width,
    };
  });
}
export async function expectMapFillsScreen(page, overlayOpen = false) {
  await expect
    .poll(async () =>
      page.locator(".map-view-frame .map-viewport").evaluate((el, overlayOpen) => {
        const r = el.getBoundingClientRect(),
          frame = el.closest(".map-workspace");
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

/** Retained viewport/camera/panel preservation checks for the default Maps workspace. */
export async function checkFullscreenMap(page, output, width) {
  const viewport = page.viewportSize(),
    region = page.getByRole("region", { name: "Interactive campaign map" }),
    frame = page.locator(".map-view-frame");
  const close = page.getByRole("button", { name: "Close settings", exact: true });
  if (await close.isVisible()) await close.click();
  await expectMapFillsScreen(page);
  await expect(
    page.getByRole("button", { name: /^(Fullscreen map|Enter fullscreen|Exit fullscreen)$/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "Map tools", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await region.focus();
  await region.press("Alt+ArrowRight");
  const before = await mapCamera(page);
  const sameCamera = async () => {
    const after = await mapCamera(page);
    return (
      Math.abs(after.x - before.x) < 0.001 &&
      Math.abs(after.y - before.y) < 0.001 &&
      Math.abs(after.renderedWidth - before.renderedWidth) < 1
    );
  };
  await page.getByRole("button", { name: "Map settings", exact: true }).click();
  const drawer = page.locator("#map-settings");
  await expect(drawer).toBeVisible();
  const categoryPicker = page.getByLabel("Map type filter", { exact: true });
  await categoryPicker.click();
  await expect(page.locator(".record-select-menu:visible")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(categoryPicker).toHaveAttribute("aria-expanded", "false");
  await expect(drawer).toBeVisible();
  await expectMapFillsScreen(page, true);
  await expect.poll(sameCamera).toBe(true);
  if (width < 600) {
    // Mobile keyboards shrink the visual viewport without resizing the map canvas.
    await page.evaluate(() => {
      window.mapVisualHeightDescriptor = Object.getOwnPropertyDescriptor(visualViewport, "height");
      Object.defineProperty(visualViewport, "height", { configurable: true, value: 320 });
      visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect
      .poll(() => drawer.evaluate((el) => el.getBoundingClientRect().bottom <= 320))
      .toBe(true);
    await expectMapFillsScreen(page, true);
    await expect.poll(sameCamera).toBe(true);
    await page.evaluate(() => {
      if (window.mapVisualHeightDescriptor)
        Object.defineProperty(visualViewport, "height", window.mapVisualHeightDescriptor);
      else delete visualViewport.height;
      visualViewport.dispatchEvent(new Event("resize"));
    });
  }
  await drawer.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  assert.equal(await frame.evaluate((el) => el.scrollTop), 0, "Only Settings scrolls");
  await drawer.evaluate((el) => {
    el.scrollTop = 0;
  });
  await close.click();
  await expect(region).toBeFocused();
  await page.screenshot({ path: `${output}/maps-canvas-${width}.png` });
  // The layout never depends on native fullscreen permission or its change events.
  await page.evaluate(() => {
    window.fullscreenDescriptor = Object.getOwnPropertyDescriptor(
      document.documentElement,
      "requestFullscreen",
    );
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: () => Promise.reject(Error("Fullscreen unavailable in embedded browser")),
    });
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  await expectMapFillsScreen(page);
  await expect.poll(sameCamera).toBe(true);
  if (width < 600) {
    for (const next of [{ width: 844, height: 390 }, { width: 320, height: 700 }, viewport]) {
      await page.setViewportSize(next);
      await expectMapFillsScreen(page);
      await expect.poll(sameCamera).toBe(true);
      await expect(
        page.getByRole("button", { name: "Map navigation menu", exact: true }),
      ).toBeInViewport();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `${output}/maps-${next.width}-${next.height}.png` });
    }
  }
  await page.getByRole("button", { name: "Map settings", exact: true }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(region).toBeFocused();
  await expect.poll(sameCamera).toBe(true);
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
}
