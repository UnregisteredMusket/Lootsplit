// Attunement (loot phase 5): the item-attune and attunement-limit commands, attunement ending
// when an attuned item leaves its character, in shared rooms and on the device: the rules,
// idempotent retries, server-side permissions, shared/offline parity, old-data readback and the
// player projection.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { validateEconomyRows } from "./validation.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand, saveHolding } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { attunedBefore, attunementFromNotes, attunementSummary, settleAttunement } from "./attunement.ts";
import { openCatalogItem, type OpenEntry } from "./open5e.ts";
import { projectRecord } from "./session-records.ts";
import { readFinance } from "./finance.ts";
import type { Holding, Shop } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of [
  "0001_campaign_rooms.sql",
  "0024_campaign_room_receipts.sql",
  "0026_campaign_room_sections.sql",
  "0029_campaign_room_report_parts.sql",
  "0030_campaign_room_archive_keys.sql",
  "0003_accounts.sql",
  "0008_encounters.sql",
])
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

const coins = () => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
const REQ = "Requires attunement";
const item = (id: string, purseId: string, name: string, extra: Partial<Holding> = {}): Holding => ({
  id,
  purseId,
  name,
  kind: "item",
  quantity: 1,
  unitCopper: 5000,
  notes: "",
  ...extra,
});
const shop: Shop = {
  id: "shop",
  name: "Curios",
  keeper: "",
  place: "",
  notes: "",
  sellRate: 1,
  buyRate: 0.5,
  wealth: "modest",
  category: "general",
  priceScale: 1,
  acceptAnyCategory: true,
};
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins() },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins() },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins() },
    ],
    shops: [shop],
    holdings: [
      item("ring", "aria", "Ring of protection", { requiresAttunement: REQ }),
      item("cloak", "aria", "Cloak of elvenkind", { requiresAttunement: REQ }),
      item("amulet", "aria", "Amulet of health", { requiresAttunement: REQ }),
      item("staff", "aria", "Staff of power", { requiresAttunement: `${REQ}: by a sorcerer, warlock, or wizard` }),
      item("bracers", "aria", "Bracers of defense", { requiresAttunement: REQ, quantity: 2 }),
      item("rope", "aria", "Rope"),
      item("boots", "bram", "Boots of speed", { requiresAttunement: REQ }),
      item("orb", "hoard", "Orb of shielding", { requiresAttunement: REQ }),
      item("wand", "hoard", "Wand of wonder", { requiresAttunement: REQ, pool: { at: 1, source: "add-loot" } }),
    ],
    journal: readJournal({}),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const find = (t: CloudTable, id: string) => t.holdings.find((h) => h.id === id);
const purse = (t: CloudTable, id: string) => t.purses.find((p) => p.id === id)!;
const attune = (t: CloudTable, id: string, holdingId: string, attuned = true, override = false): Command => {
  const h = find(t, holdingId)!;
  return {
    id,
    kind: "item-attune",
    holdingId,
    attuned,
    ...(override ? { override: true as const } : {}),
    expect: { purseId: h.purseId, attuned: !!h.attuned },
  };
};
const limit = (t: CloudTable, id: string, purseId: string, value: number | null): Command => ({
  id,
  kind: "attunement-limit",
  purseId,
  limit: value,
  expect: purse(t, purseId).attunementLimit ?? null,
});
const lastEvent = (t: CloudTable) => t.journal!.events.at(-1)!;
const attuneAll = (seat: CloudSeat, ids: string[], t = campaign()) => {
  for (const [i, holdingId] of ids.entries()) t = applyCommand(t, seat, attune(t, `at-${i}`, holdingId));
  return t;
};

test("attune: one event for the character's purse, no ledger line, and Attuned n/3", () => {
  const t = campaign();
  const after = applyCommand(t, ariaSeat, attune(t, "a1", "ring"));
  assert.equal(find(after, "ring")!.attuned, true);
  const event = lastEvent(after);
  assert.equal(event.id, "a1-event-0");
  assert.equal(event.purseId, "aria");
  assert.equal(event.summary, "Attuned Aria Thorne to Ring of protection: attuned 1/3");
  assert.deepEqual(event.change, { entity: "holding", entityId: "ring", before: { attuned: false }, after: { attuned: true } });
  assert.equal(after.ledger.length, 0, "no money moves");
  assert.equal(after.journal!.events.length, 1);
  assert.equal(attunementSummary(purse(after, "aria"), after.holdings), "Attuned 1/3");

  const ended = applyCommand(after, ariaSeat, attune(after, "a2", "ring", false));
  assert.equal(find(ended, "ring")!.attuned, undefined);
  assert.equal(lastEvent(ended).summary, "Ended attunement to Ring of protection (Aria Thorne): attuned 0/3");
});

