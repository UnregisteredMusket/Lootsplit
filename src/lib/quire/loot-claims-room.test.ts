// Treasure pool and item claims in shared rooms and on the device: exactly-once resolution on
// retry, claims outside the turn, the manual-roll policy, server-side refusals, shared/offline
// differential parity and the player projection (party member, player away, DM).
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace, manageRoom } from "./cloud.server.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { type Command } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { lootFingerprint, readLootClaims } from "./loot-claims.ts";
import type { LootChoice } from "./loot-claims-schema.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand, saveHolding } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import type { Holding, Purse } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql", "0029_campaign_room_report_parts.sql", "0003_accounts.sql", "0007_character_play.sql", "0008_encounters.sql"])
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

const coins = () => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
const lot = (id: string, name: string, quantity: number, unitCopper: number): Holding => ({
  id,
  purseId: "hoard",
  name,
  kind: "item",
  quantity,
  unitCopper,
  notes: "",
  pool: { at: 1, source: "add-loot" },
});
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: { ...coins(), gp: 40 } },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins() },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins() },
      { id: "cass", name: "Cass of the Reeds", kind: "character", coins: coins() },
      { id: "dunstan", name: "Dunstan the porter", kind: "character", control: "npc", coins: coins() },
      { id: "mirelle", name: "Mirelle", kind: "character", coins: coins() },
    ],
    holdings: [
      lot("potion", "Potion of healing", 2, 5000),
      lot("scroll", "Spell scroll (Shield)", 1, 2500),
      lot("sword", "+1 Longsword", 1, 50000),
      lot("shortsword", "Rusted shortsword", 3, 1000),
      { id: "rope", purseId: "hoard", name: "Rope", kind: "item", quantity: 1, unitCopper: 100, notes: "" },
    ],
    journal: readJournal({
      world: {
        characterPositions: [{ purseId: "mirelle", inParty: false, locationId: null, visible: true, sheetVisible: true }],
      },
    }),
  };
}
type Seat = { code: string; token: string };
async function room(live = true) {
  const dm = await openRoom({ name: "Pool DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" });
  const mirelle = await joinRoom({ code: dm.code, purseId: "mirelle", name: "Mirelle" });
  if (live) await choosePace({ ...dm, live: true });
  return { dm, aria: { code: dm.code, token: aria.token, seatId: aria.seatId }, bram: { code: dm.code, token: bram.token }, mirelle: { code: dm.code, token: mirelle.token } };
}
const claimCmd = (t: CloudTable, id: string, holdingId: string, purseId: string, choice: LootChoice) => ({
  id,
  kind: "loot-claim" as const,
  holdingId,
  purseId,
  choice,
  before: readLootClaims(t).claims.find((c) => c.holdingId === holdingId && c.purseId === purseId)?.choice ?? null,
});
const send = (seat: Seat, ...commands: Command[]) => submitCommands({ ...seat, batchId: commands[0]!.id + "-batch", commands });
function resolveCmd(t: CloudTable, id: string, input: Omit<Extract<Command, { kind: "loot-resolve" }>, "kind" | "id" | "expect">) {
  return { id, kind: "loot-resolve" as const, ...input, expect: lootFingerprint(t, input.lots, input.method) };
}
/** What claims and resolutions may change, without wall-clock timestamps. */
function outcome(t: CloudTable) {
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => x.id.localeCompare(y.id));
  return {
    purses: byId(t.purses).map((p) => ({ id: p.id, coins: p.coins })),
    holdings: byId(t.holdings).map((h) => ({ ...h, ...(h.pool ? { pool: { ...h.pool, at: 0 } } : {}) })),
    ledger: byId(t.ledger).map((l) => ({ ...l, at: 0 })),
    notes: byId(t.notes).map((n) => ({ ...n, at: 0 })),
    events: (t.journal?.events ?? []).map(({ at: _at, id: _id, ...e }) => ({
      ...e,
      ...(e.lootResolution
        ? { lootResolution: { ...e.lootResolution, lots: e.lootResolution.lots.map((l) => ({ ...l, claims: l.claims.map((c) => ({ ...c, at: 0 })) })) } }
        : {}),
    })),
    claims: readLootClaims(t).claims.map((c) => ({ ...c, at: 0 })),
    rotation: readLootClaims(t).rotation ?? null,
  };
}

