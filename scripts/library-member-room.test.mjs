// Account library membership cards (privacy review of the campaign-name change): the DM's
// campaign name reaches only active seats, and a restored room keeps a cleaned name.
import assert from "node:assert/strict";
import test from "node:test";
import { libraryMemberRoom, restoredCampaignName } from "../cloudflare/library-member-room.mjs";

const room = (over = {}) => ({
  live: true,
  campaignName: "The Wayfarers",
  seats: [
    { id: "dm", token: "dm-token", role: "dm" },
    { id: "p1", token: "p1-token", role: "player" },
  ],
  ...over,
});

test("an active seat sees its room's state and campaign name", () => {
  assert.deepEqual(libraryMemberRoom(room(), { seat_id: "p1" }, "p1-token"), {
    role: "player",
    closed: false,
    viewOnly: false,
    live: true,
    campaignName: "The Wayfarers",
  });
});

test("released, kicked or banned members and stale tokens learn no campaign name", () => {
  const gone = libraryMemberRoom(room({ seats: [room().seats[0]] }), { seat_id: "p1" }, "p1-token");
  assert.equal(gone.role, null);
  assert.equal("campaignName" in gone, false);
  const stale = libraryMemberRoom(room(), { seat_id: "p1" }, "old-token");
  assert.equal("campaignName" in stale, false);
});

test("a closed room keeps the DM's card named and the player's unnamed", () => {
  assert.equal(libraryMemberRoom(room({ closed: true }), { seat_id: "dm" }, "dm-token").campaignName, "The Wayfarers");
  const player = libraryMemberRoom(room({ closed: true }), { seat_id: "p1" }, "p1-token");
  assert.equal(player.role, null);
  assert.equal("campaignName" in player, false);
});

test("a missing room or a device default gives no name", () => {
  assert.deepEqual(libraryMemberRoom(null, { seat_id: "p1" }, "p1-token"), { role: null, closed: false, viewOnly: false });
  assert.equal("campaignName" in libraryMemberRoom(room({ campaignName: "Party overview" }), { seat_id: "p1" }, "p1-token"), false);
});

test("a restored room's name is cleaned like any room name", () => {
  assert.equal(restoredCampaignName({ campaignName: "  The   Wayfarers  " }), "The Wayfarers");
  assert.equal(restoredCampaignName({ campaignName: "x".repeat(200) })?.length, 60);
  assert.equal(restoredCampaignName({ campaignName: "Party overview" }), undefined);
  assert.equal(restoredCampaignName({ campaignName: 5 }), undefined);
  assert.equal(restoredCampaignName(undefined), undefined);
});
