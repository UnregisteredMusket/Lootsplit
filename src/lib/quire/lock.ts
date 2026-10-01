import { quireDb } from "./db.ts";

export type SeatLock = { salt: string; hash: string; protectSaves: boolean; iterations?: number };

export type LockedFile = {
  kind: "lootsplit-locked";
  version: 1;
  iterations?: number;
  salt: string;
  iv: string;
  data: string;
};

const KEY = "seatLock";

export function readSeatLock(value: unknown): SeatLock | null {
  if (typeof value !== "object" || value === null) return null;
  const lock = value as Partial<SeatLock>;
  if (typeof lock.salt !== "string" || typeof lock.hash !== "string") return null;
  if (!/^[0-9a-f]{32}$/.test(lock.salt) || !/^[0-9a-f]{64}$/.test(lock.hash)) return null;
  if (lock.iterations !== undefined && (!Number.isInteger(lock.iterations) || lock.iterations < 100000 || lock.iterations > 1000000)) return null;
  return { salt: lock.salt, hash: lock.hash, protectSaves: lock.protectSaves === true, iterations: lock.iterations };
}

export function isLockedFile(value: unknown): value is LockedFile {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Partial<LockedFile>;
  return file.kind === "lootsplit-locked" && file.version === 1 && typeof file.salt === "string" && typeof file.iv === "string" && typeof file.data === "string";
}

export async function sealPassword(password: string, protectSaves = false): Promise<SeatLock> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await stretchedHash(password, salt, 210000), protectSaves, iterations: 210000 };
}

export async function passwordMatches(password: string, lock: SeatLock): Promise<boolean> {
  const hash = lock.iterations ? await stretchedHash(password, lock.salt, lock.iterations) : await digest(password, lock.salt);
  return hash === lock.hash;
}

export async function lockFile(file: unknown, password: string, salt: string): Promise<LockedFile> {
  const key = await aesKey(password, salt, 210000);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(file)));
  return { kind: "lootsplit-locked", version: 1, iterations: 210000, salt, iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) };
}

export async function unlockFile(locked: LockedFile, password: string): Promise<unknown> {
  try {
    const key = await aesKey(password, locked.salt, locked.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: copyBytes(base64ToBytes(locked.iv)) },
      key,
      copyBytes(base64ToBytes(locked.data)),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as unknown;
  } catch {
    throw new Error("That password does not match this save.");
  }
}

export async function loadSeatLock(): Promise<SeatLock | null> {
  const db = await quireDb();
  const row = await get<{ salt?: unknown; hash?: unknown; protectSaves?: unknown }>(db.transaction("meta").objectStore("meta").get(KEY));
  return readSeatLock(row);
}

export async function saveSeatLock(lock: SeatLock): Promise<void> {
  const db = await quireDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ id: KEY, salt: lock.salt, hash: lock.hash, protectSaves: lock.protectSaves === true, iterations: lock.iterations });
  await done(tx);
}

export async function clearSeatLock(): Promise<void> {
  const db = await quireDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").delete(KEY);
  await done(tx);
}

async function stretchedHash(password:string,salt:string,iterations:number):Promise<string>{
 if(!Number.isInteger(iterations)||iterations<100000||iterations>1000000)throw new Error("Unsupported password protection settings.");
 const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
 const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(salt),iterations,hash:"SHA-256"},material,256);
 return hex(new Uint8Array(bits));
}
async function aesKey(password: string, salt: string, iterations?:number): Promise<CryptoKey> {
 if(iterations){const value=await stretchedHash(password,salt,iterations);return crypto.subtle.importKey("raw",new Uint8Array(value.match(/../g)!.map(x=>parseInt(x,16))),"AES-GCM",false,["encrypt","decrypt"]);}
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}\n${password}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function digest(password: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}\n${password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return hex(new Uint8Array(hash));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index] ?? 0);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function get<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("The save password could not be read."));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("The save password could not be kept."));
    tx.onabort = () => reject(tx.error ?? new Error("The save password could not be kept."));
  });
}
