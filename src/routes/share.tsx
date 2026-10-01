import { createFileRoute } from "@tanstack/react-router";
import { CloudTable } from "@/components/cloud-table";
import { Notices } from "@/components/notices";
import { Shell } from "@/components/shell";
import { ShareChat } from "@/components/share-chat";
import { TableDesk, TableShare } from "@/components/table-share";
import { Fold } from "@/components/ui";
import { useSeat } from "@/lib/quire/seat";

export const Route = createFileRoute("/share")({
  component: SharePage,
});

function SharePage() {
  const seat = useSeat();
  return (
    <Shell width="prose">
      <h1 className="font-display text-4xl tracking-tight">Share</h1>
      <p className="mt-2 text-sm text-muted">The table, messages, and the bill. Open a section for the controls.</p>
      <Fold title="Notices" hint="Mode changes, messages, and your turn.">
        <Notices />
      </Fold>
      {seat.role === "dm" ? (
        <>
          <Fold title="Control panel" hint="Local Mode, Turn based Mode, or Live Mode." defaultOpen>
            <CloudTable />
          </Fold>
          <Fold title="Messages" hint="Party notes go on every link. A private note goes only to the players you check.">
            <ShareChat />
          </Fold>
          <Fold title="Player links" hint="One link per character. The party fund stays off until you turn it on.">
            <TableShare />
          </Fold>
          <Fold title="Files" hint="Open a player file, or record a bill.">
            <TableDesk />
          </Fold>
        </>
      ) : (
        <>
          <Fold title="Table" hint="Local Mode until the dungeon master opens another." defaultOpen>
            <CloudTable />
          </Fold>
          <Fold title="Messages" hint="Write to the dungeon master, or to the party. Both go out with your bill.">
            <ShareChat />
          </Fold>
          <Fold title="Your bill" hint="Send this phone's purchases back to the dungeon master.">
            <TableDesk />
          </Fold>
        </>
      )}
    </Shell>
  );
}
