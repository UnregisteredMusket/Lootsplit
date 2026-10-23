type Coins = { cp: number; sp: number; ep: number; gp: number; pp: number };
type Loot = { id: string; name: string; quantity: number; purseId: string; pool?: boolean };
export type AwardBody = {
  coins: Coins;
  coinPurseId: string;
  /** Optional even split (prompt 2, phase 1). Absent on every award saved before it. */
  coinSplit?: { purseIds: string[]; remainderRule: string; remainderPurseId?: string };
  /** Optional treasure-pool fund (prompt 2, phase 2). Absent on every award saved before it. */
  poolFundId?: string;
  loot: Loot[];
  tables: Array<{ name: string; selected: number | null }>;
};
export type AwardRecipient = { id: string; name: string; kind: string };

export function hasAwardCoins(coins: Coins): boolean {
  return [coins.cp, coins.sp, coins.ep, coins.gp, coins.pp].some((n) => n > 0);
}

/** Readiness explains existing checks; the authority still rechecks on each action. */
export function encounterReadiness(input: {
  status: string;
  body: AwardBody;
  recipients: AwardRecipient[];
  dirty: boolean;
  busy?: boolean;
  closed?: boolean;
  personal?: boolean;
  shared?: { live: boolean; mine: boolean; pending: number };
}): { conclude: string[]; transfer: string[] } {
  const common: string[] = [];
  if (input.closed) common.push("Reopen this campaign before changing its encounters.");
  if (input.busy) common.push("Wait for the current request to finish.");
  if (input.dirty) common.push("Save the encounter changes first.");
  const conclude = [...common];
  for (const table of input.body.tables)
    if (table.selected === null) conclude.push(`Choose or roll a result for ${table.name}.`);
  const transfer = [...common];
  if (input.status !== "review") transfer.push("Conclude the encounter and review its loot first.");
  if (input.personal)
    transfer.push(
      "Account-only drafts cannot award campaign loot. Import into a campaign to award it.",
    );
  const known = new Set(input.recipients.map((p) => p.id));
  const split = input.body.coinSplit;
  if (hasAwardCoins(input.body.coins) && split) {
    if (!split.purseIds.length) transfer.push("Tick at least one character to split the coins with.");
    else if (split.purseIds.some((id) => !known.has(id)))
      transfer.push("Every character in the coin split must still exist.");
    else if (awardCopper(input.body.coins) < split.purseIds.length)
      transfer.push(
        `Too little to split: each share would be 0 cp. Add coins or tick fewer characters.`,
      );
    if (split.remainderRule === "recipient" && !split.purseIds.includes(split.remainderPurseId ?? ""))
      transfer.push("Choose who gets the leftover copper from the ticked characters.");
  } else if (hasAwardCoins(input.body.coins) && !known.has(input.body.coinPurseId))
    transfer.push("Choose an existing coin recipient.");
  const funds = input.recipients.filter((p) => p.kind === "party");
  if (input.body.loot.some((item) => item.pool)) {
    if (!funds.length)
      transfer.push("Add a party fund before sending items to the treasure pool.");
    else if (input.body.poolFundId && !funds.some((p) => p.id === input.body.poolFundId))
      transfer.push("Choose an existing party fund for the treasure pool.");
  }
  input.body.loot.forEach((item, index) => {
    if (item.pool) return;
    if (!known.has(item.purseId))
      transfer.push(`Choose an existing recipient for item ${index + 1}: ${item.name}.`);
  });
  if (input.shared) {
    if (input.shared.pending > 0)
      transfer.push("Submit or discard pending campaign turns before transferring loot.");
    if (!input.shared.live && !input.shared.mine)
      transfer.push("Return the campaign turn to the DM before transferring loot.");
  }
  return { conclude, transfer };
}

export function awardCopper(coins: Coins): number {
  return coins.cp + coins.sp * 10 + coins.ep * 50 + coins.gp * 100 + coins.pp * 1000;
}

/**
 * Only the authorized recipient list supplies display names. Unknown IDs stay explicit.
 * `splitCoins` (purse ID → coins) is used only for an award with `coinSplit`; an award with a
 * single `coinPurseId` previews exactly as it always has.
 */
