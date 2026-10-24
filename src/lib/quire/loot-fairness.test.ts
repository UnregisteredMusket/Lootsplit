// Fairness ledger (prompt 2, phase 3): what counts and what does not, older encounter items at
// 0 cp (flagged), the award tag, averages and late joiners, archived sessions, privacy of the
// projection (DM, party member, player away), the favour rules and long histories.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, type Command } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { encounterCoinLine, encounterItemLine } from "./award-tag.ts";
import {
  fairnessCacheSize,
  fairnessLedger,
  fairnessReceipts,
  fairnessStandings,
  furthestBehind,
  roundGap,
  type FairViewer,
} from "./loot-fairness.ts";
import { lootFingerprint, planLootResolution, readLootClaims } from "./loot-claims.ts";
import { projectRecord } from "./session-records.ts";
import type { Holding, LedgerLine, Purse } from "./types.ts";
import type { LootChoice } from "./loot-claims-schema.ts";

const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const DM: FairViewer = { dm: true, purseIds: [] };
const coins = (gp = 0) => ({ cp: 0, sp: 0, ep: 0, gp, pp: 0 });
const character = (id: string, name: string, extra: Partial<Purse> = {}): Purse => ({ id, name, kind: "character", coins: coins(5), ...extra });
let n = 0;
const run = (t: CloudTable, cmd: Record<string, unknown>, seat: CloudSeat = dm) =>
  applyCommand(t, seat, { id: `cmd-${++n}`, ...cmd } as Command);
const line = (purseId: string, summary: string, copper: number, extra: Partial<LedgerLine> = {}): LedgerLine => ({
  id: `line-${++n}`,
  at: Date.now(),
  purseId,
  shopId: null,
  summary,
  copper,
  ...extra,
});
const split = (t: CloudTable, sourceId: string, copper: number, recipientIds: string[]) =>
  run(t, { kind: "coin-split", sourceId, copper, recipientIds, remainder: { rule: "party-fund", purseId: "hoard" }, expect: { share: Math.floor(copper / recipientIds.length), remainderTo: copper % recipientIds.length ? (sourceId === "hoard" ? "hoard" : "hoard") : null } });
const positions = (away: string[]) =>
  away.map((purseId) => ({ purseId, inParty: false, locationId: null, visible: true, sheetVisible: true }));

/**
 * Session 1: a fund split (Aria, Bram, Cass, Wren 75 cp each), Aria splits her own coins, Bram
 * gives Aria coins, an older encounter coin line to Cass (120 cp) and an older item to Bram (no
 * value). Then Ambrose joins and Wren leaves the party. Session 2 (in progress): tagged awards,
 * an encounter split, a pool award, a purchase, a DM adjustment and a reversal.
 */
