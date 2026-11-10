import { readQuireFile } from "../quire/economy.ts";
import { commandSchema } from "../quire/commands.ts";
import { formatCopper } from "../quire/money.ts";
import type { SeatLock } from "../quire/lock.ts";

/** Read the same strict format as restore. Counting never repairs or replaces it. */
export function accountBackupSummary(value: unknown) {
  const file = readQuireFile(value);
  const finance = file.journal?.finance;
  return {
    version: file.version,
    capturedAt:
      Number.isFinite(file.exportedAt) &&
      file.exportedAt >= 0 &&
      Number.isFinite(new Date(file.exportedAt).getTime())
        ? file.exportedAt
        : null,
    counts: {
      "Characters & purses": file.purses.length,
      "Inventory entries": file.holdings.length,
      Shops: file.shops.length,
      "Stock entries": file.stock.length,
      "Ledger entries": file.ledger.length,
      "Session archives": file.journal?.reports?.length ?? 0,
      "Journal entries": file.journal?.entries?.length ?? 0,
      "Messages in this copy": file.notes?.length ?? 0,
      Handouts: file.handouts?.length ?? 0,
      "Financial loans": finance?.loans.length ?? 0,
      "Recurring agreements": finance?.rules.length ?? 0,
      "Device encounter drafts": file.localEncounters?.length ?? 0,
      "Private PDFs": file.books.length,
      "Extracted articles": file.articles.length,
    },
    supplementalRecovery: file.campaignRecovery !== undefined,
    diagnostics: file.recoveryDiagnostics ?? [],
  };
}
export type AccountBackupSummary = ReturnType<typeof accountBackupSummary>;

/** A reviewed file cannot be applied to another campaign or a changed protection policy. */
export function assertBackupPreviewContext(
  expected: { campaignId: string; gate: SeatLock | null },
  current: { campaignId: string; gate: SeatLock | null },
) {
  const protection = (gate: SeatLock | null) =>
    gate
      ? JSON.stringify({
          salt: gate.salt,
          hash: gate.hash,
          protectSaves: gate.protectSaves,
          iterations: gate.iterations,
        })
      : "unprotected";
  if (
    expected.campaignId !== current.campaignId ||
    protection(expected.gate) !== protection(current.gate)
  )
    throw new Error(
      "The current campaign or its password protection changed. Review the backup again.",
    );
}
export function backupConfirmation(summary: AccountBackupSummary, shared: boolean) {
  return `${
    shared
      ? "Restore shared records into a new room with only you as DM? It starts view-only; players need new invitations."
      : "Restore into a new device campaign?"
  }\n\nContains ${summary.counts["Characters & purses"]} purses, ${summary.counts["Inventory entries"]} inventory entries, ${summary.counts["Ledger entries"]} ledger entries and ${summary.counts["Session archives"]} session archives. ${summary.supplementalRecovery ? "Supplemental shared recovery records are present; the server validates them during shared restore." : "No supplemental shared recovery history is included."}\n\nYour current campaign and the original backup will remain. This does not merge with or overwrite a live room.`;
}

