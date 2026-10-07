import { getServerCloudTable } from "@/lib/quire/cloud-client";
import { useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import {
  getCloudTable,
  subscribeCloudTable,
  retryPending,
  discardPending,
  exportPending,
  disconnectClosedRoom,
  pendingActions,
  importPending,
  exportRevokedPending,
  discardRevokedPending,
} from "@/lib/quire/cloud-client";
import { Button, Confirm } from "./ui";
import { toast } from "sonner";
export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const state = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const [discard, setDiscard] = useState(false);
  const [disconnect, setDisconnect] = useState(false);
  const [discardRecovery, setDiscardRecovery] = useState<string | null>(null);
  if (
    !state.joined &&
    state.status === "local" &&
    !state.recoveries.length &&
    !state.unverifiedRecoveries
  )
    return null;
  const act = (fn: () => Promise<unknown>) =>
    void fn().catch((e) => toast.error(e instanceof Error ? e.message : "Action failed."));
  return (
    <aside
      className="mb-4 rounded-xl border border-lead/30 bg-elevated p-3 text-sm"
      aria-live="polite"
    >
      {state.recoveries.map((recovery) => (
        <div key={recovery.id} className="mb-2">
          <p>
            Campaign access ended. {recovery.pending} unsent action
            {recovery.pending === 1 ? "" : "s"} remain in this document for room {recovery.code}.
            Export before closing or reloading.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => act(() => exportRevokedPending(recovery.id))}
            >
              Export unsent recovery
            </Button>
            <Button variant="ghost" onClick={() => setDiscardRecovery(recovery.id)}>
              Discard recovery copy
            </Button>
          </div>
        </div>
      ))}
      {state.unverifiedRecoveries ? (
        <p>
          {state.unverifiedRecoveries} older recovery cop
          {state.unverifiedRecoveries === 1 ? "y is" : "ies are"} preserved on this device.{" "}
          <Link to="/account" className="underline">
            Verify ownership in My account
          </Link>{" "}
          to recover authorized work.
        </p>
      ) : null}
      {state.joined ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {state.live ? "Live" : state.mine ? "Your turn" : `Waiting for ${state.who}`} ·{" "}
            {state.status === "saving"
              ? "Saving…"
              : state.status === "attention"
                ? "Needs attention"
                : state.pending
                  ? `${state.pending} ${state.live ? "unsynced Live change" : "unfinished turn action"}${state.pending === 1 ? "" : "s"}`
                  : "Synced"}
          </span>
          <Link to="/share" className="underline">
            Multiplayer
          </Link>
        </div>
      ) : null}
      {!compact && state.joined ? (
        <>
          <details className="mt-2">
            <summary className="cursor-pointer">Pending actions and recovery</summary>
            {pendingActions().length ? (
              <ol className="mt-2 list-inside list-decimal">
                {pendingActions().map((action) => (
                  <li key={action.id}>
                    {action.kind === "patch" ? "DM campaign edit" : action.kind}
                  </li>
                ))}
              </ol>
            ) : (
              <p>No pending actions.</p>
            )}
            <label className="inline-flex min-h-11 cursor-pointer items-center underline">
              Import recovery file
              <input
                className="sr-only"
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) act(() => importPending(file));
                }}
              />
            </label>
          </details>
          {state.error ? <p className="mt-2 text-danger">{state.error}</p> : null}
          {state.pending || state.error ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => act(retryPending)}>
                Retry
              </Button>
              <Button variant="ghost" onClick={() => act(exportPending)}>
                Export pending actions
              </Button>
              <Button variant="ghost" onClick={() => setDiscard(true)}>
                Discard pending actions
              </Button>
              {state.error ? (
                <Button variant="ghost" onClick={() => setDisconnect(true)}>
                  Disconnect with recovery copy
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      <Confirm
        open={discardRecovery !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardRecovery(null);
        }}
        title="Discard unsent recovery?"
        body="These actions never reached the campaign. Export the recovery copy first if you need to keep them."
        confirmLabel="Discard"
        onConfirm={() => {
          const id = discardRecovery;
          setDiscardRecovery(null);
          if (id) act(() => discardRevokedPending(id));
        }}
      />
      <Confirm
        open={discard}
        onOpenChange={setDiscard}
        title="Discard pending actions?"
        body="These unsubmitted actions will be removed and the server copy restored. Export them first if you need a recovery record."
        confirmLabel="Discard"
        onConfirm={() => {
          setDiscard(false);
          act(discardPending);
        }}
      />
      <Confirm
        open={disconnect}
        onOpenChange={setDisconnect}
        title="Disconnect from this campaign?"
        body="A recovery file of your pending actions will download first. This does not close the server room or release your character; the DM may need to release it before you rejoin."
        confirmLabel="Export and disconnect"
        onConfirm={() => {
          setDisconnect(false);
          act(disconnectClosedRoom);
        }}
      />
    </aside>
  );
}
