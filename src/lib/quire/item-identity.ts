/**
 * Item identification (loot plan phase 5; docs/FEATURE-INVENTORY.md, docs/SERVICES.md).
 *
 * One holding has two records: the true item (its `name`, `notes` and `unitCopper`, which only
 * the DM reads) and, while it is unidentified, the presented record `unidentified` the DM set
 * (`{ name, description?, value? }`). Everyone else is told the presented record instead of the
 * true one, everywhere: the player projection (`projectRecord`, the non-DM branch of `view()`,
 * archived sessions, history pages and the device), character sheets, the TV display and every
 * receipt, ledger line, event or note written while the item is unidentified.
 *
 * Two layers keep the true details out of what players receive, both structural only: text a
 * person typed (chat, notes, journal entries, DM summaries) is never searched or rewritten.
 * - **At write time**: the summaries a command generates use `presentedHolding` (sales, the
 *   treasure pool, encounter awards, property storage), and `redactWritten` presents the
 *   structured item fields of the ledger lines, events and service orders that command created.
 * - **At projection time** (`redactIdentity`): every holding copy is replaced by its presented
 *   form, and every structured record tied to a secret holding (`holdingId`, or an item ID with
 *   `unitCopper`) takes the presented name, notes and value. Stored records are never changed.
 *
 * Records written before the DM marked an item keep what they recorded (the DM is told so).
 *
 * A sale of an unidentified item (by anyone, the DM included) is priced at the presented value,
 * so no sale price reveals the true value; without a presented value it cannot be sold.
 */
import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";
import type { Holding } from "./types.ts";

export const unidentifiedSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().max(4000).optional(),
    value: z.number().int().nonnegative().max(1e12).optional(),
    /** The inventory category players see (shops buy by it); absent: `NEUTRAL_CATEGORY`. */
    category: z.string().trim().min(1).max(80).optional(),
    /** The weight players see; absent: the true weight (a holder can feel it). */
    weight: z.number().min(0).max(9999).optional(),
    /**
     * Earlier holding IDs of this item (a give, a pool resolution, a storage move made a new
     * holding), set by the server so records linked to them stay presented (`identityLineage`).
     */
    ids: z.array(z.string().min(1).max(150)).max(50).optional(),
  })
  .strict();
/** The category an unidentified item without a presented one is told and sold as. */
export const NEUTRAL_CATEGORY = "general";
export type Unidentified = z.infer<typeof unidentifiedSchema>;

/** Players see this where a value would be. */
export const UNKNOWN_VALUE = "unknown value";
export const UNKNOWN_SALE =
  "This item is unidentified and its value is unknown. The DM can set a value for it or identify it first.";
export const UNIDENTIFIED_EDIT =
  "This item is unidentified. Only its quantity and whether it is equipped change here; the DM edits it from Party → Funds & inventory.";

type Marked = { unidentified?: unknown };

/** "Unidentified" chip text for an inventory row: the DM also reads what players see. */
export function unidentifiedLabel(h: Holding, dm: boolean): string | null {
  if (!isUnidentified(h)) return null;
  return dm ? `Unidentified · players see “${h.unidentified.name}”` : "Unidentified";
}

/** Whether a row shows a value: players see "unknown value" for an item without one. */
export function holdingValueKnown(h: Holding, dm: boolean): boolean {
  return dm || !isUnidentified(h) || h.unidentified.value !== undefined;
}

/** Whether `h` carries a valid presented record (an unidentified item). */
export function isUnidentified<H extends Marked>(h: H | null | undefined): h is H & { unidentified: Unidentified } {
  return !!h && typeof h === "object" && unidentifiedSchema.safeParse(h.unidentified).success;
}

/**
 * What everyone but the DM is told about `h`: the presented name, description and value in place
 * of the true ones, without the image, commodity or material that could name the item. An
 * identified holding is returned unchanged. Presenting a presented holding changes nothing.
 */
export function presentedHolding<H extends Holding>(h: H): H {
  if (!isUnidentified(h)) return h;
  const u = h.unidentified;
  const { image: _image, commodityId: _commodity, materialKey: _material, valueSource: _source, ...rest } = h;
  const shown = {
    ...rest,
    name: u.name,
    notes: u.description ?? "",
    unitCopper: u.value ?? 0,
    category: u.category ?? NEUTRAL_CATEGORY,
    // The server's lineage IDs are never told: they could name other holdings.
    unidentified: presentedRecord(u),
  } as H;
  if (u.weight !== undefined) shown.weight = u.weight;
  return shown;
}

