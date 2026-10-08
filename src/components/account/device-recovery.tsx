import { useEffect, useState, useSyncExternalStore } from "react";
import { downloadJson } from "@/lib/quire/table";
import { Button, Confirm } from "@/components/ui";
import { accountRequest, type AccountLibrary } from "@/lib/account/client";
import {
  getCloudTable,
  getServerCloudTable,
  subscribeCloudTable,
  exportRevokedPending,
  discardRevokedPending,
  refreshRecoveryVisibility,
} from "@/lib/quire/cloud-client";
import { authorizeLegacyRecovery, revokedRecoveryCopy } from "@/lib/quire/revoked-recovery";
import { pendingCommandDescription } from "@/lib/account/backup-presentation";

type RecoveryPreview = { seat: string; capturedAt: number | null; commands: string[] };
function recoveryPreview(value: {
  seatId?: unknown;
  exportedAt?: unknown;
  commands: unknown[];
}): RecoveryPreview {
  return {
    seat: typeof value.seatId === "string" && value.seatId ? value.seatId : "Unknown original seat",
    capturedAt:
      typeof value.exportedAt === "number" &&
      Number.isFinite(value.exportedAt) &&
      value.exportedAt >= 0
        ? value.exportedAt
        : null,
    commands: value.commands.map(pendingCommandDescription),
  };
}
function RecoveryDetails({ preview }: { preview: RecoveryPreview }) {
  return (
    <details>
      <summary>Review original action scope · {preview.commands.length} actions</summary>
      <p>
        Original seat: {preview.seat}. Captured:{" "}
        {preview.capturedAt === null ? "Unknown" : new Date(preview.capturedAt).toLocaleString()}.
      </p>
      <p>
        Actions belong to this room and original seat. This preview does not send or replay them.
        Message and journal text remain in the recovery export.
      </p>
      <ol>
        {preview.commands.map((command, index) => (
          <li key={index}>{command}</li>
        ))}
      </ol>
    </details>
  );
}

/** Account-scoped old-seat work is retained without replaying it in a new seat. */
export function DeviceRecovery({ userId }: { userId: string }) {
  const recovery = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const verified =
    typeof sessionStorage === "undefined"
      ? null
      : sessionStorage.getItem("lootsplit.verified-account");
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState<string | null>(null);
  const [copies, setCopies] = useState<
    Array<{ key: string; code: string; count: number; archived: boolean; preview: RecoveryPreview }>
  >([]);
  useEffect(() => {
    if (verified !== userId) {
      setCopies([]);
      return;
    }
    const found = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      const archived = key.startsWith("quire.account-recovery.v1.");
      const pending = key.startsWith(`quire.cloud.v2.account-${userId}-`);
      if (!archived && !pending) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key)!);
        if (value.revoked) continue;
        if (
          archived &&
          value.userId === userId &&
          value.separateSeat &&
          Array.isArray(value.commands)
        )
          found.push({
            key,
            code: value.code,
            count: value.commands.length,
            archived: true,
            preview: recoveryPreview(value),
          });
        else if (
          pending &&
          value.role === "dm" &&
          Array.isArray(value.pending) &&
          value.pending.length
        )
          found.push({
            key,
            code: value.code,
            count: value.pending.length,
            archived: false,
            preview: recoveryPreview({ ...value, commands: value.pending }),
          });
      } catch {
        /* An unreadable recovery record is preserved. */
      }
    }
    setCopies(found);
  }, [userId, verified, recovery.recoveries.length]);
  const revoked = recovery.recoveries;
  if (verified !== userId) return null;
  if (!copies.length && !recovery.recoveries.length && !recovery.unverifiedRecoveries) return null;
  async function verifyOlder() {
    setError("");
    try {
      const library = await accountRequest<AccountLibrary>("library");
      if (library.user.id !== userId)
        throw Error("Sign in to the account that owns these campaigns.");
      authorizeLegacyRecovery(userId, library.members);
      refreshRecoveryVisibility();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ownership could not be checked.");
    }
  }
  return (
    <section className="ledger-card" aria-label="Device recovery copies">
      <h2>Device recovery copies</h2>
      <p>
        Export device work here even if opening a campaign needs attention. Open the campaign to
        reconcile pending changes in Multiplayer. Retry sends pending actions in Live mode or saves
        an unfinished online turn in Turn-based mode; Submit turn remains a separate action.
        Archived copies from older seats or conflicting revisions remain separate from the server
        save and are never replayed under a new seat. Guest work is memory-only; export it to a file
        before closing this tab if you need a recovery copy.
      </p>
      {copies.map((copy) => (
        <div key={copy.key}>
          <p>
            {copy.code}: {copy.count}{" "}
            {copy.archived ? "archived device actions" : "device actions awaiting reconciliation"}
          </p>
          <RecoveryDetails preview={copy.preview} />
          <Button
            variant="secondary"
            onClick={() => {
              const value = JSON.parse(localStorage.getItem(copy.key)!);
              void downloadJson(
                `lootsplit-device-recovery-${copy.code}.json`,
                copy.archived
                  ? value
                  : {
                      userId,
                      code: value.code,
                      seatId: value.seatId,
                      batchId: value.batchId,
                      commands: value.pending,
                      exportedAt: Date.now(),
                    },
              );
            }}
          >
            Export device recovery copy
          </Button>
        </div>
      ))}
      {revoked.map((copy) => {
        let preview: RecoveryPreview | null = null;
        try {
          // The recovery API checks the verified owner before exposing token-free fields.
          preview = recoveryPreview(revokedRecoveryCopy(copy.id));
        } catch {
          /* Keep export/verification controls available without exposing contents. */
        }
        return (
          <div key={copy.id}>
            <p>
              {copy.code}: {copy.pending} unsent device actions
            </p>
            {preview && <RecoveryDetails preview={preview} />}
            <Button
              variant="secondary"
              onClick={() => void exportRevokedPending(copy.id).catch((e) => setError(e.message))}
            >
              Export device recovery copy
            </Button>
            <Button variant="ghost" onClick={() => setDiscard(copy.id)}>
              Discard recovery copy
            </Button>
          </div>
        );
      })}
      {recovery.unverifiedRecoveries ? (
        <div>
          <p>
            {recovery.unverifiedRecoveries} older recovery copies are preserved. Their contents
            remain hidden until this account's saved DM memberships verify ownership. Unverified
            copies remain unchanged for device recovery.
          </p>
          <Button variant="secondary" onClick={() => void verifyOlder()}>
            Verify older recovery copies
          </Button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <Confirm
        open={discard !== null}
        onOpenChange={(open) => {
          if (!open) setDiscard(null);
        }}
        title="Discard this recovery copy?"
        body="Export it first if you need to keep these unsent actions. This removes only this account's selected device copy."
        confirmLabel="Discard"
        onConfirm={() => {
          const id = discard;
          setDiscard(null);
          if (id) void discardRevokedPending(id).catch((e) => setError(e.message));
        }}
      />
    </section>
  );
}
