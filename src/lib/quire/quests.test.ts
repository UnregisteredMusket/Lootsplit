// Quest log engine (docs/QUESTS.md): DM-only commands with revision checks and exactly-once IDs,
// the player projection (DM notes, hidden objectives, DM-only chronicle lines, hidden giver,
// hidden group place, character audience, players away), shared rooms (outside the turn, never
// staged, roomState projection), shared/offline parity and an older client's journal write.
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
import { projectRecord } from "./session-records.ts";
import { projectQuests, questsOf } from "./quests.ts";
import { previewQuestAs } from "./quest-preview.ts";
import { campaignMapSchema } from "./world-schema.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import type { QuestDraft } from "./quests-schema.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql", "0003_accounts.sql", "0007_character_play.sql", "0008_encounters.sql"])
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
const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const player = (...purseIds: string[]): CloudSeat => ({ id: `p-${purseIds.join("-")}`, token: "", name: "P", role: "player", purseIds });
const map = (id: string, markers: { id: string; visibility: "party" | "dm" }[]) =>
  campaignMapSchema.parse({
    id,
    name: id,
    image: "data:image/png;base64,YQ==",
    locationId: "town",
    visible: true,
    type: "city",
    anchors: [],
    markers: markers.map((m) => ({ ...m, x: 0.5, y: 0.5, label: m.id, description: "" })),
  });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "fund", name: "Party fund", kind: "party", coins: coins() },
      { id: "aria", name: "Aria", kind: "character", coins: coins() },
      { id: "bram", name: "Bram", kind: "character", coins: coins() },
      { id: "cass", name: "Cass", kind: "character", coins: coins() },
      { id: "mirelle", name: "Mirelle", kind: "character", coins: coins() },
      { id: "hollin", name: "Hollin", kind: "character", control: "npc", nonParty: true, coins: coins() },
      { id: "spy", name: "The Spy", kind: "character", control: "npc", nonParty: true, coins: coins() },
    ],
    ledger: [{ id: "advance", at: 1, purseId: "aria", shopId: null, summary: "Advance from Hollin", copper: 4000 }],
    journal: readJournal({
      market: {
        currentLocationId: "town",
        locations: [
          { id: "region", name: "Vale", kind: "region", parentId: null, description: "" },
          { id: "town", name: "Harrowgate", kind: "town", parentId: "region", description: "" },
          { id: "market", name: "Night market", kind: "area", parentId: "town", description: "" },
          { id: "ford", name: "Fenwick Ford", kind: "town", parentId: "region", description: "" },
        ],
      },
      sessions: [{ id: "s1", name: "Session 1", startedAt: 1 }],
      world: {
        characterPositions: [{ purseId: "mirelle", inParty: false, locationId: "ford", visible: true, sheetVisible: true }],
        npcs: [
          { id: "hollin", name: "Hollin", description: "", locationId: "town", visible: true, barterAllowed: false, controllerPurseId: null },
          { id: "spy", name: "The Spy", description: "", locationId: "town", visible: false, barterAllowed: false, controllerPurseId: null },
        ],
        maps: [map("city", [{ id: "pin-public", visibility: "party" }, { id: "pin-dm", visibility: "dm" }])],
      },
    }),
  };
}
const draft = (extra: Partial<QuestDraft> = {}): QuestDraft => ({
  title: "Hollin's Missing Mare",
  summary: "Find the mare.",
  giverNpcId: "hollin",
  locationIds: ["market"],
  markers: [{ mapId: "city", markerId: "pin-public" }],
  areas: [
    { id: "area-public", mapId: "city", x: 0.4, y: 0.4, r: 0.1, label: "Somewhere in here" },
    { id: "area-secret", mapId: "city", x: 0.6, y: 0.6, r: 0.05, objectiveId: "o-secret" },
  ],
  objectives: [
    { id: "o-search", text: "Search the market for Genzō", locationId: "market" },
    { id: "o-secret", text: "Learn who stole her", hidden: true, marker: { mapId: "city", markerId: "pin-dm" } },
  ],
  rewardText: "40 gp",
  dmNotes: "The spy took her.",
  ...extra,
});
const rev = (t: CloudTable, questId = "q1") => questsOf(t).find((q) => q.id === questId)!.revision;
function run(t: CloudTable, cmd: Command, seat: CloudSeat = dm) {
  return applyCommand(t, seat, cmd);
}
function revealedCampaign(audience: Extract<Command, { kind: "quest-reveal" }>["audience"] = { kind: "party" }) {
  let t = run(campaign(), { id: "q1", kind: "quest-save", questId: null, revision: null, quest: draft() });
  t = run(t, { id: "r1", kind: "quest-reveal", questId: "q1", revision: rev(t), audience, message: true });
  t = run(t, { id: "l1", kind: "quest-log", questId: "q1", revision: rev(t), text: "Hollin is lying.", shared: false });
  t = run(t, { id: "l2", kind: "quest-log", questId: "q1", revision: rev(t), text: "Tracks lead east.", shared: true });
  t = run(t, { id: "o1", kind: "quest-objective", questId: "q1", revision: rev(t), objectiveId: "o-secret", action: "done" });
  return t;
}

