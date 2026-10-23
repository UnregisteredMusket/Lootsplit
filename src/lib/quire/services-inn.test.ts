// Inn (docs/SERVICES.md): booked stays paid up front, whole copper, rumours delivered only into the
// buyer's private NPC thread, once per character or party, never charged twice, offline parity.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand } from "./commands.ts";
import type { CloudTable } from "./cloud.ts";
import { toCopper } from "./money.ts";
import { projectRecord } from "./session-records.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { readServices } from "./services-schema.ts";
import { presetOffers } from "./services-presets.ts";
import { rumourLock, rumourQuote, serviceQuote } from "./services.ts";
import { innFixture, svcDm, svcKael, svcThorn } from "./test-fixtures/services.ts";

const coins = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
const stay = (guests: string[], nights: number, tierKey = "comfortable", meals = 2) => ({
  beneficiaryPurseIds: guests,
  units: nights,
  contributions: [],
  inn: { tierKey, meals },
});
const book = (t: CloudTable, id: string, req = stay(["kael", "thorn"], 2)) =>
  applyCommand(t, svcKael, {
    id,
    kind: "service-order",
    providerId: "goose-inn",
    offerKey: "stay",
    purseId: "kael",
    request: req,
    before: serviceQuote(t, "goose-inn", "stay", "kael", req).before,
  });
const buy = (t: CloudTable, id: string, rumourId: string, seat = svcKael, purseId = "kael") =>
  applyCommand(t, seat, {
    id,
    kind: "service-rumour",
    providerId: "goose-inn",
    rumourId,
    purseId,
    before: rumourQuote(t, "goose-inn", rumourId, purseId).before,
  });
const thread = (t: CloudTable, purseId: string) =>
  t.journal!.world!.conversations.find((c) => c.id === `bram:${purseId}`)?.messages ?? [];

test("presets: SRD 5.2.1 rooms and meals per tier; SRD 5.1 prices food per day", () => {
  const [offer] = presetOffers("inn", "srd-5.2.1");
  assert.deepEqual(
    offer.tiers!.map((x) => [x.key, x.nightCopper, x.mealCopper]),
    [
      ["squalid", 7, 1],
      ["poor", 10, 2],
      ["modest", 50, 10],
      ["comfortable", 80, 20],
      ["wealthy", 200, 30],
      ["aristocratic", 400, 60],
    ],
  );
  assert.deepEqual(presetOffers("inn", "srd-5.1")[0].tiers!.map((x) => x.mealCopper), [3, 6, 30, 50, 80, 200]);
  assert.deepEqual(offer.time, { kind: "per-night", maxNights: 14 });
});

