import type { CloudTable } from "./cloud.ts";
import { canonicalJson } from "./canonical-json.ts";
import { readFinance, previewDowntime, quoteSchema, applyFinanceQuote } from "./finance.ts";
import { previewEstate } from "./estate.ts";
import { readWorld, type WorldCommand } from "./world-schema.ts";
import { toCopper } from "./money.ts";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { restedSheet } from "../characters/rest.mjs";
import { completeCharacterDowntime, inParty } from "./character-position.ts";
export function sessionTimeFingerprint(
  t: Pick<CloudTable, "journal" | "purses" | "holdings" | "shops" | "stock" | "sheets">,
) {
  const rows = <T extends { id?: string; purseId?: string }>(items: T[]) =>
    [...items].sort((a, b) => (a.id ?? a.purseId ?? "").localeCompare(b.id ?? b.purseId ?? ""));
  return canonicalJson({
    finance: t.journal?.finance,
    market: t.journal?.market,
    estate: t.journal?.propertyOperations,
    sessions: t.journal?.sessions,
    blackMarketActive: t.journal?.world?.blackMarketActive ?? false,
    characterPositions: t.journal?.world?.characterPositions ?? [],
    purses: rows(t.purses),
    holdings: rows(t.holdings),
    shops: rows(t.shops),
    stock: rows(t.stock),
    sheets: rows(t.sheets),
  });
}
export function previewSessionTime(
  t: CloudTable,
  hours: number,
  allowDowntime: boolean,
  receiptId = "session-time",
) {
  if (!Number.isInteger(hours) || hours < 1 || hours > 24)
    throw Error("Advance between 1 and 24 hours at a time.");
  const f = readFinance(t.journal?.finance);
  if (f.downtime.some((d) => d.status === "pending"))
    throw Error("Approve or cancel the pending downtime before advancing session time.");
  const total = (f.minuteOfDay ?? 0) + hours * 60,
    days = Math.floor(total / 1440),
    time = { minutes: hours * 60, allowCharacterWork: allowDowntime, receiptId };
  if (f.day + days > 1e9) throw Error("The campaign clock has reached its supported limit.");
  t = { ...t, journal: { ...t.journal!, finance: f } };
  const balances = new Map(t.purses.map((p) => [p.id, toCopper(p.coins)]));
  const quote = days
    ? previewDowntime(t, f, days, time)
    : quoteSchema.parse({
        loans: f.loans,
        rules: f.rules,
        lines: [],
        balances: [],
        ...(t.journal?.propertyOperations
          ? { propertyOperations: previewEstate(t, 0, balances, time) }
          : {}),
      });
  return {
    fromDay: f.day,
    fromMinute: f.minuteOfDay ?? 0,
    toDay: f.day + days,
    toMinute: total % 1440,
    quote,
  };
}
export function advanceSessionTime(
  t: CloudTable,
  cmd: Extract<WorldCommand, { kind: "session-time" }>,
  at: number,
) {
  const session = t.journal!.sessions.find((s) => !s.endedAt);
  if (!session) throw Error("Start a recorded play session before advancing time.");
  if (sessionTimeFingerprint(t) !== cmd.before) {
    let fields = "";
    try {
      const before = JSON.parse(cmd.before),
        now = JSON.parse(sessionTimeFingerprint(t));
      fields = Object.keys(now)
        .filter((key) => canonicalJson(now[key]) !== canonicalJson(before[key]))
        .join(", ");
    } catch {
      /* Invalid receipt remains a conflict. */
    }
    throw Error(
      `The campaign changed${fields ? " (" + fields + ")" : ""}. Review a fresh time preview.`,
    );
  }
  if (new Set(cmd.purseIds).size !== cmd.purseIds.length)
    throw Error("Choose each rest recipient once.");
  for (const id of cmd.purseIds)
    if (!t.purses.some((p) => p.id === id && p.kind === "character" && inParty(t, p)))
      throw Error("Choose existing party characters for the rest.");
  const f = (t.journal!.finance = readFinance(t.journal!.finance)),
    preview = previewSessionTime(t, cmd.hours, cmd.allowDowntime, cmd.id);
  applyFinanceQuote(
    t,
    preview.quote,
    { id: cmd.id, name: cmd.note || `${cmd.hours} session hours` },
    at,
  );
  f.day = preview.toDay;
  f.minuteOfDay = preview.toMinute;
  completeCharacterDowntime(t, at);
  if (cmd.rest !== "none")
    for (const id of cmd.purseIds) {
      const p = t.purses.find((p) => p.id === id)!;
      p.sheet = restedSheet(
        characterSheet(
          p,
          t.holdings,
          t.sheets.find((s) => s.purseId === id),
        ),
        cmd.rest,
      );
      p.sheetRevision = (p.sheetRevision ?? 0) + 1;
    }
  const w = (t.journal!.world = readWorld(t.journal!.world));
  w.timeHistory.push({
    id: cmd.id,
    sessionId: session.id,
    fromDay: preview.fromDay,
    fromMinute: preview.fromMinute,
    hours: cmd.hours,
    rest: cmd.rest,
    purseIds: cmd.purseIds,
    allowDowntime: cmd.allowDowntime,
    note: cmd.note,
    at,
  });
  t.journal!.events.push({
    id: cmd.id + "-clock",
    at,
    kind: "session",
    summary: `Advanced ${cmd.hours} hours to day ${f.day}, ${String(Math.floor(f.minuteOfDay / 60)).padStart(2, "0")}:00${cmd.rest !== "none" ? `; ${cmd.rest} rest awarded` : ""}.`,
  });
}
