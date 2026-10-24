// Temple services (docs/SERVICES.md): command IDs, stale quotes, charge on approval, components,
// availability, whole copper, privacy, deletion guards, old saves and offline parity.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand } from "./commands.ts";
import type { CloudTable } from "./cloud.ts";
import { toCopper } from "./money.ts";
import { projectRecord } from "./session-records.ts";
import { preserveJournalMetadata, readJournal } from "./journal.ts";
import { tableForProtocol, hasNpcServices, tabletopResponse } from "./tabletop-protocol.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand, removePurse, removeShop } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { readServices } from "./services-schema.ts";
import { npcServices, servicesReply } from "./service-hub.ts";
import {
  providerLock,
  reviewChecks,
  serviceQuote,
  offerSettlementLock,
  providerSettlement,
  componentCandidates,
} from "./services.ts";
import { applyPreset, presetOffers } from "./services-presets.ts";
import { validateServices } from "./services-validation.ts";
import {
  servicesFixture,
  orderCommand,
  request,
  svcDm,
  svcKael,
  svcThorn,
} from "./test-fixtures/services.ts";

const coins = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
const orders = (t: CloudTable) => readServices(t.journal?.services).orders;
const provider = (t: CloudTable) => readServices(t.journal?.services).providers[0];
const payments = (t: CloudTable, id: string) => t.ledger.filter((l) => l.id === id + "-payment");
const editProvider = (t: CloudTable, change: (p: ReturnType<typeof provider>) => void) => {
  const before = provider(t),
    after = structuredClone(before);
  change(after);
  return applyCommand(t, svcDm, { id: `edit-${Math.random()}`, kind: "service-provider", providerId: before.id, before, provider: after });
};

test("an automatic offer pays once, records only, and a reused command ID is refused", () => {
  let t = servicesFixture();
  const cmd = orderCommand(t, "rc-1", "remove-curse", "kael", request("thorn"));
  t = applyCommand(t, svcKael, cmd);
  const [o] = orders(t);
  assert.equal(o.status, "completed");
  assert.equal(o.terms.priceCopper, 30000);
  assert.deepEqual(o.terms.beneficiaries, [{ purseId: "thorn", name: "Thorn" }]);
  assert.equal(coins(t, "kael"), 234000 - 30000);
  assert.equal(coins(t, "thorn"), 1000, "the beneficiary pays nothing and nothing on their sheet changes");
  assert.equal(payments(t, "rc-1").length, 1);
  assert.equal(payments(t, "rc-1")[0].shopId, "temple");
  assert.match(o.message, /Recorded only/);
  const event = t.journal!.events.find((e) => e.id === "rc-1-service-event")!;
  assert.equal(event.purseId, "kael");
  assert.throws(() => applyCommand(t, svcKael, cmd), /already been recorded|changed/);
  assert.equal(payments(t, "rc-1").length, 1);
});

test("a changed price, payer coins or component lot refuses the stale quote", () => {
  const t = servicesFixture();
  const cmd = orderCommand(t, "stale", "remove-curse", "kael", request("thorn"));
  const repriced = editProvider(t, (p) => (p.offers.find((o) => o.key === "remove-curse")!.priceCopper = 31000));
  assert.throws(() => applyCommand(repriced, svcKael, cmd), /Review again/);
  const poorer = structuredClone(t);
  poorer.purses.find((p) => p.id === "kael")!.coins.gp -= 1;
  assert.throws(() => applyCommand(poorer, svcKael, cmd), /Review again/);
  const withDiamond = orderCommand(t, "stale-2", "revivify", "kael", request("thorn", [{ componentKey: "diamond", holdingId: "diamond-300", quantity: 1 }]));
  const changed = structuredClone(t);
  changed.holdings.find((h) => h.id === "diamond-300")!.notes = "chipped";
  assert.throws(() => applyCommand(changed, svcKael, withDiamond), /Review again/);
});