test("DM creates, reveals, updates and closes a quest; every step is stamped and logged DM-only", () => {
  let t = revealedCampaign();
  const q = questsOf(t)[0]!;
  assert.equal(q.audience.kind, "party");
  assert.ok(q.revealedAt);
  assert.deepEqual(
    q.log.map((l) => [l.kind, l.shared, l.sessionId]),
    [
      ["revealed", true, "s1"],
      ["entry", false, "s1"],
      ["entry", true, "s1"],
      ["objective", false, "s1"], // a hidden objective's progress stays DM-only
    ],
  );
  // One private DM message per party character who can read it, never party chat.
  assert.deepEqual(
    t.notes.filter((n) => n.text.includes("Hollin's Missing Mare")).map((n) => [n.to, n.purseId]),
    [["dm", "aria"], ["dm", "bram"], ["dm", "cass"], ["dm", "mirelle"]],
  );
  t = run(t, { id: "c1", kind: "quest-close", questId: "q1", revision: rev(t), status: "completed", text: "The mare is home." });
  assert.equal(questsOf(t)[0]!.status, "completed");
  assert.ok(questsOf(t)[0]!.closedAt);
  const events = t.journal!.events.filter((e) => e.summary.startsWith("Quest"));
  assert.ok(events.length >= 5 && events.every((e) => e.dmOnly));
  // Quests never move coins or items.
  assert.deepEqual(t.purses, campaign().purses);
  assert.deepEqual(t.holdings, campaign().holdings);
  assert.deepEqual(t.ledger, campaign().ledger);
});

test("players cannot run quest commands; a stale revision changes nothing", () => {
  const t = revealedCampaign();
  for (const cmd of [
    { id: "x1", kind: "quest-save", questId: null, revision: null, quest: draft() },
    { id: "x2", kind: "quest-log", questId: "q1", revision: rev(t), text: "hi", shared: true },
    { id: "x3", kind: "quest-close", questId: "q1", revision: rev(t), status: "failed" },
  ] as Command[])
    assert.throws(() => run(t, cmd, player("aria")), /Only the DM/);
  assert.throws(
    () => run(t, { id: "x4", kind: "quest-log", questId: "q1", revision: rev(t) - 1, text: "late", shared: true }),
    /Quest changed on another device/,
  );
});

test("references are checked; revealed quests archive only, drafts can be deleted", () => {
  const t0 = campaign();
  assert.throws(() => run(t0, { id: "b1", kind: "quest-save", questId: null, revision: null, quest: draft({ giverNpcId: "nobody" }) }), /existing NPC/);
  assert.throws(() => run(t0, { id: "b2", kind: "quest-save", questId: null, revision: null, quest: draft({ locationIds: ["nowhere"] }) }), /existing locations/);
  assert.throws(
    () => run(t0, { id: "b3", kind: "quest-save", questId: null, revision: null, quest: draft({ markers: [{ mapId: "city", markerId: "gone" }] }) }),
    /existing map pins/,
  );
  assert.throws(
    () => run(t0, { id: "b4", kind: "quest-save", questId: null, revision: null, quest: draft({ areas: [{ id: "a", mapId: "city", x: 0, y: 0, r: 0.1, objectiveId: "zzz" }] }) }),
    /not in this quest/,
  );
  let d = run(t0, { id: "d1", kind: "quest-save", questId: null, revision: null, quest: draft() });
  d = run(d, { id: "d2", kind: "quest-delete", questId: "d1", revision: rev(d, "d1") });
  assert.equal(questsOf(d).length, 0);
  let t = revealedCampaign();
  assert.throws(() => run(t, { id: "d3", kind: "quest-delete", questId: "q1", revision: rev(t) }), /Archive it instead/);
  t = run(t, { id: "a1", kind: "quest-archive", questId: "q1", revision: rev(t), archived: true });
  assert.equal(questsOf(t)[0]!.archived, true);
  assert.equal(questsOf(t)[0]!.log.length, 4);
  // A known objective cannot be silently removed.
  const objectives = draft().objectives.filter((o) => o.id !== "o-search");
  assert.throws(
    () => run(t, { id: "s2", kind: "quest-save", questId: "q1", revision: rev(t), quest: draft({ objectives, areas: [] }) }),
    /Mark it done or failed/,
  );
});

