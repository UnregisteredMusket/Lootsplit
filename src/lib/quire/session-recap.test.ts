// Session recap (loot plan phase 6): computed from a session's ledger lines and events, for the
// DM, the DM's party draft and a player's projection; old and archived sessions; and sharing it
// once as a party journal entry through `journal-note` (room and device, replay, refusals).
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { applyCommand } from "./commands.ts";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal } from "./journal.ts";
import { planCoinSplit, type CoinSplitInput } from "./coin-split.ts";
import { encounterCoinLine, encounterItemLine } from "./award-tag.ts";
import { projectRecord } from "./session-records.ts";
import { readArchiveResult } from "./archive-reader.ts";
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import {
  buildSessionRecap,
  liveRecapSource,
  NOTHING_RECORDED,
  RECAP_UNAVAILABLE,
  recapEntryId,
  recapText,
  type RecapAudience,
} from "./session-recap.ts";
import type { Purse, Shop, StockLine } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of ["0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql", "0029_campaign_room_report_parts.sql", "0030_campaign_room_archive_keys.sql", "0003_accounts.sql", "0008_encounters.sql"])
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

const DM: CloudSeat = { id: "dm-seat", token: "", name: "DM", role: "dm", purseIds: [] };
const coins = (c: Partial<Purse["coins"]>) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
const shop = (id: string, name: string, extra: Partial<Shop> = {}): Shop => ({
  id, name, keeper: "Hidden keeper Vex", place: "Port Ashby", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest",
  category: "general", priceScale: 1, acceptAnyCategory: true, ...extra,
});
const stock = (id: string, shopId: string, name: string, copper: number): StockLine => ({
  id, shopId, name, copper, quantity: null, notes: "", baseCopper: copper, rarity: "common",
});
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: coins({ gp: 200 }) },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 50 }) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 40 }) },
      { id: "dunstan", name: "Dunstan the porter", kind: "character", control: "npc", coins: coins({ gp: 1 }) },
      { id: "ghost", name: "Shade the hidden", kind: "character", coins: coins({ gp: 5 }) },
    ],
    holdings: [
      { id: "lute", purseId: "aria", name: "Old lute", kind: "item", quantity: 1, unitCopper: 400, notes: "" },
    ],
    shops: [shop("marlow", "Marlow's Curios"), shop("forge", "Ironhall Forge")],
    stock: [stock("rope", "marlow", "Rope", 100), stock("sword", "forge", "Longsword", 1500)],
    journal: readJournal({
      world: {
        characterPositions: [
          { purseId: "ghost", inParty: true, locationId: null, visible: false, sheetVisible: false },
        ],
      },
    }),
  };
}
function splitCommand(t: CloudTable, id: string, input: CoinSplitInput) {
  const plan = planCoinSplit(t, input, { actor: "dm" });
  return {
    id,
    kind: "coin-split" as const,
    sourceId: input.sourceId!,
    copper: input.copper,
    recipientIds: input.recipientIds,
    remainder: { rule: input.rule },
    expect: { share: plan.share, remainderTo: plan.remainderTo },
  };
}

