export type RoomLifecycle = { closed?: boolean; viewOnly?: boolean; live?: boolean };

/** Presentation only. These labels never grant access or change room/turn state. */
export function roomLifecycleLabels(room: RoomLifecycle) {
  return {
    mode: room.live === undefined ? "Shared" : room.live ? "Live" : "Turn-based",
    room: room.closed ? "Room closed" : "Room online",
    play: room.closed
      ? "Play stopped · player access revoked"
      : room.viewOnly
        ? "Between sessions · players view only"
        : "Play active",
  };
}

export type RoomStatusInput = RoomLifecycle & {
  joined: boolean;
  mine?: boolean;
  who?: string;
  pending: number;
  status: "local" | "synced" | "pending" | "saving" | "attention";
  lastSync?: number;
  error?: string;
};

/** Keep connection, play permission and save acknowledgement separate. */
export function roomStatusLabels(
  state: RoomStatusInput,
  { online = true, ready = true, ephemeral = false } = {},
) {
  if (!state.joined)
    return {
      mode: ephemeral ? "Guest" : "Local",
      room: "No shared room",
      play: ephemeral ? "Join a room to play" : "DM device campaign",
      save: !ready ? "Opening campaign…" : ephemeral ? "In this document only" : "Saved on device",
      turn: "",
    };
  const lifecycle = roomLifecycleLabels(state);
  const unverified = state.lastSync === 0;
  const pending = state.pending
    ? `${state.pending} ${state.live ? "unsynced change" : "unfinished turn action"}${state.pending === 1 ? "" : "s"}`
    : "";
  const save = !online
    ? ["Offline", pending || "No new server confirmation"].join(" · ")
    : state.status === "attention" || state.error
      ? ["Needs attention", pending].filter(Boolean).join(" · ")
      : state.status === "saving"
        ? ["Saving…", pending].filter(Boolean).join(" · ")
        : pending || (unverified ? "Connecting…" : "Saved to room");
  return {
    ...lifecycle,
    room: unverified ? "Checking room…" : !online ? "Room status unavailable" : lifecycle.room,
    play: unverified
      ? "Checking play state…"
      : !online
        ? `Last known: ${lifecycle.play.toLowerCase()}`
        : lifecycle.play,
    save,
    turn:
      unverified || !online || state.viewOnly || state.closed || state.live
        ? ""
        : state.mine
          ? "Your turn"
          : `Waiting for ${state.who || "the current player"}`,
  };
}
