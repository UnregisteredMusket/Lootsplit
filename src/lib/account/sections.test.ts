import test from "node:test";
import assert from "node:assert/strict";
import { accountRunsCampaigns, accountTabForHash, accountTabs } from "./sections.ts";

test("older My account anchors open the section that holds them", () => {
  const cases: [string, string][] = [
    ["#account-campaigns", "campaigns"],
    ["#account-device-campaigns", "campaigns"],
    ["#account-encounters", "campaigns"],
    ["#account-characters", "characters"],
    ["#account-reusable-profiles", "characters"],
    ["#account-profile", "profile"],
    ["#account-community", "profile"],
    ["#account-recovery", "profile"],
    ["#account-backups", "backups"],
    ["#account-reports", "backups"],
    ["#account-support", "support"],
    ["#bug-reports", "support"],
  ];
  for (const [hash, tab] of cases) assert.equal(accountTabForHash(hash, "member"), tab, hash);
});

test("monitor and staff links open Administration for staff, Campaigns for members", () => {
  for (const hash of [
    "#account-administration",
    "#account-member-management",
    "#home-screen-widget",
    "#field-monitor",
    "#field-development",
    "#monitor-diagnostics-critical",
    "#monitor-history",
  ]) {
    assert.equal(accountTabForHash(hash, "owner"), "administration", hash);
    assert.equal(accountTabForHash(hash, "member"), "campaigns", hash);
  }
  assert.equal(accountTabForHash("#account-member-management", "moderator"), "administration");
});

test("an empty or unknown hash keeps the current section", () => {
  assert.equal(accountTabForHash("", "owner"), null);
  assert.equal(accountTabForHash("#", "member"), null);
  assert.equal(accountTabForHash("#account-sign-in", "member"), null);
  assert.equal(accountTabForHash("#purse-123", "member"), null);
  assert.equal(accountTabForHash("#%E0%A4%A", "member"), null);
});

test("only staff roles get the Administration section", () => {
  assert.deepEqual(accountTabs("member"), [
    "campaigns",
    "characters",
    "profile",
    "backups",
    "support",
  ]);
  assert.equal(accountTabs("admin").at(-1), "administration");
  assert.equal(accountTabs(undefined).includes("administration"), false);
});

test("DM-only account parts are hidden only for player-only accounts", () => {
  assert.equal(accountRunsCampaigns([], "member"), true);
  assert.equal(accountRunsCampaigns([{ role: "player" }, { role: null }], "member"), false);
  assert.equal(accountRunsCampaigns([{ role: "player" }, { role: "dm" }], "member"), true);
  assert.equal(accountRunsCampaigns([{ role: "player" }], "owner"), true);
});
