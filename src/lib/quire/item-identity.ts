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
 * Two layers keep the true details out of what players receive:
 * - **At write time** (`redactWritten`, run by `applyOwnedCommand` and both encounter award
 *   paths): the records a command adds name and value the item as presented, so they stay safe
 *   after the item is sold or given away.
 * - **At projection time** (`redactIdentity`): every holding copy is replaced by its presented
 *   form, every record tied to a secret holding takes the presented name and value, and the true
 *   name and notes are replaced as text anywhere they still appear.
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
  })
  .strict();
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
  return {
    ...rest,
    name: u.name,
    notes: u.description ?? "",
    unitCopper: u.value ?? 0,
    unidentified: { ...u },
  } as H;
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
    if (isUnidentified(h))
      secrets.set(h.id, { trueName: h.name, trueNotes: h.notes, trueCopper: h.unitCopper, shown: presentedHolding(h) });
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

/** Text replacements, longest first: true notes, then true names (short names only as fields). */
function needles(secrets: IdentitySecrets): Array<[string, string]> {
  const pairs = new Map<string, string>();
  for (const s of secrets.values()) {
    const notes = s.trueNotes.trim();
    if (notes.length >= 4 && notes !== s.shown.notes.trim()) pairs.set(notes, s.shown.notes);
    const name = s.trueName.trim();
    if (name.length >= 3 && name !== s.shown.name) pairs.set(name, s.shown.name);
  }
  return [...pairs].sort((a, b) => b[0].length - a[0].length);
}

const escaped = (text: string) => JSON.stringify(text).slice(1, -1);

/**
 * `value` with every unidentified item presented (see the module comment). Returns `value`
 * itself when there is nothing to hide. Never mutates its input.
 */
export function redactIdentity<T>(value: T, secrets: IdentitySecrets): T {
  if (!secrets.size) return value;
  const text = needles(secrets);
  const jsonText = text.map(([a, b]) => [escaped(a), escaped(b)] as [string, string]);
  const scrub = (s: string, pairs: Array<[string, string]>) => {
    let out = s;
    for (const [needle, replacement] of pairs) if (out.includes(needle)) out = out.split(needle).join(replacement);
    return out;
  };
  const walk = (v: unknown, key: string): unknown => {
    if (typeof v === "string") {
      // Identifiers and pictures are never prose (a short name could occur inside base64 text).
      if (v.startsWith("data:") || key === "id" || key.endsWith("Id") || key.endsWith("Ids") || key === "image" || key === "portrait")
        return v;
      // Archived session snapshots are JSON text; their own holdings were projected when they
      // were read (`projectArchivedReport`). Replace the escaped text so the JSON stays valid.
      if (key === "snapshot") return scrub(v, jsonText);
      // Item snapshots inside trades and barter offers (`before`) are canonical JSON of a holding.
      if (v.length < 200000 && v.startsWith("{") && v.includes('"unitCopper"')) {
        try {
          const parsed: unknown = JSON.parse(v);
          const next = walk(parsed, "");
          if (next !== parsed) return canonicalJson(parsed) === v ? canonicalJson(next) : JSON.stringify(next);
          return scrub(v, jsonText);
        } catch {
          /* Not JSON: plain text. */
        }
      }
      return scrub(v, text);
    }
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
export function projectIdentities<T>(source: { holdings: readonly Holding[] }, projected: T): T {
  return redactIdentity(projected, identitySecrets(source.holdings));
}

/**
 * What a command wrote, kept safe: the records it added (ledger lines, notes, events and
 * journal entries other than DM-only ones), service orders and treasure-pool history name and
 * value unidentified items as presented. `before` is the table before the command; `t` is changed
 * in place.
 */
export function redactWritten(
  before: { holdings: readonly Holding[]; ledgerIds: Set<string>; noteIds: Set<string>; eventIds: Set<string>; entryIds: Set<string> },
  t: {
    holdings: Holding[];
    ledger: Array<{ id: string }>;
    notes: Array<{ id: string; to?: string }>;
    journal?: {
      events?: Array<{ id: string; dmOnly?: boolean }>;
      entries?: Array<{ id: string; visibility?: string }>;
      services?: unknown;
      [key: string]: unknown;
    };
  },
) {
  const secrets = commandSecrets(before.holdings, t.holdings);
  if (!secrets.size) return;
  const fresh = <R extends { id: string }>(rows: R[] | undefined, seen: Set<string>, keep: (r: R) => boolean = () => true) =>
    rows?.map((r) => (!seen.has(r.id) && keep(r) ? redactIdentity(r, secrets) : r));
  t.ledger = fresh(t.ledger, before.ledgerIds)!;
  t.notes = fresh(t.notes, before.noteIds, (n) => n.to !== "dm")!;
  const j = t.journal;
  if (!j) return;
  if (j.events) j.events = fresh(j.events, before.eventIds, (e) => !e.dmOnly);
  if (j.entries) j.entries = fresh(j.entries, before.entryIds, (e) => e.visibility !== "dm");
  // Service orders snapshot the item they are about (terms.item); providers stay as written.
  const services = j.services as { orders?: unknown[] } | undefined;
  if (services?.orders) services.orders = redactIdentity(services.orders, secrets);
  if (j.lootClaims) j.lootClaims = redactIdentity(j.lootClaims, secrets);
}

/** The ID sets `redactWritten` compares against, taken before a command runs. */
export function writtenBaseline(t: {
  holdings: readonly Holding[];
  ledger: readonly { id: string }[];
  notes: readonly { id: string }[];
  journal?: { events?: readonly { id: string }[]; entries?: readonly { id: string }[] };
}) {
  return {
    holdings: t.holdings.map((h) => ({ ...h })),
    ledgerIds: new Set(t.ledger.map((l) => l.id)),
    noteIds: new Set(t.notes.map((n) => n.id)),
    eventIds: new Set((t.journal?.events ?? []).map((e) => e.id)),
    entryIds: new Set((t.journal?.entries ?? []).map((e) => e.id)),
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
 * the player saw the presented record, so only quantity, equipped and weight may change, and the
 * true record is kept. Throws when the player tried to change what the item is.
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
  const next = { ...old, quantity: incoming.quantity };
  if (incoming.equipped !== undefined) next.equipped = incoming.equipped;
  if (incoming.weight !== undefined) next.weight = incoming.weight;
  return next;
}
