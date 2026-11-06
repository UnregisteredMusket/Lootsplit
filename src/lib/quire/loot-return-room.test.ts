// Return to party (loot-return.ts): a departed character's items and coins go back to the party
// in one DM command, in shared rooms and on the device: the rules, copper conservation, claims,
// attunement, fairness, idempotent retries, server-side permissions, shared/offline parity,
// old-data readback and the player projection.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { validateEconomyRows } from "./validation.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { characterPosition } from "./character-position.ts";
import { projectRecord } from "./session-records.ts";
import { fairnessLedger, fairnessReceipts } from "./loot-fairness.ts";
import { readLootClaims } from "./loot-claims.ts";
import { departedSummary, returnFingerprint, returnableHoldings } from "./loot-return.ts";
import { toCopper } from "./money.ts";
import type { Coins, Holding } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of [
  "0001_campaign_rooms.sql",
  "0024_campaign_room_receipts.sql",
  "0026_campaign_room_sections.sql",
  "0029_campaign_room_report_parts.sql",
  "0030_campaign_room_archive_keys.sql",
  "0003_accounts.sql",
  "0008_encounters.sql",
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

const none = (): Coins => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
const REQ = "Requires attunement";
const item = (id: string, purseId: string, name: string, extra: Partial<Holding> = {}): Holding => ({
  id,
  purseId,
  name,
  kind: "item",
  quantity: 1,
  unitCopper: 5000,
  notes: "",
  ...extra,
});
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: { ...none(), gp: 1 } },
      { id: "chest", name: "Ship's Chest", kind: "party", coins: none() },
      { id: "aster", name: "Aster", kind: "character", coins: { ...none(), gp: 42, sp: 3, cp: 7 } },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: none() },
      { id: "cora", name: "Cora", kind: "character", coins: none() },
    ],
    holdings: [
      item("ring", "aster", "Ring of protection", { requiresAttunement: REQ, attuned: true, equipped: true }),
      item("arrows", "aster", "Arrows", { quantity: 20, unitCopper: 5 }),
      item("wand", "aster", "Wand of sparks", { uses: { current: 2, max: 7, whenEmpty: "keep" }, quantity: 2 }),
      item("cursed", "aster", "Cloak of the deceiver", {
        unitCopper: 90000,
        notes: "Cursed: the wearer cannot remove it.",
        unidentified: { name: "Grey cloak", value: 100 },
      }),
      item("stored", "aster", "Crate of tools"),
      item("house", "aster", "Townhouse", { kind: "property" }),
      item("gem", "hoard", "Ruby", { pool: { at: 1, source: "add-loot" } }),
      item("sword", "hoard", "Sword +1", { pool: { at: 1, source: "add-loot" } }),
    ],
    journal: readJournal({}),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const asterSeat: CloudSeat = { id: "a", token: "", name: "Aster", role: "player", purseIds: ["aster"] };
const bramSeat: CloudSeat = { id: "b", token: "", name: "Bram", role: "player", purseIds: ["bram"] };
const find = (t: CloudTable, id: string) => t.holdings.find((h) => h.id === id);
const purse = (t: CloudTable, id: string) => t.purses.find((p) => p.id === id)!;
const claim = (t: CloudTable, id: string, holdingId: string, purseId: string, choice: "need" | "greed" | "pass"): Command => ({
  id,
  kind: "loot-claim",
  holdingId,
  purseId,
  choice,
  before: readLootClaims(t).claims.find((c) => c.holdingId === holdingId && c.purseId === purseId)?.choice ?? null,
});
const leave = (t: CloudTable, id: string, purseId = "aster", visible = true): Command => {
  const p = purse(t, purseId);
  return {
    id,
    kind: "character-position",
    purseId,
    before: characterPosition(t, p),
    inParty: false,
    locationId: null,
    visible,
    sheetVisible: true,
  } as Command;
};
const giveBack = (
  t: CloudTable,
  id: string,
  items: Array<{ holdingId: string; quantity: number }>,
  copper: number,
  to = { fundId: "hoard", pool: true },
  purseId = "aster",
): Command => ({ id, kind: "loot-return", purseId, to, items, copper, expect: returnFingerprint(t, purseId, to.fundId) });

