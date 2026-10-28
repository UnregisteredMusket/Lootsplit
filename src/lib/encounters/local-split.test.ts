// Encounter coin split on the device path (src/lib/encounters/local.ts) gives the same purses and
// ledger lines as the shared Worker path (cloudflare/encounters.mjs), and awards exactly once.
import "../quire/commands.ts";
import { readStoredRoom } from "../../../cloudflare/room-storage.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { localEncounterRequest } from "./local.ts";
import { blankEncounter, blankLoot } from "./model.mjs";
import { applyCloudTable, economySnapshot } from "../quire/economy.ts";
import { emptyCloudTable, type CloudTable } from "../quire/cloud.ts";
import { readJournal } from "../quire/journal.ts";
import { DM_SEAT, setSeat } from "../quire/table.ts";
import type { Purse } from "../quire/types.ts";

const coins = (c: Partial<Purse["coins"]>) => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...c });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "party", name: "Party fund", kind: "party", coins: coins({ gp: 10 }) },
      { id: "aria", name: "Aria", kind: "character", coins: coins({}) },
      { id: "bram", name: "Bram", kind: "character", coins: coins({ pp: 1, ep: 2 }) },
      { id: "cass", name: "Cass", kind: "character", coins: coins({}) },
    ],
    journal: readJournal({ coinSplit: { rotation: { lastPurseId: "aria" } } }),
  };
}
function draft(remainderRule: "party-fund" | "rotate" = "rotate") {
  const e = blankEncounter();
  e.name = "Goblin ambush";
  e.coins = { cp: 9, sp: 14, ep: 0, gp: 23, pp: 1 }; // 3,449 cp among 3: 1,149 each and 2 cp left over
  e.coinSplit = { purseIds: ["aria", "bram", "cass"], remainderRule };
  e.loot = [{ ...blankLoot(), name: "Potion", purseId: "party" }];
  return e;
}
type Award = { award: { receiptId: string; coinShares?: unknown; coinRemainder?: unknown }; duplicate: boolean };

async function device(remainderRule: "party-fund" | "rotate") {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const { id } = await localEncounterRequest<{ id: string }>("encounters/create", { id: crypto.randomUUID() });
  await localEncounterRequest("encounters/save", { id, revision: 0, encounter: draft(remainderRule) });
  await localEncounterRequest("encounters/conclude", { id, revision: 1 });
  const first = await localEncounterRequest<Award>("encounters/award", { id, revision: 2 });
  const retry = await localEncounterRequest<Award>("encounters/award", { id, revision: 2 });
  return { first, retry, table: await economySnapshot() };
}
// Loaded by URL so the Worker's untyped JavaScript stays outside the app's typecheck.
type Db = any;
async function shared(remainderRule: "party-fund" | "rotate") {
  const { handleEncounters } = await import(new URL("../../../cloudflare/encounters.mjs", import.meta.url).href);
  const { localAccountDb } = await import(new URL("../../../scripts/account-dev-db.mjs", import.meta.url).href);
  const db: Db = localAccountDb();
  await db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)").bind("dm", "dm", "dm@example.com").run();
  const room = {
    code: "SPLITS",
    revision: 1,
    turn: 0,
    live: true,
    seats: [{ id: "dmseat", token: "dm-token", role: "dm", name: "DM", purseIds: [] }],
    table: { ...campaign(), journal: { coinSplit: { rotation: { lastPurseId: "aria" } } } },
    drafts: {},
  };
  await db.prepare("INSERT INTO campaign_rooms (code,revision,body) VALUES (?,1,?)").bind("SPLITS", JSON.stringify(room)).run();
  await db.prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)").bind("dm", "SPLITS", "dmseat", "dm-token", "Splits").run();
  const call = <T,>(path: string, body: Record<string, unknown>) => handleEncounters(db, "dm", "encounters" + path, body) as Promise<T>;
  const id = crypto.randomUUID();
  await call("/create", { id, code: "SPLITS" });
  await call("/save", { id, revision: 0, encounter: draft(remainderRule) });
  await call("/conclude", { id, revision: 1 });
  const first = await call<Award>("/award", { id, revision: 2 });
  const body = (await readStoredRoom(db as never, "SPLITS"))!.room;
  db.close();
  return { first, table: body.table as CloudTable };
}
const normal = (t: CloudTable, receiptId: string) => ({
  purses: [...t.purses].sort((a, b) => a.id.localeCompare(b.id)).map((p) => ({ id: p.id, coins: p.coins })),
  split: t.ledger
    .filter((l) => l.split)
    .map((l) => ({ ...l, at: 0, id: l.id.replace(receiptId, "R"), split: { ...l.split!, id: l.split!.id.replace(receiptId, "R") } }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  rotation: t.journal?.coinSplit?.rotation ?? null,
});

for (const rule of ["rotate", "party-fund"] as const)
  test(`device and shared encounter splits (${rule}) credit the same coins and ledger lines, once`, async () => {
    const d = await device(rule);
    assert.equal(d.retry.duplicate, true);
    assert.equal(d.retry.award.receiptId, d.first.award.receiptId);
    const s = await shared(rule);
    assert.deepEqual(normal(d.table, d.first.award.receiptId), normal(s.table, s.first.award.receiptId));
    assert.deepEqual(d.first.award.coinShares, s.first.award.coinShares);
    assert.deepEqual(d.first.award.coinRemainder, s.first.award.coinRemainder);
    const bram = d.table.purses.find((p) => p.id === "bram")!;
    // Each share is gold/silver/copper on top of Bram's own platinum and electrum; with
    // rotation after Aria, Bram also receives the 2 cp leftover.
    assert.deepEqual(bram.coins, coins({ pp: 1, ep: 2, gp: 11, sp: 4, cp: rule === "rotate" ? 11 : 9 }));
    if (rule === "rotate") assert.deepEqual(normal(d.table, "").rotation, { lastPurseId: "bram" });
    else assert.equal(d.table.purses.find((p) => p.id === "party")!.coins.cp, 2);
  });
