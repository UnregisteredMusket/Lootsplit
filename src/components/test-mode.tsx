import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { accountRequest, type AccountLibrary, type AccountMembership } from "@/lib/account/client";
import {
  getCloudTable,
  getServerCloudTable,
  subscribeCloudTable,
  resumeAccountMembership,
  chooseTableMode,
  refreshShared,
  hasPendingChanges,
} from "@/lib/quire/cloud-client";
import { applyCloudTable } from "@/lib/quire/economy";
import { emptyCloudTable } from "@/lib/quire/cloud";
import { setSeat } from "@/lib/quire/table";
import { getCampaigns, switchCampaign } from "@/lib/quire/campaigns";
import { Fold, Button } from "./ui";
export function TestModeSettings({ inMenu = false }: { inMenu?: boolean }) {
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const [owner, setOwner] = useState(false),
    [count, setCount] = useState(4),
    [gold, setGold] = useState(100),
    [hp, setHp] = useState(20),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    accountRequest<AccountLibrary>("library", undefined, c.signal)
      .then((r) => setOwner(r.user.role === "owner"))
      .catch(() => {});
    return () => c.abort();
  }, []);
  if (!owner) return null;
  async function toggle() {
    setBusy(true);
    try {
      if (hasPendingChanges()) throw Error("Resolve pending actions before changing Test mode.");
      if (cloud.testMode) {
        await chooseTableMode("local");
        await applyCloudTable(emptyCloudTable());
        setSeat({ role: "dm", purseIds: [], shopIds: [], openedAt: Date.now() });
        const previous = localStorage.getItem("lootsplit.before-test");
        if (previous && getCampaigns().campaigns.some((c) => c.id === previous))
          switchCampaign(previous);
      } else {
        const membership = await accountRequest<AccountMembership>("owner/test-mode", {
          action: "create",
          characters: count,
          gold,
          hp,
        });
        localStorage.setItem("lootsplit.before-test", getCampaigns().activeId);
        await resumeAccountMembership(membership);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change Test mode");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Fold
      title="Test mode"
      anchorId={inMenu ? undefined : "test-mode"}
      hint="Owner-only sandbox. Excluded from public and owner gameplay analytics."
    >
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={cloud.testMode}
          disabled={busy}
          onChange={() => void toggle()}
        />{" "}
        Enable Test mode
      </label>
      <div className="grid gap-3">
        {[
          ["Characters", count, setCount, 1, 12],
          ["Starting gold", gold, setGold, 0, 1000000],
          ["Starting HP", hp, setHp, 1, 9999],
        ].map(([label, value, setter, min, max]) => (
          <label key={String(label)}>
            {String(label)}
            <input
              aria-label={String(label)}
              className="ledger-search"
              type="number"
              min={Number(min)}
              max={Number(max)}
              value={Number(value)}
              disabled={cloud.testMode || busy}
              onChange={(e) => (setter as (n: number) => void)(Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <p>
        Creates a separate Test campaign. Reset restores this configuration and clears its logs,
        notes, encounters and transactions.
      </p>
    </Fold>
  );
}
export function TestResetButton() {
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable),
    [busy, setBusy] = useState(false);
  if (!cloud.testMode || cloud.role !== "dm") return null;
  return (
    <Button
      variant="ghost"
      className="text-negative"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Reset this Test campaign and clear all its simulated data?")) return;
        setBusy(true);
        try {
          await accountRequest("owner/test-mode", {
            action: "reset",
            code: cloud.code,
            revision: cloud.revision,
          });
          await refreshShared();
          toast.success("Test campaign reset");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Reset failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      Reset Test mode — clear all data
    </Button>
  );
}