/** Aster claimed in the pool, then left the party. */
function departed(): CloudTable {
  let t = campaign();
  t = applyCommand(t, asterSeat, claim(t, "c1", "gem", "aster", "need"));
  t = applyCommand(t, asterSeat, claim(t, "c2", "sword", "aster", "greed"));
  t = applyCommand(t, bramSeat, claim(t, "c3", "gem", "bram", "greed"));
  return applyCommand(t, dmSeat, leave(t, "out"));
}

test("leaving today: taking a character out of the party moves nothing and keeps its claims stored", () => {
  const t = departed();
  assert.deepEqual(purse(t, "aster").coins, { ...none(), gp: 42, sp: 3, cp: 7 });
  assert.equal(t.holdings.filter((h) => h.purseId === "aster").length, 6);
  assert.equal(find(t, "ring")!.attuned, true);
  assert.equal(readLootClaims(t).claims.filter((c) => c.purseId === "aster").length, 2, "stored, ignored while away");
  assert.equal(departedSummary(t, purse(t, "aster")), "5 items and 42 gp, 3 sp, 7 cp");
  // Name order as the party knows them (the cursed cloak is "Grey cloak"); no property or stored goods.
  assert.deepEqual(returnableHoldings(t, "aster").map((h) => h.id), ["arrows", "stored", "cursed", "ring", "wand"]);
});

test("return to the pool: items arrive unclaimed, attunement ends, claims are withdrawn, everything is logged", () => {
  const t = departed();
  const before = t.ledger.length;
  const after = applyCommand(t, dmSeat, giveBack(t, "r1", [
    { holdingId: "ring", quantity: 1 },
    { holdingId: "arrows", quantity: 12 },
    { holdingId: "wand", quantity: 2 },
  ], 4200));
  // Items: new pool lots in The Hoard; the partial arrow stack stays with Aster.
  const ring = find(after, "r1-item-0")!;
  assert.equal(find(after, "ring"), undefined);
  assert.equal(ring.purseId, "hoard");
  assert.deepEqual(ring.pool, { at: ring.pool!.at, source: "dm", receiptId: "r1" });
  assert.equal(ring.attuned, undefined);
  assert.equal(ring.equipped, undefined);
  assert.equal(ring.requiresAttunement, REQ);
  assert.equal(find(after, "arrows")!.quantity, 8);
  assert.equal(find(after, "r1-item-1")!.quantity, 12);
  assert.deepEqual(find(after, "r1-item-2")!.uses, { current: 2, max: 7, whenEmpty: "keep" }, "a whole stack keeps its uses");
  assert.equal(readLootClaims(after).claims.some((c) => c.holdingId.startsWith("r1-")), false, "unclaimed");
  // Coins: 42 gp moved as the same coins; nothing created or lost.
  assert.deepEqual(purse(after, "aster").coins, { ...none(), sp: 3, cp: 7 });
  assert.deepEqual(purse(after, "hoard").coins, { ...none(), gp: 43 });
  const total = (x: CloudTable) => x.purses.reduce((s, p) => s + toCopper(p.coins), 0);
  assert.equal(total(after), total(t));
  // Ledger: one line per item on each side, naming the item; coins on both sides.
  const lines = after.ledger.slice(before);
  assert.deepEqual(
    lines.map((l) => [l.id, l.purseId, l.copper, l.summary]),
    [
      ["r1-out-0", "aster", 0, "Returned to the party: Ring of protection × 1 (to the treasure pool (The Hoard))"],
      ["r1-in-0", "hoard", 0, "Returned by Aster: Ring of protection × 1 (treasure pool)"],
      ["r1-out-1", "aster", 0, "Returned to the party: Arrows × 12 (to the treasure pool (The Hoard))"],
      ["r1-in-1", "hoard", 0, "Returned by Aster: Arrows × 12 (treasure pool)"],
      ["r1-out-2", "aster", 0, "Returned to the party: Wand of sparks × 2 (to the treasure pool (The Hoard))"],
      ["r1-in-2", "hoard", 0, "Returned by Aster: Wand of sparks × 2 (treasure pool)"],
      ["r1-coins-out", "aster", -4200, "Returned to the party: 42 gp (to The Hoard)"],
      ["r1-coins-in", "hoard", 4200, "Returned by Aster: 42 gp"],
    ],
  );
  assert.deepEqual(lines[1]!.loot, { id: "r1", holdingId: "r1-item-0", role: "added", quantity: 1, unitCopper: 5000 });
  // Claims: withdrawn with one event each; Bram's stays.
  const claims = readLootClaims(after).claims;
  assert.equal(claims.some((c) => c.purseId === "aster"), false);
  assert.equal(claims.filter((c) => c.purseId === "bram").length, 1);
  const events = after.journal!.events.filter((e) => e.id.startsWith("r1-"));
  const summaries = events.map((e) => e.summary);
  assert.ok(summaries.includes("Withdrawn: Aster's Need claim on Ruby (Aster left the party)."));
  assert.ok(summaries.includes("Withdrawn: Aster's Greed claim on Sword +1 (Aster left the party)."));
  assert.ok(summaries.includes("Aster returned to the party: 3 items (15 in all) and 42 gp to the treasure pool (The Hoard); 2 open claims withdrawn."));
  assert.equal(events.filter((e) => e.lootPool).length, 3);
  // Attunement ended through the existing path, with its one event.
  assert.deepEqual(
    events.filter((e) => e.summary.startsWith("Attunement ended")).map((e) => [e.summary, e.purseId]),
    [["Attunement ended: Ring of protection (Aster) left the character; attuned 0/3", "aster"]],
  );
  assert.match(after.notes.at(-1)!.text, /^3 items are back in the treasure pool from Aster\./);
  validateEconomyRows(after);
});

