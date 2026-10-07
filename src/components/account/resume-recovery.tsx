import { useEffect, useState } from "react";
import { readResumeRecoveries, type ResumeRecovery } from "@/lib/quire/account-resume";
import { downloadJson } from "@/lib/quire/table";
import { Button } from "@/components/ui";

/** Device-only recovery records are shown only to their currently verified account. */
export function AccountResumeRecovery({ code, userId }: { code: string; userId?: string }) {
  const [saved, setSaved] = useState<{ owner: string; rows: ResumeRecovery[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const owner = sessionStorage.getItem("lootsplit.verified-account");
    if (!owner || (userId && owner !== userId)) { setSaved(null); return; }
    setSaved({ owner, rows: readResumeRecoveries(localStorage, owner, code) });
  }, [code, userId]);
  const rows = saved?.rows.filter(row => row.code === code) || [];
  if (!rows.length || (userId && saved?.owner !== userId) ||
      typeof sessionStorage === "undefined" || saved?.owner !== sessionStorage.getItem("lootsplit.verified-account")) return null;
  async function exportCopy(row: ResumeRecovery) {
    setBusy(true); setError("");
    try {
      if (!saved || sessionStorage.getItem("lootsplit.verified-account") !== saved.owner)
        throw Error("Sign in to the account that owns this recovery copy.");
      await downloadJson(`Lootsplit-recovery-${code}-${row.id}.json`, {
        code: row.code, seatId: row.seatId, role: row.role, batchId: row.batchId,
        revision: row.revision, commands: row.commands, exportedAt: row.exportedAt,
        reason: row.reason,
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to export recovery actions."); }
    finally { setBusy(false); }
  }
  return <section className="mt-3 space-y-2 rounded-lg border border-lead/30 p-3" aria-label="Unsynced action recovery">
    <h3>Unsynced action recovery</h3>
    <p className="text-sm">Earlier device actions were kept separately, not applied to your account save. These are recovery records, not full campaign backups.</p>
    {rows.map(row => <details key={row.id}>
      <summary>{row.commands.length} saved action{row.commands.length === 1 ? "" : "s"} · {new Date(row.exportedAt).toLocaleString()}</summary>
      <p className="text-sm">{row.reason}</p>
      <Button variant="secondary" disabled={busy} onClick={() => void exportCopy(row)}>Download recovery actions</Button>
    </details>)}
    <p className="text-sm">Review a copy before importing it in Multiplayer. Copies from another seat cannot be replayed; the DM can review and enter any still-needed changes manually.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
