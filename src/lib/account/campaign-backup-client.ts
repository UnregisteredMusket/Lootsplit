import { getCampaigns } from "../quire/campaigns.ts";
import { getCloudTable } from "../quire/cloud-client.ts";
import { campaignBackupKey, roomBackupKey } from "./campaign-backups.ts";

/**
 * The campaign key (campaign-backups.ts) of the campaign open on this device: its shared room
 * while joined to one, otherwise the device campaign. The first campaign on every device is
 * called "main", so this device keeps its own id for it.
 */
export function currentCampaignBackupKey(): string | null {
  const cloud = getCloudTable();
  if (cloud.joined && cloud.code) return campaignBackupKey(roomBackupKey(cloud.code));
  const { activeId } = getCampaigns();
  if (/^[A-Za-z0-9_-]{8,64}$/.test(activeId)) return `device:${activeId}`;
  const stored = `lootsplit.backup-campaign.${activeId}`;
  try {
    let id = localStorage.getItem(stored);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(stored, id);
    }
    return `device:${id}`;
  } catch {
    // Without storage the backup is saved without a campaign, as before (never rotated).
    return null;
  }
}

const DOWNLOADED = "lootsplit.campaign-downloaded.";

/** When this device last downloaded a copy of the campaign (null: never, or unknown). */
export function lastCampaignDownload(key: string | null): number | null {
  if (!key) return null;
  try {
    const at = Number(localStorage.getItem(DOWNLOADED + key));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/** Remember a downloaded copy (a gentle reminder only; never blocks anything). */
export function noteCampaignDownload(key: string | null) {
  if (!key) return;
  try {
    localStorage.setItem(DOWNLOADED + key, String(Date.now()));
  } catch {
    // Reminder only.
  }
}

/** A reminder is shown when the campaign has not been downloaded on this device for this long. */
export const DOWNLOAD_REMINDER_MS = 30 * 86_400_000;
