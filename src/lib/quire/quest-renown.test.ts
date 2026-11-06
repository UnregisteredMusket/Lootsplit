// Quests and renown (owner decision 2026-11-05 22:35 ET, factions PR C): a quest may carry renown
// rewards (faction, change, the party or named characters) and a giver faction. Completing the
// quest applies the rewards automatically in the same command, all or nothing, with the Favor
// gains earn and the normal renown history (the quest named as the reason); reopening never undoes
// them and completing again never repeats them. These tests pin that, replay, the server's
// permission checks, the device's parity, old data and older apps, and the player projection
// (only visible factions' rewards that reach the seat; a hidden giver faction is never named).
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
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { archiveSession, projectRecord } from "./session-records.ts";
import { fromCopper } from "./money.ts";
import { defaultFactionDraft, readFactions } from "./factions.ts";
import { questsOf } from "./quests.ts";
import { readQuests, type QuestRenownReward } from "./quests-schema.ts";
import { CURRENT_TABLETOP_PROTOCOL, FAVOR_MARKET_PROTOCOL, QUEST_RENOWN_PROTOCOL, tabletopResponse } from "./tabletop-protocol.ts";

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

const pc = (id: string, name: string) => ({ id, name, kind: "character" as const, coins: fromCopper(1000) });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [pc("aria", "Aria Thorne"), pc("bram", "Bram Ironfoot"), pc("cora", "Cora Vale")],
    journal: readJournal({ finance: { day: 1 } }),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const bramSeat: CloudSeat = { id: "b", token: "", name: "Bram", role: "player", purseIds: ["bram"] };
const run = (t: CloudTable, ...cmds: Command[]) => cmds.reduce((next, c) => applyCommand(next, dmSeat, c), t);
const factionsOf = (t: CloudTable) => readFactions((t.journal as { factions?: unknown }).factions);
const standing = (t: CloudTable, factionId: string) => factionsOf(t).find((f) => f.id === factionId)!.standing;
const quest = (t: CloudTable, id = "q1") => questsOf(t).find((q) => q.id === id)!;
const party: QuestRenownReward["target"] = { kind: "party" };
const rewards = (giverFactionId: string | null, list: QuestRenownReward[], revision: number, id = "qr"): Command => ({
  id, kind: "quest-renown", questId: "q1", revision, giverFactionId, rewards: list,
});
const close = (id: string, status: "completed" | "failed" | "active", revision: number): Command => ({
  id, kind: "quest-close", questId: "q1", revision, status,
});

/**
 * The Black Hand (visible, Favor 50 per 100 renown) and the Pale Court (hidden). Quest "Return the
 * ledger" (q1), revealed to the party: +100 Black Hand for the party, +40 Pale Court for Aria only,
 * −20 Black Hand for Bram only. Giver: the Pale Court.
 */
function world(): CloudTable {
  return run(
    campaign(),
    { id: "s1", kind: "faction-save", factionId: "hand", revision: null, faction: { ...defaultFactionDraft(), name: "The Black Hand", favorRatePercent: 50 } },
    { id: "s2", kind: "faction-save", factionId: "court", revision: null, faction: { ...defaultFactionDraft(), name: "The Pale Court" } },
    { id: "v1", kind: "faction-visibility", factionId: "hand", revision: 0, hidden: false },
    { id: "q1", kind: "quest-save", questId: null, revision: null, quest: { title: "Return the ledger", summary: "", locationIds: [], markers: [], areas: [], objectives: [] } },
    { id: "q1r", kind: "quest-reveal", questId: "q1", revision: 0, audience: { kind: "party" } },
    rewards("court", [
      { factionId: "hand", delta: 100, target: party },
      { factionId: "court", delta: 40, target: { kind: "characters", purseIds: ["aria"] } },
      { factionId: "hand", delta: -20, target: { kind: "characters", purseIds: ["bram"] } },
    ], 1),
  );
}

