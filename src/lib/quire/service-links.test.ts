// Services wave 2, phase 4a (docs/SERVICES.md): the new kinds, tabletop protocol 9, and the
// connect-only links (fence, bank, hire) plus the Tailor workshop preset. Links open existing
// screens and never move money by themselves.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand } from "./commands.ts";
import type { CloudTable } from "./cloud.ts";
import { toCopper } from "./money.ts";
import { projectRecord } from "./session-records.ts";
import { preserveJournalMetadata } from "./journal.ts";
import {
  CURRENT_TABLETOP_PROTOCOL,
  SERVICES_WAVE2_PROTOCOL,
  hasWave2Services,
  tableForProtocol,
  tabletopResponse,
} from "./tabletop-protocol.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand, removePurse } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { readServices, serviceProviderSchema, type ServiceProvider } from "./services-schema.ts";
import { npcServices, servicesReply } from "./service-hub.ts";
import { bankForLoanNote, bankLoanNote, providerLock, serviceQuote } from "./services.ts";
import { applyPreset, fenceShopPreset, newProvider, presetLink, presetOffers } from "./services-presets.ts";
import { validateServices } from "./services-validation.ts";
import { readEstate } from "./estate-schema.ts";
import { linksFixture, servicesFixture, svcDm, svcKael, svcThorn } from "./test-fixtures/services.ts";

const provider = (t: CloudTable, id: string) => readServices(t.journal?.services).providers.find((p) => p.id === id)!;
const coins = (t: CloudTable) => t.purses.map((p) => [p.id, toCopper(p.coins)]);
const blackMarket = (t: CloudTable, active: boolean) =>
  applyCommand(t, svcDm, { id: `bm-${active}-${Math.random()}`, kind: "black-market", before: !!t.journal?.world?.blackMarketActive, active });
const hireProposal = (t: CloudTable, id: string, role = "guard") => {
  const r = provider(t, "ottilie-hire").link!.roles!.find((x) => x.key === role)!;
  return {
    id,
    kind: "estate-staff" as const,
    before: null,
    staff: {
      id,
      propertyId: "townhouse",
      name: "Brannoc",
      role: r.name,
      wageCopper: r.wageCopper,
      periodDays: r.periodDays,
      status: "proposed" as const,
      manager: false,
      duties: [],
      budgetCopper: 0,
      budgetPeriodDays: 30,
      budgetStartDay: t.journal!.finance!.day,
      budgetSpentCopper: 0,
      notes: "Hired through Harrowgate Counting House (Ottilie Grane).",
      ...(r.npcId ? { npcId: r.npcId } : {}),
    },
  };
};

test("protocol 9 is the current protocol", () => {
  assert.equal(SERVICES_WAVE2_PROTOCOL, 9);
  assert.equal(CURRENT_TABLETOP_PROTOCOL, 9);
});

test("link kinds take no offers, carry only their own settings, and engines not built yet are refused", () => {
  const t = linksFixture();
  const bank = provider(t, "ottilie-bank");
  const edit = (p: ServiceProvider) =>
    applyCommand(t, svcDm, { id: `edit-${Math.random()}`, kind: "service-provider", providerId: p.id, before: provider(t, p.id), provider: p });
  assert.throws(() => edit({ ...bank, offers: presetOffers("temple", "srd-5.2.1").slice(0, 1) }), /has no offers/);
  assert.throws(() => edit({ ...bank, link: { ...bank.link, roles: [{ key: "x", name: "X", wageCopper: 1, periodDays: 1 }] } }), /only a hire link/);
  const fence = provider(t, "rook-fence");
  assert.throws(() => edit({ ...fence, link: { loan: bank.link!.loan } }), /only a bank/);
  const temple = provider(t, "dawn-temple");
  assert.throws(() => edit({ ...temple, link: {} }), /only fence, bank and hire/);
  const hire = provider(t, "ottilie-hire");
  assert.throws(() => edit({ ...hire, link: { roles: [hire.link!.roles![0], hire.link!.roles![0]] } }), /Duplicate hire roles/);
  assert.throws(() => edit({ ...hire, link: { roles: [{ ...hire.link!.roles![0], npcId: "nobody" }] } }), /existing NPC/);
  for (const kind of ["trainer", "stable", "courier", "sage"] as const)
    assert.throws(
      () =>
        applyCommand(t, svcDm, {
          id: `new-${kind}`,
          kind: "service-provider",
          providerId: `x-${kind}`,
          before: null,
          provider: newProvider(kind, { id: "temple", name: "Temple of the Dawn" }, "aldous", `x-${kind}`),
        }),
      /isn't available yet/,
    );
  // A player can't configure a link.
  assert.throws(
    () => applyCommand(t, svcKael, { id: "k", kind: "service-provider", providerId: bank.id, before: bank, provider: { ...bank, name: "Mine" } }),
    /Only the DM/,
  );
});

