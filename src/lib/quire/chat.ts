import { captureDeviceMutationScope, assertDeviceMutationScope } from "./mutation-scope.ts";
import { quireDb } from "./db.ts";
import { getCloudWatch, pushCloudChange } from "./cloud-turn.ts";
import { alertNotes } from "./notify.ts";

export type ChatNote = {
  id: string;
  at: number;
  from: "dm" | "player";
  /** "dm" is a private note with one character. "party" is the shared party chat. */
  to: "dm" | "party" | "player";
  recipientId?: string;
  purseId: string;
  text: string;
};

const KEY = "chat";
const EMPTY: ChatNote[] = [];
const listeners = new Set<() => void>();
let notes: ChatNote[] = EMPTY;

export function readNotes(value: unknown): ChatNote[] {
  const list = Array.isArray(value) ? value : notesOf(value);
  const seen = new Set<string>();
  const notes: ChatNote[] = [];
  for (const item of list) {
    const note = normalizeNote(item);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    notes.push(note);
  }
  return notes.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function mergeNoteLists(current: ChatNote[], incoming: ChatNote[]): ChatNote[] {
  return readNotes([...current, ...incoming]);
}

export async function loadNotes(assertScope?: () => void): Promise<ChatNote[]> {
  const invoked = captureDeviceMutationScope();
  const guard = () => {
    assertDeviceMutationScope(invoked);
    assertScope?.();
  };
  guard();
  const db = await quireDb();
  guard();
  const row = await request<unknown>(db.transaction("meta").objectStore("meta").get(KEY));
  guard();
  return readNotes(row);
}

export async function postNotes(
  drafts: Array<{ from: "dm" | "player"; to?: "dm" | "party"; purseId: string; text: string }>,
): Promise<void> {
  const gate = getCloudWatch();
  if (gate.joined && !gate.mine) throw new Error("It is not your turn.");
  const at = Date.now();
  const incoming = drafts
    .map((draft) =>
      normalizeNote({
        id: crypto.randomUUID(),
        at,
        from: draft.from,
        to: draft.to === "party" ? "party" : "dm",
        purseId: draft.purseId,
        text: draft.text,
      }),
    )
    .filter((note): note is ChatNote => note !== null);
  if (incoming.length === 0) throw new Error("Write a message first.");
  await rememberIncoming(incoming);
  pushCloudChange();
}

export async function replaceNotes(incoming: ChatNote[], assertScope?: () => void): Promise<void> {
  await writeNotes(readNotes(incoming), assertScope);
}

export async function rememberIncoming(incoming: ChatNote[]): Promise<void> {
  if (incoming.length === 0) return;
  const invoked = captureDeviceMutationScope();
  const guard = () => assertDeviceMutationScope(invoked);
  const next = mergeNoteLists(await loadNotes(guard), incoming);
  guard();
  await writeNotes(next, guard);
}

export function getChatSnapshot(): ChatNote[] {
  return notes;
}

export function serverChat(): ChatNote[] {
  return EMPTY;
}

export function subscribeChat(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshChat(assertScope?: () => void): Promise<void> {
  const invoked = captureDeviceMutationScope();
  const guard = () => {
    assertDeviceMutationScope(invoked);
    assertScope?.();
  };
  const next = await loadNotes(guard).catch(() => EMPTY);
  try {
    guard();
  } catch (error) {
    // A late read belongs to the former context. Keep the current chat intact.
    if (assertScope) throw error;
    return;
  }
  notes = next;
  publish();
}

async function writeNotes(next: ChatNote[], assertScope?: () => void): Promise<void> {
  const invoked = captureDeviceMutationScope();
  const guard = () => {
    assertDeviceMutationScope(invoked);
    assertScope?.();
  };
  guard();
  const db = await quireDb();
  guard();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ id: KEY, notes: next });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save the message."));
    tx.onabort = () => reject(tx.error ?? new Error("Could not save the message."));
  });
  guard();
  notes = next;
  publish();
  alertNotes(next);
}

function publish() {
  for (const listener of listeners) listener();
}

function notesOf(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null || !("notes" in value)) return [];
  const notes = (value as { notes?: unknown }).notes;
  return Array.isArray(notes) ? notes : [];
}

function normalizeNote(value: unknown): ChatNote | null {
  if (typeof value !== "object" || value === null) return null;
  const note = value as Partial<ChatNote>;
  const text = typeof note.text === "string" ? note.text.trim().slice(0, 500) : "";
  const purseId = typeof note.purseId === "string" ? note.purseId : "";
  const id = typeof note.id === "string" ? note.id : "";
  const to = note.to === "party" ? "party" : note.to === "player" ? "player" : "dm";
  const recipientId = typeof note.recipientId === "string" ? note.recipientId : undefined;
  if (to === "player" && (!recipientId || !purseId || note.from !== "player")) return null;
  if (!text || !id || (note.from !== "dm" && note.from !== "player")) return null;
  if (to === "dm" && !purseId) return null;
  if (to === "party" && note.from === "player" && !purseId) return null;
  return {
    id,
    purseId,
    text,
    from: note.from,
    to,
    ...(to === "player" ? { recipientId } : {}),
    at: Number.isFinite(note.at) ? Number(note.at) : 0,
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Messages could not be read."));
  });
}
