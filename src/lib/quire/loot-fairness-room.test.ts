// Fairness ledger in shared rooms and on the device: what DM, party member and player away
// receive and can compute (archived sessions in D1 report storage), and "Favour whoever is
// behind" through the room command and executeLocalCommand (same result, applied once).
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { type Command } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { characterPosition } from "./character-position.ts";
import { lootFingerprint, readLootClaims } from "./loot-claims.ts";
import { fairnessLedger, fairnessReceipts, fairnessStandings } from "./loot-fairness.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import type { LedgerLine } from "./types.ts";

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
      { id: "wren", name: "Wren Ashdown", kind: "character", coins: coins(5) },
      { id: "dunstan", name: "Dunstan the porter", kind: "character", control: "npc", coins: coins(5) },
    ],
    holdings: [
      { id: "potion", purseId: "hoard", name: "Potion of healing", kind: "item", quantity: 3, unitCopper: 50, notes: "", pool: { at: 1, source: "add-loot" } },
    ],
    journal: readJournal({}),
  };
}
type Seat = { code: string; token: string };
let n = 0;
const cmd = (body: Record<string, unknown>) => ({ id: `room-${++n}`, ...body }) as Command;
const send = (seat: Seat, ...commands: Command[]) => submitCommands({ ...seat, batchId: commands[0]!.id + "-batch", commands });
const split = (sourceId: string, copper: number, recipientIds: string[]) =>
  cmd({ kind: "coin-split", sourceId, copper, recipientIds, remainder: { rule: "party-fund", purseId: "hoard" }, expect: { share: copper / recipientIds.length, remainderTo: null } });

