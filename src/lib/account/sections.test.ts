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

test("Field monitor links open Field monitor for the owner only", () => {
  for (const hash of [
    "#field-monitor",
    "#field-development",
    "#home-screen-widget",
    "#monitor-diagnostics-critical",
    "#monitor-history",
  ]) {
    assert.equal(accountTabForHash(hash, "owner"), "field-monitor", hash);
    assert.equal(accountTabForHash(hash, "member"), "campaigns", hash);
  }
  // Other staff have the server monitor in Administration, never the owner's Field monitor.
  assert.equal(accountTabForHash("#monitor-panel", "owner"), "administration");
  assert.equal(accountTabForHash("#monitor-panel", "admin"), "administration");
  assert.equal(accountTabForHash("#monitor-history", "admin"), "administration");
  assert.equal(accountTabForHash("#field-monitor", "admin"), "campaigns");
});

test("staff links open Administration for staff, Campaigns for members", () => {
  for (const hash of ["#account-administration", "#account-member-management", "#owner-title"]) {
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

test("only staff roles get Administration, and only the owner gets Field monitor", () => {
  assert.deepEqual(accountTabs("owner").slice(-2), ["field-monitor", "administration"]);
  assert.equal(accountTabs("admin").includes("field-monitor"), false);
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
