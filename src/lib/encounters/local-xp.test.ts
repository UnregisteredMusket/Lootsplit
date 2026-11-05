// XP from encounters: the suggestion from the enemies' XP or CR, the xp-award split rule with its
// remainder, the DM's overrides, exactly-once awards (retry, replay, "Award XP" later), server
// permissions, shared/device parity, old encounters, milestone parties and the player projection.
import "../quire/commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { readStoredRoom } from "../../../cloudflare/room-storage.mjs";
import { localEncounterRequest, readLocalEncounters } from "./local.ts";
import { blankCombatant, blankEncounter } from "./model.mjs";
import { applyCloudTable, economySnapshot } from "../quire/economy.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "../quire/cloud.ts";
import { applyCommand, commandSchema } from "../quire/commands.ts";
import { readJournal } from "../quire/journal.ts";
import { DM_SEAT, setSeat } from "../quire/table.ts";
import { blankSheet } from "../characters/model.mjs";
import type { Purse } from "../quire/types.ts";
import type { CharacterSheet } from "../quire/sheet.ts";
import {
  CR_XP,
  applyEncounterXp,
  campaignXpMode,
  encounterXpShares,
  suggestEncounterXp,
  xpForCr,
  type EncounterXpInput,
} from "../quire/encounter-xp.ts";

const coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
const sheet = (name: string, level: number, extra: object = {}) => ({ ...blankSheet(), name, level, ...extra });
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
function campaign(milestones = false): CloudTable {
  const track = (xp: number) => (milestones ? { milestoneLevel: 2 } : { xp });
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins },
      { id: "aria", name: "Aria Thorne", kind: "character", coins, sheet: sheet("Aria Thorne", 2, track(600)) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins, sheet: sheet("Bram Ironfoot", 2, track(300)) },
      // No play sheet: only an imported 2014 sheet (its Experience box is the XP start).
      { id: "cyd", name: "Cyd", kind: "character", coins },
      { id: "vex", name: "Vex", kind: "character", control: "npc", coins, sheet: sheet("Vex", 4) },
    ] as Purse[],
    sheets: [
      {
        purseId: "cyd", edition: "2014", importedAt: 1, name: "Cyd", classLevel: "Rogue 2",
        experience: milestones ? "" : "1,000",
      } as unknown as CharacterSheet,
    ],
    journal: readJournal({}),
  };
}
function enemy(name: string, cr: number, xp: number, side: "enemy" | "ally" = "enemy") {
  return { ...blankCombatant(), id: crypto.randomUUID(), name, cr, xp, side };
}
function draft() {
  const e = blankEncounter();
  e.name = "Goblin ambush";
  e.combatants = [
    enemy("Goblin", 0.25, 50),
    enemy("Ogre", 2, 0), // no XP value: its CR 2 gives 450
    enemy("Custom", 0, 0), // nothing to go on: 0, the DM can raise the total
    enemy("Friendly guard", 1, 200, "ally"), // allies give no XP
  ];
  e.coins = { ...coins, gp: 3 };
  e.coinPurseId = "hoard";
  return e;
}
const SPLIT: EncounterXpInput = { unit: "xp", purseIds: ["aria", "bram", "cyd"], total: 500 };
const xpOf = (t: CloudTable, id: string) => t.purses.find((p) => p.id === id)!.sheet?.xp;
const sheetsOf = (t: CloudTable) =>
  [...t.purses]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => ({ id: p.id, xp: p.sheet?.xp, milestone: p.sheet?.milestoneLevel, level: p.sheet?.level }));
const xpEvents = (t: CloudTable) =>
  t.journal!.events.filter((e) => /^(XP|Milestone) award/.test(e.summary)).map((e) => ({ summary: e.summary, dmOnly: e.dmOnly }));