/** Session 1 with Wren in the party, then Wren leaves; Session 2 in progress. */
async function room() {
  const dm = await openRoom({ name: "Fairness DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const wren = await joinRoom({ code: dm.code, purseId: "wren", name: "Wren" });
  await choosePace({ ...dm, live: true });
  await send(dm, cmd({ kind: "session", name: "Tolls of the Weir", end: false }));
  await send(dm, split("hoard", 400, ["aria", "bram", "cass", "wren"]));
  await send(dm, cmd({ kind: "give", fromId: "bram", toId: "aria", copper: 30, holdingId: null, quantity: 0 }));
  await send(dm, cmd({ kind: "coin-split", sourceId: "dunstan", copper: 20, recipientIds: ["aria", "bram"], remainder: { rule: "party-fund", purseId: "hoard" }, expect: { share: 10, remainderTo: null } }));
  await send(dm, cmd({ kind: "session", name: "Tolls of the Weir", end: true }));
  const t = (await roomState(dm)).table;
  const wrenPurse = t.purses.find((p) => p.id === "wren")!;
  await send(dm, cmd({ kind: "character-position", purseId: "wren", before: characterPosition(t, wrenPurse), inParty: false, locationId: null, visible: true, sheetVisible: true }));
  await send(dm, cmd({ kind: "session", name: "The Drowned Vault", end: false }));
  await send(dm, split("hoard", 120, ["aria", "bram", "cass"]));
  return { dm, aria: { code: dm.code, token: aria.token }, wren: { code: dm.code, token: wren.token } };
}
const rows = (view: ReturnType<typeof fairnessLedger>) => view.rows.map((r) => [r.purseId, r.total]);

test("room: DM, party member and player away each compute only what their projection allows", async () => {
  const { dm, aria, wren } = await room();
  const forDm = (await roomState(dm)).table;
  assert.equal(forDm.journal!.reports!.length, 1);
  const dmView = fairnessLedger(forDm, { dm: true, purseIds: [] });
  // Fund splits count (100 + 40); Give and the NPC-funded split never do.
  assert.deepEqual(rows(dmView), [["aria", 140], ["bram", 140], ["cass", 140]]);
  assert.deepEqual(dmView.others.map((r) => [r.purseId, r.status, r.total]), [["wren", "away", 100]]);

  const forAria = (await roomState(aria)).table;
  const ariaView = fairnessLedger(forAria, { dm: false, purseIds: ["aria"] });
  assert.deepEqual(rows(ariaView), rows(dmView));
  assert.deepEqual(ariaView.others, [], "away characters are DM-only rows");
  // Another character's breakdown: counted receipts only.
  const bram = fairnessReceipts(forAria, { dm: false, purseIds: ["aria"] }, "bram");
  assert.equal(bram.others, null);
  assert.deepEqual(bram.groups.flatMap((g) => g.receipts.map((r) => r.coins)), [40, 100]);
  // Aria's archived session carries Bram's and Cass's counted lines only: not his Give, not the NPC split.
  const ext = JSON.parse(forAria.journal!.reports![0]!.snapshot).fairness;
  assert.ok((ext.lines as LedgerLine[]).every((l) => l.split?.role === "share" && l.summary === "Split share from The Hoard"));
  assert.equal(JSON.stringify(forAria).includes("Dunstan the porter\""), false, "the NPC's purse is not projected to players");

  const forWren = (await roomState(wren)).table;
  const wrenView = fairnessLedger(forWren, { dm: false, purseIds: ["wren"] });
  assert.equal(wrenView.compared, false);
  assert.deepEqual([...wrenView.rows, ...wrenView.others].map((r) => [r.purseId, r.total]), [["wren", 100]]);
  const wrenLines = [
    ...forWren.ledger,
    ...forWren.journal!.reports!.flatMap((r) => {
      const s = JSON.parse(r.snapshot);
      return [...s.ledger, ...(s.fairness?.lines ?? [])];
    }),
  ] as LedgerLine[];
  assert.deepEqual([...new Set(wrenLines.map((l) => l.purseId))], ["wren"]);
});

test("favour: the room and the device resolve the same way from campaign totals, once", async () => {
  const { dm } = await room();
  const claim = (purseId: string, choice: "need" | "greed", t: CloudTable) =>
    cmd({ kind: "loot-claim", holdingId: "potion", purseId, choice, before: readLootClaims(t).claims.find((c) => c.purseId === purseId)?.choice ?? null });
  let t = (await roomState(dm)).table;
  await send(dm, claim("aria", "need", t));
  t = (await roomState(dm)).table;
  await send(dm, claim("cass", "need", t));
  t = (await roomState(dm)).table;
  setSeat(DM_SEAT);
  await applyCloudTable(t);
  const lots = [{ holdingId: "potion", quantity: 3 }];
  const totals = fairnessStandings(t, "campaign");
  assert.deepEqual([totals.get("aria"), totals.get("cass")], [140, 140]);
  const resolve = cmd({
    kind: "loot-resolve",
    method: "round-robin",
    lots,
    favour: { basis: "campaign" },
    expect: lootFingerprint(t, lots, "round-robin", { basis: "campaign", totals }),
  });
  await submitCommands({ ...dm, batchId: "favour", commands: [resolve] });
  await submitCommands({ ...dm, batchId: "favour-retry", commands: [resolve] });
  await executeLocalCommand(resolve);
  await executeLocalCommand(resolve);
  const shared = (await roomState(dm)).table;
  const device = await economySnapshot();
  const outcome = (x: CloudTable) => ({
    awards: x.ledger.filter((l) => l.loot?.id === resolve.id).map((l) => [l.purseId, l.loot!.quantity]).sort(),
    favour: x.journal!.events.find((e) => e.lootFavour)?.lootFavour,
  });
  assert.deepEqual(outcome(device), outcome(shared));
  // Equal totals keep name order (Aria), then Cass is behind by 50 cp, then Aria and Cass tie again.
  assert.deepEqual(outcome(shared).awards, [["aria", 2], ["cass", 1]]);
  assert.equal(shared.ledger.filter((l) => l.loot?.id === resolve.id).length, 2, "applied once despite the retry");
  assert.equal(outcome(shared).favour!.basis, "campaign");
});