test("configuring: DM only, revision-checked, existing factions and player characters, locked once completed", () => {
  const t = world();
  assert.equal(quest(t).giverFactionId, "court");
  assert.equal(quest(t).renownRewards!.length, 3);
  assert.equal(quest(t).revision, 2);
  assert.throws(() => applyCommand(t, ariaSeat, rewards(null, [], 2)), /Only the DM/);
  assert.throws(() => run(t, rewards(null, [], 1, "stale")), /changed on another device/);
  assert.throws(() => run(t, rewards(null, [{ factionId: "nope", delta: 5, target: party }], 2)), /existing factions/);
  assert.throws(() => run(t, rewards("nope", [], 2)), /quest giver/);
  assert.throws(() => run(t, rewards(null, [{ factionId: "hand", delta: 5, target: { kind: "characters", purseIds: ["aria", "aria"] } }], 2)), /once/);
  assert.throws(() => run(t, rewards(null, [{ factionId: "hand", delta: 0, target: party }], 2)));
  // Changing them is fine until completion; clearing removes the fields.
  const cleared = run(t, rewards(null, [], 2));
  assert.equal(quest(cleared).renownRewards, undefined);
  assert.equal(quest(cleared).giverFactionId, undefined);
  // Once completed (and after reopening) the rewards are locked; the giver can still change.
  const done = run(t, close("c1", "completed", 2));
  assert.throws(() => run(done, rewards("court", [], 3)), /were applied/);
  const reopened = run(done, close("c2", "active", 3));
  assert.throws(() => run(reopened, rewards("court", [], 4)), /were applied/);
  assert.equal(quest(run(reopened, rewards("hand", quest(reopened).renownRewards!, 4))).giverFactionId, "hand");
  // Quest edits (quest-save) keep the rewards.
  const edited = run(t, { id: "e1", kind: "quest-save", questId: "q1", revision: 2, quest: { title: "Return the ledger", summary: "Now with a map", locationIds: [], markers: [], areas: [], objectives: [] } });
  assert.deepEqual(quest(edited).renownRewards, quest(t).renownRewards);
});

test("completion applies every reward in the same command, with Favor and history; reopening never undoes or repeats", () => {
  const t = world();
  const done = run(t, close("c1", "completed", 2));
  // Party +100 (Favor at 50%: +50), Aria +40 with the court (+40 Favor), Bram −20 after +100.
  assert.deepEqual(standing(done, "hand"), { aria: [100, 50], bram: [80, 50], cora: [100, 50] });
  assert.deepEqual(standing(done, "court"), { aria: [40, 40] });
  assert.equal(typeof quest(done).renownAppliedAt, "number");
  const lines = done.journal!.events.filter((e) => e.id.startsWith("c1-renown-")).map((e) => [e.purseId, e.summary, !!e.dmOnly]);
  assert.deepEqual(lines, [
    ["aria", "Aria Thorne: renown with The Black Hand +100 (now 100, Liked) · +50 Favor · Quest: Return the ledger", false],
    ["bram", "Bram Ironfoot: renown with The Black Hand +100 (now 100, Liked) · +50 Favor · Quest: Return the ledger", false],
    ["cora", "Cora Vale: renown with The Black Hand +100 (now 100, Liked) · +50 Favor · Quest: Return the ledger", false],
    ["aria", "Aria Thorne: renown with The Pale Court +40 (now 40, Neutral) · +40 Favor · Quest: Return the ledger", true],
    ["bram", "Bram Ironfoot: renown with The Black Hand −20 (now 80, Neutral) · Quest: Return the ledger", false],
  ]);
  // Reopen and complete again: nothing more changes.
  const again = run(done, close("c2", "active", 3), close("c3", "completed", 4));
  assert.deepEqual(standing(again, "hand"), standing(done, "hand"));
  assert.deepEqual(standing(again, "court"), standing(done, "court"));
  // A failed quest applies nothing.
  const failed = run(t, close("f1", "failed", 2));
  assert.equal(factionsOf(failed).find((f) => f.id === "hand")!.standing.aria, undefined);
  // All or nothing: a refused close (stale) applies no renown.
  assert.throws(() => run(t, close("c4", "completed", 1)), /changed on another device/);
  // The party is the party at completion: a character who left is not rewarded.
  const left = run(t);
  left.journal = readJournal({ ...left.journal, world: { characterPositions: [{ purseId: "cora", inParty: false, locationId: null, visible: true, sheetVisible: true }] } });
  assert.equal(standing(run(left, close("c5", "completed", 2)), "hand").cora, undefined);
  // A reward whose faction was deleted since is skipped with a DM-only note; the rest apply.
  const deleted = run(t, { id: "d1", kind: "faction-delete", factionId: "court", revision: 0, deleted: true });
  const doneDeleted = run(deleted, close("c6", "completed", 2));
  assert.deepEqual(standing(doneDeleted, "hand").aria, [100, 50]);
  assert.ok(doneDeleted.journal!.events.some((e) => e.dmOnly && /skipped \(its faction was deleted\)/.test(e.summary)));
  // Quests without rewards change no renown on completion (the screen offers a change instead).
  const plain = run(t, rewards(null, [], 2), close("c7", "completed", 3));
  assert.equal(factionsOf(plain).find((f) => f.id === "hand")!.standing.aria, undefined);
});