/** Describe an already authorized recovery without exposing message/character contents. */
export function pendingCommandDescription(value: unknown): string {
  const result = commandSchema.safeParse(value);
  if (!result.success) return "Unreadable action · original recovery retained";
  const c = result.data;
  switch (c.kind) {
    case "buy":
      return `Purchase ${c.quantity} units · character ${c.purseId}`;
    case "sell":
      return `Sell ${c.quantity} units · item ${c.holdingId}`;
    case "listing":
      return `Buy ${c.quantity} listed units · character ${c.purseId}`;
    case "give":
      return `Transfer ${formatCopper(c.copper)}${c.holdingId ? ` and ${c.quantity} item units` : ""} · ${c.fromId} → ${c.toId}`;
    case "coin-split":
      return `Split ${formatCopper(c.copper)} among ${c.recipientIds.length} · from ${c.sourceId}`;
    case "loot-claim":
      return `Treasure pool claim: ${c.choice} · item ${c.holdingId} · character ${c.purseId}`;
    case "loot-pool-set":
      return `${c.pooled ? "Put in" : "Take out of"} the treasure pool · item ${c.holdingId}`;
    case "loot-resolve":
      return `Resolve ${c.lots.length} treasure-pool item${c.lots.length === 1 ? "" : "s"} (${c.method})`;
    case "loot-return":
      return `Return ${c.items.length} item${c.items.length === 1 ? "" : "s"} and ${formatCopper(c.copper)} to ${c.to.pool ? "the treasure pool" : "a party fund"} · character ${c.purseId}`;
    case "xp-award":
      return `Award ${c.amount} ${c.unit === "xp" ? "XP" : c.amount === 1 ? "milestone" : "milestones"} · ${c.purseIds.length} character${c.purseIds.length === 1 ? "" : "s"}`;
    case "coin-exchange":
      return `Make change (same worth) · character ${c.purseId}`;
    case "item-attune":
      return `${c.attuned ? `Attune${c.override ? " past the limit" : ""}` : "End attunement"} · item ${c.holdingId}`;
    case "attunement-limit":
      return `Attunement limit ${c.limit ?? "default"} · character ${c.purseId}`;
    case "item-use":
      return `Use one charge · item ${c.holdingId}`;
    case "item-recharge":
      return `Recharge to ${c.current} uses · item ${c.holdingId}`;
    case "market-event":
      return `${c.before ? "Edit" : "Add"} market event: ${c.after.name}`;
    case "market-event-end":
      return `End market event: ${c.before.name}`;
    case "settlement-profile":
      return `${c.profile ? "Set" : "Clear"} settlement size · location ${c.locationId}`;
    case "settlement-ladder":
      return `Settlement sizes · ${c.after.ladder === "simple" ? "five steps" : "eight sizes"}`;
    case "settlement-limits":
      return `Settlement limits · sale cap ${c.after.sale === "off" ? "off" : c.after.sale === "refuse" ? "refuses" : "pays the limit"} · rarity cap ${c.after.rarity ? "on" : "off"}`;
    case "faction-save":
      return `${c.revision === null ? "Add" : "Edit"} faction: ${c.faction.name}`;
    case "faction-visibility":
      return `${c.hidden ? "Hide" : "Reveal"} faction · ${c.factionId}`;
    case "faction-delete":
      return `${c.deleted ? "Delete" : "Restore"} faction · ${c.factionId}`;
    case "faction-renown":
      return `Renown change for ${c.characters.length} character${c.characters.length === 1 ? "" : "s"} · faction ${c.factionId}`;
    case "faction-favor-grant":
      return `Favor change for ${c.characters.length} character${c.characters.length === 1 ? "" : "s"} · faction ${c.factionId}`;
    case "favor-entry":
      return `${c.entry ? "Save" : "Remove"} favor market entry${c.entry ? `: ${c.entry.name}` : ""} · faction ${c.factionId}`;
    case "favor-request":
      return `Ask for a favor (${c.cost} Favor) · faction ${c.factionId}`;
    case "favor-withdraw":
      return `Withdraw a favor request · faction ${c.factionId}`;
    case "favor-decision":
      return `${c.approve ? "Approve" : "Decline"} a favor request · faction ${c.factionId}`;
    case "favor-purchase":
      return `Record a favor purchase (${c.cost} Favor) · faction ${c.factionId}`;
    case "sale-split":
      return `Sell ${c.lots.length} item${c.lots.length === 1 ? "" : "s"} and split ${formatCopper(c.expect.proceeds)} among ${c.recipientIds.length} · from ${c.fundId}`;
    case "post":
      return `DM ledger posting ${formatCopper(c.copper)} · account ${c.purseId}`;
    case "set-coins":
      return `DM coin edit · account ${c.purseId}`;
    case "bank-repay":
    case "finance-repay":
      return `Repay ${formatCopper(c.copper)} · debt ${c.loanId}`;
    case "payment-request":
      return `Request ${formatCopper(c.copper)} spending · character ${c.purseId}`;
    case "loan":
      return `Request ${formatCopper(c.copper)} loan · character ${c.purseId}`;
    case "character":
    case "portrait":
      return `Character ${c.kind === "portrait" ? "portrait" : "sheet"} change · ${c.purseId}`;
    case "message":
      return `Message to ${c.to} · text kept in recovery export`;
    case "quest-save":
    case "quest-reveal":
    case "quest-objective":
    case "quest-log":
    case "quest-close":
    case "quest-link-reward":
    case "quest-archive":
    case "quest-delete":
    case "quest-renown":
      return `Quest change (${c.kind.slice(6).replaceAll("-", " ")}) · text kept in recovery export`;
    case "journal-note":
      return `Journal entry · ${c.visibility} visibility · text kept in recovery export`;
    case "patch":
      return `DM campaign edit · ${c.changes.length} record changes`;
    default:
      return c.kind.replaceAll("-", " ");
  }
}