test("Raise Dead waits for review: request, cancel and deny move nothing; approve charges once", () => {
  let t = servicesFixture();
  const give = [{ componentKey: "diamond", holdingId: "diamond-500", quantity: 1 }];
  const ask = orderCommand(t, "rd-1", "raise-dead", "kael", request("thorn", give));
  t = applyCommand(t, svcKael, ask);
  assert.equal(orders(t)[0].status, "requested");
  assert.equal(coins(t, "kael"), 234000);
  assert.ok(t.holdings.some((h) => h.id === "diamond-500"));
  assert.equal(payments(t, "rd-1").length, 0);
  // Cancel by the payer moves nothing.
  t = applyCommand(t, svcKael, { id: "rd-1-cancel", kind: "service-cancel", orderId: "rd-1", before: orders(t)[0] });
  assert.equal(orders(t)[0].status, "cancelled");
  assert.equal(coins(t, "kael"), 234000);
  // Deny needs a reason and moves nothing.
  t = applyCommand(t, svcKael, orderCommand(t, "rd-2", "raise-dead", "kael", request("thorn", give)));
  const pending = () => orders(t).find((o) => o.id === "rd-2")!;
  assert.throws(() => applyCommand(t, svcDm, { id: "deny-blank", kind: "service-review", orderId: "rd-2", before: pending(), decision: "deny", reason: "" }), /reason/);
  t = applyCommand(t, svcDm, { id: "deny", kind: "service-review", orderId: "rd-2", before: pending(), decision: "deny", reason: "His soul does not wish to return." });
  assert.equal(pending().status, "denied");
  assert.equal(coins(t, "kael"), 234000);
  assert.ok(t.holdings.some((h) => h.id === "diamond-500"));
  // Approve: players can't; the DM charges once and consumes the diamond once.
  t = applyCommand(t, svcKael, orderCommand(t, "rd-3", "raise-dead", "kael", request("thorn", give)));
  const third = () => orders(t).find((o) => o.id === "rd-3")!;
  const approve = { id: "approve", kind: "service-review" as const, orderId: "rd-3", before: third(), decision: "approve" as const, reason: "He wakes at dusk." };
  assert.throws(() => applyCommand(t, svcKael, approve), /Only the DM/);
  assert.throws(() => applyCommand(t, svcThorn, approve), /Only the DM/);
  t = applyCommand(t, svcDm, approve);
  assert.equal(third().status, "completed");
  assert.match(third().message, /He wakes at dusk/);
  assert.equal(coins(t, "kael"), 234000 - 200000);
  assert.equal(payments(t, "rd-3").length, 1);
  assert.ok(!t.holdings.some((h) => h.id === "diamond-500"), "the diamond is consumed");
  assert.throws(() => applyCommand(t, svcDm, approve), /changed|already been decided/);
  assert.equal(payments(t, "rd-3").length, 1);
});

