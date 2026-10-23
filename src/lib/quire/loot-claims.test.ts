// Party treasure pool and item claims (prompt 2, phase 2): the planner (tiers, rolls, ties,
// stacks that go round again, round-robin pointer, unit conservation) and the authoritative
// engine (a claim never moves inventory, permissions, the pooled-item guard, stale previews).
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, type Command } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import {
  lootClaimants,
  lootFingerprint,
  planLootResolution,
  pooledLots,
  readLootClaims,
  type LootPlanInput,
} from "./loot-claims.ts";
import { POOL_GUARD } from "./custody.ts";
import type { Holding, Purse, Shop } from "./types.ts";
import type { LootChoice } from "./loot-claims-schema.ts";

const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const seat = (...purseIds: string[]): CloudSeat => ({ id: "p-" + purseIds.join(), token: "", name: "Player", role: "player", purseIds });
const coins = () => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
const character = (id: string, name: string, extra: Partial<Purse> = {}): Purse => ({ id, name, kind: "character", coins: coins(), ...extra });
const lot = (id: string, name: string, quantity: number, unitCopper: number, extra: Partial<Holding> = {}): Holding => ({
  id,
  purseId: "hoard",
  name,
  kind: "item",
  quantity,
  unitCopper,
  notes: "",
  pool: { at: 1, source: "add-loot" },
  ...extra,
});

function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: { ...coins(), gp: 10 } },
      character("aria", "Aria Thorne"),
      character("bram", "Bram Ironfoot"),
      character("cass", "Cass of the Reeds"),
      character("ambrose", "Brother Ambrose"),
      character("dunstan", "Dunstan the porter", { control: "npc" }),
      character("mirelle", "Mirelle"),
    ],
    holdings: [
      lot("potion", "Potion of healing", 2, 5000),
      lot("scroll", "Spell scroll (Shield)", 1, 2500),
      lot("sword", "+1 Longsword", 1, 50000),
      lot("shortsword", "Rusted shortsword", 3, 1000),
      lot("symbol", "Silver holy symbol", 1, 2500),
      { id: "rope", purseId: "hoard", name: "Rope", kind: "item", quantity: 1, unitCopper: 100, notes: "" },
      { id: "aria-dagger", purseId: "aria", name: "Dagger", kind: "item", quantity: 1, unitCopper: 200, notes: "" },
    ],
    journal: readJournal({
      world: {
        characterPositions: [{ purseId: "mirelle", inParty: false, locationId: null, visible: true, sheetVisible: true }],
      },
    }),
  };
}
type Resolve = Extract<Command, { kind: "loot-resolve" }>;
function claim(t: CloudTable, who: CloudSeat, holdingId: string, purseId: string, choice: LootChoice, id = `c-${holdingId}-${purseId}-${choice}`) {
  const before = readLootClaims(t).claims.find((c) => c.holdingId === holdingId && c.purseId === purseId)?.choice ?? null;
  return applyCommand(t, who, { id, kind: "loot-claim", holdingId, purseId, choice, before });
}
function marked(t: CloudTable, rows: Array<[string, string, LootChoice]>) {
  for (const [holdingId, purseId, choice] of rows) t = claim(t, dm, holdingId, purseId, choice);
  return t;
}
function resolve(t: CloudTable, input: Omit<Resolve, "kind" | "id" | "expect"> & { id?: string; expect?: string }, execution = {}) {
  return applyCommand(
    t,
    dm,
    { kind: "loot-resolve", id: input.id ?? "r1", ...input, expect: input.expect ?? lootFingerprint(t, input.lots, input.method) } as Resolve,
    execution,
  );
}
const scripted = (values: Record<string, number>) => ({
  source: "server" as const,
  random: (key: string) => {
    if (!(key in values)) throw Error("unexpected roll " + key);
    return values[key]!;
  },
});
const strip = (t: CloudTable) => ({ holdings: t.holdings, purses: t.purses, ledger: t.ledger, notes: t.notes });

