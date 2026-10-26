import assert from "node:assert/strict";
import test from "node:test";
import {
  accessibleParent,
  mapBackStep,
  mapExitHref,
  openingView,
  rememberScreen,
  resetRememberedScreen,
} from "./map-navigation.ts";
import { registerBackHandler, runBackHandlers } from "../mobile/back-handlers.ts";
import type { CampaignMap } from "./world-schema.ts";

const map = (id: string, parentMapId?: string) =>
  ({
    id,
    name: id,
    connected: parentMapId ? { parentMapId, links: [] } : undefined,
  }) as unknown as CampaignMap;

test("Android Back on a map closes the menu, then a panel, then opens the parent, then closes", () => {
  assert.equal(mapBackStep({ menu: true, panel: true, parent: true }), "menu");
  assert.equal(mapBackStep({ menu: false, panel: true, parent: true }), "panel");
  assert.equal(mapBackStep({ menu: false, panel: false, parent: true }), "parent");
  assert.equal(mapBackStep({ menu: false, panel: false, parent: false }), "close");
});

test("Back handlers run newest first, stop at the first that consumes, and unregister", () => {
  const calls: string[] = [];
  const offOld = registerBackHandler(() => (calls.push("old"), true));
  const offNew = registerBackHandler(() => (calls.push("new"), false));
  assert.equal(runBackHandlers(), true);
  assert.deepEqual(calls, ["new", "old"]);
  offOld();
  offNew();
  assert.equal(runBackHandlers(), false);
});

test("Back names only a parent the viewer can open", () => {
  const harbour = map("harbour"),
    cove = map("cove", "harbour");
  assert.equal(accessibleParent([harbour, cove], cove)?.id, "harbour");
  // A hidden parent is filtered out of a player's list: no Back button, nothing named.
  assert.equal(accessibleParent([cove], cove), undefined);
  assert.equal(accessibleParent([harbour], harbour), undefined);
  assert.equal(accessibleParent([map("loop", "loop")], map("loop", "loop")), undefined);
});

test("X returns to the last in-app screen, or Desk/Home on a cold start", () => {
  resetRememberedScreen();
  assert.equal(mapExitHref(), "/?view=home");
  rememberScreen("/party", "/party?tab=items");
  rememberScreen("/maps", "/maps?map=cove");
  assert.equal(mapExitHref(), "/party?tab=items");
  resetRememberedScreen();
});

test("Opening view fits the whole map on desktop", () => {
  // 1280×800 viewport, 4:3 map fitted to 1067×800 (cover would be 120 %).
  const view = openingView({
    size: { w: 1280, h: 800 },
    w: 1066.67,
    h: 800,
    focus: { x: 0.9, y: 0.1 },
  });
  assert.equal(view.scale, 1);
  assert.ok(Math.abs(view.x - (1280 - 1066.67) / 2) < 0.01);
  assert.equal(view.y, 0);
});

test("Opening view on a phone caps zoom at 200 % and centres the party inside the map", () => {
  // 390×844 viewport, 4:3 map fitted to 390×292.5 (cover would be 289 %).
  const size = { w: 390, h: 844 },
    w = 390,
    h = 292.5;
  const centred = openingView({ size, w, h, focus: { x: 0.7, y: 0.5 } });
  assert.equal(centred.scale, 2);
  // Party at 70 % across: centred on screen.
  assert.ok(Math.abs(size.w / 2 - (centred.x + 0.7 * w * 2)) < 0.01);
  // Height still fits at 200 %, so the map is centred vertically.
  assert.ok(Math.abs(centred.y - (844 - 585) / 2) < 0.01);
  // A party at the far edge never pulls empty space past the map's edge.
  const edge = openingView({ size, w, h, focus: { x: 1, y: 0.5 } });
  assert.equal(edge.x, size.w - w * 2);
  // Without a party: centred.
  assert.equal(openingView({ size, w, h }).x, (390 - 780) / 2);
});
