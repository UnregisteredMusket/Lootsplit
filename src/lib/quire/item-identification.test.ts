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
import { canonicalJson } from "./canonical-json.ts";
import { CURRENT_TABLETOP_PROTOCOL, ITEM_IDENTITY_PROTOCOL, tabletopResponse } from "./tabletop-protocol.ts";
import { identifyCommand, sageFixture, svcDm, svcKael, svcThorn } from "./test-fixtures/services.ts";
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
  wealth: "modest", category: "curios", priceScale: 1, acceptedCategories: ["curios", "jewels", "smith"],
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
  // A DM's offer for an NPC snapshots the true item: the projection presents it.
  const redacted = redactIdentity({ before: canonicalJson(campaign().holdings[0]) }, identitySecrets(campaign().holdings));
  assert.deepEqual(leaks(redacted), []);
  assert.equal(JSON.parse(redacted.before).name, "Plain brass ring");
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