test("claimants are visible party player characters only: no NPCs, nobody away from the party", () => {
  // Pool order is by name: Aria Thorne, Bram Ironfoot, Brother Ambrose, Cass of the Reeds.
  assert.deepEqual(lootClaimants(campaign()).map((p) => p.id), ["aria", "bram", "ambrose", "cass"]);
  assert.deepEqual(pooledLots(campaign()).map((h) => h.id), ["sword", "potion", "shortsword", "symbol", "scroll"]);
});

test("a claim never moves inventory, coins or ledger lines, and each change is a journal event", () => {
  let t = campaign();
  const before = strip(t);
  t = claim(t, seat("aria"), "potion", "aria", "need");
  t = claim(t, seat("aria"), "potion", "aria", "greed", "c2");
  t = claim(t, seat("bram"), "potion", "bram", "pass");
  t = claim(t, dm, "sword", "cass", "need");
  assert.deepEqual(strip(t), before);
  assert.deepEqual(
    readLootClaims(t).claims.map((c) => [c.holdingId, c.purseId, c.choice, c.by]),
    [["potion", "aria", "greed", "player"], ["potion", "bram", "pass", "player"], ["sword", "cass", "need", "dm"]],
  );
  const events = t.journal!.events.filter((e) => e.lootClaim);
  assert.equal(events.length, 4);
  assert.deepEqual(events[1]!.lootClaim, { holdingId: "potion", purseId: "aria", name: "Potion of healing", choice: "greed", previous: "need", by: "player" });
});

test("claims are refused for another seat's character, NPCs, characters away, a non-pooled lot and a stale form", () => {
  const t = campaign();
  assert.throws(() => claim(t, seat("aria"), "potion", "bram", "need"), /only claim for your own characters/);
  assert.throws(() => claim(t, dm, "potion", "dunstan", "need"), /Only party player characters claim/);
  assert.throws(() => claim(t, seat("mirelle"), "potion", "mirelle", "need"), /not travelling with the party/);
  assert.throws(() => claim(t, seat("aria"), "rope", "aria", "need"), /no longer in the treasure pool|took it out of the treasure pool/);
  const once = claim(t, seat("aria"), "potion", "aria", "need");
  assert.throws(
    () => applyCommand(once, seat("aria"), { id: "stale", kind: "loot-claim", holdingId: "potion", purseId: "aria", choice: "pass", before: null }),
    /changed on another device/,
  );
});

test("players cannot resolve or change the pool", () => {
  const t = marked(campaign(), [["potion", "aria", "need"]]);
  const lots = [{ holdingId: "potion", quantity: 2 }];
  assert.throws(
    () => applyCommand(t, seat("aria"), { id: "x", kind: "loot-resolve", method: "round-robin", lots, expect: lootFingerprint(t, lots, "round-robin") }),
    /Only the DM/,
  );
  assert.throws(() => applyCommand(t, seat("aria"), { id: "y", kind: "loot-pool-set", holdingId: "rope", pooled: true }), /Only the DM/);
});

test("random: the Need tier wins over Greed; units that cover the tier need no roll", () => {
  const t = marked(campaign(), [
    ["potion", "aria", "need"],
    ["potion", "cass", "need"],
    ["potion", "bram", "greed"],
  ]);
  const plan = planLootResolution(t, { method: "random", lots: [{ holdingId: "potion", quantity: 2 }] }, () => {
    throw Error("no roll expected");
  });
  assert.equal(plan.lots[0]!.tier, "need");
  assert.equal(plan.lots[0]!.needsRolls, false);
  assert.deepEqual(plan.lots[0]!.awards.map((a) => [a.purseId, a.quantity, a.choice]), [["aria", 1, "need"], ["cass", 1, "need"]]);
  assert.deepEqual(plan.lots[0]!.unmarked.sort(), ["ambrose"]);
});

