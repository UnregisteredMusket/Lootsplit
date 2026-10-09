import { quireDb } from "./db.ts";
import { listingSchema, type PropertyProfile } from "./property.ts";

export type Listing = {
  estateTemplateKey?: string;
  estateAttachments?: string[];
  id: string;
  name: string;
  kind: "item" | "property";
  copper: number;
  quantity: number | null;
  notes: string;
  locationId?: string;
  property?: PropertyProfile;
  status?: "available" | "reserved" | "withdrawn";
};

export type LoanStatus = "pending" | "approved" | "denied";

export type LoanAsk = {
  id: string;
  at: number;
  purseId: string;
  purseName: string;
  copper: number;
  note: string;
  status: LoanStatus;
};

export type ListingSale = {
  id: string;
  at: number;
  listingId: string;
  quantity: number;
  purseId: string;
};

export function readListings(value: unknown): Listing[] {
  const list = Array.isArray(value) ? value : bag(value, "listings");
  const listings: Listing[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const listing = normalizeListing(item);
    if (!listing || seen.has(listing.id)) continue;
    seen.add(listing.id);
    listings.push(listing);
  }
  return listings;
}

export function readLoans(value: unknown): LoanAsk[] {
  const list = Array.isArray(value) ? value : bag(value, "loans");
  const loans: LoanAsk[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const loan = normalizeLoan(item);
    if (!loan || seen.has(loan.id)) continue;
    seen.add(loan.id);
    loans.push(loan);
  }
  return loans.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function readSales(value: unknown): ListingSale[] {
  const list = Array.isArray(value) ? value : bag(value, "sales");
  const sales: ListingSale[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const sale = normalizeSale(item);
    if (!sale || seen.has(sale.id)) continue;
    seen.add(sale.id);
    sales.push(sale);
  }
  return sales;
}

/** Incoming wins, except a decision already made is kept when `keepDecided` is set. */
export function mergeLoanLists(current: LoanAsk[], incoming: LoanAsk[], keepDecided: boolean): LoanAsk[] {
  const byId = new Map(current.map((loan) => [loan.id, loan]));
  for (const loan of incoming) {
    const have = byId.get(loan.id);
    if (keepDecided && have && have.status !== "pending") continue;
    byId.set(loan.id, loan);
  }
  return [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export async function loadListings(): Promise<Listing[]> {
  return readListings(await meta("listings"));
}

export async function loadLoans(): Promise<LoanAsk[]> {
  return readLoans(await meta("loans"));
}

export async function loadSales(): Promise<ListingSale[]> {
  return readSales(await meta("sales"));
}

export async function loadSaleSeen(): Promise<string[]> {
  const row = await meta("saleSeen");
  if (typeof row !== "object" || row === null || !("ids" in row) || !Array.isArray(row.ids)) return [];
  return row.ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function saveListings(listings: Listing[]): Promise<void> {
  await putMeta({ id: "listings", listings });
}

export async function saveLoans(loans: LoanAsk[]): Promise<void> {
  await putMeta({ id: "loans", loans });
}

export async function saveSales(sales: ListingSale[]): Promise<void> {
  await putMeta({ id: "sales", sales });
}

export async function forgetSales(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  await saveSales((await loadSales()).filter((sale) => !drop.has(sale.id)));
}

function normalizeListing(value: unknown): Listing | null {
  if (typeof value !== "object" || value === null) return null;
  const listing = value as Partial<Listing>;
  const id = typeof listing.id === "string" ? listing.id : "";
  const name = typeof listing.name === "string" ? listing.name.trim() : "";
  const copper = Math.round(Number(listing.copper));
  if (!id || !name || (listing.kind !== "item" && listing.kind !== "property") || !Number.isFinite(copper) || copper < 0) return null;
  const quantity = listing.quantity === null || listing.quantity === undefined ? null : Math.max(0, Math.floor(Number(listing.quantity)));
  if (quantity !== null && !Number.isFinite(quantity)) return null;
  return listingSchema.parse({ id, name, kind: listing.kind, copper, quantity, notes: typeof listing.notes === "string" ? listing.notes.trim() : "",
    ...(listing.locationId !== undefined ? { locationId: listing.locationId } : {}),
    ...(listing.property !== undefined ? { property: listing.property } : {}),
    ...(listing.status !== undefined ? { status: listing.status } : {}) });
}

function normalizeLoan(value: unknown): LoanAsk | null {
  if (typeof value !== "object" || value === null) return null;
  const loan = value as Partial<LoanAsk>;
  const id = typeof loan.id === "string" ? loan.id : "";
  const purseId = typeof loan.purseId === "string" ? loan.purseId : "";
  const purseName = typeof loan.purseName === "string" ? loan.purseName.trim() : "";
  const copper = Math.round(Number(loan.copper));
  const note = typeof loan.note === "string" ? loan.note.trim() : "";
  if (!id || !purseId || !purseName || !note || !Number.isFinite(copper) || copper <= 0) return null;
  if (loan.status !== "pending" && loan.status !== "approved" && loan.status !== "denied") return null;
  return { id, at: Number.isFinite(loan.at) ? Number(loan.at) : 0, purseId, purseName, copper, note, status: loan.status };
}

function normalizeSale(value: unknown): ListingSale | null {
  if (typeof value !== "object" || value === null) return null;
  const sale = value as Partial<ListingSale>;
  const id = typeof sale.id === "string" ? sale.id : "";
  const listingId = typeof sale.listingId === "string" ? sale.listingId : "";
  const purseId = typeof sale.purseId === "string" ? sale.purseId : "";
  const quantity = Math.floor(Number(sale.quantity));
  if (!id || !listingId || !purseId || !Number.isFinite(quantity) || quantity < 1) return null;
  return { id, at: Number.isFinite(sale.at) ? Number(sale.at) : 0, listingId, purseId, quantity };
}

function bag(value: unknown, key: string): unknown[] {
  if (typeof value !== "object" || value === null || !(key in value)) return [];
  const inner = (value as Record<string, unknown>)[key];
  return Array.isArray(inner) ? inner : [];
}

async function meta(id: string): Promise<unknown> {
  const db = await quireDb();
  return request(db.transaction("meta").objectStore("meta").get(id));
}

async function putMeta(value: { id: string } & Record<string, unknown>): Promise<void> {
  const db = await quireDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(value);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("The market could not be saved."));
    tx.onabort = () => reject(tx.error ?? new Error("The market could not be saved."));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("The market could not be read."));
  });
}
