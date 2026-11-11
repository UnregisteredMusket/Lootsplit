// Hidden activity lines (audit 2026-11-10, B1; owner decision (a), 2026-11-11): a player never
// receives an activity line that names a shop, stock line, place or listing the same player's
// projection does not hold. The DM keeps every line; players keep the lines about what they can
// see. Shared rooms (protocols 11 and 33), the archived session, the CSV export and the device
// engine. Disposable in-memory campaigns only; never a real campaign.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace, closeRoom } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand } from "./commands.ts";
import { readJournal, preserveJournalMetadata } from "./journal.ts";
import { fromCopper } from "./money.ts";
import { applyCloudTable, economySnapshot, saveShop, saveStock, executeLocalCommand } from "./economy.ts";
import { projectArchivedReport, projectRecord, archiveSession } from "./session-records.ts";
import { ledgerExportRows } from "./ledger-export.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { readWorld } from "./world-schema.ts";
import type { Shop, StockLine } from "./types.ts";

const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0012_campaign_room_images.sql", "0019_campaign_room_reports.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql", "0029_campaign_room_report_parts.sql", "0030_campaign_room_archive_keys.sql", "0003_accounts.sql", "0008_encounters.sql"])
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

const dmSeat: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "aria-seat", token: "a", name: "Aria", role: "player", purseIds: ["aria"] };
const shop = (id: string, name: string, extra: Partial<Shop> = {}): Shop => ({
  id,
  name,
  keeper: "",
  place: "",
  notes: "",
  sellRate: 1,
  buyRate: 0.5,
  wealth: "average" as Shop["wealth"],
  category: "general" as Shop["category"],
  priceScale: 1,
  ...extra,
});
const line = (id: string, shopId: string, name: string, copper: number): StockLine => ({
  id,
  shopId,
  name,
  copper,
  quantity: 3,
  notes: "",
  baseCopper: copper,
  rarity: "common" as StockLine["rarity"],
});
const schedule = { cycleDays: 7, openDays: [0, 1, 2, 3, 4, 5, 6], restockEveryDays: 0, restockQuantity: 1, lastRestockDay: 0 };

/**
 * The party is in Port. The Night Bazaar is in another city, the Fence is a black-market vendor in
 * Port while the black market is hidden, and the Manor is a listing in the other city. Older
 * saves already hold activity lines without the new subject fields (legacy).
 */
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: fromCopper(100000) },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: fromCopper(5000) },
    ],
    shops: [
      shop("general", "General Store", { locationId: "city" }),
      shop("bazaar", "SECRET Night Bazaar", { locationId: "shadow" }),
      shop("fence", "SECRET Fence", { locationId: "city", blackMarket: true }),
    ],
    stock: [
      line("rope", "general", "Silk rope", 100),
      line("vial", "bazaar", "SECRET Poison Vial", 5000),
      line("lockpick", "fence", "SECRET Lockpicks", 300),
    ],
    listings: [
      { id: "cottage", name: "Harbour Cottage", kind: "property", copper: 50000, quantity: 1, notes: "", locationId: "city" },
      { id: "manor", name: "SECRET Manor", kind: "property", copper: 900000, quantity: 1, notes: "", locationId: "shadow" },
    ],
    journal: readJournal({
      market: {
        currentLocationId: "city",
        locations: [
          { id: "region", name: "Eastmarch", kind: "region", parentId: null, description: "" },
          { id: "city", name: "Port", kind: "city", parentId: "region", description: "" },
          { id: "far", name: "SECRET Far Reach", kind: "region", parentId: null, description: "" },
          { id: "shadow", name: "SECRET Shadow City", kind: "city", parentId: "far", description: "" },
        ],
      },
      finance: { day: 0, loans: [], rules: [], downtime: [] },
      sessions: [{ id: "session", name: "Adventure", startedAt: 1 }],
      events: [
        // Legacy lines written before subject fields existed (older server and device builds).
        { id: "legacy-shop", at: 2, kind: "management", summary: "Shop updated: SECRET Old Den" },
        { id: "legacy-place", at: 3, kind: "management", summary: "Location saved: SECRET Old Crypt" },
        { id: "legacy-restock", at: 4, kind: "management", summary: "Restocked SECRET Night Bazaar: +2 per finite stock line" },
        { id: "legacy-schedule", at: 5, kind: "management", summary: "Shop schedule updated: SECRET Night Bazaar" },
        { id: "legacy-shop-image", at: 6, kind: "management", summary: "Shop location and image saved: SECRET Night Bazaar" },
        { id: "legacy-listing", at: 7, kind: "management", summary: "Listing saved: SECRET Manor" },
        { id: "legacy-catalog", at: 8, kind: "management", summary: "Added 4 catalog items to SECRET Night Bazaar; existing stock preserved" },
        { id: "legacy-device-shop", at: 9, kind: "management", summary: "Updated shop: SECRET Night Bazaar (open)", change: { entity: "shop", entityId: "bazaar", before: null, after: { name: "SECRET Night Bazaar" } } },
        { id: "legacy-price", at: 10, kind: "prices", summary: "SECRET Poison Vial: 4000 cp → 5000 cp", change: { entity: "stock", entityId: "vial", before: { copper: 4000 }, after: { copper: 5000 } } },
        { id: "legacy-price-gone", at: 11, kind: "prices", summary: "SECRET Removed Line: 1 cp → 2 cp", change: { entity: "stock", entityId: "no-such-line", before: { copper: 1 }, after: { copper: 2 } } },
        // Legacy lines about what the player can see stay readable.
        { id: "legacy-visible-price", at: 12, kind: "prices", summary: "Silk rope: 90 cp → 100 cp", change: { entity: "stock", entityId: "rope", before: { copper: 90 }, after: { copper: 100 } } },
        { id: "legacy-visible-device-shop", at: 13, kind: "management", summary: "Updated shop: General Store (open)", change: { entity: "shop", entityId: "general", before: null, after: { name: "General Store" } } },
        { id: "legacy-party", at: 14, kind: "management", summary: "Party location: Port" },
        { id: "legacy-session", at: 15, kind: "session", summary: "Started session: Adventure" },
      ],
    }),
  };
}

