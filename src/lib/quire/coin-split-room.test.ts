// Even coin split in shared rooms and on the device: idempotent retries, server-side
// permission refusals, shared/offline differential parity and the player projection.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  openRoom,
  joinRoom,
  roomState,
  submitCommands,
  choosePace,
  manageRoom,
  type RoomView,
} from "./cloud.server.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { applyCommand } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { toCopper } from "./money.ts";
import { planCoinSplit, type CoinSplitInput } from "./coin-split.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { projectRecord } from "./session-records.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import type { Purse } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql", "0029_campaign_room_report_parts.sql", "0003_accounts.sql", "0008_encounters.sql"])
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

const coins = (c: Partial<Purse["coins"]>) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ pp: 2, gp: 47, ep: 3, sp: 18, cp: 9 }) },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 25, cp: 1 }) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 12, sp: 4 }) },
      { id: "cass", name: "Cass of the Reeds", kind: "character", coins: coins({ gp: 8, sp: 7, cp: 2 }) },
      { id: "dunstan", name: "Dunstan the porter", kind: "character", control: "npc", coins: coins({ gp: 1 }) },
      { id: "mirelle", name: "Mirelle", kind: "character", coins: coins({ gp: 4 }) },
    ],
    ledger: [
      { id: "legacy-line", at: 1, purseId: "aria", shopId: null, summary: "Old purchase", copper: -10, transactionType: "purchase" },
    ],
    notes: [{ id: "old-note", at: 1, from: "dm", to: "party", purseId: "aria", text: "Welcome." }],
    journal: readJournal({
      world: {
        characterPositions: [
          { purseId: "mirelle", inParty: false, locationId: null, visible: true, sheetVisible: true },
        ],
      },
    }),
  };
}
const party = ["aria", "bram", "cass"];
function command(t: CloudTable, id: string, input: CoinSplitInput, actor: "dm" | "player" = "dm", makeDefault?: boolean) {
  const plan = planCoinSplit(t, input, { actor });
  return {
    id,
    kind: "coin-split" as const,
    sourceId: input.sourceId!,
    copper: input.copper,
    recipientIds: input.recipientIds,
    remainder: { rule: input.rule, ...(input.purseId ? { purseId: input.purseId } : {}) },
    expect: { share: plan.share, remainderTo: plan.remainderTo },
    ...(makeDefault ? { makeDefault } : {}),
  };
}
async function room() {
  const dm = await openRoom({ name: "Split DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" });
  const mirelle = await joinRoom({ code: dm.code, purseId: "mirelle", name: "Mirelle" });
  await choosePace({ ...dm, live: true });
  return { dm, aria, bram, mirelle };
}
/** What a split may change, without wall-clock timestamps. */
function outcome(t: CloudTable) {
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => x.id.localeCompare(y.id));
  return {
    purses: byId(t.purses).map((p) => ({ id: p.id, coins: p.coins })),
    ledger: byId(t.ledger).map((l) => ({ ...l, at: 0 })),
    notes: byId(t.notes).map((n) => ({ ...n, at: 0 })),
    events: (t.journal?.events ?? []).map(({ at: _at, id: _id, ...e }) => e),
    coinSplit: t.journal?.coinSplit ?? null,
  };
}

test("shared split: a retried command ID (lost response) is applied once", async () => {
  const { dm } = await room();
  const host = (await roomState(dm)).table;
  const split = command(host, "split-retry", { sourceId: "hoard", copper: 7039, recipientIds: party, rule: "party-fund" });
  await submitCommands({ ...dm, batchId: "split-first", commands: [split] });
  const once = (await roomState(dm)).table;
  await submitCommands({ ...dm, batchId: "split-lost-response-retry", commands: [split] });
  const twice = (await roomState(dm)).table;
  assert.deepEqual(outcome(twice), outcome(once));
  assert.equal(toCopper(twice.purses.find((p) => p.id === "hoard")!.coins), 7039 - 3 * 2346);
  assert.equal(twice.ledger.filter((l) => l.split?.id === "split-retry").length, 4);
});

