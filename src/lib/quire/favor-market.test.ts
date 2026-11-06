// The favor market (owner design 2026-11-05, PR B of factions): each faction's DM-written market,
// players' requests with their own character's Favor, the DM's approval (spends once, never below
// 0), decline, withdraw and direct purchase. These tests pin the logic, replay, the server's
// permission checks, the device's parity with the shared engine, old data and older clients, and
// the player projection (only visible entries of visible factions, only the seat's own requests,
// a secret only to its buyer).
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
import { seatView } from "./player-view.ts";
import { fromCopper } from "./money.ts";
import { defaultFactionDraft, factionSchema, readFactions, type FactionDraft } from "./factions.ts";
import { FAVOR_TEMPLATES, type FavorEntry } from "./favor-market-schema.ts";
import { pendingFavorRequests } from "./favor-market.ts";
import { CURRENT_TABLETOP_PROTOCOL, FACTIONS_PROTOCOL, FAVOR_MARKET_PROTOCOL, tabletopResponse } from "./tabletop-protocol.ts";

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
    purses: [pc("aria", "Aria Thorne"), pc("bram", "Bram Ironfoot"), { ...pc("npc", "Hired Blade"), control: "npc" as const }],
    journal: readJournal({ finance: { day: 1 } }),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const bramSeat: CloudSeat = { id: "b", token: "", name: "Bram", role: "player", purseIds: ["bram"] };
const draft = (name: string, extra: Partial<FactionDraft> = {}): FactionDraft => ({
  ...defaultFactionDraft(),
  name,
  description: `${name}, as the party knows it.`,
  ...extra,
});
const entry = (id: string, extra: Partial<FavorEntry> = {}): FavorEntry => ({
  id,
  name: `Entry ${id}`,
  description: "",
  cost: 5,
  kind: "favor",
  available: true,
  hidden: false,
  ...extra,
});
const put = (id: string, factionId: string, revision: number, e: FavorEntry | null, entryId = e?.id ?? ""): Command => ({
  id, kind: "favor-entry", factionId, revision, entryId, entry: e,
});
const ask = (id: string, factionId: string, entryId: string, characterId: string, cost = 5, note?: string): Command => ({
  id, kind: "favor-request", factionId, entryId, characterId, cost, ...(note ? { note } : {}),
});
const decide = (id: string, factionId: string, requestId: string, approve: boolean, reply?: string): Command => ({
  id, kind: "favor-decision", factionId, requestId, approve, ...(reply ? { reply } : {}),
});
const run = (t: CloudTable, ...cmds: Command[]) => cmds.reduce((next, c) => applyCommand(next, dmSeat, c), t);
const as = (seat: CloudSeat, t: CloudTable, ...cmds: Command[]) => cmds.reduce((next, c) => applyCommand(next, seat, c), t);
const factionsOf = (t: CloudTable) => readFactions((t.journal as { factions?: unknown }).factions);
const faction = (t: CloudTable, id: string) => factionsOf(t).find((f) => f.id === id)!;
const favor = (t: CloudTable, factionId: string, characterId: string) => faction(t, factionId).standing[characterId]?.[1] ?? 0;

/**
 * The Black Hand (visible): a safe house (3), a rumour with secret text (4), a hidden entry and an
 * unavailable one. The Pale Court (hidden) with its own entry. Aria has 10 Favor with each, Bram 6.
 */