test("shared: a retried resolution (lost response) moves items once; a new ID after it is refused", async () => {
  const { dm, aria, bram } = await room();
  let t = (await roomState(dm)).table;
  await send(aria, claimCmd(t, "a1", "potion", "aria", "need"));
  t = (await roomState(dm)).table;
  await send(bram, claimCmd(t, "b1", "potion", "bram", "need"));
  t = (await roomState(dm)).table;
  const resolve = resolveCmd(t, "res-retry", { method: "round-robin", lots: [{ holdingId: "potion", quantity: 2 }] });
  await submitCommands({ ...dm, batchId: "first", commands: [resolve] });
  const once = (await roomState(dm)).table;
  await submitCommands({ ...dm, batchId: "lost-response-retry", commands: [resolve] });
  const twice = (await roomState(dm)).table;
  assert.deepEqual(outcome(twice), outcome(once));
  assert.equal(twice.holdings.filter((h) => h.id.startsWith("res-retry-")).length, 2);
  assert.equal(twice.ledger.filter((l) => l.loot?.id === "res-retry").length, 2);
  assert.equal(twice.holdings.some((h) => h.id === "potion"), false);
  await assert.rejects(
    submitCommands({ ...dm, batchId: "again", commands: [{ ...resolve, id: "res-again" }] }),
    /no longer in the treasure pool|Claims changed/,
  );
});

test("shared: claims move nothing and may be sent outside the turn; staging them or a resolution is refused", async () => {
  const { dm, aria } = await room(false);
  const before = (await roomState(dm)).table;
  // Turn-based: the DM holds the turn, yet Aria's claim is accepted.
  await send(aria, claimCmd(before, "out-of-turn", "sword", "aria", "greed"));
  const after = (await roomState(dm)).table;
  assert.deepEqual(after.holdings, before.holdings);
  assert.deepEqual(after.purses, before.purses);
  assert.deepEqual(after.ledger, before.ledger);
  assert.deepEqual(readLootClaims(after).claims.map((c) => [c.purseId, c.choice]), [["aria", "greed"]]);
  // Other actions still wait for the turn.
  await assert.rejects(
    send(aria, { id: "give", kind: "give", fromId: "aria", toId: "bram", copper: 0, holdingId: null, quantity: 1 } as Command),
    /not your turn/,
  );
  await assert.rejects(
    submitCommands({ ...aria, batchId: "staged", stage: true, commands: [claimCmd(after, "staged", "sword", "aria", "need")] }),
    /sent to the room directly/,
  );
});

test("shared: the server refuses claims for others, guests, NPCs and players away; and player resolutions", async () => {
  const { dm, aria, mirelle } = await room();
  const t = (await roomState(dm)).table;
  await assert.rejects(send(aria, claimCmd(t, "x1", "sword", "bram", "need")), /only claim for your own characters/);
  await assert.rejects(send(mirelle, claimCmd(t, "x2", "sword", "mirelle", "need")), /not travelling with the party/);
  await assert.rejects(send(dm, claimCmd(t, "x3", "sword", "dunstan", "need")), /Only party player characters claim/);
  await assert.rejects(send(aria, claimCmd(t, "x4", "rope", "aria", "need")), /took it out of the treasure pool/);
  await send(aria, claimCmd(t, "ok", "sword", "aria", "need"));
  const marked = (await roomState(dm)).table;
  await assert.rejects(
    send(aria, resolveCmd(marked, "x5", { method: "round-robin", lots: [{ holdingId: "sword", quantity: 1 }] })),
    /Only the DM/,
  );
  await assert.rejects(send(aria, { id: "x6", kind: "loot-pool-set", holdingId: "rope", pooled: true }), /Only the DM/);
});