test("shared split: the server refuses a player without the fund, a guest seat and a player naming an NPC", async () => {
  const { dm, aria, bram } = await room();
  const host = (await roomState(dm)).table;
  const fund = command(host, "forged-fund", { sourceId: "hoard", copper: 7039, recipientIds: party, rule: "party-fund" });
  await assert.rejects(
    submitCommands({ code: dm.code, token: aria.token, batchId: "forged-fund", commands: [fund] }),
    /permission to spend from this account/,
  );
  // Bram's guest seat cannot spend Aria's purse.
  const other = command(host, "forged-other", { sourceId: "aria", copper: 2501, recipientIds: party, rule: "party-fund" });
  await assert.rejects(
    submitCommands({ code: dm.code, token: bram.token, batchId: "forged-other", commands: [other] }),
    /permission to spend/,
  );
  // An NPC recipient is DM-only, even for a player with "Allow party fund".
  await manageRoom({ ...dm, action: "permission", seatId: aria.seatId, allowParty: true });
  const npc = { ...command(host, "forged-npc", { sourceId: "hoard", copper: 7039, recipientIds: party, rule: "party-fund" }), recipientIds: [...party, "dunstan"] };
  await assert.rejects(
    submitCommands({ code: dm.code, token: aria.token, batchId: "forged-npc", commands: [npc] }),
    /Only the DM can include NPCs/,
  );
  const after = (await roomState(dm)).table;
  assert.deepEqual(outcome(after).purses, outcome(host).purses);
  // With the permission, the player may split the fund among party players.
  await submitCommands({ code: dm.code, token: aria.token, batchId: "allowed", commands: [fund] });
  assert.equal(toCopper((await roomState(dm)).table.purses.find((p) => p.id === "hoard")!.coins), 7039 - 3 * 2346);
});

test("differential: the device engine writes exactly what the shared room writes", async () => {
  const { dm } = await room();
  const host = (await roomState(dm)).table;
  const cases: Array<[string, CoinSplitInput, boolean?]> = [
    ["fund", { sourceId: "hoard", copper: 3001, recipientIds: party, rule: "party-fund" }],
    ["own purse", { sourceId: "aria", copper: 2501, recipientIds: party, rule: "party-fund" }],
    ["rotate default", { sourceId: "hoard", copper: 1000, recipientIds: party, rule: "rotate" }, true],
    ["npc", { sourceId: "hoard", copper: 500, recipientIds: [...party, "dunstan"], rule: "recipient", purseId: "dunstan" }],
  ];
  setSeat(DM_SEAT);
  await applyCloudTable(host);
  for (const [name, input, makeDefault] of cases) {
    const shared = (await roomState(dm)).table;
    const split = command(shared, `diff-${name.replace(/\W+/g, "-")}`, input, "dm", makeDefault);
    await submitCommands({ ...dm, batchId: split.id, commands: [split] });
    await executeLocalCommand(split);
    const room = outcome((await roomState(dm)).table);
    const device = outcome(await economySnapshot());
    assert.deepEqual(device.purses, room.purses, name);
    assert.deepEqual(device.ledger, room.ledger, name);
    assert.deepEqual(device.notes, room.notes, name);
    assert.deepEqual(device.events, room.events, name);
    assert.deepEqual(device.coinSplit, room.coinSplit, name);
  }
  // The same refusal text on both paths.
  const shared = (await roomState(dm)).table;
  const tooMuch = command(shared, "diff-too-much", { sourceId: "hoard", copper: 10_000_000, recipientIds: party, rule: "party-fund" });
  const roomError = await submitCommands({ ...dm, batchId: "too-much", commands: [tooMuch] }).catch((e: Error) => e.message);
  const deviceError = await executeLocalCommand(tooMuch).catch((e: Error) => e.message);
  assert.match(String(roomError), /holds only/);
  assert.equal(deviceError, roomError);
});

test("offline split retried with the same command ID is applied once", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const split = command(campaign(), "offline-retry", { sourceId: "hoard", copper: 7039, recipientIds: party, rule: "party-fund" });
  await executeLocalCommand(split);
  const once = outcome(await economySnapshot());
  await executeLocalCommand(split);
  assert.deepEqual(outcome(await economySnapshot()), once);
  assert.equal(once.ledger.filter((l) => l.split?.id === "offline-retry").length, 4);
  // The legacy line and note are untouched.
  assert.ok(once.ledger.some((l) => l.id === "legacy-line" && l.copper === -10));
  assert.ok(once.notes.some((n) => n.id === "old-note"));
});

