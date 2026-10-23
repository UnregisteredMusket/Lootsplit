// Even coin split (prompt 2, phase 1): copper conservation, remainder rules, credits that keep
// existing coins, permissions and stale-preview refusal in the authoritative command engine.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, type Command } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { toCopper, fromCopper } from "./money.ts";
import {
  applyEncounterSplit,
  creditCoins,
  designatedPartyFund,
  nextInRotation,
  planCoinSplit,
  splitRecipients,
} from "./coin-split.ts";
import type { Purse } from "./types.ts";

const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const player = (...purseIds: string[]): CloudSeat => ({ id: "p", token: "", name: "Aria's player", role: "player", purseIds });
const coins = (c: Partial<Purse["coins"]>) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
const character = (id: string, name: string, c: Partial<Purse["coins"]> = {}, extra: Partial<Purse> = {}): Purse => ({
  id,
  name,
  kind: "character",
  coins: coins(c),
  ...extra,
});

function campaign(options: { fund?: boolean; funds?: Partial<Purse["coins"]>; extraCharacters?: number } = {}): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      ...(options.fund === false ? [] : [{ id: "hoard", name: "The Hoard", kind: "party" as const, coins: coins(options.funds ?? { pp: 2, gp: 47, ep: 3, sp: 18, cp: 9 }) }]),
      ...(options.fund === false ? [] : [{ id: "ship", name: "Ship's purse", kind: "party" as const, coins: coins({}) }]),
      character("aria", "Aria Thorne", { gp: 25, cp: 1 }),
      character("bram", "Bram Ironfoot", { gp: 12, sp: 4 }),
      character("cass", "Cass of the Reeds", { gp: 8, sp: 7, cp: 2 }),
      character("ambrose", "Brother Ambrose", { gp: 3, pp: 1, ep: 2 }),
      character("dunstan", "Dunstan the porter", { gp: 1, sp: 2 }, { control: "npc" }),
      character("mirelle", "Mirelle", { gp: 4 }),
      ...Array.from({ length: options.extraCharacters ?? 0 }, (_, i) => character(`extra-${i}`, `Extra ${i}`)),
    ],
    journal: readJournal({
      world: {
        characterPositions: [
          { purseId: "mirelle", inParty: false, locationId: null, visible: true, sheetVisible: true },
        ],
      },
    }),
  };
}
const four = ["aria", "bram", "cass", "ambrose"];
const total = (t: CloudTable) => t.purses.reduce((sum, p) => sum + toCopper(p.coins), 0);
const purse = (t: CloudTable, id: string) => t.purses.find((p) => p.id === id)!;

type Split = Extract<Command, { kind: "coin-split" }>;
function split(t: CloudTable, seat: CloudSeat, input: Omit<Split, "kind" | "id" | "expect"> & { id?: string; expect?: Split["expect"] }) {
  const plan = planCoinSplit(
    t,
    { sourceId: input.sourceId, copper: input.copper, recipientIds: input.recipientIds, rule: input.remainder.rule, purseId: input.remainder.purseId },
    { actor: seat.role === "dm" ? "dm" : "player" },
  );
  return applyCommand(t, seat, {
    kind: "coin-split",
    id: input.id ?? "split-1",
    ...input,
    expect: input.expect ?? { share: plan.share, remainderTo: plan.remainderTo },
  } as Split);
}

test("1 cp among 3 is refused: each share would be 0 cp and nothing moves", () => {
  const t = campaign({ funds: { cp: 1 } });
  assert.throws(
    () => planCoinSplit(t, { sourceId: "hoard", copper: 1, recipientIds: ["aria", "bram", "cass"], rule: "party-fund" }, { actor: "dm" }),
    /Too little to split: each share would be 0 cp/,
  );
  assert.throws(
    () =>
      applyCommand(t, dm, {
        kind: "coin-split",
        id: "tiny",
        sourceId: "hoard",
        copper: 1,
        recipientIds: ["aria", "bram", "cass"],
        remainder: { rule: "party-fund" },
        expect: { share: 1, remainderTo: null },
      }),
    /Too little to split/,
  );
  assert.equal(toCopper(purse(t, "hoard").coins), 1);
});