test("approval reruns every check: funds, the diamond and the beneficiary", () => {
  const base = applyCommand(
    servicesFixture(),
    svcKael,
    orderCommand(servicesFixture(), "rd", "raise-dead", "kael", request("thorn", [{ componentKey: "diamond", holdingId: "diamond-500", quantity: 1 }])),
  );
  const approve = (t: CloudTable) =>
    applyCommand(t, svcDm, { id: "ok", kind: "service-review", orderId: "rd", before: orders(t)[0], decision: "approve", reason: "" });
  assert.ok(reviewChecks(base, orders(base)[0]).every((c) => c.ok));

  const broke = structuredClone(base);
  broke.purses.find((p) => p.id === "kael")!.coins = { cp: 0, sp: 0, ep: 0, gp: 100, pp: 0 };
  assert.throws(() => approve(broke), /can't afford/);
  assert.ok(reviewChecks(broke, orders(broke)[0]).some((c) => !c.ok && /needs 2000 gp/.test(c.text)));

  const stored = structuredClone(base);
  stored.holdings.find((h) => h.id === "diamond-500")!.reservedFor = "job";
  assert.throws(() => approve(stored), /Retrieve this item/);
  assert.ok(reviewChecks(stored, orders(stored)[0]).some((c) => !c.ok && /still carried/.test(c.text)));

  const away = structuredClone(base);
  away.journal!.world!.characterPositions.push({ purseId: "thorn", inParty: false, locationId: "saltmere", visible: true, sheetVisible: true });
  assert.throws(() => approve(away), /Thorn isn't at Temple of the Dawn/);
  assert.ok(reviewChecks(away, orders(away)[0]).some((c) => !c.ok && /Thorn is at Harrowgate/.test(c.text)));

  const repriced = editProvider(base, (p) => (p.offers.find((o) => o.key === "raise-dead")!.priceCopper = 1));
  assert.throws(() => approve(repriced), /price changed/);
  assert.equal(payments(repriced, "rd").length, 0);
});

test("components: the held-item check and provider supply", () => {
  const t = servicesFixture();
  const quote = (holdingId: string | null, offer = "raise-dead", purse = "kael") =>
    serviceQuote(t, "dawn-temple", offer, purse, request("thorn", holdingId ? [{ componentKey: "diamond", holdingId, quantity: 1 }] : []));
  assert.equal(quote(null).terms.priceCopper, 250000, "the temple supplies the diamond for +500 gp");
  assert.equal(quote("diamond-500").terms.priceCopper, 200000);
  assert.throws(() => quote("diamond-300"), /worth at least 500 gp/);
  assert.throws(() => quote("ruby"), /not another item/);
  assert.throws(() => quote("thorn-diamond"), /owned by the paying character/);
  const equipped = structuredClone(t);
  equipped.holdings.find((h) => h.id === "diamond-500")!.equipped = true;
  assert.throws(
    () => serviceQuote(equipped, "dawn-temple", "raise-dead", "kael", request("thorn", [{ componentKey: "diamond", holdingId: "diamond-500", quantity: 1 }])),
    /Unequip/,
  );
  const transit = structuredClone(t);
  transit.holdings.find((h) => h.id === "diamond-500")!.custody = { kind: "transit", propertyId: "x" } as never;
  assert.throws(
    () => serviceQuote(transit, "dawn-temple", "raise-dead", "kael", request("thorn", [{ componentKey: "diamond", holdingId: "diamond-500", quantity: 1 }])),
    /Retrieve this item/,
  );
  const candidates = componentCandidates(t, "kael", { materialKey: "diamond", minCopper: 50000 });
  assert.deepEqual(
    candidates.map((c) => [c.holding.id, c.blocked]),
    [
      ["diamond-500", ""],
      ["diamond-300", "Worth less than 500 gp."],
    ],
  );
  // A party-only component must be brought.
  const partyOnly = editProvider(t, (p) => (p.offers.find((o) => o.key === "raise-dead")!.components![0].supply = "party"));
  assert.throws(() => serviceQuote(partyOnly, "dawn-temple", "raise-dead", "kael", request("thorn")), /Bring the Diamond/);
});

test("availability: every lock reason in the hub order, the same text the order refuses with", () => {
  const t = servicesFixture();
  const p = provider(t);
  const lock = (x: CloudTable, purse: string | undefined = "kael") => providerLock(x, provider(x), purse);
  assert.equal(lock(t), "");
  const pending = structuredClone(t);
  (pending.journal!.finance as { downtime: unknown[] }).downtime.push({ status: "pending" });
  assert.equal(lock(pending), "Services pause while the DM reviews downtime.");
  assert.equal(providerLock(t, p, undefined), "Choose a character first.");
  const off = structuredClone(t);
  off.journal!.world!.npcs[0].services = [];
  assert.equal(lock(off), "Brother Aldous doesn't offer temple services right now.");
  const closed = structuredClone(t);
  closed.shops[0].closed = true;
  assert.equal(lock(closed), "Temple of the Dawn is closed.");
  const npcAway = structuredClone(t);
  npcAway.journal!.world!.characterPositions.push({ purseId: "aldous", inParty: false, locationId: "saltmere", visible: true, sheetVisible: true });
  assert.equal(lock(npcAway), "Brother Aldous isn't at Temple of the Dawn.");
  assert.equal(lock(t, "wren"), "Wren isn't at Temple of the Dawn.");
  const paused = editProvider(t, (x) => (x.paused = { reason: "Away at the synod" }));
  assert.equal(lock(paused), "Not taking new orders: “Away at the synod”");
  assert.throws(() => applyCommand(paused, svcKael, orderCommand(t, "x", "cure-wounds", "kael", request("kael"))), /Not taking new orders|Review again/);
  // Settlement: Harrowgate is a town, so a level 7 spell is locked; a DM override unlocks it.
  const resurrection = p.offers.find((o) => o.key === "resurrection")!;
  assert.equal(providerSettlement(t, p).kind, "town");
  assert.equal(offerSettlementLock(t, p, resurrection), "Only in a city. Harrowgate is a town.");
  assert.throws(() => serviceQuote(t, "dawn-temple", "resurrection", "kael", request("thorn")), /Only in a city/);
  const city = editProvider(t, (x) => (x.settlement = "city"));
  assert.equal(offerSettlementLock(city, provider(city), resurrection), "");
  const village = editProvider(t, (x) => (x.settlement = "village"));
  assert.equal(offerSettlementLock(village, provider(village), p.offers.find((o) => o.key === "remove-curse")!), "Only in a town or city. Harrowgate is a village.");
  // A beneficiary who isn't here can't be named; a non-party purse never.
  assert.throws(() => serviceQuote(t, "dawn-temple", "cure-wounds", "kael", request("wren")), /Wren isn't at/);
  assert.throws(() => serviceQuote(t, "dawn-temple", "cure-wounds", "kael", request("fund")), /party character/);
  // The hub lists the temple with the same reason.
  assert.equal(npcServices(off, "aldous", "kael")[0].locked, "Brother Aldous doesn't offer temple services right now.");
  assert.equal(servicesReply(npcServices(t, "aldous", "kael"), "Brother Aldous").mode, "direct");
});

test("whole copper: price × units overflow is refused", () => {
  const t = editProvider(servicesFixture(), (p) => {
    const o = p.offers.find((o) => o.key === "cure-wounds")!;
    o.priceCopper = 6e11;
    o.maxUnits = 2;
  });
  assert.throws(
    () => serviceQuote(t, "dawn-temple", "cure-wounds", "kael", { ...request("kael"), units: 2 }),
    /copper range/,
  );
});

test("server-side authorization: provider edits, someone else's purse, approvals", () => {
  const t = servicesFixture();
  const p = provider(t);
  assert.throws(
    () => applyCommand(t, svcKael, { id: "x", kind: "service-provider", providerId: p.id, before: p, provider: { ...p, paused: { reason: "mine" } } }),
    /Only the DM/,
  );
  const cmd = orderCommand(t, "theft", "cure-wounds", "kael", request("kael"));
  assert.throws(() => applyCommand(t, svcThorn, cmd), /your own character/);
  const asked = applyCommand(t, svcKael, orderCommand(t, "rd", "raise-dead", "kael", request("thorn")));
  assert.throws(
    () => applyCommand(asked, svcThorn, { id: "c", kind: "service-cancel", orderId: "rd", before: orders(asked)[0] }),
    /your own character/,
  );
});

test("privacy: drafts, other players' orders, rumour text, hidden providers and DM-only events", () => {
  let t = editProvider(servicesFixture(), (p) => {
    p.rumours = [{ id: "mill", teaser: "Lights at the old mill.", text: "SECRET-MILL-TEXT", priceCopper: 50, once: "character", buyers: ["thorn"] }];
  });
  t = applyCommand(t, svcKael, orderCommand(t, "kael-order", "cure-wounds", "kael", request("thorn")));
  const view = projectRecord(t, svcThorn);
  const s = readServices(view.journal?.services);
  assert.equal(s.orders.length, 0, "Thorn sees no orders Kael placed, even on Thorn");
  assert.ok(!s.providers[0].offers.some((o) => o.key === "greater-restoration"), "drafts stay with the DM");
  assert.ok(!JSON.stringify(view).includes("SECRET-MILL-TEXT"));
  assert.deepEqual(s.providers[0].rumours, [{ id: "mill", teaser: "Lights at the old mill.", priceCopper: 50, once: "character", boughtBy: ["thorn"] }]);
  const kaelView = projectRecord(t, svcKael);
  assert.equal(readServices(kaelView.journal?.services).orders.length, 1);
  assert.deepEqual(readServices(kaelView.journal?.services).providers[0].rumours![0].boughtBy, undefined);
  assert.ok(!view.journal!.events.some((e) => e.id === "temple-setup-service-event"), "setup events are DM-only");
  const hidden = structuredClone(t);
  hidden.journal!.world!.npcs[0].visible = false;
  assert.equal(readServices(projectRecord(hidden, svcKael).journal?.services).providers.length, 0);
  // The player's projected table passes validation and quotes the same fingerprint.
  validateServices(view, true);
  assert.equal(
    serviceQuote(kaelView, "dawn-temple", "cure-wounds", "kael", request("kael")).before,
    serviceQuote(t, "dawn-temple", "cure-wounds", "kael", request("kael")).before,
  );
});

test("deletion guards keep open orders' customers, providers and locations", async () => {
  let t = servicesFixture();
  t = applyCommand(t, svcKael, orderCommand(t, "rd", "raise-dead", "kael", request("thorn")));
  const p = provider(t);
  assert.throws(() => applyCommand(t, svcDm, { id: "rm", kind: "service-provider", providerId: p.id, before: p, provider: null }), /Resolve open orders/);
  assert.throws(() => validateServices({ ...t, purses: t.purses.filter((x) => x.id !== "kael") }), /Resolve open service orders/);
  assert.throws(() => validateServices({ ...t, shops: [] }), /existing shop/);
  setSeat(DM_SEAT);
  await applyCloudTable(t);
  await assert.rejects(removeShop("temple"), /services this shop hosts/);
  await assert.rejects(removePurse("kael"), /open service orders/);
  await assert.rejects(removePurse("aldous"), /services this NPC provides/);
});

test("old saves and older clients keep services and NPC service lists", () => {
  const t = servicesFixture();
  const plain = readJournal({});
  assert.equal(plain.services, undefined);
  validateServices({ ...t, journal: plain });
  // An older client writes the journal back without either field.
  const old = structuredClone(t.journal!) as Record<string, unknown> & typeof t.journal;
  delete (old as { services?: unknown }).services;
  delete old!.world!.npcs[0].services;
  const kept = preserveJournalMetadata(old, t.journal!);
  assert.deepEqual(kept.services, t.journal!.services);
  assert.deepEqual(kept.world!.npcs[0].services, ["temple"]);
  // Protocol 7 clients receive NPCs without the list; current clients get it.
  assert.ok(hasNpcServices(t));
  assert.equal(tableForProtocol(t, 7).journal!.world!.npcs[0].services, undefined);
  assert.deepEqual(tableForProtocol(t, 8).journal!.world!.npcs[0].services, ["temple"]);
  assert.throws(
    () => tabletopResponse({ table: t, draft: JSON.stringify([{ kind: "service-order" }]) }, 7),
    /updated Lootsplitter client/,
  );
  // An older client's NPC save keeps the stored list.
  const npc = structuredClone(t.journal!.world!.npcs[0]);
  delete npc.services;
  const saved = applyCommand(t, svcDm, { id: "legacy-save", kind: "npc-save", before: npc, npc: { ...npc, description: "Older client edit" } });
  assert.deepEqual(saved.journal!.world!.npcs[0].services, ["temple"]);
  assert.equal(saved.journal!.world!.npcs[0].description, "Older client edit");
});

test("presets: SRD 5.2.1 by default, SRD 5.1 prices levels 1–2 and drafts the rest, blank adds nothing", () => {
  const srd = presetOffers("temple", "srd-5.2.1");
  assert.deepEqual(
    srd.map((o) => [o.key, o.priceCopper, o.approved, o.review]),
    [
      ["cure-wounds", 5000, true, "auto"],
      ["lesser-restoration", 20000, true, "auto"],
      ["remove-curse", 30000, true, "auto"],
      ["revivify", 30000, true, "auto"],
      ["greater-restoration", 200000, false, "auto"],
      ["raise-dead", 200000, true, "dm"],
      ["resurrection", 2000000, true, "dm"],
      // Wave 2: temples carry Identify as a draft for the DM to switch on.
      ["identify", 5000, false, "dm"],
    ],
  );
  const old = presetOffers("temple", "srd-5.1");
  assert.deepEqual(
    old.map((o) => [o.key, o.priceCopper, o.approved]),
    [
      ["cure-wounds", 5000, true],
      ["lesser-restoration", 5000, true],
      ["remove-curse", 0, false],
      ["revivify", 0, false],
      ["greater-restoration", 0, false],
      ["raise-dead", 0, false],
      ["resurrection", 0, false],
      ["identify", 5000, false],
    ],
  );
  assert.deepEqual(presetOffers("temple", "blank"), []);
  // Applying a preset fills unset prices only; an edited price stays.
  const edited = { ...provider(servicesFixture()), offers: old.map((o) => (o.key === "cure-wounds" ? { ...o, priceCopper: 1234 } : o)) };
  const filled = applyPreset(edited, "srd-5.2.1");
  assert.equal(filled.offers.find((o) => o.key === "cure-wounds")!.priceCopper, 1234);
  assert.equal(filled.offers.find((o) => o.key === "raise-dead")!.priceCopper, 200000);
});

test("offline: the device runs the same commands, and a retried command ID applies once", async () => {
  setSeat(DM_SEAT);
  const base = servicesFixture();
  const run = async (t: CloudTable) => {
    const shared = [] as CloudTable[];
    const ask = orderCommand(t, "off-rd", "raise-dead", "kael", request("thorn", [{ componentKey: "diamond", holdingId: "diamond-500", quantity: 1 }]));
    const auto = orderCommand(t, "off-rc", "remove-curse", "kael", request("thorn"));
    let s = applyCommand(structuredClone(t), svcDm, auto);
    s = applyCommand(s, svcDm, { ...ask, before: serviceQuote(s, "dawn-temple", "raise-dead", "kael", ask.request).before });
    const approve = { id: "off-approve", kind: "service-review" as const, orderId: "off-rd", before: orders(s).find((o) => o.id === "off-rd")!, decision: "approve" as const, reason: "" };
    s = applyCommand(s, svcDm, approve);
    shared.push(s);
    await applyCloudTable(structuredClone(t));
    await executeLocalCommand(auto);
    await executeLocalCommand(auto);
    await executeLocalCommand({ ...ask, before: serviceQuote(await economySnapshot(), "dawn-temple", "raise-dead", "kael", ask.request).before });
    const local = { ...approve, before: orders(await economySnapshot()).find((o) => o.id === "off-rd")! };
    await executeLocalCommand(local);
    await executeLocalCommand(local);
    return { shared: shared[0], device: await economySnapshot() };
  };
  const { shared, device } = await run(base);
  const outcome = (t: CloudTable) => ({
    // The device adds its own exchange treasuries on import; compare the campaign's purses.
    coins: t.purses.filter((p) => base.purses.some((b) => b.id === p.id)).map((p) => [p.id, toCopper(p.coins)]).sort(),
    holdings: t.holdings.map((h) => h.id).sort(),
    payments: t.ledger.filter((l) => l.id.endsWith("-payment")).map((l) => [l.id, l.copper, l.shopId]).sort(),
    orders: orders(t).map((o) => [o.id, o.status, o.terms.priceCopper]),
  });
  assert.deepEqual(outcome(device), outcome(shared));
  assert.equal(outcome(device).payments.length, 2);
});

test("Here sheet: one row per provider, opening the NPC; a closed provider is disabled", async () => {
  const { hereSheet } = await import("./place-hub.ts");
  const t = servicesFixture();
  const sheet = hereSheet(projectRecord(t, svcKael), { role: "player", purseIds: ["kael"] });
  assert.equal(sheet.mode, "here");
  const row = sheet.mode === "here" ? sheet.rows.find((r) => r.key === "service:dawn-temple") : undefined;
  assert.deepEqual(
    row && { label: row.label, action: row.action, ref: row.reference, disabled: row.disabled },
    { label: "Temple · Temple of the Dawn", action: "Services", ref: { kind: "npc", id: "aldous" }, disabled: undefined },
  );
  const paused = editProvider(t, (p) => (p.paused = { reason: "Away at the synod" }));
  const closed = hereSheet(paused, { role: "dm", purseIds: [] });
  const pausedRow = closed.mode === "here" ? closed.rows.find((r) => r.key === "service:dawn-temple") : undefined;
  assert.equal(pausedRow?.disabled, "Not taking new orders: Away at the synod");
});