test("reward links point at existing receipts only and never pay", () => {
  let t = revealedCampaign();
  assert.throws(
    () => run(t, { id: "w0", kind: "quest-link-reward", questId: "q1", revision: rev(t), link: { kind: "ledger", id: "missing" } }),
    /not in this campaign/,
  );
  t = run(t, { id: "w1", kind: "quest-link-reward", questId: "q1", revision: rev(t), link: { kind: "ledger", id: "advance" } });
  assert.deepEqual(questsOf(t)[0]!.rewardLinks.map((l) => [l.id, l.label]), [["advance", "Advance from Hollin · 40 gp"]]);
  assert.deepEqual(t.ledger, campaign().ledger);
  // Aria owns the receipt and Cass shares party lines; Mirelle, away from the party, reads only
  // her own lines (cloud.server.ts playerTable), so she sees the quest without the link.
  assert.equal(questsOf(projectRecord(t, player("aria")))[0]!.rewardLinks.length, 1);
  assert.equal(questsOf(projectRecord(t, player("cass")))[0]!.rewardLinks.length, 1);
  const mirelle = questsOf(projectRecord(t, player("mirelle")))[0]!;
  assert.equal(mirelle.rewardLinks.length, 0);
  assert.equal(JSON.stringify(mirelle).includes("Advance"), false);
});

test("projection: players never see DM notes, hidden objectives, DM-only lines or a hidden giver", () => {
  let t = revealedCampaign();
  const projected = projectRecord(t, player("aria"));
  const q = questsOf(projected)[0]!;
  const json = JSON.stringify(projected.journal);
  for (const secret of ["The spy took her", "Learn who stole her", "Hollin is lying", "o-secret", "area-secret", "pin-dm"])
    assert.equal(json.includes(secret), false, secret);
  assert.equal(q.dmNotes, undefined);
  assert.equal(q.editedAt, undefined);
  assert.equal(q.revision, 0);
  assert.deepEqual(q.objectives.map((o) => o.id), ["o-search"]);
  assert.deepEqual(q.log.map((l) => l.text), ["The party learned of this quest.", "Tracks lead east."]);
  assert.equal(q.giverNpcId, "hollin");
  assert.deepEqual(q.markers, [{ mapId: "city", markerId: "pin-public" }]);
  assert.deepEqual(q.areas.map((a) => a.id), ["area-public"]);
  // Linked places reach the player's market projection.
  assert.ok(projected.journal!.market!.locations.some((l) => l.id === "market"));
  // Revealing the objective later is news (updatedAt) and its area and pin follow it.
  t = run(t, { id: "o2", kind: "quest-objective", questId: "q1", revision: rev(t), objectiveId: "o-secret", action: "reveal" });
  const later = questsOf(projectRecord(t, player("aria")))[0]!;
  assert.ok(later.updatedAt >= q.updatedAt);
  assert.deepEqual(later.areas.map((a) => a.id), ["area-public", "area-secret"]);
  assert.equal(later.objectives.find((o) => o.id === "o-secret")?.marker, undefined); // pin-dm is DM-only on the map
  // A giver the player cannot read is dropped, never named.
  t = run(t, { id: "s3", kind: "quest-save", questId: "q1", revision: rev(t), quest: draft({ giverNpcId: "spy" }) });
  const withSpy = projectRecord(t, player("aria"));
  assert.equal(questsOf(withSpy)[0]!.giverNpcId, undefined);
  assert.equal(JSON.stringify(withSpy).includes("The Spy"), false);
});

