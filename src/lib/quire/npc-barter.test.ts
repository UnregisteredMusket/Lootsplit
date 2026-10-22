import test from "node:test";
import assert from "node:assert/strict";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import { barterFixture } from "./test-fixtures/npc-barter.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readWorld } from "./world-schema.ts";
import { canonicalJson } from "./canonical-json.ts";
import { toCopper } from "./money.ts";
import { editCharacter, characterSheet } from "../characters/campaign-sheet.mjs";
import {
  barterDc,
  oddsWords,
  persuasionCheck,
  projectNpcBarter,
  publicQuote,
  quoteNpcBarter,
  readNpcBarter,
  successChance,
  replyFor,
  STANCE_LINES,
} from "./npc-barter.ts";
import type { TradeExecution } from "./trade-economy-schema.ts";
import type { BarterSide } from "./npc-barter-schema.ts";

const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const mira: CloudSeat = { id: "mira-seat", userId: "user-mira", token: "m", name: "Mira", role: "player", purseIds: ["mira"] };
const tamsin: CloudSeat = { id: "tamsin-seat", userId: "user-tamsin", token: "t", name: "Tamsin", role: "player", purseIds: ["tamsin"] };

/** Fixed dice: the server's d100 draws, keyed by draw number. */
function dice(...values: number[]): TradeExecution {
  return { source: "server", random: (key) => values[Number(key.slice(-1)) - 1] ?? 1 };
}

let n = 0;
function run(t: CloudTable, input: CommandInput, seat: CloudSeat = dm, execution: TradeExecution = {}, id = `cmd-${++n}`) {
  return applyCommand(t, seat, { ...input, id } as never, execution);
}

const fixture = () => barterFixture();
const lot = (t: CloudTable, holdingId: string, quantity = 1) => ({
  holdingId,
  quantity,
  before: canonicalJson(t.holdings.find((h) => h.id === holdingId)),
});
const npcLot = (t: CloudTable, name: string, quantity = 1) =>
  lot(t, t.holdings.find((h) => h.purseId === "odile" && h.name === name)!.id, quantity);

function offer(t: CloudTable, purseId: string, give: BarterSide["items"], copper: number, ask: BarterSide["items"], askCopper = 0) {
  return {
    npcId: "odile",
    purseId,
    give: { purseId, copper, items: give },
    ask: { purseId: "odile", copper: askCopper, items: ask },
  };
}
const standard = (t: CloudTable, purseId: string, holding: string) =>
  offer(t, purseId, [lot(t, holding)], 300, [npcLot(t, "Hooded lantern"), npcLot(t, "Traveler's cloak")]);
const attempts = (t: CloudTable) => readNpcBarter(readWorld(t.journal?.world)).attempts;
const coins = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);

test("DC formula, odds and plain-language words follow the design table", () => {
  assert.deepEqual([1000, 900, 800, 700, 600].map((r) => barterDc(r, 0, 0, 2)), [10, 13, 15, 18, 20]);
  assert.equal(barterDc(888, 2, 1, 2), 17, "stance and a repeat raise the DC");
  assert.equal(barterDc(0, 0, 9, 2), 25, "kept within 5–25");
  assert.equal(barterDc(1400, -2, 0, 2), 5);
  assert.equal(successChance(13, 5, "advantage"), 878);
  assert.equal(successChance(13, 1, "normal"), 450);
  assert.equal(successChance(13, -1, "disadvantage"), 122);
  assert.equal(successChance(30, 0, "normal"), 0, "a natural 20 is not an automatic success");
  assert.equal(oddsWords(878), "Very likely");
  assert.equal(oddsWords(450), "About even");
  assert.equal(oddsWords(123), "Very unlikely");
});