function history() {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins(100) },
      character("aria", "Aria Thorne"),
      character("bram", "Bram Ironfoot"),
      character("cass", "Cass of the Reeds"),
      character("wren", "Wren Ashdown"),
      character("dunstan", "Dunstan the porter", { control: "npc" }),
    ],
    journal: readJournal({}),
  };
  t = run(t, { kind: "session", name: "Tolls of the Weir", end: false });
  t = split(t, "hoard", 300, ["aria", "bram", "cass", "wren"]);
  t = run(t, { kind: "coin-split", sourceId: "aria", copper: 30, recipientIds: ["aria", "bram", "cass"], remainder: { rule: "party-fund", purseId: "hoard" }, expect: { share: 10, remainderTo: null } });
  t = run(t, { kind: "give", fromId: "bram", toId: "aria", copper: 50, holdingId: null, quantity: 0 });
  t.ledger.push(line("cass", "Encounter loot: Weir bandits", 120, { transactionType: "adjustment" }));
  t.ledger.push(line("bram", "Encounter loot: 1 × Dwarven ale keg (Goblin warren)", 0, { transactionType: "adjustment" }));
  t = run(t, { kind: "session", name: "Tolls of the Weir", end: true });
  t.purses.push(character("ambrose", "Brother Ambrose"));
  t.journal!.world = readJournal({ world: { characterPositions: positions(["wren"]) } }).world;
  t = run(t, { kind: "session", name: "The Drowned Vault", end: false });
  t.ledger.push(encounterItemLine("rcpt-a", 0, Date.now(), "ambrose", { name: "Shield", quantity: 2, unitCopper: 500 }, "Drowned Vault"));
  const tagged = encounterCoinLine("rcpt-b", Date.now(), "aria", "Drowned Vault guardians", 200);
  t.ledger.push(tagged);
  for (const [i, purseId] of ["aria", "bram", "cass", "ambrose", "dunstan"].entries())
    t.ledger.push(line(purseId, "Encounter loot share: Drowned Vault guardians", 40, { id: `rcpt-c-share-${i}`, transactionType: "adjustment", split: { id: "rcpt-c", role: "share" } }));
  t.holdings.push({ id: "sword", purseId: "hoard", name: "Rusted shortsword", kind: "item", quantity: 1, unitCopper: 2500, notes: "", pool: { at: 1, source: "add-loot" } });
  const lots = [{ holdingId: "sword", quantity: 1, awards: [{ purseId: "cass", quantity: 1 }] }];
  t = run(t, { kind: "loot-resolve", method: "manual", lots, expect: lootFingerprint(t, lots, "manual") });
  t.ledger.push(line("ambrose", "Bought: Rope, hempen (50 ft)", -100, { transactionType: "purchase" }));
  t.ledger.push(line("aria", "DM adjustment", 999, { transactionType: "adjustment" }));
  t.ledger.push(line("aria", "Wages: Smithy apprentice (downtime)", 350, { transactionType: "adjustment" }));
  t.ledger.push(line("aria", "Voided: Encounter loot (entered twice)", -200, { transactionType: "void", reversalOf: tagged.id }));
  return t;
}

const total = (view: ReturnType<typeof fairnessLedger>, id: string) =>
  [...view.rows, ...view.others].find((r) => r.purseId === id);

test("counts fund splits, encounter awards and pool awards; never purchases, Give, wages, DM adjustments or own-coin splits", () => {
  const t = history();
  const view = fairnessLedger(t, DM);
  assert.deepEqual(
    view.rows.map((r) => [r.name, r.coins, r.items, r.total]),
    [
      ["Aria Thorne", 75 + 200 - 200 + 40, 0, 115],
      ["Bram Ironfoot", 75 + 40, 0, 115],
      ["Brother Ambrose", 40, 1000, 1040],
      ["Cass of the Reeds", 75 + 120 + 40, 2500, 2735],
    ],
  );
  // The NPC's encounter share and the fund never appear; Wren is away (DM-only, not compared).
  assert.equal(total(view, "dunstan"), undefined);
  assert.equal(total(view, "hoard"), undefined);
  assert.deepEqual([total(view, "wren")!.status, total(view, "wren")!.total, total(view, "wren")!.gap], ["away", 75, null]);
  assert.equal(view.n, 4);
  assert.equal(view.sum, 115 + 115 + 1040 + 2735);
});

test("older encounter items with no recorded value count as 0 cp and are flagged and listed", () => {
  const view = fairnessLedger(history(), DM);
  assert.deepEqual(view.unvalued, [{ purseId: "bram", units: 1 }]);
  const bram = fairnessReceipts(history(), DM, "bram");
  const keg = bram.groups.flatMap((g) => g.receipts).find((r) => r.label.includes("Dwarven ale keg"))!;
  assert.deepEqual([keg.items, keg.unvalued, keg.kind], [0, 1, "encounter-item"]);
  assert.match(keg.detail, /no value was recorded/);
});