test("projection: drafts stay DM-only; character audiences name co-recipients and exclude others", () => {
  const draftOnly = run(campaign(), { id: "q1", kind: "quest-save", questId: null, revision: null, quest: draft() });
  assert.equal(projectRecord(draftOnly, player("aria")).journal!.quests, undefined);
  assert.equal(questsOf(projectRecord(draftOnly, dm)).length, 1);
  const t = revealedCampaign({ kind: "characters", purseIds: ["aria", "bram"] });
  const aria = questsOf(projectRecord(t, player("aria")))[0]!;
  assert.deepEqual(aria.audience, { kind: "characters", purseIds: ["aria", "bram"] });
  assert.ok(projectRecord(t, player("aria")).purses.some((p) => p.id === "bram" && p.name === "Bram"));
  assert.equal(projectRecord(t, player("cass")).journal!.quests, undefined);
  // One private DM message per listed character, none to the party.
  assert.deepEqual(
    t.notes.filter((n) => n.text.startsWith("Quest")).map((n) => [n.to, n.purseId]),
    [["dm", "aria"], ["dm", "bram"]],
  );
  assert.equal(projectRecord(t, player("cass")).notes.some((n) => n.text.startsWith("Quest")), false);
});

test("projection: a party quest stays with a character who walked off; NPCs and non-party never get it", () => {
  const t = revealedCampaign();
  assert.equal(questsOf(projectRecord(t, player("mirelle"))).length, 1);
  assert.equal(questsOf(projectRecord(t, player("hollin"))).length, 0);
  const hidden = structuredClone(t);
  hidden.journal!.world!.characterPositions.push({ purseId: "cass", inParty: true, locationId: null, visible: false, sheetVisible: true });
  assert.equal(questsOf(projectRecord(hidden, player("cass"))).length, 0);
});

test("projection: a hidden group's place is dropped from the quest for seats outside that group", () => {
  const t = revealedCampaign();
  const journal = readJournal(structuredClone(t.journal));
  projectQuests(t, journal, player("aria"), { readableNpcs: new Set(["hollin"]), hiddenPlaces: new Set(["market"]) });
  const q = questsOf({ journal })[0]!;
  assert.deepEqual(q.locationIds, []);
  assert.equal(q.objectives[0]!.locationId, undefined);
  assert.equal(q.objectives[0]!.text, "Search the market for Genzō");
});

test("projection also applies inside archived session reports", () => {
  let t = revealedCampaign();
  t = run(t, { id: "end", kind: "session", name: "Session 1", end: true });
  const report = projectRecord(t, player("aria")).journal!.reports!.at(-1)!;
  const archived = JSON.parse(report.snapshot) as CloudTable;
  assert.equal(JSON.stringify(archived).includes("The spy took her"), false);
  assert.equal(questsOf(archived).length, 1);
  // The live quest log is not cleared by ending the session.
  assert.equal(questsOf(t).length, 1);
});

test("an older client's whole-journal write keeps the quest log and quest note links", () => {
  let t = revealedCampaign();
  t = run(t, { id: "note", kind: "journal-note", title: "My notes", text: "Ask Genzō", visibility: "player", purseId: "aria", reportIds: [], questId: "q1" }, player("aria"));
  const current = readJournal(t.journal);
  // An older app parses the journal without the quest fields and writes it back.
  const old = structuredClone(current) as any;
  delete old.quests;
  for (const e of old.entries) delete e.questId;
  const kept = preserveJournalMetadata(old, current);
  assert.deepEqual(kept.quests, current.quests);
  assert.equal(kept.entries!.find((e) => e.id === "note")!.questId, "q1");
  // A newer journal patch cannot rewrite quests either.
  const forged = { ...structuredClone(current), quests: { quests: [] } };
  assert.deepEqual(preserveJournalMetadata(forged, current).quests, current.quests);
  // Through the patch command, too.
  const patched = run(t, { id: "patch", kind: "patch", changes: [{ store: "journal", id: "journal", before: old, after: { ...old, events: [] } }] });
  assert.deepEqual(readJournal(patched.journal).quests, current.quests);
});