test("the suggestion: each enemy's XP, else its CR from the SRD 5.2.1 table; allies give none", () => {
  assert.equal(CR_XP.length, 34);
  assert.deepEqual([xpForCr(0), xpForCr(0.125), xpForCr(0.5), xpForCr(5), xpForCr(30), xpForCr(1.5)], [0, 25, 100, 1800, 155000, null]);
  const s = suggestEncounterXp(draft().combatants);
  assert.equal(s.total, 500);
  assert.deepEqual(s.rows.map((r) => [r.name, r.xp, r.from]), [["Goblin", 50, "xp"], ["Ogre", 450, "cr"], ["Custom", 0, "none"]]);
  assert.equal(suggestEncounterXp([]).total, 0);
  assert.equal(suggestEncounterXp(Array.from({ length: 30 }, () => enemy("Tarrasque", 30, 155000))).total, 1_000_000, "capped at the largest award");
});

test("split: floor each, the remainder unawarded unless the DM picks who; the DM can override", () => {
  assert.deepEqual(encounterXpShares(SPLIT), {
    shares: [{ purseId: "aria", gain: 166 }, { purseId: "bram", gain: 166 }, { purseId: "cyd", gain: 166 }],
    remainder: 2,
    remainderTo: null,
  });
  assert.deepEqual(encounterXpShares({ ...SPLIT, remainderTo: "bram" }).shares.map((s) => s.gain), [166, 168, 166]);
  assert.deepEqual(encounterXpShares({ ...SPLIT, total: 900 }).shares.map((s) => s.gain), [300, 300, 300], "overridden total");
  assert.deepEqual(encounterXpShares({ ...SPLIT, shares: [100, 400, 0] }).shares.map((s) => s.gain), [100, 400, 0], "own shares");
  assert.throws(() => encounterXpShares({ ...SPLIT, shares: [100, 100, 100] }), /add up/);
  assert.throws(() => encounterXpShares({ ...SPLIT, shares: [500] }), /each chosen/);
  assert.throws(() => encounterXpShares({ ...SPLIT, total: 2 }), /too small/);
  assert.throws(() => encounterXpShares({ ...SPLIT, remainderTo: "vex" }), /remainder/);
  // The same sheets and journal entry as the xp-award command for the same split.
  const t = campaign();
  applyEncounterXp(t, dmSeat, { ...SPLIT, remainderTo: "aria" }, { id: "R-xp", at: 1, reason: "Goblin ambush" });
  const command = applyCommand(campaign(), dmSeat, commandSchema.parse({
    id: "c1", kind: "xp-award", unit: "xp", rule: "split", amount: 500, purseIds: ["aria", "bram", "cyd"], remainderTo: "aria", reason: "Goblin ambush",
  }));
  assert.deepEqual(sheetsOf(t), sheetsOf(command));
  assert.deepEqual(xpEvents(t), xpEvents(command));
  assert.equal(xpEvents(t)[0]!.summary, "XP award (Goblin ambush): 500 XP split among 3: Aria Thorne 168, Bram Ironfoot 166 and Cyd 166");
  assert.equal(xpOf(t, "cyd"), 1166, "the imported Experience box is the start");
  // Own shares: one entry, the shares as given; a zero share changes nothing for that character.
  const own = campaign();
  applyEncounterXp(own, dmSeat, { ...SPLIT, shares: [100, 400, 0] }, { id: "O-xp", at: 1, reason: "Ogre" });
  assert.deepEqual([xpOf(own, "aria"), xpOf(own, "bram"), xpOf(own, "cyd")], [700, 700, 1000]);
  assert.equal(xpEvents(own)[0]!.summary, "XP award (Ogre): 500 XP split among 3: Aria Thorne 100, Bram Ironfoot 400 and Cyd 0");
  // An NPC recipient makes the entry DM-only, as for xp-award; party funds and players are refused.
  const npc = campaign();
  applyEncounterXp(npc, dmSeat, { unit: "xp", purseIds: ["aria", "vex"], total: 100 }, { id: "N-xp", at: 1, reason: "x" });
  assert.equal(xpEvents(npc)[0]!.dmOnly, true);
  assert.throws(() => applyEncounterXp(campaign(), dmSeat, { unit: "xp", purseIds: ["hoard"], total: 10 }, { id: "H", at: 1, reason: "" }), /party fund/);
  assert.throws(() => applyEncounterXp(campaign(), { role: "player" }, SPLIT, { id: "P", at: 1, reason: "" }), /Only the DM/);
});

