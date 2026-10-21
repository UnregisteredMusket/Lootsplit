import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
// Load the command engine first, as the other estate tests do: it fixes the module cycle order.
import "./commands.ts";
import { estateImportFingerprint } from "./estate-import.ts";
import { storageWeight } from "./estate.ts";

const holding = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, quantity: 1, ...extra }) as never;

test("property import fingerprint ignores holding and listing display order", () => {
  // The property screen sorts holdings by name; storage keeps ID order. A name order that
  // differs from ID order must not make every reviewed import look stale.
  const byId = {
    purses: [],
    holdings: [holding("a", "Zebra-hide cloak"), holding("b", "Amber idol")],
    listings: [{ id: "l1", name: "Wharf" }, { id: "l2", name: "Abbey" }] as never,
    journal: undefined,
  };
  const byName = {
    ...byId,
    holdings: [...byId.holdings].reverse(),
    listings: [...(byId.listings as unknown[])].reverse() as never,
  };
  assert.equal(estateImportFingerprint(byName), estateImportFingerprint(byId));
  // A real change still changes the fingerprint.
  const changed = { ...byId, holdings: [holding("a", "Zebra-hide cloak"), holding("b", "Amber idol", { quantity: 2 })] };
  assert.notEqual(estateImportFingerprint(changed), estateImportFingerprint(byId));
});

test("stored weight has no floating-point noise", () => {
  const t = {
    holdings: [
      holding("arrows", "Arrows", { quantity: 6, weight: 0.05, custody: { kind: "property", propertyId: "ship" } }),
    ],
  };
  assert.equal(storageWeight(t, "ship").weight, 0.3);
});