test("return to a party fund: items stay out of the pool; change is made with the exact-change rule", () => {
  const t = departed();
  const after = applyCommand(t, dmSeat, giveBack(t, "r2", [{ holdingId: "arrows", quantity: 20 }], 4231, { fundId: "chest", pool: false }));
  const arrows = find(after, "r2-item-0")!;
  assert.equal(arrows.purseId, "chest");
  assert.equal(arrows.pool, undefined);
  assert.equal(after.ledger.find((l) => l.id === "r2-in-0")!.loot, undefined);
  // 42 gp 3 sp 7 cp → 4231 cp leaves 6 cp: one sp is broken; the chest gets 4231 cp in coins.
  assert.equal(toCopper(purse(after, "aster").coins), 6);
  assert.equal(toCopper(purse(after, "chest").coins), 4231);
  assert.equal(after.notes.length, t.notes.length, "no pool note when nothing went to the pool");
});

test("copper conservation: awkward amounts never create or lose a copper", () => {
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  for (let i = 0; i < 200; i++) {
    const t = departed();
    purse(t, "aster").coins = { cp: rand(20), sp: rand(20), ep: rand(3), gp: rand(50), pp: rand(3) };
    purse(t, "hoard").coins = { cp: rand(5), sp: rand(5), ep: rand(2), gp: rand(5), pp: rand(2) };
    const held = toCopper(purse(t, "aster").coins);
    const copper = rand(held + 1);
    const fund = toCopper(purse(t, "hoard").coins);
    const after = applyCommand(t, dmSeat, giveBack(t, `cc${i}`, [], copper));
    assert.equal(toCopper(purse(after, "aster").coins), held - copper);
    assert.equal(toCopper(purse(after, "hoard").coins), fund + copper);
    for (const v of Object.values(purse(after, "aster").coins)) assert.ok(Number.isSafeInteger(v) && v >= 0);
  }
  const t = departed();
  purse(t, "aster").coins = { ...none(), gp: 1 };
  const one = applyCommand(t, dmSeat, giveBack(t, "one", [], 1));
  assert.equal(toCopper(purse(one, "aster").coins), 99);
  assert.equal(toCopper(purse(one, "hoard").coins), 101);
  assert.throws(() => applyCommand(t, dmSeat, giveBack(t, "x", [], 101)), /holds only 1 gp/);
});

