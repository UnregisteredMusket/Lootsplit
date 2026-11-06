// Award item details (item-details.ts): charges, attunement and "award unidentified" set when the
// DM creates or awards an item, in that same atomic write. Covers every creation path (encounter
// awards to a character and to the treasure pool, Add loot to a character, a party fund and the
// pool, and an NPC's inventory lot), replay, permissions, device parity, old data, protocol 28
// and the player projection (rooms, ledger, events, chat, award receipts, TV display).
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { applyCommand, tablePatch, type Command } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand, saveHolding } from "./economy.ts";
import { localEncounterRequest } from "../encounters/local.ts";
import { blankEncounter, blankLoot, encounterSchema } from "../encounters/model.mjs";
import { projectRecord } from "./session-records.ts";
import { projectPlayerDisplay, defaultDisplaySettings, type DisplayEncounter } from "./player-display.ts";
import { readWorld } from "./world-schema.ts";
import { hasItemDetails, itemDetailsFor, itemDetailsProblem } from "./item-details.ts";
import { presentedHolding } from "./item-identity.ts";
import { AWARD_DETAILS_PROTOCOL, CURRENT_TABLETOP_PROTOCOL, MARKET_MARKUP_PROTOCOL, tabletopResponse } from "./tabletop-protocol.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import type { Holding, Purse } from "./types.ts";

// Disposable in-memory D1 stand-in with every migration; never a real campaign.
const { localAccountDb } = await import(new URL("../../../scripts/account-dev-db.mjs", import.meta.url).href);
const db = localAccountDb();
(globalThis as { __env__?: unknown }).__env__ = { DB: db };

// The true details: distinctive text and values, so a search of the JSON finds only real leaks.
const STAFF = { name: "Staff of Qorvath the Unseen", notes: "Casts qzx-veil thrice daily.", copper: 765432 };
const SECRETS = [STAFF.name, STAFF.notes, String(STAFF.copper), "Qorvath", "qzx-veil"];
const leaks = (value: unknown) => SECRETS.filter((s) => JSON.stringify(value).includes(s));
const SHOWN = { name: "Gnarled walking stick", description: "Old oak, worn smooth.", value: 300 };
const DETAILS = {
  uses: { current: 5, max: 7, whenEmpty: "keep" as const },
  requiresAttunement: "Requires attunement: by a wizard",
  unidentified: SHOWN,
};

const coins = (c: Partial<Purse["coins"]> = {}) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ gp: 10 }) },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins() },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins() },
    ],
    journal: readJournal({}),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "a", name: "Aria", role: "player", purseIds: ["aria"] };
const bramSeat: CloudSeat = { id: "b", token: "b", name: "Bram", role: "player", purseIds: ["bram", "hoard"] };

function encounter(kind: "direct" | "pool" | "plain") {
  const e = blankEncounter();
  e.name = "Crypt of whispers";
  e.loot = [
    {
      ...blankLoot(),
      id: "staff",
      name: STAFF.name,
      notes: STAFF.notes,
      unitCopper: STAFF.copper,
      quantity: 1,
      ...(kind === "pool" ? { purseId: "", pool: true } : { purseId: "aria" }),
      ...(kind === "plain" ? {} : DETAILS),
    },
    { ...blankLoot(), id: "rope", name: "Hempen rope", quantity: 2, unitCopper: 100, purseId: "bram" },
  ];
  return e;
}
type Award = { award: { receiptId: string }; duplicate: boolean };

async function deviceAward(kind: "direct" | "pool" | "plain") {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const { id } = await localEncounterRequest<{ id: string }>("encounters/create", { id: crypto.randomUUID() });
  await localEncounterRequest("encounters/save", { id, revision: 0, encounter: encounter(kind) });
  await localEncounterRequest("encounters/conclude", { id, revision: 1 });
  const first = await localEncounterRequest<Award>("encounters/award", { id, revision: 2 });
  const retry = await localEncounterRequest<Award>("encounters/award", { id, revision: 2 });
  return { first, retry, table: await economySnapshot() };
}