test("the limit: a player is refused past 3; the DM needs an explicit override, which is recorded", () => {
  const t = attuneAll(ariaSeat, ["ring", "cloak", "amulet"]);
  assert.throws(() => applyCommand(t, ariaSeat, attune(t, "x1", "staff")), /already attuned to 3 of 3 items.*ask the DM/);
  assert.throws(() => applyCommand(t, ariaSeat, attune(t, "x2", "staff", true, true)), /Only the DM can attune past the limit/);
  assert.throws(() => applyCommand(t, dmSeat, attune(t, "x3", "staff")), /Attune past the limit/);
  const over = applyCommand(t, dmSeat, attune(t, "x4", "staff", true, true));
  assert.equal(find(over, "staff")!.attuned, true);
  assert.equal(lastEvent(over).summary, "Attuned Aria Thorne to Staff of power: attuned 4/3 (DM override past the limit of 3)");
  assert.deepEqual(lastEvent(over).change?.after, { attuned: true, override: true });
  assert.equal(attunementSummary(purse(over, "aria"), over.holdings), "Attuned 4/3");
  // An override under the limit records nothing special.
  const fresh = campaign();
  const under = applyCommand(fresh, dmSeat, attune(fresh, "x5", "ring", true, true));
  assert.equal(lastEvent(under).summary, "Attuned Aria Thorne to Ring of protection: attuned 1/3");
});

test("the DM's per-character limit: 0 to 10, a stale check, and the default of 3 is not stored", () => {
  let t = campaign();
  assert.throws(() => applyCommand(t, ariaSeat, limit(t, "l1", "aria", 5)), /Only the DM/);
  assert.throws(() => applyCommand(t, dmSeat, limit(t, "l2", "hoard", 5)), /Only characters/);
  assert.throws(() => applyCommand(t, dmSeat, limit(t, "l3", "aria", 11)));
  assert.throws(() => applyCommand(t, dmSeat, limit(t, "l4", "aria", 3)), /already 3/);
  t = applyCommand(t, dmSeat, limit(t, "l5", "aria", 1));
  assert.equal(purse(t, "aria").attunementLimit, 1);
  assert.equal(lastEvent(t).summary, "Attunement limit for Aria Thorne: 3 → 1");
  assert.equal(lastEvent(t).purseId, "aria");
  assert.throws(() => applyCommand(t, dmSeat, { ...limit(t, "l6", "aria", 4), expect: null } as Command), /changed/);
  t = applyCommand(t, ariaSeat, attune(t, "a1", "ring"));
  assert.throws(() => applyCommand(t, ariaSeat, attune(t, "a2", "cloak")), /1 of 1 items/);
  // Lowering below the current count keeps the attunements and says so.
  t = applyCommand(t, dmSeat, limit(t, "l7", "aria", 0));
  assert.match(lastEvent(t).summary, /1 → 0 \(attuned to 1; nothing ends automatically\)/);
  assert.equal(find(t, "ring")!.attuned, true);
  t = applyCommand(t, dmSeat, limit(t, "l8", "aria", null));
  assert.equal(purse(t, "aria").attunementLimit, undefined, "back to the default");
  t = applyCommand(t, dmSeat, limit(t, "l9", "aria", 10));
  assert.equal(purse(t, "aria").attunementLimit, 10);
});

