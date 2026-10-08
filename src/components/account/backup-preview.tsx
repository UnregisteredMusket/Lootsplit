import { useState } from "react";
import { accountRequest } from "@/lib/account/client";
import { accountBackupSummary, type AccountBackupSummary } from "@/lib/account/backup-presentation";

export function BackupPreview({ id, shared }: { id: string; shared: boolean }) {
  const [summary, setSummary] = useState<AccountBackupSummary | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  async function preview() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (summary) return;
    setBusy(true);
    setError("");
    try {
      const response = await accountRequest<{ payload: unknown }>("read-backup", { id });
      setSummary(accountBackupSummary(response.payload));
    } catch {
      setError(
        "Coverage unavailable. This copy could not be safely read. Its original bytes remain available through Download; no campaign was changed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-backup-preview">
      <button
        className="portal-button secondary"
        disabled={busy}
        aria-expanded={open}
        onClick={() => void preview()}
      >
        {busy
          ? "Reading contents…"
          : open
            ? "Close contents preview"
            : "Preview contents & destination"}
      </button>
      {open && (
        <div role={error ? "alert" : undefined} aria-busy={busy}>
          {busy && <p role="status">Reading this selected cloud copy…</p>}
          {error && <p>{error}</p>}
          {summary && (
            <>
              <p>
                <strong>Stored here:</strong> your private account cloud backup, version{" "}
                {summary.version}.
              </p>
              <p>
                <strong>Captured:</strong>{" "}
                {summary.capturedAt === null
                  ? "Original time unknown"
                  : new Date(summary.capturedAt).toLocaleString()}
                .
              </p>
              <p>
                <strong>Restore as new:</strong> a separate device campaign; your current campaign
                stays intact.
              </p>
              {shared && (
                <p>
                  <strong>Restore shared records:</strong> a separate DM-only view-only room with
                  fresh credentials. Players must be invited and assigned again.
                </p>
              )}
              <dl className="account-backup-counts">
                {Object.entries(summary.counts).map(([label, count]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
              <p>
                {summary.supplementalRecovery
                  ? "Supplemental shared history is present. Shared restore validates that history on the server; these counts are not a completeness certificate."
                  : "This version does not include supplemental encounter/roll/assignment recovery history."}
              </p>
              <p>
                Cloud copies exclude device-private PDFs and extracted reference content. Full or
                encrypted device exports remain available separately. Your separate account
                encounter library is not part of this backup; device encounter drafts are included
                only when counted above.
              </p>
              {summary.diagnostics.length > 0 && (
                <details>
                  <summary>Preserved historical references ({summary.diagnostics.length})</summary>
                  <ul>
                    {summary.diagnostics.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
