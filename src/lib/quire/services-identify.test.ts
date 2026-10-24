// Services wave 2, phase 4b (docs/SERVICES.md): Sage Identify. Record only: the DM writes the
// answer in review, approval charges once and posts one message; the item never leaves the payer.
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
import { readServices, type ServiceOrder } from "./services-schema.ts";
import { npcServices } from "./service-hub.ts";
import { identifyCandidates, identifyLock, reviewChecks, serviceQuote } from "./services.ts";
import { presetOffers } from "./services-presets.ts";
import { validateServices } from "./services-validation.ts";
import { identifyCommand, orderCommand, sageFixture, svcDm, svcKael, svcThorn } from "./test-fixtures/services.ts";

const coins = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
const order = (t: CloudTable, id: string) => readServices(t.journal?.services).orders.find((o) => o.id === id)!;
const payments = (t: CloudTable, id: string) => t.ledger.filter((l) => l.id === id + "-payment");
const thread = (t: CloudTable, purseId = "kael") =>
  t.journal!.world!.conversations.find((c) => c.id === `quillon:${purseId}`)?.messages ?? [];
const ANSWER = "A Ring of Feather Falling. Fall gently and land on your feet.";
const approve = (o: ServiceOrder, reveal?: { text: string; appendToNotes: boolean; rename?: string }, id = "answer") => ({
  id,
  kind: "service-review" as const,
  orderId: o.id,
  before: o,
  decision: "approve" as const,
  reason: "",
  ...(reveal ? { reveal } : {}),
});

test("presets: a sage offers Identify at 50 gp with DM review; a temple carries it as a draft", () => {
  for (const preset of ["srd-5.2.1", "srd-5.1"] as const) {
    const [identify] = presetOffers("sage", preset);
    assert.deepEqual(
      [identify.key, identify.priceCopper, identify.review, identify.approved, identify.target, identify.spellLevel],
      ["identify", 5000, "dm", true, "held-item", 1],
    );
  }
  assert.deepEqual(presetOffers("sage", "blank"), []);
  const temple = presetOffers("temple", "srd-5.2.1").find((o) => o.key === "identify")!;
  assert.equal(temple.approved, false);
});

