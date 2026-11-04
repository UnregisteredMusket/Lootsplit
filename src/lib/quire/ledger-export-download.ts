/**
 * Ledger CSV export, browser side: load the whole campaign this seat may read (shared campaigns:
 * every older page and archived session, as Download a copy does; device campaigns: their stored
 * history in IndexedDB), build the file on the device and save it. Nothing is stored.
 */
import type { ArchiveSeat } from "./archive-reader.ts";
import { loadWholeCampaignForExport } from "./cloud-client.ts";
import { economySnapshot } from "./economy.ts";
import { ledgerCsv, ledgerExportFileName, ledgerExportRows } from "./ledger-export.ts";
import { downloadText } from "./table.ts";

export async function downloadLedgerCsv(seat: ArchiveSeat): Promise<{ saved: boolean; count: number }> {
  await loadWholeCampaignForExport();
  const rows = ledgerExportRows(await economySnapshot(), seat);
  const saved = await downloadText(ledgerExportFileName(seat), ledgerCsv(rows), "text/csv;charset=utf-8");
  return { saved, count: rows.length };
}