test("random: a stack with more items than claimants goes round again, the extra to the higher roll", () => {
  const t = marked(campaign(), [
    ["shortsword", "bram", "greed"],
    ["shortsword", "cass", "greed"],
    ["shortsword", "aria", "pass"],
  ]);
  const roll = (_h: string, purseId: string) => (purseId === "bram" ? 71 : 40);
  const plan = planLootResolution(t, { method: "random", lots: [{ holdingId: "shortsword", quantity: 3 }] }, roll);
  assert.equal(plan.lots[0]!.tier, "greed");
  assert.deepEqual(plan.lots[0]!.awards.map((a) => [a.purseId, a.quantity]), [["bram", 2], ["cass", 1]]);
  assert.deepEqual(plan.lots[0]!.rolls, [{ purseId: "bram", d100: [71] }, { purseId: "cass", d100: [40] }]);
  // 7 among 3: two each, then the extra one to the top roll; nobody is left out.
  const seven = marked({ ...campaign(), holdings: [lot("arrows", "Arrows", 7, 5)] }, [
    ["arrows", "aria", "need"],
    ["arrows", "bram", "need"],
    ["arrows", "cass", "need"],
  ]);
  const p7 = planLootResolution(seven, { method: "random", lots: [{ holdingId: "arrows", quantity: 7 }] }, (_h, id) => ({ aria: 10, bram: 90, cass: 50 })[id]);
  assert.deepEqual(p7.lots[0]!.awards.map((a) => [a.purseId, a.quantity]), [["aria", 2], ["bram", 3], ["cass", 2]]);
  assert.equal(p7.moved + p7.lots[0]!.kept, 7);
});

test("random: ties re-roll among the tied characters only, and only when the tie decides something", () => {
  const t = marked(campaign(), [
    ["scroll", "aria", "need"],
    ["scroll", "cass", "need"],
    ["scroll", "bram", "need"],
  ]);
  const seq: Record<string, number[]> = { aria: [55, 20], cass: [55, 80], bram: [10] };
  const plan = planLootResolution(t, { method: "random", lots: [{ holdingId: "scroll", quantity: 1 }] }, (_h, id, round) => seq[id]![round - 1]);
  assert.deepEqual(plan.lots[0]!.awards.map((a) => a.purseId), ["cass"]);
  assert.deepEqual(Object.fromEntries(plan.lots[0]!.rolls.map((r) => [r.purseId, r.d100])), { aria: [55, 20], cass: [55, 80], bram: [10] });
  // A tie below the cut is not re-rolled.
  const below = planLootResolution(t, { method: "random", lots: [{ holdingId: "scroll", quantity: 1 }] }, (_h, id) => ({ aria: 90, cass: 5, bram: 5 })[id]);
  assert.deepEqual(below.lots[0]!.awards.map((a) => a.purseId), ["aria"]);
  assert.equal(below.lots[0]!.rolls.every((r) => r.d100.length === 1), true);
});

test("Pen & Paper: missing tie-breaks are reported, totals outside 1–100 are refused, policy is enforced", () => {
  const t = marked(campaign(), [
    ["scroll", "aria", "need"],
    ["scroll", "cass", "need"],
  ]);
  const lots = [{ holdingId: "scroll", quantity: 1 }];
  const tie = [
    { holdingId: "scroll", purseId: "aria", d100: [55] },
    { holdingId: "scroll", purseId: "cass", d100: [55] },
  ];
  assert.throws(() => resolve(t, { method: "random", lots, rolls: "manual", manualRolls: tie }, { manualRolls: true }), /including tie-breaks/);
  assert.throws(() => resolve(t, { method: "random", lots, rolls: "manual", manualRolls: tie }, {}), /disabled manual rolls/);
  assert.throws(() => planLootResolution(t, { method: "random", lots }, () => 101), /from 1 to 100/);
  const done = resolve(
    t,
    {
      method: "random",
      lots,
      rolls: "manual",
      manualRolls: [
        { holdingId: "scroll", purseId: "aria", d100: [55, 12] },
        { holdingId: "scroll", purseId: "cass", d100: [55, 70] },
      ],
    },
    { manualRolls: true },
  );
  assert.equal(done.holdings.find((h) => h.id === "r1-0-0")?.purseId, "cass");
  assert.equal(done.journal!.events.at(-1)!.lootResolution!.rolls, "manual");
});

