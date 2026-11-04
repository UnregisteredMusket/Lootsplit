import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "./ui";
import type { ArchiveSeat } from "@/lib/quire/archive-reader";

/**
 * Activity → Download CSV: every ledger line and Activity event this seat may read, from the whole
 * stored history (archived sessions and earlier pages are loaded first). Built on this device.
 */
export function LedgerCsvButton({ seat }: { seat: ArchiveSeat }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={busy}
      data-testid="ledger-csv-export"
      onClick={async () => {
        setBusy(true);
        try {
          const { downloadLedgerCsv } = await import("@/lib/quire/ledger-export-download");
          const { saved, count } = await downloadLedgerCsv(seat);
          if (saved)
            toast.success(
              `Downloaded ${count} ${count === 1 ? "record" : "records"} as CSV${seat.role === "dm" ? "" : " (your characters' history)"}.`,
            );
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "The CSV could not be built. Nothing was downloaded.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download size={16} /> {busy ? "Preparing CSV…" : "Download CSV"}
    </Button>
  );
}
