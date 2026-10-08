import { ANALYTICS_VERSION, type GameMetrics } from "./analytics.ts";
import { formatCopper } from "./money.ts";

export type OwnerAnalyticsSnapshot = {
  version: number;
  asOf: number;
  scope: string;
  sharedCampaigns: number;
  metrics: GameMetrics;
};

type Metric = { key: keyof GameMetrics; label: string; money?: boolean };
const groups: { title: string; metrics: Metric[] }[] = [
  {
    title: "Recorded finances",
    metrics: [
      { key: "spentCopper", label: "Purchase and outgoing payment spending", money: true },
      { key: "purchaseCopper", label: "Purchase spending", money: true },
      { key: "paymentCopper", label: "Outgoing payment spending", money: true },
      { key: "salesCopper", label: "Sale proceeds", money: true },
      { key: "loanCopper", label: "Loan proceeds", money: true },
      { key: "debtCopper", label: "Current principal and interest owed", money: true },
      { key: "purchaseCount", label: "Purchases" },
      { key: "paymentCount", label: "Outgoing payments" },
      { key: "saleCount", label: "Sales" },
      { key: "transactionCount", label: "Recorded non-transfer transactions" },
      { key: "unclassifiedCount", label: "Unclassified transactions" },
    ],
  },
  {
    title: "Current campaign assets",
    metrics: [
      { key: "playerCharacters", label: "Player characters" },
      { key: "npcCharacters", label: "NPC characters" },
      { key: "partyFunds", label: "Party fund wallets" },
      { key: "inventoryQuantity", label: "Inventory quantity, including properties" },
      { key: "inventoryValueCopper", label: "Recorded inventory value", money: true },
    ],
  },
  {
    title: "Session and downtime records",
    metrics: [
      { key: "sessions", label: "Recorded sessions" },
      { key: "completedSessions", label: "Completed sessions" },
      { key: "appliedDowntimeDays", label: "Approved and applied downtime days" },
    ],
  },
];

/** Present only the existing aggregate contract; never infer missing metrics as zero. */
export function ownerAnalyticsGroups(snapshot: OwnerAnalyticsSnapshot) {
  if (
    snapshot.version !== ANALYTICS_VERSION ||
    snapshot.scope !== "current-shared-campaigns" ||
    !Number.isSafeInteger(snapshot.asOf) ||
    snapshot.asOf <= 0 ||
    !Number.isFinite(new Date(snapshot.asOf).getTime()) ||
    !Number.isSafeInteger(snapshot.sharedCampaigns) ||
    snapshot.sharedCampaigns < 0
  )
    throw Error("This analytics snapshot is unavailable or uses an unsupported format.");
  return groups.map((group) => ({
    title: group.title,
    metrics: group.metrics.map((metric) => {
      const amount = snapshot.metrics?.[metric.key];
      if (!Number.isSafeInteger(amount))
        throw Error("This analytics snapshot contains an unavailable or inexact total.");
      return {
        key: metric.key,
        label: metric.label,
        value: metric.money ? formatCopper(amount) : amount.toLocaleString(),
      };
    }),
  }));
}