test("round-robin: next in line after the pointer among the tier, wrapping, and the pointer moves", () => {
  let t = marked(campaign(), [
    ["potion", "aria", "need"],
    ["potion", "cass", "need"],
    ["scroll", "aria", "need"],
    ["scroll", "cass", "need"],
    ["sword", "bram", "need"],
    ["sword", "aria", "greed"],
    ["shortsword", "bram", "greed"],
    ["shortsword", "cass", "greed"],
  ]);
  t.journal!.lootClaims = { ...readLootClaims(t), rotation: { lastPurseId: "bram" } };
  const input: LootPlanInput = {
    method: "round-robin",
    lots: [
      { holdingId: "potion", quantity: 2 },
      { holdingId: "scroll", quantity: 1 },
      { holdingId: "sword", quantity: 1 },
      { holdingId: "shortsword", quantity: 3 },
    ],
  };
  const plan = planLootResolution(t, input);
  // Pool order is by name: Aria, Bram, Brother Ambrose, Cass.
  assert.deepEqual(plan.lots.map((l) => l.awards.map((a) => [a.purseId, a.quantity])), [
    [["aria", 1], ["cass", 1]],
    [["cass", 1]],
    [["bram", 1]],
    [["bram", 1], ["cass", 2]],
  ]);
  assert.equal(plan.rotationAfter, "cass");
  t = resolve(t, input);
  assert.equal(readLootClaims(t).rotation?.lastPurseId, "cass");
  // A pointer naming a character who left starts from the next name in order.
  const gone = marked(campaign(), [["symbol", "aria", "need"], ["symbol", "cass", "need"]]);
  gone.journal!.lootClaims = { ...readLootClaims(gone), rotation: { lastPurseId: "bram" } };
  gone.purses = gone.purses.filter((p) => p.id !== "bram");
  assert.equal(planLootResolution(gone, { method: "round-robin", lots: [{ holdingId: "symbol", quantity: 1 }] }).lots[0]!.awards[0]!.purseId, "aria");
  const missing = marked(campaign(), [["symbol", "aria", "need"], ["symbol", "cass", "need"]]);
  missing.journal!.lootClaims = { ...readLootClaims(missing), rotation: { lastPurseId: "nobody" } };
  assert.equal(planLootResolution(missing, { method: "round-robin", lots: [{ holdingId: "symbol", quantity: 1 }] }).lots[0]!.awards[0]!.purseId, "aria");
});

test("an assist refuses a lot with no Need or Greed; unmarked counts as Pass", () => {
  const t = marked(campaign(), [["symbol", "aria", "pass"]]);
  assert.throws(() => planLootResolution(t, { method: "round-robin", lots: [{ holdingId: "symbol", quantity: 1 }] }), /No claims on Silver holy symbol/);
});