test("refusals: only the DM, only a departed character, stale reviews, and items that cannot go back", () => {
  const t = departed();
  assert.throws(() => applyCommand(t, asterSeat, giveBack(t, "x1", [], 100)), /Only the DM/);
  const fresh = campaign();
  assert.throws(() => applyCommand(fresh, dmSeat, giveBack(fresh, "x2", [], 100)), /travelling with the party/);
  assert.throws(() => applyCommand(t, dmSeat, giveBack(t, "x3", [], 100, { fundId: "aster", pool: true })), /existing party fund/);
  assert.throws(() => applyCommand(t, dmSeat, giveBack(t, "x4", [], 100, undefined, "hoard")), /Only a character's/);
  assert.throws(() => applyCommand(t, dmSeat, { ...giveBack(t, "x5", [], 100), expect: "stale" } as Command), /changed\. Nothing moved/);
  assert.throws(() => applyCommand(t, dmSeat, giveBack(t, "x6", [{ holdingId: "house", quantity: 1 }], 0)), /not a physical item/);
  const reserved = structuredClone(t);
  find(reserved, "stored")!.reservedFor = "project-1";
  assert.throws(() => applyCommand(reserved, dmSeat, giveBack(reserved, "x7", [{ holdingId: "stored", quantity: 1 }], 0)), /Retrieve Crate of tools/);
  assert.throws(() => applyCommand(t, dmSeat, giveBack(t, "x8", [{ holdingId: "arrows", quantity: 21 }], 0)), /only 20 × Arrows/);
  assert.throws(() => applyCommand(t, dmSeat, giveBack(t, "x9", [{ holdingId: "gem", quantity: 1 }], 0)), /no longer with Aster/);
  assert.throws(
    () => applyCommand(t, dmSeat, giveBack(t, "x10", [{ holdingId: "arrows", quantity: 1 }, { holdingId: "arrows", quantity: 1 }], 0)),
    /once/,
  );
  // Nothing to do: no items, no coins and no claims.
  const empty = applyCommand(t, dmSeat, giveBack(t, "e1", returnableHoldings(t, "aster").map((h) => ({ holdingId: h.id, quantity: h.quantity })), toCopper(purse(t, "aster").coins)));
  assert.throws(() => applyCommand(empty, dmSeat, giveBack(empty, "e2", [], 0)), /Choose items or coins/);
  // A hidden character who is still in the party counts as inactive.
  const hiddenT = applyCommand(campaign(), dmSeat, { ...leave(campaign(), "h1"), inParty: true, visible: false } as Command);
  assert.doesNotThrow(() => applyCommand(hiddenT, dmSeat, giveBack(hiddenT, "h2", [], 100)));
});

test("atomic: one bad line refuses the whole return and nothing moves", () => {
  const t = departed();
  const snapshot = structuredClone(t);
  assert.throws(() =>
    applyCommand(t, dmSeat, giveBack(t, "bad", [{ holdingId: "arrows", quantity: 5 }, { holdingId: "house", quantity: 1 }], 4200)),
  );
  assert.deepEqual(t, snapshot);
});

test("fairness: a return does not change what the departed character received; it is listed as not counted", () => {
  const t = departed();
  // Aster received the ring earlier from a pool resolution; it counts for Aster.
  t.ledger.push({
    id: "earlier",
    at: 1,
    purseId: "aster",
    shopId: null,
    summary: "Treasure pool: Ring of protection × 1 (Need)",
    copper: 0,
    transactionType: "transfer",
    loot: { id: "res", holdingId: "ring", role: "award", choice: "need", quantity: 1, unitCopper: 5000 },
  });
  const dm = { dm: true, purseIds: [] };
  const received = (x: CloudTable) => [...fairnessLedger(x, dm).rows, ...fairnessLedger(x, dm).others].find((r) => r.purseId === "aster")!;
  const before = received(t);
  assert.equal(before.items, 5000);
  const after = applyCommand(t, dmSeat, giveBack(t, "f1", [{ holdingId: "ring", quantity: 1 }], 4200));
  assert.deepEqual(received(after), before, "Aster's received totals are unchanged");
  assert.deepEqual(
    fairnessLedger(after, dm).rows.map((r) => [r.purseId, r.total]),
    fairnessLedger(t, dm).rows.map((r) => [r.purseId, r.total]),
    "the party's comparison is unchanged",
  );
  const others = fairnessReceipts(after, dm, "aster").others!.filter((o) => o.lineId.startsWith("f1-"));
  assert.deepEqual(
    others.map((o) => [o.lineId, o.reason]),
    [
      ["f1-coins-out", "Returned to the party; it was counted when first received"],
      ["f1-out-0", "Returned to the party; it was counted when first received"],
    ],
    "the DM and Aster's player see each returned line as not counted",
  );
});

test("unidentified items keep their true record for the DM; the party sees the presented item in the pool", () => {
  const t = departed();
  const after = applyCommand(t, dmSeat, giveBack(t, "u1", [{ holdingId: "cursed", quantity: 1 }], 0));
  const lot = find(after, "u1-item-0")!;
  assert.equal(lot.name, "Cloak of the deceiver", "the DM's true record travels");
  assert.equal(lot.unidentified!.name, "Grey cloak");
  assert.equal(lot.unidentified!.value, 100);
  const written = JSON.stringify([after.ledger.filter((l) => l.id.startsWith("u1-")), after.journal!.events.filter((e) => e.id.startsWith("u1-")), after.notes.at(-1)]);
  assert.doesNotMatch(written, /deceiver|Cursed|90000/);
  assert.match(written, /Grey cloak/);
  assert.equal(after.ledger.find((l) => l.id === "u1-in-0")!.loot!.unitCopper, 100);
  const view = projectRecord(after, { role: "player", purseIds: ["bram"] });
  const seen = view.holdings.find((h) => h.id === "u1-item-0")!;
  assert.equal(seen.name, "Grey cloak");
  assert.doesNotMatch(JSON.stringify(view), /deceiver|Cursed/);
});

test("projection: party players see the pool lot and fund lines, not Aster's own lines, coins or withdrawn claims", () => {
  const t = departed();
  const after = applyCommand(t, dmSeat, giveBack(t, "p1", [{ holdingId: "arrows", quantity: 5 }], 4200));
  const view = projectRecord(after, { role: "player", purseIds: ["bram"] });
  assert.ok(view.holdings.some((h) => h.id === "p1-item-0" && h.pool), "the returned lot is in the pool");
  assert.equal(view.holdings.some((h) => h.purseId === "aster"), false);
  assert.equal(view.ledger.some((l) => l.purseId === "aster"), false, "Aster's ledger stays private");
  assert.equal(view.journal!.events.some((e) => /Withdrawn: Aster/.test(e.summary)), false);
  assert.deepEqual(view.purses.find((p) => p.id === "aster")?.coins ?? none(), none());
  // A hidden departed character is not named to the party.
  const hidden = applyCommand(campaign(), dmSeat, leave(campaign(), "out", "aster", false));
  const back = applyCommand(hidden, dmSeat, giveBack(hidden, "p2", [{ holdingId: "arrows", quantity: 5 }], 0));
  const hv = projectRecord(back, { role: "player", purseIds: ["bram"] });
  assert.ok(hv.holdings.some((h) => h.id === "p2-item-0"));
  assert.doesNotMatch(JSON.stringify({ l: hv.ledger, e: hv.journal!.events, n: hv.notes }), /Aster/);
  assert.equal(back.ledger.find((l) => l.id === "p2-in-0")!.summary, "Returned to the party: Arrows × 5 (treasure pool)");
  // An NPC companion who leaves is not named either (its holdings and balance are DM-only).
  const withNpc = campaign();
  withNpc.purses.push({ id: "mara", name: "Mara", kind: "character", control: "npc", coins: { ...none(), gp: 5 } });
  withNpc.holdings.push(item("lamp", "mara", "Lamp"));
  const npcAway = applyCommand(withNpc, dmSeat, leave(withNpc, "npc-out", "mara"));
  const npcBack = applyCommand(npcAway, dmSeat, giveBack(npcAway, "p3", [{ holdingId: "lamp", quantity: 1 }], 500, undefined, "mara"));
  const nv = projectRecord(npcBack, { role: "player", purseIds: ["bram"] });
  assert.ok(nv.holdings.some((h) => h.id === "p3-item-0"));
  assert.doesNotMatch(JSON.stringify({ l: nv.ledger, e: nv.journal!.events, n: nv.notes }), /Mara/);
});

test("old data: a campaign saved before this feature (no claims, no pool fields) returns and still loads", () => {
  const old: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: none() },
      { id: "aster", name: "Aster", kind: "character", coins: { ...none(), gp: 2 } },
    ],
    holdings: [item("rope", "aster", "Rope")],
    journal: readJournal({}),
  };
  validateEconomyRows(old);
  const away = applyCommand(old, dmSeat, leave(old, "away"));
  assert.equal(readJournal(structuredClone(old.journal)).lootClaims, undefined);
  const after = applyCommand(away, dmSeat, giveBack(away, "o1", [{ holdingId: "rope", quantity: 1 }], 200));
  assert.equal(find(after, "o1-item-0")!.purseId, "hoard");
  assert.equal(readJournal(after.journal).lootClaims, undefined, "no claim state is written when there were none");
  validateEconomyRows(after);
});