test("shared: Give, sell and listing a pooled item are refused even with Allow party fund", async () => {
  const { dm, aria } = await room();
  await manageRoom({ ...dm, action: "permission", seatId: aria.seatId, allowParty: true });
  await assert.rejects(
    send(aria, { id: "g1", kind: "give", fromId: "hoard", toId: "aria", copper: 0, holdingId: "potion", quantity: 1 } as Command),
    /in the treasure pool/,
  );
  await assert.rejects(
    send(dm, { id: "g2", kind: "give", fromId: "hoard", toId: "aria", copper: 0, holdingId: "potion", quantity: 1 } as Command),
    /in the treasure pool/,
  );
  // A non-pooled fund item still moves as before.
  await send(aria, { id: "g3", kind: "give", fromId: "hoard", toId: "aria", copper: 0, holdingId: "rope", quantity: 1 } as Command);
  assert.equal((await roomState(dm)).table.holdings.find((h) => h.id === "g3-item")?.purseId, "aria");
});

test("shared: Pen & Paper totals follow the campaign's manual-roll policy", async () => {
  const { dm, aria, bram } = await room();
  let t = (await roomState(dm)).table;
  await send(aria, claimCmd(t, "pa", "scroll", "aria", "need"));
  t = (await roomState(dm)).table;
  await send(bram, claimCmd(t, "pb", "scroll", "bram", "need"));
  t = (await roomState(dm)).table;
  const manual = resolveCmd(t, "pp", {
    method: "random",
    lots: [{ holdingId: "scroll", quantity: 1 }],
    rolls: "manual",
    manualRolls: [
      { holdingId: "scroll", purseId: "aria", d100: [64] },
      { holdingId: "scroll", purseId: "bram", d100: [87] },
    ],
  });
  await assert.rejects(send(dm, manual), /disabled manual rolls/);
  sql.prepare("INSERT INTO play_policies(code,manual_allowed,updated_at) VALUES (?,1,0)").run(dm.code);
  await send(dm, manual);
  const after = (await roomState(dm)).table;
  assert.equal(after.holdings.find((h) => h.id === "pp-0-0")?.purseId, "bram");
  assert.deepEqual(after.journal!.events.find((e) => e.lootResolution)!.lootResolution!.lots[0]!.rolls, [
    { purseId: "aria", d100: [64] },
    { purseId: "bram", d100: [87] },
  ]);
  // Server rolls: the room rolls d100s and records them.
  const t2 = (await roomState(dm)).table;
  await send(aria, claimCmd(t2, "sa", "shortsword", "aria", "greed"));
  const t3 = (await roomState(dm)).table;
  await send(bram, claimCmd(t3, "sb", "shortsword", "bram", "greed"));
  const t4 = (await roomState(dm)).table;
  await send(dm, resolveCmd(t4, "srv", { method: "random", lots: [{ holdingId: "shortsword", quantity: 3 }], rolls: "server" }));
  const receipt = (await roomState(dm)).table.journal!.events.find((e) => e.lootResolution?.id === "srv")!.lootResolution!;
  assert.equal(receipt.rolls, "server");
  assert.deepEqual(receipt.lots[0]!.awards.map((a) => a.quantity).sort(), [1, 2]);
  assert.ok(receipt.lots[0]!.rolls.every((r) => r.d100.every((v) => v >= 1 && v <= 100)));
});

