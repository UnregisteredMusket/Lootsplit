import type { QuireFile } from "./economy.ts";
import type { LockedFile } from "./lock.ts";

const DB_NAME = "lootsplit-saves";
const DB_VERSION = 1;

export type SavePayload = QuireFile | LockedFile;

export type LocalSave = {
  id: string;
  name: string;
  savedAt: number;
  campaignId: string;
  file: SavePayload;
};

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open saved backups."));
  });
}

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Saves stay on this device, and this browser cannot store them."));
  }
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("saves")) {
        const store = db.createObjectStore("saves", { keyPath: "id" });
        store.createIndex("campaignId", "campaignId", { unique: false });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("Could not open saved backups."));
  });
}

export function cleanSaveName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 80) || "Save";
}

export function saveDownloadName(name: string, savedAt: number): string {
  const slug = cleanSaveName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const day = new Date(savedAt).toISOString().slice(0, 10);
  return `lootsplit-${slug || "save"}-${day}.json`;
}

export function nameFromImport(filename: string): string {
  const base = filename.replace(/\.json$/i, "").replace(/^lootsplit-/i, "").replace(/-/g, " ").trim();
  return cleanSaveName(base);
}

export async function listSaves(campaignId: string): Promise<LocalSave[]> {
  const db = await database();
  const rows = await request(db.transaction("saves").objectStore("saves").index("campaignId").getAll(campaignId));
  return rows.sort((a, b) => b.savedAt - a.savedAt);
}

export async function rememberSave(input: { name: string; campaignId: string; file: SavePayload }): Promise<LocalSave> {
  const save: LocalSave = {
    id: crypto.randomUUID(),
    name: cleanSaveName(input.name),
    savedAt: Date.now(),
    campaignId: input.campaignId,
    file: input.file,
  };
  const db = await database();
  const tx = db.transaction("saves", "readwrite");
  tx.objectStore("saves").put(save);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save the backup."));
    tx.onabort = () => reject(tx.error ?? new Error("Could not save the backup."));
  });
  return save;
}

export async function replaceSave(save: LocalSave): Promise<void> {
  const db = await database();
  const tx = db.transaction("saves", "readwrite");
  tx.objectStore("saves").put(save);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save the backup."));
    tx.onabort = () => reject(tx.error ?? new Error("Could not save the backup."));
  });
}

export async function removeSave(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction("saves", "readwrite");
  tx.objectStore("saves").delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("That save could not be removed."));
    tx.onabort = () => reject(tx.error ?? new Error("That save could not be removed."));
  });
}

export async function replaceSaves(saves:LocalSave[]):Promise<void>{
 const db=await database();const tx=db.transaction('saves','readwrite');
 for(const save of saves)tx.objectStore('saves').put(save);
 await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