test("the award tag gives new encounter items their reviewed value and links coins to the receipt", () => {
  const t = history();
  const ambrose = fairnessReceipts(t, DM, "ambrose").groups.flatMap((g) => g.receipts);
  const shield = ambrose.find((r) => r.kind === "encounter-item")!;
  assert.deepEqual([shield.items, shield.unvalued, shield.receiptId], [1000, 0, "rcpt-a"]);
  // Old lines without the tag still read: an untagged coin line is recognised by its summary.
  const cass = fairnessReceipts(t, DM, "cass").groups.flatMap((g) => g.receipts);
  assert.ok(cass.some((r) => r.kind === "encounter-coins" && r.coins === 120 && !r.receiptId));
  // A reversal of a counted line subtracts it and both stay listed.
  const aria = fairnessReceipts(t, DM, "aria").groups.flatMap((g) => g.receipts);
  const original = aria.find((r) => r.receiptId === "rcpt-b" && !r.reversalOf)!;
  const reversal = aria.find((r) => r.reversalOf === original.lineId)!;
  assert.equal(original.reversedBy, reversal.lineId);
  assert.equal(reversal.coins, -200);
});

test("not-counted lines are listed for the DM and the character's own player only", () => {
  const t = history();
  const others = fairnessReceipts(t, DM, "aria").others!;
  assert.ok(others.some((o) => o.summary === "DM adjustment"));
  assert.ok(others.some((o) => /Wages/.test(o.summary) && /Wages and downtime/.test(o.reason)));
  assert.ok(others.some((o) => o.copper === 50 && /Give/.test(o.reason)));
  assert.equal(fairnessReceipts(t, { dm: false, purseIds: ["bram"] }, "aria").others, null);
  assert.ok(fairnessReceipts(t, { dm: false, purseIds: ["aria"] }, "aria").others!.length > 0);
});

test("averages: the current party for campaign to date (late joiner marked), that session's party per session", () => {
  const t = history();
  const campaign = fairnessLedger(t, DM);
  const ambrose = total(campaign, "ambrose")!;
  assert.equal(ambrose.joined, 2);
  assert.equal(total(campaign, "aria")!.joined, null);
  // Exact gap (1 cp precision): Aria 115 against 4005 / 4.
  assert.deepEqual(total(campaign, "aria")!.gap, { num: 115 * 4 - 4005, den: 4 });
  assert.equal(roundGap(total(campaign, "aria")!.gap!), -886);
  const [first, second] = campaign.periods.filter((p) => p.number !== null);
  assert.equal(first!.label, "Session 1 · Tolls of the Weir");
  assert.equal(second!.inProgress, true);
  // Session 1's party was Aria, Bram, Cass and Wren (Ambrose had not joined).
  const s1 = fairnessLedger(t, DM, first!.key);
  assert.deepEqual(s1.rows.map((r) => r.purseId).sort(), ["aria", "bram", "cass", "wren"]);
  assert.equal(s1.sum, 75 * 4 + 120);
  const s2 = fairnessLedger(t, DM, second!.key);
  assert.deepEqual(s2.rows.map((r) => r.purseId).sort(), ["ambrose", "aria", "bram", "cass"]);
  assert.equal(total(s2, "wren")!.status, "away");
});

test("rounding: the sum of displayed gaps stays within rounding of zero (1 cp among 3)", () => {
  for (const totals of [[1, 0, 0], [2, 1, 0], [7, 7, 8], [100, 0, 1, 1]]) {
    const n = totals.length;
    const sum = totals.reduce((a, b) => a + b, 0);
    const gaps = totals.map((x) => ({ num: x * n - sum, den: n }));
    assert.equal(gaps.reduce((s, g) => s + g.num, 0), 0);
    assert.ok(Math.abs(gaps.reduce((s, g) => s + roundGap(g), 0)) <= n / 2);
  }
  assert.equal(roundGap({ num: 1, den: 2 }), 1);
  assert.equal(roundGap({ num: -1, den: 2 }), -1);
  assert.equal(roundGap({ num: -1, den: 3 }), 0);
});

