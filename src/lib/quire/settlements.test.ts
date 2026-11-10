// Settlement tiers, phase S1 (owner design 2026-11-10): a city's or town's size on a per-campaign
// ladder, an optional population, and DM-only defaults for NEW shops there. These tests pin the
// schema (round trip, old journals unchanged, later fields ignored), inheritance by areas, the
// commands (DM only, checked against what the DM saw, replay, history), that defaults apply only
// when a shop is created and never rewrite an existing shop, the player projection (only visible
// places, never the DM's defaults), older clients' whole-journal writes, and the device's parity
// with the shared engine.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import { preserveJournalMetadata, readJournal } from "./journal.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand, openComposedShop } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { projectRecord, archiveSession } from "./session-records.ts";
import { seatView } from "./player-view.ts";
import { fromCopper } from "./money.ts";
import { marketNameFingerprint } from "./market-name-import.ts";
import { newShopDefaults, readSettlements, settlementAt, settlementTiers } from "./settlements.ts";
import { SETTLEMENT_LADDERS, type SettlementProfile } from "./settlements-schema.ts";
import { CURRENT_TABLETOP_PROTOCOL } from "./tabletop-protocol.ts";
import type { Shop } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of [
  "0001_campaign_rooms.sql",
  "0019_campaign_room_reports.sql",
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

const shopBase = { keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", priceScale: 1, category: "general" } as const;
const drink: Shop = { ...shopBase, id: "drink", name: "Dead Man's Drink", locationId: "docks", merchantPurse: 5000 };
const mill: Shop = { ...shopBase, id: "mill", name: "Uptown Mill", wealth: "poor", locationId: "uptown" };
const pc = (id: string, name: string) => ({ id, name, kind: "character" as const, coins: fromCopper(10000) });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [pc("aria", "Aria Thorne"), pc("bram", "Bram Ironfoot")],
    shops: [drink, mill],
    journal: readJournal({
      market: {
        currentLocationId: "docks",
        locations: [
          { id: "coast", kind: "region", parentId: null, name: "The Coast", description: "" },
          { id: "port-city", kind: "city", parentId: "coast", name: "Port City", description: "" },
          { id: "docks", kind: "area", parentId: "port-city", name: "The Docks", description: "" },
          { id: "uptown", kind: "city", parentId: "coast", name: "Uptown", description: "" },
          { id: "brook", kind: "town", parentId: "coast", name: "Brook", description: "" },
          { id: "brook-green", kind: "area", parentId: "brook", name: "Brook Green", description: "" },
        ],
      },
    }),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const profile = (id: string, locationId: string, next: SettlementProfile | null, before: SettlementProfile | null = null): Command => ({
  id, kind: "settlement-profile", locationId, before, profile: next,
});
type Ladder = { ladder: "pf1" | "simple"; names: Record<string, string> };
const ladder = (id: string, after: Ladder, before: Ladder = { ladder: "pf1", names: {} }): Command => ({
  id, kind: "settlement-ladder", before, after,
});
const run = (t: CloudTable, ...cmds: Command[]) => cmds.reduce((next, c) => applyCommand(next, dmSeat, c), t);
const placesOf = (t: CloudTable) => readSettlements((t.journal as { settlements?: unknown }).settlements).places;
const settled = () =>
  run(
    campaign(),
    profile("p1", "port-city", { tier: "large-city", population: "about 25,000", purse: 100_000, refill: 80_000 }),
    profile("p2", "uptown", { tier: "small-town", population: "Secret count", wealth: "rich" }),
    profile("p3", "brook", { tier: "hamlet" }),
  );

test("schema: the ladders map onto the four wealth steps, and old journals load unchanged", () => {
  const wealth = (id: "pf1" | "simple") => SETTLEMENT_LADDERS[id].tiers.map((t) => `${t.id}:${t.wealth}`);
  assert.deepEqual(wealth("pf1"), [
    "thorp:poor", "hamlet:poor", "village:modest", "small-town:modest",
    "large-town:rich", "small-city:rich", "large-city:princely", "metropolis:princely",
  ]);
  assert.deepEqual(wealth("simple"), ["village:poor", "town:modest", "city:rich", "large-city:princely", "capital:princely"]);
  // A journal without the key reads back without it; nothing applies anywhere.
  const old = campaign();
  assert.equal("settlements" in old.journal!, false);
  assert.equal(newShopDefaults(old.journal, "docks"), undefined);
  assert.equal("settlements" in projectRecord(old, ariaSeat).journal!, false);
  assert.deepEqual(readSettlements(undefined), { places: {} });
  // Round trip, and a later version's fields are ignored (not an error).
  const t = settled();
  const raw = JSON.parse(JSON.stringify(t.journal));
  assert.deepEqual(readJournal(raw).settlements, t.journal!.settlements);
  raw.settlements.places["port-city"].saleCap = 50_000;
  raw.settlements.laterThing = true;
  assert.deepEqual(readSettlements(readJournal(raw).settlements).places["port-city"], placesOf(t)["port-city"]);
  // Small: a typical profile is well under 200 bytes.
  assert.ok(JSON.stringify(placesOf(t)["port-city"]).length < 200);
});

test("inheritance: an area shares its city's or town's profile; regions and unset places have none", () => {
  const t = settled();
  const docks = settlementAt(t.journal, "docks")!;
  assert.equal(docks.location.id, "port-city");
  assert.equal(docks.inherited, true);
  assert.equal(docks.tier.name, "Large city");
  assert.equal(settlementAt(t.journal, "port-city")!.inherited, false);
  assert.equal(settlementAt(t.journal, "brook-green")!.tier.id, "hamlet");
  assert.equal(settlementAt(t.journal, "coast"), undefined);
  assert.equal(settlementAt(t.journal, null), undefined);
  assert.deepEqual(newShopDefaults(t.journal, "docks"), {
    wealth: "princely", buyRate: 0.75, merchantPurse: 100_000, merchantPurseRefill: 80_000, source: "Port City · Large city",
  });
  // The DM's wealth override wins over the tier's; no purse means none is suggested.
  assert.deepEqual(newShopDefaults(t.journal, "uptown"), { wealth: "rich", buyRate: 0.6, source: "Uptown · Small town" });
  assert.equal(newShopDefaults(t.journal, "brook-green")!.wealth, "poor");
});

test("commands: DM only, checked against what the DM saw, validated, DM-only history; shops untouched", () => {
  const t = settled();
  assert.deepEqual(t.shops, campaign().shops, "setting tiers never rewrites a shop");
  assert.throws(() => applyCommand(campaign(), ariaSeat, profile("x", "port-city", { tier: "village" })), /DM/);
  assert.throws(() => run(campaign(), profile("x", "docks", { tier: "village" })), /Only cities and towns/);
  assert.throws(() => run(campaign(), profile("x", "coast", { tier: "village" })), /Only cities and towns/);
  assert.throws(() => run(campaign(), profile("x", "nowhere", { tier: "village" })), /no longer exists/);
  assert.throws(() => run(campaign(), profile("x", "port-city", { tier: "capital" })), /ladder/);
  assert.throws(() => run(campaign(), profile("x", "port-city", { tier: "village", refill: 100 })), /purse before its refill/);
  // Stale: another device changed it since the DM looked.
  assert.throws(() => run(t, profile("x", "port-city", { tier: "village" })), /changed elsewhere/);
  const edited = run(t, profile("p4", "port-city", { tier: "metropolis" }, placesOf(t)["port-city"]!));
  assert.deepEqual(placesOf(edited)["port-city"], { tier: "metropolis" });
  const cleared = run(edited, profile("p5", "port-city", null, { tier: "metropolis" }));
  assert.equal(placesOf(cleared)["port-city"], undefined);
  assert.deepEqual(cleared.shops, campaign().shops);
  const lines = cleared.journal!.events.filter((e) => e.summary.startsWith("Settlement"));
  assert.deepEqual(lines.map((e) => e.summary), [
    "Settlement tier saved: Port City · Large city",
    "Settlement tier saved: Uptown · Small town",
    "Settlement tier saved: Brook · Hamlet",
    "Settlement tier saved: Port City · Metropolis",
    "Settlement profile cleared: Port City",
  ]);
  assert.ok(lines.every((e) => e.dmOnly === true));
  // Clearing everything leaves no key behind.
  const empty = run(campaign(), profile("e1", "brook", { tier: "village" }), profile("e2", "brook", null, { tier: "village" }));
  assert.equal("settlements" in empty.journal!, false);
});

test("ladder: choose five steps and rename tiers; a ladder that strands a place's tier is refused", () => {
  const t = settled();
  assert.throws(() => run(t, ladder("l1", { ladder: "simple", names: {} })), /2 places use tiers this ladder doesn't have/);
  assert.throws(() => run(campaign(), ladder("l1", { ladder: "simple", names: { thorp: "Croft" } })), /belongs to one of this ladder/);
  assert.throws(() => run(campaign(), ladder("l1", { ladder: "simple", names: {} }, { ladder: "simple", names: {} })), /changed elsewhere/);
  const simple = run(campaign(), ladder("l2", { ladder: "simple", names: { capital: "Crown city", town: "Town" } }));
  const s = readSettlements(simple.journal!.settlements);
  assert.deepEqual({ ladder: s.ladder, names: s.names }, { ladder: "simple", names: { capital: "Crown city" } }, "names equal to the default are not stored");
  assert.deepEqual(settlementTiers(s).map((x) => x.name), ["Village", "Town", "City", "Large city", "Crown city"]);
  const placed = run(simple, profile("l3", "port-city", { tier: "capital" }));
  assert.equal(settlementAt(placed.journal, "docks")!.tier.name, "Crown city");
  assert.equal(newShopDefaults(placed.journal, "docks")!.wealth, "princely");
  // Renaming on the default ladder (Pathfinder's eight sizes).
  const renamed = run(t, ladder("l4", { ladder: "pf1", names: { hamlet: "Croft" } }));
  assert.equal(settlementAt(renamed.journal, "brook")!.tier.name, "Croft");
});

test("new shops: defaults apply when a shop is created there; existing shops keep their wealth and purse", async () => {
  const t = settled();
  // Imported shop names (server-side creation): in the city, its area, a new area, and elsewhere.
  const rows = [
    { name: "Fishmonger", kind: "shop" as const, path: [], parentId: "docks" },
    { name: "Gatehouse", kind: "shop" as const, path: [], parentId: "uptown" },
    { name: "Plain Stall", kind: "shop" as const, path: [], parentId: "coast" },
    {
      name: "Wharf Chandler",
      kind: "shop" as const,
      parentId: null,
      path: [
        { kind: "region" as const, name: "The Coast" },
        { kind: "city" as const, name: "Port City" },
        { kind: "area" as const, name: "New Wharf" },
      ],
    },
  ];
  const imported = run(t, {
    id: "imp1",
    kind: "market-name-import",
    before: marketNameFingerprint(readJournal(t.journal).market!, t.shops),
    rows,
  } as Command);
  const shop = (name: string) => imported.shops.find((s) => s.name === name)!;
  assert.deepEqual(
    [shop("Fishmonger"), shop("Gatehouse"), shop("Plain Stall")].map((s) => [s.wealth, s.buyRate, s.merchantPurse, s.merchantPurseRefill]),
    [["princely", 0.75, 100_000, 80_000], ["rich", 0.6, undefined, undefined], ["modest", 0.5, undefined, undefined]],
  );
  assert.equal(shop("Wharf Chandler").wealth, "princely", "an area the import adds shares its city's");
  assert.equal(shop("Wharf Chandler").merchantPurse, 100_000);
  // The shops that were already there are exactly as before.
  assert.deepEqual(imported.shops.filter((s) => s.id === "drink" || s.id === "mill"), campaign().shops);
  // Changing a profile later never reaches shops already created.
  const later = run(imported, profile("p9", "port-city", { tier: "thorp" }, placesOf(imported)["port-city"]!));
  assert.deepEqual(later.shops, imported.shops);
  // The device's shop composer path: openComposedShop stores the purse it is given.
  setSeat(DM_SEAT);
  await applyCloudTable(t);
  const d = newShopDefaults(t.journal, "docks")!;
  const id = await openComposedShop({
    locationId: "docks", name: "Harbour Goods", keeper: "", place: "", notes: "", sellRate: 1, buyRate: d.buyRate,
    wealth: d.wealth, category: "general", priceScale: 1, lines: [],
    merchantPurse: d.merchantPurse, merchantPurseRefill: d.merchantPurseRefill,
  });
  const after = await economySnapshot();
  const made = after.shops.find((s) => s.id === id)!;
  assert.deepEqual([made.wealth, made.merchantPurse, made.merchantPurseRefill], ["princely", 100_000, 80_000]);
  assert.deepEqual(after.shops.find((s) => s.id === "drink"), drink);
});

test("locations: removing a place, or making it an area or region, drops its profile", () => {
  const t = settled();
  const location = (id: string) => readJournal(t.journal).market!.locations.find((l) => l.id === id)!;
  const removed = run(t, { id: "m1", kind: "market-location", locationId: "brook-green", before: location("brook-green"), after: null }, {
    id: "m2", kind: "market-location", locationId: "brook", before: location("brook"), after: null,
  });
  assert.equal(placesOf(removed).brook, undefined);
  assert.ok(removed.journal!.events.some((e) => e.summary === "Settlement profile cleared: Brook" && e.dmOnly));
  // Renaming keeps it; a city made into a town keeps it (both can hold one).
  const renamed = run(t, { id: "m3", kind: "market-location", locationId: "uptown", before: location("uptown"), after: { ...location("uptown"), name: "Upper Town", kind: "town" } });
  assert.deepEqual(placesOf(renamed).uptown, placesOf(t).uptown);
  assert.equal(settlementAt(renamed.journal, "uptown")!.location.name, "Upper Town");
  // A city made into a region has no size any more.
  const region = run(t, { id: "m4", kind: "market-location", locationId: "uptown", before: location("uptown"), after: { ...location("uptown"), kind: "region", parentId: null } });
  assert.equal(placesOf(region).uptown, undefined);
  assert.equal(settlementAt(region.journal, "uptown"), undefined);
});

test("projection: players get tiers and population of places they can see, never the DM's defaults", () => {
  const t = settled();
  const view = projectRecord(t, ariaSeat);
  const places = placesOf(view);
  // The party is in the Docks: Port City is on its path; Uptown and Brook are not.
  assert.deepEqual(places, { "port-city": { tier: "large-city", population: "about 25,000" } });
  const text = JSON.stringify(view.journal);
  for (const secret of ["Secret count", "100000", "80000", "uptown\":{"]) assert.ok(!text.includes(secret), `the player's copy holds ${secret}`);
  assert.equal(settlementAt(view.journal, "docks")!.tier.name, "Large city");
  assert.equal(newShopDefaults(view.journal, "docks")!.merchantPurse, undefined);
  // Renamed tiers reach players too (public names).
  const renamed = run(t, ladder("n1", { ladder: "pf1", names: { "large-city": "Great port" } }));
  assert.equal(settlementAt(projectRecord(renamed, ariaSeat).journal, "docks")!.tier.name, "Great port");
  // No visible place with a profile: no key at all.
  const elsewhere = run(campaign(), profile("e1", "uptown", { tier: "village" }));
  assert.equal("settlements" in projectRecord(elsewhere, ariaSeat).journal!, false);
  // The DM keeps everything; Preview as player projects the same as the room.
  assert.deepEqual(placesOf(projectRecord(t, dmSeat)), placesOf(t));
  assert.deepEqual(placesOf(seatView(t, { purseIds: ["aria"] })), places);
  // Archived sessions are projected by the same rules.
  const archived = structuredClone(t);
  archiveSession(archived, "session-1", "Session 1", 1);
  const report = projectRecord(archived, ariaSeat).journal!.reports![0]!;
  assert.ok(!report.snapshot.includes("Secret count") && !report.snapshot.includes("100000"));
});

test("older clients: a whole-journal write without settlements keeps the stored ones and can't replace them", () => {
  const t = settled();
  const { settlements: _dropped, ...old } = t.journal as Record<string, unknown>;
  assert.deepEqual(preserveJournalMetadata(old, t.journal!).settlements, t.journal!.settlements);
  const forged = { ...t.journal, settlements: { places: { uptown: { tier: "metropolis" } } } };
  assert.deepEqual(preserveJournalMetadata(forged, t.journal!).settlements, t.journal!.settlements);
  assert.equal(preserveJournalMetadata(forged, campaign().journal!).settlements, undefined);
});

test("shared rooms: players refused on the server, a replayed command ID applies once, players see the projection", async () => {
  const dm = await openRoom({ name: "Settlements DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const DT = { code: dm.code, token: dm.token, tabletopProtocol: CURRENT_TABLETOP_PROTOCOL };
  const AT = { code: dm.code, token: aria.token, tabletopProtocol: CURRENT_TABLETOP_PROTOCOL };
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const state = async () => (await roomState(DT)).table;
  const set = profile("c1", "port-city", { tier: "large-city", population: "about 25,000", purse: 100_000 });
  await assert.rejects(submitCommands({ ...AT, batchId: "c0", commands: [{ ...set, id: "c0" }] }), /DM/);
  assert.equal((await state()).journal!.settlements, undefined);
  await submitCommands({ ...DT, batchId: "c1", commands: [set] });
  await submitCommands({ ...DT, batchId: "c1", commands: [set] });
  const table = await state();
  assert.deepEqual(placesOf(table), { "port-city": { tier: "large-city", population: "about 25,000", purse: 100_000 } });
  assert.equal(table.journal!.events.filter((e) => e.id.startsWith("c1-")).length, 1, "a retry changes nothing");
  assert.deepEqual(table.shops, campaign().shops);
  const view = (await roomState(AT)).table;
  assert.deepEqual(placesOf(view), { "port-city": { tier: "large-city", population: "about 25,000" } });
  assert.ok(!JSON.stringify(view.journal!.events).includes("Settlement tier saved"), "the history line is the DM's");
});

test("offline parity: the device runs the same commands with the same results, retries and errors", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const steps: Command[] = [
    ladder("d0", { ladder: "pf1", names: { hamlet: "Croft" } }),
    profile("d1", "port-city", { tier: "large-city", population: "about 25,000", purse: 100_000, refill: 80_000 }),
    profile("d2", "brook", { tier: "hamlet" }),
    profile("d3", "brook", { tier: "village", wealth: "rich" }, { tier: "hamlet" }),
  ];
  const shared = run(campaign(), ...steps);
  for (const s of steps) await executeLocalCommand(s);
  const once = await economySnapshot();
  for (const s of steps) await executeLocalCommand(s);
  const twice = await economySnapshot();
  assert.deepEqual(once.journal!.settlements, shared.journal!.settlements);
  assert.deepEqual(twice.journal!.settlements, once.journal!.settlements, "retries change nothing");
  const logs = (t: CloudTable) => t.journal!.events.filter((e) => e.summary.startsWith("Settlement")).map((e) => [e.id, e.summary, e.dmOnly]);
  assert.deepEqual(logs(once), logs(shared));
  assert.deepEqual(logs(twice), logs(once));
  assert.deepEqual(once.shops.map((s) => [s.id, s.wealth, s.merchantPurse]), shared.shops.map((s) => [s.id, s.wealth, s.merchantPurse]));
  const bad = profile("d4", "docks", { tier: "village" });
  const sharedError = (() => {
    try {
      run(shared, bad);
    } catch (e) {
      return (e as Error).message;
    }
  })();
  assert.equal(await executeLocalCommand(bad).catch((e: Error) => e.message), sharedError);
  // DM only on the device too.
  setSeat({ role: "player", purseIds: ["aria"], shopIds: [], openedAt: 0 });
  assert.match(String(await executeLocalCommand(profile("d5", "uptown", { tier: "village" })).catch((e: Error) => e.message)), /DM/);
  setSeat(DM_SEAT);
});