function world(): CloudTable {
  return run(
    campaign(),
    { id: "s1", kind: "faction-save", factionId: "hand", revision: null, faction: draft("The Black Hand") },
    { id: "s2", kind: "faction-save", factionId: "court", revision: null, faction: draft("The Pale Court") },
    { id: "v1", kind: "faction-visibility", factionId: "hand", revision: 0, hidden: false },
    put("m1", "hand", 1, entry("safe", { name: "Safe house for a night", cost: 3, kind: "service", note: "The cellar under the tannery" })),
    put("m2", "hand", 2, entry("rumour", { name: "A rumour about a rival", cost: 4, kind: "secret", secret: "The harbourmaster takes bribes." })),
    put("m3", "hand", 3, entry("vault", { name: "The vault key", cost: 9, kind: "item", hidden: true })),
    put("m4", "hand", 4, entry("closed", { name: "Passage on the next ship", available: false })),
    put("m5", "court", 0, entry("mask", { name: "A court mask", cost: 2 })),
    { id: "r1", kind: "faction-renown", factionId: "hand", characters: [{ characterId: "aria", delta: 10 }, { characterId: "bram", delta: 6 }], reason: "Deeds" },
    { id: "r2", kind: "faction-renown", factionId: "court", characters: [{ characterId: "aria", delta: 10 }], reason: "Deeds" },
  );
}

test("market: no default entries, templates only fill the form, DM edits are revision-checked and kept by faction edits", () => {
  const fresh = run(campaign(), { id: "s1", kind: "faction-save", factionId: "hand", revision: null, faction: draft("The Black Hand") });
  assert.equal(faction(fresh, "hand").favorMarket, undefined, "a new faction's market starts empty");
  assert.ok(FAVOR_TEMPLATES.length >= 5 && FAVOR_TEMPLATES.some((t) => t.name === "Forged papers"));
  const t = world();
  assert.deepEqual(faction(t, "hand").favorMarket!.map((e) => e.id), ["safe", "rumour", "vault", "closed"]);
  assert.equal(faction(t, "hand").revision, 5);
  // Stale revision refused; edit in place; remove.
  assert.throws(() => run(t, put("e1", "hand", 1, entry("x"))), /changed on another device/);
  const edited = run(t, put("e2", "hand", 5, entry("safe", { name: "Safe house", cost: 2, kind: "service" })));
  assert.equal(faction(edited, "hand").favorMarket![0]!.cost, 2);
  const removed = run(edited, put("e3", "hand", 6, null, "closed"));
  assert.deepEqual(faction(removed, "hand").favorMarket!.map((e) => e.id), ["safe", "rumour", "vault"]);
  assert.throws(() => run(t, put("e4", "hand", 5, entry("other"), "safe")), /own ID/);
  // Editing the faction itself keeps its market, requests and standing.
  const asked = as(ariaSeat, t, ask("q1", "hand", "safe", "aria", 3));
  const resaved = run(asked, { id: "e5", kind: "faction-save", factionId: "hand", revision: 5, faction: draft("The Black Hand", { description: "New words" }) });
  assert.deepEqual(faction(resaved, "hand").favorMarket, faction(asked, "hand").favorMarket);
  assert.deepEqual(faction(resaved, "hand").favorRequests, faction(asked, "hand").favorRequests);
  // Market edits are DM-only history.
  assert.ok(t.journal!.events.filter((e) => e.id.startsWith("m")).every((e) => e.dmOnly));
});