test("1,000,003 cp among 7 conserves every copper: 142,857 each and 4 cp stay in the party fund", () => {
  const t = campaign({ funds: { cp: 1_000_003 }, extraCharacters: 3 });
  const recipients = [...four, "extra-0", "extra-1", "extra-2"];
  const before = total(t);
  const next = split(t, dm, { sourceId: "hoard", copper: 1_000_003, recipientIds: recipients, remainder: { rule: "party-fund" } });
  const plan = next.journal!.events.at(-1)!.split!;
  assert.equal(plan.share, 142_857);
  assert.equal(plan.remainder, 4);
  assert.equal(plan.share * plan.n + plan.remainder, 1_000_003);
  assert.equal(plan.remainderTo, "hoard");
  assert.equal(toCopper(purse(next, "hoard").coins), 4);
  for (const id of recipients)
    assert.equal(toCopper(purse(next, id).coins) - toCopper(purse(t, id).coins), 142_857);
  assert.equal(total(next), before);
  const lines = next.ledger.filter((l) => l.split?.id === "split-1");
  assert.equal(lines.length, 8);
  assert.equal(lines.reduce((sum, l) => sum + l.copper, 0), 0);
  assert.ok(lines.every((l) => l.transactionType === "transfer"));
  assert.match(lines[0]!.summary, /7 shares of 1428 gp, 5 sp, 7 cp\. The 4 cp left over stayed here \(party fund\)/);
});

test("a source short on small coins pays with exact change and breaks one larger coin", () => {
  // {gp:10} = 1,000 cp among 3: 333 each, 1 cp stays in the fund.
  let t = campaign({ funds: { gp: 10 } });
  let next = split(t, dm, { sourceId: "hoard", copper: 1000, recipientIds: ["aria", "bram", "cass"], remainder: { rule: "party-fund" } });
  assert.deepEqual(purse(next, "hoard").coins, coins({ cp: 1 }));
  assert.equal(total(next), total(t));
  // The mockup fund {pp2, gp47, ep3, sp18, cp9} = 7,039 cp among 4: 1,759 each, 3 cp stay.
  t = campaign();
  next = split(t, dm, { sourceId: "hoard", copper: 7039, recipientIds: four, remainder: { rule: "party-fund" } });
  assert.equal(toCopper(purse(next, "hoard").coins), 3);
  assert.equal(toCopper(purse(next, "aria").coins), 2501 + 1759);
  assert.equal(total(next), total(t));
});

test("shares are credited as gold, silver and copper on top of the recipient's own coins", () => {
  const t = campaign();
  const next = split(t, dm, { sourceId: "hoard", copper: 7039, recipientIds: four, remainder: { rule: "party-fund" } });
  // Brother Ambrose keeps his platinum and electrum.
  assert.deepEqual(purse(next, "ambrose").coins, coins({ pp: 1, ep: 2, gp: 3 + 17, sp: 5, cp: 9 }));
  assert.deepEqual(creditCoins(coins({ pp: 3, ep: 1, cp: 9 }), 1759), coins({ pp: 3, ep: 1, gp: 17, sp: 5, cp: 18 }));
  assert.throws(() => creditCoins(coins({ gp: 1e10 }), 1), /exceeds the supported coin balance/);
});

test("a player splitting their own purse keeps their share; the leftover goes to the party fund", () => {
  const t = campaign();
  const next = split(t, player("aria"), { sourceId: "aria", copper: 2501, recipientIds: ["aria", "bram", "cass"], remainder: { rule: "party-fund" } });
  assert.equal(toCopper(purse(next, "aria").coins), 833);
  assert.equal(toCopper(purse(next, "bram").coins) - toCopper(purse(t, "bram").coins), 833);
  assert.equal(toCopper(purse(next, "hoard").coins) - toCopper(purse(t, "hoard").coins), 2);
  assert.equal(total(next), total(t));
  const source = next.ledger.find((l) => l.id === "split-1-source")!;
  assert.equal(source.copper, -1668);
  assert.deepEqual(source.split, { id: "split-1", role: "source", keptShare: 833 });
  assert.ok(next.ledger.some((l) => l.id === "split-1-remainder" && l.purseId === "hoard" && l.copper === 2));
  // The party note names everyone and the leftover.
  const note = next.notes.at(-1)!;
  assert.equal(note.to, "party");
  assert.match(note.text, /Split 25 gp, 1 cp from Aria Thorne: 8 gp, 3 sp, 3 cp each to Aria Thorne, Bram Ironfoot and Cass of the Reeds\. The 2 cp left over went to The Hoard \(party fund\)\./);
});