test("resolve moves items atomically with new IDs from the command ID, 0 cp ledger lines, one receipt and a chat note", () => {
  const t = marked(campaign(), [
    ["shortsword", "bram", "greed"],
    ["shortsword", "cass", "greed"],
    ["potion", "aria", "need"],
  ]);
  const lots = [
    { holdingId: "shortsword", quantity: 3 },
    { holdingId: "potion", quantity: 1 },
  ];
  const after = resolve(t, { id: "res", method: "random", lots, rolls: "server" }, scripted({ "loot-shortsword-bram-1": 71, "loot-shortsword-cass-1": 40 }));
  assert.deepEqual(
    after.holdings.filter((h) => h.id.startsWith("res-")).map((h) => [h.id, h.purseId, h.name, h.quantity, h.pool]),
    [
      ["res-0-0", "bram", "Rusted shortsword", 2, undefined],
      ["res-0-1", "cass", "Rusted shortsword", 1, undefined],
      ["res-1-0", "aria", "Potion of healing", 1, undefined],
    ],
  );
  assert.equal(after.holdings.some((h) => h.id === "shortsword"), false);
  assert.equal(after.holdings.find((h) => h.id === "potion")?.quantity, 1);
  assert.ok(after.holdings.find((h) => h.id === "potion")?.pool, "the remaining potion stays pooled");
  const lines = after.ledger.filter((l) => l.loot?.id === "res");
  assert.deepEqual(lines.map((l) => [l.purseId, l.copper, l.transactionType, l.loot!.unitCopper, l.loot!.quantity, l.loot!.choice]), [
    ["bram", 0, "transfer", 1000, 2, "greed"],
    ["cass", 0, "transfer", 1000, 1, "greed"],
    ["aria", 0, "transfer", 5000, 1, "need"],
  ]);
  const receipt = after.journal!.events.filter((e) => e.lootResolution);
  assert.equal(receipt.length, 1);
  assert.equal(receipt[0]!.lootResolution!.rolls, "server");
  assert.deepEqual(receipt[0]!.lootResolution!.lots[0]!.rolls, [{ purseId: "bram", d100: [71] }, { purseId: "cass", d100: [40] }]);
  assert.deepEqual(receipt[0]!.lootResolution!.lots[1]!.kept, 1);
  const note = after.notes.find((n) => n.id === "res-note")!;
  assert.equal(note.to, "party");
  assert.match(note.text, /Rusted shortsword to Bram Ironfoot × 2 and Cass of the Reeds \(71 vs 40\)/);
  // The shortsword's open claims are gone with the lot; the potion's stay.
  assert.deepEqual(readLootClaims(after).claims.map((c) => c.holdingId), ["potion"]);
  // Coins are untouched.
  assert.deepEqual(after.purses, t.purses);
  // A failing lot commits nothing (the whole command runs on a copy).
  assert.throws(() => resolve(t, { method: "round-robin", lots: [{ holdingId: "potion", quantity: 1 }, { holdingId: "symbol", quantity: 1 }] }), /No claims/);
});

test("a stale preview is refused and nothing moves: a changed claim, quantity, party or pointer", () => {
  const t = marked(campaign(), [["sword", "bram", "need"], ["sword", "aria", "greed"]]);
  const lots = [{ holdingId: "sword", quantity: 1 }];
  const expect = lootFingerprint(t, lots, "round-robin");
  const changed = claim(t, seat("aria"), "sword", "aria", "need", "late");
  assert.throws(() => resolve(changed, { method: "round-robin", lots, expect }), /Claims changed. Nothing moved/);
  const pointer = structuredClone(t);
  pointer.journal!.lootClaims = { ...readLootClaims(t), rotation: { lastPurseId: "aria" } };
  assert.throws(() => resolve(pointer, { method: "round-robin", lots, expect }), /Claims changed/);
  const away = structuredClone(t);
  away.journal!.world!.characterPositions.push({ purseId: "cass", inParty: false, locationId: null, visible: true, sheetVisible: true });
  assert.throws(() => resolve(away, { method: "round-robin", lots, expect }), /Claims changed/);
  assert.doesNotThrow(() => resolve(t, { method: "round-robin", lots, expect }));
});