let n = 0;
/** The DM's ordinary edits of every record, hidden ones first, as a shared room receives them. */
function edits(t: CloudTable) {
  const row = <T extends { id: string }>(rows: T[], id: string) => rows.find((r) => r.id === id)!;
  const commands: any[] = [];
  for (const id of ["bazaar", "fence", "general"]) {
    const before = row(t.shops, id);
    commands.push({ kind: "patch", changes: [{ store: "shops", id, before, after: { ...before, notes: "Restocked weekly" } }] });
  }
  for (const [id, copper] of [["vial", 7500], ["lockpick", 450], ["rope", 120]] as const) {
    const before = row(t.stock, id);
    commands.push({ kind: "patch", changes: [{ store: "stock", id, before, after: { ...before, copper } }] });
  }
  for (const id of ["bazaar", "fence", "general"]) {
    commands.push({ kind: "restock", shopId: id, quantity: 2 });
    commands.push({ kind: "shop-schedule", shopId: id, schedule });
    const s = row(t.shops, id);
    commands.push({ kind: "shop-location", shopId: id, before: { locationId: s.locationId ?? null, image: null }, locationId: s.locationId ?? null, image: null });
  }
  commands.push({ kind: "market-location", locationId: "lair", before: null, after: { id: "lair", name: "SECRET Lich Lair", kind: "area", parentId: "shadow", description: "" } });
  const port = t.journal!.market!.locations.find((l) => l.id === "city")!;
  commands.push({ kind: "market-location", locationId: "city", before: port, after: { ...port, description: "A busy harbour" } });
  for (const id of ["manor", "cottage"]) {
    const before = row(t.listings, id);
    commands.push({ kind: "listing-edit", listingId: id, before, after: { ...before, notes: "For sale" } });
  }
  return commands.map((c) => ({ ...c, id: `hidden-activity-${++n}` }));
}

/** What a player must still read: the lines about the General Store, its rope, Port and the cottage. */
const VISIBLE = [/Shop updated: General Store/, /Silk rope: 100 cp → 120 cp/, /Restocked General Store/, /Shop schedule updated: General Store/, /Shop location and image saved: General Store/, /Location saved: Port/, /Listing saved: Harbour Cottage/];
const LEGACY_VISIBLE = ["legacy-visible-price", "legacy-visible-device-shop", "legacy-party", "legacy-session"];

function assertPlayerEvents(events: { id: string; summary: string }[], label: string, legacy = true) {
  const text = events.map((e) => e.summary).join("\n");
  assert.doesNotMatch(text, /SECRET/, label);
  for (const pattern of VISIBLE) assert.match(text, pattern, `${label}: ${pattern}`);
  if (legacy) for (const id of LEGACY_VISIBLE) assert.ok(events.some((e) => e.id === id), `${label}: ${id}`);
}