test("a booked stay is paid once up front: guests × nights × tier plus meals, each factor shown", () => {
  let t = innFixture();
  const q = serviceQuote(t, "goose-inn", "stay", "kael", stay(["kael", "thorn"], 2));
  assert.equal(q.terms.priceCopper, 2 * 2 * 80 + 2 * 2 * 2 * 20);
  assert.deepEqual(
    q.terms.lines.map((l) => l.label),
    ["Rooms · 2 guests × 2 nights × 8 sp", "Meals · 2 × 2 days × 2 × 2 sp"],
  );
  t = book(t, "stay-1");
  const o = readServices(t.journal?.services).orders.find((x) => x.id === "stay-1")!;
  assert.equal(o.status, "completed");
  assert.equal(coins(t, "kael"), 234000 - 480);
  assert.equal(coins(t, "thorn"), 1000);
  assert.equal(t.ledger.filter((l) => l.id === "stay-1-payment").length, 1);
  assert.throws(() => serviceQuote(t, "goose-inn", "stay", "kael", stay(["kael"], 15)), /between 1 and 14/);
  assert.throws(() => serviceQuote(t, "goose-inn", "stay", "kael", stay(["kael", "wren"], 1)), /Wren isn't at/);
  assert.throws(() => serviceQuote(t, "goose-inn", "stay", "kael", stay(["kael"], 1, "palace")), /Choose a room/);
});

test("whole copper: guests × nights × price overflow is refused", () => {
  let t = innFixture();
  const p = readServices(t.journal?.services).providers.find((x) => x.id === "goose-inn")!;
  const huge = structuredClone(p);
  huge.offers[0].tiers![0].nightCopper = 5e11;
  t = applyCommand(t, svcDm, { id: "huge", kind: "service-provider", providerId: p.id, before: p, provider: huge });
  assert.throws(() => serviceQuote(t, "goose-inn", "stay", "kael", stay(["kael", "thorn"], 2, "squalid", 0)), /copper range/);
});

test("rumours: text never projected before purchase; after it, only in the buyer's private thread", () => {
  let t = innFixture();
  for (const seat of [svcKael, svcThorn]) assert.ok(!JSON.stringify(projectRecord(t, seat)).includes("SECRET"));
  t = buy(t, "rum-1", "mill");
  assert.equal(coins(t, "kael"), 234000 - 50);
  assert.equal(t.ledger.filter((l) => l.id === "rum-1-payment").length, 1);
  assert.deepEqual(thread(t, "kael").map((m) => [m.id, m.author, m.text]), [["rum-1-rumour", "npc", "SECRET: lanterns in the old mill three nights running."]]);
  const kael = JSON.stringify(projectRecord(t, svcKael));
  assert.ok(kael.includes("lanterns in the old mill"));
  assert.ok(!kael.includes("they camp by the ford"));
  assert.ok(!JSON.stringify(projectRecord(t, svcThorn)).includes("lanterns"), "Thorn doesn't see Kael's rumour");
  const kaelRumour = readServices(projectRecord(t, svcKael).journal?.services).providers.find((p) => p.id === "goose-inn")!.rumours!.find((r) => r.id === "mill")!;
  assert.deepEqual(kaelRumour.boughtBy, ["kael"]);
  assert.equal(kaelRumour.buyers, undefined);
  assert.equal(kaelRumour.text, undefined);
});

test("rumours: once per character, once per party, and a retry or a race is never charged twice", () => {
  let t = innFixture();
  const first = { id: "rum", kind: "service-rumour" as const, providerId: "goose-inn", rumourId: "mill", purseId: "kael", before: rumourQuote(t, "goose-inn", "mill", "kael").before };
  t = applyCommand(t, svcKael, first);
  assert.throws(() => applyCommand(t, svcKael, first), /You bought this/);
  assert.throws(() => buy(t, "rum-again", "mill"), /You bought this/);
  assert.equal(t.ledger.filter((l) => l.id.startsWith("rum") && l.id.endsWith("-payment")).length, 1);
  // Thorn may still buy the same once-per-character rumour.
  t = buy(t, "thorn-mill", "mill", svcThorn, "thorn");
  assert.equal(coins(t, "thorn"), 1000 - 50);
  // Once per party: whoever buys first, the next is refused, even with a quote taken before.
  const raced = rumourQuote(t, "goose-inn", "toll", "thorn").before;
  t = buy(t, "kael-toll", "toll");
  assert.throws(
    () => applyCommand(t, svcThorn, { id: "thorn-toll", kind: "service-rumour", providerId: "goose-inn", rumourId: "toll", purseId: "thorn", before: raced }),
    /already bought/,
  );
  const provider = readServices(projectRecord(t, svcThorn).journal?.services).providers.find((p) => p.id === "goose-inn")!;
  assert.equal(rumourLock(projectRecord(t, svcThorn), provider, "toll", "thorn"), "Someone in the party already bought this one.");
  assert.throws(() => buy(t, "theft", "toll", svcThorn, "kael"), /your own character|You bought/);
});

test("offline: a booking and a rumour on the device match the shared engine; retries apply once", async () => {
  setSeat(DM_SEAT);
  const base = innFixture();
  const req = stay(["kael", "thorn"], 3);
  const order = { id: "off-stay", kind: "service-order" as const, providerId: "goose-inn", offerKey: "stay", purseId: "kael", request: req, before: serviceQuote(base, "goose-inn", "stay", "kael", req).before };
  const rumour = { id: "off-rum", kind: "service-rumour" as const, providerId: "goose-inn", rumourId: "mill", purseId: "kael", before: rumourQuote(base, "goose-inn", "mill", "kael").before };
  let shared = applyCommand(structuredClone(base), svcDm, order);
  shared = applyCommand(shared, svcDm, { ...rumour, before: rumourQuote(shared, "goose-inn", "mill", "kael").before });
  await applyCloudTable(structuredClone(base));
  await executeLocalCommand(order);
  await executeLocalCommand(order);
  const r2 = { ...rumour, before: rumourQuote(await economySnapshot(), "goose-inn", "mill", "kael").before };
  await executeLocalCommand(r2);
  await executeLocalCommand(r2);
  const device = await economySnapshot();
  const outcome = (t: CloudTable) => ({
    coins: t.purses.filter((p) => base.purses.some((b) => b.id === p.id)).map((p) => [p.id, toCopper(p.coins)]).sort(),
    payments: t.ledger.filter((l) => l.id.endsWith("-payment")).map((l) => [l.id, l.copper]).sort(),
    thread: thread(t, "kael").map((m) => [m.id, m.text]),
    buyers: readServices(t.journal?.services).providers.find((p) => p.id === "goose-inn")!.rumours!.map((r) => r.buyers),
  });
  assert.deepEqual(outcome(device), outcome(shared));
  assert.equal(outcome(device).payments.length, 2);
});
