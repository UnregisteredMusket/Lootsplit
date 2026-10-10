import test from "node:test";
import assert from "node:assert/strict";
import { groupMapRecords, mapPingInput } from "./map-signals.ts";
test("record filters group each type independently at inherited anchors and count multiple NPCs", () => {
  const point = { x: 0.3, y: 0.5 },
    records = [
      { id: "one", label: "First NPC", kind: "NPC", point },
      { id: "two", label: "Second NPC", kind: "NPC", point },
      { id: "shop", label: "Shop", kind: "Shop", point },
      { id: "unplaced", label: "Unplaced", kind: "NPC" },
    ];
  const groups = groupMapRecords(records, ["NPC", "Shop"]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].kinds.map((k) => [k.kind, k.records.length]),
    [
      ["NPC", 2],
      ["Shop", 1],
    ],
  );
  assert.deepEqual(
    groupMapRecords(records, ["Shop"])[0].kinds.map((k) => k.kind),
    ["Shop"],
  );
  assert.deepEqual(groupMapRecords(records, []), []);
});
test("ping inputs accept normalized finite points and five colors only", () => {
  const ping = { id: crypto.randomUUID(), mapId: "map", x: 0, y: 1, color: "violet" };
  assert.ok(mapPingInput.safeParse(ping).success);
  for (const change of [
    { x: NaN },
    { x: Infinity },
    { y: -0.1 },
    { color: "#fff" },
    { expiresAt: Infinity },
    { mapId: "" },
  ])
    assert.ok(!mapPingInput.safeParse({ ...ping, ...change }).success);
});
