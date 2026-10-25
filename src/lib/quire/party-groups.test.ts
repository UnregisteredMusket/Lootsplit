// Split the party (docs/WORLD-FEATURES.md "Split the party"): the data model, the DM's group
// commands, per-group presence, membership, merge, downtime return, boarding alone, player move
// requests, the player projection and tabletop protocol 10 (older apps).
import test from "node:test";
import assert from "node:assert/strict";
import type { CloudTable } from "./cloud.ts";
import { applyCommandBatch, type Command } from "./commands.ts";
import { projectRecord } from "./session-records.ts";
import { preserveJournalMetadata, readJournal } from "./journal.ts";
import { characterLocation, characterPosition, companionFundsShared, seatInParty } from "./character-position.ts";
import { npcAvailableHere, shopVisible, validateWorld } from "./world.ts";
import {
  actingGroups,
  groupMembers,
  groupPlace,
  partyGroupsFingerprint,
  partySplit,
  seatGroups,
} from "./party-groups.ts";
import {
  PARTY_GROUPS_PROTOCOL,
  CURRENT_TABLETOP_PROTOCOL,
  hasPartyGroups,
  refuseOldClientGroupActions,
  tableForProtocol,
  tabletopResponse,
} from "./tabletop-protocol.ts";
import { journeyTravellers } from "./journey-engine.ts";
import { planCoinSplit } from "./coin-split.ts";
import { defaultShip, type Vessel } from "./ships-schema.ts";
import { shipFingerprint } from "./ships.ts";
import { worldSchema } from "./world-schema.ts";
import { canonicalJson } from "./canonical-json.ts";
import { alex, dm, partyFixture, run, sam, splitFixture } from "./test-fixtures/party-groups.ts";

const purse = (t: CloudTable, id: string) => t.purses.find((p) => p.id === id)!;
const where = (t: CloudTable, id: string) => characterLocation(t, purse(t, id));

test("a party that was never split reads exactly as before", () => {
  const t = partyFixture();
  assert.equal(partySplit(t), false);
  assert.deepEqual(seatGroups(t, sam), ["main"]);
  assert.equal(where(t, "brannoc"), "harbour");
  assert.equal(where(t, "garrick"), "harbour");
  assert.equal(shopVisible(t.shops.find((s) => s.id === "chandlery")!, t), true);
  assert.equal(shopVisible(t.shops.find((s) => s.id === "armoury")!, t), false);
  assert.equal(hasPartyGroups(t), false);
  // Older apps receive the very same table; nothing to strip.
  assert.equal(tableForProtocol(t, 9), t);
  const projected = projectRecord(t, sam);
  assert.equal(projected.journal?.world?.groups, undefined);
  assert.equal(projected.journal?.world?.mainGroup, undefined);
  assert.deepEqual(projected.shops.map((s) => s.id).sort(), ["chandlery", "peddler"]);
  assert.equal(JSON.stringify(projected).includes("groupId"), false);
});

test("party-split: the DM splits; groups stay in the party and go to their own place", () => {
  const t = splitFixture();
  assert.equal(partySplit(t), true);
  const w = t.journal!.world!;
  assert.deepEqual(w.mainGroup, { name: "Harbour watch", colour: "green" });
  assert.equal(w.groups![0]!.letter, "B");
  assert.equal(w.groups![0]!.locationId, "ironhold");
  assert.equal(t.journal!.market!.currentLocationId, "harbour", "the main group keeps the party's place");
  for (const id of ["tamsin", "kettle", "maud"]) {
    assert.equal(characterPosition(t, purse(t, id)).inParty, true, id);
    assert.equal(characterPosition(t, purse(t, id)).groupId, "riders", id);
    assert.equal(where(t, id), "ironhold", id);
  }
  assert.equal(where(t, "brannoc"), "harbour");
  assert.equal(where(t, "garrick"), "harbour");
  assert.deepEqual(groupMembers(t, "main").map((p) => p.id).sort(), ["brannoc", "garrick", "oriel"]);
  // Nothing charged, no time passed.
  assert.deepEqual(t.ledger, []);
  assert.equal(t.journal!.finance!.day, 14);
  // The public event names the groups only; the DM's record has places and members.
  const events = t.journal!.events;
  assert.ok(events.some((e) => !e.dmOnly && /split into 2 groups: Harbour watch, Ironhold riders/.test(e.summary)));
  assert.ok(events.some((e) => e.dmOnly && /Ironhold riders at Ironhold \(Tamsin Reed, Kettle, Sister Maud\)/.test(e.summary)));
  assert.ok(!events.some((e) => !e.dmOnly && /Sister Maud/.test(e.summary)));
});

