import { rollLootTable } from "./roll-table.mjs";
import { z } from "zod";
import { quireDb, request, activeDatabaseName } from "../quire/db.ts";
import { getSeat } from "../quire/table.ts";
import { getCloudWatch } from "../quire/cloud-turn.ts";
import type { Purse } from "../quire/types.ts";
import {
  awardSplitReceiptSchema,
  blankEncounter,
  encounterSchema,
  generatorSchema,
  generateEncounter,
} from "./model.mjs";
import { applyEncounterSplit, type EncounterCoinSplitReceipt } from "../quire/coin-split.ts";
import { encounterPoolRows } from "../quire/loot-claims.ts";
import { encounterCoinLine, encounterItemLine } from "../quire/award-tag.ts";
import { readJournal } from "../quire/journal.ts";
import { creatureIndex } from "./index.mjs";
import { parseDice, throwDice } from "../characters/model.mjs";
import { announceSheetChange } from "../quire/party-sheet-links.ts";

const rollSchema = z.object({
  seq: z.number().int(),
  at: z.number(),
  requestKey: z.string(),
  label: z.string(),
  formula: z.string(),
  source: z.string(),
  total: z.number(),
  selected: z.number().optional(),
  tableId: z.string().optional(),
  resultName: z.string().optional(),
});
export const localEncounterSchema = z.object({
  id: z.string().startsWith("local-"),
  code: z.literal("device"),
  body: encounterSchema,
  revision: z.number().int().nonnegative(),
  status: z.enum(["draft", "active", "review", "awarded"]),
  updated_at: z.number(),
  rolls: z.array(rollSchema),
  award: z
    .object({
      receiptId: z.string(),
      at: z.number(),
      ...awardSplitReceiptSchema,
      poolFundId: z.string().max(120).optional(),
    })
    .nullable(),
});
export const readLocalEncounters = (value: unknown) =>
  z.array(localEncounterSchema).parse(value ?? []);