test("milestone parties: the award marks a milestone and never gives XP", () => {
  assert.equal(campaignXpMode(campaign()), "xp");
  assert.equal(campaignXpMode(campaign(true)), "milestone");
  assert.equal(campaignXpMode({ ...emptyCloudTable(), purses: [] }), "xp", "a new party defaults to XP");
  const t = campaign(true);
  assert.throws(() => applyEncounterXp(t, dmSeat, SPLIT, { id: "M", at: 1, reason: "" }), /milestones/);
  assert.equal(xpOf(t, "aria"), undefined, "nothing changed");
  applyEncounterXp(t, dmSeat, { unit: "milestone", purseIds: ["aria", "bram"] }, { id: "M2", at: 1, reason: "Goblin ambush" });
  assert.deepEqual(sheetsOf(t).filter((s) => s.id === "aria" || s.id === "bram").map((s) => [s.milestone, s.xp]), [[3, undefined], [3, undefined]]);
  assert.equal(xpEvents(t)[0]!.summary, "Milestone award (Goblin ambush): a milestone to Aria Thorne and Bram Ironfoot");
});

type Award = { award: { receiptId: string; xp?: { id: string; total: number; shares: { purseId: string; gain: number }[] } }; duplicate: boolean };
type Db = any;

async function sharedFixture(milestones = false) {
  const { handleEncounters } = await import(new URL("../../../cloudflare/encounters.mjs", import.meta.url).href);
  const { localAccountDb } = await import(new URL("../../../scripts/account-dev-db.mjs", import.meta.url).href);
  const db: Db = localAccountDb();
  (globalThis as any).__env__ = { DB: db };
  const { openRoom, joinRoom, choosePace, roomState } = await import("../quire/cloud.server.ts");
  for (const u of ["dm", "player"])
    await db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)").bind(u, u, `${u}@example.com`).run();
  const room = await openRoom({ name: "XP DM", table: campaign(milestones) });
  const bram = await joinRoom({ code: room.code, purseId: "bram", name: "Bram" });
  await choosePace({ code: room.code, token: room.token, live: true });
  const stored = (await readStoredRoom(db, room.code))!.room;
  const dmRow = stored.seats.find((s: CloudSeat) => s.role === "dm")!;
  const bramRow = stored.seats.find((s: CloudSeat) => s.token === bram.token)!;
  await db.prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)").bind("dm", room.code, dmRow.id, dmRow.token, "XP").run();
  await db.prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)").bind("player", room.code, bramRow.id, bramRow.token, "XP").run();
  const call = <T,>(user: string, path: string, body: Record<string, unknown>) =>
    handleEncounters(db, user, "encounters" + path, body) as Promise<T>;
  const id = crypto.randomUUID();
  await call("dm", "/create", { id, code: room.code });
  await call("dm", "/save", { id, revision: 0, encounter: draft() });
  await call("dm", "/conclude", { id, revision: 1 });
  const table = async () => (await readStoredRoom(db, room.code))!.room.table as CloudTable;
  const bramView = async () => (await roomState({ code: room.code, token: bram.token })).table;
  return { db, call, id, table, bramView, code: room.code };
}
async function deviceFixture(milestones = false) {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign(milestones));
  const { id } = await localEncounterRequest<{ id: string }>("encounters/create", { id: crypto.randomUUID() });
  await localEncounterRequest("encounters/save", { id, revision: 0, encounter: draft() });
  await localEncounterRequest("encounters/conclude", { id, revision: 1 });
  return { id, call: <T,>(path: string, body: Record<string, unknown>) => localEncounterRequest<T>("encounters" + path, { id, ...body }) };
}

