import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, type CommandInput } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { readFinance } from "./finance.ts";
import { archiveSession, projectRecord } from "./session-records.ts";
import { readArchiveResult, type ArchiveSeat } from "./archive-reader.ts";
import { fromCopper } from "./money.ts";
import { blankShop } from "./economy.ts";
import { DEFERRED_REPORT_PREFIX } from "./history-pages.ts";
import {
  LedgerExportIncomplete,
  csvCell,
  csvDate,
  ledgerCsv,
  ledgerExportFileName,
  ledgerExportRows,
} from "./ledger-export.ts";
import type { LedgerLine } from "./types.ts";

const dmSeat: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const heroSeat: ArchiveSeat = { id: "h", role: "player", purseIds: ["hero"] };
const dm: ArchiveSeat = { id: "dm", role: "dm", purseIds: [] };

let receipt = 0;
const command = (t: CloudTable, input: CommandInput) =>
  applyCommand(t, dmSeat, { ...input, id: `ledger-export-${++receipt}` });
const line = (id: string, purseId: string, copper: number, at: number, summary = id): LedgerLine => ({
  id,
  at,
  purseId,
  shopId: null,
  summary,
  copper,
});

/**
 * Hero (this player), Rival (another player's private purse), a hidden NPC's treasury, a visible
 * shop. One archived session and a live session, each with private lines of every kind.
 */
function fixture(): CloudTable {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "hero", name: "Alwen", kind: "character", coins: fromCopper(1000) },
      { id: "rival", name: "Rivalname", kind: "character", coins: fromCopper(1000) },
    ],
    journal: readJournal({
      market: {
        currentLocationId: "city",
        locations: [
          { id: "region", name: "Eastmarch", kind: "region", parentId: null, description: "" },
          { id: "city", name: "Port", kind: "city", parentId: "region", description: "" },
        ],
      },
      finance: readFinance(),
      sessions: [{ id: "s1", name: "The Crypt", startedAt: 100, endedAt: 900 }],
    }),
  };
  t = command(t, {
    kind: "npc-create",
    npc: {
      id: "ghost",
      name: "Hidden Treasurer",
      description: "",
      locationId: "city",
      visible: false,
      barterAllowed: true,
      controllerPurseId: null,
    },
    copper: 5000,
    inventory: [],
  } as CommandInput);
  t.shops = [{ ...blankShop(), id: "smith", name: "Brass Anvil" }];
  t.ledger = [
    { ...line("a-hero", "hero", 250, 200, "Sold a lantern"), shopId: "smith", transactionType: "sale" },
    line("a-rival", "rival", -40, 210, "Rival secret bribe"),
    line("a-ghost", "ghost", 999, 220, "Treasury skim"),
  ];
  t.journal!.events = [
    { id: "a-ev-dm", at: 230, kind: "management", summary: "DM plot twist note", dmOnly: true },
    { id: "a-ev-rival", at: 240, kind: "request", summary: "Rival asked for a loan", purseId: "rival" },
    { id: "a-ev-hero", at: 250, kind: "request", summary: "Alwen asked for a loan", purseId: "hero" },
  ];
  archiveSession(t, "s1", "The Crypt", 900);
  t.journal!.sessions.push({ id: "s2", name: "The Market", startedAt: 1000 });
  t.ledger = [
    { ...line("b-hero", "hero", -120, 1100, "=HYPERLINK(\"http://x.example.com\")"), split: { id: "split-1", role: "share" } },
    line("b-rival", "rival", 75, 1110, "Rival private winnings"),
    line("b-ghost", "ghost", -500, 1120, "Treasury payroll"),
    line("b-hero-2", "hero", 30, 1130, 'Found "shiny" coins, two\nof them'),
  ];
  t.journal!.events = [
    { id: "b-ev-dm", at: 1140, kind: "prices", summary: "DM-only price change", dmOnly: true },
    { id: "b-ev-party", at: 1150, kind: "session", summary: "Party reached the market" },
  ];
  return t;
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

test("the DM's export holds every archived and live line and event, oldest first", () => {
  const rows = ledgerExportRows(fixture(), dm);
  assert.deepEqual(ids(rows), [
    "a-hero", "a-rival", "a-ghost", "a-ev-dm", "a-ev-rival", "a-ev-hero",
    "b-hero", "b-rival", "b-ghost", "b-hero-2", "b-ev-dm", "b-ev-party",
  ]);
  const hero = rows.find((r) => r.id === "a-hero")!;
  assert.equal(hero.session, "The Crypt");
  assert.equal(hero.counterparty, "Brass Anvil");
  assert.equal(hero.type, "sale");
  assert.equal(rows.find((r) => r.id === "b-hero")!.session, "The Market");
  assert.equal(rows.find((r) => r.id === "b-hero")!.groupId, "split-1");
  assert.equal(rows.find((r) => r.id === "b-hero")!.type, "split");
  assert.equal(rows.find((r) => r.id === "a-ghost")!.purse, "Hidden Treasurer");
  assert.equal(rows.find((r) => r.id === "a-ev-dm")!.dmOnly, true);
  // Running totals per purse over this file's lines.
  assert.equal(rows.find((r) => r.id === "b-hero-2")!.runningTotal, 250 - 120 + 30);
  assert.equal(rows.find((r) => r.id === "b-ghost")!.runningTotal, 999 - 500);
});

