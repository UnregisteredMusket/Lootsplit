import { useMemo, useSyncExternalStore } from "react";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "./campaigns";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "./cloud-client";
import { isEphemeralCampaign } from "./guest-storage";
import type { ArchiveSeat } from "./archive-reader";

/** This exception is only for the signed-in DM's owned local copy, never a shared or guest reader. */
export function useArchiveReaderSeat(seat: Pick<ArchiveSeat, "role" | "purseIds">): ArchiveSeat {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const campaign = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const verifiedOwner =
    typeof window === "undefined"
      ? ""
      : window.sessionStorage.getItem("lootsplit.verified-account") || "";
  const campaignOwner =
    typeof window === "undefined"
      ? ""
      : window.localStorage.getItem(`quire.owner.${campaign.activeId}`) || "";
  const ownedDevice =
    seat.role === "dm" &&
    !room.joined &&
    !isEphemeralCampaign() &&
    !!verifiedOwner &&
    campaignOwner === verifiedOwner;
  return useMemo(
    () => ({
      role: seat.role,
      purseIds: seat.purseIds,
      ...(room.joined && room.seatId ? { id: room.seatId } : {}),
      ownedDevice,
    }),
    [seat, room.joined, room.seatId, ownedDevice],
  );
}
