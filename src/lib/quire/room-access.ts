/** Ended rooms are readable only when the DM explicitly retained player access. */
export type RoomAccess = { closed?: boolean; viewOnly?: boolean };
export const VIEW_ONLY_MESSAGE =
  "This session has ended. The room is view-only until the DM reopens it.";
export function isRoomViewOnly(room: RoomAccess | null | undefined): boolean {
  return room?.closed === true && room.viewOnly === true;
}
export function canReadRoom(room: RoomAccess | null | undefined): boolean {
  return !!room && (!room.closed || isRoomViewOnly(room));
}
