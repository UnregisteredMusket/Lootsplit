import type {ReportBase} from "./local-report.ts";
import type { Coins, Holding, LedgerLine, Purse, RealmSettings, Shop, StockLine } from "./types.ts";
import { readGifts, readRoster, type PlayerGift, type RosterPerson } from "./gift.ts";
import { readListings, readLoans, readSales, type Listing, type ListingSale, type LoanAsk } from "./market.ts";
import { readSheets, type CharacterSheet } from "./sheet.ts";
import { readNotes, type ChatNote } from "./chat.ts";
import { readHandouts, type Handout } from "./handouts.ts";
import { readSeatLock, type SeatLock } from "./lock.ts";

export type TableFile = {
  kind: "quire-table";
  version: 1;
  exportedAt: number;
  realm: RealmSettings;
  shops: Shop[];
  stock: StockLine[];
  purses: Purse[];
  holdings: Holding[];
  seatLock?: SeatLock;
  notes?: ChatNote[];
  roster?: RosterPerson[];
  listings?: Listing[];
  loans?: LoanAsk[];
  sheets?: CharacterSheet[];
  handouts?: Handout[];
};

export type BillFile = {
  reportId?: string;
  base?: ReportBase;
  kind: "quire-bill";
  version: 1;
  exportedAt: number;
  openedAt: number;
  purseIds: string[];
  shopIds: string[];
  purses: Purse[];
  holdings: Holding[];
  stock: Array<{ id: string; quantity: number | null }>;
  ledger: LedgerLine[];
  switchedToDm?: boolean;
  notes?: ChatNote[];
  gifts?: PlayerGift[];
  loans?: LoanAsk[];
  sales?: ListingSale[];
  sheets?: CharacterSheet[];
};

export type Seat = {
  role: "dm" | "player";
  purseIds: string[];
  shopIds: string[];
  openedAt: number;
  /** True after a player uses the save password to become the dungeon master. */
  elevated?: boolean;
};

export const DM_SEAT: Seat = { role: "dm", purseIds: [], shopIds: [], openedAt: 0, elevated: false };

const KEY = "quire.seat.v1";
const listeners = new Set<() => void>();
let seat: Seat = DM_SEAT;
let loaded = false;

function seatKey() {
  if (typeof window === "undefined") return KEY;
  const id = window.localStorage.getItem("quire.campaign.v1") || "main";
  return id === "main" ? KEY : `${KEY}.${id}`;
}

function remember(next: Seat) {
  seat = next;
  if (typeof window !== "undefined") window.localStorage.setItem(seatKey(), JSON.stringify(next));
  for (const listener of listeners) listener();
}

export function getSeat(): Seat {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      const raw = window.localStorage.getItem(seatKey());
      if (raw) seat = normalizeSeat(JSON.parse(raw) as Partial<Seat>);
      if (seat.role === "player" && seat.purseIds.length === 0) {
        seat = DM_SEAT;
        window.localStorage.setItem(seatKey(), JSON.stringify(seat));
      }
    } catch {
      seat = DM_SEAT;
    }
  }
  return seat;
}

export function reloadSeat() {
  loaded = false;
  seat = DM_SEAT;
  getSeat();
  for (const listener of listeners) listener();
}

export function setSeat(next: Seat) {
  loaded = true;
  remember(normalizeSeat(next));
}