test("quest notes: a player may write a private note only for a quest in their log", () => {
  const t = revealedCampaign({ kind: "characters", purseIds: ["aria"] });
  assert.throws(
    () => run(t, { id: "n1", kind: "journal-note", title: "Notes", text: "x", visibility: "player", purseId: "cass", reportIds: [], questId: "q1" }, player("cass")),
    /not in your quest log/,
  );
  const ok = run(t, { id: "n2", kind: "journal-note", title: "Notes", text: "x", visibility: "player", purseId: "aria", reportIds: [], questId: "q1" }, player("aria"));
  assert.equal(projectRecord(ok, player("cass")).journal!.entries!.some((e) => e.id === "n2"), false);
});

test("an old save or backup without quests reads as an empty quest log", () => {
  const journal = readJournal({ sessions: [], events: [] });
  assert.equal(journal.quests, undefined);
  assert.deepEqual(questsOf({ journal }), []);
});

type Seat = { code: string; token: string };
const send = (seat: Seat, batchId: string, ...commands: Command[]) => submitCommands({ ...seat, batchId, commands });

test("shared room: DM-only, outside the turn, never staged, exactly once, projected per seat", async () => {
  const room = await openRoom({ name: "Quest DM", table: campaign() });
  const dmSeat = { code: room.code, token: room.token };
  const aria = await joinRoom({ code: room.code, purseId: "aria", name: "Aria" });
  const cass = await joinRoom({ code: room.code, purseId: "cass", name: "Cass" });
  const ariaSeat = { code: room.code, token: aria.token };
  // Turn-based, and it is not the DM's turn.
  await choosePace({ ...dmSeat, live: false });
  const save: Command = { id: "q1", kind: "quest-save", questId: null, revision: null, quest: draft() };
  await assert.rejects(submitCommands({ ...dmSeat, batchId: "staged", stage: true, commands: [save] }), /sent to the room directly/);
  await send(dmSeat, "b1", save);
  await send(dmSeat, "b1-retry", save); // a lost-response retry applies once
  let t = (await roomState(dmSeat)).table;
  assert.equal(questsOf(t).length, 1);
  await assert.rejects(send(ariaSeat, "b2", { id: "x", kind: "quest-log", questId: "q1", revision: 0, text: "hi", shared: true }), /Only the DM/);
  await send(dmSeat, "b3", { id: "r1", kind: "quest-reveal", questId: "q1", revision: rev(t), audience: { kind: "characters", purseIds: ["aria"] } });
  const ariaView = (await roomState(ariaSeat)).table;
  const cassView = (await roomState({ code: room.code, token: cass.token })).table;
  assert.equal(questsOf(ariaView).length, 1);
  assert.equal(JSON.stringify(ariaView).includes("The spy took her"), false);
  assert.equal(questsOf(cassView).length, 0);
  t = (await roomState(dmSeat)).table;
  assert.equal(questsOf(t)[0]!.dmNotes, "The spy took her.");
});

test("device: quest commands run through the shared engine with the same outcome, once per ID", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const cmd: Command = { id: "q1", kind: "quest-save", questId: null, revision: null, quest: draft() };
  await executeLocalCommand(cmd);
  await executeLocalCommand(cmd);
  const local = await economySnapshot();
  const shared = applyCommand(campaign(), { ...dm, id: "local", name: "Dungeon master" }, cmd);
  const strip = (t: CloudTable) => questsOf(t).map((q) => ({ ...q, createdAt: 0, updatedAt: 0, editedAt: 0 }));
  assert.deepEqual(strip(local), strip(shared));
  await executeLocalCommand({ id: "r1", kind: "quest-reveal", questId: "q1", revision: 0, audience: { kind: "party" } });
  await assert.rejects(
    executeLocalCommand({ id: "r2", kind: "quest-reveal", questId: "q1", revision: 0, audience: { kind: "party" } }),
    /Quest changed on another device/,
  );
});

