// Encounter awards to the party treasure pool (prompt 2, phase 2): the device path
// (src/lib/encounters/local.ts) and the shared Worker path (cloudflare/encounters.mjs) write the
// same pooled holdings, ledger lines, events and chat note, exactly once; a failure rolls back
// everything; older awards and drafts without pool fields read and display unchanged.
import "../quire/commands.ts";
import { readStoredRoom } from "../../../cloudflare/room-storage.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { localEncounterRequest } from "./local.ts";
import { blankEncounter, blankLoot, encounterSchema } from "./model.mjs";
import { encounterReadiness, recipientAwardPreview } from "./presentation.ts";
import { applyCloudTable, economySnapshot } from "../quire/economy.ts";
import { emptyCloudTable, type CloudTable } from "../quire/cloud.ts";
import { readJournal } from "../quire/journal.ts";
import { pooledLots } from "../quire/loot-claims.ts";
import { DM_SEAT, setSeat } from "../quire/table.ts";
import type { Purse } from "../quire/types.ts";

const coins = (c: Partial<Purse["coins"]>) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
function campaign(fund = true): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      ...(fund ? [{ id: "party", name: "The Hoard", kind: "party" as const, coins: coins({ gp: 10 }) }] : []),
      { id: "aria", name: "Aria", kind: "character", coins: coins({}) },
      { id: "bram", name: "Bram", kind: "character", coins: coins({}) },
    ],
    journal: readJournal({}),
  };
}
function draft() {
  const e = blankEncounter();
  e.name = "Goblin ambush";
  e.loot = [
    { ...blankLoot(), id: "l1", name: "Potion of healing", quantity: 2, unitCopper: 5000, purseId: "", pool: true },
    { ...blankLoot(), id: "l2", name: "Rusted shortsword", quantity: 3, unitCopper: 1000, purseId: "", pool: true },
    { ...blankLoot(), id: "l3", name: "Captain's iron key", quantity: 1, unitCopper: 0, purseId: "aria" },
  ];
  return e;
}
type Award = { award: { receiptId: string; poolFundId?: string }; duplicate: boolean };

