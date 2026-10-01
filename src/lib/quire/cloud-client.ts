import { toast } from "sonner";
import { closeCloudTable, finishCloudTurn, joinCloudTable, openCloudTable, previewCloudTable, pullCloudTable, setCloudPace, skipCloudTurn } from "./cloud-api.ts";
import { getCloudWatch, setCloudPusher, setCloudWatch } from "./cloud-turn.ts";
import { loadNotes } from "./chat.ts";
import { applyCloudTable, economySnapshot, snapshot as quireSnapshot } from "./economy.ts";
import { loadGifts } from "./gift.ts";
import { loadLoans, loadSales } from "./market.ts";
import { loadSheets } from "./sheet.ts";
import { buildBill, getSeat, setSeat } from "./table.ts";
import { noticesOn, notify } from "./notify.ts";

const KEY = "quire.cloud.v1";

type Session = { code: string; token: string; seatId: string; revision: number; role: "dm" | "player"; purseIds: string[] };
type Listener = () => void;

const listeners = new Set<Listener>();
let view = { joined: false, mine: true, live: false, who: "", code: "", role: "dm" as "dm" | "player", seats: [] as { name: string; role: "dm" | "player" }[], revision: 0 };
let timer = 0;

export function getCloudTable() {
  return view;
}

export function subscribeCloudTable(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function openTable(name: string): Promise<void> {
  const opened = await openCloudTable({ data: { name, table: await economySnapshot() } });
  remember({ code: opened.code, token: opened.token, seatId: opened.seatId, revision: opened.revision, role: "dm", purseIds: [] });
  await refresh();
}

export async function lookupTable(code: string) {
  return previewCloudTable({ data: { code: code.trim().toUpperCase() } });
}

export async function joinTable(code: string, purseId: string, name: string): Promise<void> {
  const joined = await joinCloudTable({ data: { code: code.trim().toUpperCase(), purseId, name } });
  remember({ code: code.trim().toUpperCase(), token: joined.token, seatId: joined.seatId, revision: 0, role: "player", purseIds: joined.purseIds });
  setSeat({ role: "player", purseIds: joined.purseIds, shopIds: joined.shopIds, openedAt: Date.now() });
  await refresh();
}

export async function endTableTurn(): Promise<void> {
  const session = readSession();
  if (!session) throw new Error("This phone is not at a cloud table.");
  if (session.role === "dm") {
    await finishCloudTurn({ data: { code: session.code, token: session.token, baseRevision: session.revision, table: await economySnapshot() } });
  } else {
    const file = await quireSnapshot();
    const bill = buildBill(
      { ...file, notes: await loadNotes(), gifts: await loadGifts(), loans: await loadLoans(), sales: await loadSales(), sheets: await loadSheets() },
      getSeat(),
    );
    await finishCloudTurn({ data: { code: session.code, token: session.token, baseRevision: session.revision, bill } });
  }
  if (session.role === "player") {
    const sitting = getSeat();
    setSeat({ ...sitting, openedAt: Date.now() });
  }
  await refresh();
}

export async function pushLive(): Promise<void> {
  if (!getCloudWatch().joined || !getCloudWatch().live) return;
  try {
    await endTableTurn();
  } catch (error) {
    await refresh().catch(() => undefined);
    const message = error instanceof Error ? error.message : "";
    toast.error(message.includes("changed the table") ? "The table changed. Look again, then retry." : message || "That change was not shared.");
  }
}

export async function chooseTableMode(mode: "local" | "turns" | "live"): Promise<void> {
  if (mode === "local") {
    const session = readSession();
    if (session) await closeCloudTable({ data: { code: session.code, token: session.token } }).catch(() => undefined);
    leaveTable();
    return;
  }
  if (!readSession()) await openTable("Dungeon master");
  if (getCloudWatch().live !== (mode === "live")) await setTableLive(mode === "live");
}

export async function setTableLive(live: boolean): Promise<void> {
  const session = readSession();
  if (!session) throw new Error("This phone is not at a cloud table.");
  await setCloudPace({ data: { code: session.code, token: session.token, live } });
  await refresh();
}

export async function skipTableTurn(): Promise<void> {
  const session = readSession();
  if (!session) throw new Error("This phone is not at a cloud table.");
  await skipCloudTurn({ data: { code: session.code, token: session.token } });
  await refresh();
}

export function releasePlayerSeat() {
  const session = readSession();
  if (session?.role === "player") leaveTable();
}

export function leaveTable() {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(KEY);
  window.clearInterval(timer);
  timer = 0;
  publish({ joined: false, mine: true, live: false, who: "", code: "", role: "dm", seats: [], revision: 0 });
}

export function resumeTable() {
  if (typeof sessionStorage === "undefined" || !readSession() || timer) return;
  timer = window.setInterval(() => void refresh().catch(() => undefined), 2000);
  void refresh().catch(() => undefined);
}

async function refresh() {
  const session = readSession();
  if (!session) return;
  let remote;
  try {
    remote = await pullCloudTable({ data: { code: session.code, token: session.token } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("No table uses that code")) {
      if (session.role === "player" && !noticesOn()) toast("The dungeon master returned to Local Mode.");
      leaveTable();
      return;
    }
    throw error;
  }
  if (remote.revision !== session.revision) {
    await applyCloudTable(remote.table);
    if (session.role === "player") {
      const sitting = getSeat();
      setSeat({
        role: "player",
        purseIds: remote.purseIds,
        shopIds: remote.shopIds,
        openedAt: remote.live ? sitting.openedAt : remote.mine ? Date.now() : sitting.openedAt,
      });
    }
    remember({ ...session, revision: remote.revision, purseIds: remote.purseIds });
  }
  if (!timer) timer = window.setInterval(() => void refresh().catch(() => undefined), 2000);
  const next = { joined: true, mine: remote.mine, live: remote.live, who: remote.who, code: remote.code, role: session.role, seats: remote.seats, revision: remote.revision };
  if (view.joined && view.revision === next.revision && view.mine === next.mine && view.live === next.live && view.who === next.who && view.seats.length === next.seats.length) return;
  publish(next);
}

function remember(session: Session) {
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

function readSession(): Session | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) || "") as Session;
    if (!parsed || typeof parsed.code !== "string" || typeof parsed.token !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function announce(previous: typeof view, next: typeof view) {
  if (!previous.joined && next.joined) {
    notify(next.live ? "Live Mode" : "Turn based Mode", next.live ? "Everyone can act." : "The shared table is open.", "mode");
  } else if (previous.joined && !next.joined) {
    notify("Local Mode", "The shared table is closed.", "mode");
  } else if (previous.live !== next.live) {
    notify(next.live ? "Live Mode" : "Turn based Mode", next.live ? "Everyone can act." : "The table is taking turns.", "mode");
  }
  if (previous.joined && next.joined && !next.live && next.mine && !previous.mine) {
    notify("Your turn", "You can act at the table.", "turn");
  }
  if (previous.joined && next.role === "dm" && next.seats.length > previous.seats.length) {
    notify("A player sat down", "Someone joined the table.", "seats");
  }
}

function publish(next: typeof view) {
  const previous = view;
  view = next;
  setCloudWatch({ joined: next.joined, mine: next.mine, live: next.live, who: next.who });
  for (const listener of listeners) listener();
  if (!previous.joined && !next.joined) return;
  announce(previous, next);
}

setCloudPusher(() => {
  void pushLive();
});
