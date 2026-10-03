import { readJournal, type Journal } from "./journal.ts";
import { validateEconomyRows } from "./validation.ts";
import { clampRealm } from "./scale.ts";
import type { RealmSettings } from "./types.ts";
import type { ChatNote } from "./chat.ts";
import { mergeNoteLists, readNotes } from "./chat.ts";
import { readGifts } from "./gift.ts";
import { mergeLoanLists, readListings, readLoans, readSales, type Listing, type LoanAsk } from "./market.ts";
import { fromCopper } from "./money.ts";
import { mergeSheets, readSheets, type CharacterSheet } from "./sheet.ts";
import { lesserQuantity, type BillFile } from "./table.ts";
import { readHandouts, type Handout } from "./handouts.ts";
import { characterControl, type Coins, type Holding, type LedgerLine, type Purse, type Shop, type StockLine } from "./types.ts";

export type CloudTable = {
  journal?: Journal;
  realm?: RealmSettings;
  purses: Purse[];
  holdings: Holding[];
  shops: Shop[];
  stock: StockLine[];
  ledger: LedgerLine[];
  listings: Listing[];
  loans: LoanAsk[];
  sheets: CharacterSheet[];
  notes: ChatNote[];
  handouts?: Handout[];
};

export type CloudSeat = {
  id: string;
  token: string;
  name: string;
  role: "dm" | "player";
  purseIds: string[];
};

export type CloudSeen = { gifts: string[]; sales: string[] };

export type CloudRoom = {
  code: string;
  revision: number;
  turn: number;
  live: boolean;
  seats: CloudSeat[];
  table: CloudTable;
  seen: CloudSeen;
  commands?: string[];
  batches?: string[];
  drafts?: Record<string, import("./commands.ts").Command[]>;
};

export function emptyCloudTable(): CloudTable {
  return { purses: [], holdings: [], shops: [], stock: [], ledger: [], listings: [], loans: [], sheets: [], notes: [] };
}

export function readCloudTable(value: unknown): CloudTable | null {
  if (typeof value !== "object" || value === null) return null;
  const table = value as Partial<CloudTable>;
  if (!Array.isArray(table.purses) || !Array.isArray(table.holdings) || !Array.isArray(table.shops) || !Array.isArray(table.stock) || !Array.isArray(table.ledger)) {
    return null;
  }
  try { validateEconomyRows(table as CloudTable); readJournal(table.journal); } catch { return null; }
  return {
    journal: readJournal(table.journal),
    realm: table.realm ? clampRealm(table.realm) : undefined,
    purses: table.purses,
    holdings: table.holdings,
    shops: table.shops,
    stock: table.stock,
    ledger: table.ledger,
    listings: readListings(table.listings),
    loans: readLoans(table.loans),
    sheets: readSheets(table.sheets),
    notes: readNotes(table.notes),
    handouts: readHandouts(table.handouts),
  };
}

export function nextTurn(turn: number, count: number): number {
  if (count <= 1) return 0;
  return (turn + 1) % count;
}

export function applyBillToTable(table: CloudTable, bill: BillFile, seen: CloudSeen): { table: CloudTable; seen: CloudSeen } {
  const purseIds = new Set(bill.purseIds);
  const purses = table.purses.map((purse) => {
    const next = bill.purses.find((item) => item.id === purse.id);
    return next && purseIds.has(purse.id) ? next : { ...purse, coins: { ...purse.coins } };
  });
  const holdings = [...table.holdings.filter((holding) => !purseIds.has(holding.purseId)), ...bill.holdings.filter((holding) => purseIds.has(holding.purseId))];
  const stock = table.stock.map((line) => {
    const update = bill.stock.find((item) => item.id === line.id);
    if (!update) return line;
    const quantity = lesserQuantity(line.quantity, update.quantity);
    return quantity === line.quantity ? line : { ...line, quantity };
  });
  const have = new Set(table.ledger.map((line) => line.id));
  const ledger = [...table.ledger, ...bill.ledger.filter((line) => !have.has(line.id) && purseIds.has(line.purseId))];
  const giftSeen = new Set(seen.gifts);
  for (const gift of readGifts(bill.gifts)) {
    if (giftSeen.has(gift.id) || !purseIds.has(gift.fromId)) continue;
    const purse = purses.find((item) => item.id === gift.toId);
    if (!purse) continue;
    if (gift.copper > 0) purse.coins = addCoins(purse.coins, gift.copper);
    if (gift.holding) {
      holdings.push({
        id: crypto.randomUUID(),
        purseId: purse.id,
        ...gift.holding,
        notes: gift.holding.notes ?? "",
      });
    }
    giftSeen.add(gift.id);
  }
  const saleSeen = new Set(seen.sales);
  const listings = table.listings.map((listing) => ({ ...listing }));
  for (const sale of readSales(bill.sales)) {
    if (saleSeen.has(sale.id) || !purseIds.has(sale.purseId)) continue;
    const listing = listings.find((item) => item.id === sale.listingId);
    if (listing && listing.quantity !== null) listing.quantity = Math.max(0, listing.quantity - sale.quantity);
    saleSeen.add(sale.id);
  }
  return {
    table: {
      realm: table.realm,
      purses,
      holdings,
      shops: table.shops,
      stock,
      ledger,
      listings,
      loans: mergeLoanLists(table.loans, readLoans(bill.loans), true),
      sheets: mergeSheets(table.sheets, readSheets(bill.sheets).filter((sheet) => purseIds.has(sheet.purseId))),
      notes: mergeNoteLists(table.notes, bill.notes ?? []),
      handouts: table.handouts,
      journal: table.journal,
    },
    seen: { gifts: [...giftSeen], sales: [...saleSeen] },
  };
}

