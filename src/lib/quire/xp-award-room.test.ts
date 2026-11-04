// XP and milestones (loot phase 6): the xp-award command in shared rooms and on the device:
// even splits with a visible remainder, idempotent retries, server-side permissions,
// shared/offline parity, the player projection, old clients (protocol 21) and old saves.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, commandSchema } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { blankSheet } from "../characters/model.mjs";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import type { Purse } from "./types.ts";
import type { CharacterSheet } from "./sheet.ts";
import { importedXp, levelForXp, levelUpTarget, nextLevelXp, planXpAward, XP_THRESHOLDS } from "./xp.ts";
import { tableForProtocol, tabletopResponse, XP_PROTOCOL, CURRENT_TABLETOP_PROTOCOL } from "./tabletop-protocol.ts";

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

const coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
const sheet = (name: string, level: number, extra: object = {}) => ({ ...blankSheet(), name, level, ...extra });
const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins },
      { id: "aria", name: "Aria Thorne", kind: "character", coins, sheet: sheet("Aria Thorne", 2, { xp: 600 }) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins, sheet: sheet("Bram Ironfoot", 3) },
      // No play sheet: only an imported 2014 sheet whose Experience box says 2,650.
      { id: "cyd", name: "Cyd", kind: "character", coins },
      { id: "vex", name: "Vex", kind: "character", control: "npc", coins, sheet: sheet("Vex", 4) },
    ] as Purse[],
    sheets: [{ purseId: "cyd", edition: "2014", importedAt: 1, name: "Cyd", classLevel: "Rogue 3", experience: "2,650" } as unknown as CharacterSheet],
    journal: readJournal({}),
  };
}
const award = (id: string, extra: object) =>
  commandSchema.parse({ id, kind: "xp-award", unit: "xp", rule: "split", purseIds: ["aria", "bram", "cyd"], amount: 1000, ...extra });
const xpOf = (t: CloudTable, id: string) => t.purses.find((p) => p.id === id)!.sheet?.xp;

test("thresholds follow the SRD 5.2.1 advancement table; the prompt is computed", () => {
  assert.equal(XP_THRESHOLDS.length, 20);
  assert.deepEqual([levelForXp(0), levelForXp(299), levelForXp(300), levelForXp(355000), levelForXp(9e6)], [1, 1, 2, 20, 20]);
  assert.equal(nextLevelXp(4), 6500);
  assert.equal(nextLevelXp(20), null);
  assert.equal(levelUpTarget({ level: 2, xp: 899 }), null);
  assert.equal(levelUpTarget({ level: 2, xp: 900 }), 3);
  assert.equal(levelUpTarget({ level: 3, xp: 6500 }), 5, "two thresholds crossed");
  assert.equal(levelUpTarget({ level: 4, milestoneLevel: 5 }), 5);
  assert.equal(levelUpTarget({ level: 5, milestoneLevel: 5 }), null, "levelled up: the prompt clears");
  assert.equal(levelUpTarget({ level: 1 }), null, "an old sheet without XP shows nothing");
  assert.equal(importedXp({ experience: "2,650" }), 2650);
  assert.equal(importedXp({ experience: "lots" }), null);
});

test("split evenly: floor each, the remainder stays unawarded unless the DM picks who gets it", () => {
  const t = campaign();
  const kept = applyCommand(t, dm, award("x1", {}));
  assert.deepEqual([xpOf(kept, "aria"), xpOf(kept, "bram"), xpOf(kept, "cyd")], [933, 333, 2983]);
  const event = kept.journal!.events.at(-1)!;
  assert.equal(event.summary, "XP award: 1,000 XP split among 3: Aria Thorne 333, Bram Ironfoot 333 and Cyd 333; 1 XP not awarded");
  assert.equal(event.purseId, undefined, "the party sees the amounts");
  assert.equal(event.dmOnly, undefined);
  assert.equal(kept.ledger.length, 0, "XP is not money: no ledger line");
  const given = applyCommand(t, dm, award("x2", { remainderTo: "bram", reason: "Goblin warren" }));
  assert.deepEqual([xpOf(given, "aria"), xpOf(given, "bram"), xpOf(given, "cyd")], [933, 334, 2983]);
  assert.match(given.journal!.events.at(-1)!.summary, /^XP award \(Goblin warren\): .*Bram Ironfoot 334/);
  // Cyd had no play sheet: it now has one, started from the imported Experience box.
  const cyd = given.purses.find((p) => p.id === "cyd")!;
  assert.equal(cyd.sheet!.level, 3, "the imported Rogue 3 level is kept");
  assert.equal(cyd.sheetRevision, 1);
  assert.equal(levelUpTarget(cyd.sheet!), 4, "2,983 XP passes level 4's 2,700");
  // Sheet levels never change on their own.
  assert.equal(given.purses.find((p) => p.id === "aria")!.sheet!.level, 2);
});

