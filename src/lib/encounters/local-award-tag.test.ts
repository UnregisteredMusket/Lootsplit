// Encounter award tag (prompt 2, phase 3): one-purse coins and items sent straight to a character
// carry the same `award` tag (receipt ID and reviewed value) on the device path
// (src/lib/encounters/local.ts) and the shared Worker path (cloudflare/encounters.mjs), once.
import "../quire/commands.ts";
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
function draft(_rule?: unknown) {
  const e = blankEncounter();
  e.name = "Goblin ambush";
  e.coins = { cp: 9, sp: 14, ep: 0, gp: 23, pp: 1 }; // 3,449 cp to one purse
  e.coinPurseId = "aria";
  e.loot = [
    { ...blankLoot(), name: "Potion", purseId: "party", unitCopper: 5000 },
    { ...blankLoot(), name: "Shield", purseId: "bram", quantity: 2, unitCopper: 1000 },
  ];
  return e;
}
type Award = { award: { receiptId: string; coinShares?: unknown; coinRemainder?: unknown }; duplicate: boolean };

async function device(remainderRule: unknown) {
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
async function shared(remainderRule: unknown) {
  const { handleEncounters } = await import(new URL("../../../cloudflare/encounters.mjs", import.meta.url).href);
  const { localAccountDb } = await import(new URL("../../../scripts/account-dev-db.mjs", import.meta.url).href);
  const db: Db = localAccountDb();
  await db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)").bind("dm", "dm", "dm@example.com").run();
  const room = {
    code: "AWARDS",
    revision: 1,
    turn: 0,
    live: true,
    seats: [{ id: "dmseat", token: "dm-token", role: "dm", name: "DM", purseIds: [] }],
    table: { ...campaign(), journal: { coinSplit: { rotation: { lastPurseId: "aria" } } } },
    drafts: {},
  };
  await db.prepare("INSERT INTO campaign_rooms VALUES (?,1,?)").bind("AWARDS", JSON.stringify(room)).run();
  await db.prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)").bind("dm", "AWARDS", "dmseat", "dm-token", "Splits").run();
  const call = <T,>(path: string, body: Record<string, unknown>) => handleEncounters(db, "dm", "encounters" + path, body) as Promise<T>;
  const id = crypto.randomUUID();
  await call("/create", { id, code: "AWARDS" });
  await call("/save", { id, revision: 0, encounter: draft(remainderRule) });
  await call("/conclude", { id, revision: 1 });
  const first = await call<Award>("/award", { id, revision: 2 });
  const body = JSON.parse(((await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind("AWARDS").first()) as { body: string }).body);
  db.close();
  return { first, table: body.table as CloudTable };
}
const tagged = (t: CloudTable, receiptId: string) =>
  t.ledger
    .filter((l) => l.award)
    .map((l) => ({ ...l, at: 0, id: l.id.replace(receiptId, "R"), award: { ...l.award!, receiptId: l.award!.receiptId.replace(receiptId, "R") } }))
    .sort((a, b) => a.id.localeCompare(b.id));

test("device and shared encounter awards write the same award-tagged lines, once", async () => {
  const d = await device(null);
  assert.equal(d.retry.duplicate, true);
  const s = await shared(null);
  const lines = tagged(d.table, d.first.award.receiptId);
  assert.deepEqual(lines, tagged(s.table, s.first.award.receiptId));
  assert.deepEqual(
    lines.map((l) => [l.id, l.purseId, l.copper, l.award]),
    [
      ["R-coins", "aria", 3449, { receiptId: "R", role: "coins" }],
      ["R-item-0", "party", 0, { receiptId: "R", role: "item", quantity: 1, unitCopper: 5000 }],
      ["R-item-1", "bram", 0, { receiptId: "R", role: "item", quantity: 2, unitCopper: 1000 }],
    ],
  );
  // The summaries older readers already understand stay the same.
  assert.equal(lines[2]!.summary, "Encounter loot: 2 × Shield (Goblin ambush)");
  assert.equal(d.table.ledger.filter((l) => l.award).length, 3, "the retry wrote nothing twice");
});
