/**
 * The favor market (owner design 2026-11-05, PR B of factions; shapes in favor-market-schema.ts).
 *
 * - Each faction has its own market of entries the DM writes (no defaults; "Add from template" only
 *   fills the form). The DM edits it at any time (`favor-entry`, revision-checked on the faction).
 * - A player asks for a visible, available entry with their own character's Favor
 *   (`favor-request`). The request waits for the DM ("DM discretion"), who approves it — the Favor
 *   is spent then, once, and refused if it is short — or declines it with an optional reply
 *   (`favor-decision`). A player may withdraw a waiting request (`favor-withdraw`). The DM can also
 *   record a purchase directly (`favor-purchase`).
 * - Spending Favor is authoritative like money: one command, an idempotent command ID (room
 *   receipts and the device's applied-command store), the request's status and agreed cost as the
 *   revision check, never below 0. Shared rooms run it in commands.ts and the device runs the same
 *   command through `executeLocalCommand`.
 * - An item entry moves no items: after approval the DM hands it over with the existing Add loot
 *   flow. A secret's text is copied onto the approved purchase and only that character's player
 *   reads it (`projectFavorMarket`).
 * - History: every request, decision and spend writes one event on the character's purse, tagged
 *   with the faction (so it is withheld while the faction is hidden) and DM-only for a hidden
 *   faction. The secret's text never enters history.
 */
import { z } from "zod";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import {
  favorEntryDraftSchema,
  MAX_FAVOR_COST,
  MAX_FAVOR_REQUESTS,
  MAX_PENDING_FAVOR_REQUESTS,
  MAX_FAVOR_ENTRIES,
  type FavorEntry,
  type FavorRequest,
} from "./favor-market-schema.ts";
import { factionCharacter, factionIdSchema, readFactions, standingOf, type Faction } from "./factions.ts";

const id = z.string().min(1).max(150);
const cost = z.number().int().min(0).max(MAX_FAVOR_COST);

