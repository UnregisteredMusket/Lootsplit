// Help guide switch (W-3): `?guide=` picks a guide, and an old `#topic` link that only one guide
// holds opens that guide. The player guide never gains DM setup links by itself.
import assert from "node:assert/strict";
import test from "node:test";
import { guideForHash, guideFromSearch } from "./guide-choice.ts";

const sources = {
  player: [{ id: "start", topics: [{ id: "multiple-windows" }, { id: "references" }] }],
  dm: [{ id: "start", topics: [{ id: "first-campaign" }, { id: "references" }] }],
};

test("?guide= accepts only player or dm", () => {
  assert.equal(guideFromSearch({ guide: "dm" }), "dm");
  assert.equal(guideFromSearch({ guide: "player" }), "player");
  assert.equal(guideFromSearch({ guide: "DM" }), null);
  assert.equal(guideFromSearch({}), null);
  assert.equal(guideFromSearch(undefined), null);
});

test("a topic held by one guide picks it; shared or unknown topics do not", () => {
  assert.equal(guideForHash("multiple-windows", sources), "player");
  assert.equal(guideForHash("#first-campaign", sources), "dm");
  assert.equal(guideForHash("references", sources), null);
  assert.equal(guideForHash("start", sources), null);
  assert.equal(guideForHash("nowhere", sources), null);
  assert.equal(guideForHash("", sources), null);
});
