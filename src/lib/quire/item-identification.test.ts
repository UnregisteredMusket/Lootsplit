// Item identification (loot plan phase 5, item-identity.ts): an item awarded or marked
// unidentified is told to everyone but the DM as its presented record. The true name, notes and
// value never reach a player's room view, device projection, archived session, history page,
// ledger line, event, character sheet or TV display until the DM reveals it, and the reveal is
// logged once. Every check searches the serialized JSON for the true details as text.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace, manageRoom } from "./cloud.server.ts";
import { applyCommand } from "./commands.ts";
import { emptyCloudTable, applyBillToTable, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { toCopper } from "./money.ts";
import { projectArchivedReport, projectRecord } from "./session-records.ts";
import { readArchiveResult } from "./archive-reader.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { planSaleSplit } from "./sale-split.ts";
import { characterSheet, editCharacter } from "../characters/campaign-sheet.mjs";
import { encounterPoolRows } from "./loot-claims.ts";
import { encounterItemLine } from "./award-tag.ts";
import { projectPlayerDisplay, defaultDisplaySettings, type DisplayEncounter } from "./player-display.ts";
import { blankEncounter, encounterSchema } from "../encounters/model.mjs";
import { readWorld } from "./world-schema.ts";
import { isUnidentified, presentedHolding, projectIdentities, redactIdentity, identitySecrets } from "./item-identity.ts";
import type { CloudSeat } from "./cloud.ts";
import { readServices } from "./services-schema.ts";
import { ledgerCsv, ledgerExportRows } from "./ledger-export.ts";
import { canonicalJson } from "./canonical-json.ts";
import { CURRENT_TABLETOP_PROTOCOL, ITEM_IDENTITY_PROTOCOL, tabletopResponse } from "./tabletop-protocol.ts";
import { identifyCommand, sageFixture, stableFixture, stablingCommand, svcDm, svcKael, svcThorn } from "./test-fixtures/services.ts";
import { readEstate, recipeSchema } from "./estate-schema.ts";
import { estatePreset } from "./estate-catalogue.ts";
import { readFinance } from "./finance.ts";
import { blankShop } from "./economy.ts";
import { fairnessStandings } from "./loot-fairness.ts";
import { shopSellBreakdown } from "./price-breakdown.ts";
import { seatView } from "./player-view.ts";
import { buildSessionRecap, recapText } from "./session-recap.ts";
import { formatCopper } from "./money.ts";
import type { Holding, Purse, Shop } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0019_campaign_room_reports.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql", "0029_campaign_room_report_parts.sql", "0030_campaign_room_archive_keys.sql", "0003_accounts.sql", "0008_encounters.sql"])
  sql.exec(readFileSync(new URL(`../../../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
(globalThis as any).__env__ = {
  DB: {
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      let values: any[] = [];
      return {
        bind(...args: any[]) {
          values = args;
          return this;
        },
        async all() {
          if (query.includes("FROM play_characters")) return { results: [] };
          return { results: sql.prepare(query).all(...values) };
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
        },
      };
    },
  },
};

// The true details: distinctive text and values, so a search of the JSON finds only real leaks.
const RING = { name: "Ring of Djinni Summoning", notes: "Summons a djinni of the air once a day (DMG).", copper: 987653 };
const WAND = { name: "Wand of Wonder Prime", notes: "Chaos bolts: roll on the wonder table qzx.", copper: 876541 };
const SECRETS = [RING.name, RING.notes, String(RING.copper), WAND.name, WAND.notes, String(WAND.copper), "Djinni", "Wonder"];
const leaks = (value: unknown) => {
  const text = JSON.stringify(value);
  return SECRETS.filter((s) => text.includes(s));
};

const coins = (c: Partial<Purse["coins"]>) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
const shop: Shop = {
  id: "marlow", name: "Marlow's Curios", keeper: "", place: "Port Ashby", notes: "", sellRate: 1, buyRate: 0.5,
  wealth: "modest", category: "curios", priceScale: 1, acceptedCategories: ["curios", "jewels", "smith", "general"],
};
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ gp: 10 }) },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 25 }) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 12 }) },
    ],
    holdings: [
      // Player A holds an unidentified ring with a presented value.
      {
        id: "ring", purseId: "aria", name: RING.name, kind: "item", quantity: 1, unitCopper: RING.copper, notes: RING.notes,
        category: "jewels", image: "/art/ring-of-djinni.webp",
        unidentified: { name: "Plain brass ring", description: "A dull ring, warm to the touch.", value: 2500 },
      },
      // The party fund holds an unidentified wand with no presented value.
      {
        id: "wand", purseId: "hoard", name: WAND.name, kind: "item", quantity: 1, unitCopper: WAND.copper, notes: WAND.notes,
        category: "curios", unidentified: { name: "Carved stick" },
      },
      { id: "rope", purseId: "aria", name: "Hempen rope", kind: "item", quantity: 1, unitCopper: 100, notes: "", category: "curios" },
    ],
    shops: [shop],
    journal: readJournal({}),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "a", name: "Aria's player", role: "player", purseIds: ["aria"] };
const bramSeat: CloudSeat = { id: "b", token: "b", name: "Bram's player", role: "player", purseIds: ["bram", "hoard"] };

async function room() {
  const dm = await openRoom({ name: "Identify DM", table: campaign() });
  const aria = { ...(await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" })), code: dm.code };
  const bram = { ...(await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" })), code: dm.code };
  await choosePace({ ...dm, live: true });
  // Bram may use the party fund ("Allow party fund"), so he sees the fund's items.
  await manageRoom({ ...dm, action: "permission", seatId: bram.seatId, allowParty: true });
  return { dm, aria, bram };
}
const player = (r: { code: string; token: string }, batchId: string, commands: unknown[]) =>
  submitCommands({ code: r.code, token: r.token, batchId, commands });

test("the presented record replaces the true name, notes, value and picture; old holdings are unchanged", () => {
  const t = campaign();
  const ring = presentedHolding(t.holdings[0]!);
  assert.deepEqual(
    [ring.name, ring.notes, ring.unitCopper, ring.image, ring.unidentified],
    ["Plain brass ring", "A dull ring, warm to the touch.", 2500, undefined, { name: "Plain brass ring", description: "A dull ring, warm to the touch.", value: 2500 }],
  );
  assert.deepEqual(presentedHolding(ring), ring, "presenting twice changes nothing");
  const wand = presentedHolding(t.holdings[1]!);
  assert.deepEqual([wand.name, wand.notes, wand.unitCopper], ["Carved stick", "", 0]);
  // Old data: an identified holding (no field) is returned as it is, and a table without
  // unidentified items projects to the very same object.
  const rope = t.holdings[2]!;
  assert.equal(presentedHolding(rope), rope);
  const old = { ...campaign(), holdings: [rope] };
  const projected = projectRecord(old, ariaSeat);
  assert.equal(projectIdentities(old, projected), projected);
  assert.ok(!isUnidentified(rope));
});

test("no player's room view, history or device projection contains the true details; the DM's does", async () => {
  const { dm, aria, bram } = await room();
  const dmView = await roomState(dm);
  assert.deepEqual(leaks(dmView.table.holdings).sort(), [...SECRETS].sort(), "the DM sees the true items");
  for (const seat of [aria, bram]) {
    const view = await roomState(seat);
    assert.deepEqual(leaks(view), [], "room view");
  }
  // Aria sees her ring as presented, with the presented record for the "Unidentified" badge.
  const mine = (await roomState(aria)).table.holdings.find((h) => h.id === "ring")!;
  assert.deepEqual([mine.name, mine.unitCopper, mine.unidentified?.name], ["Plain brass ring", 2500, "Plain brass ring"]);
  // Bram sees the fund's wand with an unknown value.
  const wand = (await roomState(bram)).table.holdings.find((h) => h.id === "wand")!;
  assert.deepEqual([wand.name, wand.unitCopper, wand.unidentified?.value], ["Carved stick", 0, undefined]);
  // Device projection (a player-only link reads `projectRecord`) and the archive reader.
  const host = campaign();
  for (const seat of [ariaSeat, bramSeat]) {
    assert.deepEqual(leaks(projectRecord(host, seat, { directory: true })), []);
    const read = readArchiveResult({ snapshot: JSON.stringify(host) }, seat);
    assert.ok(read.available);
    assert.deepEqual(leaks(read), []);
  }
  // Character sheets list what the character knows, for everyone.
  const sheet = characterSheet(host.purses[1]!, host.holdings);
  assert.deepEqual(leaks(sheet), []);
  assert.equal(sheet.equipment.find((e: { id: string }) => e.id === "ring")!.name, "Plain brass ring");
});

test("ledger lines, events, notes and archived sessions written while unidentified stay safe after the item is gone", async () => {
  const { dm, aria, bram } = await room();
  await submitCommands({ ...dm, batchId: "start-1", commands: [{ id: "s1", kind: "session", name: "Session one", end: false }] });
  // Aria sells her ring at its presented value: 2,500 cp × 50% = 1,250 cp, never the true value.
  await player(aria, "sell-ring", [{ id: "sell-ring", kind: "sell", holdingId: "ring", shopId: "marlow", quantity: 1 }]);
  const after = (await roomState(dm)).table;
  const line = after.ledger.find((l) => l.id === "sell-ring")!;
  assert.deepEqual([line.summary, line.copper], ["Sold 1 Plain brass ring to Marlow's Curios", 1250]);
  assert.equal(toCopper(after.purses.find((p) => p.id === "aria")!.coins), 2500 + 1250);
  // The DM gives the wand from the fund to Bram, then ends the session (it is archived).
  await submitCommands({ ...dm, batchId: "give", commands: [{ id: "give-wand", kind: "give", fromId: "hoard", toId: "bram", copper: 0, holdingId: "wand", quantity: 1 }] });
  await submitCommands({ ...dm, batchId: "start", commands: [{ id: "s2", kind: "session", name: "Session two", end: false }] });
  const archived = (await roomState(dm)).table;
  const report = archived.journal!.reports!.at(-1)!;
  for (const seat of [ariaSeat, bramSeat]) {
    assert.deepEqual(leaks(projectArchivedReport(report, archived, seat)), [], "archived snapshot");
    const view = await roomState(seat === ariaSeat ? aria : bram);
    assert.deepEqual(leaks(view), [], "room view after the sale, gift and archive");
  }
  // The ledger CSV export (players: their projected history, archived sessions included).
  for (const seat of [ariaSeat, bramSeat]) assert.deepEqual(leaks(ledgerCsv(ledgerExportRows(archived, seat))), [], "CSV export");
  // The ring left the table: its sale line still names it as presented, for the DM too.
  assert.deepEqual(leaks(archived.ledger), []);
  assert.deepEqual(leaks(archived.journal!.events), []);
  assert.deepEqual(leaks(archived.notes), []);
});

test("sales use the presented value; an unknown value cannot be sold by anyone", async () => {
  const t = campaign();
  // Sell and split from the fund: refused for the DM too, nothing sold.
  assert.throws(
    () => planSaleSplit(t, { fundId: "hoard", shopId: "marlow", lots: [{ holdingId: "wand", quantity: 1 }], recipientIds: ["aria", "bram"], rule: "party-fund" }, { actor: "dm" }),
    /value is unknown/,
  );
  assert.throws(() => applyCommand(t, dmSeat, { id: "x", kind: "sell", holdingId: "wand", shopId: "marlow", quantity: 1 }), /value is unknown/);
  // With a presented value the DM's sale pays that value, never the true one.
  const valued = applyCommand(t, dmSeat, { id: "v", kind: "item-unidentify", holdingId: "wand", before: { name: "Carved stick" }, unidentified: { name: "Carved stick", value: 300 } });
  const plan = planSaleSplit(valued, { fundId: "hoard", shopId: "marlow", lots: [{ holdingId: "wand", quantity: 1 }], recipientIds: ["aria", "bram"], rule: "party-fund" }, { actor: "dm" });
  assert.deepEqual([plan.lots[0]!.name, plan.lots[0]!.unitCopper, plan.proceeds], ["Carved stick", 300, 150]);
  const sold = applyCommand(valued, dmSeat, {
    id: "ss", kind: "sale-split", fundId: "hoard", shopId: "marlow", lots: [{ holdingId: "wand", quantity: 1 }],
    recipientIds: ["aria", "bram"], remainder: { rule: "party-fund" }, expect: { proceeds: 150, share: 75, remainderTo: null },
  });
  assert.deepEqual(leaks({ ledger: sold.ledger, events: sold.journal!.events.filter((e) => !e.dmOnly), notes: sold.notes }), []);
});

test("item-identify: DM only, logged once, refused when stale or done; then the true item appears", async () => {
  const { dm, aria, bram } = await room();
  // Server refusals: a player can't identify or mark an item; nothing changes.
  await assert.rejects(player(aria, "p-id", [{ id: "p-id", kind: "item-identify", holdingId: "ring", before: { name: "Plain brass ring", description: "A dull ring, warm to the touch.", value: 2500 } }]), /Only the DM/);
  await assert.rejects(player(aria, "p-un", [{ id: "p-un", kind: "item-unidentify", holdingId: "rope", before: null, unidentified: { name: "Rope?" } }]), /Only the DM/);
  // A stale presented record is refused.
  await assert.rejects(submitCommands({ ...dm, batchId: "stale", commands: [{ id: "stale", kind: "item-identify", holdingId: "wand", before: { name: "Old stick" } }] }), /changed/);
  const reveal = { id: "reveal-wand", kind: "item-identify", holdingId: "wand", before: { name: "Carved stick" } };
  await submitCommands({ ...dm, batchId: "reveal", commands: [reveal] });
  // Replay: the same command ID again changes nothing (one event).
  await submitCommands({ ...dm, batchId: "reveal-again", commands: [reveal] });
  const t = (await roomState(dm)).table;
  const events = t.journal!.events.filter((e) => e.id.startsWith("reveal-wand"));
  assert.deepEqual(events.map((e) => e.summary), ["Identified: Carved stick is Wand of Wonder Prime"]);
  assert.equal(t.holdings.find((h) => h.id === "wand")!.unidentified, undefined);
  // Already identified: refused.
  await assert.rejects(submitCommands({ ...dm, batchId: "twice", commands: [{ ...reveal, id: "reveal-2" }] }), /already identified/);
  // Bram (fund access) now sees the wand and the logged reveal; the ring stays hidden from Aria.
  const bramView = await roomState(bram);
  const wand = bramView.table.holdings.find((h) => h.id === "wand")!;
  assert.deepEqual([wand.name, wand.notes, wand.unitCopper], [WAND.name, WAND.notes, WAND.copper]);
  assert.ok(bramView.table.journal!.events.some((e) => e.summary === "Identified: Carved stick is Wand of Wonder Prime"));
  assert.deepEqual(leaks(await roomState(aria)).filter((s) => !s.includes("Wonder") && !s.includes(String(WAND.copper)) && s !== WAND.notes), []);
  assert.equal((await roomState(aria)).table.holdings.find((h) => h.id === "ring")!.name, "Plain brass ring");
});

test("an older client's holding save keeps the item unidentified; marking is DM-only and logged for the DM", () => {
  let t = campaign();
  const ring = t.holdings[0]!;
  const { unidentified: _u, ...dropped } = ring;
  t = applyCommand(t, dmSeat, { id: "old-save", kind: "patch", changes: [{ store: "holdings", id: "ring", before: ring, after: { ...dropped, notes: RING.notes + " Edited." } }] });
  assert.ok(isUnidentified(t.holdings.find((h) => h.id === "ring")));
  t = applyCommand(t, dmSeat, { id: "mark", kind: "item-unidentify", holdingId: "rope", before: null, unidentified: { name: "Coil of something" } });
  const event = t.journal!.events.find((e) => e.id.startsWith("mark"))!;
  assert.equal(event.dmOnly, true);
  assert.ok(!JSON.stringify(projectRecord(t, ariaSeat)).includes("Hempen rope"));
  // A property can't be unidentified.
  const property = { ...campaign(), holdings: [{ id: "house", purseId: "aria", name: "House", kind: "property" as const, quantity: 1, unitCopper: 1, notes: "" }] };
  assert.throws(() => applyCommand(property, dmSeat, { id: "p", kind: "item-unidentify", holdingId: "house", before: null, unidentified: { name: "?" } }), /Only an item/);
});

test("players' sheet saves and turn bills keep the true item; changing what it is is refused", () => {
  const t = campaign();
  const before = characterSheet(t.purses[1]!, t.holdings);
  const sheet = structuredClone(before);
  sheet.equipment.find((e: { id: string }) => e.id === "ring")!.equipped = true;
  const edited = structuredClone(t);
  edited.purses[1]!.permissions = { equipment: true };
  editCharacter(edited, ariaSeat, { purseId: "aria", before, sheet }, "equip");
  const ring = edited.holdings.find((h) => h.id === "ring")!;
  assert.deepEqual([ring.name, ring.notes, ring.unitCopper, ring.equipped, isUnidentified(ring)], [RING.name, RING.notes, RING.copper, true, true]);
  const renamed = structuredClone(sheet);
  renamed.equipment.find((e: { id: string }) => e.id === "ring")!.name = "My ring";
  assert.throws(() => editCharacter(structuredClone(edited), ariaSeat, { purseId: "aria", before: characterSheet(edited.purses[1]!, edited.holdings), sheet: renamed }, "rename"), /unidentified/);
  // A whole-turn bill lists the item as presented; the true item is kept.
  const bill = { purseIds: ["aria"], purses: [t.purses[1]!], holdings: projectRecord(t, ariaSeat).holdings.filter((h) => h.purseId === "aria"), stock: [], ledger: [], loans: [], notes: [] };
  const applied = applyBillToTable(t, bill as never, {} as never);
  assert.equal(applied.table.holdings.find((h) => h.id === "ring")!.name, RING.name);
});

test("a player's trade offer snapshots the item as presented; the server accepts it and the true item moves", () => {
  let t = campaign();
  // Aria offers her ring to Bram, snapshotting it as her projection shows it.
  const seen = projectRecord(t, ariaSeat).holdings.find((h) => h.id === "ring")!;
  t = applyCommand(t, ariaSeat, {
    id: "offer", kind: "trade-offer", tradeId: "trade", revision: null, actorId: "aria", note: "",
    left: { purseId: "aria", copper: 0, items: [{ holdingId: "ring", quantity: 1, before: canonicalJson(seen) }] },
    right: { purseId: "bram", copper: 100, items: [] },
  });
  assert.deepEqual(leaks(projectRecord(t, bramSeat)), [], "Bram reads the offer as presented");
  t = applyCommand(t, bramSeat, { id: "accept", kind: "trade-decision", tradeId: "trade", revision: readWorld(t.journal?.world).trades[0]!.revision, actorId: "bram", decision: "accepted" });
  const moved = t.holdings.find((h) => h.purseId === "bram" && h.unidentified);
  assert.equal(moved?.name, RING.name, "the true item moves, still unidentified");
  assert.deepEqual(leaks(projectRecord(t, bramSeat)), []);
  // Text is never parsed: a stored snapshot string is returned as written (offers only ever
  // store the presented form, which the server enforces).
  const text = { before: canonicalJson(campaign().holdings[0]) };
  assert.equal(redactIdentity(text, identitySecrets(campaign().holdings)), text);
});

test("encounter awards: unidentified items are written as presented, the holding keeps the truth", () => {
  const loot = [
    { id: "l1", name: RING.name, quantity: 1, unitCopper: RING.copper, notes: RING.notes, catalogId: "", sourceTableId: "", purseId: "", pool: true, unidentified: { name: "Plain brass ring", value: 2500 } },
    { id: "l2", name: WAND.name, quantity: 1, unitCopper: WAND.copper, notes: WAND.notes, catalogId: "", sourceTableId: "", purseId: "aria", unidentified: { name: "Carved stick" } },
  ];
  assert.ok(encounterSchema.safeParse({ ...blankEncounter(), loot }).success, "the encounter keeps the presented record");
  const t = campaign();
  const pool = encounterPoolRows(t, loot, { receiptId: "award", encounterId: "e", encounterName: "Crypt", at: 1 })!;
  assert.equal(pool.holdings[0]!.name, RING.name);
  assert.ok(isUnidentified(pool.holdings[0]));
  assert.deepEqual(leaks({ ledger: pool.ledger, events: pool.events, note: pool.note }), []);
  assert.equal(pool.ledger[0]!.loot!.unitCopper, 2500);
  const line = encounterItemLine("award", 1, 1, "aria", loot[1]!, "Crypt");
  assert.deepEqual(leaks(line), []);
  assert.equal(line.award!.unitCopper, undefined, "no presented value: no value recorded");
  // The TV display names awarded items as presented.
  const detail: DisplayEncounter = { id: "e", code: "device", revision: 1, status: "awarded", body: { ...blankEncounter(), loot }, award: { receiptId: "award", at: Date.now() } } as DisplayEncounter;
  const frame = projectPlayerDisplay({ purses: [], journal: { world: readWorld({}) } } as unknown as CloudTable, detail, { ...defaultDisplaySettings, paused: false, encounterId: "e", showLoot: true }, "device");
  assert.deepEqual(frame.loot?.items.map((i) => i.name), ["Plain brass ring", "Carved stick"]);
  assert.deepEqual(leaks(frame), []);
});

test("differential: the device identifies exactly as the shared room does, once", async () => {
  const { dm } = await room();
  const host = (await roomState(dm)).table;
  const reveal = { id: "dev-reveal", kind: "item-identify" as const, holdingId: "ring", before: { name: "Plain brass ring", description: "A dull ring, warm to the touch.", value: 2500 } };
  setSeat(DM_SEAT);
  await applyCloudTable(host);
  await executeLocalCommand(reveal);
  await executeLocalCommand(reveal);
  const device = await economySnapshot();
  await submitCommands({ ...dm, batchId: "shared-reveal", commands: [reveal] });
  const shared = (await roomState(dm)).table;
  const pick = (t: { holdings: Holding[]; journal?: CloudTable["journal"] }) => ({
    ring: t.holdings.find((h) => h.id === "ring"),
    events: (t.journal?.events ?? []).filter((e) => e.id.startsWith("dev-reveal")).map(({ at: _at, ...e }) => e),
  });
  assert.deepEqual(pick(device as never), pick(shared));
  assert.equal(pick(shared).events.length, 1);
});

test("the sage's Identify reveals an unidentified item in the approval, logged once, with the payment", () => {
  let t = sageFixture();
  const ring = t.holdings.find((h) => h.id === "ring")!;
  Object.assign(ring, { name: RING.name, notes: RING.notes, unitCopper: RING.copper, unidentified: { name: "Plain silver ring", description: "Cold to the touch." } });
  // Kael's request is reviewed on his projection; the server accepts the same quote.
  const ask = identifyCommand(projectRecord(t, svcKael), "id-1", "ring");
  t = applyCommand(t, svcKael, ask);
  const order = () => readServices(t.journal?.services).orders.find((o) => o.id === "id-1")!;
  assert.deepEqual(order().terms.item, { holdingId: "ring", name: "Plain silver ring", notesBefore: "Cold to the touch." });
  assert.deepEqual(leaks(projectRecord(t, svcKael)), []);
  assert.deepEqual(leaks(projectRecord(t, svcThorn)), []);
  t = applyCommand(t, svcDm, {
    id: "answer", kind: "service-review", orderId: "id-1", before: order(), decision: "approve", reason: "",
    reveal: { text: "It is a ring that summons a djinni.", appendToNotes: true },
  });
  const revealed = t.holdings.find((h) => h.id === "ring")!;
  assert.ok(!isUnidentified(revealed));
  assert.equal(revealed.name, RING.name);
  assert.match(revealed.notes, /^Summons a djinni of the air once a day \(DMG\)\.\nDay \d+ · identified by Magister Quillon: It is a ring/);
  const logged = t.journal!.events.filter((e) => e.id === "id-1-identified");
  assert.deepEqual(logged.map((e) => e.summary), [`Identified by Magister Quillon: Plain silver ring is ${RING.name}`]);
  assert.equal(t.ledger.filter((l) => l.id === "id-1-payment").length, 1);
  // Kael now sees the true ring; Thorn never sees Kael's items or the reveal.
  assert.ok(JSON.stringify(projectRecord(t, svcKael)).includes(RING.name));
  assert.deepEqual(leaks(projectRecord(t, svcThorn)), []);
});

test("protocol 24: older apps finish identification drafts on the website; every protocol gets the presented item", () => {
  assert.equal(ITEM_IDENTITY_PROTOCOL, 24);
  assert.equal(CURRENT_TABLETOP_PROTOCOL, ITEM_IDENTITY_PROTOCOL);
  const table = projectRecord(campaign(), ariaSeat);
  const draft = JSON.stringify([{ id: "d", kind: "item-identify", holdingId: "wand", before: { name: "Carved stick" } }]);
  assert.throws(() => tabletopResponse({ table, draft }, 19), /updated Lootsplitter client/);
  assert.equal(tabletopResponse({ table, draft }, 24).table, table);
  // Holdings are not a strict schema: an older player's table is the same presented table.
  for (const protocol of [0, 3, 19]) assert.deepEqual(leaks(tabletopResponse({ table, draft: "[]" }, protocol)), []);
});

test("text people type is stored and returned exactly as written; structured records are still presented", async () => {
  const { dm, aria, bram } = await room();
  const guess = "Is Aria's thing a Ring of Djinni Summoning? Ask Bram Swordbreaker.";
  await player(bram, "chat", [{ id: "guess", kind: "message", to: "party", purseId: "bram", text: guess }]);
  await submitCommands({ ...dm, batchId: "note", commands: [{ id: "dm-note", kind: "journal-note", title: "Ring", text: `The ${RING.name} waits.`, visibility: "party", purseId: "", reportIds: [] }] });
  const stored = (await roomState(dm)).table;
  assert.equal(stored.notes.find((n) => n.id === "guess")!.text, guess, "stored unchanged");
  assert.equal(stored.journal!.entries!.find((e) => e.id === "dm-note")!.text, `The ${RING.name} waits.`);
  for (const seat of [aria, bram]) {
    const view = (await roomState(seat)).table;
    assert.equal(view.notes.find((n) => n.id === "guess")!.text, guess, "returned unchanged: no guessing test");
    assert.equal(view.journal!.entries!.find((e) => e.id === "dm-note")!.text, `The ${RING.name} waits.`);
    // The structured records are still presented.
    assert.deepEqual(leaks(view.holdings), []);
  }
});

test("a command redacts only the rows it created: an earlier DM answer and the claims survive", () => {
  let t = sageFixture();
  // An earlier Identify answered with words that happen to name the ring.
  t = applyCommand(t, svcKael, identifyCommand(t, "id-bottle", "bottle"));
  const bottleOrder = () => readServices(t.journal?.services).orders.find((o) => o.id === "id-bottle")!;
  t = applyCommand(t, svcDm, { id: "ans", kind: "service-review", orderId: "id-bottle", before: bottleOrder(), decision: "approve", reason: "", reveal: { text: "Water. Not the Plain silver ring you hoped for.", appendToNotes: false } });
  const before = structuredClone(bottleOrder());
  // The DM marks the ring unidentified, then Kael asks about it: a new order.
  t = applyCommand(t, svcDm, { id: "mark", kind: "item-unidentify", holdingId: "ring", before: null, unidentified: { name: "Dull band" } });
  t = applyCommand(t, svcKael, identifyCommand(projectRecord(t, svcKael), "id-ring", "ring"));
  assert.deepEqual(bottleOrder(), before, "the earlier order and its answer are untouched");
  assert.equal(readServices(t.journal?.services).orders.find((o) => o.id === "id-ring")!.terms.item!.name, "Dull band");
});

test("presented category and weight: shops judge the presented category; the true weight stays", () => {
  const t = campaign();
  const ring = t.holdings[0]!;
  // No presented category: the neutral "general"; the weight is the true weight.
  assert.deepEqual([presentedHolding({ ...ring, weight: 0.5 }).category, presentedHolding({ ...ring, weight: 0.5 }).weight], ["general", 0.5]);
  const jeweller: Shop = { ...shop, id: "jeweller", name: "Jeweller", acceptedCategories: ["jewels"] };
  const general: Shop = { ...shop, id: "store", name: "General store", acceptedCategories: ["general"] };
  const withShops = { ...t, shops: [shop, jeweller, general] };
  // The true category (jewels) would be accepted at the jeweller: the refusal there and the sale
  // at the general store show only the presented category.
  assert.throws(() => applyCommand(withShops, ariaSeat, { id: "j", kind: "sell", holdingId: "ring", shopId: "jeweller", quantity: 1 }), /does not buy that item category/);
  const sold = applyCommand(withShops, ariaSeat, { id: "g", kind: "sell", holdingId: "ring", shopId: "store", quantity: 1 });
  assert.equal(sold.ledger.find((l) => l.id === "g")!.copper, 1250);
  // A presented category and weight are what players see; the true weight is kept on sheet saves.
  const marked = applyCommand(withShops, dmSeat, { id: "m", kind: "item-unidentify", holdingId: "ring", before: ring.unidentified!, unidentified: { ...ring.unidentified!, category: "curios", weight: 2 } });
  marked.holdings[0]!.weight = 0.1;
  const seen = projectRecord(marked, ariaSeat).holdings.find((h) => h.id === "ring")!;
  assert.deepEqual([seen.category, seen.weight], ["curios", 2]);
  const sheetBefore = characterSheet(marked.purses[1]!, marked.holdings);
  const sheet = structuredClone(sheetBefore);
  sheet.equipment.find((e: { id: string }) => e.id === "ring")!.equipped = true;
  marked.purses[1]!.permissions = { equipment: true };
  editCharacter(marked, ariaSeat, { purseId: "aria", before: sheetBefore, sheet }, "equip");
  assert.equal(marked.holdings.find((h) => h.id === "ring")!.weight, 0.1);
});

test("a player's turn bill can't set, drop or change a presented record", () => {
  const t = campaign();
  const shown = projectRecord(t, ariaSeat).holdings.filter((h) => h.purseId === "aria");
  const tampered = shown.map((h) =>
    h.id === "ring"
      ? { ...h, unidentified: { name: "Plain brass ring", value: 999999 } }
      : h.id === "rope"
        ? { ...h, unidentified: { name: "Mystery" } }
        : h,
  );
  const bill = { purseIds: ["aria"], purses: [t.purses[1]!], holdings: tampered, stock: [], ledger: [], loans: [], notes: [] };
  const out = applyBillToTable(t, bill as never, {} as never).table;
  const ring = out.holdings.find((h) => h.id === "ring")!;
  assert.deepEqual([ring.name, ring.unitCopper, ring.unidentified], [RING.name, RING.copper, t.holdings[0]!.unidentified]);
  assert.equal(out.holdings.find((h) => h.id === "rope")!.unidentified, undefined, "a bill can't mark an item");
  // Dropping the record keeps it too.
  const { unidentified: _u, ...plain } = shown.find((h) => h.id === "ring")!;
  const dropped = applyBillToTable(t, { ...bill, holdings: [plain, shown.find((h) => h.id === "rope")!] } as never, {} as never).table;
  assert.deepEqual(dropped.holdings.find((h) => h.id === "ring")!.unidentified, t.holdings[0]!.unidentified);
});

test("award lines name their holding, so an item marked later shows players the presented value", () => {
  let t = campaign();
  t.ledger.push(encounterItemLine("award-r", 0, 1, "aria", { name: "Hempen rope", quantity: 1, unitCopper: 100 }, "Crypt", "rope"));
  assert.equal(t.ledger[0]!.award!.holdingId, "rope");
  t = applyCommand(t, dmSeat, { id: "mark-rope", kind: "item-unidentify", holdingId: "rope", before: null, unidentified: { name: "Coil of cord", value: 5 } });
  assert.equal(t.ledger[0]!.award!.unitCopper, 100, "the DM's record keeps its recorded value");
  assert.equal(projectRecord(t, ariaSeat).ledger.find((l) => l.id === "award-r-item-0")!.award!.unitCopper, 5);
});

test("differential: marking, a presented-category sale and a reveal run identically on the device", async () => {
  const { dm } = await room();
  const host = (await roomState(dm)).table;
  const commands = [
    { id: "d-mark", kind: "item-unidentify" as const, holdingId: "rope", before: null, unidentified: { name: "Coil of cord", value: 40, category: "curios" } },
    { id: "d-sell", kind: "sell" as const, holdingId: "rope", shopId: "marlow", quantity: 1 },
    { id: "d-id", kind: "item-identify" as const, holdingId: "wand", before: { name: "Carved stick" } },
  ];
  setSeat(DM_SEAT);
  await applyCloudTable(host);
  for (const c of commands) {
    await executeLocalCommand(c);
    await executeLocalCommand(c);
  }
  const device = (await economySnapshot()) as unknown as CloudTable;
  await submitCommands({ ...dm, batchId: "d-shared", commands });
  await submitCommands({ ...dm, batchId: "d-shared-again", commands });
  const shared = (await roomState(dm)).table;
  const pick = (t: CloudTable) => ({
    holdings: [...t.holdings].sort((a, b) => a.id.localeCompare(b.id)),
    ledger: t.ledger.filter((l) => l.id.startsWith("d-")).map(({ at: _at, ...l }) => l),
    events: (t.journal?.events ?? []).filter((e) => e.id.startsWith("d-")).map(({ at: _at, ...e }) => e),
    coins: t.purses.map((p) => [p.id, toCopper(p.coins)]).sort(),
  });
  assert.deepEqual(pick(device), pick(shared));
  assert.equal(pick(shared).ledger.find((l) => l.id === "d-sell")!.copper, 20);
});

test("charges: using an unidentified item names it as presented", () => {
  const t = campaign();
  t.holdings[0]!.uses = { current: 3, max: 3, whenEmpty: "keep" };
  const used = applyCommand(t, ariaSeat, { id: "use-ring", kind: "item-use", holdingId: "ring", expect: { current: 3, quantity: 1 } });
  const event = used.journal!.events.find((e) => e.id.startsWith("use-ring"))!;
  assert.match(event.summary, /^Used Plain brass ring \(Aria Thorne\): 2 of 3 uses left$/);
  assert.deepEqual(leaks(projectRecord(used, ariaSeat)), []);
});

test("JSON-shaped chat is text: a right and a wrong guess both come back exactly as written", async () => {
  const { aria, bram } = await room();
  const right = JSON.stringify({ id: "ring", name: RING.name, unitCopper: RING.copper, unidentified: { name: "Plain brass ring" } });
  const wrong = JSON.stringify({ id: "ring", name: "Ring of Fire", unitCopper: 1234 });
  await player(bram, "c1", [{ id: "g-right", kind: "message", to: "party", purseId: "bram", text: right }]);
  await player(bram, "c2", [{ id: "g-wrong", kind: "message", to: "party", purseId: "bram", text: wrong }]);
  for (const seat of [aria, bram]) {
    const notes = (await roomState(seat)).table.notes;
    assert.equal(notes.find((n) => n.id === "g-right")!.text, right);
    assert.equal(notes.find((n) => n.id === "g-wrong")!.text, wrong);
  }
  // A trade offer can't test a guess either: only the presented snapshot is accepted.
  const offer = (before: string) => ({
    id: "o", kind: "trade-offer" as const, tradeId: "t", revision: null, actorId: "aria", note: "",
    left: { purseId: "aria", copper: 0, items: [{ holdingId: "ring", quantity: 1, before }] },
    right: { purseId: "bram", copper: 1, items: [] },
  });
  assert.throws(() => applyCommand(campaign(), ariaSeat, offer(canonicalJson(campaign().holdings[0]))), /changed/);
});

test("an item's records stay presented after it moves to a new holding ID or is sold", () => {
  let t = campaign();
  t.ledger.push(encounterItemLine("award-r", 0, 1, "aria", { name: "Hempen rope", quantity: 2, unitCopper: 100 }, "Crypt", "rope"));
  t.holdings[2]!.quantity = 2;
  t = applyCommand(t, dmSeat, { id: "mark-rope", kind: "item-unidentify", holdingId: "rope", before: null, unidentified: { name: "Coil of cord", value: 5 } });
  const seen = (tt: CloudTable) => projectRecord(tt, ariaSeat).ledger.find((l) => l.id === "award-r-item-0")!.award!.unitCopper;
  assert.equal(seen(t), 5);
  // Aria gives one coil to Bram: the new holding carries the earlier ID.
  t = applyCommand(t, ariaSeat, { id: "gv", kind: "give", fromId: "aria", toId: "bram", copper: 0, holdingId: "rope", quantity: 1 });
  assert.deepEqual(t.holdings.find((h) => h.id === "gv-item")!.unidentified!.ids, ["rope"]);
  // Then she sells hers and Bram gives his away: the line keeps the presented value.
  t = applyCommand(t, ariaSeat, { id: "sl", kind: "sell", holdingId: "rope", shopId: "marlow", quantity: 1 });
  assert.equal(seen(t), 5);
  t = applyCommand(t, bramSeat, { id: "gv2", kind: "give", fromId: "bram", toId: "hoard", copper: 0, holdingId: "gv-item", quantity: 1 });
  assert.deepEqual(t.holdings.find((h) => h.id === "gv2-item")!.unidentified!.ids, ["rope", "gv-item"]);
  assert.equal(seen(t), 5);
  assert.equal(t.ledger.find((l) => l.id === "award-r-item-0")!.award!.unitCopper, 100, "the DM's record keeps its value");
  // Fully sold: a DM-only event keeps the ended item for the session; the line is unchanged.
  t = applyCommand(t, dmSeat, { id: "sl2", kind: "sell", holdingId: "gv2-item", shopId: "marlow", quantity: 1 });
  const ended = t.journal!.events.find((e) => e.identityEnded?.holdingIds.includes("gv2-item"))!;
  assert.equal(ended.dmOnly, true);
  assert.deepEqual(ended.identityEnded!.holdingIds, ["gv2-item", "rope", "gv-item"]);
  assert.equal(t.ledger.find((l) => l.id === "award-r-item-0")!.award!.unitCopper, 100);
  assert.equal(seen(t), 5);
  assert.ok(!JSON.stringify(projectRecord(t, ariaSeat).journal!.events).includes("identityEnded"));
  // Favour totals (stored in a receipt players read) count the presented value.
  const fresh = campaign();
  fresh.ledger.push(encounterItemLine("award-f", 0, 1, "aria", { name: "Hempen rope", quantity: 1, unitCopper: 100 }, "Crypt", "rope"));
  const marked = applyCommand(fresh, dmSeat, { id: "mk", kind: "item-unidentify", holdingId: "rope", before: null, unidentified: { name: "Coil of cord", value: 5 } });
  assert.equal(fairnessStandings(marked, "campaign", { presented: true }).get("aria"), 5);
  // The DM's own totals count the true value.
  assert.equal(fairnessStandings(marked, "campaign").get("aria"), 100);
});

function estateFixture(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "party", name: "Party treasury", kind: "party", coins: coins({ cp: 10000 }) },
      { id: "hero", name: "Alwen", kind: "character", coins: coins({ cp: 1000 }) },
    ],
    holdings: [
      { id: "warehouse", name: "Party warehouse", purseId: "party", kind: "property", unitCopper: 5000, quantity: 1, notes: "", locationId: "city", property: { type: "other", condition: "ready" } },
      { id: "timber", name: "Timber", purseId: "hero", kind: "item", quantity: 10, unitCopper: 100, weight: 2, notes: "" },
    ],
    shops: [{ ...blankShop(), id: "shop", name: "Post office", locationId: "city", keeper: "Clerk", buyRate: 1 }],
    journal: readJournal({
      finance: readFinance(),
      market: {
        currentLocationId: "area",
        locations: [
          { id: "region", name: "Eastmarch", kind: "region", parentId: null, description: "" },
          { id: "city", name: "Brackenport", kind: "city", parentId: "region", description: "" },
          { id: "area", name: "Dock Ward", kind: "area", parentId: "city", description: "" },
        ],
      },
      propertyOperations: readEstate({
        templates: [estatePreset("warehouse"), estatePreset("house"), { ...estatePreset("land"), recipes: [recipeSchema.parse({ key: "build", name: "Build", resultTemplateKey: "house", laborDays: 2, laborCostCopper: 200, materials: [] })] }],
        materials: [],
        sites: [{ propertyId: "warehouse", templateKey: "warehouse", enabled: true, access: "party-members", accessPurseIds: [], capacityWeight: null, completedTemplates: [], notes: "" }],
        postal: { feeCopper: 10, deliveryDays: 2, offices: [{ shopId: "shop", allowTown: false }] },
      }),
    }),
  };
}
const heroSeat: CloudSeat = { id: "hero-seat", name: "Hero", token: "hero", role: "player", purseIds: ["hero"] };

test("a player cancels their own withdrawal of an unidentified stored item; nothing names it", () => {
  let t = estateFixture();
  t = applyCommand(t, dmSeat, { id: "mk", kind: "item-unidentify", holdingId: "timber", before: null, unidentified: { name: "Bundle of sticks", value: 50 } });
  t = applyCommand(t, heroSeat, { id: "dep", kind: "estate-storage", propertyId: "warehouse", holdingId: "timber", quantity: 4, direction: "deposit", purseId: "hero", override: false });
  t.journal!.propertyOperations!.sites[0]!.withdrawalApproval = true;
  const item = t.holdings.find((h) => h.custody?.kind === "property")!;
  assert.ok(isUnidentified(item));
  t = applyCommand(t, heroSeat, { id: "wd", kind: "estate-storage", propertyId: "warehouse", holdingId: item.id, quantity: 2, direction: "withdraw", purseId: "hero", override: false });
  const seen = projectRecord(t, heroSeat).journal!.propertyOperations!.withdrawals.find((r: { id: string }) => r.id === "wd")!;
  assert.ok(!JSON.stringify(seen).includes("Timber"));
  const cancelled = applyCommand(t, heroSeat, { id: "cx", kind: "estate-withdrawal-review", requestId: "wd", before: canonicalJson(seen), status: "cancelled", reason: "never mind" });
  assert.equal(cancelled.journal!.propertyOperations!.withdrawals.find((r) => r.id === "wd")!.status, "cancelled");
  const view = projectRecord(cancelled, heroSeat);
  assert.ok(!JSON.stringify({ events: view.journal!.events, holdings: view.holdings }).includes("Timber"));
});

test("service refusals name an unidentified animal as presented", () => {
  const t = stableFixture();
  t.holdings.find((h) => h.id === "pony")!.unidentified = { name: "Covered shape" };
  const refusal = () => {
    try {
      stablingCommand(t, "s", ["pony"]);
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  };
  assert.equal(refusal(), "Choose animals: horses, ponies, mules and the like.");
  t.holdings.find((h) => h.id === "pony")!.unidentified = { name: "Small grey steed" };
  assert.match(refusal(), /^Small grey steed isn't Kael's/);
});

test("a turn bill can't take another character's item by naming its ID", () => {
  const t = campaign();
  const wand = projectRecord(t, bramSeat).holdings.find((h) => h.id === "wand")!;
  const bill = { purseIds: ["aria"], purses: [t.purses[1]!], holdings: [...t.holdings.filter((h) => h.purseId === "aria").map(presentedHolding), { ...wand, purseId: "aria" }], stock: [], ledger: [], loans: [], notes: [] };
  assert.throws(() => applyBillToTable(t, bill as never, {} as never), /another character holds/);
});

test("earlier IDs are never told, and only the holding a command took from is linked", () => {
  for (const same of [true, false]) {
    const t = campaign();
    // A look-alike: the same presented ring, truly the same item or not.
    t.holdings.push({ id: "ring2", purseId: "aria", name: same ? RING.name : "Brass ring", kind: "item", quantity: 1, unitCopper: same ? RING.copper : 10, notes: same ? RING.notes : "", category: "jewels", unidentified: { name: "Plain brass ring", description: "A dull ring, warm to the touch.", value: 2500 } } as Holding);
    // A matching item in a purse Bram can't see.
    t.purses.push({ id: "vizier", name: "The Vizier", kind: "character", control: "npc", coins: coins({}) });
    t.holdings.push({ ...t.holdings[0]!, id: "vizier-hoard-ring", purseId: "vizier" });
    const g = applyCommand(t, ariaSeat, { id: "gv", kind: "give", fromId: "aria", toId: "bram", copper: 0, holdingId: "ring", quantity: 1 });
    assert.deepEqual(g.holdings.find((h) => h.id === "gv-item")!.unidentified!.ids, ["ring"], "only the holding the give reduced");
    const seen = projectRecord(g, bramSeat);
    assert.equal(seen.holdings.find((h) => h.id === "gv-item")!.unidentified!.ids, undefined);
    assert.ok(!JSON.stringify(seen).includes("vizier-hoard-ring") && !JSON.stringify(seen).includes('"ids"'));
  }
});

test("price breakdown and merchant purse: an unidentified sale shows and pays only presented factors", () => {
  const t = campaign();
  // A jeweller that buys other categories at 50% and has a purse: the true category (jewels) would
  // be on its list; the presented one (general) is not.
  t.shops = [{ ...shop, id: "jeweller", name: "Jeweller", category: "jewels", acceptedCategories: ["jewels"], offListPercent: 50, merchantPurse: 100000 }];
  const ring = t.holdings[0]!;
  const breakdown = shopSellBreakdown(t.shops[0]!, ring.unitCopper, 1, ring);
  assert.deepEqual(leaks(breakdown), []);
  assert.equal(breakdown.base.copper, 2500);
  assert.ok(breakdown.factors.some((f) => f.key === "off-list"), "judged by the presented category");
  assert.equal(breakdown.unit, 625);
  const sold = applyCommand(t, ariaSeat, { id: "sj", kind: "sell", holdingId: "ring", shopId: "jeweller", quantity: 1 });
  assert.equal(sold.ledger.find((l) => l.id === "sj")!.copper, 625);
  assert.equal(sold.shops[0]!.merchantPurse, 100000 - 625);
  // The player's projected shop (affordability per lot) is worked out from presented values too.
  assert.deepEqual(leaks(projectRecord(t, ariaSeat).shops), []);
});

test("attunement: events and messages name an unidentified item as presented; the presented requirement applies", () => {
  let t = campaign();
  t.holdings[0]!.requiresAttunement = "Requires attunement by a djinni-binder";
  // No presented requirement: players aren't told it needs attunement, and can't attune it.
  assert.equal(projectRecord(t, ariaSeat).holdings.find((h) => h.id === "ring")!.requiresAttunement, undefined);
  assert.throws(() => applyCommand(t, ariaSeat, { id: "at0", kind: "item-attune", holdingId: "ring", attuned: true, expect: { purseId: "aria", attuned: false } }), /doesn't require attunement/);
  t = applyCommand(t, dmSeat, { id: "mk", kind: "item-unidentify", holdingId: "ring", before: t.holdings[0]!.unidentified!, unidentified: { ...t.holdings[0]!.unidentified!, requiresAttunement: "Requires attunement" } });
  t = applyCommand(t, ariaSeat, { id: "at1", kind: "item-attune", holdingId: "ring", attuned: true, expect: { purseId: "aria", attuned: false } });
  assert.equal(t.holdings[0]!.attuned, true);
  // Giving it away ends the attunement (settleAttunement), named as presented.
  t = applyCommand(t, ariaSeat, { id: "gv", kind: "give", fromId: "aria", toId: "bram", copper: 0, holdingId: "ring", quantity: 1 });
  const events = t.journal!.events.filter((e) => /ttune/.test(e.summary));
  assert.ok(events.length >= 2);
  assert.deepEqual(leaks(events), []);
  for (const seat of [ariaSeat, bramSeat]) assert.deepEqual(leaks(projectRecord(t, seat)), []);
  assert.equal(projectRecord(t, bramSeat).holdings.find((h) => h.id === "gv-item")!.requiresAttunement, "Requires attunement");
});

test("preview as player (seatView) shows the presented items, exactly as the server sends", async () => {
  const { dm, aria } = await room();
  const host = (await roomState(dm)).table;
  const preview = seatView(host, { purseIds: ["aria"] });
  assert.deepEqual(leaks(preview), []);
  assert.equal(preview.holdings.find((h) => h.id === "ring")!.name, "Plain brass ring");
  const sent = (await roomState(aria)).table;
  assert.deepEqual(preview.holdings.find((h) => h.id === "ring"), sent.holdings.find((h) => h.id === "ring"));
});

test("session recap: the player's recap and the DM's shareable draft name items as presented", () => {
  let t = applyCommand(campaign(), dmSeat, { id: "s1", kind: "session", name: "The Vault", end: false });
  const session = readJournal(t.journal).sessions[0]!;
  const at = session.startedAt + 1;
  // Aria sells her ring; a pool resolution recorded with the true name before the DM marked it.
  t = applyCommand(t, ariaSeat, { id: "sell-r", kind: "sell", holdingId: "ring", shopId: "marlow", quantity: 1 });
  const j = readJournal(t.journal);
  j.events.push({
    id: "pool-1", at, kind: "management", summary: "Treasure pool resolved",
    lootResolution: {
      id: "pool-1", method: "manual",
      lots: [{ holdingId: "wand", fundId: "hoard", name: WAND.name, poolQuantity: 1, quantity: 1, unitCopper: WAND.copper, tier: "need", claims: [], unmarked: [], rolls: [], kept: 0, awards: [{ purseId: "aria", quantity: 1, choice: "need", holdingId: "wand-a" }] }],
    },
  } as never);
  t.journal = j;
  const dmText = recapText(buildSessionRecap(t, session, { kind: "dm" }));
  assert.match(dmText, /Wand of Wonder Prime/, "the DM's own recap names the true item");
  const draft = recapText(buildSessionRecap(t, session, { kind: "party" }));
  const mine = recapText(buildSessionRecap(projectRecord(t, ariaSeat), session, { kind: "player", purseIds: ["aria"] }));
  for (const text of [draft, mine]) {
    assert.deepEqual(leaks(text), [], text);
    assert.ok(!text.includes(formatCopper(RING.copper)) && !text.includes(formatCopper(WAND.copper)));
  }
  assert.match(draft, /Carved stick/);
  assert.match(mine, /Carved stick/);
});