async function device(fund = true) {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign(fund));
  const { id } = await localEncounterRequest<{ id: string }>("encounters/create", { id: crypto.randomUUID() });
  await localEncounterRequest("encounters/save", { id, revision: 0, encounter: draft() });
  await localEncounterRequest("encounters/conclude", { id, revision: 1 });
  const first = await localEncounterRequest<Award>("encounters/award", { id, revision: 2 });
  const retry = await localEncounterRequest<Award>("encounters/award", { id, revision: 2 });
  return { first, retry, table: await economySnapshot() };
}
// Loaded by URL so the Worker's untyped JavaScript stays outside the app's typecheck.
type Db = any;
async function shared(options: { fail?: boolean; fund?: boolean } = {}) {
  const { handleEncounters } = await import(new URL("../../../cloudflare/encounters.mjs", import.meta.url).href);
  const { localAccountDb } = await import(new URL("../../../scripts/account-dev-db.mjs", import.meta.url).href);
  const db: Db = localAccountDb();
  await db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)").bind("dm", "dm", "dm@example.com").run();
  const room = {
    code: "POOLS",
    revision: 1,
    turn: 0,
    live: true,
    seats: [{ id: "dmseat", token: "dm-token", role: "dm", name: "DM", purseIds: [] }],
    table: { ...campaign(options.fund ?? true), journal: {} },
    drafts: {},
  };
  await db.prepare("INSERT INTO campaign_rooms (code,revision,body) VALUES (?,1,?)").bind("POOLS", JSON.stringify(room)).run();
  await db.prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)").bind("dm", "POOLS", "dmseat", "dm-token", "Pools").run();
  const call = <T,>(path: string, body: Record<string, unknown>) => handleEncounters(db, "dm", "encounters" + path, body) as Promise<T>;
  const id = crypto.randomUUID();
  await call("/create", { id, code: "POOLS" });
  await call("/save", { id, revision: 0, encounter: draft() });
  await call("/conclude", { id, revision: 1 });
  if (options.fail)
    db.exec("CREATE TRIGGER fail_pool BEFORE UPDATE ON campaign_rooms BEGIN SELECT RAISE(ABORT, 'test write failure'); END;");
  let first: Award | null = null,
    retry: Award | null = null,
    error: unknown = null;
  try {
    first = await call<Award>("/award", { id, revision: 2 });
    retry = await call<Award>("/award", { id, revision: 2 });
  } catch (e) {
    error = e;
  }
  const body = (await readStoredRoom(db as never, "POOLS"))!.room;
  const awards = ((await db.prepare("SELECT COUNT(*) AS n FROM dm_encounter_awards").first()) as { n: number }).n;
  const status = (await call<{ status: string }>("/detail", { id })).status;
  db.close();
  return { first, retry, error, awards, status, table: body.table as CloudTable };
}
const normal = (t: CloudTable, receiptId: string) => {
  const r = (s: string) => s.replaceAll(receiptId, "R");
  return {
    pooled: t.holdings
      .filter((h) => h.pool)
      .map((h) => ({ ...h, id: r(h.id), pool: { ...h.pool!, at: 0, encounterId: "E", receiptId: r(h.pool!.receiptId!) } }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    lines: t.ledger
      .filter((l) => l.loot)
      .map((l) => ({ ...l, at: 0, id: r(l.id), loot: { ...l.loot!, id: r(l.loot!.id), holdingId: r(l.loot!.holdingId) } })),
    events: (t.journal?.events ?? [])
      .filter((e) => e.lootPool)
      .map((e) => ({ ...e, at: 0, id: r(e.id), lootPool: { ...e.lootPool!, holdingId: r(e.lootPool!.holdingId), receiptId: r(e.lootPool!.receiptId ?? "") } })),
    notes: t.notes.filter((n) => n.id.includes("pool")).map((n) => ({ ...n, at: 0, id: r(n.id) })),
    aria: t.holdings.filter((h) => h.purseId === "aria").map((h) => [h.name, h.quantity, h.pool ?? null]),
  };
};

test("device and shared awards send pooled items to the party fund identically, exactly once", async () => {
  const d = await device();
  assert.equal(d.retry.duplicate, true);
  assert.equal(d.retry.award.receiptId, d.first.award.receiptId);
  assert.equal(d.first.award.poolFundId, "party");
  const s = await shared();
  assert.equal(s.retry!.duplicate, true);
  assert.equal(s.first!.award.poolFundId, "party");
  const device_ = normal(d.table, d.first.award.receiptId);
  assert.deepEqual(device_, normal(s.table, s.first!.award.receiptId));
  assert.deepEqual(device_.pooled.map((h) => [h.purseId, h.name, h.quantity, h.pool.source]), [
    ["party", "Potion of healing", 2, "encounter"],
    ["party", "Rusted shortsword", 3, "encounter"],
  ]);
  assert.deepEqual(device_.lines.map((l) => [l.purseId, l.copper, l.loot.role, l.loot.unitCopper]), [
    ["party", 0, "added", 5000],
    ["party", 0, "added", 1000],
  ]);
  assert.deepEqual(device_.aria, [["Captain's iron key", 1, null]]);
  assert.match(device_.notes[0]!.text, /Potion of healing × 2 and Rusted shortsword × 3 from Goblin ambush are in the treasure pool/);
  assert.deepEqual(pooledLots(d.table).map((h) => h.name), ["Potion of healing", "Rusted shortsword"]);
});

test("a failed shared write rolls back the pooled items, the receipt and the status", async () => {
  const s = await shared({ fail: true });
  assert.ok(s.error);
  assert.equal(s.awards, 0);
  assert.equal(s.status, "review");
  assert.equal(s.table.holdings.length, 0);
  assert.equal(s.table.ledger.length, 0);
  assert.equal(s.table.notes.length, 0);
});

test("with no party fund the pool is unavailable: both paths refuse and write nothing", async () => {
  await assert.rejects(device(false), /Add a party fund before sending items to the treasure pool/);
  const after = await economySnapshot();
  assert.equal(after.holdings.length, 0);
  assert.equal(after.ledger.length, 0);
  const s = await shared({ fund: false });
  assert.match(String((s.error as Error).message), /Add a party fund/);
  assert.equal(s.awards, 0);
  assert.equal(s.table.holdings.length, 0);
  // Readiness explains it before the DM tries.
  const ready = encounterReadiness({
    status: "review",
    body: draft(),
    recipients: [{ id: "aria", name: "Aria", kind: "character" }],
    dirty: false,
  });
  assert.ok(ready.transfer.includes("Add a party fund before sending items to the treasure pool."));
  assert.equal(ready.transfer.some((r) => r.includes("Potion")), false);
});

test("drafts: a pooled item cannot also name a recipient; older drafts and awards read unchanged", () => {
  const bad = draft();
  bad.loot[0]!.purseId = "aria";
  assert.equal(encounterSchema.safeParse(bad).success, false);
  const old = blankEncounter();
  old.coins = { cp: 0, sp: 6, ep: 0, gp: 12, pp: 1 };
  old.coinPurseId = "party";
  old.loot = [{ ...blankLoot(), id: "x", name: "Silvered dagger", purseId: "party" }];
  const parsed = encounterSchema.parse(JSON.parse(JSON.stringify(old)));
  assert.equal("poolFundId" in parsed, false);
  assert.equal(parsed.loot.some((l) => "pool" in l), false);
  const recipients = [{ id: "party", name: "The Hoard", kind: "party" }];
  const preview = recipientAwardPreview(parsed, recipients);
  // Byte-identical preview for an award without pool fields.
  assert.deepEqual(Object.keys(preview).sort(), ["recipients", "unresolved", "unresolvedCoins"]);
  assert.deepEqual(preview.recipients.map((r) => [r.name, r.coins, r.items.map((i) => i.name)]), [
    ["The Hoard", { cp: 0, sp: 6, ep: 0, gp: 12, pp: 1 }, ["Silvered dagger"]],
  ]);
  const pooled = recipientAwardPreview(draft(), [...recipients, { id: "aria", name: "Aria", kind: "character" }], undefined, recipients[0]);
  assert.deepEqual(pooled.pool?.items.map((i) => i.name), ["Potion of healing", "Rusted shortsword"]);
  assert.equal(pooled.pool?.fund?.name, "The Hoard");
  assert.deepEqual(pooled.recipients.map((r) => r.name), ["Aria"]);
});