test("requests: approve spends once and never below 0, decline, withdraw, direct purchase, refused prices", () => {
  let t = world();
  // Aria asks for the rumour (4) and the safe house (3); Bram asks for the rumour (4).
  t = as(ariaSeat, t, ask("q1", "hand", "rumour", "aria", 4, "Who runs the docks?"), ask("q2", "hand", "safe", "aria", 3));
  t = as(bramSeat, t, ask("q3", "hand", "rumour", "bram", 4));
  assert.equal(favor(t, "hand", "aria"), 10, "asking spends nothing");
  assert.equal(pendingFavorRequests(factionsOf(t)), 3);
  // Approve: the agreed cost is spent and the secret copied onto the purchase.
  t = run(t, decide("d1", "hand", "q1", true, "Meet at midnight"));
  assert.equal(favor(t, "hand", "aria"), 6);
  const bought = faction(t, "hand").favorRequests!.find((r) => r.id === "q1")!;
  assert.equal(bought.status, "approved");
  assert.equal(bought.secret, "The harbourmaster takes bribes.");
  assert.equal(bought.reply, "Meet at midnight");
  assert.throws(() => run(t, decide("d1b", "hand", "q1", true)), /already approved/);
  // The DM spends Aria's Favor down so the safe house is short: refused, nothing changes.
  t = run(t, { id: "g1", kind: "faction-favor-grant", factionId: "hand", characters: [{ characterId: "aria", delta: -4 }], reason: "Spent at the table" });
  assert.equal(favor(t, "hand", "aria"), 2);
  assert.throws(() => run(t, decide("d2", "hand", "q2", true)), /only 2 Favor/);
  assert.equal(faction(t, "hand").favorRequests!.find((r) => r.id === "q2")!.status, "pending");
  // Decline with a reply; Bram withdraws his own.
  t = run(t, decide("d3", "hand", "q2", false, "Not this week"));
  assert.equal(faction(t, "hand").favorRequests!.find((r) => r.id === "q2")!.reply, "Not this week");
  t = as(bramSeat, t, { id: "w1", kind: "favor-withdraw", factionId: "hand", requestId: "q3" });
  assert.equal(faction(t, "hand").favorRequests!.find((r) => r.id === "q3")!.status, "withdrawn");
  assert.equal(favor(t, "hand", "bram"), 6);
  // Direct purchase by the DM, at the entry's price, refused when short.
  t = run(t, { id: "p1", kind: "favor-purchase", factionId: "hand", entryId: "safe", characterId: "bram", cost: 3 });
  assert.equal(favor(t, "hand", "bram"), 3);
  assert.equal(faction(t, "hand").favorRequests!.find((r) => r.id === "p1")!.direct, true);
  assert.throws(() => run(t, { id: "p2", kind: "favor-purchase", factionId: "hand", entryId: "rumour", characterId: "bram", cost: 4 }), /only 3 Favor/);
  // A request needs the price the player saw and enough Favor; spending all leaves no entry.
  assert.throws(() => as(bramSeat, t, ask("q4", "hand", "safe", "bram", 2)), /price of Safe house for a night changed to 3/);
  assert.throws(() => as(ariaSeat, t, ask("q5", "hand", "rumour", "aria", 4)), /only 2 Favor/);
  t = run(t, { id: "p3", kind: "favor-purchase", factionId: "hand", entryId: "safe", characterId: "bram", cost: 3 });
  assert.deepEqual(faction(t, "hand").standing.bram, [6, 0]);
  // History: who, change and what, on the character's purse; never the secret's text.
  const lines = t.journal!.events.filter((e) => e.factionId === "hand" && /asked|Favor with|declined|withdrew/.test(e.summary));
  assert.deepEqual(
    lines.map((e) => [e.purseId, e.summary]).filter(([, s]) => !s!.includes("renown")),
    [
      ["aria", "Aria Thorne asked The Black Hand for A rumour about a rival (4 Favor)"],
      ["aria", "Aria Thorne asked The Black Hand for Safe house for a night (3 Favor)"],
      ["bram", "Bram Ironfoot asked The Black Hand for A rumour about a rival (4 Favor)"],
      ["aria", "Aria Thorne: Favor with The Black Hand −4 (now 6) · A rumour about a rival"],
      ["aria", "Aria Thorne: Favor with The Black Hand −4 (now 2) · Spent at the table"],
      ["aria", "The Black Hand declined Aria Thorne's request for Safe house for a night"],
      ["bram", "Bram Ironfoot withdrew a request to The Black Hand for A rumour about a rival"],
      ["bram", "Bram Ironfoot: Favor with The Black Hand −3 (now 3) · Safe house for a night"],
      ["bram", "Bram Ironfoot: Favor with The Black Hand −3 (now 0) · Safe house for a night"],
    ],
  );
  assert.ok(!JSON.stringify(t.journal!.events).includes("harbourmaster takes bribes"));
  // Waiting requests per character are capped.
  let many = world();
  many = run(many, { id: "g2", kind: "faction-favor-grant", factionId: "hand", characters: [{ characterId: "aria", delta: 1000 }], reason: "x" });
  for (let i = 0; i < 10; i++) many = as(ariaSeat, many, ask(`c${i}`, "hand", "safe", "aria", 3));
  assert.throws(() => as(ariaSeat, many, ask("c10", "hand", "safe", "aria", 3)), /10 requests waiting/);
});

