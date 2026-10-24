// Services wave 2, phase 4e (docs/SERVICES.md): Courier. Letters to NPCs the sender knows, 2 cp a
// mile, delivered over approved downtime into the sender's own thread with the recipient.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand } from "./commands.ts";
import type { CloudTable } from "./cloud.ts";
import { toCopper } from "./money.ts";
import { projectRecord } from "./session-records.ts";
import { tableForProtocol } from "./tabletop-protocol.ts";
import { applyCloudTable, economySnapshot, executeFinanceCommand, executeLocalCommand, removePurse } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { readServices } from "./services-schema.ts";
import { serviceQuote } from "./services.ts";
import { courierRecipients, letterCopper } from "./services-courier.ts";
import { presetOffers } from "./services-presets.ts";
import { validateServices } from "./services-validation.ts";
import { npcServices } from "./service-hub.ts";
import { courierFixture, letterCommand, svcDm, svcKael, svcThorn } from "./test-fixtures/services.ts";

let seq = 0;
const run = (t: CloudTable, c: Record<string, unknown>, seat = svcDm) =>
  applyCommand(t, seat, { ...c, id: (c.id as string) ?? `cr-${++seq}` } as never);
function downtime(t: CloudTable, days: number) {
  t = run(t, { kind: "downtime-plan", name: "Days on the road", days });
  return run(t, { kind: "downtime-apply", downtimeId: t.journal!.finance!.downtime.at(-1)!.id, endSession: false });
}
const coins = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
const order = (t: CloudTable, id: string) => readServices(t.journal?.services).orders.find((o) => o.id === id)!;
const provider = (t: CloudTable) => readServices(t.journal?.services).providers.find((p) => p.id === "post-courier")!;
const thread = (t: CloudTable, npcId: string, purseId = "kael") =>
  t.journal!.world!.conversations.find((c) => c.id === `${npcId}:${purseId}`)?.messages ?? [];
const TEXT = "My lady, the lights at the old mill were no rumour.";

test("preset and fee: 2 cp a mile over the DM's distance, rounded up to whole copper", () => {
  const [letter] = presetOffers("courier", "srd-5.2.1");
  assert.deepEqual([letter.key, letter.priceCopper, letter.time.kind, letter.review], ["letter", 2, "delivery", "auto"]);
  assert.deepEqual(presetOffers("courier", "srd-5.1"), presetOffers("courier", "srd-5.2.1"));
  assert.deepEqual(presetOffers("courier", "blank"), []);
  assert.equal(letterCopper(382, 2), 77, "38.2 mi × 2 cp = 76.4 → 77 cp");
  assert.equal(letterCopper(611, 2), 123);
  assert.equal(letterCopper(10, 3), 3);
  assert.throws(() => letterCopper(1e9, 1e12), /copper range/);
  const t = courierFixture();
  const q = serviceQuote(t, "post-courier", "letter", "kael", letterCommand(t, "x", "marrow").request);
  assert.equal(q.terms.priceCopper, 77);
  assert.equal(q.terms.workDays, 2);
  assert.deepEqual(q.terms.letter, { recipientNpcId: "marrow", recipientName: "Lady Marrow", locationId: "saltmere", placeName: "Saltmere", deciMiles: 382, text: TEXT });
  assert.equal(npcServices(t, "pell", "kael")[0].tag, "Services · Courier");
});

test("recipients: NPCs the sender knows; hidden ones absent; here and unserved places blocked", () => {
  const t = courierFixture();
  assert.deepEqual(
    courierRecipients(t, provider(t), "kael").map((r) => [r.npcId, r.placeName ?? "", r.blocked]),
    [
      ["reyne", "Greyford", ""],
      ["marrow", "Saltmere", ""],
      ["tamsin", "", "Old Tamsin is here. Talk to them instead."],
    ],
  );
  assert.deepEqual(courierRecipients(t, provider(t), "thorn").map((r) => r.npcId), ["marrow"]);
  const quote = (npc: string, purse = "kael") =>
    serviceQuote(t, "post-courier", "letter", purse, letterCommand(t, "q", npc, TEXT, purse).request);
  assert.throws(() => quote("tamsin"), /is here/);
  assert.throws(() => quote("spy"), /only write to someone they know/);
  assert.throws(() => quote("reyne", "thorn"), /only write to someone they know/);
  assert.throws(() => quote("aldous"), /only write to someone they know/);
  const unserved = structuredClone(t);
  unserved.journal!.world!.characterPositions.push({ purseId: "reyne", inParty: false, locationId: "vale", visible: true, sheetVisible: true });
  assert.throws(
    () => serviceQuote(unserved, "post-courier", "letter", "kael", letterCommand(t, "q", "reyne").request),
    /doesn't deliver to where Captain Reyne is/,
  );
  assert.throws(
    () => serviceQuote(t, "post-courier", "letter", "kael", { beneficiaryPurseIds: [], units: 1, contributions: [] }),
    /Choose who the letter is for/,
  );
});

