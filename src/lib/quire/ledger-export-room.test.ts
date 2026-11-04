// Ledger CSV export in a shared room and on the device: the DM's file is the same from both;
// a player's file built from their server view holds only lines their projection allows, and is
// the same as the device's projection of the whole campaign for that seat.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands } from "./cloud.server.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { type Command } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { ledgerCsv, ledgerExportRows } from "./ledger-export.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of [
  "0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql",
  "0003_accounts.sql",
  "0007_character_play.sql",
  "0008_encounters.sql",
  "0012_campaign_room_images.sql",
  "0013_campaign_resource_documents.sql",
  "0019_campaign_room_reports.sql",
  "0029_campaign_room_report_parts.sql",
  "0030_campaign_room_archive_keys.sql",
])
  sql.exec(readFileSync(new URL(`../../../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
(globalThis as any).__env__ = {
  DB: {
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      let values: any[] = [];
      return {
        bind(...args: any[]) {
          values = args;
          return this;
        },
        async all() {
          if (query.includes("FROM play_characters")) return { results: [] };
          return { results: sql.prepare(query).all(...values) };
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
        },
      };
    },
  },
};

const coins = (gp = 0) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins(100) },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins(5) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins(5) },
      { id: "cass", name: "Cass of the Reeds", kind: "character", coins: coins(5) },
    ],
    journal: readJournal({}),
  };
}
let n = 0;
const cmd = (body: Record<string, unknown>) => ({ id: `ledger-export-room-${++n}`, ...body }) as Command;
const give = (fromId: string, toId: string, copper: number) =>
  cmd({ kind: "give", fromId, toId, copper, holdingId: null, quantity: 0 });

test("room and device: the DM's export matches; a player's holds only their projection", async () => {
  const commands = [
    cmd({ kind: "session", name: "Tolls of the Weir", end: false }),
    give("bram", "aria", 30),
    give("cass", "bram", 12),
    cmd({ kind: "session", name: "Tolls of the Weir", end: true }),
    cmd({ kind: "session", name: "The Drowned Vault", end: false }),
    give("aria", "cass", 7),
    give("bram", "cass", 9),
  ];
  const dm = await openRoom({ name: "Export DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  for (const c of commands) await submitCommands({ ...dm, batchId: c.id + "-batch", commands: [c] });
  // Replaying a command changes nothing, so the export does not change either.
  await submitCommands({ ...dm, batchId: "replay", commands: [commands[1]!] });
  const shared = (await roomState(dm)).table;
  assert.equal(shared.journal!.reports!.length, 1, "the first session is archived");

  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  for (const c of commands) await executeLocalCommand(c);
  await executeLocalCommand(commands[1]!);
  const device = await economySnapshot();

  const dmSeat = { role: "dm" as const, purseIds: [] };
  const ledgerRows = (t: CloudTable) =>
    ledgerExportRows(t, dmSeat)
      .filter((r) => r.record === "ledger")
      .map((r) => [r.session, r.purse, r.copper, r.type, r.runningTotal]);
  assert.deepEqual(ledgerRows(device), ledgerRows(shared), "device and room exports agree");
  assert.equal(ledgerRows(shared).length, 8, "every line of both sessions, each once");

  const ariaView = await roomState({ code: dm.code, token: aria.token });
  const ariaSeat = { id: ariaView.seatId, role: "player" as const, purseIds: ["aria"], tabletopProjected: true };
  const fromView = ledgerExportRows(ariaView.table, ariaSeat);
  const fromWhole = ledgerExportRows(shared, ariaSeat);
  assert.deepEqual(fromView.map((r) => r.id), fromWhole.map((r) => r.id));
  const lines = fromView.filter((r) => r.record === "ledger");
  assert.deepEqual(
    lines.map((r) => [r.session, r.copper]),
    [["Tolls of the Weir", 30], ["The Drowned Vault", -7]],
    "Aria's two lines: received 30 (archived) and gave 7 (live)",
  );
  assert.ok(lines.every((r) => r.purse === "Aria Thorne"));
  const csv = ledgerCsv(fromView);
  for (const secret of ["Bram Ironfoot,", "Cass of the Reeds,", ",-12,", ",-9,", ",12,", ",9,"])
    assert.equal(csv.includes(secret), false, `Aria's file must not contain ${secret}`);
});