test("the item list uses the held-item rule; worn items are fine", () => {
  const t = sageFixture();
  // The longsword is reserved for property work (not carried).
  t.holdings.find((h) => h.id === "sword")!.reservedFor = "job";
  assert.deepEqual(
    identifyCandidates(t, "kael").map((c) => [c.holding.id, c.blocked]),
    [
      ["diamond-500", ""],
      ["diamond-300", ""],
      ["ruby", ""],
      ["ring", ""],
      ["bottle", ""],
      ["sword", "Retrieve this item from its property first."],
      ["key", "Party fund. A character has to carry it first."],
    ],
  );
  assert.equal(serviceQuote(t, "quill-sage", "identify", "kael", identifyCommand(t, "x", "ring").request).terms.item!.name, "Plain silver ring");
  const quote = (holdingId: string | undefined, purse = "kael") =>
    serviceQuote(t, "quill-sage", "identify", purse, { beneficiaryPurseIds: [], units: 1, contributions: [], ...(holdingId ? { itemHoldingId: holdingId } : {}) });
  assert.throws(() => quote(undefined), /Carry the item you want identified/);
  assert.throws(() => quote("sword"), /Retrieve this item/);
  assert.throws(() => quote("key"), /owns and carries/);
  assert.throws(() => quote("thorn-amulet"), /owns and carries/);
  assert.throws(() => serviceQuote(t, "quill-sage", "identify", "kael", { beneficiaryPurseIds: ["kael"], units: 1, contributions: [], itemHoldingId: "ring" }), /no beneficiary/);
  // Another offer refuses an item.
  assert.throws(() => serviceQuote(t, "dawn-temple", "cure-wounds", "kael", { beneficiaryPurseIds: ["kael"], units: 1, contributions: [], itemHoldingId: "ring" }), /doesn't look at an item/);
  // Nothing carried: the offer is locked with the mockup's reason.
  const bare = structuredClone(t);
  bare.holdings = bare.holdings.filter((h) => h.purseId !== "kael" || h.id === "sword");
  assert.equal(identifyLock(bare, "kael"), "Carry the item you want identified.");
  assert.equal(identifyLock(t, "kael"), "");
  // The hub lists the sage with its fee.
  const [entry] = npcServices(t, "quillon", "kael");
  assert.equal(entry.tag, "Services · Sage");
  assert.equal(entry.text, "What is this thing?");
  assert.equal(entry.sub, "Identify 50 gp. Charged when the DM answers.");
});

test("a request moves nothing; approval requires the answer, pays once and posts one message", () => {
  let t = sageFixture();
  const ask = identifyCommand(t, "id-1", "ring");
  t = applyCommand(t, svcKael, ask);
  assert.equal(order(t, "id-1").status, "requested");
  assert.equal(coins(t, "kael"), 234000);
  assert.equal(payments(t, "id-1").length, 0);
  assert.deepEqual(order(t, "id-1").terms.item, { holdingId: "ring", name: "Plain silver ring", notesBefore: "Cold to the touch. No markings." });
  assert.ok(reviewChecks(t, order(t, "id-1")).some((c) => c.ok && c.text === "Plain silver ring is still owned and carried by Kael"));
  // Without an answer the DM can't approve; a player can't approve at all.
  assert.throws(() => applyCommand(t, svcDm, approve(order(t, "id-1"))), /Write what Magister Quillon says/);
  assert.throws(() => applyCommand(t, svcKael, approve(order(t, "id-1"), { text: ANSWER, appendToNotes: true })), /Only the DM/);
  // A deny carries no answer.
  assert.throws(
    () => applyCommand(t, svcDm, { ...approve(order(t, "id-1"), { text: ANSWER, appendToNotes: false }), decision: "deny", reason: "No." }),
    /Only an Identify approval/,
  );
  const cmd = approve(order(t, "id-1"), { text: ANSWER, appendToNotes: true, rename: "Ring of Feather Falling" });
  t = applyCommand(t, svcDm, cmd);
  const o = order(t, "id-1");
  assert.equal(o.status, "completed");
  assert.deepEqual(o.reveal, { text: ANSWER, appendToNotes: true, rename: "Ring of Feather Falling" });
  assert.match(o.message, /Answered and paid/);
  assert.equal(coins(t, "kael"), 234000 - 5000);
  assert.equal(payments(t, "id-1").length, 1);
  assert.equal(payments(t, "id-1")[0].shopId, "quill");
  // One message, as the sage, in Kael's private thread.
  assert.deepEqual(thread(t).map((m) => [m.id, m.author, m.text]), [["id-1-answer", "npc", ANSWER]]);
  // The notes append (old notes stay) and the rename happened in the same command.
  const ring = t.holdings.find((h) => h.id === "ring")!;
  assert.equal(ring.name, "Ring of Feather Falling");
  assert.equal(ring.notes, `Cold to the touch. No markings.\nDay 41 · identified by Magister Quillon: ${ANSWER}`);
  assert.equal(ring.equipped, true, "nothing else on the item changes");
  // Retrying the same approval changes nothing.
  assert.throws(() => applyCommand(t, svcDm, cmd), /changed|already been decided/);
  assert.equal(payments(t, "id-1").length, 1);
  assert.equal(thread(t).length, 1);
  validateServices(t);
});

test("notes stay untouched when the box is cleared; deny and withdraw move nothing", () => {
  let t = sageFixture();
  t = applyCommand(t, svcKael, identifyCommand(t, "id-2", "bottle"));
  t = applyCommand(t, svcDm, approve(order(t, "id-2"), { text: "Plain water.", appendToNotes: false }));
  const bottle = t.holdings.find((h) => h.id === "bottle")!;
  assert.deepEqual([bottle.name, bottle.notes], ["Stoppered blue bottle", ""]);
  assert.equal(thread(t).at(-1)!.text, "Plain water.");
  t = applyCommand(t, svcKael, identifyCommand(t, "id-3", "ring"));
  t = applyCommand(t, svcDm, { id: "deny", kind: "service-review", orderId: "id-3", before: order(t, "id-3"), decision: "deny", reason: "The pearl cracked." });
  assert.equal(order(t, "id-3").status, "denied");
  t = applyCommand(t, svcKael, identifyCommand(t, "id-4", "ring"));
  t = applyCommand(t, svcKael, { id: "cancel", kind: "service-cancel", orderId: "id-4", before: order(t, "id-4") });
  assert.equal(order(t, "id-4").status, "cancelled");
  assert.equal(coins(t, "kael"), 234000 - 5000, "only the answered order was charged");
  assert.equal(thread(t).length, 1);
});

test("approval reruns every check: an item no longer carried, or funds short, refuse and charge nothing", () => {
  const base = applyCommand(sageFixture(), svcKael, identifyCommand(sageFixture(), "id", "ring"));
  const answer = (t: CloudTable) => applyCommand(t, svcDm, approve(order(t, "id"), { text: ANSWER, appendToNotes: true }));
  const stored = structuredClone(base);
  stored.holdings.find((h) => h.id === "ring")!.reservedFor = "job";
  assert.throws(() => answer(stored), /Retrieve this item/);
  assert.ok(reviewChecks(stored, order(stored, "id")).some((c) => !c.ok && /still owned and carried/.test(c.text)));
  const given = structuredClone(base);
  given.holdings.find((h) => h.id === "ring")!.purseId = "thorn";
  assert.throws(() => answer(given), /owns and carries/);
  const broke = structuredClone(base);
  broke.purses.find((p) => p.id === "kael")!.coins = { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 };
  assert.throws(() => answer(broke), /can't afford/);
  for (const t of [stored, given, broke]) {
    assert.equal(payments(t, "id").length, 0);
    assert.equal(thread(t).length, 0);
    assert.equal(t.holdings.find((h) => h.id === "ring")!.notes, "Cold to the touch. No markings.");
  }
});

test("privacy: another player's projection never contains the answer; the payer's does after it", () => {
  let t = sageFixture();
  t = applyCommand(t, svcKael, identifyCommand(t, "id", "ring"));
  // Before the answer nothing about it exists anywhere.
  assert.ok(!JSON.stringify(projectRecord(t, svcKael)).includes("Feather"));
  t = applyCommand(t, svcDm, approve(order(t, "id"), { text: ANSWER, appendToNotes: false }));
  const thorn = projectRecord(t, svcThorn);
  assert.ok(!JSON.stringify(thorn).includes("Feather Falling"), "Thorn never receives Kael's answer");
  assert.equal(readServices(thorn.journal?.services).orders.length, 0);
  const kael = projectRecord(t, svcKael);
  assert.ok(JSON.stringify(kael).includes(ANSWER));
  assert.equal(readServices(kael.journal?.services).orders[0].reveal?.text, ANSWER);
  validateServices(kael, true);
  // The event names the order, not the answer.
  assert.ok(!JSON.stringify(t.journal!.events).includes("Feather"));
});

test("protocol 8 clients never receive Identify offers, orders or sages", () => {
  let t = sageFixture();
  const temple = readServices(t.journal?.services).providers.find((p) => p.id === "dawn-temple")!;
  const withIdentify = { ...temple, offers: temple.offers.map((o) => (o.key === "identify" ? { ...o, approved: true } : o)) };
  t = applyCommand(t, svcDm, { id: "temple-identify", kind: "service-provider", providerId: temple.id, before: temple, provider: withIdentify });
  t = applyCommand(t, svcKael, identifyCommand(t, "id", "ring"));
  t = applyCommand(t, svcKael, orderCommand(t, "temple-id", "identify", "kael", { beneficiaryPurseIds: [], units: 1, contributions: [], itemHoldingId: "bottle" }));
  const eight = readServices(tableForProtocol(t, 8).journal?.services);
  assert.deepEqual(eight.providers.map((p) => p.id), ["dawn-temple"]);
  assert.ok(!eight.providers[0].offers.some((o) => o.key === "identify"));
  assert.equal(eight.orders.length, 0);
  assert.ok(!JSON.stringify(tableForProtocol(t, 8).journal?.services).includes("itemHoldingId"));
});

test("offline: request and answer run through the device once, matching the shared engine", async () => {
  setSeat(DM_SEAT);
  const t = sageFixture();
  const ask = identifyCommand(t, "off-id", "ring");
  const shared0 = applyCommand(t, svcDm, ask);
  const answer = approve(order(shared0, "off-id"), { text: ANSWER, appendToNotes: true, rename: "Ring of Feather Falling" }, "off-answer");
  const shared = applyCommand(shared0, svcDm, answer);
  await applyCloudTable(structuredClone(t));
  await executeLocalCommand(ask);
  await executeLocalCommand(ask);
  const local = { ...answer, before: order(await economySnapshot(), "off-id") };
  await executeLocalCommand(local);
  await executeLocalCommand(local);
  const device = await economySnapshot();
  const outcome = (x: CloudTable) => ({
    kael: coins(x, "kael"),
    payments: x.ledger.filter((l) => l.id.endsWith("-payment")).map((l) => [l.id, l.copper]),
    ring: (({ name, notes }) => ({ name, notes }))(x.holdings.find((h) => h.id === "ring")!),
    thread: thread(x).map((m) => m.id),
    status: order(x, "off-id").status,
  });
  assert.deepEqual(outcome(device), outcome(shared));
  assert.equal(outcome(device).payments.length, 1);
});