test("an unreadable archived session is counted as a gap, never dropped silently", () => {
  const t = history();
  t.journal!.reports = [...t.journal!.reports!, { id: "broken", name: "Broken", at: 1, snapshot: "{not json", error: "unreadable" }];
  const view = fairnessLedger(t, DM);
  assert.equal(view.unreadable, 1);
  assert.equal(view.sum, 115 + 115 + 1040 + 2735);
});

test("old saves with no sessions, no tags and no reports load and add up by hand", () => {
  const t: CloudTable = {
    ...emptyCloudTable(),
    purses: [character("a", "A"), character("b", "B")],
    ledger: [line("a", "Encounter loot: Old fight", 300), line("b", "Encounter loot: 2 × Gem (Old fight)", 0)],
  };
  const view = fairnessLedger(t, DM);
  assert.deepEqual(view.rows.map((r) => [r.purseId, r.total, r.unvalued]), [["b", 0, 2], ["a", 300, 0]]);
  assert.deepEqual(view.periods.map((p) => p.key), ["between"]);
});

// --- Privacy: compute from the viewer's own projection ---------------------------------------

const playerSeat = (id: string, ...purseIds: string[]): CloudSeat => ({ id, token: "", name: id, role: "player", purseIds });
/** A party member's live table: the projection plus party players' lines (cloud.server.ts playerTable). */
function viewFor(t: CloudTable, seat: CloudSeat) {
  return projectRecord(t, seat, { directory: true });
}

test("projection: a party member sees the party's archived counted lines but none of their other lines", () => {
  const t = history();
  const bram = viewFor(t, playerSeat("s-bram", "bram"));
  const report = JSON.parse(bram.journal!.reports![0]!.snapshot);
  const ext = report.fairness;
  assert.deepEqual(ext.party.map((p: { id: string }) => p.id).sort(), ["aria", "bram", "cass", "wren"]);
  // Only counted lines of others: Aria's split share, Cass's split share and older coin award, Wren's share.
  for (const l of ext.lines as LedgerLine[]) assert.notEqual(l.purseId, "bram");
  assert.ok((ext.lines as LedgerLine[]).every((l) => !/Gave|Transfer|Split share from Aria/.test(l.summary)));
  assert.equal((ext.lines as LedgerLine[]).some((l) => l.copper === 50), false);
  // Bram's own Session 1 lines are in the projected ledger as before.
  assert.ok((report.ledger as LedgerLine[]).every((l) => l.purseId === "bram"));
  // The derivation on this projection matches the DM's for Session 1.
  const s1 = bram.journal!.sessions[0]!.id;
  assert.deepEqual(
    fairnessLedger(bram, { dm: false, purseIds: ["bram"] }, s1).rows.map((r) => [r.purseId, r.total]),
    fairnessLedger(t, DM, s1).rows.map((r) => [r.purseId, r.total]),
  );
});

test("projection: a player away from the party gets no other character's lines and sees only their own", () => {
  const t = history();
  const wrenSeat = playerSeat("s-wren", "wren");
  const wren = viewFor(t, wrenSeat);
  const ext = JSON.parse(wren.journal!.reports![0]!.snapshot).fairness;
  assert.deepEqual(ext.party, []);
  assert.deepEqual(ext.lines, []);
  const view = fairnessLedger(wren, { dm: false, purseIds: ["wren"] });
  assert.equal(view.compared, false);
  assert.deepEqual([...view.rows, ...view.others].map((r) => [r.purseId, r.total, r.gap]), [["wren", 75, null]]);
  assert.equal(furthestBehind(wren, { dm: false, purseIds: ["wren"] }), null);
});