let users = 0;
async function sharedRoom() {
  const dm = await openRoom({ name: "Award details DM", table: campaign() });
  const aria = { ...(await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" })), code: dm.code };
  const bram = { ...(await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" })), code: dm.code };
  const user = `dm-user-${++users}`;
  await db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)").bind(user, "DM", `${user}@example.com`).run();
  await db.prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)").bind(user, dm.code, dm.seatId, dm.token, "Crypt").run();
  return { dm, aria, bram, user };
}
async function sharedAward(kind: "direct" | "pool" | "plain") {
  const { handleEncounters } = await import(new URL("../../../cloudflare/encounters.mjs", import.meta.url).href);
  const r = await sharedRoom();
  const call = <T,>(path: string, body: Record<string, unknown>, user = r.user) =>
    handleEncounters(db, user, "encounters" + path, body) as Promise<T>;
  const id = crypto.randomUUID();
  await call("/create", { id, code: r.dm.code });
  await call("/save", { id, revision: 0, encounter: encounter(kind) });
  await call("/conclude", { id, revision: 1 });
  const first = await call<Award>("/award", { id, revision: 2 });
  const retry = await call<Award>("/award", { id, revision: 2 });
  return { ...r, id, call, first, retry, table: (await roomState(r.dm)).table };
}
const normal = (t: CloudTable, receiptId: string) =>
  t.holdings
    .map((h) => ({ ...h, id: h.id.replaceAll(receiptId, "R"), ...(h.pool ? { pool: { ...h.pool, at: 0, encounterId: "E", receiptId: "R" } } : {}) }))
    .sort((a, b) => a.id.localeCompare(b.id));

test("the fields are the holding's own: copied when set, validated by the holding rules, absent on old rows", () => {
  assert.deepEqual(itemDetailsFor({}), {});
  assert.equal(hasItemDetails({ name: "Rope" }), false);
  assert.deepEqual(itemDetailsFor({ ...DETAILS, unidentified: { ...SHOWN, ids: ["server-lineage"] } }), DETAILS, "a client never sets lineage IDs");
  assert.equal(itemDetailsProblem("item", DETAILS), null);
  assert.match(itemDetailsProblem("property", DETAILS)!, /Only items/);
  assert.match(itemDetailsProblem("item", { uses: { current: 8, max: 7, whenEmpty: "keep" } })!, /Uses must be whole numbers/);
  assert.match(itemDetailsProblem("item", { requiresAttunement: " " })!, /Attunement text/);
  assert.match(itemDetailsProblem("item", { unidentified: { name: "" } })!, /name players see/);
  // Encounter loot rows: old rows parse unchanged (no new keys); new rows keep the fields.
  const old = encounterSchema.parse(JSON.parse(JSON.stringify(encounter("plain"))));
  assert.deepEqual(Object.keys(old.loot[0]!).filter((k) => ["uses", "requiresAttunement", "unidentified"].includes(k)), []);
  const parsed = encounterSchema.parse(JSON.parse(JSON.stringify(encounter("direct"))));
  assert.deepEqual([parsed.loot[0]!.uses, parsed.loot[0]!.requiresAttunement, parsed.loot[0]!.unidentified], [DETAILS.uses, DETAILS.requiresAttunement, SHOWN]);
  assert.equal(encounterSchema.safeParse({ ...parsed, loot: [{ ...parsed.loot[0], uses: { current: 9, max: 7, whenEmpty: "keep" } }] }).success, false);
});

test("encounter award to a character: one write sets the details; device and shared rooms match; a retry adds nothing", async () => {
  const d = await deviceAward("direct");
  assert.equal(d.retry.duplicate, true);
  const s = await sharedAward("direct");
  assert.equal(s.retry.duplicate, true);
  const device = normal(d.table, d.first.award.receiptId);
  assert.deepEqual(device, normal(s.table, s.first.award.receiptId));
  const staff = device.find((h) => h.name === STAFF.name)!;
  assert.deepEqual([staff.id, staff.purseId, staff.uses, staff.requiresAttunement, staff.unidentified], ["R-item-0", "aria", DETAILS.uses, DETAILS.requiresAttunement, SHOWN]);
  assert.equal(d.table.holdings.length, 2, "the retry created nothing");
  assert.equal(s.table.holdings.length, 2);
  // The rope had no details: exactly the holding it always was.
  const rope = device.find((h) => h.name === "Hempen rope")!;
  assert.deepEqual(Object.keys(rope).sort(), ["id", "kind", "name", "notes", "purseId", "quantity", "unitCopper"]);
});

test("encounter award privacy: room views, ledger, events, chat, receipts and the TV show players only the presented item", async () => {
  for (const kind of ["direct", "pool"] as const) {
    const s = await sharedAward(kind);
    const dmView = await roomState(s.dm);
    assert.ok(leaks(dmView.table.holdings).length, "the DM sees the true item");
    for (const seat of [s.aria, s.bram]) {
      const view = await roomState(seat);
      assert.deepEqual(leaks(view), [], `${kind}: player room view`);
      const staff = view.table.holdings.find((h) => h.unidentified);
      if (staff) {
        assert.equal(staff.name, SHOWN.name);
        assert.equal(staff.requiresAttunement, undefined, "the true requirement is never told");
        assert.deepEqual(staff.uses, DETAILS.uses, "charges are what the holder can count");
      }
    }
    // Every ledger line, event and chat note the award wrote names the item as presented.
    const t = dmView.table;
    assert.deepEqual(leaks([t.ledger, t.journal?.events, t.notes]), [], `${kind}: stored award records`);
    // The award receipt (dm_encounter_awards) is read only through the DM's encounter API.
    const { handleEncounters } = await import(new URL("../../../cloudflare/encounters.mjs", import.meta.url).href);
    await db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)").bind(`p-${s.id}`, "P", `p-${s.id.slice(0, 8)}@example.com`).run();
    await db.prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)").bind(`p-${s.id}`, s.dm.code, s.aria.seatId, s.aria.token, "Crypt").run();
    await assert.rejects(handleEncounters(db, `p-${s.id}`, "encounters/detail", { id: s.id }), /not found|Only an active saved campaign DM/);
    // The TV / player display names it as presented.
    const detail = await s.call<{ body: ReturnType<typeof encounter>; status: string; award: { receiptId: string; at: number } }>("/detail", { id: s.id });
    const display = projectPlayerDisplay(
      { purses: [], journal: { world: readWorld({}) } } as unknown as CloudTable,
      { id: s.id, code: s.dm.code, revision: 1, status: detail.status, body: detail.body, award: detail.award } as unknown as DisplayEncounter,
      { ...defaultDisplaySettings, paused: false, encounterId: s.id, showLoot: true },
      s.dm.code,
    );
    assert.ok(display.loot, "the display shows the award");
    assert.deepEqual(leaks(display), [], `${kind}: player display`);
  }
});