/** The presented record as players receive it: without the server's lineage IDs. */
export function presentedRecord(u: Unidentified): Unidentified {
  const { ids: _ids, ...told } = u;
  return told;
}

/** The value a sale or a receipt may use: the presented value, or null when it is unknown. */
export function knownUnitCopper(h: Pick<Holding, "unitCopper"> & Marked): number | null {
  if (!isUnidentified(h)) return h.unitCopper;
  return h.unidentified.value ?? null;
}

/** One unidentified holding: what must not be told, and what is told instead. */
export type IdentitySecret = { trueName: string; trueNotes: string; trueCopper: number; shown: Holding };
export type IdentitySecrets = Map<string, IdentitySecret>;

export function identitySecrets(holdings: readonly Holding[]): IdentitySecrets {
  const secrets: IdentitySecrets = new Map();
  for (const h of holdings)
    if (isUnidentified(h)) {
      const secret = { trueName: h.name, trueNotes: h.notes, trueCopper: h.unitCopper, shown: presentedHolding(h) };
      // Records linked to the item's earlier holding IDs are presented too.
      for (const id of [h.id, ...(h.unidentified.ids ?? [])]) if (!secrets.has(id)) secrets.set(id, secret);
    }
  return secrets;
}

/**
 * The secrets a command's records must keep: holdings still in the table as they are now, and
 * holdings the command removed (sold, given away, used up) as they were before it.
 */
export function commandSecrets(before: readonly Holding[], after: readonly Holding[]): IdentitySecrets {
  const now = identitySecrets(after);
  const kept = new Set(after.map((h) => h.id));
  for (const [id, secret] of identitySecrets(before)) if (!kept.has(id)) now.set(id, secret);
  return now;
}

/** An unidentified item that left the inventory (sold, used up): a DM-only event keeps it. */
export const identityEndedSchema = z
  .object({
    holdingIds: z.array(z.string().min(1).max(150)).min(1).max(51),
    unitCopper: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    value: z.number().int().nonnegative().max(1e12).optional(),
  })
  .strict();
export type IdentityEnded = z.infer<typeof identityEndedSchema>;

/**
 * Every secret of a table: its unidentified holdings, and the items that left it unidentified
 * this session (`identityEnded` on DM-only events, which go to the session archive with the lines
 * they cover). Reads the holdings and the live journal only, never ledger pages.
 */
export function tableSecrets(t: { holdings: readonly Holding[]; journal?: { events?: readonly { identityEnded?: IdentityEnded }[] } }): IdentitySecrets {
  const secrets = identitySecrets(t.holdings);
  for (const e of t.journal?.events ?? []) {
    const ended = e.identityEnded;
    if (!ended) continue;
    // Never a name or notes match ("\u0000"): only linked values are presented.
    const secret = {
      trueName: "\u0000",
      trueNotes: "\u0000",
      trueCopper: ended.unitCopper,
      shown: { id: ended.holdingIds[0]!, purseId: "", name: "", kind: "item", quantity: 0, notes: "", unitCopper: ended.value ?? 0 } as Holding,
    };
    for (const id of ended.holdingIds) if (!secrets.has(id)) secrets.set(id, secret);
  }
  return secrets;
}

/** The presented record without the server's bookkeeping, for comparing two copies of an item. */
function sameItem(a: Holding & { unidentified: Unidentified }, b: Holding & { unidentified: Unidentified }) {
  const { ids: _a, ...ua } = a.unidentified;
  const { ids: _b, ...ub } = b.unidentified;
  return a.name === b.name && a.notes === b.notes && a.unitCopper === b.unitCopper && canonicalJson(ua) === canonicalJson(ub);
}

/**
 * After a command: an unidentified holding with a new ID (a give, a pool resolution, a storage
 * move or a trade copied it) records the IDs of the holding it came from, so records linked to
 * those IDs stay presented. Only holdings this command reduced or removed can be its source. An
 * unidentified item the command removed without a successor (sold, used up) leaves a DM-only
 * event with `identityEnded`, so its linked records stay presented for the rest of the session.
 * Reads holdings only, never the ledger. `t` changes in place.
 */
