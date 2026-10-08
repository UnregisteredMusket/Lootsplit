import { useSyncExternalStore } from "react";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "./cloud-client";
import { useSeat } from "./seat";

export function useFinanceReadiness(pendingDowntime = false) {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable),
    seat = useSeat();
  const reason =
    room.joined && room.viewOnly && seat.role === "player"
      ? "Viewing between sessions. Actions wait until the DM resumes play."
      : room.joined && !room.mine
        ? `Waiting for ${room.who}'s turn.`
        : pendingDowntime
          ? "The DM must settle or cancel pending downtime before repayment or financial plan changes."
          : "";
  return { locked: !!reason, reason, room };
}