test("encounter award to the treasure pool: device and shared match; the pooled lot carries the details", async () => {
  const d = await deviceAward("pool");
  const s = await sharedAward("pool");
  const device = normal(d.table, d.first.award.receiptId);
  assert.deepEqual(device, normal(s.table, s.first.award.receiptId));
  const lot = device.find((h) => h.pool)!;
  assert.deepEqual([lot.purseId, lot.uses, lot.requiresAttunement, lot.unidentified], ["hoard", DETAILS.uses, DETAILS.requiresAttunement, SHOWN]);
});

test("old encounters without the fields award exactly as before on both paths", async () => {
  const d = await deviceAward("plain");
  const s = await sharedAward("plain");
  for (const t of [normal(d.table, d.first.award.receiptId), normal(s.table, s.first.award.receiptId)])
    for (const h of t) assert.equal(hasItemDetails(h), false);
});

// Add loot: one holding save on the device; a shared room receives the same change as one patch.
const NEW = (purseId: string, pool = false): Holding => ({
  id: `added-${purseId}${pool ? "-pool" : ""}`,
  purseId,
  name: STAFF.name,
  kind: "item",
  quantity: 1,
  unitCopper: STAFF.copper,
  notes: STAFF.notes,
  ...itemDetailsFor(DETAILS),
  ...(pool ? { pool: { at: 1, source: "add-loot" as const } } : {}),
});

