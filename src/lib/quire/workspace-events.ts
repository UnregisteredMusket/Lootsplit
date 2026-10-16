import { activeCampaignId } from "./campaign-context.ts";

type Change = { campaignId: string; kind: "data" | "account" };
const listeners = new Set<(change: Change) => void>();
let channel: BroadcastChannel | undefined;

function connection() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  if (!channel) {
    try {
      channel = new BroadcastChannel("lootsplit.workspace.v1");
    } catch {
      return; /* Focus and ordinary shared polling remain available. */
    }
    channel.onmessage = ({ data }: MessageEvent<Change>) => {
      if (!data || !["data", "account"].includes(data.kind) || typeof data.campaignId !== "string")
        return;
      if (data.kind !== "account" && data.campaignId !== activeCampaignId()) return;
      for (const listener of listeners) listener(data);
    };
  }
  return channel;
}

/** Only invalidation notices cross windows, never campaign contents or credentials. */
export function announceWorkspaceChange(kind: Change["kind"] = "data") {
  try {
    connection()?.postMessage({ campaignId: activeCampaignId(), kind });
  } catch {
    /* Focus refresh remains available. */
  }
}

export function subscribeWorkspaceChanges(listener: (change: Change) => void) {
  connection();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
