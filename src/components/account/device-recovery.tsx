import { useEffect, useState } from "react";
import { downloadJson } from "@/lib/quire/table";
import { Button } from "@/components/ui";

/** Account-scoped old-seat work is retained without replaying it in a new seat. */
export function DeviceRecovery({ userId }: { userId: string }) {
  const [copies, setCopies] = useState<
    Array<{ key: string; code: string; count: number }>
  >([]);
  useEffect(() => {
    const found = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith("quire.account-recovery.v1.")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key)!);
        if (
          value.userId === userId &&
          value.separateSeat &&
          Array.isArray(value.commands)
        )
          found.push({ key, code: value.code, count: value.commands.length });
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
        The server save is available. Older device changes are kept separately
        because their seat or saved revision changed. They have not been
        submitted.
      </p>
      {copies.map((copy) => (
        <div key={copy.key}>
          <p>
            {copy.code}: {copy.count} saved device actions
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              void downloadJson(
                `lootsplit-device-recovery-${copy.code}.json`,
                JSON.parse(localStorage.getItem(copy.key)!),
              )
            }
          >
            Export device recovery copy
          </Button>
        </div>
      ))}
    </section>
  );
}