test("sending pays once; only approved downtime moves the letter; delivery appends one message", () => {
  let t = courierFixture();
  const send = letterCommand(t, "l1", "marrow");
  t = applyCommand(t, svcKael, send);
  assert.equal(order(t, "l1").status, "active");
  assert.equal(coins(t, "kael"), 234000 - 77);
  assert.equal(t.ledger.filter((l) => l.id === "l1-payment").length, 1);
  assert.throws(() => applyCommand(t, svcKael, send), /already been recorded|changed/);
  assert.equal(t.ledger.filter((l) => l.id === "l1-payment").length, 1);
  // Session hours never move it; one approved day is halfway.
  t = downtime(t, 1);
  assert.equal(order(t, "l1").progressDays, 1);
  assert.equal(order(t, "l1").status, "active");
  assert.equal(thread(t, "marrow").length, 1);
  t = downtime(t, 3);
  const o = order(t, "l1");
  assert.equal(o.status, "completed");
  assert.equal(o.completedDay, 43, "arrived on the day the second day finished");
  assert.match(o.message, /Delivered campaign day 43/);
  assert.deepEqual(thread(t, "marrow").map((m) => [m.id, m.author, m.text]).at(-1), ["l1-letter", "character", TEXT]);
  // Later approvals deliver nothing twice.
  t = downtime(t, 2);
  assert.equal(thread(t, "marrow").filter((m) => m.id === "l1-letter").length, 1);
  validateServices(t);
});

