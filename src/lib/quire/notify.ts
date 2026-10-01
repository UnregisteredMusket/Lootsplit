import { toast } from "sonner";

const KEY = "quire.notices.v1";

export type NoticeNote = { id: string; from: "dm" | "player"; to: "dm" | "party"; purseId: string; text: string };

const seen = new Set<string>();
let primed = false;

export function noteIsForSeat(note: NoticeNote, seat: { role: "dm" | "player"; purseIds: string[] }): boolean {
  if (seat.role === "dm") return note.from === "player";
  if (note.from === "dm") return note.to === "party" || seat.purseIds.includes(note.purseId);
  return note.to === "party" && !seat.purseIds.includes(note.purseId);
}

export function noticesOn(): boolean {
  if (typeof localStorage === "undefined" || typeof Notification === "undefined") return false;
  return localStorage.getItem(KEY) === "on" && Notification.permission === "granted";
}

export async function setNotices(on: boolean): Promise<boolean> {
  if (!on) {
    localStorage.setItem(KEY, "off");
    return false;
  }
  if (typeof Notification === "undefined") return false;
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  const allowed = permission === "granted";
  localStorage.setItem(KEY, allowed ? "on" : "off");
  if (allowed) void registerWorker();
  return allowed;
}

export function primeNotices(ids: string[]) {
  for (const id of ids) seen.add(id);
  primed = true;
}

export function alertNotes(notes: NoticeNote[]) {
  if (!primed) return;
  const seat = currentSeat();
  for (const note of notes) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    if (!note.text.trim() || !noteIsForSeat(note, seat)) continue;
    const title = note.to === "party" ? "Party" : note.from === "dm" ? "Dungeon master" : "New message";
    notify(title, note.text.trim().slice(0, 140), `note-${note.id}`);
  }
}

export function notify(title: string, body: string, tag: string) {
  if (!noticesOn()) return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    toast(title, { description: body });
    return;
  }
  void showSystem(title, body, tag);
}

function currentSeat(): { role: "dm" | "player"; purseIds: string[] } {
  if (typeof window === "undefined") return { role: "dm", purseIds: [] };
  try {
    const id = window.localStorage.getItem("quire.campaign.v1") || "main";
    const key = id === "main" ? "quire.seat.v1" : `quire.seat.v1.${id}`;
    const raw = window.localStorage.getItem(key);
    if (!raw) return { role: "dm", purseIds: [] };
    const parsed = JSON.parse(raw) as { role?: string; purseIds?: unknown };
    return {
      role: parsed.role === "player" ? "player" : "dm",
      purseIds: Array.isArray(parsed.purseIds) ? parsed.purseIds.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return { role: "dm", purseIds: [] };
  }
}

async function showSystem(title: string, body: string, tag: string) {
  try {
    const ready = await registerWorker();
    await ready.showNotification(title, { body, tag, icon: "/favicon.svg" });
  } catch {
    try {
      new Notification(title, { body, tag, icon: "/favicon.svg" });
    } catch {
      // The browser refused the notice.
    }
  }
}

function registerWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/notify-sw.js");
}