test("Add loot (character, fund, pool): the device save and the room patch match; players see the presented item only", async () => {
  for (const [purseId, pool] of [["aria", false], ["hoard", false], ["hoard", true]] as const) {
    setSeat(DM_SEAT);
    await applyCloudTable(campaign());
    const before = await economySnapshot();
    await saveHolding(NEW(purseId, pool));
    const after = await economySnapshot();
    const added = after.holdings.find((h) => h.id === NEW(purseId, pool).id)!;
    assert.deepEqual([added.uses, added.requiresAttunement, added.unidentified, !!added.pool], [DETAILS.uses, DETAILS.requiresAttunement, SHOWN, pool]);
    // The event players can read names it as presented; the DM keeps a DM-only record.
    const events = after.journal!.events;
    const shared = events.filter((e) => !e.dmOnly);
    assert.deepEqual(leaks(shared), [], "readable events");
    assert.ok(shared.some((e) => e.summary.includes(SHOWN.name)));
    assert.ok(events.some((e) => e.dmOnly && e.summary.includes(STAFF.name)));
    if (pool) assert.equal(shared.find((e) => e.lootPool)!.lootPool!.name, SHOWN.name);
    // The shared room: this exact change, as the client sends it (one patch, one command ID).
    const r = await sharedRoom();
    await choosePace({ ...r.dm, live: true });
    const patch = { ...tablePatch(before, after), id: `addloot-${purseId}-${pool}` };
    const send = () => submitCommands({ code: r.dm.code, token: r.dm.token, batchId: `b-${patch.id}`, commands: [patch] });
    await send();
    await send(); // a retry of the same action
    const room = (await roomState(r.dm)).table;
    const roomAdded = room.holdings.filter((h) => h.id === added.id);
    assert.equal(roomAdded.length, 1, "replay adds nothing");
    assert.deepEqual(roomAdded[0], added, "the same holding on the device and in the room");
    for (const seat of [r.aria, r.bram]) assert.deepEqual(leaks(await roomState(seat)), [], "player views");
    // A player can't create items this way: the server refuses.
    await choosePace({ ...r.dm, live: true });
    await assert.rejects(
      submitCommands({ code: r.aria.code, token: r.aria.token, batchId: "p-add", commands: [{ ...patch, id: "player-add" }] }),
      /Only the DM/,
    );
  }
});

test("Add loot refuses invalid details on the device, and a non-item can't carry them", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  await assert.rejects(saveHolding({ ...NEW("aria"), uses: { current: 9, max: 7, whenEmpty: "keep" } }), /Uses must be whole numbers/);
  await assert.rejects(saveHolding({ ...NEW("aria"), unidentified: { name: "" } }), /name players see/);
  await assert.rejects(saveHolding({ ...NEW("aria"), kind: "property", uses: undefined, requiresAttunement: undefined }), /Only an item can be unidentified/);
  assert.equal((await economySnapshot()).holdings.length, 0);
  // Without the fields Add loot is the same save as before.
  await saveHolding({ id: "plain", purseId: "aria", name: "Rope", kind: "item", quantity: 1, unitCopper: 100, notes: "" });
  const plain = (await economySnapshot()).holdings[0]!;
  assert.equal(hasItemDetails(plain), false);
  assert.deepEqual((await economySnapshot()).journal!.events.map((e) => e.summary), ["Recorded holding: Rope ×1"]);
});

// An NPC's inventory lot (`npc-item`).
function withNpc(): CloudTable {
  const t: CloudTable = {
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
    }),
  };
  return applyCommand(t, dmSeat, {
    id: "npc-vel",
    kind: "npc-create",
    npc: { id: "npc-vel", name: "Vel the fence", description: "Fence", locationId: "city", visible: true, barterAllowed: true, controllerPurseId: null },
    copper: 0,
    inventory: [],
  } as Command);
}
const npcItem = (id: string, details = true): Command =>
  ({
    id,
    kind: "npc-item",
    npcId: "npc-vel",
    item: { name: STAFF.name, quantity: 1, unitCopper: STAFF.copper, notes: STAFF.notes, ...(details ? DETAILS : {}) },
  }) as Command;

