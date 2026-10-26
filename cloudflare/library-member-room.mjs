import { roomCampaignName } from "../src/lib/quire/campaign-name.ts";

/**
 * Room-derived fields of one account library membership (GET /api/account/library). The seat
 * must still exist with this membership's token: a released, kicked or banned member keeps the
 * card but learns nothing new about the room, including later campaign renames. A player's
 * closed room keeps no role, as before.
 * @param {any} room parsed campaign_rooms body, or null when the room is gone
 * @param {{ seat_id: string }} member
 * @param {string} token
 */
export function libraryMemberRoom(room, member, token) {
  const seat = room?.seats?.find((s) => s.id === member.seat_id && s.token === token);
  const active = !!seat && (!room.closed || seat.role === "dm");
  const campaignName = active ? roomCampaignName(room.campaignName) : undefined;
  return {
    role: active ? seat.role : null,
    closed: room?.closed === true,
    viewOnly: room?.viewOnly === true,
    ...(room ? { live: room.live === true } : {}),
    // The DM's campaign name (not private), shown on the membership card of an active seat.
    ...(campaignName ? { campaignName } : {}),
  };
}

/** The campaign name a deleted room's recovery restores: cleaned like any room name. */
export function restoredCampaignName(roomState) {
  return roomCampaignName(roomState?.campaignName);
}