export function identityLineage(
  before: readonly Holding[],
  t: { holdings: Holding[]; journal?: { events: object[] } },
  receiptId: string,
  at: number,
) {
  const after = new Map(t.holdings.map((h) => [h.id, h]));
  const touched = before.filter(isUnidentified).filter((b) => (after.get(b.id)?.quantity ?? 0) < b.quantity);
  if (!touched.length) return;
  const known = new Set(before.map((h) => h.id));
  const successors = new Set<string>();
  for (const h of t.holdings) {
    if (known.has(h.id) || !isUnidentified(h)) continue;
    const from = touched.filter((b) => sameItem(b, h));
    if (!from.length) continue;
    const ids = [...new Set([...(h.unidentified.ids ?? []), ...from.flatMap((b) => [b.id, ...(b.unidentified.ids ?? [])])])].slice(-50);
    h.unidentified = { ...h.unidentified, ids };
    for (const b of from) successors.add(b.id);
  }
  for (const b of touched) {
    if (after.has(b.id) || successors.has(b.id)) continue;
    t.journal?.events.push({
      id: `${receiptId}-identity-${b.id}`.slice(0, 150),
      at,
      kind: "management",
      dmOnly: true,
      purseId: b.purseId,
      summary: `An unidentified item left the inventory: ${b.name} (players saw ${b.unidentified.name})`.slice(0, 500),
      identityEnded: {
        holdingIds: [b.id, ...(b.unidentified.ids ?? [])].slice(0, 51),
        unitCopper: b.unitCopper,
        ...(b.unidentified.value === undefined ? {} : { value: b.unidentified.value }),
      },
    });
  }
}

/**
 * `value` with every unidentified item presented (see the module comment). Returns `value`
 * itself when there is nothing to hide. Never mutates its input.
 */
export function redactIdentity<T>(value: T, secrets: IdentitySecrets): T {
  if (!secrets.size) return value;
  const walk = (v: unknown, key: string): unknown => {
    // Text is never parsed or rewritten: item snapshots stored as text (trade and barter
    // `before`, property `itemBefore`) are written in their presented form at source, and
    // anything a person typed is returned exactly as written.
    if (typeof v === "string") return v;
    void key;
    if (Array.isArray(v)) {
      let changed = false;
      const next = v.map((item) => {
        const out = walk(item, key);
        if (out !== item) changed = true;
        return out;
      });
      return changed ? next : v;
    }
    if (!v || typeof v !== "object") return v;
    let o = v as Record<string, unknown>;
    let changed = false;
    // A copy of a holding: the presented form.
    if ("unitCopper" in o && "name" in o && isUnidentified(o)) {
      o = presentedHolding(o as unknown as Holding) as unknown as Record<string, unknown>;
      changed = true;
    } else {
      // A record about one secret holding (a receipt, claim, order or sheet line).
      const secret =
        (typeof o.holdingId === "string" ? secrets.get(o.holdingId) : undefined) ??
        (typeof o.id === "string" && "unitCopper" in o ? secrets.get(o.id) : undefined);
      if (secret) {
        const patch: Record<string, unknown> = {};
        if (o.name === secret.trueName) patch.name = secret.shown.name;
        if (o.notes === secret.trueNotes) patch.notes = secret.shown.notes;
        if (o.notesBefore === secret.trueNotes) patch.notesBefore = secret.shown.notes;
        if (typeof o.unitCopper === "number" && o.unitCopper === secret.trueCopper && secret.trueCopper !== secret.shown.unitCopper)
          patch.unitCopper = secret.shown.unitCopper;
        if (Object.keys(patch).length) {
          o = { ...o, ...patch };
          changed = true;
        }
      }
    }
    const out: Record<string, unknown> = {};
    for (const [k, item] of Object.entries(o)) {
      const next = walk(item, k);
      if (next !== item) changed = true;
      out[k] = next;
    }
    return changed ? out : v;
  };
  return walk(value, "") as T;
}

/**
 * The player projection of a whole table: `projected` with the unidentified items of `source`
 * (the unprojected table it was made from) presented. A table without unidentified items is
 * returned as it is.
 */
export function projectIdentities<T>(source: Parameters<typeof tableSecrets>[0], projected: T): T {
  return redactIdentity(projected, tableSecrets(source));
}

/** Item snapshot text for a stored record (trades, barter, withdrawals): the presented form. */
export function snapshotText(h: Holding): string {
  return canonicalJson(presentedHolding(h));
}

