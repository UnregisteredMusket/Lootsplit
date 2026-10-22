import test from "node:test";
import assert from "node:assert/strict";
import { pendingByCampaign } from "./migration-readiness.ts";

function storage(entries: Record<string, string>): Storage {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
  };
}

const campaigns = [
  { id: "main", name: "Party overview" },
  { id: "c2", name: "Second" },
  { id: "c3", name: "Third" },
  { id: "c4", name: "Broken" },
];

test("counts pending work for every campaign on the device, not just the open one", () => {
  const result = pendingByCampaign(
    storage({
      "quire.cloud.v2.main": JSON.stringify({ token: "t", code: "A", pending: [] }),
      "quire.cloud.v2.c2": JSON.stringify({
        token: "t",
        code: "B",
        pending: [{ id: 1 }, { id: 2 }],
      }),
      "quire.cloud.v2.c4": "{not json",
    }),
    campaigns,
  );
  assert.deepEqual(
    result.map(({ id, pending, shared }) => [id, pending, shared]),
    [
      ["main", 0, true],
      ["c2", 2, true],
      ["c3", 0, false],
      ["c4", -1, true],
    ],
  );
});

test("missing storage reports local campaigns, never throws", () => {
  assert.deepEqual(
    pendingByCampaign(undefined, campaigns).map((c) => c.shared),
    [false, false, false, false],
  );
  const throwing = {
    getItem: () => {
      throw Error("blocked");
    },
  } as unknown as Storage;
  assert.equal(pendingByCampaign(throwing, campaigns)[0].pending, -1);
});