export function recipientAwardPreview(
  body: AwardBody,
  recipients: AwardRecipient[],
  splitCoins?: Map<string, Coins>,
  /** The fund that receives treasure-pool items (only consulted when some item has `pool`). */
  poolFund?: AwardRecipient | null,
) {
  const rows = recipients.map((p) => ({ ...p, coins: null as Coins | null, items: [] as Loot[] }));
  const unresolved: Loot[] = [];
  const pooled = body.loot.filter((item) => item.pool);
  // Older awards have no pooled items and keep exactly their previous preview shape.
  const pool = pooled.length ? { fund: poolFund ?? null, items: pooled } : undefined;
  for (const item of body.loot) {
    if (item.pool) continue;
    const row = rows.find((r) => r.id === item.purseId);
    if (row) row.items.push(item);
    else unresolved.push(item);
  }
  const coinsPresent = hasAwardCoins(body.coins);
  if (body.coinSplit) {
    for (const [id, coins] of splitCoins ?? []) {
      const row = rows.find((r) => r.id === id);
      if (row) row.coins = { ...coins };
    }
    return {
      recipients: rows.filter((r) => r.coins || r.items.length),
      unresolved,
      unresolvedCoins: coinsPresent && !splitCoins?.size,
      ...(pool ? { pool } : {}),
    };
  }
  const coinRow = rows.find((r) => r.id === body.coinPurseId);
  if (coinsPresent && coinRow) coinRow.coins = { ...body.coins };
  return {
    recipients: rows.filter((r) => r.coins || r.items.length),
    unresolved,
    unresolvedCoins: coinsPresent && !coinRow,
    ...(pool ? { pool } : {}),
  };
}

export type PlanningMember = {
  id: string;
  name: string;
  level: number | null;
  edition: string | null;
};
/** Call only after establishing the campaign's exact current context. Never parse class labels as levels. */
export function currentPartyMembers(
  purses: Array<{
    id: string;
    name: string;
    kind: string;
    sheet?: { level: number; edition: string };
  }>,
): PlanningMember[] {
  return purses
    .filter((p) => p.kind === "character")
    .map((p) => ({
      id: p.id,
      name: p.name,
      level:
        p.sheet && Number.isInteger(p.sheet.level) && p.sheet.level >= 1 && p.sheet.level <= 20
          ? p.sheet.level
          : null,
      edition: p.sheet?.edition ?? null,
    }));
}

export function reviewedPartyPlan(
  members: PlanningMember[],
  selectedIds: string[],
  commonLevel: number,
) {
  const selected = members.filter((m) => selectedIds.includes(m.id));
  const valid =
    selected.length >= 1 &&
    selected.length <= 20 &&
    Number.isInteger(commonLevel) &&
    commonLevel >= 1 &&
    commonLevel <= 20;
  return {
    selected,
    valid,
    partySize: selected.length,
    level: commonLevel,
    mixedLevels: new Set(selected.map((m) => m.level).filter((v) => v !== null)).size > 1,
    unknownLevels: selected.some((m) => m.level === null),
    non2014: selected.some((m) => m.edition !== null && m.edition !== "2014"),
  };
}

/** Party publication is an explicit DM action. This whitelist intentionally excludes private content. */
export function confirmedLootSummary(detail: {
  id: string;
  status: string;
  body: { coins: Coins; loot: Array<{ quantity: number }> };
  award: null | { receiptId: string; at: number };
}) {
  const award = detail.award;
  if (
    detail.status !== "awarded" ||
    !award ||
    typeof award.receiptId !== "string" ||
    !award.receiptId.trim() ||
    award.receiptId.length > 120 ||
    !Number.isSafeInteger(award.at) ||
    award.at < 0 ||
    !Number.isFinite(new Date(award.at).getTime())
  )
    return null;
  const itemQuantity = detail.body.loot.reduce((sum, item) => sum + item.quantity, 0);
  if (
    !Number.isSafeInteger(itemQuantity) ||
    detail.body.loot.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity < 1)
  )
    return null;
  const text = [
    `A confirmed encounter loot award was recorded on ${new Date(award.at).toISOString()}.`,
    `Items awarded: ${itemQuantity} across ${detail.body.loot.length} item entries.`,
    hasAwardCoins(detail.body.coins)
      ? "Coins were awarded; financial details remain in authorized campaign records."
      : "No coins were awarded.",
    `Award receipt: ${award.receiptId}.`,
  ].join("\n");
  return {
    title: "Encounter loot awarded",
    text,
    encounterId: detail.id,
    receiptId: award.receiptId,
  };
}
