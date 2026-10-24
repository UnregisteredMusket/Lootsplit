/**
 * Encounter award ledger lines (future-development prompt 2, phase 3; owner approval 2026-10-24).
 *
 * Both award paths (the shared Worker, cloudflare/encounters.mjs, and the device,
 * src/lib/encounters/local.ts) write the one-purse coin line and the item lines through these
 * helpers, inside their existing exactly-once award transaction. Each line carries an optional
 * `award` tag: the award receipt ID and the value the DM reviewed. It is metadata on a line
 * both paths already wrote, never a balance; older lines without it stay readable and the
 * Fairness ledger reads them by their summary (items as 0 cp, flagged "value not recorded").
 */
import { z } from "zod";
import type { LedgerLine } from "./types.ts";

const id = z.string().min(1).max(150);
const whole = z.number().int().nonnegative().max(1e12);

/** The optional tag on a new encounter-award ledger line. */
export const awardTagSchema = z
  .object({
    receiptId: id,
    role: z.enum(["coins", "item"]),
    quantity: z.number().int().min(1).max(100000).optional(),
    unitCopper: whole.optional(),
  })
  .strict();
export type AwardTag = z.infer<typeof awardTagSchema>;

/** One-purse encounter coins: the whole coin award to one character or fund. */
export function encounterCoinLine(
  receiptId: string,
  at: number,
  purseId: string,
  encounterName: string,
  copper: number,
): LedgerLine {
  if (!Number.isSafeInteger(copper) || copper < 1) throw Error("Award exceeds the supported coin balance.");
  return {
    id: `${receiptId}-coins`,
    at,
    purseId,
    shopId: null,
    summary: `Encounter loot: ${encounterName}`,
    copper,
    transactionType: "adjustment",
    award: { receiptId, role: "coins" },
  };
}

/** An encounter item sent straight to a purse: 0 cp, with the value the DM reviewed. */
export function encounterItemLine(
  receiptId: string,
  index: number,
  at: number,
  purseId: string,
  item: { name: string; quantity: number; unitCopper: number },
  encounterName: string,
): LedgerLine {
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000)
    throw Error("Each awarded item needs a whole quantity of at least 1.");
  if (!Number.isSafeInteger(item.unitCopper) || item.unitCopper < 0 || item.unitCopper > 1e12)
    throw Error("Each awarded item needs a whole copper value.");
  return {
    id: `${receiptId}-item-${index}`,
    at,
    purseId,
    shopId: null,
    summary: `Encounter loot: ${item.quantity} × ${item.name} (${encounterName})`,
    copper: 0,
    transactionType: "adjustment",
    award: { receiptId, role: "item", quantity: item.quantity, unitCopper: item.unitCopper },
  };
}