test("npc-item: the lot carries the details in the same command; DM only; device parity; old commands unchanged", async () => {
  const t = applyCommand(withNpc(), dmSeat, npcItem("n1"));
  const lot = t.holdings.find((h) => h.id === "n1-item")!;
  assert.deepEqual([lot.purseId, lot.uses, lot.requiresAttunement, lot.unidentified], ["npc-vel", DETAILS.uses, DETAILS.requiresAttunement, SHOWN]);
  assert.equal(presentedHolding(lot).name, SHOWN.name);
  assert.throws(() => applyCommand(withNpc(), ariaSeat, npcItem("n2")), /Only the DM/);
  const n3 = npcItem("n3") as Extract<Command, { kind: "npc-item" }>;
  assert.throws(() => applyCommand(withNpc(), dmSeat, { ...n3, item: { ...n3.item, uses: { current: 9, max: 7, whenEmpty: "keep" } } } as Command));
  const old = applyCommand(withNpc(), dmSeat, npcItem("n4", false)).holdings.find((h) => h.id === "n4-item")!;
  assert.equal(hasItemDetails(old), false);
  // Players' projections of the NPC's stock are presented.
  for (const seat of [ariaSeat, bramSeat]) assert.deepEqual(leaks(projectRecord(t, seat, { directory: true })), []);
  // The device runs the same command once.
  setSeat(DM_SEAT);
  await applyCloudTable(withNpc());
  await executeLocalCommand(npcItem("n1"));
  await executeLocalCommand(npcItem("n1"));
  const local = (await economySnapshot()).holdings.filter((h) => h.purseId === "npc-vel");
  assert.deepEqual(local, [lot]);
});

test("protocol 28: older apps finish npc-item drafts with details on the website; other drafts are unchanged", () => {
  assert.equal(AWARD_DETAILS_PROTOCOL, 28);
  assert.ok(CURRENT_TABLETOP_PROTOCOL >= AWARD_DETAILS_PROTOCOL);
  const table = projectRecord(withNpc(), dmSeat);
  const withDetails = JSON.stringify([npcItem("d1")]);
  const without = JSON.stringify([npcItem("d2", false)]);
  for (const protocol of [0, 24, MARKET_MARKUP_PROTOCOL])
    assert.throws(() => tabletopResponse({ table, draft: withDetails }, protocol), /updated Lootsplitter client/);
  assert.equal(tabletopResponse({ table, draft: withDetails }, AWARD_DETAILS_PROTOCOL).table, table);
  assert.equal(tabletopResponse({ table, draft: without }, MARKET_MARKUP_PROTOCOL).table, table);
});

test("a shared room refuses invalid details in a DM's Add loot patch, as the device does", async () => {
  setSeat(DM_SEAT);
  const r = await sharedRoom();
  await choosePace({ ...r.dm, live: true });
  const before = campaign();
  for (const [bad, error] of [
    [{ ...NEW("aria"), id: "bad-uses", uses: { current: 9, max: 7, whenEmpty: "keep" as const } }, /./],
    [{ ...NEW("aria"), id: "bad-kind", kind: "property" as const, uses: undefined, requiresAttunement: undefined }, /Only an item can be unidentified/],
  ] as const) {
    const patch = { ...tablePatch(before, { ...before, holdings: [bad as Holding] }), id: `bad-${bad.id}` };
    await assert.rejects(
      submitCommands({ code: r.dm.code, token: r.dm.token, batchId: `b-${patch.id}`, commands: [patch] }),
      error,
    );
    await assert.rejects(saveHolding(bad as Holding), error);
  }
  assert.equal((await roomState(r.dm)).table.holdings.length, 0, "nothing was created");
});
