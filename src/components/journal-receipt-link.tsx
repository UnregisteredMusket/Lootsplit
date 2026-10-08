import { useEffect, useState, useSyncExternalStore } from "react";
import { encounterRequest } from "@/lib/encounters/client";
import { activeDatabaseName } from "@/lib/quire/db";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "@/lib/quire/campaigns";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { isEphemeralCampaign } from "@/lib/quire/guest-storage";
import { getSeat } from "@/lib/quire/table";
import { useSeat, useSeatKnown } from "@/lib/quire/seat";
import type { EncounterLootProvenance } from "@/lib/quire/journal";
import {
  canReadEncounterReceipt,
  confirmedReceiptHref,
  type ReceiptDetail,
  type ReceiptScope,
} from "@/lib/quire/journal-navigation";
import { AppLink } from "./app-link";
import { Button } from "./ui";

function receiptContext() {
  const room = getCloudTable(),
    campaign = getCampaigns(),
    seat = getSeat();
  const verifiedOwner = sessionStorage.getItem("lootsplit.verified-account") || "";
  const campaignOwner = localStorage.getItem(`quire.owner.${campaign.activeId}`) || "";
  const scope: ReceiptScope = {
    role: seat.role,
    joined: room.joined,
    roomRole: room.role,
    code: room.code,
    ownedDevice:
      seat.role === "dm" &&
      !room.joined &&
      !isEphemeralCampaign() &&
      !!verifiedOwner &&
      verifiedOwner === campaignOwner,
  };
  return {
    scope,
    key: JSON.stringify([
      activeDatabaseName(),
      campaign.activeId,
      verifiedOwner,
      campaignOwner,
      room.joined,
      room.code,
      room.sessionId,
      room.seatId,
      room.role,
      seat.role,
      seat.purseIds,
    ]),
  };
}

/** A party note is not authority to read its private encounter; confirm the existing DM read. */
export function JournalReceiptLink({ provenance }: { provenance: EncounterLootProvenance }) {
  const { encounterId, receiptId } = provenance;
  useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const seat = useSeat(),
    known = useSeatKnown();
  const context = typeof window === "undefined" ? null : receiptContext();
  const scopeKey = context?.key || "";
  const allowed = known && !!context && canReadEncounterReceipt(provenance, context.scope);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    href: string | null;
    checked: boolean;
  } | null>(null);
  useEffect(() => {
    const invalidate = () => {
      setResult(null);
      setRefresh((value) => value + 1);
    };
    window.addEventListener("lootsplit-account-changed", invalidate);
    return () => window.removeEventListener("lootsplit-account-changed", invalidate);
  }, []);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    const captured = receiptContext();
    const identity = { kind: "encounter-loot" as const, encounterId, receiptId };
    setResult({ key: captured.key, href: null, checked: false });
    void encounterRequest<ReceiptDetail>(
      "encounters/detail",
      { id: encounterId },
      controller.signal,
    )
      .then((detail) => {
        const current = receiptContext();
        if (!controller.signal.aborted && current.key === captured.key)
          setResult({
            key: captured.key,
            href: confirmedReceiptHref(identity, detail, current.scope),
            checked: true,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted && receiptContext().key === captured.key)
          setResult({ key: captured.key, href: null, checked: true });
      });
    return () => controller.abort();
  }, [allowed, scopeKey, refresh, encounterId, receiptId]);
  const current = allowed && result?.key === scopeKey ? result : null;
  return (
    <div className="mt-2 text-sm">
      <p className="break-words">Recorded award receipt: {provenance.receiptId}</p>
      {current?.href ? (
        <AppLink className="settings-link" href={current.href}>
          Open original encounter receipt
        </AppLink>
      ) : allowed ? (
        <>
          <p>
            {current?.checked
              ? "The original receipt is unavailable in this campaign access."
              : "Checking original receipt access…"}
          </p>
          {current?.checked && (
            <Button variant="secondary" onClick={() => setRefresh((value) => value + 1)}>
              Retry receipt access
            </Button>
          )}
        </>
      ) : (
        <p>The original encounter receipt is available only to its authorized campaign DM.</p>
      )}
      {seat.role === "player" && (
        <AppLink className="settings-link" href="/features/finances">
          Open my authorized financial history
        </AppLink>
      )}
    </div>
  );
}
