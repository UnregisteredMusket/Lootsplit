import { useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { useLibrary } from "@/lib/quire/library";
import { useSeat } from "@/lib/quire/seat";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "@/lib/quire/campaigns";
import { DEVICE_ONLY_DATA, pendingByCampaign } from "@/lib/quire/migration-readiness";
import { deploymentOrigins } from "@/lib/deployment/origins.mjs";
const noSubscription = () => () => {};
const pageOrigin = () => location.origin;
const serverOrigin = () => "";
export function MigrationReadiness() {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const { campaigns, activeId } = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const { books } = useLibrary();
  const seat = useSeat();
  const origin = useSyncExternalStore(noSubscription, pageOrigin, serverOrigin);
  const website = deploymentOrigins.website;
  const host = new URL(website).host;
  // Only a browser on a legacy website address is "on the old address"; the Android app's own
  // origin (https://localhost) and the new website are not.
  const onOldAddress = origin !== website && deploymentOrigins.legacy.includes(origin);
  // Read-only: every campaign saved on this device, recounted when the open room's pending work changes.
  const others = pendingByCampaign(
    typeof localStorage === "undefined" ? undefined : localStorage,
    campaigns,
  ).filter((campaign) => campaign.id !== activeId && campaign.pending !== 0);
  return <details className="review-inbox" id="migration-readiness">
    <summary>Moving to the new website address ({host})</summary>
    <p>{onOldAddress ? <>Lootsplitter now lives at <a href={website}>{host}</a>. You are on the old address, which keeps working for at least 12 months. Accounts and shared campaigns are on the same server: sign in again at {host} to see them. Anything stored only in this browser stays here until you move it with a backup.</> : <>Lootsplitter&apos;s website address is {host}. The old address keeps working for at least 12 months, and the Android app needs no change.</>} This check does not submit turns, transfer files, or change campaigns.</p>
    <p role="status">{room.joined ? room.pending ? `${room.pending} pending changes: finish or deliberately discard them before switching addresses.` : room.status === "synced" ? "This session has synchronized. A server save does not include every device-local file." : "Wait for a confirmed connection before relying on the server save." : "This campaign is on this device. Keep an exported backup before changing addresses."}</p>
    {others.length ? <ul aria-label="Other campaigns with unfinished work">
      {others.map((campaign) => <li key={campaign.id}>{campaign.name}: {campaign.pending < 0 ? "open this campaign to check its pending work" : `${campaign.pending} pending ${campaign.pending === 1 ? "change" : "changes"}`}</li>)}
    </ul> : campaigns.length > 1 ? <p>No other campaign on this device has unsubmitted shared-room changes.</p> : null}
    <p>{books.length} private library documents on this device. Keep their original files separately; do not assume a campaign or account backup contains those originals.</p>
    <p>These stay in this browser or app install and do not move to a new address:</p>
    <ul aria-label="Device-only data">{DEVICE_ONLY_DATA.map((item) => <li key={item}>{item}</li>)}</ul>
    <ol>
      <li>For each device and campaign, finish pending work deliberately. Never clear the old website’s storage as a migration step.</li>
      <li>{seat.role === "dm" ? "Use Device backups below to download a backup. Import that file back into the backup list to validate it without loading it over your campaign." : "Ask the DM to confirm the authoritative campaign save. Guest sessions do not create persistent campaign copies."}</li>
      <li>At {host}, sign in normally. Select the correct saved campaign by its ID; matching names do not identify the same campaign.</li>
      <li>For local-only campaigns, create/select a separate destination campaign before loading its validated backup. Keep the original until the restored records are verified.</li>
      <li>Installed Android versions, home-screen widgets and existing invitations keep working; the Android app needs no change.</li>
    </ol>
    <Link to="/account">Account campaigns & cloud backups</Link>
  </details>;
}
