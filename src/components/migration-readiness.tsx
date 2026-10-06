import { useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { useLibrary } from "@/lib/quire/library";
import { useSeat } from "@/lib/quire/seat";
export function MigrationReadiness() {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const { books } = useLibrary();
  const seat = useSeat();
  return <details className="review-inbox" id="migration-readiness">
    <summary>Prepare for a future website address change</summary>
    <p>No address change is active. This check does not submit turns, transfer files, or change campaigns.</p>
    <p role="status">{room.joined ? room.pending ? `${room.pending} pending changes: finish or deliberately discard them before switching addresses.` : room.status === "synced" ? "This session has synchronized. A server save does not include every device-local file." : "Wait for a confirmed connection before relying on the server save." : "This campaign is on this device. Keep an exported backup before changing addresses."}</p>
    <p>{books.length} private library documents on this device. Keep their original files separately; do not assume a campaign or account backup contains those originals.</p>
    <ol>
      <li>For each device and campaign, finish pending work deliberately. Never clear the old website’s storage as a migration step.</li>
      <li>{seat.role === "dm" ? "Use Device backups below to download a backup. Import that file back into the backup list to validate it without loading it over your campaign." : "Ask the DM to confirm the authoritative campaign save. Guest sessions do not create persistent campaign copies."}</li>
      <li>At the future address, sign in normally. Select the correct saved campaign by its ID; matching names do not identify the same campaign.</li>
      <li>For local-only campaigns, create/select a separate destination campaign before loading its validated backup. Keep the original until the restored records are verified.</li>
      <li>Installed Android versions and existing invitations will keep their supported endpoint during the transition.</li>
    </ol>
    <Link to="/account">Account campaigns & cloud backups</Link>
  </details>;
}