test("roll rules: advantage at CHA 16+, disadvantage at 8 or less, sheet bonus or +0 without a sheet", () => {
  const t = fixture();
  assert.deepEqual(persuasionCheck(t, "mira"), { bonus: 5, cha: 16, advantage: "advantage", sheet: true });
  assert.deepEqual(persuasionCheck(t, "bram"), { bonus: -1, cha: 8, advantage: "disadvantage", sheet: true });
  assert.deepEqual(persuasionCheck(t, "tamsin"), { bonus: 0, cha: null, advantage: "normal", sheet: false });
});

test("quote: the NPC values received goods at 50%, its own at full value; unwanted goods count nothing", () => {
  const t = fixture();
  const q = quoteNpcBarter(t, mira, standard(t, "mira", "mirror"));
  assert.equal(q.received, 800);
  assert.equal(q.given, 900);
  assert.equal(q.ratio, 888);
  assert.equal(q.dc, 13);
  assert.equal(q.kind, "check");
  assert.equal(q.addCopper, 190, "1 gp 9 sp more reaches the accept-without-a-roll level");
  assert.equal(q.chance, 878);
  const pelts = quoteNpcBarter(t, mira, offer(t, "bram", [lot(t, "pelt", 2)], 0, [npcLot(t, "Hooded lantern")]));
  assert.equal(pelts.received, 0);
  assert.equal(pelts.kind, "refuse");
  assert.deepEqual(pelts.unwanted, ["Wolf pelt"]);
  // The player-facing quote carries no valuation.
  assert.equal("received" in publicQuote(q) || "given" in publicQuote(q) || "ratio" in publicQuote(q), false);
});

test("accept: the server's roll succeeds and one atomic exchange moves goods and coins", () => {
  let t = fixture();
  const input = standard(t, "mira", "mirror");
  t = run(t, { kind: "npc-barter-offer", ...input, reply: "persuade" }, mira, dice(6, 14), "mira-offer");
  const [a] = attempts(t);
  assert.equal(a.status, "accepted");
  assert.deepEqual(a.roll, { dice: [6, 14], kept: 14, total: 19, source: "server" });
  assert.equal(coins(t, "mira"), 3740 - 300);
  assert.equal(coins(t, "odile"), 10000 + 300);
  assert.ok(t.holdings.some((h) => h.purseId === "mira" && h.name === "Hooded lantern"));
  assert.ok(t.holdings.some((h) => h.purseId === "odile" && h.name === "Silver hand mirror"));
  assert.equal(t.ledger.filter((l) => l.id.startsWith("mira-offer-")).length, 2);
  assert.equal(a.lines.at(-1)!.text, STANCE_LINES.fair.accept);
  // Replaying the same command ID is refused by the engine; rooms skip it by receipt before this.
  assert.throws(() => run(t, { kind: "npc-barter-offer", ...input, reply: "persuade" }, mira, dice(20, 20), "mira-offer"));
});

test("counter: a narrow miss asks for the coins that reach the no-roll level; accepting needs no roll", () => {
  let t = fixture();
  t = run(t, { kind: "npc-barter-offer", ...standard(t, "tamsin", "mirror-t"), reply: "persuade" }, tamsin, dice(11));
  const [a] = attempts(t);
  assert.equal(a.status, "countered");
  assert.equal(a.counterCopper, 190);
  assert.match(a.lines.at(-1)!.text, /Add 1 gp, 9 sp and we have a deal/);
  assert.throws(
    () => run(t, { kind: "npc-barter-decide", attemptId: a.id, revision: 0, decision: "accept-counter" }, mira),
    /Only this character's player/,
  );
  t = run(t, { kind: "npc-barter-decide", attemptId: a.id, revision: 0, decision: "accept-counter" }, tamsin);
  assert.equal(attempts(t)[0].status, "accepted");
  assert.equal(coins(t, "tamsin"), 3740 - 490);
  assert.equal(coins(t, "odile"), 10000 + 490);
});