test("shared rooms: a retry applies once, the server refuses players, and other players see only the pool", async () => {
  const dm = await openRoom({ name: "Return DM", table: departed() });
  const aster = await joinRoom({ code: dm.code, purseId: "aster", name: "Aster" });
  const bram = await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" });
  const DT = { code: dm.code, token: dm.token };
  const AT = { code: dm.code, token: aster.token };
  const BT = { code: dm.code, token: bram.token };
  await choosePace({ ...DT, live: true });
  const state = async () => (await roomState(DT)).table;
  let table = await state();
  await assert.rejects(submitCommands({ ...AT, batchId: "room-x", commands: [giveBack(table, "room-x", [], 100)] }), /Only the DM/);
  const cmd = giveBack(table, "room-1", [{ holdingId: "ring", quantity: 1 }], 4200);
  await submitCommands({ ...DT, batchId: "room-1", commands: [cmd] });
  await submitCommands({ ...DT, batchId: "room-1", commands: [cmd] });
  table = await state();
  assert.equal(table.holdings.filter((h) => h.id.startsWith("room-1-item")).length, 1);
  assert.equal(table.ledger.filter((l) => l.id.startsWith("room-1-")).length, 4, "a retry changes nothing");
  assert.deepEqual(purse(table, "hoard").coins, { ...none(), gp: 43 });
  const bramView = (await roomState(BT)).table;
  assert.ok(bramView.holdings.some((h) => h.id === "room-1-item-0" && h.pool));
  assert.equal(bramView.ledger.some((l) => l.purseId === "aster"), false);
  assert.equal(bramView.journal!.events.some((e) => /Withdrawn/.test(e.summary)), false);
});