test("projection: the DM's reports carry no extension and NPC lines never reach players", () => {
  const t = history();
  const forDm = projectRecord(t, dm);
  assert.equal(JSON.parse(forDm.journal!.reports![0]!.snapshot).fairness, undefined);
  for (const seat of [playerSeat("s-aria", "aria"), playerSeat("s-wren", "wren")]) {
    const p = viewFor(t, seat);
    const all = [...p.ledger, ...p.journal!.reports!.flatMap((r) => { const s = JSON.parse(r.snapshot); return [...s.ledger, ...(s.fairness?.lines ?? [])]; })];
    assert.equal(all.some((l: LedgerLine) => l.purseId === "dunstan" || l.purseId === "hoard"), false);
    const rows = fairnessLedger(p, { dm: false, purseIds: seat.purseIds });
    assert.equal([...rows.rows, ...rows.others].some((r) => r.purseId === "dunstan"), false);
  }
});

test("projection: a seat not present for an archived session does not read it (late-joining player)", () => {
  const t = history();
  t.journal!.reports![0]!.seatIds = ["s-aria"];
  const amb = viewFor(t, playerSeat("s-ambrose", "ambrose"));
  assert.equal(amb.journal!.reports!.length, 0);
  const view = fairnessLedger(amb, { dm: false, purseIds: ["ambrose"] });
  assert.equal(view.periods.find((p) => p.number === 1)?.unavailable, "not-seated");
  assert.equal(view.fromSession, 2);
});

// --- Favour whoever is behind -----------------------------------------------------------------

function pool(lots: Holding[], claims: Array<[string, string, LootChoice]>) {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins(10) },
      character("aria", "Aria Thorne"),
      character("bram", "Bram Ironfoot"),
      character("cass", "Cass of the Reeds"),
      character("ambrose", "Brother Ambrose"),
    ],
    holdings: lots,
    journal: readJournal({}),
  };
  for (const [holdingId, purseId, choice] of claims) {
    const before = readLootClaims(t).claims.find((c) => c.holdingId === holdingId && c.purseId === purseId)?.choice ?? null;
    t = run(t, { kind: "loot-claim", holdingId, purseId, choice, before });
  }
  return t;
}
const lot = (id: string, quantity: number, unitCopper: number): Holding => ({ id, purseId: "hoard", name: id, kind: "item", quantity, unitCopper, notes: "", pool: { at: 1, source: "add-loot" } });
const totals = (entries: Record<string, number>) => new Map(Object.entries(entries));

test("favour: Need always beats Greed, however far behind the Greed claimant is", () => {
  const t = pool([lot("potion", 2, 5000)], [["potion", "aria", "need"], ["potion", "cass", "need"], ["potion", "ambrose", "greed"]]);
  for (const method of ["random", "round-robin"] as const) {
    const plan = planLootResolution(t, { method, lots: [{ holdingId: "potion", quantity: 2 }] }, () => 50, totals({ ambrose: -1e9, aria: 9000, cass: 9000 }));
    assert.deepEqual(plan.lots[0]!.awards.map((a) => [a.purseId, a.quantity]), [["aria", 1], ["cass", 1]]);
  }
});

