import { useEffect, useSyncExternalStore } from "react";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "./campaigns";
import {
  getCloudTable,
  getServerCloudTable,
  subscribeCloudTable,
  syncRoomCampaignName,
} from "./cloud-client";
import { campaignDisplayName } from "./campaign-name";

/** The open campaign's display name (campaign-name.ts): the DM's name for a shared room. */
export function useCampaignDisplayName(): string {
  const campaigns = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const active = campaigns.campaigns.find((c) => c.id === campaigns.activeId);
  return campaignDisplayName({
    deviceName: active?.name,
    joined: cloud.joined,
    role: cloud.role,
    code: cloud.code,
    roomName: cloud.campaignName,
    // Account player copies are named in the account library ("Rename" on My account).
    libraryName: active?.id.startsWith("account-") ? active.name : undefined,
  });
}

/** The DM's device sends its campaign name to the shared room it hosts (cloud-client.ts). */
export function useSyncRoomCampaignName() {
  const campaigns = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const deviceName = campaigns.campaigns.find((c) => c.id === campaigns.activeId)?.name;
  const ready = cloud.joined && cloud.role === "dm" && cloud.lastSync > 0;
  useEffect(() => {
    if (ready) syncRoomCampaignName();
  }, [ready, cloud.code, cloud.campaignName, deviceName]);
}