test("shared rooms: players refused on the server; a retried completion applies once", async () => {
  const dm = await openRoom({ name: "Quest renown", table: world() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const DT = { code: dm.code, token: dm.token, tabletopProtocol: QUEST_RENOWN_PROTOCOL };
  const AT = { code: dm.code, token: aria.token, tabletopProtocol: QUEST_RENOWN_PROTOCOL };
  await assert.rejects(submitCommands({ ...AT, batchId: "x1", commands: [rewards(null, [], 2, "x1")] }), /DM/);
  await assert.rejects(submitCommands({ ...AT, batchId: "x2", commands: [close("x2", "completed", 2)] }), /DM/);
  const completion = close("c1", "completed", 2);
  await submitCommands({ ...DT, batchId: "c1", commands: [completion] });
  await submitCommands({ ...DT, batchId: "c1", commands: [completion] });
  const table = (await roomState(DT)).table;
  assert.deepEqual(standing(table, "hand").aria, [100, 50], "applied once");
  // An older app completing the quest still applies the configured rewards on the server.
  const dm2 = await openRoom({ name: "Old app", table: world() });
  await choosePace({ code: dm2.code, token: dm2.token, live: true });
  await submitCommands({ code: dm2.code, token: dm2.token, tabletopProtocol: FAVOR_MARKET_PROTOCOL, batchId: "o1", commands: [close("o1", "completed", 2)] });
  assert.deepEqual(standing((await roomState({ code: dm2.code, token: dm2.token })).table, "hand").aria, [100, 50]);
  // The player's view: the visible faction's rewards that reach Aria, never the hidden court.
  const view = (await roomState(AT)).table;
  const q = questsOf(view)[0]!;
  assert.deepEqual(q.renownRewards, [{ factionId: "hand", delta: 100, target: party }]);
  assert.equal(q.giverFactionId, undefined);
  assert.ok(!JSON.stringify(view).includes("court"));
});

test("offline parity: the device runs the same quest commands, rewards and errors; retries apply once", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(world());
  const steps: Command[] = [close("c1", "completed", 2), close("c2", "active", 3), close("c3", "completed", 4)];
  const shared = run(world(), ...steps);
  for (const s of steps) await executeLocalCommand(s);
  const once = await economySnapshot();
  for (const s of steps) await executeLocalCommand(s);
  const twice = await economySnapshot();
  for (const id of ["hand", "court"]) {
    assert.deepEqual(standing(once, id), standing(shared, id));
    assert.deepEqual(standing(twice, id), standing(once, id), "retries change nothing");
  }
  const logs = (t: CloudTable) => t.journal!.events.filter((e) => e.factionId).map((e) => [e.id, e.summary, e.purseId, e.dmOnly]);
  assert.deepEqual(logs(once), logs(shared));
  const bad = rewards(null, [], 5, "late");
  const sharedError = (() => {
    try {
      run(shared, bad);
    } catch (e) {
      return (e as Error).message;
    }
  })();
  assert.match(String(sharedError), /were applied/);
  assert.equal(await executeLocalCommand(bad).catch((e: Error) => e.message), sharedError);
});

test("projection: only visible factions' rewards that reach the seat; a hidden giver faction is never named", () => {
  const t = world();
  const aria = quest(projectRecord(t, ariaSeat));
  assert.deepEqual(aria.renownRewards, [{ factionId: "hand", delta: 100, target: party }], "the court's reward is withheld; Bram's is not Aria's");
  assert.equal(aria.giverFactionId, undefined);
  const bram = quest(projectRecord(t, bramSeat));
  assert.deepEqual(bram.renownRewards, [
    { factionId: "hand", delta: 100, target: party },
    { factionId: "hand", delta: -20, target: { kind: "characters", purseIds: ["bram"] } },
  ]);
  // A named reward keeps only the seat's own characters.
  const shared = run(t, rewards("hand", [{ factionId: "hand", delta: 10, target: { kind: "characters", purseIds: ["aria", "bram"] } }], 2));
  assert.deepEqual(quest(projectRecord(shared, ariaSeat)).renownRewards![0]!.target, { kind: "characters", purseIds: ["aria"] });
  assert.equal(quest(projectRecord(shared, ariaSeat)).giverFactionId, "hand", "a visible giver faction is shown");
  // Revealing the court shows its reward to Aria; hiding the hand again withholds its rewards.
  const revealed = run(t, { id: "v2", kind: "faction-visibility", factionId: "court", revision: 0, hidden: false });
  assert.equal(quest(projectRecord(revealed, ariaSeat)).renownRewards!.length, 2);
  assert.equal(quest(projectRecord(revealed, ariaSeat)).giverFactionId, "court");
  const hiddenHand = run(t, { id: "h1", kind: "faction-visibility", factionId: "hand", revision: 1, hidden: true });
  const none = quest(projectRecord(hiddenHand, ariaSeat));
  assert.equal(none.renownRewards, undefined);
  // Completed: the applied stamp goes only with rewards the seat sees; the history follows PR A.
  const done = run(hiddenHand, close("c1", "completed", 2));
  const doneView = projectRecord(done, ariaSeat);
  assert.equal(quest(doneView).renownAppliedAt, undefined);
  assert.ok(!JSON.stringify(doneView).includes("Black Hand") && !JSON.stringify(doneView).includes("Pale Court"));
  // Archives are read with today's hidden factions.
  const archived = structuredClone(revealed);
  archiveSession(archived, "s-old", "Old session", 1);
  const rehidden = run(archived, { id: "h2", kind: "faction-visibility", factionId: "court", revision: 1, hidden: true });
  const report = projectRecord(rehidden, ariaSeat).journal!.reports![0]!.snapshot;
  assert.ok(!report.includes("court"), "the archived quest no longer names the court");
  // The DM keeps everything.
  assert.equal(quest(projectRecord(t, dmSeat)).renownRewards!.length, 3);
});

test("old data and older apps: quests without renown read unchanged; drafts with quest-renown ask protocol 30 to update", () => {
  assert.deepEqual(readQuests({ quests: [{ ...quest(campaignWithQuest()), renownRewards: undefined }] }).quests[0]!.renownRewards, undefined);
  // An older reader (unknown keys stripped) reads a quest with rewards.
  const older = readQuests({ quests: [{ ...quest(world()), laterField: true }] }).quests[0]!;
  assert.equal(older.title, "Return the ledger");
  assert.equal(QUEST_RENOWN_PROTOCOL, 31);
  assert.ok(CURRENT_TABLETOP_PROTOCOL >= QUEST_RENOWN_PROTOCOL);
  const t = world();
  const response = { table: t, draft: JSON.stringify([rewards(null, [], 2)]) };
  assert.throws(() => tabletopResponse(response, FAVOR_MARKET_PROTOCOL), /updated website/);
  assert.equal(tabletopResponse(response, QUEST_RENOWN_PROTOCOL).table, t);
  assert.equal(tabletopResponse({ table: t, draft: "[]" }, FAVOR_MARKET_PROTOCOL).table, t);
});
function campaignWithQuest(): CloudTable {
  return run(campaign(), { id: "q1", kind: "quest-save", questId: null, revision: null, quest: { title: "Plain", summary: "", locationIds: [], markers: [], areas: [], objectives: [] } });
}
