// Workshop commissions (docs/SERVICES.md): scribe and alchemist presets, contributed herbs, progress
// only through approved downtime, collection once at the workshop, DM control, offline parity.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand } from "./commands.ts";
import type { CloudTable } from "./cloud.ts";
import { toCopper } from "./money.ts";
import { previewDowntime } from "./finance.ts";
import { projectRecord } from "./session-records.ts";
import { applyCloudTable, economySnapshot, executeFinanceCommand, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { readServices } from "./services-schema.ts";
import { presetOffers, scrollTable } from "./services-presets.ts";
import { previewServices } from "./services-time.ts";
import { serviceQuote } from "./services.ts";
import { npcServices, servicesReply } from "./service-hub.ts";
import { workshopFixture, orderCommand, svcDm, svcKael, svcThorn } from "./test-fixtures/services.ts";

let seq = 0;
const run = (t: CloudTable, c: Record<string, unknown>, seat = svcDm) =>
  applyCommand(t, seat, { ...c, id: (c.id as string) ?? `ws-${++seq}` } as never);
const orders = (t: CloudTable) => readServices(t.journal?.services).orders;
const coins = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
const potions = (holdingId?: string, units = 3) => ({
  beneficiaryPurseIds: [],
  units,
  contributions: holdingId ? [{ componentKey: "healing-herbs", holdingId, quantity: 2 }] : [],
});
function downtime(t: CloudTable, days: number) {
  t = run(t, { kind: "downtime-plan", name: "Workshop days", days });
  return run(t, { kind: "downtime-apply", downtimeId: t.journal!.finance!.downtime.at(-1)!.id, endSession: false });
}
const brew = (t: CloudTable, id = "brew") =>
  applyCommand(t, svcKael, orderCommand(t, id, "potion-of-healing", "kael", potions("herbs"), "tamsin-brews"));

test("presets: SRD 5.2.1 scrolls at twice the scribing cost; brews by the crafting rule; SRD 5.1 drafts scrolls", () => {
  const scrolls = presetOffers("workshop", "srd-5.2.1", "Scribe");
  const fireball = scrolls.find((o) => o.key === "scroll-fireball")!;
  assert.equal(fireball.priceCopper, 30000);
  assert.deepEqual(fireball.time, { kind: "downtime-days", days: 5, perUnit: true });
  assert.equal(fireball.output.kind === "holding" && fireball.output.unitCopper, 30000);
  assert.deepEqual(scrollTable.map((r) => r.costGp * 2), [30, 50, 200, 300, 2000, 3000, 20000, 25000, 30000, 100000]);
  assert.ok(presetOffers("workshop", "srd-5.1", "Scribe").every((o) => !o.approved && o.priceCopper === 0));
  const brews = presetOffers("workshop", "srd-5.2.1", "Alchemist");
  const healing = brews.find((o) => o.key === "potion-of-healing")!;
  assert.equal(healing.priceCopper + healing.components![0].supplyCopper, 5000, "50 gp with the alchemist's herbs");
  assert.deepEqual(healing.time, { kind: "downtime-days", days: 1, perUnit: true });
  assert.equal(brews.find((o) => o.key === "antitoxin")!.time.kind === "downtime-days" && (brews.find((o) => o.key === "antitoxin")!.time as { days: number }).days, 5);
  assert.equal((presetOffers("workshop", "srd-5.1", "Alchemist").find((o) => o.key === "acid")!.time as { days: number }).days, 5);
  assert.deepEqual(presetOffers("workshop", "srd-5.2.1"), []);
});

test("an alchemist order with contributed herbs pays once now and hands the herbs over once", () => {
  let t = workshopFixture();
  const q = serviceQuote(t, "tamsin-brews", "potion-of-healing", "kael", potions("herbs"));
  assert.equal(q.terms.priceCopper, 10000, "3 × 25 gp work + 1 × 25 gp herbs supplied");
  assert.equal(q.terms.workDays, 3);
  const cmd = orderCommand(t, "brew", "potion-of-healing", "kael", potions("herbs"), "tamsin-brews");
  t = applyCommand(t, svcKael, cmd);
  const [o] = orders(t).filter((x) => x.id === "brew");
  assert.equal(o.status, "active");
  assert.equal(coins(t, "kael"), 234000 - 10000);
  assert.equal(t.holdings.find((h) => h.id === "herbs")!.quantity, 1);
  assert.equal(t.ledger.filter((l) => l.id === "brew-payment").length, 1);
  assert.throws(() => applyCommand(t, svcKael, cmd), /already been recorded|Review again|enough/);
  assert.equal(t.ledger.filter((l) => l.id === "brew-payment").length, 1);
});

test("work advances only with approved downtime; pause keeps progress; collect once at the workshop", () => {
  let t = brew(workshopFixture());
  // Session hours never do workshop work.
  assert.equal(previewServices(t, 5, true)!.state.orders[0].progressDays, 0);
  assert.equal(
    previewDowntime(t, t.journal!.finance!, 1, { minutes: 1440, allowCharacterWork: false, receiptId: "session" }).services!.state.orders[0].progressDays,
    0,
  );
  t = downtime(t, 2);
  let o = orders(t)[0];
  assert.deepEqual([o.progressDays, o.status], [2, "active"]);
  assert.ok(t.journal!.events.some((e) => e.purseId === "kael" && /Alchemist · Potion of Healing ×3: 2\/3 days; active/.test(e.summary)));
  t = run(t, { kind: "service-control", orderId: o.id, before: o, action: "pause", reason: "Out of vials." });
  t = downtime(t, 4);
  assert.deepEqual([orders(t)[0].progressDays, orders(t)[0].status], [2, "paused"]);
  o = orders(t)[0];
  assert.throws(() => run(t, { kind: "service-control", orderId: o.id, before: o, action: "resume", reason: "x" }, svcKael), /Only the DM/);
  t = run(t, { kind: "service-control", orderId: o.id, before: o, action: "resume", reason: "Vials arrived." });
  const day = t.journal!.finance!.day;
  t = downtime(t, 5);
  o = orders(t)[0];
  assert.deepEqual([o.progressDays, o.status, o.completedDay], [3, "ready", day + 1]);
  // Collection needs the payer at the workshop.
  const away = structuredClone(t);
  away.journal!.world!.characterPositions.push({ purseId: "kael", inParty: false, locationId: "saltmere", visible: true, sheetVisible: true });
  const claim = { id: "claim", kind: "service-claim", orderId: o.id, before: o };
  assert.throws(() => run(away, claim, svcKael), /Return to Old Tamsin's Remedies/);
  assert.throws(() => run(t, claim, svcThorn), /your own character/);
  t = run(t, claim, svcKael);
  const crafted = t.holdings.filter((h) => h.id === o.id + "-crafted");
  assert.equal(crafted.length, 1);
  assert.deepEqual([crafted[0].quantity, crafted[0].unitCopper, crafted[0].purseId, crafted[0].name], [3, 5000, "kael", "Potion of Healing"]);
  assert.match(crafted[0].notes, /Made by Old Tamsin at Old Tamsin's Remedies/);
  assert.equal(orders(t)[0].status, "claimed");
  assert.throws(() => run(t, claim, svcKael), /changed|not ready/);
  assert.equal(t.holdings.filter((h) => h.id === o.id + "-crafted").length, 1);
});

test("a cancelled commission never refunds by itself; the DM records an adjustment", () => {
  let t = brew(workshopFixture());
  const o = orders(t)[0];
  const before = coins(t, "kael");
  t = run(t, { kind: "service-control", orderId: o.id, before: o, action: "cancel", reason: "Tamsin left town." });
  assert.equal(orders(t)[0].status, "cancelled");
  assert.equal(coins(t, "kael"), before);
});

test("a scroll respects the settlement rule; the hub opens a sub-list for Aldous's two providers", () => {
  const t = workshopFixture();
  assert.equal(serviceQuote(t, "dawn-scribe", "scroll-fireball", "kael", potions(undefined, 1)).terms.priceCopper, 30000);
  const list = npcServices(t, "aldous", "kael");
  assert.deepEqual(list.map((s) => s.tag), ["Services · Temple", "Services · Workshop · Scribe"]);
  const reply = servicesReply(list, "Brother Aldous");
  assert.equal(reply.mode, "list");
  assert.equal(reply.tag, "Services · Temple, Workshop · Scribe");
});

test("privacy: another player sees no workshop orders, and their downtime notices go to the payer", () => {
  let t = brew(workshopFixture());
  t = downtime(t, 1);
  const thorn = projectRecord(t, svcThorn);
  assert.equal(readServices(thorn.journal?.services).orders.length, 0);
  assert.ok(!thorn.journal!.events.some((e) => /Potion of Healing/.test(e.summary)));
  assert.ok(projectRecord(t, svcKael).journal!.events.some((e) => /Potion of Healing/.test(e.summary)));
});

test("offline: order, downtime and collection on the device match the shared engine", async () => {
  setSeat(DM_SEAT);
  const base = workshopFixture();
  const order = orderCommand(base, "off-brew", "potion-of-healing", "kael", potions("herbs"), "tamsin-brews");
  let shared = applyCommand(structuredClone(base), svcDm, order);
  shared = applyCommand(shared, svcDm, { id: "plan", kind: "downtime-plan", name: "Brew", days: 3 } as never);
  shared = applyCommand(shared, svcDm, { id: "apply", kind: "downtime-apply", downtimeId: "plan", endSession: false } as never);
  const ready = orders(shared)[0];
  shared = applyCommand(shared, svcDm, { id: "claim", kind: "service-claim", orderId: ready.id, before: ready } as never);

  await applyCloudTable(structuredClone(base));
  await executeLocalCommand(order);
  await executeLocalCommand(order);
  await executeFinanceCommand({ id: "plan", kind: "downtime-plan", name: "Brew", days: 3 } as never);
  await executeFinanceCommand({ id: "apply", kind: "downtime-apply", downtimeId: "plan", endSession: false } as never);
  const local = orders(await economySnapshot())[0];
  const claim = { id: "claim", kind: "service-claim", orderId: local.id, before: local } as never;
  await executeLocalCommand(claim as never);
  await executeLocalCommand(claim as never);
  const device = await economySnapshot();
  const outcome = (t: CloudTable) => ({
    coins: t.purses.filter((p) => base.purses.some((b) => b.id === p.id)).map((p) => [p.id, toCopper(p.coins)]).sort(),
    holdings: t.holdings.map((h) => [h.id, h.quantity]).sort(),
    payments: t.ledger.filter((l) => l.id.endsWith("-payment")).map((l) => [l.id, l.copper]),
    orders: orders(t).map((o) => [o.id, o.status, o.progressDays, o.completedDay]),
  });
  assert.deepEqual(outcome(device), outcome(shared));
  assert.equal(outcome(device).orders[0][1], "claimed");
});
