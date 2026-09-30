import type { Coins, Holding, LedgerLine, Purse, RealmSettings, Shop, StockLine } from "./types.ts";

export type TableFile = {
  kind: "quire-table";
  version: 1;
  exportedAt: number;
  realm: RealmSettings;
  shops: Shop[];
  stock: StockLine[];
  purses: Purse[];
  holdings: Holding[];
};

export type BillFile = {
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
};

export type Seat = {
  role: "dm" | "player";
  purseIds: string[];
  shopIds: string[];
  openedAt: number;
};

export const DM_SEAT: Seat = { role: "dm", purseIds: [], shopIds: [], openedAt: 0 };

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
  };
}

export function buildTable(input: {
  realm: RealmSettings;
  shops: Shop[];
  stock: StockLine[];
  purses: Purse[];
  holdings: Holding[];
}): TableFile {
  const shopIds = new Set(input.shops.map((shop) => shop.id));
  const purseIds = new Set(input.purses.map((purse) => purse.id));
  return {
    kind: "quire-table",
    version: 1,
    exportedAt: Date.now(),
    realm: input.realm,
    shops: input.shops,
    stock: input.stock.filter((line) => shopIds.has(line.shopId)),
    purses: input.purses,
    holdings: input.holdings.filter((holding) => purseIds.has(holding.purseId)),
  };
}

export function buildBill(
  input: { purses: Purse[]; holdings: Holding[]; stock: StockLine[]; ledger: LedgerLine[] },
  sitting: Seat,
): BillFile {
  const purseIds = new Set(sitting.purseIds);
  const shopIds = new Set(sitting.shopIds);
  return {
    kind: "quire-bill",
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
  };
}

export function readShare(value: unknown): TableFile | BillFile {
  if (typeof value !== "object" || value === null) throw new Error("That file is not a player file or a bill.");
  const file = value as { kind?: string; version?: number };
  if (file.kind === "quire-table" && file.version === 1) return readTable(value);
  if (file.kind === "quire-bill" && file.version === 1) return readBill(value);
  throw new Error("That file is not a player file or a bill.");
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
  return file as TableFile;
}

function readBill(value: unknown): BillFile {
  const file = value as Partial<BillFile>;
  if (!Array.isArray(file.purses) || !Array.isArray(file.holdings) || !Array.isArray(file.stock) || !Array.isArray(file.ledger)) {
    throw new Error("That bill is incomplete.");
  }
  if (!Array.isArray(file.purseIds) || !Array.isArray(file.shopIds)) throw new Error("That bill is incomplete.");
  if (!file.purses.every(isPurse)) throw new Error("That bill is incomplete.");
  return {
    kind: "quire-bill",
    version: 1,
    exportedAt: Number(file.exportedAt) || Date.now(),
    openedAt: Number(file.openedAt) || 0,
    purseIds: strings(file.purseIds),
    shopIds: strings(file.shopIds),
    purses: file.purses,
    holdings: file.holdings,
    stock: file.stock.filter(isQuantity),
    ledger: file.ledger.filter(isLedger),
  };
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