/** One session with every kind of record the recap reads, DM-only parts included. */
function playedSession() {
  let t = applyCommand(campaign(), DM, { id: "s1", kind: "session", name: "The Drowned Vault", end: false });
  const session = readJournal(t.journal).sessions[0]!;
  const at = session.startedAt + 1;
  t = applyCommand(t, DM, { id: "buy-rope", kind: "buy", stockId: "rope", purseId: "aria", quantity: 2 });
  t = applyCommand(t, DM, { id: "buy-sword", kind: "buy", stockId: "sword", purseId: "bram", quantity: 1 });
  t = applyCommand(t, DM, { id: "buy-fund", kind: "buy", stockId: "rope", purseId: "hoard", quantity: 1 });
  t = applyCommand(t, DM, { id: "sell-lute", kind: "sell", holdingId: "lute", shopId: "marlow", quantity: 1 });
  t = applyCommand(t, DM, splitCommand(t, "split-plain", { sourceId: "hoard", copper: 2000, recipientIds: ["aria", "bram"], rule: "party-fund" }));
  // Pays an NPC: its receipt is DM-only and the NPC's share line is never a player's.
  t = applyCommand(t, DM, splitCommand(t, "split-npc", { sourceId: "hoard", copper: 3000, recipientIds: ["aria", "bram", "dunstan"], rule: "party-fund" }));
  t.ledger.push(
    encounterCoinLine("award-1", at, "aria", "Goblin camp", 1234),
    encounterItemLine("award-1", 0, at, "hoard", { name: "Potion of healing", quantity: 2, unitCopper: 5000 }, "Goblin camp"),
    // A hidden character's and another player's private lines.
    { id: "ghost-coins", at, purseId: "ghost", shopId: null, summary: "Encounter loot: Secret cache", copper: 999, transactionType: "adjustment", award: { receiptId: "award-ghost", role: "coins" } },
    { id: "fin-aria", at, purseId: "aria", shopId: null, summary: "Finance: Lifestyle", copper: -300, transactionType: "payment" },
    { id: "fin-bram", at, purseId: "bram", shopId: null, summary: "Finance: Bram's private debt", copper: -777, transactionType: "payment" },
  );
  const j = readJournal(t.journal);
  j.events.push(
    {
      id: "pool-1", at, kind: "management", summary: "Treasure pool resolved",
      lootResolution: {
        id: "pool-1", method: "manual",
        lots: [
          { holdingId: "gem", fundId: "hoard", name: "Star sapphire", poolQuantity: 2, quantity: 2, unitCopper: 1000, tier: "need", claims: [], unmarked: [], rolls: [], kept: 0,
            awards: [{ purseId: "aria", quantity: 1, choice: "need", holdingId: "gem-a" }, { purseId: "dunstan", quantity: 1, choice: "dm", holdingId: "gem-d" }] },
        ],
        npc: true,
      },
    },
    { id: "j1", at, kind: "session", summary: "Departed: Road to the coast · 0% of the route" },
    { id: "j2", at: at + 1, kind: "session", summary: "Travelled: Road to the coast · 100% of the route · arrived; waiting for the DM to move the party in" },
    { id: "j3", at: at + 2, kind: "management", summary: "Party location: Saltwind Harbour (journey arrived)" },
    { id: "j-hidden", at, kind: "session", dmOnly: true, summary: "Night raiders: Departed: Smugglers' tunnel · 0% of the route" },
    { id: "dm-note", at, kind: "management", dmOnly: true, summary: "Lesson approved: Secret rites with Hidden NPC Morwen · 5 gp." },
    { id: "lesson-aria", at, kind: "management", purseId: "aria", summary: "Lesson approved: Lute with Old Tam · 2 gp." },
    { id: "lesson-bram", at, kind: "management", purseId: "bram", summary: "Lesson approved: Bram's private tutoring with Old Tam · 3 gp." },
  );
  t.journal = j;
  return { t, session: readJournal(t.journal).sessions[0]! };
}
const ariaSeat = { id: "aria-seat", role: "player" as const, purseIds: ["aria"] };
const text = (t: CloudTable, session: Parameters<typeof buildSessionRecap>[1], audience: RecapAudience) =>
  recapText(buildSessionRecap(t, session, audience));
const PRIVATE = ["Dunstan", "Shade", "Secret cache", "Smugglers", "Night raiders", "Morwen", "Bram's private", "777", "Hidden keeper"];

