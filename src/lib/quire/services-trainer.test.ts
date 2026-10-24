// Services wave 2, phase 4d (docs/SERVICES.md): Trainer. Paid lessons reverse NPC training (an
// NPC teaches a character). Booking moves nothing; each approved session is charged once.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand } from "./commands.ts";
import type { CloudTable } from "./cloud.ts";
import { toCopper } from "./money.ts";
import { projectRecord } from "./session-records.ts";
import { tableForProtocol } from "./tabletop-protocol.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { readServices } from "./services-schema.ts";
import { readDowntimeActivities } from "./downtime-activities-schema.ts";
import { downtimeRemaining, recipientTrainingCounters, trainingCounters } from "./downtime-activities.ts";
import { lessonFee, serviceQuote } from "./services.ts";
import { presetOffers } from "./services-presets.ts";
import { blankSheet } from "../characters/model.mjs";
import { npcServices } from "./service-hub.ts";
import { lessonsCommand, sessionCommand, svcDm, svcKael, svcThorn, trainerFixture } from "./test-fixtures/services.ts";

const coins = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
const order = (t: CloudTable, id: string) => readServices(t.journal?.services).orders.find((o) => o.id === id)!;
const activities = (t: CloudTable) => readDowntimeActivities(t.journal?.downtimeActivities);
const request = (t: CloudTable, id: string) => activities(t).requests.find((r) => r.id === id)!;
const fees = (t: CloudTable) => t.ledger.filter((l) => l.id.endsWith("-fee"));
const review = (t: CloudTable, id: string, approve = true, note = "") => ({
  id: `${id}-review-${approve}`,
  kind: "downtime-training-review" as const,
  requestId: id,
  before: request(t, id),
  approve,
  note,
});
const booked = (days = 10) => {
  const t = trainerFixture();
  return applyCommand(t, svcKael, lessonsCommand(t, "lessons", days));
};

test("presets: three subjects at 2 gp a training day, up to 250 days; blank has none", () => {
  const offers = presetOffers("trainer", "srd-5.2.1");
  assert.deepEqual(
    offers.map((o) => [o.key, o.category, o.priceCopper, o.maxDays, o.time.kind]),
    [
      ["thieves-tools", "profession", 200, 250, "training"],
      ["language", "academic", 200, 250, "training"],
      ["weapon-drills", "martial", 200, 250, "training"],
    ],
  );
  assert.deepEqual(presetOffers("trainer", "srd-5.1"), offers);
  assert.deepEqual(presetOffers("trainer", "blank"), []);
  const [entry] = npcServices(trainerFixture(), "vey", "kael");
  assert.equal(entry.tag, "Services · Trainer");
});