// Privacy review of #290 (2026-10-26).
test("review: a reward label shows a player only the amounts on lines they can read", () => {
  const base = campaign();
  base.ledger.push(
    { id: "w-m", at: 2, purseId: "mirelle", shopId: null, summary: "Wolf den: share", copper: 100, award: { receiptId: "rc1", role: "coins" } },
    { id: "w-h", at: 2, purseId: "hollin", shopId: null, summary: "Wolf den: share", copper: 90000, award: { receiptId: "rc1", role: "coins" } },
    { id: "w-a", at: 2, purseId: "aria", shopId: null, summary: "Wolf den: share", copper: 2000, award: { receiptId: "rc1", role: "coins" } },
  );
  let t = run(base, { id: "q1", kind: "quest-save", questId: null, revision: null, quest: draft() });
  t = run(t, { id: "r1", kind: "quest-reveal", questId: "q1", revision: rev(t), audience: { kind: "party" } });
  t = run(t, { id: "w1", kind: "quest-link-reward", questId: "q1", revision: rev(t), link: { kind: "encounter-award", id: "rc1" } });
  // The DM's stored label totals every line.
  assert.equal(questsOf(t)[0]!.rewardLinks[0]!.label, "Wolf den · 921 gp");
  // Mirelle (away from the party) reads only her own line; never the NPC's 900 gp.
  const mirelle = projectRecord(t, player("mirelle"));
  assert.deepEqual(questsOf(mirelle)[0]!.rewardLinks.map((l) => l.label), ["Wolf den · 1 gp"]);
  // Match the amounts as labels: a bare "921" can occur inside a timestamp (it did once in CI).
  for (const amount of ["921 gp", "900 gp", "920 gp"]) assert.equal(JSON.stringify(mirelle.journal).includes(amount), false, amount);
  // Cass travels with the party: party members' lines (Aria's), not the NPC's or the away player's.
  assert.deepEqual(questsOf(projectRecord(t, player("cass")))[0]!.rewardLinks.map((l) => l.label), ["Wolf den · 20 gp"]);
});

test("review: party quest messages reach only characters who can read the quest", () => {
  const hid = campaign();
  hid.journal!.world!.characterPositions.push({ purseId: "bram", inParty: true, locationId: "town", visible: false, sheetVisible: false });
  let h = run(hid, { id: "q1", kind: "quest-save", questId: null, revision: null, quest: draft() });
  h = run(h, { id: "r1", kind: "quest-reveal", questId: "q1", revision: rev(h), audience: { kind: "party" }, message: true });
  const bram = projectRecord(h, player("bram"));
  assert.equal(questsOf(bram).length, 0);
  assert.equal(bram.notes.some((n) => n.text.includes("Hollin's Missing Mare")), false);
  // NPC-controller seats and non-party characters get nothing either.
  assert.equal(h.notes.some((n) => n.to === "party"), false);
  assert.equal(h.notes.some((n) => ["hollin", "spy", "bram"].includes(n.purseId)), false);
  const aria = projectRecord(h, player("aria"));
  assert.equal(aria.notes.filter((n) => n.text.includes("Hollin's Missing Mare")).length, 1);
});

test("review: linking a receipt is not an Updated change for players", () => {
  let t = revealedCampaign();
  const before = questsOf(t)[0]!.updatedAt;
  t = run(t, { id: "w1", kind: "quest-link-reward", questId: "q1", revision: rev(t), link: { kind: "ledger", id: "advance" } });
  assert.equal(questsOf(t)[0]!.updatedAt, before);
  assert.equal(questsOf(projectRecord(t, player("mirelle")))[0]!.updatedAt, before);
});

test("View as player uses the real projection for the chosen character", () => {
  let t = revealedCampaign({ kind: "characters", purseIds: ["aria"] });
  // A shared line about an objective hidden again, and a giver the player cannot read.
  t = run(t, { id: "o7", kind: "quest-objective", questId: "q1", revision: rev(t), objectiveId: "o-secret", action: "reveal" });
  t = run(t, { id: "o8", kind: "quest-objective", questId: "q1", revision: rev(t), objectiveId: "o-secret", action: "hide" });
  t = run(t, { id: "s9", kind: "quest-save", questId: "q1", revision: rev(t), quest: draft({ giverNpcId: "spy" }) });
  const preview = previewQuestAs(t, "q1", "aria");
  const json = JSON.stringify(preview.quest);
  for (const secret of ["The spy took her", "Learn who stole her", "Hollin is lying", "o-secret", "spy"])
    assert.equal(json.includes(secret), false, secret);
  assert.deepEqual(preview.quest!.log.map((l) => l.text), ["The party learned of this quest.", "Tracks lead east."]);
  // A character outside the audience sees nothing.
  assert.equal(previewQuestAs(t, "q1", "cass").quest, undefined);
  // A draft is previewed as a party reveal; the stored draft is unchanged.
  const d = run(campaign(), { id: "d1", kind: "quest-save", questId: null, revision: null, quest: draft() });
  assert.equal(previewQuestAs(d, "d1", "bram").quest?.title, "Hollin's Missing Mare");
  assert.equal(questsOf(d)[0]!.audience.kind, "none");
});

