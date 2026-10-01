import { z } from "zod";
import type { CloudTable, CloudSeat } from "./cloud.ts";
import { fromCopper, toCopper, spendCoins, priceAfterCharisma } from "./money.ts";
import { charismaScore, readSheets } from "./sheet.ts";
import { validateEconomyRows } from "./validation.ts";
const id = z.string().min(1).max(150),
  amount = z.number().int().nonnegative().max(1e12),
  qty = amount.min(1).max(100000);
const base = { id };
export const commandSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("buy"), stockId: id, purseId: id, quantity: qty }),
  z.object({ ...base, kind: z.literal("sell"), holdingId: id, shopId: id, quantity: qty }),
  z.object({ ...base, kind: z.literal("listing"), listingId: id, purseId: id, quantity: qty }),
  z.object({
    ...base,
    kind: z.literal("give"),
    fromId: id,
    toId: id,
    copper: amount,
    holdingId: id.nullable(),
    quantity: amount,
  }),
  z.object({
    ...base,
    kind: z.literal("loan"),
    purseId: id,
    copper: amount.min(1),
    note: z.string().trim().min(1).max(1000),
  }),
  z.object({
    ...base,
    kind: z.literal("decision"),
    loanId: id,
    status: z.enum(["approved", "denied"]),
  }),
  z.object({
    ...base,
    kind: z.literal("message"),
    to: z.enum(["party", "dm", "player"]),
    recipientId: id.optional(),
    purseId: z.string().max(150),
    text: z.string().trim().min(1).max(500),
  }),
  z.object({ ...base, kind: z.literal("sheet"), sheet: z.unknown() }),
  z.object({
    ...base,
    kind: z.literal("patch"),
    changes: z
      .array(
        z.object({
          store: z.enum([
            "purses",
            "holdings",
            "shops",
            "stock",
            "ledger",
            "listings",
            "loans",
            "sheets",
            "handouts",
            "realm",
          ]),
          id: z.string(),
          before: z.unknown(),
          after: z.unknown(),
        }),
      )
      .max(10000),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandInput = Command extends infer C
  ? C extends Command
    ? Omit<C, "id">
    : never
  : never;
export function applyCommand(input: CloudTable, seat: CloudSeat, raw: Command): CloudTable {
  const cmd = commandSchema.parse(raw);
  const t = structuredClone(input);
  const at = Date.now();
  const own = (purseId: string) => {
    if (seat.role !== "dm" && !seat.purseIds.includes(purseId))
      throw new Error("You do not have permission to spend from this account.");
    const p = t.purses.find((p) => p.id === purseId);
    if (!p) throw new Error("Account no longer exists.");
    return p;
  };
  const dm = () => {
    if (seat.role !== "dm") throw new Error("Only the DM can perform this action.");
  };
  const coins = (purseId: string, delta: number) => {
    const p = t.purses.find((p) => p.id === purseId);
    if (!p) throw new Error("Account no longer exists.");
    const total = toCopper(p.coins) + delta;
    if (!Number.isSafeInteger(total) || total < 0 || total > 1e12)
      throw new Error("Insufficient funds or invalid amount.");
    p.coins = delta < 0 ? spendCoins(p.coins, -delta)! : fromCopper(total);
  };
  const log = (
    purseId: string,
    summary: string,
    copper: number,
    shopId: string | null = null,
    suffix = "",
  ) => t.ledger.push({ id: cmd.id + suffix, at, purseId, shopId, summary, copper });
  const score = (purseId: string) =>
    t.purses.find((p) => p.id === purseId)?.kind === "party"
      ? null
      : charismaScore(t.sheets.find((s) => s.purseId === purseId));
  if (cmd.kind === "buy") {
    own(cmd.purseId);
    const s = t.stock.find((x) => x.id === cmd.stockId),
      shop = t.shops.find((x) => x.id === s?.shopId);
    if (!s || !shop) throw new Error("Item or shop no longer exists.");
    if (s.quantity !== null && s.quantity < cmd.quantity)
      throw new Error("Not enough stock. Refresh and choose a smaller quantity.");
    const cost =
      priceAfterCharisma(Math.round(s.copper * shop.sellRate), score(cmd.purseId)) * cmd.quantity;
    coins(cmd.purseId, -cost);
    if (s.quantity !== null) s.quantity -= cmd.quantity;
    t.holdings.push({
      id: cmd.id + "-item",
      purseId: cmd.purseId,
      name: s.name,
      kind: "item",
      quantity: cmd.quantity,
      unitCopper: s.copper,
      notes: "",
    });
    log(cmd.purseId, `Bought ${cmd.quantity} ${s.name} from ${shop.name}`, -cost, shop.id);
  } else if (cmd.kind === "listing") {
    own(cmd.purseId);
    const l = t.listings.find((x) => x.id === cmd.listingId);
    if (!l) throw new Error("Listing no longer exists.");
    if (l.quantity !== null && l.quantity < cmd.quantity)
      throw new Error("Not enough listing stock.");
    const cost = priceAfterCharisma(l.copper, score(cmd.purseId)) * cmd.quantity;
    coins(cmd.purseId, -cost);
    if (l.quantity !== null) l.quantity -= cmd.quantity;
    t.holdings.push({
      id: cmd.id + "-item",
      purseId: cmd.purseId,
      name: l.name,
      kind: l.kind,
      quantity: cmd.quantity,
      unitCopper: l.copper,
      notes: l.notes,
    });
    log(cmd.purseId, `Bought ${cmd.quantity} ${l.name} from the market`, -cost);
  } else if (cmd.kind === "sell") {
    const h = t.holdings.find((x) => x.id === cmd.holdingId),
      s = t.shops.find((x) => x.id === cmd.shopId);
    if (!h || !s) throw new Error("Item or shop no longer exists.");
    own(h.purseId);
    if (h.quantity < cmd.quantity) throw new Error("Not enough items to sell.");
    const paid = Math.round(h.unitCopper * s.buyRate) * cmd.quantity;
    coins(h.purseId, paid);
    h.quantity -= cmd.quantity;
    t.holdings = t.holdings.filter((x) => x.quantity > 0);
    log(h.purseId, `Sold ${cmd.quantity} ${h.name} to ${s.name}`, paid, s.id);
  } else if (cmd.kind === "give") {
    own(cmd.fromId);
    if (cmd.fromId === cmd.toId || !t.purses.some((x) => x.id === cmd.toId))
      throw new Error("Choose a different recipient.");
    if (!cmd.copper && !cmd.holdingId) throw new Error("Choose coins or an item to transfer.");
    coins(cmd.fromId, -cmd.copper);
    coins(cmd.toId, cmd.copper);
    if (cmd.holdingId) {
      const h = t.holdings.find((x) => x.id === cmd.holdingId && x.purseId === cmd.fromId);
      if (!h || cmd.quantity < 1 || h.quantity < cmd.quantity)
        throw new Error("Not enough items to transfer.");
      h.quantity -= cmd.quantity;
      t.holdings.push({ ...h, id: cmd.id + "-item", purseId: cmd.toId, quantity: cmd.quantity });
      t.holdings = t.holdings.filter((x) => x.quantity > 0);
    }
    log(cmd.fromId, "Transfer sent", -cmd.copper);
    log(cmd.toId, "Transfer received", cmd.copper, null, "-received");
    t.notes.push({
      id: cmd.id + "-note",
      at,
      from: seat.role,
      to: "party",
      purseId: cmd.fromId,
      text: `${seat.name} transferred ${cmd.copper} cp${cmd.holdingId ? " and items" : ""} to ${t.purses.find((p) => p.id === cmd.toId)?.name}.`,
    });
  } else if (cmd.kind === "loan") {
    const p = own(cmd.purseId);
    t.loans.push({
      id: cmd.id,
      at,
      purseId: p.id,
      purseName: p.name,
      copper: cmd.copper,
      note: cmd.note,
      status: "pending",
    });
  } else if (cmd.kind === "decision") {
    dm();
    const l = t.loans.find((x) => x.id === cmd.loanId);
    if (!l) throw new Error("Loan request not found.");
    if (l.status !== "pending") throw new Error("This loan has already been decided.");
    l.status = cmd.status;
    if (cmd.status === "approved") {
      coins(l.purseId, l.copper);
      log(l.purseId, "Loan approved", l.copper);
    }
  } else if (cmd.kind === "message") {
    if (seat.role === "player") {
      const sender = own(cmd.purseId);
      if (sender.kind !== "character") throw new Error("Send as your character.");
    }
    if (cmd.to === "player") {
      if (seat.role !== "player" || cmd.recipientId === cmd.purseId || !t.purses.some((p) => p.id === cmd.recipientId && p.kind === "character" && p.control !== "npc")) throw new Error("Choose another player character.");
    }
    else if (cmd.to === "dm" && !t.purses.some((p) => p.id === cmd.purseId))
      throw new Error("Choose a recipient.");
    t.notes.push({
      id: cmd.id,
      at,
      from: seat.role,
      to: cmd.to,
      ...(cmd.to === "player" ? { recipientId: cmd.recipientId } : {}),
      purseId: cmd.purseId,
      text: cmd.text,
    });
  } else if (cmd.kind === "sheet") {
    const s = readSheets([cmd.sheet])[0];
    if (!s) throw new Error("Invalid character sheet.");
    own(s.purseId); // Players may maintain sheets, but financial bonuses are DM-controlled online.
    if (seat.role !== "dm") {
      const old = t.sheets.find((x) => x.purseId === s.purseId);
      if (JSON.stringify(old?.abilities) !== JSON.stringify(s.abilities))
        throw new Error("Ask the DM to import or change ability scores in shared modes.");
    }
    t.sheets = [...t.sheets.filter((x) => x.purseId !== s.purseId), s];
  } else if (cmd.kind === "patch") {
    dm();
    for (const change of cmd.changes) {
      if (change.store === "realm") {
        if (!same(t.realm ?? null, change.before))
          throw new Error("Economy settings changed elsewhere. Review your pending changes.");
        t.realm = change.after as CloudTable["realm"];
        continue;
      }
      const rows = (t[change.store] ?? []) as any[];
      const rowId = (x: any) => (change.store === "sheets" ? x.purseId : x.id);
      const current = rows.find((x) => rowId(x) === change.id) ?? null;
      if (!same(current, change.before))
        throw new Error(
          `Conflict in ${change.store}. Export your pending changes, then refresh and retry.`,
        );
      (t as any)[change.store] = [
        ...rows.filter((x) => rowId(x) !== change.id),
        ...(change.after === null ? [] : [change.after]),
      ];
    }
  }
  validateEconomyRows(t);
  return t;
}
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function tablePatch(before: CloudTable, after: CloudTable): CommandInput {
  const changes: Extract<Command, { kind: "patch" }>["changes"] = [];
  for (const store of [
    "purses",
    "holdings",
    "shops",
    "stock",
    "ledger",
    "listings",
    "loans",
    "sheets",
    "handouts",
  ] as const) {
    const a = new Map((before[store] ?? []).map((x) => ["id" in x ? x.id : x.purseId, x]));
    const b = new Map((after[store] ?? []).map((x) => ["id" in x ? x.id : x.purseId, x]));
    for (const id of new Set([...a.keys(), ...b.keys()]))
      if (!same(a.get(id) ?? null, b.get(id) ?? null))
        changes.push({ store, id, before: a.get(id) ?? null, after: b.get(id) ?? null });
  }
  if (!same(before.realm ?? null, after.realm ?? null))
    changes.push({
      store: "realm",
      id: "realm",
      before: before.realm ?? null,
      after: after.realm ?? null,
    });
  return { kind: "patch", changes };
}