test("party-split refusals: players, stale screens, empty or impossible groups, pending downtime", () => {
  const t = partyFixture();
  const split = (groups: unknown, extra: Record<string, unknown> = {}, seat = dm, table = t) =>
    run(table, { kind: "party-split", before: partyGroupsFingerprint(table), groups, ...extra } as never, seat);
  const riders = [{ id: "riders", name: "Riders", colour: "blue", locationId: "ironhold", memberIds: ["tamsin"] }];
  assert.throws(() => split(riders, {}, alex), /Only the DM/);
  assert.throws(() => split(riders, { before: "stale" }), /groups changed. Refresh/);
  assert.throws(() => split([{ ...riders[0], memberIds: [] }]), /too_small|at least|Too small/i);
  assert.throws(() => split([{ ...riders[0], memberIds: ["durra"] }]), /isn't in the party/);
  assert.throws(() => split([{ ...riders[0], id: "main" }]), /new, unique ID/);
  assert.throws(() => split([{ ...riders[0], colour: "green" }]), /own colour/);
  assert.throws(
    () => split([{ ...riders[0], memberIds: ["brannoc", "oriel", "tamsin", "kettle", "garrick", "maud"] }]),
    /Keep at least one character in/,
  );
  assert.throws(
    () => split([riders[0], { ...riders[0], id: "b2", colour: "amber", memberIds: ["tamsin"] }]),
    /only one group/,
  );
  // Six groups at most: main plus five.
  const many = ["oriel", "tamsin", "kettle", "garrick", "maud"].map((id, i) => ({
    id: `g${i}`,
    name: `G${i}`,
    colour: ["blue", "amber", "plum", "teal", "red"][i],
    locationId: null,
    memberIds: [id],
  }));
  const five = split(many);
  assert.deepEqual(five.journal!.world!.groups!.map((g) => g.letter), ["B", "C", "D", "E", "F"]);
  assert.throws(() => split([{ ...many[0], id: "g9", memberIds: ["oriel"] }], {}, dm, five), /at most 6 groups/);
  // Character downtime: not in the party, so not in a group.
  const away = run(t, {
    kind: "character-downtime-start",
    purseId: "kettle",
    before: characterPosition(t, purse(t, "kettle")),
    name: "Tracking",
    days: 2,
    locationId: null,
  } as never);
  assert.throws(() => split([{ ...riders[0], memberIds: ["kettle"] }], {}, dm, away), /isn't in the party/);
  // Pending campaign downtime freezes splitting, like moving the party.
  const pending = run(t, { kind: "downtime-plan", name: "Rest", days: 1 } as never);
  assert.throws(() => split(riders, {}, dm, pending), /pending downtime/);
});

test("presence: each group buys, sells and bargains at its own place only", () => {
  const t = splitFixture();
  const buy = (stockId: string, purseId: string, seat = purseId === "tamsin" ? alex : sam) =>
    run(t, { kind: "buy", stockId, purseId, quantity: 1 } as never, seat);
  assert.throws(() => buy("rope", "tamsin"), /isn't where Tamsin Reed's group \(Ironhold riders\) is/);
  assert.equal(buy("sword", "tamsin").purses.find((p) => p.id === "tamsin")!.coins.cp !== undefined, true);
  assert.throws(() => buy("sword", "brannoc"), /isn't where Brannoc Vale's group \(Harbour watch\) is/);
  buy("rope", "brannoc");
  // Shops with no location work for every group.
  buy("sack", "tamsin");
  buy("sack", "brannoc");
  // The DM's tools are unchanged: no presence check.
  run(t, { kind: "buy", stockId: "rope", purseId: "tamsin", quantity: 1 } as never, dm);
  // Selling follows the seller's group.
  assert.throws(
    () => run(t, { kind: "sell", holdingId: "lantern", shopId: "chandlery", quantity: 1 } as never, alex),
    /Tamsin Reed's group/,
  );
  run(t, { kind: "sell", holdingId: "lantern", shopId: "armoury", quantity: 1 } as never, alex);
  run(t, { kind: "sell", holdingId: "pelt", shopId: "chandlery", quantity: 1 } as never, sam);
  // Property listings follow the buyer's group.
  assert.throws(
    () => run(t, { kind: "listing", listingId: "cottage", purseId: "brannoc", quantity: 1 } as never, sam),
    /This property isn't where Brannoc Vale's group/,
  );
  run(t, { kind: "listing", listingId: "cottage", purseId: "tamsin", quantity: 1 } as never, alex);
  assert.throws(
    () => run(t, { kind: "listing", listingId: "shed", purseId: "tamsin", quantity: 1 } as never, alex),
    /Tamsin Reed's group/,
  );
  // NPCs: Master Durra is in Ironhold, Sister Ilse in Harbour ward.
  const durra = t.journal!.world!.npcs.find((n) => n.id === "durra")!;
  const ilse = t.journal!.world!.npcs.find((n) => n.id === "ilse")!;
  assert.equal(npcAvailableHere(durra, t, actingGroups(t, "tamsin")), true);
  assert.equal(npcAvailableHere(durra, t, actingGroups(t, "brannoc")), false);
  assert.equal(npcAvailableHere(ilse, t, actingGroups(t, "brannoc")), true);
  assert.equal(npcAvailableHere(ilse, t, actingGroups(t, "tamsin")), false);
  // A companion is "here" for its own group only.
  const garrick = t.journal!.world!.npcs.find((n) => n.id === "garrick")!;
  assert.equal(npcAvailableHere(garrick, t, ["main"]), true);
  assert.equal(npcAvailableHere(garrick, t, ["riders"]), false);
  assert.throws(
    () => run(t, { kind: "npc-message", npcId: "durra", purseId: "brannoc", asNpc: false, text: "Hello" } as never, sam),
    /not available at the current location/,
  );
  run(t, { kind: "npc-message", npcId: "durra", purseId: "tamsin", asNpc: false, text: "Hello" } as never, alex);
  const offer = (actorId: string, seat = sam) =>
    run(
      t,
      {
        kind: "trade-offer",
        tradeId: `trade-${actorId}`,
        revision: null,
        actorId,
        left: { purseId: actorId, copper: 10, items: [] },
        right: { purseId: "durra", copper: 0, items: [] },
        note: "",
      } as never,
      seat,
    );
  assert.throws(() => offer("brannoc"), /not available for bartering/);
  offer("tamsin", alex);
});

test("membership is shared while split: balances, companions, pool, fairness and splits", () => {
  const t = splitFixture();
  assert.equal(seatInParty(t, sam), true);
  assert.equal(seatInParty(t, alex), true);
  const withCompanions = run(t, { kind: "companion-funds-visibility", before: false, visible: true } as never);
  assert.equal(companionFundsShared(withCompanions, purse(withCompanions, "garrick")), true);
  // A coin split from the party fund may include both groups.
  const plan = planCoinSplit(t, { sourceId: "hoard", copper: 3000, recipientIds: ["brannoc", "tamsin"], rule: "party-fund" }, { actor: "dm" });
  assert.equal(plan.share, 1500);
  run(t, {
    kind: "coin-split",
    sourceId: "hoard",
    copper: 3000,
    recipientIds: ["brannoc", "tamsin"],
    remainder: { rule: "party-fund" },
    expect: { share: plan.share, remainderTo: plan.remainderTo },
  } as never);
  // Give between groups works as today, with no presence check.
  const given = run(t, { kind: "give", holdingId: "pelt", fromId: "brannoc", toId: "tamsin", copper: 0, quantity: 1 } as never, sam);
  assert.ok(given.holdings.some((h) => h.purseId === "tamsin" && h.name === "Wolf pelt"));
});

test("journeys still move the main group only, and name who stays with another group", () => {
  const t = splitFixture();
  assert.deepEqual(journeyTravellers(t).map((p) => p.id).sort(), ["brannoc", "garrick", "oriel"]);
  assert.deepEqual(journeyTravellers(t, "riders").map((p) => p.id).sort(), ["kettle", "maud", "tamsin"]);
});

test("party-location and party-map-position move one group; main keeps today's command", () => {
  let t = splitFixture();
  assert.throws(
    () => run(t, { kind: "party-location", groupId: "riders", before: "harbour", locationId: "undercroft" } as never),
    /moved elsewhere/,
  );
  assert.throws(
    () => run(t, { kind: "party-location", groupId: "riders", before: "ironhold", locationId: "undercroft" } as never, alex),
    /Only the DM/,
  );
  t = run(t, { kind: "party-location", groupId: "riders", before: "ironhold", locationId: "undercroft" } as never);
  assert.equal(groupPlace(t, "riders").locationId, "undercroft");
  assert.equal(t.journal!.market!.currentLocationId, "harbour");
  t = run(t, { kind: "party-location", before: "harbour", locationId: "ford" } as never);
  assert.equal(where(t, "brannoc"), "ford");
  assert.equal(where(t, "tamsin"), "undercroft");
  // Removing a group's location is refused like removing the party's.
  const undercroft = t.journal!.market!.locations.find((l) => l.id === "undercroft")!;
  assert.throws(
    () => run(t, { kind: "market-location", locationId: "undercroft", before: undercroft, after: null } as never),
    /Move the party/,
  );
});

test("party-group-edit and party-group-assign", () => {
  let t = splitFixture();
  const edit = (input: Record<string, unknown>, table = t) =>
    run(table, { kind: "party-group-edit", before: partyGroupsFingerprint(table), ...input } as never);
  assert.throws(() => edit({ groupId: "main", name: "Watch", colour: "green", hidden: true }), /can't be hidden/);
  assert.throws(() => edit({ groupId: "riders", name: "Riders", colour: "green", hidden: false }), /own colour/);
  t = edit({ groupId: "riders", name: "Ironhold riders", colour: "teal", hidden: true });
  assert.equal(t.journal!.world!.groups![0]!.hidden, true);
  t = edit({ groupId: "main", name: "Harbour watch", colour: "amber", hidden: false });
  assert.equal(t.journal!.world!.mainGroup!.colour, "amber");
  const assign = (purseId: string, groupId: string, table = t) =>
    run(table, { kind: "party-group-assign", before: partyGroupsFingerprint(table), purseId, groupId } as never);
  t = assign("oriel", "riders");
  assert.equal(where(t, "oriel"), "ironhold");
  assert.throws(() => assign("oriel", "riders"), /already in Ironhold riders/);
  assert.throws(() => assign("durra", "riders"), /isn't in the party/);
  // The last characters of a group: merge it instead.
  let lonely = splitFixture();
  lonely = assign("kettle", "main", lonely);
  lonely = assign("maud", "main", lonely);
  assert.throws(() => assign("tamsin", "main", lonely), /would be empty. Merge it instead/);
});

test("merge: same place (or one inside the other) merges; others wait", () => {
  let t = splitFixture();
  const merge = (groupIds: string[], intoLocationId: string | null, table = t) =>
    run(table, { kind: "party-merge", before: partyGroupsFingerprint(table), groupIds, intoLocationId } as never);
  assert.throws(() => merge(["main", "riders"], "harbour"), /same place/);
  // Main moves to Ironhold; riders go down into the Undercroft (inside Ironhold).
  t = run(t, { kind: "party-location", before: "harbour", locationId: "ironhold" } as never);
  t = run(t, { kind: "party-location", groupId: "riders", before: "ironhold", locationId: "undercroft" } as never);
  assert.throws(() => merge(["main", "riders"], "ford"), /one of the groups' places/);
  const pending = run(t, { kind: "downtime-plan", name: "Rest", days: 1 } as never);
  assert.throws(() => merge(["main", "riders"], "ironhold", pending), /pending downtime/);
  t = merge(["main", "riders"], "ironhold");
  assert.equal(partySplit(t), false);
  assert.equal(t.journal!.world!.mainGroup, undefined, "the party is whole again");
  assert.equal(t.journal!.world!.groups![0]!.status, "merged", "merged groups stay as history");
  assert.equal(t.journal!.world!.groups![0]!.mergedInto, "main");
  for (const id of ["tamsin", "kettle", "maud", "brannoc"]) {
    assert.equal(characterPosition(t, purse(t, id)).groupId, undefined, id);
    assert.equal(where(t, id), "ironhold", id);
  }
  assert.ok(t.journal!.events.some((e) => /regrouped at Ironhold/.test(e.summary)));
  validateWorld(t);
});

test("merge waits for a group on the road", () => {
  let t = splitFixture();
  t = run(t, { kind: "party-location", groupId: "riders", before: "ironhold", locationId: "harbour" } as never);
  t.journal!.world!.groups![0]!.locationId = null;
  t.journal!.world!.groups![0]!.position = { environment: "Roads", description: "On the road" };
  assert.throws(
    () => run(t, { kind: "party-merge", before: partyGroupsFingerprint(t), groupIds: ["main", "riders"], intoLocationId: "harbour" } as never),
    /Ironhold riders is on the road/,
  );
});

test("downtime: a character returns to its group, the group it merged into, or the main group", () => {
  let t = splitFixture();
  const start = (table: CloudTable) =>
    run(table, {
      kind: "character-downtime-start",
      purseId: "kettle",
      before: characterPosition(table, purse(table, "kettle")),
      name: "Tracking in the Fens",
      days: 2,
      locationId: null,
    } as never);
  const cancel = (table: CloudTable) =>
    run(table, { kind: "character-downtime-cancel", purseId: "kettle", before: characterPosition(table, purse(table, "kettle")) } as never);
  t = start(t);
  const away = characterPosition(t, purse(t, "kettle"));
  assert.equal(away.inParty, false);
  assert.equal(away.groupId, undefined);
  assert.equal(away.downtime!.returnGroupId, "riders");
  assert.equal(characterPosition(cancel(t), purse(t, "kettle")).groupId, "riders");
  // Riders merge back while Kettle is away: Kettle returns to the main group.
  let merged = run(t, { kind: "party-location", groupId: "riders", before: "ironhold", locationId: "harbour" } as never);
  merged = run(merged, { kind: "party-merge", before: partyGroupsFingerprint(merged), groupIds: ["main", "riders"], intoLocationId: "harbour" } as never);
  const back = characterPosition(cancel(merged), purse(merged, "kettle"));
  assert.equal(back.inParty, true);
  assert.equal(back.groupId, undefined);
  // Two groups merge into the riders (main not involved): Kettle follows the merge.
  let two = splitFixture();
  two = run(two, {
    kind: "party-split",
    before: partyGroupsFingerprint(two),
    groups: [{ id: "scouts", name: "Scouts", colour: "amber", locationId: "ironhold", memberIds: ["kettle"] }],
  } as never);
  two = start(two);
  assert.equal(characterPosition(two, purse(two, "kettle")).downtime!.returnGroupId, "scouts");
  two = run(two, { kind: "party-merge", before: partyGroupsFingerprint(two), groupIds: ["riders", "scouts"], intoLocationId: "ironhold" } as never);
  assert.equal(characterPosition(cancel(two), purse(two, "kettle")).groupId, "riders");
});

test("boarding alone leaves the party as today; landing where the group is rejoins it", () => {
  let t = splitFixture();
  t.holdings.push({ id: "gull", name: "The Gull's Wager", kind: "property", quantity: 1, unitCopper: 10000, purseId: "hoard", notes: "", locationId: "ironhold", property: { type: "other" } } as never);
  const vessel: Vessel = { ...defaultShip(), propertyId: "gull", mode: "docked", facilityId: null, installed: [], arrearsCopper: 0, expenseRemainder: 0, dmNotes: "" };
  t = run(t, { kind: "ship-configure", before: null, vessel } as never);
  const board = (table: CloudTable, action: "board" | "disembark") =>
    run(table, { kind: "ship-board", propertyId: "gull", purseId: "tamsin", action, before: shipFingerprint(table, "gull") } as never);
  t = board(t, "board");
  assert.equal(characterPosition(t, purse(t, "tamsin")).inParty, false);
  assert.equal(characterPosition(t, purse(t, "tamsin")).groupId, undefined);
  assert.equal(t.journal!.fleet!.aboard[0]!.returnGroupId, "riders");
  const landed = board(t, "disembark");
  assert.equal(characterPosition(landed, purse(landed, "tamsin")).inParty, true);
  assert.equal(characterPosition(landed, purse(landed, "tamsin")).groupId, "riders");
  // Main group moves to Ironhold and the riders go elsewhere: Tamsin lands with the main group.
  let moved = run(t, { kind: "party-location", groupId: "riders", before: "ironhold", locationId: "ford" } as never);
  moved = run(moved, { kind: "party-location", before: "harbour", locationId: "ironhold" } as never);
  const other = board(moved, "disembark");
  assert.equal(characterPosition(other, purse(other, "tamsin")).inParty, true);
  assert.equal(characterPosition(other, purse(other, "tamsin")).groupId, undefined);
});

test("player move requests: only for their own group; approve moves once; deny moves nothing", () => {
  let t = splitFixture();
  const ask = (seat = alex, extra: Record<string, unknown> = {}, table = t) =>
    run(table, { kind: "party-group-request", requestId: "req-1", groupId: "riders", purseId: "tamsin", locationId: "undercroft", message: "We follow the smugglers' tunnel.", ...extra } as never, seat);
  assert.throws(() => ask(sam, { purseId: "brannoc" }), /only a group your character is in/);
  assert.throws(() => ask(sam), /Ask for your own character's group/);
  assert.throws(() => ask(dm), /the DM moves it directly/);
  assert.throws(() => ask(alex, { locationId: "ironhold" }), /already there/);
  t = ask();
  assert.equal(groupPlace(t, "riders").locationId, "ironhold", "nothing moves until the DM approves");
  assert.throws(() => ask(alex, { requestId: "req-2" }), /already has a move waiting/);
  // Sam can't see or withdraw Alex's request.
  assert.equal(projectRecord(t, sam).journal?.world?.groupRequests, undefined);
  assert.equal(projectRecord(t, alex).journal?.world?.groupRequests?.length, 1);
  assert.throws(() => run(t, { kind: "party-group-request-withdraw", requestId: "req-1" } as never, sam), /Only the player who asked/);
  assert.throws(() => run(t, { kind: "party-group-request-review", requestId: "req-1", approve: true } as never, alex), /Only the DM/);
  const approved = run(t, { kind: "party-group-request-review", requestId: "req-1", approve: true } as never);
  assert.equal(groupPlace(approved, "riders").locationId, "undercroft");
  assert.throws(() => run(approved, { kind: "party-group-request-review", requestId: "req-1", approve: true } as never), /already decided/);
  const denied = run(t, { kind: "party-group-request-review", requestId: "req-1", approve: false, reason: { text: "The tunnel is flooded.", showToPlayer: true } } as never);
  assert.equal(groupPlace(denied, "riders").locationId, "ironhold");
  assert.equal(projectRecord(denied, alex).journal!.world!.groupRequests![0]!.reason!.text, "The tunnel is flooded.");
  const quiet = run(t, { kind: "party-group-request-review", requestId: "req-1", approve: false, reason: { text: "Secret", showToPlayer: false } } as never);
  assert.equal(projectRecord(quiet, alex).journal!.world!.groupRequests![0]!.reason, undefined);
  const withdrawn = run(t, { kind: "party-group-request-withdraw", requestId: "req-1" } as never, alex);
  assert.equal(withdrawn.journal!.world!.groupRequests![0]!.status, "withdrawn");
});

test("privacy: a hidden group is 'Elsewhere' for other groups' players; its own players and the DM see it", () => {
  let t = splitFixture();
  t = run(t, { kind: "party-group-edit", before: partyGroupsFingerprint(t), groupId: "riders", name: "Ironhold riders", colour: "blue", hidden: true } as never);
  const forSam = projectRecord(t, sam);
  const riders = forSam.journal!.world!.groups!.find((g) => g.id === "riders")!;
  assert.equal(riders.hidden, true);
  assert.equal(riders.locationId, null);
  assert.deepEqual(riders.position, { environment: "Other", description: "Elsewhere" });
  assert.equal(JSON.stringify(forSam.journal!.world!.groups).includes("ironhold"), false);
  // Sam sees Harbour ward shops only, never Ironhold's.
  assert.deepEqual(forSam.shops.map((s) => s.id).sort(), ["chandlery", "peddler"]);
  assert.equal(forSam.listings.some((l) => l.id === "cottage"), false);
  assert.equal(forSam.journal!.world!.npcs.some((n) => n.id === "durra"), false);
  // Alex (in the hidden group) sees it in full, and Ironhold's shops, not Saltmarsh's.
  const forAlex = projectRecord(t, alex);
  assert.equal(forAlex.journal!.world!.groups![0]!.locationId, "ironhold");
  assert.equal(forAlex.journal!.world!.groups![0]!.position, undefined);
  assert.deepEqual(forAlex.shops.map((s) => s.id).sort(), ["armoury", "peddler"]);
  assert.ok(forAlex.listings.some((l) => l.id === "cottage"));
  assert.ok(forAlex.journal!.world!.npcs.some((n) => n.id === "durra"));
  assert.ok(forAlex.journal!.market!.locations.some((l) => l.id === "ironhold"));
  // Hidden members are never shown as members to players.
  for (const view of [forSam, forAlex])
    assert.equal(view.journal!.world!.characterPositions.find((s) => s.purseId === "maud")?.groupId, undefined);
  // The DM sees everything.
  const forDm = projectRecord(t, dm);
  assert.equal(forDm.journal!.world!.groups![0]!.locationId, "ironhold");
  assert.equal(forDm.journal!.world!.characterPositions.find((s) => s.purseId === "maud")!.groupId, "riders");
  // Projected tables still validate.
  validateWorld(forSam, true);
  validateWorld(forAlex, true);
  // Not hidden: Sam sees where the riders are (the owner's default).
  const shown = projectRecord(splitFixture(), sam);
  assert.equal(shown.journal!.world!.groups![0]!.locationId, "ironhold");
  assert.ok(shown.journal!.market!.locations.some((l) => l.id === "ironhold"));
});

test("protocol 10: older apps get one party at the main group's place and keep groups on write", () => {
  assert.equal(PARTY_GROUPS_PROTOCOL, 10);
  assert.equal(CURRENT_TABLETOP_PROTOCOL, 10);
  let t = splitFixture();
  t = run(t, {
    kind: "character-downtime-start",
    purseId: "kettle",
    before: characterPosition(t, purse(t, "kettle")),
    name: "Tracking",
    days: 2,
    locationId: null,
  } as never);
  t = run(t, { kind: "party-group-request", requestId: "req-old", groupId: "riders", purseId: "tamsin", locationId: "undercroft" } as never, alex);
  t.journal!.reports = [{ id: "r1", name: "Session", at: 1, snapshot: JSON.stringify(t) } as never];
  assert.equal(hasPartyGroups(t), true);
  assert.equal(tableForProtocol(t, 10), t);
  for (const protocol of [0, 3, 7, 9]) {
    const old = tableForProtocol(t, protocol);
    assert.equal(hasPartyGroups(old), false, `protocol ${protocol}`);
    const text = JSON.stringify(old);
    assert.equal(/"groups":\[|"mainGroup"|"groupRequests"|"groupId"|"returnGroupId"/.test(text), false, `protocol ${protocol}`);
    worldSchema.parse(old.journal!.world);
  }
  const old = tableForProtocol(t, 9);
  // Everyone in the party reads as standing at the main group's place.
  assert.equal(characterLocation(old, purse(old, "tamsin")), "harbour");
  // A whole-journal write from an older app keeps the groups and each character's group.
  const written = preserveJournalMetadata(old.journal, readJournal(t.journal));
  assert.deepEqual(written.world!.groups, t.journal!.world!.groups);
  assert.deepEqual(written.world!.mainGroup, t.journal!.world!.mainGroup);
  assert.deepEqual(written.world!.groupRequests, t.journal!.world!.groupRequests);
  assert.equal(written.world!.characterPositions.find((s) => s.purseId === "tamsin")!.groupId, "riders");
  assert.equal(written.world!.characterPositions.find((s) => s.purseId === "kettle")!.downtime!.returnGroupId, "riders");
  // The server refuses an older app's actions for characters outside the main group.
  assert.throws(
    () => refuseOldClientGroupActions(t, [{ kind: "buy", stockId: "sword", purseId: "tamsin", quantity: 1 } as Command]),
    /The party is split into groups. Update Lootsplitter to act for Tamsin Reed\./,
  );
  assert.throws(
    () => refuseOldClientGroupActions(t, [{ kind: "sell", holdingId: "lantern", shopId: "armoury", quantity: 1 } as Command]),
    /act for Tamsin Reed/,
  );
  refuseOldClientGroupActions(t, [{ kind: "buy", stockId: "rope", purseId: "brannoc", quantity: 1 } as Command]);
  refuseOldClientGroupActions(partyFixture(), [{ kind: "buy", stockId: "rope", purseId: "tamsin", quantity: 1 } as Command]);
  // An older app's placement form (no group in `before`) gets the same clear message.
  const tamsinOld = characterPosition(old, purse(old, "tamsin"));
  assert.throws(
    () => run(t, { kind: "character-position", purseId: "tamsin", before: tamsinOld, inParty: true, locationId: null, visible: true, sheetVisible: true } as never),
    /Update Lootsplitter to act for Tamsin Reed/,
  );
  // Pending drafts with group commands ask older apps to finish on the updated website.
  const draft = JSON.stringify([{ id: "x", kind: "party-merge", before: "", groupIds: ["main", "riders"], intoLocationId: null }]);
  assert.throws(() => tabletopResponse({ table: t, draft }, 9), /unfinished map actions/);
  assert.equal(tabletopResponse({ table: t, draft }, 10).table, t);
});

test("the placement form keeps a character's group; leaving the party drops it", () => {
  const t = splitFixture();
  const before = characterPosition(t, purse(t, "tamsin"));
  const hidden = run(t, { kind: "character-position", purseId: "tamsin", before, inParty: true, locationId: null, visible: true, sheetVisible: false } as never);
  assert.equal(characterPosition(hidden, purse(hidden, "tamsin")).groupId, "riders");
  const left = run(t, { kind: "character-position", purseId: "tamsin", before, inParty: false, locationId: "ford", visible: true, sheetVisible: true } as never);
  assert.equal(characterPosition(left, purse(left, "tamsin")).groupId, undefined);
  assert.equal(characterLocation(left, purse(left, "tamsin")), "ford");
  // Leaving the party is unchanged; rejoining puts them with the main group.
  const back = run(left, { kind: "character-position", purseId: "tamsin", before: characterPosition(left, purse(left, "tamsin")), inParty: true, locationId: null, visible: true, sheetVisible: true } as never);
  assert.equal(characterLocation(back, purse(back, "tamsin")), "harbour");
});

test("a batch is all-or-nothing: a stale step leaves the groups unchanged", () => {
  const t = splitFixture();
  const moveRiders: Command = { id: "b1", kind: "party-location", groupId: "riders", before: "ironhold", locationId: "harbour" } as Command;
  const merge: Command = { id: "b2", kind: "party-merge", before: "stale", groupIds: ["main", "riders"], intoLocationId: "harbour" } as Command;
  assert.throws(() => applyCommandBatch(t, dm, [moveRiders, merge]), /groups changed/);
  assert.equal(groupPlace(t, "riders").locationId, "ironhold");
  const ok = applyCommandBatch(t, dm, [moveRiders, { ...merge, before: canonicalJson(null) } as Command].map((c, i) =>
    i === 1 ? ({ ...c, before: partyGroupsFingerprint(applyCommandBatch(t, dm, [moveRiders])) } as Command) : c,
  ));
  assert.equal(partySplit(ok), false);
});

test("old saves: a campaign without groups projects byte-identically to the code before groups", async () => {
  // party-groups-unsplit.golden.json was written by the same calls on origin/main (2a2cf1c).
  const { readFileSync } = await import("node:fs");
  const { libraryRecords } = await import("./library-records.ts");
  const { staysBehind } = await import("./journey-engine.ts");
  const golden = readFileSync(new URL("./test-fixtures/party-groups-unsplit.golden.json", import.meta.url), "utf8");
  const t = partyFixture();
  const now = {
    sam: projectRecord(t, sam),
    alex: projectRecord(t, alex),
    dm: projectRecord(t, dm),
    locations: Object.fromEntries(t.purses.map((p) => [p.id, characterLocation(t, p)])),
    shops: Object.fromEntries(t.shops.map((s) => [s.id, shopVisible(s, t)])),
    npcs: Object.fromEntries(t.journal!.world!.npcs.map((n) => [n.id, npcAvailableHere(n, t)])),
    protocols: [0, 2, 3, 5, 7, 9].map((p) => tableForProtocol(t, p)),
    library: libraryRecords(t, sam).map((r) => r.key),
    travellers: journeyTravellers(t).map((p) => p.id),
    behind: staysBehind(t).map((p) => p.id),
  };
  assert.equal(JSON.stringify(now), golden);
});
