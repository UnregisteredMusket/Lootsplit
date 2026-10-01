import { formatCopper } from "./money.ts";
import { quireDb } from "./db.ts";

export type GiftHolding = {
  name: string;
  kind: "item" | "property";
  quantity: number;
  unitCopper: number;
};

export type PlayerGift = {
  id: string;
  at: number;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  copper: number;
  holding: GiftHolding | null;
};

export type RosterPerson = {
  id: string;
  name: string;
  kind: "character" | "party";
};

export function giftParts(gift: Pick<PlayerGift, "copper" | "holding">): string {
  const parts: string[] = [];
  if (gift.copper > 0) parts.push(formatCopper(gift.copper));
  if (gift.holding) parts.push(`${gift.holding.quantity} ${gift.holding.name}`);
  return parts.join(" and ");
}

export function giftSummary(gift: PlayerGift): string {
  return `${gift.fromName} gave ${gift.toName} ${giftParts(gift)}.`;
}

export function readGifts(value: unknown): PlayerGift[] {
  if (!Array.isArray(value)) return [];
  const gifts: PlayerGift[] = [];
  for (const item of value) {
    const gift = normalizeGift(item);
    if (gift) gifts.push(gift);
  }
  return gifts;
}

export function readRoster(value: unknown): RosterPerson[] {
  const list = Array.isArray(value) ? value : peopleOf(value);
  const people: RosterPerson[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const person = item as Partial<RosterPerson>;
    const id = typeof person.id === "string" ? person.id : "";
    const name = typeof person.name === "string" ? person.name.trim() : "";
    if (!id || !name || seen.has(id) || (person.kind !== "character" && person.kind !== "party")) continue;
    seen.add(id);
    people.push({ id, name, kind: person.kind });
  }
  return people;
}

export async function loadGifts(): Promise<PlayerGift[]> {
  const row = await meta("gifts");
  if (typeof row === "object" && row !== null && "gifts" in row) return readGifts((row as { gifts?: unknown }).gifts);
  return readGifts(row);
}

export async function loadRoster(): Promise<RosterPerson[]> {
  return readRoster(await meta("roster"));
}

export async function loadGiftSeen(): Promise<string[]> {
  const row = await meta("giftSeen");
  if (typeof row !== "object" || row === null || !("ids" in row) || !Array.isArray(row.ids)) return [];
  return row.ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function saveGifts(gifts: PlayerGift[]): Promise<void> {
  await putMeta({ id: "gifts", gifts });
}

export async function saveRoster(people: RosterPerson[]): Promise<void> {
  await putMeta({ id: "roster", people });
}

export async function forgetGifts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  await saveGifts((await loadGifts()).filter((gift) => !drop.has(gift.id)));
}

function normalizeGift(value: unknown): PlayerGift | null {
  if (typeof value !== "object" || value === null) return null;
  const gift = value as Partial<PlayerGift>;
  const id = typeof gift.id === "string" ? gift.id : "";
  const fromId = typeof gift.fromId === "string" ? gift.fromId : "";
  const toId = typeof gift.toId === "string" ? gift.toId : "";
  const fromName = typeof gift.fromName === "string" ? gift.fromName : "";
  const toName = typeof gift.toName === "string" ? gift.toName : "";
  const copper = Number(gift.copper);
  if (!id || !fromId || !toId || !fromName || !toName || !Number.isFinite(copper) || copper < 0) return null;
  return {
    id,
    at: Number.isFinite(gift.at) ? Number(gift.at) : 0,
    fromId,
    toId,
    fromName,
    toName,
    copper: Math.round(copper),
    holding: normalizeHolding(gift.holding),
  };
}

function normalizeHolding(value: unknown): GiftHolding | null {
  if (typeof value !== "object" || value === null) return null;
  const holding = value as Partial<GiftHolding>;
  const name = typeof holding.name === "string" ? holding.name.trim() : "";
  const quantity = Math.floor(Number(holding.quantity));
  const unitCopper = Math.round(Number(holding.unitCopper));
  if (!name || !Number.isFinite(quantity) || quantity < 1 || !Number.isFinite(unitCopper) || unitCopper < 0) return null;
  if (holding.kind !== "item" && holding.kind !== "property") return null;
  return { name, kind: holding.kind, quantity, unitCopper };
}

function peopleOf(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null || !("people" in value)) return [];
  const people = (value as { people?: unknown }).people;
  return Array.isArray(people) ? people : [];
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
    tx.onerror = () => reject(tx.error ?? new Error("Could not save the transfer."));
    tx.onabort = () => reject(tx.error ?? new Error("Could not save the transfer."));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Gifts could not be read."));
  });
}