test("permissions: players only ask for their own characters, on visible factions and entries; the rest is the DM's", () => {
  const t = world();
  for (const cmd of [
    put("x1", "hand", 5, entry("new")),
    decide("x2", "hand", "q1", true),
    { id: "x3", kind: "favor-purchase", factionId: "hand", entryId: "safe", characterId: "aria", cost: 3 },
  ] as Command[])
    assert.throws(() => applyCommand(as(ariaSeat, t, ask("q1", "hand", "safe", "aria", 3)), ariaSeat, cmd), /Only the DM/);
  assert.throws(() => as(ariaSeat, t, ask("x4", "hand", "safe", "bram", 3)), /your own character/);
  // Hidden faction, hidden entry, unavailable entry and a missing one all read alike.
  for (const [factionId, entryId] of [["court", "mask"], ["hand", "vault"], ["hand", "closed"], ["hand", "nope"], ["nope", "safe"]])
    assert.throws(() => as(ariaSeat, t, ask("x5", factionId!, entryId!, "aria", factionId === "court" ? 2 : 5)), /isn't on offer/, `${factionId}/${entryId}`);
  // Bram can't withdraw (or learn of) Aria's request.
  const asked = as(ariaSeat, t, ask("q1", "hand", "safe", "aria", 3));
  assert.throws(() => as(bramSeat, asked, { id: "x6", kind: "favor-withdraw", factionId: "hand", requestId: "q1" }), /no longer exists/);
  // NPCs can't buy; the DM may sell a hidden entry directly.
  assert.throws(() => run(t, { id: "x7", kind: "favor-purchase", factionId: "hand", entryId: "safe", characterId: "npc", cost: 3 }), /player character/);
  run(t, { id: "x8", kind: "favor-purchase", factionId: "court", entryId: "mask", characterId: "aria", cost: 2 });
  // A deleted faction's market is closed until restored.
  const gone = run(t, { id: "x9", kind: "faction-delete", factionId: "hand", revision: 5, deleted: true });
  assert.throws(() => run(gone, { id: "x10", kind: "favor-purchase", factionId: "hand", entryId: "safe", characterId: "aria", cost: 3 }), /Restore/);
});

test("projection: visible entries without secrets or notes, only the seat's own requests, a secret only to its buyer", () => {
  let t = world();
  t = as(ariaSeat, t, ask("q1", "hand", "rumour", "aria", 4), ask("q2", "hand", "safe", "aria", 3));
  t = as(bramSeat, t, ask("q3", "hand", "rumour", "bram", 4, "Bram's private note"));
  t = run(t, decide("d1", "hand", "q1", true), decide("d3", "hand", "q3", true), { id: "p1", kind: "favor-purchase", factionId: "court", entryId: "mask", characterId: "aria", cost: 2 });
  const aria = projectRecord(t, ariaSeat);
  const text = JSON.stringify(aria);
  for (const secret of ["The vault key", "tannery", "Bram's private note", "Pale Court", "court mask"])
    assert.ok(!text.includes(secret), `Aria's copy holds ${secret}`);
  const hand = factionsOf(aria)[0]!;
  assert.deepEqual(hand.favorMarket!.map((e) => e.id), ["safe", "rumour", "closed"], "visible entries (unavailable ones shown)");
  assert.ok(hand.favorMarket!.every((e) => e.secret === undefined && e.note === undefined));
  assert.deepEqual(hand.favorRequests!.map((r) => [r.id, r.status, r.secret]), [
    ["q1", "approved", "The harbourmaster takes bribes."],
    ["q2", "pending", undefined],
  ]);
  // Bram bought the same secret: he reads his copy, never Aria's requests.
  const bram = factionsOf(projectRecord(t, bramSeat))[0]!;
  assert.deepEqual(bram.favorRequests!.map((r) => r.id), ["q3"]);
  assert.equal(bram.favorRequests![0]!.secret, "The harbourmaster takes bribes.");
  // A pending request never carries the secret, even if the stored record had one.
  const forged = structuredClone(t);
  const raw = (forged.journal as { factions: { favorRequests?: { id: string; secret?: string }[] }[] }).factions[0]!;
  raw.favorRequests!.find((r) => r.id === "q2")!.secret = "leak";
  assert.ok(!JSON.stringify(projectRecord(forged, ariaSeat)).includes("leak"));
  // Projecting again (an archive, a player's device) keeps the same; seatView matches the room.
  assert.deepEqual(factionsOf(projectRecord(aria, ariaSeat)), factionsOf(aria));
  assert.deepEqual(factionsOf(seatView(t, { purseIds: ["aria"] })), factionsOf(aria));
  // A guest without a seat sees no market at all; the DM keeps everything.
  assert.ok(!JSON.stringify(projectRecord(t, { ...ariaSeat, purseIds: [] }).journal).includes("Safe house"));
  assert.equal(faction(projectRecord(t, dmSeat), "hand").favorMarket!.length, 4);
  // Hidden again: the market, requests, secrets and their history go with the faction, in
  // archives too.
  const archived = structuredClone(t);
  archiveSession(archived, "s-old", "Old session", 1);
  const hidden = run(archived, { id: "h1", kind: "faction-visibility", factionId: "hand", revision: 5, hidden: true });
  const view = projectRecord(hidden, ariaSeat);
  for (const secret of ["Safe house", "harbourmaster", "Black Hand"]) assert.ok(!JSON.stringify(view).includes(secret), secret);
});

test("shared rooms: the server refuses players' DM actions, a retried approval spends once, the player's view", async () => {
  const dm = await openRoom({ name: "Favor DM", table: world() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const bram = await joinRoom({ code: dm.code, purseId: "bram", name: "Bram" });
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const P = FAVOR_MARKET_PROTOCOL;
  const DT = { code: dm.code, token: dm.token, tabletopProtocol: P };
  const AT = { code: dm.code, token: aria.token, tabletopProtocol: P };
  const BT = { code: dm.code, token: bram.token, tabletopProtocol: P };
  const state = async () => (await roomState(DT)).table;
  const request = ask("q1", "hand", "rumour", "aria", 4);
  await submitCommands({ ...AT, batchId: "q1", commands: [request] });
  await submitCommands({ ...AT, batchId: "q1", commands: [request] });
  assert.equal(faction(await state(), "hand").favorRequests!.length, 1, "a retried request is one request");
  await assert.rejects(submitCommands({ ...AT, batchId: "x1", commands: [decide("x1", "hand", "q1", true)] }), /Only the DM/);
  await assert.rejects(submitCommands({ ...BT, batchId: "x2", commands: [ask("x2", "hand", "safe", "aria", 3)] }), /own character/);
  const approve = decide("d1", "hand", "q1", true);
  await submitCommands({ ...DT, batchId: "d1", commands: [approve] });
  await submitCommands({ ...DT, batchId: "d1", commands: [approve] });
  assert.equal(favor(await state(), "hand", "aria"), 6, "a retried approval spends once");
  const view = (await roomState(AT)).table;
  assert.equal(factionsOf(view)[0]!.favorRequests![0]!.secret, "The harbourmaster takes bribes.");
  const bramView = JSON.stringify((await roomState(BT)).table);
  assert.ok(!bramView.includes("harbourmaster") && !bramView.includes("q1"));
});

test("offline parity: the device runs the same commands and errors, retries spend once, a player link is refused", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(world());
  const steps: Command[] = [
    ask("q1", "hand", "rumour", "aria", 4),
    ask("q2", "hand", "safe", "bram", 3),
    decide("d1", "hand", "q1", true, "Midnight"),
    decide("d2", "hand", "q2", false),
    { id: "p1", kind: "favor-purchase", factionId: "hand", entryId: "safe", characterId: "aria", cost: 3 },
    put("m9", "hand", 5, entry("new", { cost: 1 })),
  ];
  const shared = run(world(), ...steps);
  for (const s of steps) await executeLocalCommand(s);
  const once = await economySnapshot();
  for (const s of steps) await executeLocalCommand(s);
  const twice = await economySnapshot();
  // Same records apart from the clock.
  const timeless = (t: CloudTable) => JSON.parse(JSON.stringify(factionsOf(t), (k, v) => (k === "at" || k === "decidedAt" ? 0 : v)));
  assert.deepEqual(timeless(once), timeless(shared));
  assert.deepEqual(factionsOf(twice), factionsOf(once), "retries change nothing");
  assert.equal(favor(once, "hand", "aria"), 3);
  const logs = (t: CloudTable) => t.journal!.events.filter((e) => e.factionId || /Favor market/.test(e.summary)).map((e) => [e.id, e.summary, e.purseId, e.dmOnly, e.kind]);
  assert.deepEqual(logs(once), logs(shared));
  const over: Command = { id: "p2", kind: "favor-purchase", factionId: "hand", entryId: "rumour", characterId: "aria", cost: 4 };
  const sharedError = (() => {
    try {
      run(shared, over);
    } catch (e) {
      return (e as Error).message;
    }
  })();
  assert.match(String(sharedError), /only 3 Favor/);
  assert.equal(await executeLocalCommand(over).catch((e: Error) => e.message), sharedError);
  // A player link holds a copy: its requests would never reach the DM.
  setSeat({ role: "player", purseIds: ["aria"], shopIds: [], openedAt: 0 });
  await applyCloudTable(seatView(shared, { purseIds: ["aria"] }));
  const refused = await executeLocalCommand(ask("q9", "hand", "new", "aria", 1)).catch((e: Error) => e.message);
  assert.match(String(refused), /Ask the DM/);
  setSeat(DM_SEAT);
});

test("old data and older apps: PR A factions read back, PR A's reader drops the market, drafts ask protocol 29 to update", () => {
  // A faction stored before the favor market reads unchanged.
  const t = run(campaign(), { id: "s1", kind: "faction-save", factionId: "hand", revision: null, faction: draft("The Black Hand") });
  const raw = JSON.parse(JSON.stringify(t.journal));
  assert.equal(readFactions(readJournal(raw).factions)[0]!.favorMarket, undefined);
  // PR A's faction schema (unknown keys stripped) reads a faction with a market: the market's
  // fields are dropped, nothing fails. Its stored copy is kept by the server.
  const withMarket = faction(world(), "hand");
  const prA = factionSchema.omit({ favorMarket: true, favorRequests: true });
  assert.equal("favorMarket" in prA.parse(withMarket), false);
  // Drafts (turn-based play) with favor commands ask protocol 29 apps to finish on the updated website.
  assert.equal(FAVOR_MARKET_PROTOCOL, 30);
  assert.ok(CURRENT_TABLETOP_PROTOCOL >= FAVOR_MARKET_PROTOCOL);
  const response = { table: t, draft: JSON.stringify([ask("q", "hand", "safe", "aria", 3)]) };
  assert.throws(() => tabletopResponse(response, FACTIONS_PROTOCOL), /updated website/);
  assert.equal(tabletopResponse(response, FAVOR_MARKET_PROTOCOL).table, t);
  const plain = { table: t, draft: "[]" };
  assert.equal(tabletopResponse(plain, FACTIONS_PROTOCOL).table, t, "protocol 29 still gets the table unchanged");
});