test("shared and device awards give the same XP once, with the loot, across retries and replays", async () => {
  const xp = { ...SPLIT, remainderTo: "cyd" };
  const s = await sharedFixture();
  // A player can't award (server-side): their seat is not the DM's, and the encounter isn't theirs.
  await assert.rejects(s.call("player", "/award", { id: s.id, revision: 2, xp }), /not found/i);
  await assert.rejects(s.call("player", "/award-xp", { id: s.id, xp }), /not found/i);
  const first = await s.call<Award>("dm", "/award", { id: s.id, revision: 2, xp });
  const retry = await s.call<Award>("dm", "/award", { id: s.id, revision: 2, xp });
  const later = await s.call<Award>("dm", "/award-xp", { id: s.id, xp });
  assert.equal(retry.duplicate, true);
  assert.equal(later.duplicate, true, "Award XP after an award with XP gives nothing more");
  assert.deepEqual(first.award.xp!.shares.map((x) => x.gain), [166, 166, 168]);
  const shared = await s.table();
  assert.deepEqual([xpOf(shared, "aria"), xpOf(shared, "bram"), xpOf(shared, "cyd")], [766, 466, 1168]);
  assert.equal(xpEvents(shared).length, 1);
  assert.equal(shared.purses.find((p) => p.id === "hoard")!.coins.gp, 3, "the loot moved in the same award");
  // The player's projection: the same entry as xp-award, his own XP, never another player's sheet.
  const view = await s.bramView();
  assert.deepEqual(xpEvents(view), xpEvents(shared));
  assert.equal(view.purses.find((p) => p.id === "bram")!.sheet!.xp, 466);
  assert.equal(view.purses.find((p) => p.id === "aria")?.sheet, undefined);
  s.db.close();

  const d = await deviceFixture();
  const dFirst = await d.call<Award>("/award", { revision: 2, xp });
  const dRetry = await d.call<Award>("/award", { revision: 2, xp });
  const dLater = await d.call<Award>("/award-xp", { xp });
  assert.equal(dRetry.duplicate, true);
  assert.equal(dLater.duplicate, true);
  const device = await economySnapshot();
  assert.deepEqual(sheetsOf(device), sheetsOf(shared));
  assert.deepEqual(xpEvents(device), xpEvents(shared));
  assert.deepEqual(dFirst.award.xp!.shares, first.award.xp!.shares);
  assert.equal(dFirst.award.xp!.id, `${dFirst.award.receiptId}-xp`);
  // A player link on this device can't award.
  setSeat({ ...DM_SEAT, role: "player", purseIds: ["bram"] } as never);
  await assert.rejects(d.call("/award-xp", { xp }), /Only the DM/);
  setSeat(DM_SEAT);
});

test("an invalid XP choice refuses the whole award: no coins, no XP, still in review", async () => {
  const bad = { unit: "xp", purseIds: ["hoard"], total: 100 };
  const s = await sharedFixture();
  await assert.rejects(s.call("dm", "/award", { id: s.id, revision: 2, xp: bad }), /party fund/);
  const t = await s.table();
  assert.equal(t.purses.find((p) => p.id === "hoard")!.coins.gp, 0);
  const detail = await s.call<{ status: string; award: unknown }>("dm", "/detail", { id: s.id });
  assert.deepEqual([detail.status, detail.award], ["review", null]);
  s.db.close();
  const d = await deviceFixture();
  await assert.rejects(d.call("/award", { revision: 2, xp: bad }), /party fund/);
  const snap = await economySnapshot();
  assert.equal(snap.purses.find((p) => p.id === "hoard")!.coins.gp, 0);
  assert.equal((await d.call<{ status: string }>("/detail", {})).status, "review");
});

