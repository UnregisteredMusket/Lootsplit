/**
 * The DM's notice when a shared campaign with its archived sessions has passed the total size at
 * which whole-campaign operations fit comfortably (room-size.ts `ROOM_TOTAL_LIMIT`; the server
 * sets `storageWarning` on the DM's view). Non-blocking: nothing is refused; it recommends
 * Download a copy, which keeps the whole campaign.
 */
import { useSyncExternalStore } from "react";
import { HardDriveDownload } from "lucide-react";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { AppLink } from "@/components/app-link";

export function StorageWarningNotice() {
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const warning = cloud.joined && cloud.role === "dm" ? cloud.storageWarning : null;
  if (!warning) return null;
  const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
  return (
    <div className="history-loader" role="status" data-testid="storage-warning">
      <p className="history-loader-note">
        <HardDriveDownload size={16} aria-hidden /> This campaign now keeps {mb(warning.totalBytes)} MB online with its
        archived sessions (more than {mb(warning.limit)} MB). Everything still works and sessions still end as usual,
        but very large campaigns can become too big to export or to undo old entries online. Download a copy to keep the
        whole campaign safe.
      </p>
      <AppLink href="/account#account-campaigns" className="multiplayer-settings">
        Download a copy
      </AppLink>
    </div>
  );
}
