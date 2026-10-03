import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { accountRequest } from "@/lib/account/client";

export function GoldSpentCounter() {
  const [copper, setCopper] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    accountRequest<{ metrics: { spentCopper: number } }>("site-analytics")
      .then(({ metrics }) => {
        if (!Number.isSafeInteger(metrics.spentCopper) || metrics.spentCopper < 0)
          throw Error("Invalid total");
        if (alive) setCopper(metrics.spentCopper);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <span title="Recorded purchases and outgoing payments across current shared campaigns. Transfers, adjustments and voided entries excluded. Local-only saves stay on your device. Totals may take a minute to update.">
      <Coins size={18} />
      <span role="status" style={{ display: "block" }}>
        {copper === null
          ? failed
            ? "Gold spent · temporarily unavailable"
            : "Gold spent · loading…"
          : `${(copper / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} gp spent`}
        <small style={{ display: "block", fontSize: "0.75em" }}>Across shared campaigns</small>
      </span>
    </span>
  );
}
