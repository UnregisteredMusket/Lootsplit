import assert from "node:assert/strict";
import test from "node:test";
import {
  announcedLoadingStep,
  formatLoadingPercent,
  loadingPercent,
  roomLoadingComplete,
} from "./room-loading.ts";

test("the loading percentage rounds down from real bytes", () => {
  assert.equal(loadingPercent(0, 2_500_000, false), 0);
  assert.equal(loadingPercent(1_049_999, 2_500_000, false), 41);
  assert.equal(loadingPercent(1_050_000, 2_500_000, false), 42);
  assert.equal(loadingPercent(1, 3, false), 33);
  assert.equal(loadingPercent(2, 3, false), 66);
});

test("the loading percentage stays within 0–100 and shows 100 only when complete", () => {
  assert.equal(loadingPercent(2_500_000, 2_500_000, false), 99);
  assert.equal(loadingPercent(2_499_999, 2_500_000, false), 99);
  assert.equal(loadingPercent(9_000_000, 2_500_000, false), 99);
  assert.equal(loadingPercent(-5, 2_500_000, false), 0);
  assert.equal(loadingPercent(100, 0, false), 0);
  assert.equal(loadingPercent(Number.NaN, 100, false), 0);
  assert.equal(loadingPercent(2_500_000, 2_500_000, true), 100);
  assert.equal(loadingPercent(0, 0, true), 100);
});

test("complete means every byte and every part arrived", () => {
  const base = { code: "ABCD", startedAt: 1, totalBytes: 10, totalSections: 2 };
  assert.equal(roomLoadingComplete({ ...base, loadedBytes: 10, loadedSections: 1 }), false);
  assert.equal(roomLoadingComplete({ ...base, loadedBytes: 9, loadedSections: 2 }), false);
  assert.equal(roomLoadingComplete({ ...base, loadedBytes: 10, loadedSections: 2 }), true);
});

test("the owner's _%/_% format and the 10 % announcement steps", () => {
  assert.equal(formatLoadingPercent(42), "42%/100%");
  assert.equal(formatLoadingPercent(0), "0%/100%");
  assert.equal(formatLoadingPercent(100), "100%/100%");
  assert.deepEqual([0, 9, 10, 42, 99, 100].map(announcedLoadingStep), [0, 0, 10, 40, 90, 100]);
});