test("one at a time: the DM may give to anyone in the party, including someone who passed or a companion NPC", () => {
  const t = marked(campaign(), [["potion", "aria", "need"], ["potion", "ambrose", "pass"]]);
  const lots = [{ holdingId: "potion", quantity: 2, awards: [{ purseId: "ambrose", quantity: 1 }, { purseId: "dunstan", quantity: 1 }] }];
  const after = resolve(t, { id: "man", method: "manual", lots });
  const receipt = after.journal!.events.find((e) => e.lootResolution)!;
  assert.deepEqual(receipt.lootResolution!.lots[0]!.awards.map((a) => [a.purseId, a.choice]), [["ambrose", "dm"], ["dunstan", "dm"]]);
  assert.equal(receipt.lootResolution!.npc, true);
  assert.equal(after.notes.find((n) => n.id === "man-note")!.to, "dm");
  assert.throws(() => resolve(t, { method: "manual", lots: [{ holdingId: "potion", quantity: 2, awards: [{ purseId: "mirelle", quantity: 2 }] }] }), /not travelling with the party/);
  assert.throws(() => resolve(t, { method: "manual", lots: [{ holdingId: "potion", quantity: 2, awards: [{ purseId: "aria", quantity: 1 }] }] }), /add up to 2/);
});

test("guard: Give, sell and equip of a pooled item are refused for everyone until it leaves the pool", () => {
  const t = campaign();
  t.shops.push({ id: "shop", name: "Shop", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general" } as Shop);
  const give = { id: "g", kind: "give" as const, fromId: "hoard", toId: "aria", copper: 0, holdingId: "potion", quantity: 1 };
  assert.throws(() => applyCommand(t, dm, give), new RegExp(POOL_GUARD.slice(0, 40)));
  // "Allow party fund": a player seat that controls the fund.
  assert.throws(() => applyCommand(t, seat("aria", "hoard"), give), /treasure pool/);
  assert.throws(() => applyCommand(t, seat("aria", "hoard"), { id: "s", kind: "sell", holdingId: "potion", shopId: "shop", quantity: 1 }), /treasure pool/);
  // A DM patch cannot move it to a character or equip it.
  const potion = t.holdings.find((h) => h.id === "potion")!;
  assert.throws(
    () => applyCommand(t, dm, { id: "p", kind: "patch", changes: [{ store: "holdings", id: "potion", before: potion, after: { ...potion, purseId: "aria" } }] }),
    /treasure pool/,
  );
  assert.throws(
    () => applyCommand(t, dm, { id: "p2", kind: "patch", changes: [{ store: "holdings", id: "potion", before: potion, after: { ...potion, equipped: true } }] }),
    /treasure pool/,
  );
  // An older client that drops the marker keeps the item pooled.
  const { pool: _pool, ...older } = potion;
  const kept = applyCommand(t, dm, { id: "p3", kind: "patch", changes: [{ store: "holdings", id: "potion", before: potion, after: { ...older, notes: "edited" } }] });
  assert.ok(kept.holdings.find((h) => h.id === "potion")!.pool);
  // Taken out of the pool, it is an ordinary fund item again and can be given.
  const out = applyCommand(t, dm, { id: "out", kind: "loot-pool-set", holdingId: "potion", pooled: false });
  assert.doesNotThrow(() => applyCommand(out, dm, give));
});

test("pool-set: only physical party-fund items enter; taking a lot out drops its open claims and keeps the history", () => {
  let t = marked(campaign(), [["potion", "aria", "need"]]);
  assert.throws(() => applyCommand(t, dm, { id: "a", kind: "loot-pool-set", holdingId: "aria-dagger", pooled: true }), /held by a party fund/);
  t = applyCommand(t, dm, { id: "b", kind: "loot-pool-set", holdingId: "rope", pooled: true });
  assert.equal(t.holdings.find((h) => h.id === "rope")!.pool?.source, "dm");
  t = applyCommand(t, dm, { id: "c", kind: "loot-pool-set", holdingId: "potion", pooled: false });
  assert.deepEqual(readLootClaims(t).claims, []);
  assert.equal(t.journal!.events.filter((e) => e.lootClaim).length, 1);
  assert.deepEqual(t.journal!.events.at(-1)!.lootPool, { holdingId: "potion", name: "Potion of healing", quantity: 2, pooled: false });
  // A DM deleting a pooled lot drops its claims too.
  let d = marked(campaign(), [["sword", "bram", "need"]]);
  const sword = d.holdings.find((h) => h.id === "sword")!;
  d = applyCommand(d, dm, { id: "del", kind: "patch", changes: [{ store: "holdings", id: "sword", before: sword, after: null }] });
  assert.deepEqual(readLootClaims(d).claims, []);
});

test("old data: a campaign without pool fields loads and runs every command unchanged", () => {
  const t = campaign();
  t.holdings = t.holdings.map(({ pool: _pool, ...h }) => h);
  const after = applyCommand(t, dm, { id: "g", kind: "give", fromId: "hoard", toId: "aria", copper: 0, holdingId: "potion", quantity: 1 });
  assert.equal(after.journal!.lootClaims, undefined);
  assert.equal(after.holdings.find((h) => h.id === "g-item")!.purseId, "aria");
});

test("history: a DM journal patch (older client) cannot rewrite open claims or drop loot event payloads", () => {
  let t = marked(campaign(), [["potion", "aria", "need"]]);
  t = resolve(t, { id: "hist", method: "round-robin", lots: [{ holdingId: "potion", quantity: 2 }] });
  const journal = t.journal!;
  // An older client's copy: no lootClaims, no loot payloads on events.
  const older = {
    ...journal,
    lootClaims: undefined,
    events: journal.events.map(({ lootClaim: _c, lootPool: _p, lootResolution: _r, ...e }) => e),
  };
  const patched = applyCommand(t, dm, { id: "jp", kind: "patch", changes: [{ store: "journal", id: "journal", before: older, after: older }] });
  assert.deepEqual(patched.journal!.lootClaims, journal.lootClaims);
  assert.deepEqual(
    patched.journal!.events.filter((e) => e.lootClaim || e.lootResolution).map((e) => e.id),
    journal.events.filter((e) => e.lootClaim || e.lootResolution).map((e) => e.id),
  );
});

test("Activity: one row per resolution and one row per run of claim changes, with party lines only", async () => {
  const { lootActivity } = await import("./loot-activity.ts");
  let t = marked(campaign(), [["sword", "bram", "need"], ["sword", "aria", "greed"]]);
  t = resolve(t, { id: "act", method: "round-robin", lots: [{ holdingId: "sword", quantity: 1 }] });
  t = claim(t, seat("cass"), "symbol", "cass", "greed", "late-claim");
  const rows = lootActivity(t.journal!.events, t.purses, { ownPurseIds: ["bram"] });
  assert.deepEqual(rows.map((r) => [r.icon, r.title]), [
    ["claims", "Claims marked · 1 change"],
    ["resolve", "Treasure pool resolved · 1 item to 1 character"],
    ["claims", "Claims marked · 2 changes"],
  ]);
  assert.deepEqual(rows[1]!.lines.map((l) => [l.who, l.item, l.own]), [["The Hoard → Bram Ironfoot", "+1 Longsword × 1", true]]);
  assert.equal(rows[1]!.total, "1 item · 500 gp");
});

test("Activity keeps the real order when a claim and a resolution share a millisecond", async () => {
  const { lootActivity } = await import("./loot-activity.ts");
  let t = marked(campaign(), [["sword", "bram", "need"], ["sword", "aria", "greed"]]);
  t = resolve(t, { id: "same-ms", method: "round-robin", lots: [{ holdingId: "sword", quantity: 1 }] });
  t = claim(t, seat("cass"), "symbol", "cass", "greed", "same-ms-claim");
  // Force every event onto one timestamp: order must come from the journal, not the clock.
  const events = t.journal!.events.map((e) => ({ ...e, at: 1_800_000_000_000 }));
  const rows = lootActivity(events, t.purses, { ownPurseIds: ["bram"] });
  assert.deepEqual(rows.map((r) => r.title), [
    "Claims marked · 1 change",
    "Treasure pool resolved · 1 item to 1 character",
    "Claims marked · 2 changes",
  ]);
});