test("favour (random): only a tied top roll goes to whoever is behind; equal totals roll again", () => {
  const t = pool([lot("scroll", 1, 6000)], [["scroll", "aria", "need"], ["scroll", "bram", "need"]]);
  const input = { method: "random" as const, lots: [{ holdingId: "scroll", quantity: 1 }] };
  // Higher roll still wins, whoever is behind.
  const higher = planLootResolution(t, input, (_h, p) => (p === "aria" ? 90 : 10), totals({ aria: 5000, bram: 0 }));
  assert.equal(higher.lots[0]!.awards[0]!.purseId, "aria");
  assert.deepEqual(higher.lots[0]!.favoured, []);
  // A tie at 71: Bram is behind and wins without a re-roll.
  const tie = planLootResolution(t, input, () => 71, totals({ aria: 5000, bram: 100 }));
  assert.equal(tie.lots[0]!.awards[0]!.purseId, "bram");
  assert.deepEqual(tie.lots[0]!.rolls.map((r) => r.d100), [[71], [71]]);
  assert.deepEqual(tie.lots[0]!.favoured, ["bram"]);
  // Equal totals: roll again as without favour.
  const again = planLootResolution(t, input, (_h, p, round) => (round === 1 ? 71 : p === "aria" ? 80 : 20), totals({ aria: 300, bram: 300 }));
  assert.equal(again.lots[0]!.awards[0]!.purseId, "aria");
  assert.deepEqual(again.lots[0]!.rolls.find((r) => r.purseId === "aria")!.d100, [71, 80]);
  // Without favour the planner is unchanged (a tie rolls again).
  const plain = planLootResolution(t, input, (_h, p, round) => (round === 1 ? 71 : p === "bram" ? 99 : 1));
  assert.equal(plain.lots[0]!.awards[0]!.purseId, "bram");
  assert.equal(plain.lots[0]!.rolls[0]!.d100.length, 2);
});

test("favour (round-robin): each unit to the lowest running total, across lots; ties keep name order", () => {
  const t = pool(
    [lot("potion", 3, 5000), lot("axe", 1, 1000)],
    [["potion", "aria", "need"], ["potion", "cass", "need"], ["axe", "aria", "greed"], ["axe", "cass", "greed"]],
  );
  const input = { method: "round-robin" as const, lots: [{ holdingId: "potion", quantity: 3 }, { holdingId: "axe", quantity: 1 }] };
  // Cass 2,240 behind Aria 5,640 (≈ the mockup): Cass, then Aria (7,240 < 10,640), then Cass again.
  const plan = planLootResolution(t, input, undefined, totals({ cass: 2240, aria: 5640 }));
  assert.deepEqual(plan.lots[0]!.awards.map((a) => [a.purseId, a.quantity]), [["aria", 1], ["cass", 2]]);
  // Running totals carry into the next lot: Aria 10,640 vs Cass 12,240 → Aria gets the axe.
  assert.deepEqual(plan.lots[1]!.awards.map((a) => a.purseId), ["aria"]);
  assert.equal(plan.rotationAfter, "aria");
  // Equal totals: the existing name-order pointer decides (Aria first with no pointer).
  const even = planLootResolution(t, { method: "round-robin", lots: [{ holdingId: "potion", quantity: 1 }] }, undefined, totals({ aria: 0, cass: 0 }));
  assert.equal(even.lots[0]!.awards[0]!.purseId, "aria");
  // Without favour: name order, unchanged.
  const plain = planLootResolution(t, { method: "round-robin", lots: [{ holdingId: "potion", quantity: 3 }] });
  assert.deepEqual(plain.lots[0]!.awards.map((a) => [a.purseId, a.quantity]), [["aria", 2], ["cass", 1]]);
});