export const favorCommands = [
  /** DM: add, replace (same entry ID) or remove (`entry: null`) a market entry. */
  z
    .object({
      id,
      kind: z.literal("favor-entry"),
      factionId: factionIdSchema,
      revision: z.number().int().nonnegative(),
      entryId: id,
      entry: favorEntryDraftSchema.nullable(),
    })
    .strict(),
  /** A player (or the DM for them): ask for an entry with the character's own Favor. */
  z
    .object({
      id,
      kind: z.literal("favor-request"),
      factionId: factionIdSchema,
      entryId: id,
      characterId: id,
      /** The cost the player saw; a changed price is refused, never charged. */
      cost,
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
  /** The requesting player (or the DM): withdraw a waiting request. */
  z.object({ id, kind: z.literal("favor-withdraw"), factionId: factionIdSchema, requestId: id }).strict(),
  /** DM: approve (spends the Favor) or decline a waiting request. */
  z
    .object({
      id,
      kind: z.literal("favor-decision"),
      factionId: factionIdSchema,
      requestId: id,
      approve: z.boolean(),
      reply: z.string().trim().max(500).optional(),
    })
    .strict(),
  /** DM: record a purchase directly (spends the Favor now). */
  z
    .object({
      id,
      kind: z.literal("favor-purchase"),
      factionId: factionIdSchema,
      entryId: id,
      characterId: id,
      cost,
      reply: z.string().trim().max(500).optional(),
    })
    .strict(),
] as const;
export type FavorCommand = z.infer<(typeof favorCommands)[number]>;
export const favorKinds = new Set<string>(["favor-entry", "favor-request", "favor-withdraw", "favor-decision", "favor-purchase"]);

const NOT_OFFERED = "This favor isn't on offer any more. Refresh; nothing was spent.";
const STALE = "This faction changed on another device. Refresh before saving; nothing was saved.";

type FavorTable = Pick<CloudTable, "purses" | "journal">;
type Log = (summary: string, options: { purseId?: string; dmOnly?: boolean; factionId?: string }) => void;

export function favorMarketOf(f: Pick<Faction, "favorMarket">): FavorEntry[] {
  return f.favorMarket ?? [];
}
export function favorRequestsOf(f: Pick<Faction, "favorRequests">): FavorRequest[] {
  return f.favorRequests ?? [];
}

/**
 * Spend `amount` of a character's Favor with a faction: never below 0, and the whole command
 * refuses when short (the caller has changed nothing yet).
 */
function spendFavor(f: Faction, characterId: string, name: string, amount: number): number {
  const before = standingOf(f, characterId);
  if (before.favor < amount) throw Error(`${name} has only ${before.favor} Favor with ${f.name}; this costs ${amount}.`);
  const favor = before.favor - amount;
  if (before.renown === 0 && favor === 0) delete f.standing[characterId];
  else f.standing[characterId] = [before.renown, favor];
  return favor;
}

/**
 * Apply a favor market command. The DM may do everything; a player may only ask for (and withdraw)
 * entries for their own characters, on visible factions and visible, available entries.
 */
export function applyFavorCommand(
  t: FavorTable,
  seat: Pick<CloudSeat, "role" | "purseIds">,
  cmd: FavorCommand,
  at: number,
  log: Log,
): void {
  const dm = seat.role === "dm";
  const journal = t.journal as { factions?: Faction[] } & NonNullable<CloudTable["journal"]>;
  const factions = readFactions(journal.factions);
  const f = factions.find((x) => x.id === cmd.factionId);
  // A player learns nothing about a faction they cannot see (missing, hidden and deleted read alike).
  if (!f || (!dm && (f.hidden || f.deleted))) throw Error(dm ? "This faction no longer exists. Refresh." : NOT_OFFERED);
  if (f.deleted) throw Error("Restore this faction before changing its favor market.");
  const save = () => (journal.factions = factions);
  const dmOnly = f.hidden ? { dmOnly: true as const } : {};
  const tag = { factionId: f.id, ...dmOnly };

  if (cmd.kind === "favor-entry") {
    if (!dm) throw Error("Only the DM can change the favor market.");
    if (f.revision !== cmd.revision) throw Error(STALE);
    const market = [...favorMarketOf(f)];
    const index = market.findIndex((e) => e.id === cmd.entryId);
    if (cmd.entry === null) {
      if (index < 0) return;
      const [gone] = market.splice(index, 1);
      log(`Favor market: removed ${gone!.name} from ${f.name}`, { dmOnly: true });
    } else {
      if (cmd.entry.id !== cmd.entryId) throw Error("Each entry keeps its own ID.");
      const entry: FavorEntry = {
        ...cmd.entry,
        ...(cmd.entry.secret?.trim() ? { secret: cmd.entry.secret.trim() } : { secret: undefined }),
        ...(cmd.entry.note?.trim() ? { note: cmd.entry.note.trim() } : { note: undefined }),
      };
      if (entry.secret === undefined) delete entry.secret;
      if (entry.note === undefined) delete entry.note;
      if (index < 0) {
        if (market.length >= MAX_FAVOR_ENTRIES) throw Error(`A faction's favor market holds at most ${MAX_FAVOR_ENTRIES} entries.`);
        market.push(entry);
      } else market[index] = entry;
      log(`Favor market: ${index < 0 ? "added" : "edited"} ${entry.name} (${entry.cost} Favor) at ${f.name}`, { dmOnly: true });
    }
    if (market.length) f.favorMarket = market;
    else delete f.favorMarket;
    f.revision += 1;
    save();
    return;
  }

  const requests = [...favorRequestsOf(f)];
  const character = (characterId: string) => {
    if (!dm && !seat.purseIds.includes(characterId)) throw Error("You can only ask for favors for your own character.");
    const p = t.purses.find((x) => x.id === characterId);
    if (!factionCharacter(t, p)) throw Error("Choose a player character.");
    return p;
  };
  const room = () => {
    if (requests.length >= MAX_FAVOR_REQUESTS)
      throw Error(`${f.name} has ${MAX_FAVOR_REQUESTS} favor requests on record. They are kept as history; ask the DM to start a new faction ledger.`);
  };
  const store = () => {
    f.favorRequests = requests;
    save();
  };

  if (cmd.kind === "favor-request" || cmd.kind === "favor-purchase") {
    if (cmd.kind === "favor-purchase" && !dm) throw Error("Only the DM can record a favor purchase.");
    const p = character(cmd.characterId);
    const entry = favorMarketOf(f).find((e) => e.id === cmd.entryId);
    if (!entry || (!dm && (entry.hidden || !entry.available))) throw Error(NOT_OFFERED);
    if (entry.cost !== cmd.cost) throw Error(`The price of ${entry.name} changed to ${entry.cost} Favor. Refresh; nothing was spent.`);
    room();
    const base = { id: cmd.id, entryId: entry.id, characterId: p.id, name: entry.name, kind: entry.kind, cost: entry.cost, at };
    if (cmd.kind === "favor-request") {
      if (requests.some((r) => r.id === cmd.id)) return;
      const waiting = requests.filter((r) => r.status === "pending" && r.characterId === p.id).length;
      if (waiting >= MAX_PENDING_FAVOR_REQUESTS)
        throw Error(`${p.name} already has ${MAX_PENDING_FAVOR_REQUESTS} requests waiting with ${f.name}.`);
      const { favor } = standingOf(f, p.id);
      if (favor < entry.cost) throw Error(`${p.name} has only ${favor} Favor with ${f.name}; this costs ${entry.cost}.`);
      requests.push({ ...base, status: "pending", ...(cmd.note ? { note: cmd.note } : {}) });
      store();
      log(`${p.name} asked ${f.name} for ${entry.name} (${entry.cost} Favor)`.slice(0, 500), { purseId: p.id, ...tag });
      return;
    }
    const left = spendFavor(f, p.id, p.name, entry.cost);
    requests.push({
      ...base,
      status: "approved",
      direct: true,
      decidedAt: at,
      ...(cmd.reply ? { reply: cmd.reply } : {}),
      ...(entry.secret ? { secret: entry.secret } : {}),
    });
    store();
    log(`${p.name}: Favor with ${f.name} −${entry.cost} (now ${left}) · ${entry.name}`.slice(0, 500), { purseId: p.id, ...tag });
    return;
  }

  const request = requests.find((r) => r.id === cmd.requestId);
  // A player never learns of another character's request.
  if (!request || (!dm && !seat.purseIds.includes(request.characterId))) throw Error("This request no longer exists. Refresh.");
  if (request.status !== "pending") throw Error(`This request was already ${request.status}. Nothing changed.`);
  const p = t.purses.find((x) => x.id === request.characterId);
  const who = p?.name ?? "A character";
  const index = requests.indexOf(request);

  if (cmd.kind === "favor-withdraw") {
    requests[index] = { ...request, status: "withdrawn", decidedAt: at };
    store();
    log(`${who} withdrew a request to ${f.name} for ${request.name}`.slice(0, 500), { purseId: request.characterId, ...tag });
    return;
  }

  if (!dm) throw Error("Only the DM can approve or decline favor requests.");
  if (!cmd.approve) {
    requests[index] = { ...request, status: "declined", decidedAt: at, ...(cmd.reply ? { reply: cmd.reply } : {}) };
    store();
    log(`${f.name} declined ${who}'s request for ${request.name}`.slice(0, 500), { purseId: request.characterId, ...tag });
    return;
  }
  if (!factionCharacter(t, p)) throw Error("This character is no longer a player character. Decline the request instead.");
  // The agreed cost is spent; the entry's secret (if it still exists) is revealed to the buyer.
  const left = spendFavor(f, p.id, p.name, request.cost);
  const entry = favorMarketOf(f).find((e) => e.id === request.entryId);
  requests[index] = {
    ...request,
    status: "approved",
    decidedAt: at,
    ...(cmd.reply ? { reply: cmd.reply } : {}),
    ...(entry?.secret ? { secret: entry.secret } : {}),
  };
  store();
  log(`${p.name}: Favor with ${f.name} −${request.cost} (now ${left}) · ${request.name}`.slice(0, 500), { purseId: p.id, ...tag });
}

/** Waiting requests across every faction (for the DM's count). */
export function pendingFavorRequests(factions: readonly Faction[]): number {
  return factions.reduce((n, f) => n + (f.deleted ? 0 : favorRequestsOf(f).filter((r) => r.status === "pending").length), 0);
}