test("offline: the same commands give the same campaign, a retry applies once, and a player link is refused", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(departed());
  let shared = departed();
  const steps: Command[] = [];
  const step = (c: Command) => {
    steps.push(c);
    shared = applyCommand(shared, dmSeat, c);
  };
  step(giveBack(shared, "d1", [{ holdingId: "ring", quantity: 1 }, { holdingId: "arrows", quantity: 7 }], 4231));
  step(giveBack(shared, "d2", [{ holdingId: "wand", quantity: 1 }, { holdingId: "cursed", quantity: 1 }], 0, { fundId: "chest", pool: false }));
  for (const s of steps) await executeLocalCommand(s);
  const once = await economySnapshot();
  for (const s of steps) await executeLocalCommand(s);
  const twice = await economySnapshot();
  const byId = <R extends { id: string }>(rows: R[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  // The pool marker's time is when each engine ran; everything else must match exactly.
  const held = (rows: Holding[]) => byId(rows).map((h) => (h.pool ? { ...h, pool: { ...h.pool, at: 0 } } : h));
  assert.deepEqual(byId(twice.holdings), byId(once.holdings), "retries change nothing");
  assert.deepEqual(byId(twice.ledger), byId(once.ledger));
  assert.deepEqual(held(once.holdings), held(shared.holdings));
  assert.deepEqual(byId(once.purses), byId(shared.purses));
  const strip = (rows: CloudTable["ledger"]) => byId(rows).map(({ at: _at, ...l }) => l);
  assert.deepEqual(strip(once.ledger), strip(shared.ledger));
  const events = (t: { journal?: CloudTable["journal"] }) =>
    (t.journal?.events ?? []).filter((e) => /^d[12]-/.test(e.id)).map((e) => [e.id, e.summary, e.purseId]);
  assert.deepEqual(events(once), events(shared));
  const claimsOf = (x: { journal?: CloudTable["journal"] }) => readLootClaims(x as CloudTable).claims.map(({ at: _at, ...c }) => c);
  assert.deepEqual(claimsOf(once), claimsOf(shared));
  const stale = await executeLocalCommand({ ...steps[0]!, id: "d3" }).catch((e: Error) => e.message);
  assert.equal(stale, "Aster's items, coins or claims changed. Nothing moved. Review the return again.");
  const sharedError = (() => {
    try {
      applyCommand(shared, dmSeat, { ...steps[0]!, id: "d3" });
    } catch (e) {
      return (e as Error).message;
    }
  })();
  assert.equal(stale, sharedError, "the same error text");
  setSeat({ role: "player", purseIds: ["aster"], shopIds: [], openedAt: 0 });
  const link = await executeLocalCommand(giveBack(shared, "d4", [], 1)).catch((e: Error) => e.message);
  assert.match(String(link), /read-only on a player link/);
  setSeat(DM_SEAT);
});

test("protocol 27: an older client with a staged loot-return draft is asked to finish on the website", async () => {
  const { tabletopResponse, LOOT_RETURN_PROTOCOL, CURRENT_TABLETOP_PROTOCOL, MARKET_MARKUP_PROTOCOL } = await import("./tabletop-protocol.ts");
  assert.equal(LOOT_RETURN_PROTOCOL, 27);
  assert.ok(CURRENT_TABLETOP_PROTOCOL >= LOOT_RETURN_PROTOCOL);
  const table = emptyCloudTable();
  const draft = JSON.stringify([
    { id: "r1", kind: "loot-return", purseId: "aster", to: { fundId: "hoard", pool: true }, items: [], copper: 5, expect: "abc" },
  ]);
  for (const old of [0, 20, MARKET_MARKUP_PROTOCOL, 26])
    assert.throws(() => tabletopResponse({ table, draft }, old), /updated Lootsplitter client/, `protocol ${old}`);
  const current = tabletopResponse({ table, draft }, LOOT_RETURN_PROTOCOL);
  assert.equal(JSON.parse(current.draft)[0].kind, "loot-return");
  // Without the draft, older clients read the room as before.
  assert.equal(tabletopResponse({ table, draft: "[]" }, MARKET_MARKUP_PROTOCOL).table, table);
});
