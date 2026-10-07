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
} from "@/lib/quire/cloud-client";
import { Button, Confirm } from "./ui";
import { toast } from "sonner";
export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const state = useSyncExternalStore(
    subscribeCloudTable,
    getCloudTable,
    getServerCloudTable,
  );
  const [discard, setDiscard] = useState(false);
  const [disconnect, setDisconnect] = useState(false);
  if (!state.joined && state.status === "local") return null;
  const act = (fn: () => Promise<unknown>) =>
    void fn().catch((e) =>
      toast.error(e instanceof Error ? e.message : "Action failed."),
    );
  return (
    <aside
      className="mb-4 rounded-xl border border-lead/30 bg-elevated p-3 text-sm"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {state.live
            ? "Live"
            : state.mine
              ? "Your turn"
              : `Waiting for ${state.who}`}{" "}
          ·{" "}
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
      {!compact ? (
        <>
          <details className="mt-2">
            <summary className="cursor-pointer">
              Pending actions and recovery
            </summary>
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
          {state.error ? (
            <p className="mt-2 text-danger">{state.error}</p>
          ) : null}
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
