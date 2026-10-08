import test from "node:test";
import assert from "node:assert/strict";
import { filterAccountCampaigns } from "../src/lib/account/campaign-library.ts";
const members = [
  { name: "Same campaign", code: "AAA", role: "dm", archived: 0, closed: false },
  {
    name: "Same campaign",
    code: "BBB",
    role: "player",
    archived: 0,
    closed: false,
    viewOnly: true,
  },
  { name: "Older campaign", code: "CCC", role: null, archived: 1, closed: true },
];
const filters = { search: "", role: "all", state: "all", archived: false };
test("campaign filters preserve distinct same-name rooms and legacy active metadata", () => {
  const before = JSON.stringify(members);
  assert.deepEqual(
    filterAccountCampaigns(members, filters).map((m) => m.code),
    ["AAA", "BBB"],
  );
  assert.deepEqual(
    filterAccountCampaigns(members, { ...filters, state: "active" }).map((m) => m.code),
    ["AAA"],
  );
  assert.deepEqual(
    filterAccountCampaigns(members, { ...filters, state: "viewing" }).map((m) => m.code),
    ["BBB"],
  );
  assert.equal(JSON.stringify(members), before);
});
test("search includes exact code and archived unavailable seats remain explicitly findable", () => {
  assert.deepEqual(
    filterAccountCampaigns(members, { ...filters, search: " bbb " }).map((m) => m.code),
    ["BBB"],
  );
  assert.deepEqual(
    filterAccountCampaigns(members, {
      ...filters,
      role: "unavailable",
      state: "closed",
      archived: true,
    }).map((m) => m.code),
    ["CCC"],
  );
  assert.equal(filterAccountCampaigns(members, { ...filters, search: "missing" }).length, 0);
});