export function subscribeSeat(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function normalizeSeat(input: Partial<Seat> | null | undefined): Seat {
  const role = input?.role === "player" ? "player" : "dm";
  return {
    role,
    purseIds: strings(input?.purseIds),
    shopIds: strings(input?.shopIds),
    openedAt: Number.isFinite(input?.openedAt) ? Number(input?.openedAt) : 0,
    elevated: input?.elevated === true,
  };
}

export function buildTable(input: {
  realm: RealmSettings;
  shops: Shop[];
  stock: StockLine[];
  purses: Purse[];
  holdings: Holding[];
  seatLock?: SeatLock | null;
  notes?: ChatNote[];
  roster?: RosterPerson[];
  listings?: Listing[];
  loans?: LoanAsk[];
  sheets?: CharacterSheet[];
  handouts?: Handout[];
}): TableFile {
  const shopIds = new Set(input.shops.map((shop) => shop.id));
  const purseIds = new Set(input.purses.map((purse) => purse.id));
  const notes = notesFor(input.notes, purseIds);
  const roster = readRoster(input.roster);
  const listings = readListings(input.listings);
  const loans = readLoans(input.loans).filter((loan) => purseIds.has(loan.purseId));
  const sheets = sheetsFor(input.sheets, purseIds);
  return {
    kind: "quire-table",
    version: 1,
    exportedAt: Date.now(),
    realm: input.realm,
    shops: input.shops,
    stock: input.stock.filter((line) => shopIds.has(line.shopId)),
    purses: input.purses,
    holdings: input.holdings.filter((holding) => purseIds.has(holding.purseId)),
    seatLock: readSeatLock(input.seatLock) ?? undefined,
    notes,
    roster: roster.length ? roster : undefined,
    listings,
    loans: loans.length ? loans : undefined,
    sheets,
    handouts: readHandouts(input.handouts),
  };
}

export function buildBill(
  input: {
    shareBase?: ReportBase;
    purses: Purse[];
    holdings: Holding[];
    stock: StockLine[];
    ledger: LedgerLine[];
    notes?: ChatNote[];
    gifts?: PlayerGift[];
    loans?: LoanAsk[];
    sales?: ListingSale[];
    sheets?: CharacterSheet[];
  },
  sitting: Seat,
): BillFile {
  const purseIds = new Set(sitting.purseIds);
  const shopIds = new Set(sitting.shopIds);
  return {
    kind: "quire-bill",
    reportId: crypto.randomUUID(),
    base: input.shareBase,
    version: 1,
    exportedAt: Date.now(),
    openedAt: sitting.openedAt,
    purseIds: [...purseIds],
    shopIds: [...shopIds],
    purses: input.purses.filter((purse) => purseIds.has(purse.id)),
    holdings: input.holdings.filter((holding) => purseIds.has(holding.purseId)),
    stock: input.stock
      .filter((line) => shopIds.has(line.shopId))
      .map((line) => ({ id: line.id, quantity: line.quantity })),
    ledger: input.ledger.filter((line) => line.at >= sitting.openedAt && purseIds.has(line.purseId)),
    switchedToDm: sitting.elevated === true,
    notes: notesFor(input.notes, purseIds),
    gifts: giftsFor(input.gifts, purseIds, sitting.openedAt),
    loans: loansOnBill(input.loans, purseIds, sitting.openedAt),
    sales: salesOnBill(input.sales, purseIds, sitting.openedAt),
    sheets: sheetsFor(input.sheets, purseIds),
  };
}

export function readShare(value: unknown): TableFile | BillFile {
  if (typeof value !== "object" || value === null) throw new Error("That file is not a player file or an activity report.");
  const file = value as { kind?: string; version?: number };
  if (file.kind === "quire-table" && file.version === 1) return readTable(value);
  if (file.kind === "quire-bill" && file.version === 1) return readBill(value);
  throw new Error("That file is not a player file or an activity report.");
}

export function lesserQuantity(here: number | null, there: number | null): number | null {
  if (here === null) return there;
  if (there === null) return here;
  return Math.min(here, there);
}

function readTable(value: unknown): TableFile {
  const file = value as Partial<TableFile>;
  if (!file.realm || typeof file.realm !== "object") throw new Error("That player file has no price settings.");
  if (!Array.isArray(file.shops) || file.shops.length === 0) throw new Error("That player file has no shops.");
  if (!Array.isArray(file.purses) || file.purses.length === 0) throw new Error("That player file has no characters.");
  if (!Array.isArray(file.stock) || !Array.isArray(file.holdings)) throw new Error("That player file is incomplete.");
  if (!file.shops.every(isShop) || !file.purses.every(isPurse) || !file.stock.every(isStock)) {
    throw new Error("That player file is incomplete.");
  }
  const lock = readSeatLock(file.seatLock);
  const notes = readNotes(file.notes);
  const roster = readRoster(file.roster);
  const listings = Array.isArray(file.listings) ? readListings(file.listings) : undefined;
  const loans = readLoans(file.loans);
  const sheets = readSheets(file.sheets);
  return {
    ...(file as TableFile),
    seatLock: lock ?? undefined,
    notes: notes.length ? notes : undefined,
    roster: roster.length ? roster : undefined,
    listings,
    loans: loans.length ? loans : undefined,
    sheets: sheets.length ? sheets : undefined,
    handouts: readHandouts(file.handouts),
  };
}

function readBill(value: unknown): BillFile {
  const file = value as Partial<BillFile>;
  if (!Array.isArray(file.purses) || !Array.isArray(file.holdings) || !Array.isArray(file.stock) || !Array.isArray(file.ledger)) {
    throw new Error("That activity report is incomplete.");
  }
  if (!Array.isArray(file.purseIds) || !Array.isArray(file.shopIds)) throw new Error("That activity report is incomplete.");
  if (!file.purses.every(isPurse)) throw new Error("That activity report is incomplete.");
  return {
    kind: "quire-bill",
    reportId: typeof file.reportId === "string" ? file.reportId : undefined,
    base: file.base,
    version: 1,
    exportedAt: Number(file.exportedAt) || Date.now(),
    openedAt: Number(file.openedAt) || 0,
    purseIds: strings(file.purseIds),
    shopIds: strings(file.shopIds),
    purses: file.purses,
    holdings: file.holdings,
    stock: file.stock.filter(isQuantity),
    ledger: file.ledger.filter(isLedger),
    switchedToDm: file.switchedToDm === true,
    notes: notesFor(file.notes, new Set(strings(file.purseIds))),
    gifts: giftsFor(file.gifts, new Set(strings(file.purseIds)), Number(file.openedAt) || 0),
    loans: loansOnBill(file.loans, new Set(strings(file.purseIds)), Number(file.openedAt) || 0),
    sales: salesOnBill(file.sales, new Set(strings(file.purseIds)), Number(file.openedAt) || 0),
    sheets: sheetsFor(file.sheets, new Set(strings(file.purseIds))),
  };
}

function sheetsFor(value: CharacterSheet[] | undefined, purseIds: Set<string>): CharacterSheet[] | undefined {
  const sheets = readSheets(value).filter((sheet) => purseIds.has(sheet.purseId));
  return sheets.length ? sheets : undefined;
}

function loansOnBill(value: LoanAsk[] | undefined, purseIds: Set<string>, openedAt: number): LoanAsk[] | undefined {
  const loans = readLoans(value).filter((loan) => loan.status === "pending" && purseIds.has(loan.purseId) && loan.at >= openedAt);
  return loans.length ? loans : undefined;
}

function salesOnBill(value: ListingSale[] | undefined, purseIds: Set<string>, openedAt: number): ListingSale[] | undefined {
  const sales = readSales(value).filter((sale) => purseIds.has(sale.purseId) && sale.at >= openedAt);
  return sales.length ? sales : undefined;
}

function giftsFor(value: PlayerGift[] | undefined, purseIds: Set<string>, openedAt: number): PlayerGift[] | undefined {
  const gifts = readGifts(value).filter((gift) => purseIds.has(gift.fromId) && gift.at >= openedAt);
  return gifts.length ? gifts : undefined;
}

function notesFor(value: ChatNote[] | undefined, purseIds: Set<string>): ChatNote[] | undefined {
  const notes = readNotes(value).filter((note) => note.to === "party" || purseIds.has(note.purseId));
  return notes.length ? notes : undefined;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function isShop(value: Shop): boolean {
  return Boolean(value && typeof value.id === "string" && typeof value.name === "string");
}

function isPurse(value: Purse): boolean {
  return Boolean(value && typeof value.id === "string" && typeof value.name === "string" && isCoins(value.coins));
}

function isCoins(value: Coins): boolean {
  return Boolean(value) && ["cp", "sp", "ep", "gp", "pp"].every((key) => Number.isFinite(value[key as keyof Coins]));
}

function isStock(value: StockLine): boolean {
  return Boolean(value && typeof value.id === "string" && typeof value.shopId === "string" && typeof value.name === "string");
}

function isQuantity(value: { id: string; quantity: number | null }): boolean {
  return Boolean(value && typeof value.id === "string" && (value.quantity === null || Number.isFinite(value.quantity)));
}

function isLedger(value: LedgerLine): boolean {
  return Boolean(value && typeof value.id === "string" && typeof value.purseId === "string" && typeof value.summary === "string");
}

export async function encodeLinkPayload(file: TableFile | BillFile): Promise<string> {
  const stream = new Blob([JSON.stringify(file)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return `${file.kind === "quire-table" ? "t" : "b"}.${bytesToBase64Url(bytes)}`;
}

export async function decodeLinkPayload(hash: string): Promise<TableFile | BillFile | null> {
  const raw = hash.replace(/^#/, "");
  if (!raw.startsWith("t.") && !raw.startsWith("b.")) return null;
  const bytes = base64UrlToBytes(raw.slice(2));
  const stream = blobFromBytes(bytes).stream().pipeThrough(new DecompressionStream("gzip"));
  return readShare(JSON.parse(await new Response(stream).text()) as unknown);
}

export function seatHref(role: "dm" | "player", payload = "", origin = "http://localhost"): string {
  const url = new URL("/", origin);
  url.searchParams.set("as", role);
  if (payload) url.hash = payload;
  return url.toString();
}

export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function blobFromBytes(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy]);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