test("no link takes an order or moves money; service-order on a link is refused", () => {
  const t = linksFixture();
  for (const id of ["rook-fence", "ottilie-bank", "ottilie-hire"])
    assert.throws(
      () => serviceQuote(blackMarket(t, true), id, "anything", "kael", { beneficiaryPurseIds: [], units: 1, contributions: [] }),
      /opens another screen/,
    );
  assert.throws(
    () =>
      applyCommand(t, svcKael, {
        id: "o",
        kind: "service-order",
        providerId: "ottilie-bank",
        offerKey: "x",
        purseId: "kael",
        request: { beneficiaryPurseIds: [], units: 1, contributions: [] },
        before: "",
      }),
    /opens another screen/,
  );
});

test("fence: hidden while the black market is off; opens the fence's Sell tab when on", () => {
  const off = linksFixture();
  assert.equal(off.journal!.world!.blackMarketActive, false);
  const offView = projectRecord(off, svcKael);
  assert.ok(!readServices(offView.journal?.services).providers.some((p) => p.kind === "fence"), "players never receive the fence");
  assert.equal(npcServices(offView, "rook", "kael").length, 0);
  // The DM sees it locked with the reason.
  assert.equal(providerLock(off, provider(off, "rook-fence"), "kael"), "Rook isn't dealing right now.");
  const on = blackMarket(off, true);
  const view = projectRecord(on, svcKael);
  const [entry] = npcServices(view, "rook", "kael");
  assert.equal(entry.label, "Fence");
  assert.equal(entry.href, "/shop/back-room#sell");
  assert.equal(entry.link, true);
  assert.equal(entry.providerId, undefined);
  assert.equal(entry.locked, "");
  assert.match(entry.sub ?? "", /Sell tab/);
  const reply = servicesReply([entry], "Rook");
  assert.equal(reply.mode, "direct");
  // The shop preset is the three shop fields only (black market on, premium 1.5, buys at 30%).
  assert.deepEqual(fenceShopPreset, { blackMarket: true, blackMarketPremium: 1.5, buyRate: 0.3 });
});

test("bank: the link opens a loan request naming the bank; its terms only prefill the DM's form", () => {
  const t = linksFixture();
  const bank = provider(t, "ottilie-bank");
  assert.deepEqual(bank.link, { loan: { rateBps: 500, periodDays: 30, compound: false, maxCopper: 50000 } });
  const [bankEntry, hireEntry] = npcServices(projectRecord(t, svcKael), "ottilie", "kael");
  assert.equal(bankEntry.href, "/features/bank?bank=ottilie-bank#apply-loan");
  assert.match(bankEntry.sub ?? "", /5% simple per 30 days, up to 500 gp/);
  assert.equal(hireEntry.label, "Hire");
  assert.equal(servicesReply([bankEntry, hireEntry], "Ottilie Grane").tag, "Services · Bank, Hire");
  const note = `${bankLoanNote(bank, "Ottilie Grane")}Repairs to the wagon.`;
  assert.equal(note, "Loan from Harrowgate Counting House (Ottilie Grane). Repairs to the wagon.");
  assert.equal(bankForLoanNote(t, note)?.id, "ottilie-bank");
  assert.equal(bankForLoanNote(t, "Loan from somewhere else."), undefined);
  // The bank link adds no command: the loan request is the existing `loan` request, unchanged.
  assert.equal(bankEntry.providerId, undefined);
});

