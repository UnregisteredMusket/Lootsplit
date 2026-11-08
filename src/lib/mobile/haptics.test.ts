import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { hapticTick } from "./haptics.ts";

const original = { window: globalThis.window, navigator: globalThis.navigator };

function stub(reduced: boolean, vibrate?: (ms: number) => boolean) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: reduced }) },
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { vibrate } });
}

afterEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: original.window });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: original.navigator });
});

test("the website ticks with a 10 ms web vibration", () => {
  const calls: number[] = [];
  stub(false, (ms) => (calls.push(ms), true));
  hapticTick();
  assert.deepEqual(calls, [10]);
});

test("reduced motion gives no tick", () => {
  const calls: number[] = [];
  stub(true, (ms) => (calls.push(ms), true));
  hapticTick();
  assert.deepEqual(calls, []);
});

test("a device without vibration, or one that throws, is left alone", () => {
  stub(false, undefined);
  assert.doesNotThrow(() => hapticTick());
  stub(false, () => {
    throw new Error("blocked");
  });
  assert.doesNotThrow(() => hapticTick());
});

test("no window (server rendering) does nothing", () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
  assert.doesNotThrow(() => hapticTick());
});
