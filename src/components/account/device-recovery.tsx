import { useEffect, useState } from "react";
import { downloadJson } from "@/lib/quire/table";
import { Button } from "@/components/ui";

/** Account-scoped old-seat work is retained without replaying it in a new seat. */
export function DeviceRecovery({ userId }: { userId: string }) {
  const [copies, setCopies] = useState<
    Array<{ key: string; code: string; count: number; archived: boolean }>
  >([]);
  useEffect(() => {
    const found = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      const archived = key.startsWith("quire.account-recovery.v1.");
      const pending = key.startsWith(`quire.cloud.v2.account-${userId}-`);
      if (!archived && !pending) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key)!);
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
          });
      } catch {
        /* An unreadable recovery record is preserved. */
      }
    }
    setCopies(found);
  }, [userId]);
  if (!copies.length) return null;
  return (
    <section className="ledger-card" aria-label="Device recovery copies">
      <h2>Device recovery copies</h2>
      <p>
        Export device work here even if opening a campaign needs attention. Open
        the campaign to reconcile pending changes in Multiplayer. Archived
        copies from older seats or conflicting revisions remain separate from
        the server save.
      </p>
      {copies.map((copy) => (
        <div key={copy.key}>
          <p>
            {copy.code}: {copy.count}{" "}
            {copy.archived
              ? "archived device actions"
              : "device actions awaiting reconciliation"}
          </p>
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
    </section>
  );
}