test("hire: locked without a party property; proposes a normal staff contract that moves nothing", () => {
  const none = linksFixture({ property: false });
  assert.equal(providerLock(none, provider(none, "ottilie-hire"), "kael"), "The party owns no property to staff.");
  assert.equal(npcServices(none, "ottilie", "kael")[1].locked, "The party owns no property to staff.");
  const t = linksFixture();
  assert.equal(providerLock(t, provider(t, "ottilie-hire"), "kael"), "");
  const [, entry] = npcServices(t, "ottilie", "kael");
  assert.equal(entry.providerId, "ottilie-hire", "hire opens its roles in the conversation");
  assert.equal(entry.link, true);
  const before = coins(t);
  const proposed = applyCommand(t, svcKael, hireProposal(t, "hire-1"));
  const staff = readEstate(proposed.journal?.propertyOperations).staff.find((s) => s.id === "hire-1")!;
  assert.equal(staff.status, "proposed");
  assert.equal(staff.wageCopper, 200);
  assert.equal(staff.npcId, "brannoc");
  assert.deepEqual(coins(proposed), before, "proposing a hire moves no money");
  // A player can't approve their own proposal; the DM approves as today.
  assert.throws(() => applyCommand(proposed, svcKael, { id: "self-approve", kind: "estate-staff", before: staff, staff: { ...staff, status: "active" } }), /DM review/);
  // Someone without access to the property is refused on the server.
  const owner = structuredClone(t);
  owner.journal!.propertyOperations = { ...owner.journal!.propertyOperations!, sites: [{ ...owner.journal!.propertyOperations!.sites[0], access: "owner" }] };
  assert.throws(() => applyCommand(owner, svcThorn, hireProposal(owner, "hire-2")), /permission/);
  // Removing an NPC a role names is refused while the role names them.
  assert.throws(() => validateServices({ ...t, journal: { ...t.journal!, world: { ...t.journal!.world!, npcs: t.journal!.world!.npcs.filter((n) => n.id !== "brannoc") } } }), /existing NPC/);
});

test("privacy: link settings stay DM-only to edit; a role's hidden NPC isn't named to players", () => {
  let t = linksFixture();
  const brannoc = t.journal!.world!.npcs.find((n) => n.id === "brannoc")!;
  t = applyCommand(t, svcDm, { id: "hide", kind: "npc-save", before: brannoc, npc: { ...brannoc, visible: false } });
  const view = projectRecord(t, svcKael);
  const hire = readServices(view.journal?.services).providers.find((p) => p.id === "ottilie-hire")!;
  assert.equal(hire.link!.roles![0].npcId, undefined);
  assert.ok(!JSON.stringify(view.journal?.services).includes("brannoc"));
  assert.ok(!view.journal!.events.some((e) => e.id === "ottilie-bank-setup-service-event"), "setup events are DM-only");
  validateServices(view, true);
  // The DM still sees the role's NPC.
  assert.equal(provider(projectRecord(t, svcDm), "ottilie-hire").link!.roles![0].npcId, "brannoc");
});