test("each, milestones, NPCs and refusals", () => {
  const t = campaign();
  const each = applyCommand(t, dm, award("e1", { rule: "each", amount: 300, purseIds: ["aria", "bram"] }));
  assert.deepEqual([xpOf(each, "aria"), xpOf(each, "bram")], [900, 300]);
  assert.equal(each.journal!.events.at(-1)!.summary, "XP award: 300 XP each to Aria Thorne and Bram Ironfoot");
  const mile = applyCommand(t, dm, commandSchema.parse({ id: "m1", kind: "xp-award", unit: "milestone", rule: "each", amount: 1, purseIds: ["bram"] }));
  const bram = mile.purses.find((p) => p.id === "bram")!.sheet!;
  assert.deepEqual([bram.level, bram.milestoneLevel, bram.xp], [3, 4, undefined]);
  assert.equal(levelUpTarget(bram), 4);
  assert.equal(mile.journal!.events.at(-1)!.summary, "Milestone award: a milestone to Bram Ironfoot");
  const again = applyCommand(mile, dm, commandSchema.parse({ id: "m2", kind: "xp-award", unit: "milestone", rule: "each", amount: 1, purseIds: ["bram"] }));
  assert.equal(again.purses.find((p) => p.id === "bram")!.sheet!.milestoneLevel, 5, "milestones add up before levelling");
  const npc = applyCommand(t, dm, award("n1", { purseIds: ["aria", "vex"] }));
  assert.equal(npc.journal!.events.at(-1)!.dmOnly, true, "an NPC recipient makes the entry DM-only, as a coin split");
  assert.throws(() => applyCommand(t, ariaSeat, award("p1", {})), /Only the DM/);
  assert.throws(() => applyCommand(t, dm, award("r1", { remainderTo: "vex" })), /remainder/);
  assert.throws(() => applyCommand(t, dm, award("s1", { amount: 2 })), /too small/);
  assert.throws(() => applyCommand(t, dm, award("h1", { purseIds: ["hoard"] })), /party fund/);
  assert.throws(() => applyCommand(t, dm, award("d1", { purseIds: ["aria", "aria"] })), /once/);
  assert.throws(() => commandSchema.parse({ id: "z", kind: "xp-award", unit: "xp", rule: "each", amount: 1_000_001, purseIds: ["aria"] }));
  assert.throws(() => planXpAward(t, { unit: "milestone", rule: "split", amount: 1, purseIds: ["aria"] }), /milestones/);
});

test("players can't set their own XP unless they may edit the level; older sheet edits keep XP", () => {
  const t = campaign();
  const aria = t.purses.find((p) => p.id === "aria")!;
  const before = characterSheet(aria, t.holdings);
  const cheat = { id: "c1", kind: "character" as const, purseId: "aria", before, sheet: { ...before, xp: 99999 } };
  assert.throws(() => applyCommand(t, ariaSeat, commandSchema.parse(cheat)), /Only the DM can award XP/);
  // An older client (protocol 20) knows neither field: its HP edit keeps the stored XP.
  const { xp: _xp, ...oldBefore } = before;
  const hp = applyCommand(t, ariaSeat, commandSchema.parse({ id: "c2", kind: "character", purseId: "aria", before: oldBefore, sheet: { ...oldBefore, hp: 5 } }));
  assert.equal(hp.purses.find((p) => p.id === "aria")!.sheet!.xp, 600);
  assert.equal(hp.purses.find((p) => p.id === "aria")!.sheet!.hp, 5);
  // The DM's older whole-purse write neither conflicts nor erases it.
  const row = structuredClone(aria);
  delete row.sheet!.xp;
  const patched = applyCommand(t, dm, commandSchema.parse({ id: "c3", kind: "patch", changes: [{ store: "purses", id: "aria", before: row, after: { ...row, name: "Aria the Bold" } }] }));
  const after = patched.purses.find((p) => p.id === "aria")!;
  assert.deepEqual([after.name, after.sheet!.xp], ["Aria the Bold", 600]);
  // With "Level" editing allowed, the player may correct XP.
  const open = campaign();
  open.purses.find((p) => p.id === "aria")!.permissions = { level: true };
  const fixed = applyCommand(open, ariaSeat, commandSchema.parse({ ...cheat, id: "c4", sheet: { ...before, xp: 650 } }));
  assert.equal(fixed.purses.find((p) => p.id === "aria")!.sheet!.xp, 650);
});

