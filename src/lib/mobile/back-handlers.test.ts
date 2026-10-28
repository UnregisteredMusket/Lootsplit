import assert from "node:assert/strict";
import test from "node:test";
import {
  closeTopOverlay,
  EXIT_WINDOW_MS,
  isOverlayElement,
  registerBackHandler,
  registerBackOverlay,
  rootBack,
  runBackHandlers,
} from "./back-handlers.ts";
import { statusBarStyle } from "./status-bar.ts";

/** A stub element: contains itself and the listed children. */
const node = (...children: object[]) => {
  const self = {
    contains: (other: unknown) => other === self || children.includes(other as object),
  };
  return self;
};

test("Back closes the newest overlay first, then the older one, and unregisters on close", () => {
  const calls: string[] = [];
  const offOld = registerBackOverlay({ close: () => calls.push("sheet") });
  const offNew = registerBackOverlay({ close: () => calls.push("picker") });
  assert.equal(closeTopOverlay(null), true);
  offNew();
  assert.equal(closeTopOverlay(null), true);
  offOld();
  assert.equal(closeTopOverlay(null), false);
  assert.deepEqual(calls, ["picker", "sheet"]);
});

test("A dialog opened over an overlay closes first; a picker inside the dialog closes before it", () => {
  const calls: string[] = [];
  const picker = node();
  const dialog = node(picker);
  const offPicker = registerBackOverlay({ close: () => calls.push("picker"), element: () => picker });
  // The picker lives inside the top dialog: Back closes the picker, not the dialog.
  assert.equal(closeTopOverlay(dialog), true);
  offPicker();
  const sheet = node();
  const offSheet = registerBackOverlay({ close: () => calls.push("sheet"), element: () => sheet });
  // A dialog that does not contain the sheet sits above it: the overlay step passes.
  assert.equal(closeTopOverlay(dialog), false);
  // An overlay without an element cannot prove it is above a dialog either.
  const offBare = registerBackOverlay({ close: () => calls.push("bare") });
  assert.equal(closeTopOverlay(dialog), false);
  offBare();
  offSheet();
  assert.deepEqual(calls, ["picker"]);
});

test("Registered overlay elements are not mistaken for dialogs of their own", () => {
  const inner = {};
  const picker = node(inner);
  const off = registerBackOverlay({ close: () => undefined, element: () => picker });
  assert.equal(isOverlayElement(picker), true);
  assert.equal(isOverlayElement(inner), true);
  assert.equal(isOverlayElement({}), false);
  off();
  assert.equal(isOverlayElement(picker), false);
});

test("Overlays and screen handlers are separate tiers: an overlay never runs as a screen handler", () => {
  const calls: string[] = [];
  const offScreen = registerBackHandler(() => (calls.push("map"), true));
  const offOverlay = registerBackOverlay({ close: () => calls.push("picker") });
  // The shell asks overlays before screen handlers.
  assert.equal(closeTopOverlay(null) || runBackHandlers(), true);
  offOverlay();
  assert.equal(closeTopOverlay(null) || runBackHandlers(), true);
  offScreen();
  assert.equal(closeTopOverlay(null) || runBackHandlers(), false);
  assert.deepEqual(calls, ["picker", "map"]);
});

test("At the root, Back warns first and exits on a second press within 2 s while a campaign is open", () => {
  const open = (lastPress: number | null) => ({ campaignOpen: true, lastPress });
  assert.equal(rootBack(open(null), 10_000), "warn");
  assert.equal(rootBack(open(10_000), 10_000 + EXIT_WINDOW_MS - 1), "exit");
  assert.equal(rootBack(open(10_000), 10_000 + EXIT_WINDOW_MS), "exit");
  assert.equal(rootBack(open(10_000), 10_000 + EXIT_WINDOW_MS + 1), "warn");
  // No campaign open: exit at once, as before.
  assert.equal(rootBack({ campaignOpen: false, lastPress: null }, 10_000), "exit");
});

test("Status-bar icons are dark on light themes and light on dark themes", () => {
  assert.equal(statusBarStyle("light"), "LIGHT");
  assert.equal(statusBarStyle("dark"), "DARK");
});