test("protocol 8 and older clients: wave-2 kinds are stripped, and their writes keep them", () => {
  let t = linksFixture();
  t = blackMarket(t, true);
  // Aldous also gets a wave-2 kind, so his list mixes old and new.
  const aldous = t.journal!.world!.npcs.find((n) => n.id === "aldous")!;
  t = applyCommand(t, svcDm, { id: "aldous-hire", kind: "npc-save", before: aldous, npc: { ...aldous, services: ["temple", "hire"] } });
  assert.ok(hasWave2Services(t));
  const eight = tableForProtocol(t, 8);
  const s8 = readServices(eight.journal?.services);
  assert.deepEqual(s8.providers.map((p) => p.kind), ["temple"]);
  assert.deepEqual(eight.journal!.world!.npcs.find((n) => n.id === "aldous")!.services, ["temple"]);
  assert.deepEqual(eight.journal!.world!.npcs.find((n) => n.id === "ottilie")!.services, []);
  for (const p of s8.providers) serviceProviderSchema.parse(p);
  assert.equal(tableForProtocol(t, 9), t, "protocol 9 receives the table as it is");
  const wave1Only = servicesFixture();
  assert.ok(!hasWave2Services(wave1Only));
  assert.deepEqual(tableForProtocol(wave1Only, 8).journal!.services, wave1Only.journal!.services, "wave-1 data is unchanged");
  // Protocol 7 also loses the lists entirely.
  assert.equal(tableForProtocol(t, 7).journal!.world!.npcs.find((n) => n.id === "aldous")!.services, undefined);
  // Archived reports are stripped too.
  const archived = structuredClone(t);
  archived.journal!.reports = [{ id: "r1", snapshot: JSON.stringify({ journal: { services: t.journal!.services, world: t.journal!.world } }) } as never];
  const report = JSON.parse(tableForProtocol(archived, 8).journal!.reports![0].snapshot);
  assert.deepEqual(report.journal.services.providers.map((p: { kind: string }) => p.kind), ["temple"]);
  // Pending drafts with wave-2 service data ask an older app to finish on the website.
  const bank = provider(t, "ottilie-bank");
  assert.throws(
    () => tabletopResponse({ table: t, draft: JSON.stringify([{ kind: "service-provider", provider: bank }]) }, 8),
    /updated Lootsplitter client/,
  );
  assert.doesNotThrow(() => tabletopResponse({ table: t, draft: JSON.stringify([{ kind: "service-order", request: { units: 1 } }]) }, 8));
  // An NPC save from a protocol 8 client (list without wave-2 kinds) keeps the stored kinds.
  const seen = eight.journal!.world!.npcs.find((n) => n.id === "aldous")!;
  const saved = applyCommand(t, svcDm, { id: "p8-save", kind: "npc-save", before: seen, npc: { ...seen, description: "Edited on an older app" } });
  const after = saved.journal!.world!.npcs.find((n) => n.id === "aldous")!;
  assert.deepEqual(after.services, ["temple", "hire"]);
  assert.equal(after.description, "Edited on an older app");
  // ... and turning off a wave-1 kind still works from that client.
  const off = applyCommand(t, svcDm, { id: "p8-off", kind: "npc-save", before: seen, npc: { ...seen, services: [] } });
  assert.deepEqual(off.journal!.world!.npcs.find((n) => n.id === "aldous")!.services, ["hire"]);
  // A whole-journal write from a protocol 8 client keeps services and the wave-2 kinds.
  const kept = preserveJournalMetadata(structuredClone(eight.journal), t.journal!);
  assert.deepEqual(kept.services, t.journal!.services);
  assert.deepEqual(kept.world!.npcs.find((n) => n.id === "aldous")!.services, ["temple", "hire"]);
  assert.deepEqual(kept.world!.npcs.find((n) => n.id === "ottilie")!.services, ["bank", "hire"]);
  // A pending downtime quote's services state is stripped as well.
  const pending = structuredClone(t) as CloudTable & { journal: { finance: { downtime: unknown[] } } };
  pending.journal.finance.downtime.push({ id: "d", status: "pending", quote: { services: { before: "", state: t.journal!.services, notices: [] } } });
  const quoted = tableForProtocol(pending, 8).journal!.finance as unknown as { downtime: { quote: { services: { state: { providers: { kind: string }[] } } } }[] };
  assert.deepEqual(quoted.downtime.at(-1)!.quote.services.state.providers.map((p) => p.kind), ["temple"]);
});

