import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
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
      <p className="mt-2 max-w-prose text-sm text-muted">
        Player links and bills. Nothing is sent until you copy a link or hand someone a file.
      </p>
      {seat.role === "dm" ? (
        <>
          <Fold title="Player links" hint="One link per character. The party fund stays off until you turn it on." defaultOpen>
            <TableShare />
          </Fold>
          <Fold title="Files" hint="Open a player file, or record a bill.">
            <TableDesk />
          </Fold>
        </>
      ) : (
        <Fold title="Your bill" hint="Send this phone's purchases back to the dungeon master." defaultOpen>
          <TableDesk />
        </Fold>
      )}
    </Shell>
  );
}
