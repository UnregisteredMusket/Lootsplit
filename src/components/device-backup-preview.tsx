import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button, Modal } from "@/components/ui";
import type { AccountBackupSummary } from "@/lib/account/backup-presentation";

export type DeviceBackupOperation = "import" | "load" | "preview";

/** Only an already authorized, decrypted and strictly validated file reaches this view. */
export function DeviceBackupPreview({
  operation,
  name,
  campaignName,
  encrypted,
  summary,
  open,
  busy,
  onOpenChange,
  onConfirm,
}: {
  operation: DeviceBackupOperation;
  name: string;
  campaignName: string;
  encrypted: boolean;
  summary: AccountBackupSummary;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const contents = (
    <section aria-label="Validated device backup contents" className="grid gap-3">
      <p>
        <strong>{name}</strong> · file format {summary.version}
        {encrypted ? " · encrypted source unlocked for this preview" : ""}
      </p>
      <p className="text-sm text-muted">
        Original capture:{" "}
        {summary.capturedAt === null ? "Unknown" : new Date(summary.capturedAt).toLocaleString()}.
        This preview is not saved or uploaded.
      </p>
      <p>
        {operation === "load"
          ? `Destination: replace the contents of the current device campaign, “${campaignName}”. The selected backup stays in the backup list. Export your latest campaign first if you need to keep it.`
          : operation === "import"
            ? `Destination: add a separate named backup to this device's list for “${campaignName}”. Your current campaign is unchanged. Load is a separate action.`
            : "Stored on this device. Import adds another backup copy; Load replaces the current local campaign. Neither restores a shared room connection."}
      </p>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Object.entries(summary.counts).map(([label, count]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt>{label}</dt>
            <dd className="font-bold">{count}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted">
        Full and encrypted device files retain their private PDFs and extracted articles when
        present. These files are separate from account cloud backups, which exclude those
        references. Your account's personal encounter library is separate.
      </p>
      <p className="text-sm text-muted">
        {summary.supplementalRecovery
          ? "Supplemental shared recovery history is present. A device load preserves it for recovery, but does not recreate seats, invitations or a room. Counts do not certify complete recovery."
          : "Supplemental shared recovery history is not included. Counts describe only this selected file."}
      </p>
      {!!summary.diagnostics.length && (
        <details>
          <summary>Preserved historical references · {summary.diagnostics.length}</summary>
          <ul>
            {summary.diagnostics.map((diagnostic, index) => (
              <li key={index}>{diagnostic}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
  if (operation === "preview")
    return (
      <Modal open={open} onOpenChange={onOpenChange} title="Device backup contents">
        {contents}
        <div className="mt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close contents preview
          </Button>
        </div>
      </Modal>
    );
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="modal-overlay fixed inset-0 z-40" />
        <AlertDialog.Content className="modal-pop rounded-xl border border-border bg-elevated p-4 text-fg">
          <AlertDialog.Title className="font-display text-2xl leading-tight tracking-tight">
            {operation === "load" ? "Replace the current campaign?" : "Import this backup?"}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted">
            {operation === "load"
              ? "Review the validated contents before replacing campaign data."
              : "Review the validated contents before storing a new device copy."}
          </AlertDialog.Description>
          <div className="mt-4">{contents}</div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                disabled={busy}
                variant={operation === "load" ? "danger" : "primary"}
                onClick={(event) => {
                  event.preventDefault();
                  onConfirm();
                }}
              >
                {busy ? "Applying backup…" : operation === "load" ? "Load backup" : "Import backup"}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