test("presets: Tailor garments by the SRD crafting rule; bank and hire defaults; applying fills only what's missing", () => {
  const tailor = presetOffers("workshop", "srd-5.2.1", "Tailor");
  assert.deepEqual(
    tailor.map((o) => [o.key, o.priceCopper + o.components![0].supplyCopper, o.time.kind === "downtime-days" && o.time.days, o.output.kind === "holding" && o.output.unitCopper]),
    [
      ["common-clothes", 50, 1, 50],
      ["travelers-clothes", 200, 1, 200],
      ["costume", 500, 1, 500],
      ["fine-clothes", 1500, 2, 1500],
    ],
  );
  // SRD 5.1 crafting: 5 gp of work a day.
  assert.deepEqual(presetOffers("workshop", "srd-5.1", "Tailor").find((o) => o.key === "fine-clothes")!.time, { kind: "downtime-days", days: 3, perUnit: true });
  assert.deepEqual(presetOffers("workshop", "blank", "Tailor"), []);
  assert.deepEqual(presetLink("hire", "srd-5.2.1")!.roles!.map((r) => [r.name, r.wageCopper, r.periodDays]), [
    ["Guard", 200, 1],
    ["Porter", 20, 1],
  ]);
  assert.deepEqual(presetLink("hire", "srd-5.1"), presetLink("hire", "srd-5.2.1"));
  assert.deepEqual(presetLink("hire", "blank"), { roles: [] });
  const edited = { ...newProvider("hire", { id: "s", name: "S" }, "n", "h", "blank"), link: { roles: [{ key: "guard", name: "Night guard", wageCopper: 300, periodDays: 1 }] } };
  const filled = applyPreset(edited, "srd-5.2.1");
  assert.deepEqual(filled.link!.roles!.map((r) => [r.key, r.name, r.wageCopper]), [
    ["guard", "Night guard", 300],
    ["porter", "Porter", 20],
  ]);
  const bank = applyPreset({ ...newProvider("bank", { id: "s", name: "S" }, "n", "b"), link: { loan: { rateBps: 900, periodDays: 7, compound: true, maxCopper: 1 } } }, "srd-5.2.1");
  assert.deepEqual(bank.link!.loan, { rateBps: 900, periodDays: 7, compound: true, maxCopper: 1 });
  // A tailor order quotes like any workshop order: bring cloth or the tailor supplies it.
  let t = servicesFixture();
  t.shops.push({ ...t.shops[0], id: "needle", name: "The Golden Needle" });
  t = applyCommand(t, svcDm, {
    id: "tailor-setup",
    kind: "service-provider",
    providerId: "needle-tailor",
    before: null,
    provider: newProvider("workshop", { id: "needle", name: "The Golden Needle" }, "aldous", "needle-tailor", "srd-5.2.1", "Tailor"),
  });
  const aldous = t.journal!.world!.npcs[0];
  t = applyCommand(t, svcDm, { id: "aldous-workshop", kind: "npc-save", before: aldous, npc: { ...aldous, services: ["temple", "workshop"] } });
  const q = serviceQuote(t, "needle-tailor", "fine-clothes", "kael", { beneficiaryPurseIds: [], units: 1, contributions: [] });
  assert.equal(q.terms.priceCopper, 1500);
  assert.equal(q.terms.workDays, 2);
});

test("Here sheet: links are listed with their own verbs; the fence only while the black market is on", async () => {
  const { hereSheet } = await import("./place-hub.ts");
  const rows = (t: CloudTable) => {
    const sheet = hereSheet(projectRecord(t, svcKael), { role: "player", purseIds: ["kael"] });
    return sheet.mode === "here" ? sheet.rows.filter((r) => r.key?.startsWith("service:")) : [];
  };
  const t = linksFixture();
  assert.deepEqual(
    rows(t).map((r) => [r.label, r.action]),
    [
      ["Bank · Harrowgate Counting House", "Borrow"],
      ["Hire · Harrowgate Counting House", "Hire"],
      ["Temple · Temple of the Dawn", "Services"],
    ],
  );
  const on = rows(blackMarket(t, true));
  assert.deepEqual(on.find((r) => r.label.startsWith("Fence"))?.detail, "Rook · buys at 30%");
});

test("offline: a link provider and a hire proposal run through the device's command path once", async () => {
  setSeat(DM_SEAT);
  const t = linksFixture();
  await applyCloudTable(structuredClone(t));
  const hire = hireProposal(t, "off-hire");
  await executeLocalCommand(hire);
  await executeLocalCommand(hire);
  const device = await economySnapshot();
  const shared = applyCommand(t, svcDm, hire);
  const staff = (x: CloudTable) => readEstate(x.journal?.propertyOperations).staff.map((s) => [s.id, s.status, s.wageCopper]);
  assert.deepEqual(staff(device), staff(shared));
  assert.equal(staff(device).length, 1);
  const bank = provider(t, "ottilie-bank");
  const edited = { ...bank, link: { loan: { ...bank.link!.loan!, rateBps: 700 } } };
  const edit = { id: "off-bank", kind: "service-provider" as const, providerId: bank.id, before: bank, provider: edited };
  await executeLocalCommand(edit);
  await executeLocalCommand(edit);
  assert.equal(provider(await economySnapshot(), "ottilie-bank").link!.loan!.rateBps, 700);
  // The device refuses to delete an NPC a hire role names.
  await assert.rejects(removePurse("brannoc"), /hire roles/);
});
