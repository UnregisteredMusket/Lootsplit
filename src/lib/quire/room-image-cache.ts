/**
 * Client side of tabletop protocol 4: shared map images arrive as `/art/room-image-<sha256>.webp`
 * references. Before a room response reaches the app (and so device storage, backups, previews and
 * commands), every reference is restored to the exact inline image the server stores, so the rest
 * of the app sees the same table as before.
 *
 * Images come from, in order: this document's memory, then (members only) an IndexedDB cache
 * scoped to the campaign and room, then the seat-authorized GET /api/room-image/CODE/HASH.
 * Guests (ephemeral campaigns) never write images to persistent storage. A fetched image is
 * accepted only when its SHA-256 matches its reference.
 */
import type { CloudTable } from "./cloud.ts";

const REFERENCE = /^\/art\/room-image-([a-f0-9]{64})\.webp$/;
const RASTER = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const DB_NAME = "lootsplit.room-images.v1";
const STORE = "images";

export type RoomImageScope = {
  /** Device campaign key (`quire.cloud.v2.<campaign>`); keeps campaigns apart. */
  campaignKey: string;
  code: string;
  token: string;
  /** Guests: memory only. */
  ephemeral: boolean;
};

export function isRoomImageReference(value: unknown): value is string {
  return typeof value === "string" && REFERENCE.test(value);
}
/** References in the current maps of a protocol 4 table (the only place the server sends them). */
export function roomImageReferences(table: CloudTable): string[] {
  const references = new Set<string>();
  for (const map of table.journal?.world?.maps ?? [])
    if (isRoomImageReference(map.image)) references.add(map.image);
  return [...references];
}

const memory = new Map<string, Map<string, string>>();
const scopeKey = (scope: RoomImageScope) => `${scope.campaignKey}\u0000${scope.code}`;
function memoryFor(scope: RoomImageScope) {
  const key = scopeKey(scope);
  let images = memory.get(key);
  if (!images) memory.set(key, (images = new Map()));
  return images;
}

let loading = 0;
const listeners = new Set<() => void>();
/** Number of shared map images currently being downloaded (for "Loading map artwork…"). */
export function roomArtworkLoading() {
  return loading;
}
export function subscribeRoomArtwork(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function setLoading(change: number) {
  loading = Math.max(0, loading + change);
  for (const fn of listeners) fn();
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
const entryKey = (scope: RoomImageScope, reference: string) =>
  `${scopeKey(scope)}\u0000${reference}`;
/** Cache failures never block play: the image is fetched again instead. */
async function readStored(scope: RoomImageScope, references: string[]) {
  const found = new Map<string, string>();
  const db = await openDb();
  if (!db) return found;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readonly"),
        store = tx.objectStore(STORE);
      for (const reference of references) {
        const request = store.get(entryKey(scope, reference));
        request.onsuccess = () => {
          if (typeof request.result === "string") found.set(reference, request.result);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
  return found;
}
/** Store new images and drop this room's images that no current map uses any more. */
async function writeStored(scope: RoomImageScope, added: Map<string, string>, current: Set<string>) {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite"),
        store = tx.objectStore(STORE),
        prefix = `${scopeKey(scope)}\u0000`;
      for (const [reference, image] of added) store.put(image, entryKey(scope, reference));
      const keys = store.getAllKeys(IDBKeyRange.bound(prefix, prefix + "￿"));
      keys.onsuccess = () => {
        for (const key of keys.result)
          if (typeof key === "string" && !current.has(key.slice(prefix.length))) store.delete(key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

async function download(scope: RoomImageScope, reference: string): Promise<string> {
  const hash = REFERENCE.exec(reference)![1]!;
  const response = await fetch(
    `/api/room-image/${encodeURIComponent(scope.code)}/${hash}`,
    { headers: { "x-lootsplit-seat": scope.token }, credentials: "same-origin" },
  );
  if (!response.ok) throw Error("Shared map artwork could not load.");
  const image = await response.text();
  if (!RASTER.test(image) || (await sha256(image)) !== hash)
    throw Error("Shared map artwork did not match its reference.");
  return image;
}

/**
 * Returns the table with every map image reference restored to its inline image. Throws when any
 * image cannot be loaded or verified; callers then read the full inline room instead.
 */
export async function restoreRoomImages(
  table: CloudTable,
  scope: RoomImageScope,
): Promise<CloudTable> {
  const references = roomImageReferences(table);
  const images = memoryFor(scope);
  const missing = references.filter((reference) => !images.has(reference));
  if (missing.length && !scope.ephemeral)
    for (const [reference, image] of await readStored(scope, missing)) images.set(reference, image);
  const absent = missing.filter((reference) => !images.has(reference));
  const added = new Map<string, string>();
  if (absent.length) {
    setLoading(absent.length);
    try {
      await Promise.all(
        absent.map(async (reference) => {
          const image = await download(scope, reference);
          images.set(reference, image);
          added.set(reference, image);
        }),
      );
    } finally {
      setLoading(-absent.length);
    }
  }
  if (!scope.ephemeral && missing.length)
    void writeStored(scope, added, new Set(references)).catch(() => undefined);
  // Memory keeps only images the room still uses.
  for (const reference of images.keys()) if (!references.includes(reference)) images.delete(reference);
  if (!references.length) return table;
  const world = table.journal!.world!;
  return {
    ...table,
    journal: {
      ...table.journal!,
      world: {
        ...world,
        maps: world.maps.map((map) =>
          isRoomImageReference(map.image) ? { ...map, image: images.get(map.image)! } : map,
        ),
      },
    },
  };
}

/** Leaving a room or switching campaigns releases this document's copies. */
export function forgetRoomImages() {
  memory.clear();
}