test("refuse: a failed roll starts a cooldown; equal offers are locked, clearly better ones cost DC +2", () => {
  let t = fixture();
  const input = standard(t, "bram", "mirror-b");
  t = run(t, { kind: "npc-barter-offer", ...input, reply: "persuade" }, dm, dice(15, 4));
  const [a] = attempts(t);
  assert.equal(a.status, "refused");
  assert.deepEqual(a.roll, { dice: [15, 4], kept: 4, total: 3, source: "server" });
  assert.match(a.lines.at(-1)!.text, /Campaign day 12, 15:20/);
  const again = quoteNpcBarter(t, dm, input);
  assert.deepEqual(again.locked, { until: 12 * 1440 + 15 * 60 + 20 });
  assert.throws(() => run(t, { kind: "npc-barter-offer", ...input, reply: "persuade" }, dm, dice(20, 20)), /won't consider this or a worse offer/);
  // 100 cp more is ten points fairer: allowed now, at DC 13 → 11 + 2.
  const better = offer(t, "bram", [lot(t, "mirror-b")], 400, input.ask.items);
  const q = quoteNpcBarter(t, dm, better);
  assert.equal(q.locked, null);
  assert.equal(q.repeat, 1);
  assert.equal(q.dc, barterDc(q.ratio, 0, 1, 2));
  // Another character of a different account is not affected without party memory.
  assert.equal(quoteNpcBarter(t, mira, standard(t, "mira", "mirror")).locked, null);
  // With party memory, the whole party waits.
  t = run(t, { kind: "npc-barter-rules", revision: 0, rules: { ...readNpcBarter(readWorld(t.journal?.world)).rules, partyMemory: true } });
  assert.ok(quoteNpcBarter(t, mira, standard(t, "mira", "mirror")).locked);
  // The DM can clear the wait.
  t = run(t, { kind: "npc-barter-clear-wait", attemptId: a.id, revision: 0 });
  assert.equal(quoteNpcBarter(t, dm, input).locked, null);
});

test("refuse without a roll: goods the NPC doesn't want; the line names them", () => {
  let t = fixture();
  t = run(t, { kind: "npc-barter-offer", ...offer(t, "bram", [lot(t, "pelt", 2)], 0, [npcLot(t, "Hooded lantern")]), reply: "too-low" }, dm, dice(20));
  const [a] = attempts(t);
  assert.equal(a.status, "refused");
  assert.equal(a.roll, undefined);
  assert.match(a.lines[0].text, /no use for Wolf pelt/);
});

test("combining trades: barters with the same NPC within 24 in-game hours are judged as one deal", () => {
  let t = fixture();
  // A generous first trade, then a lopsided one: judged together, not alone.
  t = run(t, { kind: "npc-barter-offer", ...offer(t, "mira", [], 600, [npcLot(t, "Hooded lantern")]), reply: "offer" }, mira, dice(1));
  assert.equal(attempts(t)[0].status, "accepted");
  const second = offer(t, "mira", [], 100, [npcLot(t, "Hooded lantern")]);
  const q = quoteNpcBarter(t, mira, second);
  assert.equal(q.combined, true);
  assert.equal(q.received, 700);
  assert.equal(q.given, 1000);
  assert.equal(q.dc, 18);
  // Splitting a lopsided deal gives the same DC as the whole.
  const whole = quoteNpcBarter(fixture(), mira, offer(fixture(), "mira", [], 700, [npcLot(fixture(), "Hooded lantern", 2)]));
  assert.equal(whole.dc, q.dc);
});

test("limits: large deals, unreferenced goods and repeated tries go to the DM queue", () => {
  let t = fixture();
  const big = quoteNpcBarter(t, mira, offer(t, "mira", [], 9000, [npcLot(t, "Brass spyglass")]));
  assert.equal(big.kind, "dm");
  const unref = quoteNpcBarter(t, mira, offer(t, "mira", [lot(t, "dice")], 0, [npcLot(t, "Hooded lantern")]));
  assert.equal(unref.kind, "dm");
  assert.deepEqual(unref.unreferenced, ["Lucky bone dice"]);
  assert.equal(replyFor(unref), "dm");
  assert.throws(
    () => run(t, { kind: "npc-barter-offer", ...offer(t, "mira", [lot(t, "dice")], 0, [npcLot(t, "Hooded lantern")]), reply: "persuade" }, mira, dice(20, 20)),
    /offer changed/,
  );
  t = run(t, { kind: "npc-barter-offer", ...offer(t, "mira", [lot(t, "dice")], 0, [npcLot(t, "Hooded lantern")]), reply: "dm" }, mira, dice(20, 20));
  const [queued] = attempts(t);
  assert.equal(queued.status, "queued");
  assert.equal(queued.roll, undefined, "nothing is rolled until the DM asks");
  // The DM values the dice for this deal and asks the server to roll.
  t = run(t, { kind: "npc-barter-resolve", attemptId: queued.id, revision: 0, action: "roll", values: [{ holdingId: "dice", copper: 2500 }] }, dm, dice(18, 3));
  const rolled = attempts(t)[0];
  assert.equal(rolled.status, "accepted");
  assert.equal(rolled.quote.received, 1250);
  // Units beyond the daily cap (5) count nothing.
  const fresh = fixture();
  const many = quoteNpcBarter(fresh, dm, offer(fresh, "bram", [lot(fresh, "ring", 10)], 0, [npcLot(fresh, "Hooded lantern")]));
  assert.equal(many.received, 250);
  assert.match(many.reasons.join(" "), /only wants 5 Silver ring/);
});

test("modes: DM decides queues every offer; server rolls then waits for the DM to confirm", () => {
  let t = fixture();
  t = run(t, { kind: "npc-barter-npc", npcId: "odile", before: { mode: "auto", wants: ["general", "curios", "jewels"] }, config: { mode: "confirm", wants: ["general", "curios", "jewels"] } });
  t = run(t, { kind: "npc-barter-offer", ...standard(t, "mira", "mirror"), reply: "persuade" }, mira, dice(6, 14));
  let [a] = attempts(t);
  assert.equal(a.status, "confirm");
  assert.equal(a.roll!.total, 19);
  assert.equal(coins(t, "mira"), 3740, "nothing moves before the DM confirms");
  assert.throws(() => run(t, { kind: "npc-barter-resolve", attemptId: a.id, revision: 0, action: "confirm" }, mira), /Only the DM/);
  assert.throws(() => run(t, { kind: "npc-barter-resolve", attemptId: a.id, revision: 0, action: "overrule" }), /reason/);
  t = run(t, { kind: "npc-barter-resolve", attemptId: a.id, revision: 0, action: "confirm" });
  [a] = attempts(t);
  assert.equal(a.status, "accepted");
  assert.equal(coins(t, "mira"), 3440);
  // Default campaign mode: the DM decides.
  let d = fixture();
  d = run(d, { kind: "npc-barter-npc", npcId: "odile", before: { mode: "auto", wants: ["general", "curios", "jewels"] }, config: null });
  d = run(d, { kind: "npc-barter-offer", ...standard(d, "mira", "mirror"), reply: "persuade" }, mira, dice(20, 20));
  assert.equal(attempts(d)[0].status, "queued");
  assert.equal(attempts(d)[0].mode, "dm");
});

test("rolls never happen on a player's device or without the room's authority", () => {
  const t = fixture();
  const input = { kind: "npc-barter-offer" as const, ...standard(t, "mira", "mirror"), reply: "persuade" as const };
  assert.throws(() => run(t, input, mira, {}), /rolled by the room server or the DM's device/);
  assert.throws(() => run(t, input, mira, { source: "local", random: () => 20 }), /DM's device or a shared room/);
  // The DM's own device may roll offline.
  const offline = run(t, input, dm, { source: "local", random: () => 14 });
  assert.equal(attempts(offline)[0].roll!.source, "local");
});

test("authorization: a player can only offer for their own character, and NPCs with a controller keep the old flow", () => {
  const t = fixture();
  assert.throws(() => run(t, { kind: "npc-barter-offer", ...standard(t, "bram", "mirror-b"), reply: "persuade" }, mira, dice(20)), /Only this character's player/);
  assert.throws(() => run(t, { kind: "npc-barter-rules", revision: 0, rules: readNpcBarter(undefined).rules }, mira), /Only the DM/);
  const controlled = run(t, { kind: "npc-save", before: readWorld(t.journal?.world).npcs[0], npc: { ...readWorld(t.journal?.world).npcs[0], controllerPurseId: "tamsin" } });
  assert.throws(() => quoteNpcBarter(controlled, mira, standard(controlled, "mira", "mirror")), /doesn't trade on their own/);
});

test("projection: players see only their own attempts, without valuation, memory keys, rules or stance", () => {
  let t = fixture();
  t = run(t, { kind: "npc-barter-rules", revision: 0, rules: { ...readNpcBarter(undefined).rules, stance: "shrewd", receivePercent: 40 } });
  t = run(t, { kind: "npc-barter-offer", ...standard(t, "mira", "mirror"), reply: "persuade" }, mira, dice(6, 14));
  t = run(t, { kind: "npc-barter-offer", ...standard(t, "bram", "mirror-b"), reply: "persuade" }, dm, dice(1, 1));
  const world = readWorld(structuredClone(t.journal!.world));
  projectNpcBarter(world, mira);
  const state = readNpcBarter(world);
  assert.deepEqual(state.attempts.map((a) => a.purseId), ["mira"]);
  assert.equal(state.attempts[0].quote.received + state.attempts[0].quote.given + state.attempts[0].quote.ratio, 0);
  assert.equal(state.attempts[0].account, "private");
  assert.equal(state.rules.receivePercent, 50, "rules are replaced with defaults");
  assert.equal(state.rules.stance, "fair");
  const odile = world.npcs.find((n) => n.id === "odile")!;
  assert.deepEqual(Object.keys(odile.barter!), ["lines"]);
  assert.equal(odile.barter!.lines!.greet, STANCE_LINES.shrewd.greet);
  assert.equal(odile.barter!.lines!.accept, undefined);
  assert.doesNotMatch(JSON.stringify(world), /user-mira|"wants"|"receivePercent":40|"stance":"shrewd"/);
});

test("old saves without NPC barter data load and project unchanged", () => {
  const world = readWorld({ npcs: [] });
  assert.equal(world.npcBarter, undefined);
  projectNpcBarter(world, mira);
  assert.equal(world.npcBarter, undefined);
  assert.equal(readNpcBarter(world).rules.mode, "dm");
});

test("item values a player sets on their sheet have no reference price; a DM edit confirms them", () => {
  const t = fixture();
  const purse = t.purses.find((p) => p.id === "tamsin")!;
  purse.permissions = { equipment: true } as never;
  const before = characterSheet(purse, t.holdings);
  const next = structuredClone(before);
  next.equipment[0].unitCopper = 99999;
  editCharacter(t, tamsin, { purseId: "tamsin", before, sheet: next }, "edit-1");
  const edited = t.holdings.find((h) => h.id === "mirror-t")!;
  assert.equal(edited.valueSource, "player");
  const q = quoteNpcBarter(t, tamsin, standard(t, "tamsin", "mirror-t"));
  assert.equal(q.kind, "dm");
  assert.deepEqual(q.unreferenced, ["Silver hand mirror"]);
  const dmBefore = characterSheet(purse, t.holdings);
  const dmNext = structuredClone(dmBefore);
  dmNext.equipment[0].unitCopper = 1000;
  editCharacter(t, dm, { purseId: "tamsin", before: dmBefore, sheet: dmNext }, "edit-2");
  assert.equal(t.holdings.find((h) => h.id === "mirror-t")!.valueSource, undefined);
});
