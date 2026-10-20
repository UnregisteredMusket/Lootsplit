import test from "node:test";
import assert from "node:assert/strict";
import {
  accessibleMapId,
  mapViewKey,
  readMapView,
  saveMapView,
  mapViewStorage,
} from "./map-view-state.ts";
const scope = {
  accountId: "a",
  campaignId: "campaign",
  databaseName: "db",
  code: "room",
  seatId: "seat",
  sessionId: "session",
  ephemeral: false,
};
const store = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
};
test("camera restoration isolates account, campaign, room, role and guest session", () => {
  const storage = store(),
    key = mapViewKey(scope, "dm", []);
  saveMapView(key, "town", { x: 0.23, y: 0.74, zoom: 2.3 }, storage);
  saveMapView(key, "battle", { x: 0.5, y: 0.6, zoom: 3 }, storage);
  assert.deepEqual(readMapView(key, storage), {
    lastMapId: "battle",
    cameras: { town: { x: 0.23, y: 0.74, zoom: 2.3 }, battle: { x: 0.5, y: 0.6, zoom: 3 } },
  });
  for (const changed of [
    { accountId: "b" },
    { campaignId: "other" },
    { databaseName: "other" },
    { code: "other" },
  ])
    assert.deepEqual(readMapView(mapViewKey({ ...scope, ...changed }, "dm", []), storage), {
      cameras: {},
    });
  assert.notEqual(key, mapViewKey(scope, "player", ["hero"]));
  assert.equal(mapViewKey(scope, "player", ["b", "a"]), mapViewKey(scope, "player", ["a", "b"]));
  assert.notEqual(
    mapViewKey({ ...scope, ephemeral: true }, "player", []),
    mapViewKey({ ...scope, ephemeral: true, sessionId: "new" }, "player", []),
  );
});
test("deleted/revoked maps cannot be restored; explicit valid navigation precedes remembered view", () => {
  assert.equal(accessibleMapId(["active", "town"], "revoked", "deleted", "active"), "active");
  assert.equal(accessibleMapId(["active", "town"], "town", "active", "active"), "town");
  assert.equal(accessibleMapId([], "deleted", "deleted", "active"), undefined);
});
test("corrupt storage and invalid camera values fail safely, guests use memory only", () => {
  const storage = store();
  storage.setItem("broken", "{");
  assert.deepEqual(readMapView("broken", storage), { cameras: {} });
  storage.setItem(
    "bad",
    JSON.stringify({
      lastMapId: "town",
      cameras: { safe: { x: 0.2, y: 0.3, zoom: 1 }, bad: { x: 5, y: 5, zoom: 500 } },
    }),
  );
  assert.deepEqual(Object.keys(readMapView("bad", storage).cameras), ["safe"]);
  assert.equal(mapViewStorage(true), undefined);
  saveMapView("guest-test", "town", { x: 0.5, y: 0.5, zoom: 1 });
  assert.equal(readMapView("guest-test").lastMapId, "town");
  assert.deepEqual(readMapView("guest-test", storage), { cameras: {} });
  const blocked = {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  };
  saveMapView("blocked-test", "town", { x: 0.5, y: 0.5, zoom: 2 }, blocked);
  assert.equal(readMapView("blocked-test", blocked).cameras.town.zoom, 2);
  const quota = {
    getItem: () => JSON.stringify({ lastMapId: "old", cameras: {} }),
    setItem: blocked.setItem,
  };
  saveMapView("quota-test", "town", { x: 0.5, y: 0.5, zoom: 2, basis: 390 }, quota);
  assert.equal(readMapView("quota-test", quota).lastMapId, "town");
  assert.equal(readMapView("quota-test", quota).cameras.town.basis, 390);
});
