import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { ensureCityExchanges } from "./city-exchanges.ts";
import { applyCommand, tablePatch, type CommandInput } from "./commands.ts";
import { emptyCloudTable, readCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal, readArchivedSnapshot } from "./journal.ts";
import { marketNameFingerprint } from "./market-name-import.ts";
import { toCopper } from "./money.ts";
import { projectRecord } from "./session-records.ts";
import { exchangeHere, prepareTradeSeason, previewTradeSeason } from "./trade-economy.ts";
import { tradeFixture } from "./test-fixtures/trade-economy.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";

const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = { ...dm, id: "player", role: "player", purseIds: ["a"] };
let seq = 0;
const act = (table: CloudTable, command: CommandInput, seat = dm) =>
  applyCommand(table, seat, { ...command, id: `city-test-${++seq}` });
const exchanges = (t: CloudTable) => t.journal!.tradeEconomy!.exchanges;
const city = { id: "new-city", kind: "city" as const, parentId: "coast", name: "New Port", description: "" };

test("defaults cover every city, retain existing closed/private exchanges and add no wealth, stock or rules", () => {
  const t = tradeFixture(), before = structuredClone(t);
  exchanges(t)[0].open = false; exchanges(t)[0].visible = false;
  t.journal!.market!.locations.push(city, { ...city, id: "town", kind: "town" });
  const existing = structuredClone(exchanges(t)[0]);
  ensureCityExchanges(t);
  assert.deepEqual(exchanges(t)[0], existing);
  assert.equal(exchanges(t).length, 2);
  const e = exchanges(t)[1];
  assert.equal(e.locationId, city.id); assert.equal(e.name, "New Port Trade Exchange");
  assert.deepEqual(e.offers, []);
  assert.deepEqual(t.purses.slice(0, before.purses.length), before.purses);
  assert.equal(toCopper(t.purses.at(-1)!.coins), 0);
  assert.equal(t.purses.at(-1)!.nonParty, true); assert.equal(t.purses.at(-1)!.control, "npc");
  for (const field of ["holdings", "stock", "ledger", "realm", "listings", "loans"] as const)
    assert.deepEqual(t[field], before[field]);
  assert.deepEqual(t.journal!.tradeEconomy!.settings, before.journal!.tradeEconomy!.settings);
  const once = structuredClone(t); ensureCityExchanges(t); assert.deepEqual(t, once);
});

test("new and imported cities receive one exchange; repeats and renames preserve DM configuration", () => {
  let t = act(tradeFixture(), { kind: "market-location", locationId: city.id, before: null, after: city });
  const e = exchanges(t).find(e => e.locationId === city.id)!;
  t = act(t, { kind: "trade-exchange", before: e, exchange: { ...e, name: "Guild Hall", open: false, visible: false, notes: "DM choice" }, reason: "Configure" });
  t = act(t, { kind: "market-location", locationId: city.id, before: city, after: { ...city, name: "Renamed Port" } });
  assert.equal(exchanges(t).filter(e => e.locationId === city.id).length, 1);
  assert.equal(exchanges(t).find(x => x.id === e.id)!.name, "Guild Hall");
  const rows = [
    { kind: "city" as const, name: "Imported City", parentId: "coast", path: [] },
    { kind: "town" as const, name: "Imported Town", parentId: "coast", path: [] },
  ];
  for (let i = 0; i < 2; i++) t = act(t, { kind: "market-name-import", before: marketNameFingerprint(t.journal!.market!, t.shops), rows });
  const imported = t.journal!.market!.locations.find(l => l.name === "Imported City")!;
  assert.equal(exchanges(t).filter(e => e.locationId === imported.id).length, 1);
  assert.equal(exchanges(t).length, 3);
  assert.throws(() => act(t, { kind: "market-location", locationId: "forbidden", before: null, after: { ...city, id: "forbidden" } }, player), /DM|dungeon master/i);
});

test("large legacy city lists and colliding account IDs remain valid without truncation or balance reuse", () => {
  const t = emptyCloudTable();
  t.journal = readJournal({ market: { currentLocationId: null, locations: [
    { id: "coast", kind: "region", parentId: null, name: "Coast", description: "" },
    ...Array.from({ length: 201 }, (_, i) => ({ ...city, id: `city-${i}-${"x".repeat(100)}`, name: `Port ${i}` })),
  ] } });
  ensureCityExchanges(t); assert.equal(exchanges(t).length, 201); assert.ok(readCloudTable(t));
  const legacy = tradeFixture(); legacy.journal!.market!.locations.push(city);
  const normalized = ensureCityExchanges(structuredClone(legacy)), e = exchanges(normalized).at(-1)!;
  legacy.purses.push({ ...legacy.purses[0], id: e.purseId });
  ensureCityExchanges(legacy);
  assert.notEqual(exchanges(legacy).at(-1)!.purseId, e.purseId);
  assert.equal(toCopper(legacy.purses.find(p => p.id === e.purseId)!.coins), 100000);
});