test("a player's export holds exactly the lines their projected view holds", () => {
  const table = fixture();
  const rows = ledgerExportRows(table, heroSeat);
  assert.deepEqual(ids(rows), ["a-hero", "a-ev-hero", "b-hero", "b-hero-2", "b-ev-party"]);
  // Same lines as the view: the live projection plus each archived session as the reader reads it.
  const view = projectRecord(table, heroSeat, { directory: true });
  const archived = (view.journal?.reports ?? []).flatMap((r) => {
    const read = readArchiveResult(r, heroSeat);
    return read.available ? [...read.snapshot.ledger, ...(read.snapshot.journal?.events ?? [])] : [];
  });
  const expected = [...archived, ...view.ledger, ...(view.journal?.events ?? [])].map((x) => x.id);
  assert.deepEqual(new Set(ids(rows)), new Set(expected));
  const csv = ledgerCsv(rows);
  for (const secret of [
    "Rival", "rival", "Hidden Treasurer", "ghost", "Treasury", "DM plot", "DM-only", "999", "-500",
  ])
    assert.equal(csv.includes(secret), false, `player CSV must not contain ${secret}`);
  assert.equal(rows.some((r) => r.dmOnly), false);
});

test("an archived session kept online refuses the export; an unreadable one is an explicit gap", () => {
  const table = fixture();
  const deferred = structuredClone(table);
  deferred.journal!.reports = [
    { id: "s0", name: "Old", at: 50, snapshot: "", deferred: true } as never,
    ...(deferred.journal!.reports ?? []),
  ];
  assert.throws(() => ledgerExportRows(deferred, dm), LedgerExportIncomplete);
  const stored = structuredClone(table);
  stored.journal!.reports!.unshift({ id: "s0", name: "Old", at: 50, snapshot: DEFERRED_REPORT_PREFIX + "x" });
  assert.throws(() => ledgerExportRows(stored, dm), LedgerExportIncomplete);

  const damaged = structuredClone(table);
  damaged.journal!.reports!.unshift({ id: "s0", name: "Damaged", at: 50, snapshot: "not json" });
  const rows = ledgerExportRows(damaged, dm);
  assert.equal(rows[0]!.record, "gap");
  assert.equal(rows[0]!.session, "Damaged");
  assert.match(rows[0]!.summary, /cannot be read/);
  assert.equal(rows.filter((r) => r.record !== "gap").length, 12, "readable parts are still exported");
});

test("old saves without sessions, transaction types or reports still export", () => {
  const table: CloudTable = {
    ...emptyCloudTable(),
    purses: [{ id: "hero", name: "Alwen", kind: "character", coins: fromCopper(0) }],
    ledger: [line("old-1", "hero", 10, 5), line("old-2", "gone", -3, 6)],
  };
  const rows = ledgerExportRows(table, dm);
  assert.deepEqual(ids(rows), ["old-1", "old-2"]);
  assert.equal(rows[0]!.type, "transaction");
  assert.equal(rows[0]!.session, "");
  assert.equal(rows[1]!.purse, "", "a deleted purse leaves the name blank, never invented");
  assert.equal(ledgerExportRows(table, dm).length, 2, "building twice changes nothing");
  assert.deepEqual(table.ledger.map((l) => l.id), ["old-1", "old-2"], "the table is not changed");
});

test("running totals are per purse, even when two purses show the same name", () => {
  const table: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "a", name: "Twin", kind: "character", coins: fromCopper(0) },
      { id: "b", name: "Twin", kind: "character", coins: fromCopper(0) },
    ],
    ledger: [line("a-1", "a", 10, 1), line("b-1", "b", 7, 2), line("a-2", "a", 5, 3)],
  };
  const totals = ledgerExportRows(table, dm).map((r) => [r.id, r.runningTotal]);
  assert.deepEqual(totals, [
    ["a-1", 10],
    ["b-1", 7],
    ["a-2", 15],
  ]);
});

test("CSV cells are escaped and formula injection is neutralised", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell("=1+2"), "'=1+2");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("-1"), "'-1");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell(-120), "-120", "numbers we write stay numbers");
  assert.equal(csvCell(null), "");

  const rows = ledgerExportRows(fixture(), heroSeat);
  const csv = ledgerCsv(rows);
  assert.ok(csv.startsWith("﻿Date and time,Session,Record,"));
  const record = csv.split("\r\n").find((l) => l.includes("b-hero,"))!;
  assert.ok(record.includes(`"'=HYPERLINK(""http://x.example.com"")"`));
  assert.ok(record.includes(",-120,"), "amount in copper");
  assert.ok(record.includes(",−1 gp, 2 sp,") || record.includes(',"−1 gp, 2 sp",'), "formatted amount");
  assert.ok(record.includes(`${csvDate(1100)},The Market,ledger,Alwen,`));
  assert.ok(csv.includes('"Found ""shiny"" coins, two\nof them"'));
  assert.ok(csv.endsWith("\r\n"));
  assert.equal(ledgerExportFileName(heroSeat, Date.UTC(2026, 10, 4, 12)), "lootsplitter-my-ledger-2026-11-04.csv");
  assert.equal(ledgerExportFileName(dm, Date.UTC(2026, 10, 4, 12)), "lootsplitter-ledger-2026-11-04.csv");
});