test("booking records the agreement and moves nothing; one open agreement per pupil and subject", () => {
  const t = trainerFixture();
  const q = serviceQuote(t, "vey-lessons", "thieves-tools", "kael", lessonsCommand(t, "x", 10).request);
  assert.equal(q.terms.priceCopper, 0);
  assert.deepEqual(q.terms.lessons, { pupilId: "kael", pupilName: "Kael", category: "profession", topic: "Thieves' tools", dayCopper: 200, maxDays: 10 });
  const after = booked();
  const o = order(after, "lessons");
  assert.equal(o.status, "active");
  assert.match(o.message, /Each session is charged once/);
  assert.equal(coins(after, "kael"), 234000);
  assert.equal(after.ledger.length, t.ledger.length, "no ledger line at all");
  assert.deepEqual(after.purses.find((p) => p.id === "kael")!.coins, t.purses.find((p) => p.id === "kael")!.coins, "coins are not even re-counted");
  assert.throws(() => serviceQuote(after, "vey-lessons", "thieves-tools", "kael", lessonsCommand(t, "y", 5).request), /Kael already has lessons in Thieves' tools with Mistress Vey/);
  assert.throws(() => serviceQuote(t, "vey-lessons", "thieves-tools", "kael", { beneficiaryPurseIds: [], units: 1, contributions: [] }), /who takes the lessons/);
  assert.throws(() => serviceQuote(t, "vey-lessons", "thieves-tools", "kael", lessonsCommand(t, "z", 251).request), /between 1 and 250/);
  // A DM-reviewed agreement approves to active, still without money.
  const p = readServices(t.journal?.services).providers[1];
  const reviewed = applyCommand(t, svcDm, {
    id: "review-on",
    kind: "service-provider",
    providerId: p.id,
    before: p,
    provider: { ...p, offers: p.offers.map((o) => ({ ...o, review: "dm" as const })) },
  });
  let r = applyCommand(reviewed, svcKael, lessonsCommand(reviewed, "asked", 4));
  assert.equal(order(r, "asked").status, "requested");
  r = applyCommand(r, svcDm, { id: "ok", kind: "service-review", orderId: "asked", before: order(r, "asked"), decision: "approve", reason: "" });
  assert.equal(order(r, "asked").status, "active");
  assert.equal(coins(r, "kael"), 234000);
});

test("a session reserves hours for both people and moves nothing; the level check is skipped only for lessons", () => {
  let t = booked();
  // Vey outranks Kael: ordinary training (Kael teaching Vey) is refused, lessons aren't.
  t.purses.find((p) => p.id === "kael")!.sheet = { ...blankSheet(), name: "Kael", level: 2 };
  t.purses.find((p) => p.id === "vey")!.sheet = { ...blankSheet(), name: "Vey", level: 9 };
  const plain = { ...sessionCommand("plain", "lessons", 8) };
  delete (plain as { lessonOrderId?: string }).lessonOrderId;
  assert.throws(() => applyCommand(t, svcKael, plain), /level exceeds/);
  t = applyCommand(t, svcKael, sessionCommand("s1", "lessons", 8));
  const r = request(t, "s1");
  assert.deepEqual([r.status, r.feeCopper, r.lessonOrderId], ["pending", 200, "lessons"]);
  assert.equal(downtimeRemaining(activities(t), "w41", "kael", true), 56 * 60);
  assert.equal(downtimeRemaining(activities(t), "w41", "vey", true), 56 * 60);
  assert.equal(coins(t, "kael"), 234000);
  // A session must match its agreement and stay within its days.
  assert.throws(() => applyCommand(t, svcKael, { ...sessionCommand("s-x", "lessons", 8), topic: "Lockpicking" }), /must match its lessons/);
  assert.throws(() => applyCommand(t, svcThorn, sessionCommand("s-y", "lessons", 8, "thorn")), /must match/);
  assert.throws(() => applyCommand(t, svcThorn, sessionCommand("s-z", "lessons", 8)), /assigned character/);
  assert.throws(() => applyCommand(t, svcKael, { ...sessionCommand("s-h", "lessons", 8), historicalContext: "Last year" }), /as they happen/);
  const capped = applyCommand(trainerFixture(), svcKael, lessonsCommand(trainerFixture(), "short", 1));
  assert.throws(() => applyCommand(capped, svcKael, sessionCommand("s-c", "short", 12)), /1 training days left/);
});

test("approval charges ceil(minutes × rate ÷ (hours per day × 60)) once with requestId-fee", () => {
  assert.equal(lessonFee(8 * 60, 200, 8), 200);
  assert.equal(lessonFee(6 * 60, 200, 8), 150);
  assert.equal(lessonFee(60, 333, 8), 42, "41.625 rounds up to whole copper");
  assert.throws(() => lessonFee(1e12, 1e12, 1), /copper range/);
  let t = booked();
  t = applyCommand(t, svcKael, sessionCommand("s1", "lessons", 6));
  assert.throws(() => applyCommand(t, svcKael, review(t, "s1")), /Only the DM/);
  const cmd = review(t, "s1", true, "Good hands.");
  t = applyCommand(t, svcDm, cmd);
  assert.equal(request(t, "s1").status, "approved");
  assert.equal(coins(t, "kael"), 234000 - 150);
  assert.deepEqual(fees(t).map((l) => [l.id, l.copper, l.purseId, l.shopId]), [["s1-fee", -150, "kael", "lockworks"]]);
  const o = order(t, "lessons");
  assert.deepEqual(o.sessions?.map((s) => [s.requestId, s.minutes, s.feeCopper]), [["s1", 360, 150]]);
  assert.equal(o.status, "active");
  // A retried or repeated approval charges nothing more.
  assert.throws(() => applyCommand(t, svcDm, cmd), /already been decided|changed/);
  assert.equal(fees(t).length, 1);
  // The payer sees the event; the counters include the lesson.
  assert.ok(t.journal!.events.some((e) => e.purseId === "kael" && /Lesson approved/.test(e.summary)));
  assert.equal(trainingCounters(activities(t))[0].lifetimeMinutes, 360);
  assert.equal(recipientTrainingCounters(activities(t)).length, 1);
});

test("deny and cancel release hours and charge nothing; a short payer is refused", () => {
  let t = booked();
  t = applyCommand(t, svcKael, sessionCommand("s1", "lessons", 8));
  t = applyCommand(t, svcDm, review(t, "s1", false, "Vey was ill."));
  assert.equal(request(t, "s1").status, "denied");
  t = applyCommand(t, svcKael, sessionCommand("s2", "lessons", 8));
  t = applyCommand(t, svcKael, { id: "c2", kind: "downtime-training-cancel", requestId: "s2", before: request(t, "s2") });
  assert.equal(downtimeRemaining(activities(t), "w41", "kael", true), 64 * 60);
  assert.equal(fees(t).length, 0);
  t = applyCommand(t, svcKael, sessionCommand("s3", "lessons", 8));
  const broke = structuredClone(t);
  broke.purses.find((p) => p.id === "kael")!.coins = { cp: 199, sp: 0, ep: 0, gp: 0, pp: 0 };
  assert.throws(() => applyCommand(broke, svcDm, review(broke, "s3")), /can't afford 2 gp/);
  assert.equal(fees(broke).length, 0);
  assert.equal(request(broke, "s3").status, "pending");
});

test("the cap completes the agreement; ending lessons refuses new sessions and charges nothing", () => {
  let t = applyCommand(trainerFixture(), svcKael, lessonsCommand(trainerFixture(), "two", 2));
  t = applyCommand(t, svcKael, sessionCommand("a", "two", 8));
  t = applyCommand(t, svcKael, sessionCommand("b", "two", 8));
  t = applyCommand(t, svcDm, review(t, "a"));
  assert.equal(order(t, "two").status, "active");
  t = applyCommand(t, svcDm, review(t, "b"));
  assert.equal(order(t, "two").status, "completed");
  assert.match(order(t, "two").message, /Lessons completed/);
  assert.equal(fees(t).reduce((n, l) => n + l.copper, 0), -400);
  // Ending: the payer closes it; a pending session can no longer be approved.
  let e = booked();
  e = applyCommand(e, svcKael, sessionCommand("p", "lessons", 8));
  assert.throws(() => applyCommand(e, svcThorn, { id: "end-x", kind: "service-cancel", orderId: "lessons", before: order(e, "lessons") }), /own character/);
  e = applyCommand(e, svcKael, { id: "end", kind: "service-cancel", orderId: "lessons", before: order(e, "lessons") });
  assert.equal(order(e, "lessons").status, "cancelled");
  assert.throws(() => applyCommand(e, svcKael, sessionCommand("q", "lessons", 8)), /closed/);
  assert.throws(() => applyCommand(e, svcDm, review(e, "p")), /closed/);
  e = applyCommand(e, svcDm, review(e, "p", false, "Lessons ended."));
  assert.equal(fees(e).length, 0);
  assert.equal(coins(e, "kael"), 234000);
});

test("privacy: the teacher's hours are never projected; other players see no lessons", () => {
  let t = booked();
  t = applyCommand(t, svcKael, sessionCommand("s1", "lessons", 8));
  const kael = projectRecord(t, svcKael);
  const window = readDowntimeActivities(kael.journal?.downtimeActivities).windows[0];
  assert.deepEqual(window.budgets.map((b) => b.purseId), ["kael"]);
  assert.equal(readServices(kael.journal?.services).orders.length, 1);
  const thorn = projectRecord(t, svcThorn);
  assert.equal(readDowntimeActivities(thorn.journal?.downtimeActivities).requests.length, 0);
  assert.equal(readServices(thorn.journal?.services).orders.length, 0);
});

test("protocol 8 clients never receive trainers or lesson agreements", () => {
  const t = booked();
  const eight = tableForProtocol(t, 8);
  const s = readServices(eight.journal?.services);
  assert.ok(!s.providers.some((p) => p.kind === "trainer"));
  assert.equal(s.orders.length, 0);
});

test("offline: booking, a session and its approval match the shared engine; retries apply once", async () => {
  setSeat(DM_SEAT);
  const t = trainerFixture();
  const book = lessonsCommand(t, "off", 10);
  const log = sessionCommand("off-s", "off", 8);
  let shared = applyCommand(t, svcDm, book);
  shared = applyCommand(shared, svcDm, log);
  const approve = review(shared, "off-s");
  shared = applyCommand(shared, svcDm, approve);
  await applyCloudTable(structuredClone(t));
  for (const cmd of [book, book, log, log]) await executeLocalCommand(cmd);
  const local = { ...approve, before: request(await economySnapshot(), "off-s") };
  await executeLocalCommand(local);
  await executeLocalCommand(local);
  const device = await economySnapshot();
  const outcome = (x: CloudTable) => ({
    kael: coins(x, "kael"),
    fees: fees(x).map((l) => [l.id, l.copper]),
    sessions: order(x, "off").sessions?.map((s) => s.requestId),
    status: request(x, "off-s").status,
  });
  assert.deepEqual(outcome(device), outcome(shared));
  assert.equal(outcome(device).fees.length, 1);
});