test("projection: party members see every party share and the fund debit, never NPC shares; non-party players see only their own", async () => {
  const { dm, aria, mirelle } = await room();
  const host = (await roomState(dm)).table;
  await submitCommands({
    ...dm,
    batchId: "visible-split",
    commands: [command(host, "visible-split", { sourceId: "hoard", copper: 4000, recipientIds: party, rule: "party-fund" })],
  });
  const withNpc = (await roomState(dm)).table;
  await submitCommands({
    ...dm,
    batchId: "npc-split",
    commands: [command(withNpc, "npc-split", { sourceId: "hoard", copper: 400, recipientIds: [...party, "dunstan"], rule: "rotate" })],
  });
  const dmView = (await roomState(dm)).table;
  assert.equal(dmView.journal!.coinSplit?.rotation?.lastPurseId, undefined); // 400 / 4 leaves nothing to rotate
  assert.ok(dmView.ledger.some((l) => l.id.startsWith("npc-split-share") && l.purseId === "dunstan"));

  const ariaView: RoomView = await roomState({ code: dm.code, token: aria.token });
  const lines = (id: string) => ariaView.table.ledger.filter((l) => l.split?.id === id);
  // The fund debit and all three party shares of each split; never Dunstan's.
  assert.deepEqual(lines("visible-split").map((l) => l.purseId).sort(), ["aria", "bram", "cass", "hoard"]);
  assert.deepEqual(lines("npc-split").map((l) => l.purseId).sort(), ["aria", "bram", "cass", "hoard"]);
  assert.equal(ariaView.table.ledger.some((l) => l.purseId === "dunstan"), false);
  assert.equal(lines("npc-split").find((l) => l.purseId === "hoard")!.summary, "Coin split");
  // The party fund is named for party members; its balance follows the party-balance rule.
  assert.equal(ariaView.table.purses.find((p) => p.id === "hoard")?.name, "The Hoard");
  // The NPC split's event, receipt and chat note are DM-only.
  assert.equal(JSON.stringify(ariaView.table.journal?.events ?? []).includes("npc-split"), false);
  assert.equal(ariaView.table.notes.some((n) => n.id === "npc-split-note"), false);
  assert.ok(ariaView.table.notes.some((n) => n.id === "visible-split-note"));
  assert.equal(ariaView.table.ledger.filter((l) => l.split).some((l) => l.purseId === "dunstan"), false);

  // Mirelle is away from the party: only her own lines, and no party balances.
  const mirelleView = await roomState({ code: dm.code, token: mirelle.token });
  assert.equal(mirelleView.table.ledger.some((l) => l.split), false);
  assert.equal(mirelleView.table.purses.some((p) => p.id === "hoard" && toCopper(p.coins) > 0), false);
});

test("projection: a rotation pointer naming an NPC is replaced so a player's preview still matches the server", async () => {
  const t = campaign();
  t.purses.splice(2, 0, { id: "npc-mid", name: "Hidden helper", kind: "character", control: "npc", coins: coins({}) });
  // Party order: hoard, aria, npc-mid, bram, cass, dunstan, mirelle.
  t.journal!.coinSplit = { rotation: { lastPurseId: "npc-mid" } };
  const seat = { role: "player" as const, purseIds: ["aria"] };
  const projected = projectRecord(t, seat, { directory: true });
  assert.equal(JSON.stringify(projected.journal?.coinSplit).includes("npc-mid"), false);
  assert.deepEqual(projected.journal?.coinSplit, { partyFundId: "hoard", rotation: { lastPurseId: "aria" } });
  const input: CoinSplitInput = { sourceId: "aria", copper: 2501, recipientIds: party, rule: "rotate" };
  assert.equal(
    planCoinSplit(projected, input, { actor: "player", projected: true }).remainderTo,
    planCoinSplit(t, input, { actor: "player" }).remainderTo,
  );
  // A player away from the party still plans the same party-fund leftover, without the fund's name.
  const away = projectRecord(t, { role: "player", purseIds: ["mirelle"] }, { directory: true });
  assert.equal(away.purses.some((p) => p.id === "hoard"), false);
  assert.equal(
    planCoinSplit(away, { sourceId: "mirelle", copper: 301, recipientIds: ["aria", "bram"], rule: "party-fund" }, { actor: "player", projected: true }).remainderTo,
    "hoard",
  );
  // The client's pending-turn preview (cloud-client.ts) runs the engine on that projection.
  const pending = command(t, "away-split", { sourceId: "mirelle", copper: 301, recipientIds: ["aria", "bram"], rule: "party-fund" }, "player");
  const seatAway = { id: "s", token: "", name: "Mirelle", role: "player" as const, purseIds: ["mirelle"] };
  assert.doesNotThrow(() => applyCommand(away, seatAway, pending, { preview: true }));
  assert.doesNotThrow(() => applyCommand(t, seatAway, pending));
});