export async function activeLocalEncounter(): Promise<boolean> {
  const db = await quireDb();
  const value = await request<{ rows: unknown[] } | undefined>(
    db.transaction("meta", "readonly").objectStore("meta").get("localEncounters"),
  );
  return readLocalEncounters(value?.rows).some((r) => r.status === "active");
}
type Stored = z.infer<typeof localEncounterSchema>;
function requireDM() {
  if (getSeat().role !== "dm") throw new Error("Only the DM can access device encounters.");
}
// All encounter state and local loot transfers commit together, including the award receipt.
export async function localEncounterRequest<T>(path: string, input: unknown = {}): Promise<T> {
  requireDM();
  const b = input as {
    id?: string;
    revision?: number;
    encounter?: unknown;
    filters?: unknown;
    page?: number;
    before?: number;
    requestKey?: string;
    tableId?: string;
    manual?: boolean;
    total?: number;
    formula?: string;
    label?: string;
  };
  const databaseName = activeDatabaseName();
  if (path === "encounters/index" || path === "encounters/generate") {
    const g = generatorSchema.parse(b.filters);
    const rows = (await creatureIndex()).filter(
      (c) =>
        (!g.enemy || `${c.name} ${c.type}`.toLowerCase().includes(g.enemy.toLowerCase())) &&
        (!g.environment || c.environments.toLowerCase().includes(g.environment.toLowerCase())),
    );
    requireDM();
    if (databaseName !== activeDatabaseName()) throw new Error("Campaign changed. Try again.");
    const page = b.page ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error("Invalid index page.");
    return (
      path.endsWith("generate")
        ? { combatants: generateEncounter(rows, g) }
        : { creatures: rows.slice((page - 1) * 20, page * 20), more: rows.length > page * 20 }
    ) as T;
  }
  const db = await quireDb();
  requireDM();
  if (databaseName !== activeDatabaseName()) throw new Error("Campaign changed. Try again.");
  const tx = db.transaction(["meta", "purses", "holdings", "ledger"], "readwrite");
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("Encounter save failed."));
    tx.onerror = () => {};
  });
  // Attach rejection handling immediately, including quota and transaction-abort failures.
  void done.catch(() => undefined);
  try {
    const stored = await request<{ rows: Stored[] } | undefined>(
      tx.objectStore("meta").get("localEncounters"),
    );
    const rows = readLocalEncounters(stored?.rows);
    const purses = await request<Purse[]>(tx.objectStore("purses").getAll());
    let result: unknown;
    let changed = false;
    if (path === "encounters") {
      result = {
        campaigns: [{ code: "device", name: "This device", purses }],
        encounters: rows
          .map((r) => ({
            id: r.id,
            code: r.code,
            name: r.body.name,
            status: r.status,
            updated_at: r.updated_at,
          }))
          .sort((a, b) => b.updated_at - a.updated_at),
      };
    } else if (path === "encounters/create") {
      const id = b.id?.startsWith("local-") ? b.id : `local-${b.id || crypto.randomUUID()}`;
      if (!rows.some((r) => r.id === id)) {
        rows.push(
          localEncounterSchema.parse({
            id,
            code: "device",
            body: b.encounter || blankEncounter(),
            revision: 0,
            status: "draft",
            updated_at: Date.now(),
            rolls: [],
            award: null,
          }),
        );
        changed = true;
      }
      result = { id };
    } else {
      const r = rows.find((r) => r.id === b.id);
      if (!r) throw new Error("Encounter not found in this device campaign.");
      result = { id: r.id };
      if (path === "encounters/detail") result = { ...r, purses };
      else if (path === "encounters/log") {
        const before = b.before ?? Number.MAX_SAFE_INTEGER;
        const history = r.rolls.filter((x) => x.seq < before).sort((a, b) => b.seq - a.seq);
        result = { rolls: history.slice(0, 50), more: history.length > 50 };
      } else if (path === "encounters/award" && r.award)
        result = { award: r.award, duplicate: true };
      else if (path === "encounters/roll" && r.rolls.some((x) => x.requestKey === b.requestKey))
        result = r.rolls.find((x) => x.requestKey === b.requestKey);
      else {
        if (r.revision !== b.revision)
          throw new Error("Encounter changed in another tab. Export your draft and reload.");
        if (r.status === "awarded")
          throw new Error("This encounter has already been awarded and is read-only.");
        if (path === "encounters/save") {
          const next = encounterSchema.parse(b.encounter);
          if (
            r.status === "review" &&
            JSON.stringify(next.tables) !== JSON.stringify(r.body.tables)
          )
            throw new Error("Loot tables are resolved. Edit the loot award directly.");
          r.body = next;
        } else if (path === "encounters/start") {
          if (r.status !== "draft") throw new Error("Only a draft encounter can be started.");
          r.status = "active";
        } else if (path === "encounters/conclude") {
          if (r.status !== "review") {
            for (const t of r.body.tables) {
              if (t.selected === null)
                throw new Error(`Choose or roll a result for ${t.name} before concluding.`);
              r.body.loot.push({
                ...t.entries[t.selected].loot,
                id: crypto.randomUUID(),
                sourceTableId: t.id,
                notes: `${t.entries[t.selected].loot.notes}\nLoot table: ${t.name}`.trim(),
              });
            }
            r.body = encounterSchema.parse(r.body);
            r.status = "review";
          }
        } else if (path === "encounters/roll") {
          if (r.status === "review") throw new Error("The encounter is concluded.");
          if (!b.requestKey || !/^[a-zA-Z0-9-]{16,80}$/.test(b.requestKey))
            throw new Error("Invalid roll key.");
          let draw;
          if (b.tableId) {
            const t = r.body.tables.find((t) => t.id === b.tableId);
            if (!t) throw new Error("Loot table not found.");
            draw = rollLootTable(t, b.manual === true, b.total, "app");
          } else {
            const formula = b.formula || "1d20";
            parseDice(formula);
            if (b.manual && (!Number.isSafeInteger(b.total) || Math.abs(b.total!) > 100000))
              throw new Error("Enter a whole-number manual total.");
            draw = {
              label: b.label || "Encounter roll",
              formula,
              source: b.manual ? "manual" : "app",
              total: b.manual ? b.total! : throwDice(formula).total,
            };
          }
          result = rollSchema.parse({
            ...draw,
            seq: (r.rolls.at(-1)?.seq || 0) + 1,
            at: Date.now(),
            requestKey: b.requestKey,
          });
          r.rolls.push(result as z.infer<typeof rollSchema>);
        } else if (path === "encounters/award") {
          if (getCloudWatch().joined)
            throw new Error(
              "Import this encounter into the saved DM campaign to award multiplayer loot, or return to Local Mode to award this device campaign.",
            );
          if (r.status !== "review")
            throw new Error("Conclude and review this encounter before transferring loot.");
          const recipient = (id: string) => {
            const p = purses.find((p) => p.id === id);
            if (!p) throw new Error("Choose an existing recipient for every item and coin award.");
            return p;
          };
          const e = r.body,
            at = Date.now(),
            receiptId = crypto.randomUUID();
          const copper =
            e.coins.cp + e.coins.sp * 10 + e.coins.ep * 50 + e.coins.gp * 100 + e.coins.pp * 1000;
          let splitReceipt: EncounterCoinSplitReceipt | null = null;
          if (copper && e.coinSplit) {
            // The same planner and credit as the shared Worker path (coin-split.ts).
            const meta = await request<{ value: unknown } | undefined>(
              tx.objectStore("meta").get("journal"),
            );
            const journal = (meta?.value ?? undefined) as import("../quire/journal.ts").Journal | undefined;
            const table = { purses, journal };
            const split = applyEncounterSplit(table, e.coinSplit, copper, receiptId, at, e.name);
            for (const id of split.touched) tx.objectStore("purses").put(purses.find((p) => p.id === id)!);
            for (const line of split.ledger) tx.objectStore("ledger").put(line);
            if (split.plan.rotation) tx.objectStore("meta").put({ id: "journal", value: table.journal });
            splitReceipt = split.receipt;
          } else if (copper) {
            const p = recipient(e.coinPurseId);
            for (const key of ["cp", "sp", "ep", "gp", "pp"] as const) {
              p.coins[key] += e.coins[key];
              if (!Number.isSafeInteger(p.coins[key]))
                throw new Error("Award exceeds the supported coin balance.");
            }
            if (
              !Number.isSafeInteger(
                p.coins.cp +
                  p.coins.sp * 10 +
                  p.coins.ep * 50 +
                  p.coins.gp * 100 +
                  p.coins.pp * 1000,
              )
            )
              throw new Error("Award exceeds the supported coin balance.");
            tx.objectStore("purses").put(p);
            // The same helper and award tag as the shared Worker path (award-tag.ts).
            tx.objectStore("ledger").put(encounterCoinLine(receiptId, at, p.id, e.name, copper));
          }
          // Treasure-pool items: the same rows as the shared Worker path (loot-claims.ts).
          const poolJournal = readJournal(
            (await request<{ value: unknown } | undefined>(tx.objectStore("meta").get("journal")))?.value,
          );
          const pool = encounterPoolRows({ purses, journal: poolJournal }, e.loot, {
            ...(e.poolFundId ? { fundId: e.poolFundId } : {}),
            receiptId,
            encounterId: r.id,
            encounterName: e.name,
            at,
          });
          if (pool) {
            for (const holding of pool.holdings) tx.objectStore("holdings").put(holding);
            for (const line of pool.ledger) tx.objectStore("ledger").put(line);
            poolJournal.events.push(...pool.events);
            tx.objectStore("meta").put({ id: "journal", value: poolJournal });
            const chat = await request<{ notes?: unknown[] } | undefined>(tx.objectStore("meta").get("chat"));
            tx.objectStore("meta").put({ id: "chat", notes: [...(chat?.notes ?? []), pool.note] });
          }
          for (const [index, item] of e.loot.entries()) {
            if (item.pool) continue;
            const p = recipient(item.purseId);
            tx.objectStore("holdings").put({
              id: crypto.randomUUID(),
              purseId: p.id,
              name: item.name,
              kind: "item",
              quantity: item.quantity,
              unitCopper: item.unitCopper,
              notes: item.notes,
            });
            tx.objectStore("ledger").put(encounterItemLine(receiptId, index, at, p.id, item, e.name));
          }
          r.award = { receiptId, at, ...(splitReceipt ?? {}), ...(pool ? { poolFundId: pool.fundId } : {}) };
          r.status = "awarded";
          result = { award: r.award, duplicate: false };
        } else throw new Error("Unknown encounter action.");
        if (path !== "encounters/roll") r.revision++;
        r.updated_at = Date.now();
        changed = true;
      }
    }
    requireDM();
    if (databaseName !== activeDatabaseName()) throw new Error("Campaign changed. Try again.");
    if (changed) tx.objectStore("meta").put({ id: "localEncounters", rows });
    await done;
    if (changed) announceSheetChange();
    return result as T;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already aborted. */
    }
    await done.catch(() => undefined);
    throw error;
  }
}
