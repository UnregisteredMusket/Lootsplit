import { Link, createFileRoute } from "@tanstack/react-router";
import { CloudTable } from "@/components/cloud-table";
import { Notices } from "@/components/notices";
import { Shell } from "@/components/shell";
import { ShareChat } from "@/components/share-chat";
import { TableDesk, TableShare } from "@/components/table-share";
import { SyncStatus } from "@/components/sync-status";
import { Fold } from "@/components/ui";
import { useSeat } from "@/lib/quire/seat";

export const Route = createFileRoute("/share")({ component: SharePage });
function SharePage() {
  const seat = useSeat();
  return (
    <Shell width="prose">
      <div className="multiplayer-heading">
        <p className="eyebrow">Your party, together</p>
        <h1>Multiplayer</h1>
      </div>
      <CloudTable />
      <Fold title="Messages" hint="Talk with your dungeon master and party.">
        <ShareChat />
      </Fold>
      <Fold title="Notifications" hint="Turn reminders, messages, and room changes.">
        <Notices />
      </Fold>
      <Fold title="Connection & recovery" hint="Pending changes, retry, and recovery files.">
        <SyncStatus />
        <p className="text-sm text-muted">
          Shared changes are saved when the server accepts them. Offline changes stay pending until
          you reconnect.
        </p>
      </Fold>
      <Link to="/settings" className="quick-action mt-4">
        Device backups — view, export & restore →
      </Link>
      <Fold
        title="Manual sharing & files"
        hint="An alternative for playing without an online room."
      >
        <p className="mb-4 text-sm text-muted">
          Online rooms sync automatically. Use these tools for exchanging campaign files in Local
          Mode.
        </p>
        {seat.role === "dm" ? <TableShare /> : null}
        <TableDesk />
      </Fold>
    </Shell>
  );
}