test("differential: the device engine writes exactly what the shared room writes", async () => {
  const { dm } = await room();
  sql.prepare("INSERT OR REPLACE INTO play_policies(code,manual_allowed,updated_at) VALUES (?,1,0)").run(dm.code);
  setSeat(DM_SEAT);
  await applyCloudTable((await roomState(dm)).table);
  const steps: Array<(t: CloudTable) => Command> = [
    (t) => claimCmd(t, "d-a1", "potion", "aria", "need"),
    (t) => claimCmd(t, "d-c1", "potion", "cass", "need"),
    (t) => claimCmd(t, "d-b1", "potion", "bram", "greed"),
    (t) => claimCmd(t, "d-b2", "sword", "bram", "need"),
    (t) => claimCmd(t, "d-a2", "sword", "aria", "greed"),
    (t) => claimCmd(t, "d-a3", "scroll", "aria", "need"),
    (t) => claimCmd(t, "d-c3", "scroll", "cass", "need"),
    (t) => claimCmd(t, "d-a1b", "potion", "aria", "pass"),
    () => ({ id: "d-pool", kind: "loot-pool-set", holdingId: "rope", pooled: true }),
    (t) => resolveCmd(t, "d-rr", { method: "round-robin", lots: [{ holdingId: "potion", quantity: 2 }, { holdingId: "sword", quantity: 1 }] }),
    (t) =>
      resolveCmd(t, "d-pp", {
        method: "random",
        lots: [{ holdingId: "scroll", quantity: 1 }],
        rolls: "manual",
        manualRolls: [
          { holdingId: "scroll", purseId: "aria", d100: [55, 12] },
          { holdingId: "scroll", purseId: "cass", d100: [55, 70] },
        ],
      }),
    (t) => resolveCmd(t, "d-man", { method: "manual", lots: [{ holdingId: "shortsword", quantity: 3, awards: [{ purseId: "dunstan", quantity: 1 }, { purseId: "aria", quantity: 2 }] }] }),
    () => ({ id: "d-out", kind: "loot-pool-set", holdingId: "rope", pooled: false }),
  ];
  for (const step of steps) {
    const command = step((await roomState(dm)).table);
    await submitCommands({ ...dm, batchId: command.id, commands: [command] });
    await executeLocalCommand(command);
    const shared = outcome((await roomState(dm)).table);
    const device = outcome(await economySnapshot());
    assert.deepEqual(device, shared, command.id);
  }
  // The same refusal text on both paths.
  const t = (await roomState(dm)).table;
  const stale = { ...resolveCmd(t, "d-stale", { method: "round-robin", lots: [{ holdingId: "rope", quantity: 1 }] }), expect: "0000000000000000" };
  const roomError = await submitCommands({ ...dm, batchId: "stale", commands: [stale] }).catch((e: Error) => e.message);
  const deviceError = await executeLocalCommand(stale).catch((e: Error) => e.message);
  assert.match(String(roomError), /Claims changed. Nothing moved/);
  assert.equal(deviceError, roomError);
});

test("offline: a resolution retried with the same command ID is applied once; claims never move items", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  await executeLocalCommand(claimCmd(campaign(), "o-a", "sword", "aria", "need"));
  const marked = await economySnapshot();
  assert.deepEqual(outcome(marked).holdings, outcome(campaign()).holdings);
  assert.deepEqual(marked.ledger, []);
  const resolve = resolveCmd(marked, "o-res", { method: "round-robin", lots: [{ holdingId: "sword", quantity: 1 }] });
  await executeLocalCommand(resolve);
  const once = outcome(await economySnapshot());
  await executeLocalCommand(resolve);
  assert.deepEqual(outcome(await economySnapshot()), once);
  assert.equal(once.holdings.filter((h) => h.id.startsWith("o-res-")).length, 1);
});