test("protocol 21: older clients get sheets without XP; their drafts with awards are refused", () => {
  const t = applyCommand(campaign(), dm, award("pr1", {}));
  assert.equal(XP_PROTOCOL, 21);
  assert.ok(CURRENT_TABLETOP_PROTOCOL >= XP_PROTOCOL);
  const old = tableForProtocol(t, 20);
  assert.equal(old.purses.find((p) => p.id === "aria")!.sheet!.xp, undefined);
  assert.equal(old.purses.find((p) => p.id === "aria")!.sheet!.level, 2);
  assert.equal(tableForProtocol(t, 21).purses.find((p) => p.id === "aria")!.sheet!.xp, 933);
  assert.equal(t.purses.find((p) => p.id === "aria")!.sheet!.xp, 933, "the stored table is unchanged");
  assert.throws(() => tabletopResponse({ table: t, draft: JSON.stringify([{ kind: "xp-award" }]) }, 20), /unfinished/);
  assert.doesNotThrow(() => tabletopResponse({ table: t, draft: JSON.stringify([{ kind: "xp-award" }]) }, 21));
  // Old saves without the fields read unchanged.
  const plain = campaign();
  assert.deepEqual(tableForProtocol(plain, 20).purses.find((p) => p.id === "bram"), plain.purses.find((p) => p.id === "bram"));
});

test("shared rooms: a retry applies once, players are refused, and projections hide others' sheets", async () => {
  const room = await openRoom({ name: "XP DM", table: campaign() });
  const aria = await joinRoom({ code: room.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: room.code, purseId: "bram", name: "Bram" });
  await choosePace({ code: room.code, token: room.token, live: true });
  const DT = { code: room.code, token: room.token };
  const AT = { code: room.code, token: aria.token };
  const BT = { code: room.code, token: bram.token };
  const cmd = award("room-1", { remainderTo: "aria" });
  await submitCommands({ ...DT, batchId: "room-1", commands: [cmd] });
  await submitCommands({ ...DT, batchId: "room-1", commands: [cmd] });
  let table = (await roomState(DT)).table;
  assert.deepEqual([xpOf(table, "aria"), xpOf(table, "bram")], [934, 333], "a retry changes nothing");
  assert.equal(table.journal!.events.filter((e) => e.summary.startsWith("XP award")).length, 1);
  await assert.rejects(submitCommands({ ...AT, batchId: "room-2", commands: [award("room-2", {})] }), /Only the DM/);
  table = (await roomState(DT)).table;
  assert.equal(xpOf(table, "aria"), 934);
  const bramView = (await roomState(BT)).table;
  assert.equal(bramView.purses.find((p) => p.id === "bram")!.sheet!.xp, 333, "Bram reads his own XP");
  assert.equal(bramView.purses.find((p) => p.id === "aria")?.sheet, undefined, "never another player's sheet");
  assert.equal(bramView.purses.find((p) => p.id === "vex")?.sheet, undefined, "nor an NPC sheet he can't read");
  assert.ok(bramView.journal!.events.some((e) => e.summary.startsWith("XP award: 1,000 XP split among 3")), "the party sees who got what");
  // An award that includes an NPC is DM-only text.
  await submitCommands({ ...DT, batchId: "room-3", commands: [award("room-3", { rule: "each", amount: 50, purseIds: ["bram", "vex"] })] });
  const later = (await roomState(BT)).table;
  assert.equal(later.journal!.events.some((e) => e.summary.includes("50 XP each")), false);
  assert.equal(later.purses.find((p) => p.id === "bram")!.sheet!.xp, 383);
  // An older client's view has no XP at all.
  const oldView = tabletopResponse(await roomState({ ...BT, tabletopProtocol: 20 }), 20).table;
  assert.equal(oldView.purses.find((p) => p.id === "bram")!.sheet!.xp, undefined);
});

