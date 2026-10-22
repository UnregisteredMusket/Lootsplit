/**
 * Read-only checks for the "Prepare for a website address change" guide.
 * Nothing here writes, submits or clears storage.
 */
export type CampaignPending = { id: string; name: string; pending: number; shared: boolean };

type NamedCampaign = { id: string; name: string };

/** Saved shared-room sessions use `quire.cloud.v2.<campaign id>` (see cloud-client.ts). */
const CLOUD_SESSION_PREFIX = "quire.cloud.v2.";

/**
 * Pending (unsubmitted) shared-room actions for every campaign saved on this device,
 * not just the open one. Unreadable entries count as shared with unknown work (-1),
 * so the guide asks the user to open that campaign rather than reporting zero.
 */
export function pendingByCampaign(
  storage: Storage | undefined,
  campaigns: NamedCampaign[],
): CampaignPending[] {
  return campaigns.map(({ id, name }) => {
    let raw: string | null = null;
    try {
      raw = storage?.getItem(CLOUD_SESSION_PREFIX + id) ?? null;
    } catch {
      return { id, name, pending: -1, shared: true };
    }
    if (!raw) return { id, name, pending: 0, shared: false };
    try {
      const saved = JSON.parse(raw) as { pending?: unknown; token?: unknown } | null;
      if (!saved || typeof saved.token !== "string") return { id, name, pending: 0, shared: false };
      return {
        id,
        name,
        pending: Array.isArray(saved.pending) ? saved.pending.length : -1,
        shared: true,
      };
    } catch {
      return { id, name, pending: -1, shared: true };
    }
  });
}

/** Data kept only in this browser or app install; none of it moves with an address change. */
export const DEVICE_ONLY_DATA = [
  "Private library PDFs and other original files you added",
  "The local audio library (music and ambience you added); it is not in any backup",
  "Preferences, theme, sound and notification settings, and dismissed notices",
  "Saved map camera positions and window layouts",
  "Unsent chat messages and drafts",
  "Saved player seats and guest reconnect links for shared campaigns",
  "Recovery copies of pending work kept after a seat was revoked",
  "Bookmarks and the installed home-screen web app, which point at the old address",
] as const;
