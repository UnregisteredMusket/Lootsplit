export type PublicSpendingSnapshot = {
  spentCopper: number;
  asOf: number | null;
  scope: "current-shared-campaigns" | null;
};

/** Keep the public projection limited to the already published spending total. */
export function parsePublicSpendingSnapshot(value: unknown): PublicSpendingSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid total");
  const record = value as Record<string, unknown>;
  const metrics = record.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics))
    throw Error("Invalid total");
  const spentCopper = (metrics as Record<string, unknown>).spentCopper;
  if (typeof spentCopper !== "number" || !Number.isSafeInteger(spentCopper) || spentCopper < 0)
    throw Error("Invalid total");
  return {
    spentCopper,
    asOf:
      typeof record.asOf === "number" &&
      Number.isSafeInteger(record.asOf) &&
      record.asOf > 0 &&
      !Number.isNaN(new Date(record.asOf).getTime())
        ? record.asOf
        : null,
    scope: record.scope === "current-shared-campaigns" ? record.scope : null,
  };
}

/** Integer copper remains exact even at the largest supported aggregate. */
export function formatGoldCopper(copper: number): string {
  if (!Number.isSafeInteger(copper) || copper < 0) throw Error("Invalid total");
  const gold = Math.floor(copper / 100).toLocaleString("en-US");
  const fraction = copper % 100;
  return fraction ? `${gold}.${String(fraction).padStart(2, "0").replace(/0$/, "")}` : gold;
}