test("privacy: a milestone award's shared entry never reveals another player's level", async () => {
  const room = await openRoom({ name: "Milestone DM", table: campaign() });
  const aria = await joinRoom({ code: room.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: room.code, purseId: "bram", name: "Bram" });
  await choosePace({ code: room.code, token: room.token, live: true });
  const cmd = commandSchema.parse({ id: "ms-1", kind: "xp-award", unit: "milestone", rule: "each", amount: 2, purseIds: ["aria", "bram"] });
  await submitCommands({ code: room.code, token: room.token, batchId: "ms-1", commands: [cmd] });
  for (const [seat, other] of [[aria, "Bram"], [bram, "Aria"]] as const) {
    const view = (await roomState({ code: room.code, token: seat.token })).table;
    const text = JSON.stringify(view.journal!.events);
    assert.ok(text.includes("Milestone award: 2 milestones to Aria Thorne and Bram Ironfoot"));
    assert.doesNotMatch(text, /level/i, `${other}'s level stays private`);
    assert.equal(view.purses.find((p) => p.name.startsWith(other))?.sheet, undefined);
  }
  const ariaOwn = (await roomState({ code: room.code, token: aria.token })).table.purses.find((p) => p.id === "aria")!;
  assert.equal(ariaOwn.sheet!.milestoneLevel, 4, "Aria's own sheet shows her milestone level");
});

test("the imported Experience box: locked players can't change it; Level permission or the DM can", () => {
  const legacy = (experience: string) =>
    ({ ...campaign().sheets[0], experience, purseId: "cyd" }) as CharacterSheet;
  const cydSeat: CloudSeat = { id: "c", token: "", name: "Cyd", role: "player", purseIds: ["cyd"] };
  const t = campaign();
  assert.throws(
    () => applyCommand(t, cydSeat, commandSchema.parse({ id: "l1", kind: "sheet", sheet: legacy("300000"), before: legacy("2,650") })),
    /Only the DM can award XP/,
  );
  assert.equal(t.sheets[0].experience, "2,650", "nothing changed");
  assert.equal(planXpAward(t, { unit: "xp", rule: "each", amount: 1, purseIds: ["cyd"] }).shares[0].after, 2651);
  const open = campaign();
  open.purses.find((p) => p.id === "cyd")!.permissions = { level: true };
  const allowed = applyCommand(open, cydSeat, commandSchema.parse({ id: "l2", kind: "sheet", sheet: legacy("3,000"), before: legacy("2,650") }));
  assert.equal(allowed.sheets.find((s) => s.purseId === "cyd")!.experience, "3,000");
  const byDm = applyCommand(campaign(), dm, commandSchema.parse({ id: "l3", kind: "sheet", sheet: legacy("4,000"), before: legacy("2,650") }));
  assert.equal(byDm.sheets.find((s) => s.purseId === "cyd")!.experience, "4,000");
  // Once the play sheet tracks XP, the imported box is never read again.
  const awarded = applyCommand(byDm, dm, commandSchema.parse({ id: "l4", kind: "xp-award", unit: "xp", rule: "each", amount: 10, purseIds: ["cyd"] }));
  const later = applyCommand(awarded, dm, commandSchema.parse({ id: "l5", kind: "sheet", sheet: legacy("300000"), before: legacy("4,000") }));
  assert.equal(planXpAward(later, { unit: "xp", rule: "each", amount: 1, purseIds: ["cyd"] }).shares[0].before, 4010);
});

test("offline: the same command gives the same sheets and entry, and a retry applies once", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const cmd = award("device-1", { remainderTo: "cyd" });
  await executeLocalCommand(cmd);
  const once = await economySnapshot();
  await executeLocalCommand(cmd);
  const twice = await economySnapshot();
  assert.deepEqual(twice.purses, once.purses);
  const shared = applyCommand(campaign(), dm, cmd);
  const byId = (rows: Purse[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(once.purses), byId(shared.purses));
  assert.deepEqual(
    once.journal!.events.map((e) => e.summary),
    shared.journal!.events.map((e) => e.summary),
  );
  assert.equal(xpOf(shared, "cyd"), 2650 + 334);
  setSeat({ ...DM_SEAT, role: "player", purseIds: ["aria"] } as never);
  const refused = await executeLocalCommand(award("device-2", {})).catch((e: Error) => e.message);
  assert.match(String(refused), /DM/);
  setSeat(DM_SEAT);
});
