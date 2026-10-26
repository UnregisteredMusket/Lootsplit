// Session chip and the Desk's "Since last session" digest (design D5 chip, Q7). Read-only: it
// summarizes records the DM's projection already holds and changes nothing.
import type { Journal } from "./journal.ts";
import { isExternalLedgerLine } from "./journal.ts";
import type { LedgerLine, Purse } from "./types.ts";
import { characterPosition } from "./character-position.ts";

export type SessionStatus = {
  /** 1-based number of the running session, or of the next one when none runs. */
  number: number;
  name: string | null;
  active: boolean;
  day: number;
};

export function sessionStatus(journal: Pick<Journal, "sessions" | "finance">): SessionStatus {
  const active = journal.sessions.find((s) => !s.endedAt);
  // DMs often number sessions in their names ("Session 12 · …"); that number wins over the count.
  const named = (name?: string) => Number(/^session\s*(\d{1,5})\b/i.exec(name ?? "")?.[1]) || 0;
  const last = journal.sessions.at(-1);
  return {
    number: active
      ? named(active.name) || journal.sessions.indexOf(active) + 1
      : named(last?.name)
        ? named(last?.name) + 1
        : journal.sessions.length + 1,
    name: active?.name ?? null,
    active: !!active,
    day: journal.finance?.day ?? 0,
  };
}

/** "Session 12 · day 42", or "No session · day 42". */
export function sessionChipLabel(status: SessionStatus): string {
  return `${status.active ? `Session ${status.number}` : "No session"} · day ${status.day}`;
}

export type SessionDigest = {
  /** When the last ended session ended; null when no session has ended yet. */
  since: number | null;
  sinceName: string | null;
  lootAwards: number;
  lootCopper: number;
  moneyIn: number;
  moneyOut: number;
  /** Player characters currently outside the party (downtime, left behind, aboard elsewhere). */
  away: string[];
};

export function sessionDigest(table: {
  journal: Pick<Journal, "sessions" | "world" | "fleet">;
  ledger: LedgerLine[];
  purses: Purse[];
}): SessionDigest {
  const ended = table.journal.sessions
    .filter((s) => s.endedAt)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  const since = ended?.endedAt ?? null;
  const rows = since === null ? [] : table.ledger.filter((line) => line.at >= since);
  const receipts = new Set<string>();
  let lootCopper = 0;
  for (const line of rows) {
    if (!line.award) continue;
    receipts.add(line.award.receiptId);
    lootCopper +=
      line.award.role === "coins"
        ? Math.max(0, line.copper)
        : (line.award.quantity ?? 0) * (line.award.unitCopper ?? 0);
  }
  // Coins in and out of the campaign: transfers between its own accounts are not income.
  const external = rows.filter(isExternalLedgerLine);
  const t = { journal: table.journal as Journal, purses: table.purses };
  return {
    since,
    sinceName: ended?.name ?? null,
    lootAwards: receipts.size,
    lootCopper,
    moneyIn: external.reduce((n, x) => n + Math.max(0, x.copper), 0),
    moneyOut: external.reduce((n, x) => n + Math.max(0, -x.copper), 0),
    away: table.purses
      .filter((p) => p.kind === "character" && p.control !== "npc" && !p.nonParty)
      .filter((p) => !characterPosition(t, p).inParty)
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b)),
  };
}