test("who may attune; pooled, party-fund, stored, non-attunement and stale items are refused", () => {
  const t = campaign();
  assert.throws(() => applyCommand(t, ariaSeat, attune(t, "x1", "boots")), /permission/, "another player's item");
  assert.equal(find(applyCommand(t, dmSeat, attune(t, "x2", "boots")), "boots")!.attuned, true, "the DM on any character");
  assert.throws(() => applyCommand(t, dmSeat, attune(t, "x3", "wand")), /character/, "a pooled item in a party fund");
  assert.throws(() => applyCommand(t, dmSeat, attune(t, "x4", "orb")), /Only a character can attune/, "a party fund");
  const pooled = campaign();
  Object.assign(find(pooled, "ring")!, { pool: { at: 1, source: "add-loot" } });
  assert.throws(() => applyCommand(pooled, dmSeat, attune(pooled, "x5", "ring")), /treasure pool/);
  assert.throws(() => applyCommand(t, ariaSeat, attune(t, "x6", "rope")), /doesn't require attunement/);
  assert.throws(
    () => applyCommand(t, ariaSeat, { ...attune(t, "x7", "ring"), expect: { purseId: "aria", attuned: true } } as Command),
    /changed/,
  );
  assert.throws(() => applyCommand(t, ariaSeat, attune(t, "x8", "ring", false)), /isn't attuned/);
  const stored = campaign();
  find(stored, "ring")!.reservedFor = "project-1";
  assert.throws(() => applyCommand(stored, ariaSeat, attune(stored, "x9", "ring")), /Retrieve this item/);
});

test("an attuned item that leaves its character ends the attunement in the same command", () => {
  const t = attuneAll(ariaSeat, ["ring", "cloak", "bracers"]);
  // Give the whole item: the receiver is not attuned; one event for the giver.
  const given = applyCommand(t, ariaSeat, { id: "g1", kind: "give", fromId: "aria", toId: "bram", copper: 0, holdingId: "ring", quantity: 1 });
  assert.equal(find(given, "ring"), undefined);
  assert.equal(find(given, "g1-item")!.attuned, undefined, "the receiver doesn't become attuned");
  assert.equal(find(given, "g1-item")!.requiresAttunement, REQ, "the requirement travels with the item");
  const ended = given.journal!.events.filter((e) => e.summary.startsWith("Attunement ended"));
  assert.deepEqual(ended.map((e) => [e.summary, e.purseId]), [["Attunement ended: Ring of protection (Aria Thorne) left the character; attuned 2/3", "aria"]]);
  // Part of an attuned stack: the attuned item stays with the giver.
  const part = applyCommand(t, ariaSeat, { id: "g2", kind: "give", fromId: "aria", toId: "bram", copper: 0, holdingId: "bracers", quantity: 1 });
  assert.equal(find(part, "bracers")!.attuned, true);
  assert.equal(find(part, "g2-item")!.attuned, undefined);
  assert.equal(part.journal!.events.some((e) => e.summary.startsWith("Attunement ended")), false);
  // Give to the party fund (the step before the pool), sell, and a DM edit that moves or deletes it.
  const toFund = applyCommand(t, ariaSeat, { id: "g3", kind: "give", fromId: "aria", toId: "hoard", copper: 0, holdingId: "cloak", quantity: 1 });
  assert.equal(find(toFund, "g3-item")!.attuned, undefined);
  const sold = applyCommand(t, dmSeat, { id: "s1", kind: "sell", holdingId: "ring", shopId: "shop", quantity: 1 });
  assert.equal(find(sold, "ring"), undefined);
  assert.match(lastEvent(sold).summary, /^Attunement ended: Ring of protection \(Aria Thorne\) left the character/);
  const ring = find(t, "ring")!;
  const moved = applyCommand(t, dmSeat, { id: "p1", kind: "patch", changes: [{ store: "holdings", id: "ring", before: ring, after: { ...ring, purseId: "bram" } }] });
  assert.equal(find(moved, "ring")!.attuned, undefined);
  assert.equal(lastEvent(moved).purseId, "aria");
  const deleted = applyCommand(t, dmSeat, { id: "p2", kind: "patch", changes: [{ store: "holdings", id: "ring", before: ring, after: null }] });
  assert.match(lastEvent(deleted).summary, /Ring of protection \(Aria Thorne\) left the character; attuned 2\/3/);
  // Stored at a property or reserved for a project (estate commands): no longer carried.
  const stored = structuredClone(t);
  find(stored, "ring")!.reservedFor = "project-1";
  const events: string[] = [];
  settleAttunement(stored, attunedBefore(t.holdings), null, (summary) => events.push(summary));
  assert.equal(find(stored, "ring")!.attuned, undefined);
  assert.deepEqual(events, ["Attunement ended: Ring of protection (Aria Thorne) is no longer carried; attuned 2/3"]);
});

test("edits keep attunement: an older client's edit without the fields, and a DM patch can't attune", () => {
  const t = attuneAll(ariaSeat, ["ring"]);
  const ring = find(t, "ring")!;
  const { attuned: _a, requiresAttunement: _r, ...old } = ring;
  const renamed = applyCommand(t, dmSeat, { id: "p1", kind: "patch", changes: [{ store: "holdings", id: "ring", before: ring, after: { ...old, name: "Ring of warding" } }] });
  assert.equal(find(renamed, "ring")!.attuned, true);
  assert.equal(find(renamed, "ring")!.requiresAttunement, REQ);
  const cloak = find(t, "cloak")!;
  const patched = applyCommand(t, dmSeat, { id: "p2", kind: "patch", changes: [{ store: "holdings", id: "cloak", before: cloak, after: { ...cloak, attuned: true } }] });
  assert.equal(find(patched, "cloak")!.attuned, undefined, "attunement changes only through item-attune");
  assert.equal(attunementSummary(purse(t, "aria"), t.holdings), "Attuned 1/3");
});

test("validation: old holdings and purses still load; malformed attunement fields are refused", () => {
  const rows = (holdings: Holding[], purses = campaign().purses) => ({ ...campaign(), holdings, purses });
  validateEconomyRows(campaign());
  validateEconomyRows(rows([item("old", "aria", "Old ring")]));
  assert.throws(() => validateEconomyRows(rows([item("a", "aria", "A", { attuned: true })])), /requires attunement/);
  assert.throws(() => validateEconomyRows(rows([item("b", "aria", "B", { requiresAttunement: "" })])));
  assert.throws(() => validateEconomyRows(rows([item("c", "aria", "C", { requiresAttunement: REQ, kind: "property" })])), /Only items/);
  assert.throws(() => validateEconomyRows(rows([], [{ id: "aria", name: "Aria", kind: "character", coins: coins(), attunementLimit: 11 }])));
  assert.throws(() => validateEconomyRows(rows([], [{ id: "hoard", name: "Hoard", kind: "party", coins: coins(), attunementLimit: 2 }])), /Only characters/);
});

test("Open5e: the import text becomes the field when the item is added or bought", () => {
  const entry = {
    key: "staff-of-power",
    name: "Staff of power",
    description: "A staff.",
    facts: ["Rarity: Very rare", "Requires attunement: by a sorcerer, warlock, or wizard"],
    copper: 0,
    category: "curios",
    kind: "magicitems",
    edition: "srd-2014",
    source: "SRD 5.1",
    attribution: "SRD",
    url: "https://api.open5e.com/v2/magicitems/staff-of-power/",
  } as unknown as OpenEntry;
  const catalogItem = openCatalogItem(entry, 100, "curios");
  assert.deepEqual(attunementFromNotes(catalogItem.notes), { requiresAttunement: "Requires attunement: by a sorcerer, warlock, or wizard" });
  assert.deepEqual(attunementFromNotes("A rope.\n\nRarity: common"), {});
  const t = campaign();
  t.stock.push({ id: "line", shopId: "shop", name: catalogItem.name, copper: 100, baseCopper: 100, rarity: "magic", quantity: 1, notes: catalogItem.notes });
  t.purses[1]!.coins.gp = 10;
  const bought = applyCommand(t, ariaSeat, { id: "b1", kind: "buy", stockId: "line", purseId: "aria", quantity: 1 });
  assert.equal(find(bought, "b1-item")!.requiresAttunement, "Requires attunement: by a sorcerer, warlock, or wizard");
  assert.equal(find(bought, "b1-item")!.attuned, undefined);
});

test("shared rooms: a retry applies once, the server refuses other seats, and players see only their own", async () => {
  const dm = await openRoom({ name: "Attunement DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" });
  const AT = { code: dm.code, token: aria.token };
  const BT = { code: dm.code, token: bram.token };
  const DT = { code: dm.code, token: dm.token };
  await choosePace({ ...DT, live: true });
  const state = async () => (await roomState(DT)).table;
  const cmd = attune(await state(), "room-1", "ring");
  await submitCommands({ ...AT, batchId: "room-1", commands: [cmd] });
  await submitCommands({ ...AT, batchId: "room-1", commands: [cmd] });
  let table = await state();
  assert.equal(find(table, "ring")!.attuned, true);
  assert.equal(table.journal!.events.filter((e) => e.id.startsWith("room-1")).length, 1, "a retry changes nothing");

  await assert.rejects(submitCommands({ ...BT, batchId: "room-2", commands: [attune(table, "room-2", "ring", false)] }));
  await assert.rejects(submitCommands({ ...AT, batchId: "room-3", commands: [limit(table, "room-3", "aria", 5)] }));
  await assert.rejects(submitCommands({ ...AT, batchId: "room-4", commands: [attune(table, "room-4", "boots")] }));
  await submitCommands({ ...DT, batchId: "room-5", commands: [limit(table, "room-5", "aria", 4)] });
  table = await state();
  assert.equal(purse(table, "aria").attunementLimit, 4);

  const bramView = (await roomState(BT)).table;
  assert.equal(find(bramView, "ring"), undefined, "Bram doesn't see Aria's items");
  assert.equal(bramView.journal!.events.some((e) => /Ring|Aria/.test(e.summary)), false);
  assert.equal(bramView.purses.find((p) => p.id === "aria")?.attunementLimit, undefined, "nor her limit");
  const ariaView = (await roomState(AT)).table;
  assert.equal(find(ariaView, "ring")!.attuned, true);
  assert.equal(ariaView.purses.find((p) => p.id === "aria")?.attunementLimit, 4);
  const ariaEvents = ariaView.journal!.events.filter((e) => e.purseId === "aria");
  assert.equal(ariaEvents.length, 2);
  assert.ok(ariaEvents.every((e) => !("change" in e)), "players never get the DM's recorded change");
});

test("projection: another player's character's limit and attuned items are not sent", () => {
  const t = campaign();
  purse(t, "bram").attunementLimit = 5;
  const view = projectRecord(t, { role: "player", purseIds: ["aria"] });
  assert.equal(view.purses.find((p) => p.id === "bram")?.attunementLimit, undefined);
  assert.equal(view.holdings.some((h) => h.purseId === "bram"), false);
});

test("offline: the same commands give the same inventory and activity, and a retry applies once", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  let shared = campaign();
  const steps: Command[] = [];
  const step = (c: Command) => {
    steps.push(c);
    shared = applyCommand(shared, dmSeat, c);
  };
  step(attune(shared, "d1", "ring"));
  step(attune(shared, "d2", "cloak"));
  step(limit(shared, "d3", "aria", 2));
  step(attune(shared, "d4", "amulet", true, true));
  step({ id: "d5", kind: "give", fromId: "aria", toId: "bram", copper: 0, holdingId: "cloak", quantity: 1 });
  step(attune(shared, "d6", "ring", false));
  for (const s of steps) await executeLocalCommand(s);
  const once = await economySnapshot();
  for (const s of steps) await executeLocalCommand(s);
  const twice = await economySnapshot();
  const byId = (rows: { id: string }[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(twice.holdings), byId(once.holdings), "retries change nothing");
  assert.deepEqual(byId(once.holdings), byId(shared.holdings));
  assert.deepEqual(byId(once.purses), byId(shared.purses));
  const summaries = (t: { journal?: CloudTable["journal"] }) =>
    (t.journal?.events ?? []).filter((e) => /attun/i.test(e.summary)).map((e) => [e.id, e.summary, e.purseId]);
  assert.deepEqual(summaries(once), summaries(shared));
  assert.equal(summaries(twice).length, 6);
  const stale = await executeLocalCommand({ ...steps[3]!, id: "d7" }).catch((e: Error) => e.message);
  assert.match(String(stale), /changed/);

  // The device's own item edit keeps attunement with the character and ends it on a move.
  const amulet = (await economySnapshot()).holdings.find((h) => h.id === "amulet")!;
  const { attuned: _a, ...plain } = amulet;
  await saveHolding({ ...plain, name: "Amulet of vigour" });
  assert.equal((await economySnapshot()).holdings.find((h) => h.id === "amulet")!.attuned, true);
  await saveHolding({ ...amulet, purseId: "bram" });
  const moved = await economySnapshot();
  assert.equal(moved.holdings.find((h) => h.id === "amulet")!.attuned, undefined);
  assert.match(moved.journal!.events.at(-1)!.summary, /Attunement ended: Amulet of vigour left the character/);

  setSeat({ role: "player", purseIds: ["aria"], shopIds: [], openedAt: 0 });
  const link = await executeLocalCommand(attune(shared, "d8", "staff")).catch((e: Error) => e.message);
  assert.match(String(link), /DM's device or in a shared room/);
  setSeat(DM_SEAT);
});

test("an attuned item used up through item-use ends its attunement in the same command, with one event", () => {
  const t = campaign();
  Object.assign(find(t, "ring")!, { uses: { current: 1, max: 3, whenEmpty: "remove" } });
  Object.assign(find(t, "cloak")!, { uses: { current: 1, max: 3, whenEmpty: "keep" } });
  const attunedT = attuneAll(ariaSeat, ["ring", "cloak"], t);
  const used = applyCommand(attunedT, ariaSeat, {
    id: "u1",
    kind: "item-use",
    holdingId: "ring",
    expect: { current: 1, quantity: 1 },
  });
  assert.equal(find(used, "ring"), undefined, "used up and removed");
  const ended = used.journal!.events.filter((e) => e.id.startsWith("u1-"));
  assert.deepEqual(
    ended.map((e) => e.summary),
    [
      "Used up Ring of protection (Aria Thorne): removed from the inventory",
      "Attunement ended: Ring of protection (Aria Thorne) left the character; attuned 1/3",
    ],
  );
  assert.equal(ended.filter((e) => e.summary.startsWith("Attunement ended")).length, 1);
  assert.equal(ended[1]!.purseId, "aria");
  // Kept at 0 uses: still held, so still attuned.
  const kept = applyCommand(used, ariaSeat, { id: "u2", kind: "item-use", holdingId: "cloak", expect: { current: 1, quantity: 1 } });
  assert.equal(find(kept, "cloak")!.attuned, true);
  assert.equal(kept.journal!.events.some((e) => e.id.startsWith("u2-") && e.summary.startsWith("Attunement ended")), false);
});

test("a DM patch that also changes the journal still records the attunement it ends", () => {
  const t = attuneAll(ariaSeat, ["ring"]);
  const ring = find(t, "ring")!;
  const journal = readJournal(t.journal);
  const after = applyCommand(t, dmSeat, {
    id: "pj",
    kind: "patch",
    changes: [
      { store: "journal", id: "journal", before: journal, after: { ...journal, events: [...journal.events] } },
      { store: "holdings", id: "ring", before: ring, after: null },
    ],
  } as Command);
  const ended = after.journal!.events.filter((e) => e.summary.startsWith("Attunement ended"));
  assert.equal(ended.length, 1);
  assert.equal(ended[0]!.purseId, "aria");
  assert.match(ended[0]!.id, /^pj-event-\d+$/);
});

test("projection: an NPC available here lists its goods without whom it is attuned to", () => {
  const t = {
    ...campaign(),
    journal: readJournal({
      market: {
        currentLocationId: "area",
        locations: [
          { id: "region", name: "Eastmarch", kind: "region", parentId: null, description: "" },
          { id: "city", name: "Port", kind: "city", parentId: "region", description: "" },
          { id: "area", name: "Docks", kind: "area", parentId: "city", description: "" },
        ],
      },
      finance: readFinance(),
      sessions: [{ id: "session", name: "Adventure", startedAt: 1 }],
    }),
  };
  let w = applyCommand(t, dmSeat, {
    id: "npc",
    kind: "npc-create",
    npc: { id: "npc", name: "Mara", description: "Broker", locationId: "city", visible: true, barterAllowed: true, controllerPurseId: null },
    copper: 0,
    inventory: [{ name: "Ring of the broker", quantity: 1, unitCopper: 1000, notes: "" }],
  } as Command);
  const gem = w.holdings.find((h) => h.purseId === "npc")!;
  w = applyCommand(w, dmSeat, { id: "req", kind: "patch", changes: [{ store: "holdings", id: gem.id, before: gem, after: { ...gem, requiresAttunement: REQ } }] });
  w = applyCommand(w, dmSeat, attune(w, "npc-attune", gem.id, true, true));
  assert.equal(find(w, gem.id)!.attuned, true);
  const view = projectRecord(w, { role: "player", purseIds: ["aria"] });
  const seen = view.holdings.find((h) => h.id === gem.id);
  assert.ok(seen, "the NPC's goods are listed");
  assert.equal("attuned" in seen!, false);
  assert.equal(seen!.requiresAttunement, REQ);
  const own = applyCommand(w, ariaSeat, attune(w, "own", "ring"));
  const ownView = projectRecord(own, { role: "player", purseIds: ["aria"] });
  assert.equal(ownView.holdings.find((h) => h.id === "ring")!.attuned, true, "own items keep it");
});