test("projection: a radius marker in concealed fog or on a map the player cannot open is never sent", () => {
  let t = revealedCampaign();
  const fogged = structuredClone(t);
  const map = fogged.journal!.world!.maps[0]!;
  (map as any).tabletop = { fog: { enabled: true, base: "concealed", shapes: [] } };
  fogged.journal!.world!.maps[0] = campaignMapSchema.parse(map);
  assert.deepEqual(questsOf(projectRecord(fogged, player("aria")))[0]!.areas, []);
  assert.equal(questsOf(projectRecord(fogged, dm))[0]!.areas.length, 2);
  const hiddenMap = structuredClone(t);
  hiddenMap.journal!.world!.maps[0]!.visible = false;
  assert.deepEqual(questsOf(projectRecord(hiddenMap, player("aria")))[0]!.areas, []);
  t = run(t, { id: "o3", kind: "quest-objective", questId: "q1", revision: rev(t), objectiveId: "o-secret", action: "reveal" });
  assert.deepEqual(questsOf(projectRecord(t, player("aria")))[0]!.areas.map((a) => a.id), ["area-public", "area-secret"]);
});

test("projection: on a player's device (maps already projected) areas the server sent are kept", () => {
  const t = revealedCampaign();
  const fogged = structuredClone(t);
  const map = fogged.journal!.world!.maps[0]!;
  (map as any).tabletop = { fog: { enabled: true, base: "concealed", shapes: [] } };
  fogged.journal!.world!.maps[0] = campaignMapSchema.parse(map);
  // The redacted fog (concealed, no shapes) must not hide what the server already let through.
  const local = projectRecord(fogged, player("aria"), { tabletopProjected: true });
  assert.deepEqual(questsOf(local)[0]!.areas.map((a) => a.id), ["area-public"]);
});

test("projection: a DM-only, fogged or hidden-map pin link is dropped from the quest and its objectives", () => {
  // The fixture links the quest to the party pin and the (later revealed) secret objective to the DM-only pin.
  let t = revealedCampaign();
  t = run(t, {
    id: "s10",
    kind: "quest-save",
    questId: "q1",
    revision: rev(t),
    quest: draft({ markers: [{ mapId: "city", markerId: "pin-public" }, { mapId: "city", markerId: "pin-dm" }] }),
  });
  t = run(t, { id: "o9", kind: "quest-objective", questId: "q1", revision: rev(t), objectiveId: "o-secret", action: "reveal" });
  const forDm = questsOf(projectRecord(t, dm))[0]!;
  assert.deepEqual(forDm.markers.map((m) => m.markerId), ["pin-public", "pin-dm"]);
  assert.equal(forDm.objectives.find((o) => o.id === "o-secret")!.marker?.markerId, "pin-dm");
  const forPlayer = questsOf(projectRecord(t, player("aria")))[0]!;
  assert.deepEqual(forPlayer.markers.map((m) => m.markerId), ["pin-public"]);
  assert.equal(forPlayer.objectives.find((o) => o.id === "o-secret")!.marker, undefined);
  assert.equal(JSON.stringify(forPlayer).includes("pin-dm"), false);
  // Under concealed fog even the party pin's link is cut; a hidden map drops every link.
  const fogged = structuredClone(t);
  const map = fogged.journal!.world!.maps[0]!;
  (map as any).tabletop = { fog: { enabled: true, base: "concealed", shapes: [] } };
  fogged.journal!.world!.maps[0] = campaignMapSchema.parse(map);
  assert.deepEqual(questsOf(projectRecord(fogged, player("aria")))[0]!.markers, []);
  const hiddenMap = structuredClone(t);
  hiddenMap.journal!.world!.maps[0]!.visible = false;
  assert.deepEqual(questsOf(projectRecord(hiddenMap, player("aria")))[0]!.markers, []);
  // On a joined player's device the maps are already projected: the party pin's link is kept.
  assert.deepEqual(questsOf(projectRecord(fogged, player("aria"), { tabletopProjected: true }))[0]!.markers.map((m) => m.markerId), ["pin-public"]);
});