test("unused defaults can leave with an unused city; configured and funded exchanges are protected atomically", () => {
  const original = act(tradeFixture(), { kind: "market-location", locationId: city.id, before: null, after: city });
  const e = exchanges(original).at(-1)!;
  const renamedCity = { ...city, name: "Renamed Port" };
  const renamed = act(original, { kind: "market-location", locationId: city.id, before: city, after: renamedCity });
  assert.equal(exchanges(renamed).at(-1)!.name, "Renamed Port Trade Exchange");
  assert.equal(exchanges(renamed).at(-1)!.id, e.id);
  assert.equal(exchanges(act(renamed, { kind: "market-location", locationId: city.id, before: renamedCity, after: null })).length, 1);
  const removed = act(original, { kind: "market-location", locationId: city.id, before: city, after: null });
  assert.equal(exchanges(removed).some(x => x.id === e.id), false);
  assert.equal(removed.purses.some(p => p.id === e.purseId), false);
  for (const configure of [
    (t: CloudTable) => { exchanges(t).at(-1)!.notes = "Keep this"; },
    (t: CloudTable) => { t.purses.find(p => p.id === e.purseId)!.coins.cp = 1; },
    (t: CloudTable) => { prepareTradeSeason(t, { source: "server", random: () => 50 }); t.journal!.tradeEconomy!.pendingSeason = previewTradeSeason(t, "pending", 1); },
  ]) {
    const t = structuredClone(original); configure(t); const before = structuredClone(t);
    assert.throws(() => act(t, { kind: "market-location", locationId: city.id, before: city, after: null }), /location is missing/);
    assert.deepEqual(t, before);
  }
});

test("canonical defaults obey city presence and privacy; projected readers and immutable archives add nothing", () => {
  const legacy = tradeFixture(); legacy.journal!.market!.locations.push(city);
  const t = ensureCityExchanges(structuredClone(legacy)), e = exchanges(t).at(-1)!;
  assert.equal(exchangeHere(t, e), false);
  assert.equal(exchanges(projectRecord(t, player)).some(x => x.id === e.id), false);
  t.journal!.market!.currentLocationId = city.id;
  assert.equal(exchangeHere(t, e), true);
  const projected = projectRecord(t, player), read = readCloudTable(projected)!;
  assert.deepEqual(read.purses, projected.purses); assert.deepEqual(exchanges(read), exchanges(projected));
  assert.deepEqual(readArchivedSnapshot(JSON.stringify(legacy)), { ...legacy, handouts: [] });
});

test("local legacy recovery exposes defaults to the DM, saves them atomically once, and retains old patch baselines", async () => {
  setSeat(DM_SEAT);
  const legacy = tradeFixture(); legacy.journal!.market!.locations.push(city);
  await applyCloudTable(legacy);
  const shown = await economySnapshot(), e = exchanges(shown).at(-1)!;
  assert.equal(e.locationId, city.id);
  await executeLocalCommand({ kind: "trade-exchange", before: e, exchange: { ...e, notes: "Saved locally" }, reason: "Configure" });
  const saved = await economySnapshot(); assert.equal(exchanges(saved).at(-1)!.notes, "Saved locally");
  await applyCloudTable(saved); assert.deepEqual(await economySnapshot(), saved);
  const changed = structuredClone(legacy); changed.purses[0].name = "Renamed hero";
  changed.journal!.market!.locations.push({ ...city, id: "patch-city", name: "Patch City" });
  const patched = act(legacy, tablePatch(legacy, changed));
  assert.equal(patched.purses.find(p => p.id === legacy.purses[0].id)!.name, "Renamed hero"); assert.equal(exchanges(patched).length, 3);
  setSeat({ ...DM_SEAT, role: "player", purseIds: ["a"] });
  await applyCloudTable(projectRecord(saved, player));
  assert.equal(exchanges(await economySnapshot()).some(x => x.id === e.id), false);
  setSeat(DM_SEAT);
});