test("encounters awarded without XP (and before this change) get XP once from Award XP", async () => {
  const xp = SPLIT;
  const s = await sharedFixture();
  const old = await s.call<Award>("dm", "/award", { id: s.id, revision: 2 });
  assert.equal(old.award.xp, undefined, "an award without XP keeps its old shape");
  // A concurrent campaign write between the read and the batch: refused, nothing given.
  const batch = s.db.batch.bind(s.db);
  s.db.batch = async (statements: unknown[]) => {
    s.db.batch = batch;
    await s.db.prepare("UPDATE campaign_rooms SET revision=revision+1 WHERE code=?").bind(s.code).run();
    return batch(statements);
  };
  await assert.rejects(s.call("dm", "/award-xp", { id: s.id, xp }), /changed/);
  assert.equal(xpOf(await s.table(), "aria"), 600);
  assert.equal((await s.call<Award>("dm", "/detail", { id: s.id })).award.xp, undefined);
  const given = await s.call<Award>("dm", "/award-xp", { id: s.id, xp });
  const again = await s.call<Award>("dm", "/award-xp", { id: s.id, xp: { ...xp, total: 900 } });
  assert.equal(given.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(given.award.receiptId, old.award.receiptId);
  assert.equal(given.award.xp!.total, 498, "2 XP kept unawarded");
  const shared = await s.table();
  assert.deepEqual([xpOf(shared, "aria"), xpOf(shared, "bram")], [766, 466]);
  assert.equal(xpEvents(shared).length, 1);
  assert.match(xpEvents(shared)[0]!.summary, /2 XP not awarded$/);
  s.db.close();

  const d = await deviceFixture();
  await assert.rejects(d.call("/award-xp", { xp }), /Transfer this encounter's loot first/);
  await d.call<Award>("/award", { revision: 2 });
  const dGiven = await d.call<Award>("/award-xp", { xp });
  const dAgain = await d.call<Award>("/award-xp", { xp });
  assert.deepEqual([dGiven.duplicate, dAgain.duplicate], [false, true]);
  const device = await economySnapshot();
  assert.deepEqual(sheetsOf(device), sheetsOf(shared));
  assert.deepEqual(xpEvents(device), xpEvents(shared));
  // A device receipt saved before this change (no `xp`) still reads.
  const legacy = readLocalEncounters([
    { id: "local-old", code: "device", body: blankEncounter(), revision: 3, status: "awarded", updated_at: 1, rolls: [], award: { receiptId: "r", at: 1 } },
  ]);
  assert.deepEqual(legacy[0]!.award, { receiptId: "r", at: 1 });
});

test("milestone parties: the detail says so, XP is refused on both paths, a milestone is marked once", async () => {
  const s = await sharedFixture(true);
  assert.equal((await s.call<{ xpMode: string }>("dm", "/detail", { id: s.id })).xpMode, "milestone");
  await assert.rejects(s.call("dm", "/award", { id: s.id, revision: 2, xp: SPLIT }), /milestones/);
  const mark = { unit: "milestone", purseIds: ["aria", "bram"] };
  await s.call("dm", "/award", { id: s.id, revision: 2, xp: mark });
  await s.call("dm", "/award-xp", { id: s.id, xp: mark });
  const shared = await s.table();
  assert.deepEqual(sheetsOf(shared).filter((x) => x.id === "aria" || x.id === "bram").map((x) => [x.milestone, x.xp]), [[3, undefined], [3, undefined]]);
  // Bram's view: the names, never a level (the xp-award rule).
  const text = JSON.stringify((await s.bramView()).journal!.events);
  assert.match(text, /Milestone award \(Goblin ambush\): a milestone to Aria Thorne and Bram Ironfoot/);
  assert.doesNotMatch(text, /level/i);
  s.db.close();
  const d = await deviceFixture(true);
  assert.equal((await d.call<{ xpMode: string }>("/detail", {})).xpMode, "milestone");
  await assert.rejects(d.call("/award", { revision: 2, xp: SPLIT }), /milestones/);
  await d.call("/award", { revision: 2, xp: mark });
  assert.deepEqual(sheetsOf(await economySnapshot()), sheetsOf(shared));
});