test("remainder rules: second party fund, no party fund, chosen recipient and rotation", () => {
  // A split from the second party fund keeps its leftover there.
  const t = campaign();
  purse(t, "ship").coins = coins({ cp: 10 });
  let next = split(t, dm, { sourceId: "ship", copper: 10, recipientIds: ["aria", "bram", "cass"], remainder: { rule: "party-fund" } });
  assert.equal(toCopper(purse(next, "ship").coins), 1);
  // No party fund: a fund (purse) split keeps the leftover in the source.
  const bare = campaign({ fund: false });
  assert.equal(designatedPartyFund(bare), null);
  next = split(bare, dm, { sourceId: "aria", copper: 2501, recipientIds: ["aria", "bram", "cass"], remainder: { rule: "party-fund" } });
  assert.equal(toCopper(purse(next, "aria").coins), 835);
  assert.match(next.ledger.find((l) => l.id === "split-1-source")!.summary, /no party fund, so the 2 cp left over stayed here/);
  // ... and an encounter split sends it to the first ticked character unless the DM chose.
  const enc = planCoinSplit(bare, { sourceId: null, copper: 3447, recipientIds: ["bram", "aria"], rule: "party-fund" }, { actor: "dm" });
  assert.equal(enc.remainderTo, "bram");
  assert.equal(enc.reason, "no-fund-recipient");
  // Chosen recipient must be ticked.
  assert.throws(() => split(t, dm, { sourceId: "hoard", copper: 7039, recipientIds: four, remainder: { rule: "recipient", purseId: "mirelle" } }), /Choose who gets the leftover/);
  next = split(t, dm, { sourceId: "hoard", copper: 7039, recipientIds: four, remainder: { rule: "recipient", purseId: "cass" } });
  assert.equal(toCopper(purse(next, "cass").coins) - toCopper(purse(t, "cass").coins), 1762);
  // Rotation: first recipient after the pointer in Party order, wrapping, and saved.
  assert.equal(nextInRotation(t, four), "aria");
  next = split(t, dm, { sourceId: "hoard", copper: 7039, recipientIds: four, remainder: { rule: "rotate" } });
  assert.deepEqual(next.journal!.coinSplit?.rotation, { lastPurseId: "aria" });
  assert.equal(nextInRotation(next, four), "bram");
  next.journal!.coinSplit = { rotation: { lastPurseId: "ambrose" } };
  assert.equal(nextInRotation(next, four), "aria");
  next.journal!.coinSplit = { rotation: { lastPurseId: "deleted" } };
  assert.equal(nextInRotation(next, ["cass", "bram"]), "bram");
  // The DM may save the rule as the campaign default.
  next = split(t, dm, { sourceId: "hoard", copper: 7039, recipientIds: four, remainder: { rule: "rotate" }, makeDefault: true });
  assert.equal(next.journal!.coinSplit?.remainderRule, "rotate");
});

test("a changed preview is refused and nothing moves", () => {
  const t = campaign();
  assert.throws(
    () => split(t, dm, { sourceId: "hoard", copper: 7039, recipientIds: four, remainder: { rule: "rotate" }, expect: { share: 1759, remainderTo: "bram" } }),
    /The split changed/,
  );
  assert.throws(
    () => split(t, dm, { sourceId: "hoard", copper: 7039, recipientIds: four, remainder: { rule: "party-fund" }, expect: { share: 1760, remainderTo: "hoard" } }),
    /The split changed/,
  );
  // More than the balance.
  assert.throws(
    () => split(t, dm, { sourceId: "hoard", copper: 7040, recipientIds: four, remainder: { rule: "party-fund" } }),
    /The Hoard holds only 70 gp, 3 sp, 9 cp/,
  );
  assert.equal(toCopper(purse(t, "hoard").coins), 7039);
});