test("B1: a player's room never receives an activity line naming a hidden shop, stock line, place or listing (protocols 11 and 33)", async () => {
  const dm = await openRoom({ name: "Hidden activity", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  await choosePace({ ...dm, live: true });
  const commands = edits((await roomState(dm)).table);
  for (const command of commands) await submitCommands({ ...dm, batchId: command.id, commands: [command] });
  const host = (await roomState(dm)).table;
  // The DM keeps every line, hidden records included.
  const dmText = host.journal!.events.map((e) => e.summary).join("\n");
  for (const name of ["SECRET Night Bazaar", "SECRET Poison Vial: 5000 cp → 7500 cp", "SECRET Fence", "Location saved: SECRET Lich Lair", "Listing saved: SECRET Manor", "SECRET Old Den"])
    assert.ok(dmText.includes(name), name);
  for (const tabletopProtocol of [11, 33]) {
    const player = await roomState({ ...aria, code: dm.code, tabletopProtocol });
    // The rest of the projection already hides these records; the activity lines must too.
    assert.doesNotMatch(JSON.stringify(player.table.shops), /SECRET/);
    assertPlayerEvents(player.table.journal!.events, `protocol ${tabletopProtocol}`);
    assert.doesNotMatch(JSON.stringify(player), /SECRET/, `whole view, protocol ${tabletopProtocol}`);
  }
  // The archived session and the CSV export follow the same rule.
  await closeRoom({ ...dm, keepOnline: true });
  const archived = (await roomState(dm)).table;
  const report = archived.journal!.reports!.at(-1)!;
  const projected = projectArchivedReport(report, archived, ariaSeat);
  assertPlayerEvents(JSON.parse(projected.snapshot).journal.events, "archived session");
  const csv = ledgerExportRows(archived, { id: aria.seatId, role: "player", purseIds: ["aria"] }).filter((r) => r.record === "event");
  assertPlayerEvents(csv.map((r) => ({ id: r.id, summary: r.summary })), "CSV export");
  const player = await roomState({ ...aria, code: dm.code, tabletopProtocol: 33 });
  assert.doesNotMatch(JSON.stringify(player), /SECRET/, "view-only room after the session");
});

test("B1: a record the player comes to see brings its lines with it; projecting twice keeps them", () => {
  let t = campaign();
  for (const command of edits(t)) t = applyCommand(t, dmSeat, command);
  const before = projectRecord(t, ariaSeat, { directory: true });
  assert.doesNotMatch(before.journal!.events.map((e) => e.summary).join("\n"), /SECRET/);
  // A player device projects the room's (already projected) table again: nothing visible is lost.
  const again = projectRecord(before, ariaSeat, { directory: true });
  assert.deepEqual(again.journal!.events.map((e) => e.id), before.journal!.events.map((e) => e.id));
  // The party travels to the Shadow City: the Night Bazaar, its vial and the Manor are visible now.
  t.journal!.market!.currentLocationId = "shadow";
  const there = projectRecord(t, ariaSeat, { directory: true }).journal!.events.map((e) => e.summary).join("\n");
  assert.match(there, /Shop updated: SECRET Night Bazaar/);
  assert.match(there, /SECRET Poison Vial: 5000 cp → 7500 cp/);
  assert.match(there, /Listing saved: SECRET Manor/);
  // The Fence stays hidden while the black market is; the DM's switch reveals its lines.
  assert.doesNotMatch(there, /SECRET Fence|SECRET Lockpicks/);
  t.journal!.market!.currentLocationId = "city";
  t.journal!.world = { ...readWorld(t.journal!.world), blackMarketActive: true };
  const open = projectRecord(t, ariaSeat, { directory: true }).journal!.events.map((e) => e.summary).join("\n");
  assert.match(open, /Shop updated: SECRET Fence/);
  assert.match(open, /SECRET Lockpicks: 300 cp → 450 cp/);
});

test("B1: an older client's whole-journal write keeps each line's subject", () => {
  let t = campaign();
  for (const command of edits(t)) t = applyCommand(t, dmSeat, command);
  const journal = readJournal(t.journal);
  // An older DM app drops fields it does not know when it writes the journal back.
  const old = {
    ...journal,
    events: journal.events.map(({ shopId: _s, locationId: _l, listingId: _g, npcId: _n, ...e }: any) => e),
  };
  assert.ok(journal.events.some((e: any) => e.shopId) && journal.events.some((e: any) => e.locationId) && journal.events.some((e: any) => e.listingId));
  const kept = preserveJournalMetadata(old, journal);
  assert.deepEqual(kept.events, journal.events);
});

test("B1 archive: archiving keeps the subjects, so the archived session hides the same lines", () => {
  let t = campaign();
  for (const command of edits(t)) t = applyCommand(t, dmSeat, command);
  const report = archiveSession(t, "s1", "Session 1", 100);
  assertPlayerEvents(JSON.parse(projectArchivedReport(report, t, ariaSeat).snapshot).journal.events, "archive");
});

test("B1 device parity: the device's own shop, price and place lines carry the same subjects as the room's", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const bazaar = (await economySnapshot()).shops.find((s) => s.id === "bazaar")!;
  await saveShop({ ...bazaar, notes: "Device edit" });
  const vial = (await economySnapshot()).stock.find((s) => s.id === "vial")!;
  await saveStock({ ...vial, copper: 9000 });
  const general = (await economySnapshot()).shops.find((s) => s.id === "general")!;
  await saveShop({ ...general, notes: "Device edit" });
  for (const command of edits(await economySnapshot())) await executeLocalCommand(command);
  const device = await economySnapshot();
  const player = projectRecord(device, ariaSeat, { directory: true });
  const text = player.journal!.events.map((e) => e.summary).join("\n");
  assert.doesNotMatch(text, /SECRET/);
  assert.match(text, /Updated shop: General Store/);
  for (const pattern of VISIBLE) assert.match(text, pattern);
  // The device keeps every line for the DM.
  assert.match(device.journal!.events.map((e) => e.summary).join("\n"), /SECRET Poison Vial: 5000 cp → 9000 cp/);
});