export function claimSeat(room: CloudRoom, purseId: string, name: string): { room: CloudRoom; seat: CloudSeat } {
  const purse = room.table.purses.find((item) => item.id === purseId && item.kind === "character" && characterControl(item) === "player");
  if (!purse) throw new Error("That character is not at this table.");
  const taken = room.seats.find((seat) => seat.purseIds.includes(purseId));
  if (taken) throw new Error(`${purse.name} is already seated.`);
  const seat: CloudSeat = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: name.trim() || purse.name, role: "player", purseIds: [purseId] };
  return { room: { ...room, seats: [...room.seats, seat] }, seat };
}

export function setRoomLive(room: CloudRoom, token: string, live: boolean): CloudRoom {
  const seat = room.seats.find((item) => item.token === token);
  if (!seat || seat.role !== "dm") throw new Error("Only the dungeon master can open the table.");
  if (room.live === live) return room;
  return { ...room, live, revision: room.revision + 1 };
}

export function endDmTurn(room: CloudRoom, token: string, table: CloudTable, baseRevision?: number): CloudRoom {
  const seat = room.live ? seated(room, token) : requireTurn(room, token);
  if (seat.role !== "dm") throw new Error("Only the dungeon master can publish the whole table.");
  expectRevision(room, baseRevision);
  if (room.live) return { ...room, table, revision: room.revision + 1 };
  return advance({ ...room, table });
}

export function endPlayerTurn(room: CloudRoom, token: string, bill: BillFile, baseRevision?: number): CloudRoom {
  const seat = room.live ? seated(room, token) : requireTurn(room, token);
  if (seat.role !== "player") throw new Error("The dungeon master publishes the whole table.");
  expectRevision(room, baseRevision);
  const limited: BillFile = {
    ...bill,
    purseIds: seat.purseIds,
    purses: bill.purses.filter((purse) => seat.purseIds.includes(purse.id)),
    holdings: bill.holdings.filter((holding) => seat.purseIds.includes(holding.purseId)),
    ledger: bill.ledger.filter((line) => seat.purseIds.includes(line.purseId)),
    loans: readLoans(bill.loans).filter((loan) => seat.purseIds.includes(loan.purseId)).map((loan) => ({ ...loan, status: "pending" })),
    notes: readNotes(bill.notes).filter((note) => note.from === "player" && seat.purseIds.includes(note.purseId)),
  };
  const applied = applyBillToTable(room.table, limited, room.seen);
  const next = { ...room, table: applied.table, seen: applied.seen };
  if (room.live) return { ...next, revision: room.revision + 1 };
  return advance(next);
}

export function skipTurn(room: CloudRoom, token: string): CloudRoom {
  const seat = room.seats.find((item) => item.token === token);
  if (!seat || seat.role !== "dm") throw new Error("Only the dungeon master can skip a turn.");
  return advance(room);
}

function requireTurn(room: CloudRoom, token: string): CloudSeat {
  const current = room.seats[room.turn];
  if (!current || current.token !== token) throw new Error("It is not your turn.");
  return current;
}

function seated(room: CloudRoom, token: string): CloudSeat {
  const seat = room.seats.find((item) => item.token === token);
  if (!seat) throw new Error("This browser is not seated at that table.");
  return seat;
}

function expectRevision(room: CloudRoom, baseRevision?: number) {
  if (typeof baseRevision === "number" && baseRevision !== room.revision) throw new Error("Someone else changed the table first.");
}

function advance(room: CloudRoom): CloudRoom {
  return { ...room, revision: room.revision + 1, turn: nextTurn(room.turn, room.seats.length) };
}

function addCoins(coins: Coins, copper: number): Coins {
  const paid = fromCopper(Math.max(0, copper));
  return {
    cp: coins.cp + paid.cp,
    sp: coins.sp + paid.sp,
    ep: coins.ep + paid.ep,
    gp: coins.gp + paid.gp,
    pp: coins.pp + paid.pp,
  };
}