test("favour command: totals come from the campaign, are recorded on the receipt, and a changed total refuses", () => {
  const t = pool([lot("scroll", 1, 6000)], [["scroll", "aria", "need"], ["scroll", "bram", "need"]]);
  t.ledger.push(encounterCoinLine("old", Date.now(), "aria", "Ford ogre", 5000));
  const lots = [{ holdingId: "scroll", quantity: 1 }];
  const favour = { basis: "campaign" as const, totals: fairnessStandings(t, "campaign") };
  const expect = lootFingerprint(t, lots, "random", favour);
  assert.notEqual(expect, lootFingerprint(t, lots, "random"));
  // A split landing between preview and confirm changes a claimant's total: nothing moves.
  const moved = structuredClone(t);
  moved.ledger.push(encounterCoinLine("new", Date.now(), "bram", "Late award", 7000));
  assert.throws(
    () => applyCommand(moved, dm, { id: "res", kind: "loot-resolve", method: "random", rolls: "manual", manualRolls: [{ holdingId: "scroll", purseId: "aria", d100: [71] }, { holdingId: "scroll", purseId: "bram", d100: [71] }], lots, expect, favour: { basis: "campaign" } } as Command, { manualRolls: true }),
    /Claims changed/,
  );
  const done = applyCommand(t, dm, { id: "res", kind: "loot-resolve", method: "random", rolls: "manual", manualRolls: [{ holdingId: "scroll", purseId: "aria", d100: [71] }, { holdingId: "scroll", purseId: "bram", d100: [71] }], lots, expect, favour: { basis: "campaign" } } as Command, { manualRolls: true });
  const event = done.journal!.events.find((e) => e.lootResolution)!;
  assert.equal(event.lootResolution!.lots[0]!.awards[0]!.purseId, "bram");
  const { totals: used, ...receipt } = event.lootFavour!;
  assert.deepEqual(receipt, { id: "res", basis: "campaign", lots: [{ holdingId: "scroll", purseIds: ["bram"] }] });
  assert.deepEqual(
    [...used].sort((a, b) => a.purseId.localeCompare(b.purseId)),
    [{ purseId: "ambrose", copper: 0 }, { purseId: "aria", copper: 5000 }, { purseId: "bram", copper: 0 }, { purseId: "cass", copper: 0 }],
  );
  // "This session" needs a running session; one-at-a-time takes no favour.
  assert.throws(() => fairnessStandings(t, "session"), /No session is running/);
  assert.throws(
    () => applyCommand(t, dm, { id: "m", kind: "loot-resolve", method: "manual", lots: [{ holdingId: "scroll", quantity: 1, awards: [{ purseId: "aria", quantity: 1 }] }], expect: "x", favour: { basis: "campaign" } } as Command),
    /random and round-robin/,
  );
});

// --- Long histories ---------------------------------------------------------------------------

test("performance: 50 archived sessions of 400 lines each build once, then reuse the per-session cache", () => {
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [{ id: "hoard", name: "The Hoard", kind: "party", coins: coins(0) }, ...["a", "b", "c", "d", "e"].map((id) => character(id, id.toUpperCase()))],
    journal: readJournal({}),
  };
  for (let s = 0; s < 50; s++) {
    t = run(t, { kind: "session", name: `Session ${s + 1}`, end: false });
    for (let i = 0; i < 400; i++) {
      const purseId = "abcde"[i % 5]!;
      t.ledger.push(
        i % 4 === 0
          ? line(purseId, "Bought: Torch", -1, { transactionType: "purchase" })
          : i % 4 === 1
            ? line(purseId, "Encounter loot share: Ambush", 10, { transactionType: "adjustment", split: { id: `sp-${s}-${i}`, role: "share" } })
            : i % 4 === 2
              ? encounterItemLine(`aw-${s}-${i}`, 0, Date.now(), purseId, { name: "Gem", quantity: 1, unitCopper: 50 }, "Ambush")
              : line(purseId, "Gave coins", -2, { transactionType: "transfer" }),
      );
    }
    t = run(t, { kind: "session", name: `Session ${s + 1}`, end: true });
  }
  assert.equal(t.journal!.reports!.length, 50);
  const started = performance.now();
  const first = fairnessLedger(t, DM);
  const cold = performance.now() - started;
  assert.equal(first.sum, 50 * 400 * (10 + 50) / 4);
  assert.ok(fairnessCacheSize() >= 50);
  // A new live table (one new line) reuses every archived digest.
  const next = { ...t, ledger: [...t.ledger, line("a", "Encounter loot: Late", 5)] };
  const warmStart = performance.now();
  const second = fairnessLedger(next, DM);
  const warm = performance.now() - warmStart;
  assert.equal(second.sum, first.sum + 5);
  assert.ok(cold < 4000, `cold build took ${cold.toFixed(0)} ms`);
  assert.ok(warm < Math.max(50, cold / 2), `warm build took ${warm.toFixed(0)} ms (cold ${cold.toFixed(0)} ms)`);
});
