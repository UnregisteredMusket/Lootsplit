import assert from "node:assert/strict";
import { expect } from "playwright/test";

export function mapMarkerColor(marker) {
  return marker.evaluate((el) => {
    const symbol = getComputedStyle(el, "::before");
    return symbol.content !== "none"
      ? symbol.backgroundColor
      : getComputedStyle(el).backgroundColor;
  });
}

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

/** Phone docks must stay at the edges, with every tool reachable above other controls. */
export async function checkMobileMapControls(page) {
  const { width, height } = page.viewportSize();
  if (width > 650) return;
  const boxes = await page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      // Hidden (the DM's phone search is a row-1 icon until opened) or absent (players' setup bar).
      if (!el || !el.getClientRects().length) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
    };
    return {
      title: box(".map-title-capsule"),
      search: box(".map-search"),
      settings: box(".map-top-actions"),
      tools: box(".map-hotbar-anchor:not(.map-setup-anchor)"),
      setup: box(".map-setup-anchor"),
      camera: box(".map-navigation"),
    };
  });
  if (height > 550) {
    assert.ok(boxes.settings.left >= boxes.title.right + 6, "Title leaves room for Settings and X");
    assert.ok(boxes.settings.height <= 50, "Settings and X Close map form one short row");
    // Row 2 is the search field (players) or the DM's setup bar (search is then a row-1 icon).
    const row2 = boxes.search ?? boxes.setup;
    assert.ok(row2 && row2.top >= boxes.title.bottom + 6, "Row 2 (search or setup bar) is clear");
    assert.ok(boxes.camera.height <= 52, "Phone camera controls form one short row");
    assert.ok(boxes.tools.top >= boxes.camera.bottom + 6, "Camera and tool docks do not overlap");
    assert.ok(height - boxes.tools.bottom <= 20, "Tools hug the phone's bottom edge");
  }
  for (const box of Object.values(boxes).filter(Boolean)) {
    assert.ok(
      box.left >= 0 && box.right <= width + 1 && box.top >= 0 && box.bottom <= height + 1,
      "Mobile controls remain within the page in portrait and landscape",
    );
  }
  assert.ok(
    boxes.settings.right <= boxes.camera.left ||
      boxes.settings.left >= boxes.camera.right ||
      boxes.settings.bottom <= boxes.camera.top ||
      boxes.settings.top >= boxes.camera.bottom,
    "Top actions and camera controls do not overlap in narrow landscape",
  );
  const toolbar = page.getByRole("toolbar", { name: "Map tools", exact: true });
  const unobstructed = (button) =>
    button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.width >= 44 && r.height >= 44 && el.contains(hit)
        ? true
        : `${el.getAttribute("aria-label")}: ${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.x)},${Math.round(r.y)}, hit ${hit?.className || hit?.tagName}`;
    });
  for (const button of await toolbar.getByRole("button").all()) {
    await button.scrollIntoViewIfNeeded();
    await expect.poll(() => unobstructed(button)).toBe(true);
  }
  // The DM's setup bar (row 2 on phones, a side rail in landscape) replaces More map tools.
  for (const button of await page
    .getByRole("toolbar", { name: "Map setup", exact: true })
    .getByRole("button")
    .all()) {
    await button.scrollIntoViewIfNeeded();
    await expect.poll(() => unobstructed(button)).toBe(true);
  }
  for (const button of await page.locator(".map-navigation").getByRole("button").all())
    await expect.poll(() => unobstructed(button)).toBe(true);
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
  await checkMobileMapControls(page);
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
    for (const next of [
      { width: 844, height: 390 },
      { width: 568, height: 320 },
      { width: 320, height: 700 },
      { width: 448, height: 824 },
      viewport,
    ]) {
      await page.setViewportSize(next);
      await expectMapFillsScreen(page);
      await expect.poll(sameCamera).toBe(true);
      await expect(
        page.getByRole("button", { name: /map navigation menu$/i }),
      ).toBeInViewport();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await checkMobileMapControls(page);
      await page.screenshot({ path: `${output}/maps-${next.width}-${next.height}.png` });
    }
  }
  await page.getByRole("button", { name: "Map settings", exact: true }).click();
  // Focus inside the grouped settings (their search), then Escape closes them.
  await page.getByRole("searchbox", { name: "Search settings", exact: true }).focus();
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