test("a recipient hidden at delivery holds the letter; the DM delivers anyway or returns it (no refund)", () => {
  let t = courierFixture();
  t = applyCommand(t, svcKael, letterCommand(t, "l1", "marrow"));
  t = applyCommand(t, svcKael, letterCommand(t, "l2", "reyne", "Captain, hold the ship."));
  for (const id of ["marrow", "reyne"]) {
    const npc = t.journal!.world!.npcs.find((n) => n.id === id)!;
    t = applyCommand(t, svcDm, { id: `hide-${id}`, kind: "npc-save", before: npc, npc: { ...npc, visible: false } });
  }
  t = downtime(t, 3);
  for (const id of ["l1", "l2"]) {
    assert.equal(order(t, id).status, "paused");
    assert.match(order(t, id).message, /can't be found\. The DM decides/);
  }
  assert.equal(thread(t, "marrow").length, 1);
  const control = (id: string, action: "deliver" | "return", seat = svcDm) =>
    applyCommand(t, seat, { id: `${id}-${action}`, kind: "service-control", orderId: id, before: order(t, id), action, reason: "The DM decides." });
  assert.throws(() => control("l1", "deliver", svcKael), /Only the DM/);
  t = control("l1", "deliver");
  assert.equal(order(t, "l1").status, "completed");
  assert.equal(thread(t, "marrow").filter((m) => m.id === "l1-letter").length, 1);
  const before = coins(t, "kael");
  t = control("l2", "return");
  assert.equal(order(t, "l2").status, "cancelled");
  assert.match(order(t, "l2").message, /Nothing is refunded/);
  assert.equal(coins(t, "kael"), before);
  assert.equal(thread(t, "reyne").length, 1);
  // Delivering only applies to held letters.
  const fresh = applyCommand(courierFixture(), svcKael, letterCommand(courierFixture(), "l3", "marrow"));
  assert.throws(
    () => applyCommand(fresh, svcDm, { id: "x", kind: "service-control", orderId: "l3", before: order(fresh, "l3"), action: "deliver", reason: "Now" }),
    /held on arrival/,
  );
});

test("privacy: the text is only in the sender's projection; other players see no letter", () => {
  let t = courierFixture();
  t = applyCommand(t, svcKael, letterCommand(t, "l1", "marrow"));
  t = downtime(t, 2);
  const thorn = projectRecord(t, svcThorn);
  assert.ok(!JSON.stringify(thorn).includes("lights at the old mill"));
  assert.equal(readServices(thorn.journal?.services).orders.length, 0);
  // Thorn's recipients list is his own; Kael's threads aren't revealed.
  assert.deepEqual(readServices(thorn.journal?.services).providers.find((p) => p.kind === "courier")!.recipients!.map((r) => r.npcId), ["marrow"]);
  const kael = projectRecord(t, svcKael);
  assert.ok(JSON.stringify(kael).includes(TEXT));
  const recipients = readServices(kael.journal?.services).providers.find((p) => p.kind === "courier")!.recipients!;
  assert.ok(!recipients.some((r) => r.npcId === "spy"), "hidden NPCs are never listed");
  validateServices(kael, true);
  // The player's projected table quotes the same fingerprint as the server.
  assert.equal(
    serviceQuote(kael, "post-courier", "letter", "kael", letterCommand(t, "q", "reyne").request).before,
    serviceQuote(t, "post-courier", "letter", "kael", letterCommand(t, "q", "reyne").request).before,
  );
  // Recipients are never stored.
  assert.throws(() => validateServices({ ...t, journal: { ...t.journal!, services: { ...t.journal!.services!, providers: readServices(kael.journal?.services).providers } } }), /never stored|existing shop/);
});

test("guards: a recipient with a letter in transit and a destination's location stay", async () => {
  let t = courierFixture();
  t = applyCommand(t, svcKael, letterCommand(t, "l1", "marrow"));
  assert.throws(
    () => validateServices({ ...t, journal: { ...t.journal!, world: { ...t.journal!.world!, npcs: t.journal!.world!.npcs.filter((n) => n.id !== "marrow") } } }),
    /letters in transit/,
  );
  assert.throws(
    () => validateServices({ ...t, journal: { ...t.journal!, market: { ...t.journal!.market!, locations: t.journal!.market!.locations.filter((l) => l.id !== "greyford") } } }),
    /existing Market location/,
  );
  setSeat(DM_SEAT);
  await applyCloudTable(t);
  await assert.rejects(removePurse("marrow"), /letters in transit/);
});

test("protocol 8 clients never receive couriers or letters", () => {
  let t = courierFixture();
  t = applyCommand(t, svcKael, letterCommand(t, "l1", "marrow"));
  const eight = readServices(tableForProtocol(t, 8).journal?.services);
  assert.ok(!eight.providers.some((p) => p.kind === "courier"));
  assert.equal(eight.orders.length, 0);
});

test("offline: sending and delivery over approved downtime match the shared engine", async () => {
  setSeat(DM_SEAT);
  const t = courierFixture();
  const send = letterCommand(t, "off", "marrow");
  let shared = applyCommand(t, svcDm, send);
  shared = applyCommand(shared, svcDm, { id: "plan", kind: "downtime-plan", name: "Post", days: 2 } as never);
  shared = applyCommand(shared, svcDm, { id: "apply", kind: "downtime-apply", downtimeId: "plan", endSession: false } as never);
  await applyCloudTable(structuredClone(t));
  await executeLocalCommand(send);
  await executeLocalCommand(send);
  await executeFinanceCommand({ id: "plan", kind: "downtime-plan", name: "Post", days: 2 } as never);
  await executeFinanceCommand({ id: "apply", kind: "downtime-apply", downtimeId: "plan", endSession: false } as never);
  const device = await economySnapshot();
  const outcome = (x: CloudTable) => ({
    kael: coins(x, "kael"),
    payments: x.ledger.filter((l) => l.id.endsWith("-payment")).map((l) => [l.id, l.copper]),
    status: order(x, "off").status,
    letter: thread(x, "marrow").map((m) => m.id),
  });
  assert.deepEqual(outcome(device), outcome(shared));
  assert.deepEqual(outcome(device).letter, ["marrow-kael-hello", "off-letter"]);
});