test("permissions: the server refuses players without control, guests, NPC recipients and DM-only options", () => {
  const t = campaign();
  const attempt = (seat: CloudSeat, input: Parameters<typeof split>[2]) => () => split(t, seat, input);
  const base = { sourceId: "hoard", copper: 7039, recipientIds: four, remainder: { rule: "party-fund" as const } };
  // A player without "Allow party fund" does not control the fund.
  assert.throws(attempt(player("aria"), base), /permission to spend from this account/);
  // Another character's purse.
  assert.throws(attempt(player("aria"), { ...base, sourceId: "bram", copper: 1000 }), /permission to spend/);
  // A guest seat controls nothing.
  assert.throws(attempt(player(), { ...base, sourceId: "aria", copper: 1000 }), /permission to spend/);
  // Players cannot pay NPCs; the DM can.
  const allowed = player("aria", "hoard", "ship");
  assert.throws(attempt(allowed, { ...base, recipientIds: [...four, "dunstan"] }), /Only the DM can include NPCs/);
  assert.doesNotThrow(attempt(dm, { ...base, recipientIds: [...four, "dunstan"] }));
  // Party funds, location NPCs and characters away from the party are never recipients.
  assert.throws(attempt(dm, { ...base, recipientIds: ["aria", "ship"] }), /party funds are not split recipients/);
  const local = character("local", "Harbourmaster", { gp: 9 }, { nonParty: true, control: "npc" });
  assert.throws(
    () => planCoinSplit({ ...t, purses: [...t.purses, local] }, { sourceId: "hoard", copper: 100, recipientIds: ["aria", "local"], rule: "party-fund" }, { actor: "dm" }),
    /not a party character/,
  );
  assert.throws(attempt(dm, { ...base, recipientIds: ["aria", "mirelle"] }), /not travelling with the party/);
  // Saving a default and naming another fund are DM-only.
  assert.throws(attempt(allowed, { ...base, makeDefault: true }), /Only the DM/);
  assert.throws(
    attempt(allowed, { ...base, sourceId: "aria", copper: 2501, remainder: { rule: "party-fund", purseId: "ship" } }),
    /Only the DM can send the leftover to a different party fund/,
  );
  // With "Allow party fund" a player may split the fund among party players.
  const next = split(t, allowed, base);
  assert.equal(toCopper(purse(next, "hoard").coins), 3);
  assert.deepEqual(
    splitRecipients(t, "player").map((p) => p.id),
    four,
  );
});

test("a split that pays an NPC keeps its text DM-only", () => {
  const t = campaign({ funds: { gp: 10, cp: 2 } });
  const next = split(t, dm, { sourceId: "hoard", copper: 1002, recipientIds: [...four, "dunstan"], remainder: { rule: "party-fund" } });
  const event = next.journal!.events.at(-1)!;
  assert.equal(event.dmOnly, true);
  assert.equal(event.split?.n, 5);
  assert.equal(next.notes.at(-1)!.to, "dm");
  assert.equal(next.notes.at(-1)!.purseId, "dunstan");
  assert.equal(next.ledger.find((l) => l.id === "split-1-source")!.summary, "Coin split");
  assert.equal(next.ledger.find((l) => l.id === "split-1-source")!.copper, -1000);
});

test("encounter splits use the same planner and credit, and conserve the award", () => {
  const t = campaign();
  const before = total(t);
  const result = applyEncounterSplit(
    t,
    { purseIds: four, remainderRule: "party-fund" },
    3447,
    "receipt-1",
    1,
    "Goblin ambush",
  );
  assert.equal(result.plan.share, 861);
  assert.deepEqual(result.receipt.coinRemainder, { purseId: "hoard", copper: 3, rule: "party-fund" });
  assert.equal(result.receipt.coinShares.length, 4);
  assert.equal(total(t), before + 3447);
  assert.equal(result.ledger.reduce((sum, l) => sum + l.copper, 0), 3447);
  assert.deepEqual(fromCopper(861), coins({ gp: 8, sp: 6, cp: 1 }));
  assert.throws(
    () => applyEncounterSplit(campaign(), { purseIds: four, remainderRule: "party-fund" }, 3, "r", 1, "x"),
    /Too little to split/,
  );
});