/**
 * What a command created, kept safe: the structured item fields (`holdingId`-linked receipts,
 * claims, loot links, award tags, order snapshots) of the ledger lines, events and service orders
 * this command added, other than DM-only events, present unidentified items. Rows that existed
 * before the command, and all prose, are untouched. `before` is the baseline taken before the
 * command; `t` is changed in place.
 */
export function redactWritten(
  before: { holdings: readonly Holding[]; ledgerLength: number; eventIds: Set<string>; orderIds: Set<string> },
  t: {
    holdings: Holding[];
    ledger: Array<{ id: string }>;
    journal?: { events?: Array<{ id: string; dmOnly?: boolean }>; services?: unknown };
  },
) {
  const secrets = commandSecrets(before.holdings, t.holdings);
  if (!secrets.size) return;
  const fresh = <R extends { id: string }>(rows: R[], seen: Set<string>, keep: (r: R) => boolean = () => true) =>
    rows.map((r) => (!seen.has(r.id) && keep(r) ? redactIdentity(r, secrets) : r));
  // Only the lines appended by this command: older ledger pages are never read (history on demand).
  for (let i = before.ledgerLength; i < t.ledger.length; i++) t.ledger[i] = redactIdentity(t.ledger[i]!, secrets);
  const j = t.journal;
  if (!j) return;
  if (j.events) j.events = fresh(j.events, before.eventIds, (e) => !e.dmOnly);
  // A new service order snapshots the item it is about (terms.item).
  const services = j.services as { orders?: Array<{ id: string }> } | undefined;
  if (services?.orders) services.orders = fresh(services.orders, before.orderIds);
}

/** The baseline `redactWritten` compares against, taken before a command runs. */
export function writtenBaseline(t: {
  holdings: readonly Holding[];
  ledger: readonly { id: string }[];
  journal?: { events?: readonly { id: string }[]; services?: unknown };
}) {
  const orders = (t.journal?.services as { orders?: Array<{ id: string }> } | undefined)?.orders ?? [];
  return {
    holdings: t.holdings.map((h) => ({ ...h })),
    // The length only: reading line IDs would load every ledger page (history on demand).
    ledgerLength: t.ledger.length,
    eventIds: new Set((t.journal?.events ?? []).map((e) => e.id)),
    orderIds: new Set(orders.map((o) => o.id)),
  };
}

/**
 * Reveal `h` (the `item-identify` command and an approved Identify service): the presented record
 * is removed, so everyone sees the true item from now on, and one event logs the reveal, visible
 * to whoever can read the holder's events. It may name the true item: it is no longer a secret.
 */
export function identifyHolding(
  t: { journal?: { events: object[] } },
  h: Holding,
  receiptId: string,
  at: number,
  by?: string,
) {
  if (!isUnidentified(h)) return;
  const was = h.unidentified.name;
  delete (h as Holding).unidentified;
  t.journal?.events.push({
    id: `${receiptId}-identified`,
    at,
    kind: "management",
    purseId: h.purseId,
    summary: `Identified${by ? ` by ${by}` : ""}: ${was} is ${h.name}`.slice(0, 500),
  });
}

/**
 * A whole-holding write from a player (a sheet save or a turn bill) for an unidentified item:
 * the player saw the presented record, so only quantity and equipped may change, and the true
 * record (with its presented record) is kept. Throws when the player tried to change what the
 * item is.
 */
export function keepIdentity<H extends Holding>(
  old: H,
  incoming: { name: string; notes?: string; unitCopper?: number; kind?: string; quantity: number; equipped?: boolean; weight?: number },
): H {
  if (!isUnidentified(old)) throw Error("Not an unidentified item.");
  const shown = presentedHolding(old);
  if (
    incoming.name !== shown.name ||
    (incoming.notes ?? "") !== shown.notes ||
    (incoming.unitCopper ?? 0) !== shown.unitCopper ||
    (incoming.kind ?? "item") !== (old.kind || "item")
  )
    throw Error(UNIDENTIFIED_EDIT);
  // The weight shown may be a presented one: the true weight is kept.
  if (incoming.weight !== undefined && incoming.weight !== (shown.weight ?? 0)) throw Error(UNIDENTIFIED_EDIT);
  const next = { ...old, quantity: incoming.quantity };
  if (incoming.equipped !== undefined) next.equipped = incoming.equipped;
  return next;
}