test("the DM's recap groups loot, claims, purchases per shop, travel and downtime", () => {
  const { t, session } = playedSession();
  const recap = buildSessionRecap(t, session, { kind: "dm" });
  assert.deepEqual(recap.sections.map((s) => s.key), ["loot", "claims", "trade", "travel", "downtime"]);
  const out = recapText(recap);
  assert.match(out, /^The Drowned Vault/);
  assert.match(out, /Coin split from The Hoard: 20 gp among 2\./);
  assert.match(out, /Coin split from The Hoard: 30 gp among 3\./);
  assert.match(out, /Encounter loot: Goblin camp: 12 gp, 3 sp, 4 cp to Aria Thorne, 2 × Potion of healing to The Hoard\./);
  assert.match(out, /Treasure pool: Star sapphire × 1 to Aria Thorne, Star sapphire × 1 to Dunstan the porter\./);
  assert.match(out, /Marlow's Curios: bought 2 times for 3 gp; sold 1 time for 2 gp\./);
  assert.match(out, /Ironhall Forge: bought 1 time for 15 gp\./);
  assert.match(out, /Set out: Road to the coast\./);
  assert.match(out, /Arrived: Road to the coast\./);
  assert.match(out, /The party moved in at Saltwind Harbour\./);
  assert.match(out, /Night raiders: Set out: Smugglers' tunnel\./, "the DM's own view keeps hidden groups");
  assert.match(out, /Downtime finances: paid 10 gp, 7 sp, 7 cp\./);
});

test("the DM's party draft never names NPCs, hidden characters or DM-only records", () => {
  const { t, session } = playedSession();
  const out = text(t, session, { kind: "party" });
  for (const secret of PRIVATE) assert.ok(!out.includes(secret), `party draft leaks ${secret}:\n${out}`);
  assert.match(out, /Coin split from The Hoard: 10 gp to Aria Thorne, 10 gp to Bram Ironfoot\./);
  assert.match(out, /Treasure pool: Star sapphire × 1 to Aria Thorne\./);
  // A character's own purchases, finances and services are its player's: only the fund's count.
  assert.match(out, /Marlow's Curios: bought 1 time for 1 gp\./);
  assert.ok(!out.includes("Ironhall Forge") && !out.includes("sold"), out);
  assert.ok(!out.includes("Old Tam") && !out.includes("Downtime finances"), out);
  assert.match(out, /The party moved in at Saltwind Harbour\./);
});

test("the party draft leaves out characters away from the party or on downtime", () => {
  const { t, session } = playedSession();
  const at = session.startedAt + 1;
  t.purses.push(
    { id: "wren", name: "Wren on downtime", kind: "character", coins: coins({}) },
    { id: "ossia", name: "Ossia far away", kind: "character", coins: coins({}) },
  );
  const j = readJournal(t.journal);
  j.world!.characterPositions.push(
    {
      purseId: "wren", inParty: true, locationId: null, visible: true, sheetVisible: true,
      downtime: { id: "dt", name: "Studying", startedMinute: 0, finishMinute: 600, returnInParty: true, returnLocationId: null },
    },
    { purseId: "ossia", inParty: false, locationId: null, visible: true, sheetVisible: true },
  );
  for (const id of ["wren", "ossia"]) {
    t.ledger.push(
      encounterCoinLine(`award-${id}`, at, id, "Lonely errand", 500),
      { id: `${id}-share`, at, purseId: id, shopId: null, summary: "Split share from The Hoard", copper: 100, transactionType: "transfer", split: { id: `split-${id}`, role: "share" } },
    );
    j.events.push({
      id: `pool-${id}`, at, kind: "management", summary: "Treasure pool resolved",
      lootResolution: {
        id: `pool-${id}`, method: "manual",
        lots: [{ holdingId: `lot-${id}`, fundId: "hoard", name: `Charm for ${id}`, poolQuantity: 1, quantity: 1, unitCopper: 100, tier: null, claims: [], unmarked: [], rolls: [], kept: 0,
          awards: [{ purseId: id, quantity: 1, choice: "dm", holdingId: `got-${id}` }] }],
      },
    });
  }
  t.journal = j;
  const out = text(t, session, { kind: "party" });
  for (const secret of ["Wren", "Ossia", "Lonely errand", "Charm for"]) assert.ok(!out.includes(secret), `party draft names ${secret}:\n${out}`);
  // The DM's own view still has them.
  const dmView = text(t, session, { kind: "dm" });
  assert.match(dmView, /Lonely errand: 5 gp to Wren on downtime\./);
  assert.match(dmView, /Charm for ossia × 1 to Ossia far away/);
});

test("a player's live recap never falls back to unprojected records", () => {
  const { t } = playedSession();
  const failed = liveRecapSource(t, false, () => {
    throw Error("projection failed");
  });
  assert.deepEqual(failed, { error: RECAP_UNAVAILABLE });
  const projected = liveRecapSource(t, false, (x) => projectRecord(x as CloudTable, ariaSeat));
  assert.ok("source" in projected && projected.source !== t);
  assert.ok("source" in projected && !projected.source.ledger.some((l) => l.purseId === "bram"));
  const dm = liveRecapSource(t, true, () => {
    throw Error("never called for the DM");
  });
  assert.ok("source" in dm && dm.source === t);
});

test("a player's recap comes from their projection only", () => {
  const { t, session } = playedSession();
  const projected = projectRecord(t, ariaSeat);
  const out = text(projected, session, { kind: "player", purseIds: ["aria"] });
  for (const secret of PRIVATE) assert.ok(!out.includes(secret), `player recap leaks ${secret}:\n${out}`);
  assert.ok(!out.includes("Bram Ironfoot"), "another player's purse never appears");
  assert.ok(!out.includes("Ironhall Forge"), "another player's purchase never appears");
  assert.match(out, /Coin split from The Hoard: your share 10 gp\./);
  assert.match(out, /your share 10 gp\./);
  assert.match(out, /Encounter loot: Goblin camp: 12 gp, 3 sp, 4 cp to Aria Thorne/);
  assert.match(out, /Lesson approved: Lute with Old Tam · 2 gp\./);
  assert.match(out, /Downtime finances: paid 3 gp\./);
  // Even an unprojected table gives a player audience only its own and the party's records.
  const direct = text(t, session, { kind: "player", purseIds: ["aria"] });
  for (const secret of PRIVATE) assert.ok(!direct.includes(secret), `player audience leaks ${secret}`);
});

test("an archived session gives the same recap from its report, for the DM and a player", () => {
  const { t, session } = playedSession();
  const liveDm = text(t, session, { kind: "dm" });
  const livePlayer = text(projectRecord(t, ariaSeat), session, { kind: "player", purseIds: ["aria"] });
  // End, then start the next session as two actions (one "End & start next" action currently
  // keeps only the archive: reported separately, outside this feature).
  const closed = applyCommand(t, DM, { id: "end-s1", kind: "session", name: session.name, end: true });
  const ended = applyCommand(closed, DM, { id: "s2", kind: "session", name: "Next", end: false });
  const journal = readJournal(ended.journal);
  const archivedSession = journal.sessions.find((s) => s.id === session.id)!;
  const report = journal.reports!.find((r) => r.id === session.id)!;
  assert.equal(ended.ledger.length, 0, "the live working set no longer holds the session");
  const dmSnap = readArchiveResult(report, { role: "dm", purseIds: [] });
  assert.ok(dmSnap.available);
  assert.equal(text(dmSnap.snapshot, archivedSession, { kind: "dm" }), liveDm);
  const playerSnap = readArchiveResult(report, ariaSeat);
  assert.ok(playerSnap.available);
  assert.equal(text(playerSnap.snapshot, archivedSession, { kind: "player", purseIds: ["aria"] }), livePlayer);
  // The next session starts empty.
  assert.equal(text(ended, journal.sessions.find((s) => s.id === "s2")!, { kind: "dm" }), `Next\n\n${NOTHING_RECORDED}.`);
});

test("old sessions read by their summaries; empty or damaged records never throw", () => {
  const session = { id: "old", name: "Before receipts", startedAt: 10, endedAt: 100 };
  const legacy: CloudTable = {
    ...campaign(),
    ledger: [
      { id: "l1", at: 20, purseId: "aria", shopId: "marlow", summary: "Bought 1 Rope from Marlow's Curios", copper: -100 },
      { id: "l2", at: 21, purseId: "aria", shopId: null, summary: "Encounter loot: Wolf den", copper: 500 },
      { id: "l3", at: 22, purseId: "aria", shopId: null, summary: "Encounter loot: 1 × Wolf pelt (Wolf den)", copper: 0 },
      { id: "l4", at: 23, purseId: "aria", shopId: "gone", summary: "Sold 1 Lantern to Old Mill Store", copper: 50 },
      { id: "late", at: 500, purseId: "aria", shopId: null, summary: "Encounter loot: Later", copper: 1 },
    ],
    journal: { sessions: [session], events: [{ id: "e", at: 30, kind: "session", summary: "Applied approved downtime finances once" }], requests: [] } as never,
  };
  const out = text(legacy, session, { kind: "dm" });
  assert.match(out, /Encounter loot: Wolf den: 5 gp to Aria Thorne, 1 × Wolf pelt to Aria Thorne\./);
  assert.match(out, /Marlow's Curios: bought 1 time for 1 gp\./);
  assert.match(out, /Old Mill Store: sold 1 time for 5 sp\./);
  assert.match(out, /Downtime approved and applied\./);
  assert.ok(!out.includes("Later"), "lines after the session's end are not this session's");
  const empty = { id: "e", name: "Quiet night", startedAt: 1 };
  assert.equal(text({ ...emptyCloudTable() }, empty, { kind: "dm" }), `Quiet night\n\n${NOTHING_RECORDED}.`);
  assert.equal(text({ ...emptyCloudTable(), journal: { nonsense: 1, events: "broken" } as never }, empty, { kind: "player", purseIds: [] }), `Quiet night\n\n${NOTHING_RECORDED}.`);
});

const share = (sessionId: string, words: string) => ({
  id: recapEntryId(sessionId),
  kind: "journal-note" as const,
  title: "Recap: The Drowned Vault",
  text: words,
  visibility: "party" as const,
  purseId: "",
  reportIds: [],
});

test("sharing posts the DM's text once; players cannot post or forge a recap", () => {
  const { t, session } = playedSession();
  const once = applyCommand(t, DM, share(session.id, "We braved the vault."));
  const entries = readJournal(once.journal).entries!.filter((e) => e.id === recapEntryId(session.id));
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.text, "We braved the vault.");
  assert.equal(entries[0]!.visibility, "party");
  // The only stored recap data is that entry: the table is otherwise unchanged.
  assert.deepEqual({ ...once, journal: { ...readJournal(once.journal), entries: [] } }, { ...t, journal: { ...readJournal(t.journal), entries: [] } });
  assert.throws(() => applyCommand(once, DM, share(session.id, "Again")), /already shared/);
  const player = { id: "aria-seat", token: "", name: "Aria", role: "player" as const, purseIds: ["aria"] };
  assert.throws(() => applyCommand(t, player, { ...share(session.id, "Forged"), purseId: "aria" }), /Only the DM/);
  assert.throws(() => applyCommand(t, DM, share("no-such-session", "x")), /existing campaign session/);
  assert.throws(() => applyCommand(t, DM, { ...share(session.id, "x"), visibility: "dm" }), /party journal entry/);
  // Players read the shared entry in their projection.
  assert.ok(readJournal(projectRecord(once, ariaSeat).journal).entries!.some((e) => e.id === recapEntryId(session.id)));
});

test("shared room: the recap posts once, a replay changes nothing, and the server refuses a player", async () => {
  const { t, session } = playedSession();
  const dm = await openRoom({ name: "Recap DM", table: t });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  await choosePace({ ...dm, live: true });
  const command = share(session.id, "The vault is ours.");
  await submitCommands({ ...dm, batchId: "share-1", commands: [command] });
  const first = (await roomState(dm)).table;
  await submitCommands({ ...dm, batchId: "share-1", commands: [command] });
  await submitCommands({ ...dm, batchId: "share-retry", commands: [command] });
  const again = (await roomState(dm)).table;
  const recapEntries = (x: CloudTable) => readJournal(x.journal).entries!.filter((e) => e.id === recapEntryId(session.id));
  assert.equal(recapEntries(again).length, 1);
  assert.deepEqual(recapEntries(again), recapEntries(first));
  const refused = await submitCommands({ code: dm.code, token: aria.token, batchId: "forge", commands: [{ ...share(session.id, "Forged"), id: recapEntryId(session.id) + "x".repeat(0), purseId: "aria" }] }).catch((e: Error) => e.message);
  // The forged command reuses the DM's action ID, so the room refuses it as a conflicting
  // action before the engine runs (receipts are per campaign and action ID: audit A2).
  assert.match(String(refused), /Only the DM|already shared|conflicting changes/);
  const playerView = (await roomState({ code: dm.code, token: aria.token })).table;
  assert.equal(recapEntries(playerView)[0]?.text, "The vault is ours.");
});

test("device and room store the same shared recap", async () => {
  const { t, session } = playedSession();
  const dm = await openRoom({ name: "Recap parity", table: t });
  await choosePace({ ...dm, live: true });
  const command = share(session.id, "Parity words.");
  await submitCommands({ ...dm, batchId: "parity", commands: [command] });
  const room = (await roomState(dm)).table;
  setSeat(DM_SEAT);
  await applyCloudTable(t);
  await executeLocalCommand(command);
  await executeLocalCommand(command);
  const device = await economySnapshot();
  const strip = (x: CloudTable) =>
    readJournal(x.journal).entries!.filter((e) => e.id === recapEntryId(session.id)).map(({ at: _at, authorId: _a, ...e }) => e);
  assert.equal(strip(device).length, 1, "a device retry is a no-op");
  assert.deepEqual(strip(device), strip(room));
});