test("projection: party members see the pool, every party claim and party lines; never NPC lines; players away see only their own", async () => {
  const { dm, aria, bram, mirelle } = await room();
  let t = (await roomState(dm)).table;
  await send(aria, claimCmd(t, "v-a", "shortsword", "aria", "greed"));
  t = (await roomState(dm)).table;
  await send(bram, claimCmd(t, "v-b", "shortsword", "bram", "greed"));
  t = (await roomState(dm)).table;
  await send(dm, claimCmd(t, "v-c", "sword", "cass", "need"));
  t = (await roomState(dm)).table;
  await send(
    dm,
    resolveCmd(t, "v-res", { method: "manual", lots: [{ holdingId: "shortsword", quantity: 3, awards: [{ purseId: "aria", quantity: 2 }, { purseId: "dunstan", quantity: 1 }] }] }),
  );
  const dmView = (await roomState(dm)).table;
  assert.ok(dmView.ledger.some((l) => l.loot?.id === "v-res" && l.purseId === "dunstan"));
  assert.equal(dmView.journal!.events.find((e) => e.lootResolution)!.lootResolution!.npc, true);

  const ariaView = (await roomState(aria)).table;
  // The pool: pooled fund lots, but not the non-pooled rope (no "Allow party fund").
  assert.deepEqual(ariaView.holdings.filter((h) => h.pool).map((h) => h.id).sort(), ["potion", "scroll", "sword"]);
  assert.equal(ariaView.holdings.some((h) => h.id === "rope"), false);
  // Every party claim, including Cass's (marked by the DM).
  assert.deepEqual(readLootClaims(ariaView).claims.map((c) => [c.purseId, c.choice]), [["cass", "need"]]);
  assert.ok(ariaView.journal!.events.some((e) => e.lootClaim?.purseId === "bram"));
  // The NPC's line and name stay DM-only: the receipt shows only party lines.
  const receipt = ariaView.journal!.events.find((e) => e.lootResolution)!;
  assert.equal(receipt.summary, "Treasure pool resolved");
  assert.equal(JSON.stringify(receipt).includes("dunstan"), false);
  assert.equal(receipt.lootResolution!.npc, undefined);
  assert.deepEqual(receipt.lootResolution!.lots[0]!.awards.map((a) => a.purseId), ["aria"]);
  assert.equal(ariaView.ledger.some((l) => l.purseId === "dunstan"), false);
  assert.equal(ariaView.notes.some((n) => n.id === "v-res-note"), false);

  // Mirelle is away: no pool, no other claims or events, no party lines.
  const away = (await roomState(mirelle)).table;
  assert.equal(away.holdings.some((h) => h.pool), false);
  assert.deepEqual(readLootClaims(away).claims, []);
  assert.equal((away.journal?.events ?? []).some((e) => e.lootClaim || e.lootResolution), false);
  assert.equal(away.ledger.some((l) => l.loot), false);
});

test("device: a player-only link is read-only; pooled items stay in their fund and cannot be moved or equipped", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const potion = (await economySnapshot()).holdings.find((h) => h.id === "potion")!;
  await assert.rejects(saveHolding({ ...potion, purseId: "aria" }), /in the treasure pool/);
  await assert.rejects(saveHolding({ ...potion, equipped: true }), /in the treasure pool/);
  // An edit keeps the marker even when the edit form omits it.
  const { pool: _pool, ...edited } = potion;
  await saveHolding({ ...edited, notes: "edited" });
  assert.ok((await economySnapshot()).holdings.find((h) => h.id === "potion")!.pool);
  // Add loot into a party fund may pool a new item; never into a character's purse.
  await saveHolding({ id: "new-loot", purseId: "hoard", name: "Gem", kind: "item", quantity: 1, unitCopper: 100, notes: "", pool: { at: 1, source: "add-loot" } });
  const events = (await economySnapshot()).journal!.events.filter((e) => e.lootPool);
  assert.deepEqual(events.map((e) => [e.lootPool!.holdingId, e.lootPool!.source]), [["new-loot", "add-loot"]]);
  await assert.rejects(
    saveHolding({ id: "bad-loot", purseId: "aria", name: "Gem", kind: "item", quantity: 1, unitCopper: 100, notes: "", pool: { at: 1, source: "add-loot" } }),
    /held by a party fund/,
  );
  // A player-only device link cannot claim or resolve.
  setSeat({ role: "player", purseIds: ["aria", "hoard"], shopIds: [], openedAt: 0 });
  await assert.rejects(executeLocalCommand(claimCmd(campaign(), "link", "sword", "aria", "need")), /read-only on a player link/);
  setSeat(DM_SEAT);
});
