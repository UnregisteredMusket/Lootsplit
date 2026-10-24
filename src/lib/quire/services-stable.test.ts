// Services wave 2, phase 4c (docs/SERVICES.md): Stable and coach. Stabling is booked by the night
// and paid up front; a coach booking becomes a party journey request whose fare is charged once
// when the DM approves departure.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand, applyCommandBatch } from "./commands.ts";
import type { CloudTable } from "./cloud.ts";
import { toCopper } from "./money.ts";
import { projectRecord } from "./session-records.ts";
import { tableForProtocol, tabletopResponse } from "./tabletop-protocol.ts";
import { applyCloudTable, economySnapshot, executeFinanceCommand, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { readServices } from "./services-schema.ts";
import { serviceQuote } from "./services.ts";
import { presetOffers } from "./services-presets.ts";
import { mountLike } from "./mounts.ts";
import { npcServices } from "./service-hub.ts";
import { journeySchema } from "./journey-schema.ts";
import { coachCommand, stableFixture, stablingCommand, svcDm, svcKael, svcThorn } from "./test-fixtures/services.ts";

const coins = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
const order = (t: CloudTable, id: string) => readServices(t.journal?.services).orders.find((o) => o.id === id)!;
const journey = (t: CloudTable, id: string) => t.journal!.world!.journeys!.find((j) => j.id === id)!;
const fares = (t: CloudTable, orderId: string) => t.ledger.filter((l) => l.id === `${orderId}-payment`);
/** Approve the coach's journey for `days` of downtime, as Review Inbox's Approve & depart does. */
function depart(t: CloudTable, journeyId: string, days: number, id = `dep-${days}-${Math.random()}`) {
  t = applyCommand(t, svcDm, { id: `${id}-plan`, kind: "downtime-plan", name: "On the road", days, journeyId } as never);
  return applyCommand(t, svcDm, { id: `${id}-apply`, kind: "downtime-apply", downtimeId: `${id}-plan`, endSession: false } as never);
}

test("presets: stabling 5 sp a night with 5 cp feed; coach 3 cp a mile; mounts found by the shared rule", () => {
  const [stabling, coach] = presetOffers("stable", "srd-5.2.1");
  assert.deepEqual([stabling.key, stabling.priceCopper, stabling.feedCopper, stabling.time], ["stabling", 50, 5, { kind: "per-night", maxNights: 30 }]);
  assert.deepEqual([coach.key, coach.priceCopper, coach.time.kind, coach.review], ["coach", 3, "coach", "dm"]);
  assert.deepEqual(presetOffers("stable", "srd-5.1"), presetOffers("stable", "srd-5.2.1"));
  assert.deepEqual(presetOffers("stable", "blank"), []);
  assert.ok(mountLike({ name: "Riding horse" }) && mountLike({ name: "Pack mule" }) && !mountLike({ name: "Diamond" }));
  assert.equal(npcServices(stableFixture(), "hollin", "kael")[0].tag, "Services · Stable");
});

test("stabling: price per animal per night plus feed, paid once; ownership and overflow", () => {
  let t = stableFixture();
  const q = serviceQuote(t, "livery-stable", "stabling", "kael", stablingCommand(t, "x", ["horse", "mule"]).request);
  assert.deepEqual(q.terms.lines.map((l) => [l.label, l.copper]), [
    ["Stalls · 2 animals × 3 nights × 5 sp", 300],
    ["Feed · 2 × 3 × 5 cp", 30],
  ]);
  assert.equal(q.terms.priceCopper, 330);
  assert.equal(serviceQuote(t, "livery-stable", "stabling", "kael", stablingCommand(t, "x", ["horse"], 3, false).request).terms.priceCopper, 150);
  assert.throws(() => serviceQuote(t, "livery-stable", "stabling", "kael", stablingCommand(t, "x", ["pony"]).request), /isn't Kael's\. Its owner books for it/);
  assert.throws(() => serviceQuote(t, "livery-stable", "stabling", "kael", stablingCommand(t, "x", ["diamond-500"]).request), /Choose animals/);
  assert.throws(() => serviceQuote(t, "livery-stable", "stabling", "kael", stablingCommand(t, "x", ["horse", "horse"]).request), /each animal once/);
  assert.throws(() => serviceQuote(t, "livery-stable", "stabling", "kael", stablingCommand(t, "x", ["horse"], 31).request), /between 1 and 30/);
  const huge = structuredClone(t);
  huge.holdings.find((h) => h.id === "horse")!.quantity = 100000;
  const p = readServices(huge.journal?.services).providers.find((x) => x.id === "livery-stable")!;
  p.offers[0].priceCopper = 1e12;
  huge.journal!.services = { ...readServices(huge.journal?.services), providers: [p, ...readServices(huge.journal?.services).providers.filter((x) => x.id !== p.id)] };
  assert.throws(() => serviceQuote(huge, "livery-stable", "stabling", "kael", stablingCommand(t, "x", ["horse"]).request), /copper range/);
  const cmd = stablingCommand(t, "st-1", ["horse", "mule"]);
  t = applyCommand(t, svcKael, cmd);
  assert.equal(order(t, "st-1").status, "completed");
  assert.equal(coins(t, "kael"), 234000 - 330);
  assert.equal(fares(t, "st-1").length, 1);
  assert.ok(t.holdings.some((h) => h.id === "horse") && t.holdings.some((h) => h.id === "mule"), "animals stay in the inventory");
  assert.throws(() => applyCommand(t, svcKael, cmd), /already been recorded|changed/);
  assert.equal(fares(t, "st-1").length, 1);
});

test("a coach booking creates exactly one journey request with the fare and moves nothing", () => {
  let t = stableFixture();
  const q = serviceQuote(t, "livery-stable", "coach", "kael", coachCommand(t, "x").request);
  assert.deepEqual(q.terms.route, { key: "saltmere", toLocationId: "saltmere", placeName: "Saltmere", deciMiles: 382, passengers: 2, paceMilesPerDay: 30 });
  assert.equal(q.terms.priceCopper, 230, "2 × 38.2 mi × 3 cp = 229.2 → 230 cp");
  assert.equal(q.terms.review, "dm");
  t = applyCommand(t, svcKael, coachCommand(t, "c1"));
  assert.equal(order(t, "c1").status, "requested");
  assert.equal(coins(t, "kael"), 234000);
  assert.equal(t.journal!.world!.journeys!.length, 1);
  const j = journey(t, "c1-journey");
  journeySchema.parse(j);
  assert.deepEqual([j.status, j.requestedBy, j.pace, j.destinationLocationId], ["proposed", "kael", { preset: "custom", milesPerDay: 30 }, "saltmere"]);
  assert.deepEqual(j.costs.fare, { orderId: "c1", copper: 230, payerId: "kael" });
  assert.deepEqual([j.costs.rations, j.costs.mounts], [false, false]);
  // A second booking or an unmapped route is refused; a coach order isn't approved as a service.
  assert.throws(() => serviceQuote(t, "livery-stable", "coach", "kael", coachCommand(t, "x").request), /already has a journey planned/);
  const fresh = stableFixture();
  assert.throws(() => serviceQuote(fresh, "livery-stable", "coach", "kael", coachCommand(fresh, "x", "mill").request), /hasn't drawn this route yet/);
  assert.throws(
    () => applyCommand(t, svcDm, { id: "r", kind: "service-review", orderId: "c1", before: order(t, "c1"), decision: "approve", reason: "" }),
    /decided as a journey/,
  );
  // Players can't edit the fare through the journey command.
  const edited = { ...j, costs: { ...j.costs, fare: { ...j.costs.fare!, copper: 1 } } };
  assert.throws(() => applyCommand(t, svcKael, { id: "e", kind: "party-journey", journeyId: j.id, before: j, journey: edited }), /coach fare/);
  assert.throws(
    () =>
      applyCommand(stableFixture(), svcKael, {
        id: "forge",
        kind: "party-journey",
        journeyId: "fake",
        before: null,
        journey: { ...edited, id: "fake" },
      }),
    /coach fare/,
  );
});

test("departure charges the fare once before rations and upkeep, even over two windows", () => {
  let t = applyCommand(stableFixture(), svcKael, coachCommand(stableFixture(), "c1"));
  // The DM turns on rations paid by the party fund; the fare is still first and separate.
  const j0 = journey(t, "c1-journey");
  t = applyCommand(t, svcDm, { id: "costs", kind: "party-journey", journeyId: j0.id, before: j0, journey: { ...j0, costs: { ...j0.costs, rations: true, payerId: "fund" } } });
  t = depart(t, "c1-journey", 1);
  assert.equal(fares(t, "c1").length, 1);
  assert.equal(fares(t, "c1")[0].copper, -230);
  assert.equal(fares(t, "c1")[0].shopId, "livery");
  assert.equal(coins(t, "kael"), 234000 - 230);
  const quote = t.journal!.finance!.downtime.at(-1)!.quote.journey!;
  assert.deepEqual(quote.lines.map((l) => l.kind), ["fare", "rations"]);
  assert.equal(order(t, "c1").status, "completed");
  assert.match(order(t, "c1").message, /Departed/);
  assert.equal(journey(t, "c1-journey").status, "active");
  // The second window charges no fare again.
  t = depart(t, "c1-journey", 1);
  assert.equal(fares(t, "c1").length, 1);
  assert.equal(journey(t, "c1-journey").status, "arrived");
  assert.ok(!t.journal!.finance!.downtime.at(-1)!.quote.journey!.lines.some((l) => l.kind === "fare"));
});

test("a short payer refuses departure with Nothing was charged", () => {
  const t = applyCommand(stableFixture(), svcKael, coachCommand(stableFixture(), "c1"));
  t.purses.find((p) => p.id === "kael")!.coins = { cp: 100, sp: 0, ep: 0, gp: 0, pp: 0 };
  assert.throws(() => depart(t, "c1-journey", 2), /coach fare.*Nothing was charged/);
  assert.equal(fares(t, "c1").length, 0);
});

test("withdrawing the booking withdraws the journey; a denied journey denies the booking", () => {
  let t = applyCommand(stableFixture(), svcKael, coachCommand(stableFixture(), "c1"));
  t = applyCommand(t, svcKael, { id: "w", kind: "service-cancel", orderId: "c1", before: order(t, "c1") });
  assert.equal(order(t, "c1").status, "cancelled");
  assert.equal(journey(t, "c1-journey").status, "cancelled");
  t = applyCommand(t, svcKael, coachCommand(t, "c2"));
  const j = journey(t, "c2-journey");
  t = applyCommand(t, svcDm, { id: "deny", kind: "party-journey", journeyId: j.id, before: j, journey: { ...j, status: "denied", reason: { text: "The ford is out.", showToPlayer: true } } });
  assert.equal(order(t, "c2").status, "denied");
  assert.match(order(t, "c2").message, /The ford is out\. Nothing was charged/);
  // The player withdrawing the journey itself also closes the booking.
  t = applyCommand(t, svcKael, coachCommand(t, "c3"));
  const j3 = journey(t, "c3-journey");
  t = applyCommand(t, svcKael, { id: "wj", kind: "party-journey", journeyId: j3.id, before: j3, journey: { ...j3, status: "cancelled" } });
  assert.equal(order(t, "c3").status, "cancelled");
  assert.equal(coins(t, "kael"), 234000);
  assert.throws(() => applyCommand(t, svcThorn, coachCommand(t, "c4")), /your own character/);
});

test("privacy: other players see the journey but not the fare's payer; old clients get neither the fare nor the stable", () => {
  let t = applyCommand(stableFixture(), svcKael, coachCommand(stableFixture(), "c1"));
  const thorn = projectRecord(t, svcThorn);
  assert.equal(readServices(thorn.journal?.services).orders.length, 0);
  // The payer sees the fare on the journey (and can withdraw it from their own table); others don't.
  assert.equal(thorn.journal!.world!.journeys?.find((j) => j.id === "c1-journey")?.costs.fare, undefined);
  const mine = projectRecord(t, svcKael).journal!.world!.journeys!.find((j) => j.id === "c1-journey")!;
  assert.deepEqual(mine.costs.fare, { orderId: "c1", copper: 230, payerId: "kael" });
  const withdrawn = applyCommand(t, svcKael, { id: "wd", kind: "party-journey", journeyId: mine.id, before: mine, journey: { ...mine, status: "cancelled" } });
  assert.equal(order(withdrawn, "c1").status, "cancelled");
  const own = projectRecord(t, svcKael);
  assert.equal(readServices(own.journal?.services).orders.length, 1);
  // Protocol 8: no stable provider, no coach order, no fare on the journey or in a pending quote.
  t = applyCommand(t, svcDm, { id: "plan", kind: "downtime-plan", name: "Road", days: 1, journeyId: "c1-journey" } as never);
  const eight = tableForProtocol(t, 8);
  assert.ok(!readServices(eight.journal?.services).providers.some((p) => p.kind === "stable"));
  assert.equal(readServices(eight.journal?.services).orders.length, 0);
  assert.equal(eight.journal!.world!.journeys![0].costs.fare, undefined);
  assert.ok(!JSON.stringify(eight.journal!.finance).includes('"fare"'));
  assert.ok(JSON.stringify(t.journal!.finance).includes('"fare"'));
  assert.throws(() => tabletopResponse({ table: t, draft: JSON.stringify([{ kind: "service-order", request: { routeKey: "saltmere" }, kind2: "x", provider: { kind: "stable" } }]) }, 8), /updated Lootsplitter client/);
});

test("offline: stabling, booking and departure match the shared engine (Approve & depart batch)", async () => {
  setSeat(DM_SEAT);
  const t = stableFixture();
  const stall = stablingCommand(t, "off-st", ["horse"]);
  const book = coachCommand(t, "off-c");
  const batch = [
    { id: "off-plan", kind: "downtime-plan", name: "Road", days: 2, journeyId: "off-c-journey" },
    { id: "off-apply", kind: "downtime-apply", downtimeId: "off-plan", endSession: false },
  ];
  let shared = applyCommand(t, svcDm, stall);
  shared = applyCommand(shared, svcDm, { ...book, before: serviceQuote(shared, "livery-stable", "coach", "kael", book.request).before });
  shared = applyCommandBatch(shared, svcDm, batch as never);
  await applyCloudTable(structuredClone(t));
  await executeLocalCommand(stall);
  await executeLocalCommand(stall);
  const local = { ...book, before: serviceQuote(await economySnapshot(), "livery-stable", "coach", "kael", book.request).before };
  await executeLocalCommand(local);
  await executeLocalCommand(local);
  for (const c of batch) await executeFinanceCommand(c as never);
  const device = await economySnapshot();
  const outcome = (x: CloudTable) => ({
    kael: coins(x, "kael"),
    payments: x.ledger.filter((l) => l.id.endsWith("-payment")).map((l) => [l.id, l.copper]).sort(),
    orders: readServices(x.journal?.services).orders.map((o) => [o.id, o.status]),
    journey: journey(x, "off-c-journey").status,
  });
  assert.deepEqual(outcome(device), outcome(shared));
  assert.equal(outcome(device).payments.length, 2);
});

test("Review Inbox's one-click Approve & depart works when the screen lists purses by name", async () => {
  const { orderedTable, quoteHash } = await import("./journey-engine.ts");
  let t = applyCommand(stableFixture(), svcKael, coachCommand(stableFixture(), "c1"));
  // The screen's table: the same records sorted by name (the room keeps insertion order).
  const screen = { ...t, purses: [...t.purses].sort((a, b) => a.name.localeCompare(b.name)), holdings: [...t.holdings].sort((a, b) => a.name.localeCompare(b.name)) };
  const plan = { id: "one-plan", kind: "downtime-plan", name: "Coach", days: 2, journeyId: "c1-journey" };
  const simulated = applyCommand(orderedTable(screen), DM_SEAT as never, plan as never, { preview: true } as never);
  const hash = quoteHash(simulated.journal!.finance!.downtime.at(-1)!.quote);
  t = applyCommandBatch(t, svcDm, [
    { ...plan, expectedQuoteHash: hash },
    { id: "one-apply", kind: "downtime-apply", downtimeId: "one-plan", endSession: false },
  ] as never);
  assert.equal(fares(t, "c1").length, 1);
  assert.equal(order(t, "c1").status, "completed");
  // A real change still stops it.
  const changed = applyCommand(stableFixture(), svcKael, coachCommand(stableFixture(), "c1"));
  changed.purses.find((p) => p.id === "kael")!.coins.gp -= 1;
  assert.throws(() => applyCommandBatch(changed, svcDm, [{ ...plan, expectedQuoteHash: hash }] as never), /Open the full review/);
});
