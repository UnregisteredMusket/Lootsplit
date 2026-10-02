import { rememberSave } from "./saves.ts";
import { loadSeatLock } from "./lock.ts";
import { notify } from "./notify.ts";
import {
  closeCloudTable,
  joinCloudTable,
  openCloudTable,
  previewCloudTable,
  pullCloudTable,
  setCloudPace,
  skipCloudTurn,
  submitCloudCommands,
  manageCloudRoom,
} from "./cloud-api.ts";
import { setCloudWatch } from "./cloud-turn.ts";
import { applyCloudTable, economySnapshot, snapshot } from "./economy.ts";
import { getSeat, setSeat, downloadJson } from "./table.ts";
import { applyCommand, tablePatch, type Command, type CommandInput } from "./commands.ts";
import type { RoomView } from "./cloud.server.ts";
import { rememberIncoming } from "./chat.ts";

type Session = {
  code: string;
  token: string;
  seatId: string;
  role: "dm" | "player";
  purseIds: string[];
  revision: number;
  pending: Command[];
  batchId: string;
};
export type SyncState = "local" | "synced" | "pending" | "saving" | "attention";
const listeners = new Set<() => void>();
const initialView = {
  joined: false,
  mine: true,
  live: false,
  who: "",
  code: "",
  role: "dm" as "dm" | "player",
  seats: [] as RoomView["seats"],
  revision: 0,
  seatId: "",
  pending: 0,
  status: "local" as SyncState,
  error: "",
  lastSync: 0,
};
let view = initialView;
// Hydration always starts from the same local snapshot, even if room restoration
// ran before a lazy component loaded. React reads the live snapshot after mount.
export function getServerCloudTable() {
  return initialView;
}
let timer: ReturnType<typeof setInterval> | undefined;
let chain: Promise<unknown> = Promise.resolve();
let sessionKey = "";
const key = () =>
  `quire.cloud.v2.${typeof localStorage === "undefined" ? "main" : localStorage.getItem("quire.campaign.v1") || "main"}`;
function session(): Session | null {
  if (typeof localStorage === "undefined") return null;
  try {
    let saved = JSON.parse(localStorage.getItem(key()) || "null");
    if (!saved && typeof sessionStorage !== "undefined") {
      const old = JSON.parse(sessionStorage.getItem("quire.cloud.v1") || "null");
      if (old?.token && old?.code) {
        saved = { ...old, pending: [], batchId: crypto.randomUUID(), revision: 0 };
        localStorage.setItem(key(), JSON.stringify(saved));
        sessionStorage.removeItem("quire.cloud.v1");
      }
    }
    if (
      !saved ||
      typeof saved.token !== "string" ||
      typeof saved.code !== "string" ||
      !Array.isArray(saved.pending)
    )
      return null;
    return saved;
  } catch {
    return null;
  }
}
function remember(s: Session) {
  localStorage.setItem(key(), JSON.stringify(s));
}
function requireSession() {
  const s = session();
  if (!s) throw new Error("Join a campaign first.");
  return s;
}
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const locked = async (): Promise<T> =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(key() + ".write", { ifAvailable: true }, (lock) => {
          if (!lock)
            throw new Error("Another Lootsplit tab is synchronizing. Try again in a moment.");
          return fn();
        })
      : fn();
  const next = chain.then(locked, locked);
  chain = next.catch(() => undefined);
  return next;
}
function publish(next: Partial<typeof view>) {
  const previous = view;
  view = { ...view, ...next };
  if (previous.joined && view.joined) {
    if (previous.live !== view.live)
      notify("Mode changed", view.live ? "Live Mode" : "Turn-based Mode", "mode");
    if (!previous.mine && view.mine && !view.live)
      notify("Your turn", "You can make transactions now.", "turn");
    if (previous.seats.length < view.seats.length)
      notify("Player joined", "A participant joined the campaign.", "joined");
  }
  setCloudWatch({ joined: view.joined, mine: view.mine, live: view.live, who: view.who });
  for (const fn of listeners) fn();
}
export function getCloudTable() {
  return view;
}
export function subscribeCloudTable(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function hasPendingChanges() {
  return !!session()?.pending.length;
}
function fail(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Connection failed. Your pending changes are saved on this device.";
  publish({ status: "attention", error: message });
  return message;
}
function start() {
  if (!timer)
    timer = setInterval(() => {
      void serial(refresh).catch(fail);
    }, 2000);
}
async function accept(remote: RoomView, committed = false) {
  const s = requireSession();
  const acknowledged = new Set(remote.acknowledged);
  s.pending = s.pending.filter((c) => !acknowledged.has(c.id));
  if (committed) {
    s.pending = [];
    s.batchId = crypto.randomUUID();
  }
  // Restore server-saved turns after a lost local session or a page reload.
  const draft = JSON.parse(remote.draft) as Command[];
  if (!s.pending.length && draft.length && !committed) s.pending = draft;
  const changed = s.revision !== remote.revision;
  if (changed && !s.pending.length) s.batchId = crypto.randomUUID();
  s.revision = remote.revision;
  s.purseIds = remote.purseIds;
  remember(s);
  if (!s.pending.length && (changed || committed)) {
    await applyCloudTable(remote.table);
  } else if (changed) {
    try {
      let preview = remote.table;
      for (const cmd of s.pending)
        preview = applyCommand(
          preview,
          {
            id: s.seatId,
            token: s.token,
            name: remote.seats.find((x) => x.id === s.seatId)?.name ?? "Player",
            role: s.role,
            purseIds: remote.purseIds,
          },
          cmd,
        );
      await applyCloudTable(preview);
    } catch (error) {
      fail(error);
      await rememberIncoming(remote.table.notes);
    }
  }
  if (s.role === "player")
    setSeat({ ...getSeat(), role: "player", purseIds: remote.purseIds, shopIds: remote.shopIds });
  publish({
    joined: true,
    mine: remote.mine,
    live: remote.live,
    who: remote.who,
    code: remote.code,
    role: s.role,
    seats: remote.seats,
    seatId: remote.seatId,
    revision: remote.revision,
    pending: s.pending.length,
    status: s.pending.length ? (view.error ? "attention" : "pending") : "synced",
    error: s.pending.length ? view.error : "",
    lastSync: Date.now(),
  });
  start();
}
async function refresh() {
  const s = session();
  if (!s) return;
  const remote = await pullCloudTable({ data: { code: s.code, token: s.token } });
  await accept(remote);
}
export async function refreshShared() {
  return serial(refresh);
}
// Capture a settled shared view without racing this tab's queued operations.
export function captureDeviceBackup() {
  return serial(async () => {
    if (session()) {
      await refresh();
      if (hasPendingChanges()) {
        throw new Error(
          "Submit or resolve your pending actions before saving a campaign backup. Use Export pending actions to preserve an unfinished turn.",
        );
      }
    }
    return snapshot();
  });
}
export async function openTable(name: string) {
  const opened = await openCloudTable({ data: { name, table: await economySnapshot() } });
  remember({ ...opened, role: "dm", purseIds: [], pending: [], batchId: crypto.randomUUID() });
  await refresh();
}
export async function lookupTable(code: string) {
  return previewCloudTable({ data: { code: code.trim().toUpperCase() } });
}
export async function joinTable(code: string, purseId: string, name: string) {
  return serial(async () => {
    if (hasPendingChanges())
      throw new Error("Resolve pending changes before joining another campaign.");
    if (!(await loadSeatLock())?.protectSaves) {
      await rememberSave({
        name: `Before joining room ${code.trim().toUpperCase()}`,
        campaignId: localStorage.getItem("quire.campaign.v1") || "main",
        file: await snapshot(),
      });
    }
    const joined = await joinCloudTable({
      data: { code: code.trim().toUpperCase(), purseId, name },
    });
    remember({
      ...joined,
      revision: 0,
      code: code.trim().toUpperCase(),
      role: "player",
      pending: [],
      batchId: crypto.randomUUID(),
    });
    await refresh();
  });
}
async function flush(endTurn = false) {
  const s = requireSession();
  publish({ status: "saving", error: "" });
  try {
    const remote = await submitCloudCommands({
      data: { code: s.code, token: s.token, batchId: s.batchId, commands: s.pending, endTurn },
    });
    await accept(remote, true);
  } catch (error) {
    fail(error);
    throw error;
  }
}
async function stage() {
  const s = requireSession();
  if (!s.pending.length) return;
  try {
    const remote = await submitCloudCommands({
      data: { code: s.code, token: s.token, batchId: s.batchId, commands: s.pending, stage: true },
    });
    await accept(remote);
  } catch (error) {
    fail(error);
  }
}
export function endTableTurn() {
  return serial(() => flush(true));
}
export function retryPending() {
  return serial(async () => {
    if (view.live) await flush();
    else await stage();
  });
}
export function exportPending() {
  const s = requireSession();
  return downloadJson(`lootsplit-pending-${s.code}.json`, {
    code: s.code,
    commands: s.pending,
    exportedAt: Date.now(),
  });
}
export function discardPending() {
  return serial(async () => {
    const s = requireSession();
    const remote = await manageCloudRoom({
      data: { code: s.code, token: s.token, action: "discard", seatId: s.seatId },
    });
    await accept(remote, true);
  });
}
export async function queueCommand(input: CommandInput) {
  return serial(async () => {
    const s = requireSession();
    if (input.kind !== "message" && !view.mine) throw new Error(`It is ${view.who}'s turn.`);
    if (s.pending.length >= 100) throw new Error("Submit your pending actions before adding more.");
    const command = { ...input, id: crypto.randomUUID() } as Command;
    if (input.kind === "message") {
      // Chat is independent of transaction turns; retain a failed message in the editor.
      const remote = await submitCloudCommands({
        data: { code: s.code, token: s.token, batchId: command.id, commands: [command] },
      });
      await accept(remote);
      return;
    }
    if (!s.pending.length) await refresh();
    const current = requireSession(),
      before = await economySnapshot();
    const after = applyCommand(
      before,
      {
        id: current.seatId,
        token: current.token,
        name: view.seats.find((x) => x.id === current.seatId)?.name ?? "Player",
        role: current.role,
        purseIds: current.purseIds,
      },
      command,
    );
    current.pending.push(command);
    remember(current);
    await applyCloudTable(after);
    publish({ pending: current.pending.length, status: "pending", error: "" });
    if (view.live) {
      await flush().catch(() => undefined);
    } else await stage();
  });
}
export function runSharedMutation(work: () => Promise<unknown>) {
  return serial(async () => {
    const s = requireSession();
    if (s.role !== "dm")
      throw new Error(
        "Only the DM can directly edit funds and inventory in shared modes. Use Buy, Sell, Give, or Request loan.",
      );
    if (!view.mine) throw new Error(`It is ${view.who}'s turn.`);
    if (s.pending.length >= 100) throw new Error("Submit your pending actions first.");
    if (!s.pending.length) await refresh();
    const before = await economySnapshot();
    let after;
    try {
      await work();
      after = await economySnapshot();
    } catch (e) {
      await applyCloudTable(before);
      throw e;
    }
    const patch = tablePatch(before, after);
    if (patch.kind !== "patch" || !patch.changes.length) return;
    const current = requireSession();
    current.pending.push({ ...patch, id: crypto.randomUUID() });
    try {
      remember(current);
    } catch (e) {
      await applyCloudTable(before);
      throw e;
    }
    publish({ pending: current.pending.length, status: "pending", error: "" });
    if (view.live) await flush().catch(() => undefined);
    else await stage();
  });
}
export function chooseTableMode(mode: "local" | "turns" | "live") {
  return serial(async () => {
    if (hasPendingChanges())
      throw new Error("Submit or export and discard pending actions before changing modes.");
    if (mode === "local") {
      const s = session();
      if (s) {
        await closeCloudTable({ data: { code: s.code, token: s.token } });
        leaveTable();
      }
      return;
    }
    if (!session()) await openTable("Dungeon master");
    if (view.live !== (mode === "live")) {
      const s = requireSession();
      await accept(
        await setCloudPace({ data: { code: s.code, token: s.token, live: mode === "live" } }),
      );
    }
  });
}
export function skipTableTurn() {
  return serial(async () => {
    const s = requireSession();
    await accept(await skipCloudTurn({ data: { code: s.code, token: s.token } }));
  });
}
export function manageParticipant(
  action: "release" | "permission" | "start" | "discard",
  seatId: string,
  allowParty?: boolean,
) {
  return serial(async () => {
    const s = requireSession();
    await accept(
      await manageCloudRoom({ data: { code: s.code, token: s.token, action, seatId, allowParty } }),
    );
  });
}
export function releasePlayerSeat() {
  if (view.joined) throw new Error("Leave the shared campaign before changing roles.");
}
export function leaveTable() {
  if (hasPendingChanges())
    throw new Error("Export and resolve your pending actions before disconnecting.");
  if (typeof localStorage !== "undefined") localStorage.removeItem(key());
  if (timer) clearInterval(timer);
  timer = undefined;
  publish({
    joined: false,
    mine: true,
    live: false,
    who: "",
    code: "",
    seats: [],
    revision: 0,
    pending: 0,
    status: "local",
    error: "",
  });
}
export async function disconnectClosedRoom() {
  const saved = await exportPending();
  if (!saved) throw new Error("Share the recovery file before disconnecting. Pending actions are still on this device.");
  const s = requireSession();
  s.pending = [];
  remember(s);
  leaveTable();
}
export function resumeTable() {
  if (typeof localStorage === "undefined") return;
  if (sessionKey && sessionKey !== key()) {
    if (timer) clearInterval(timer);
    timer = undefined;
  }
  sessionKey = key();
  const saved = session();
  if (!saved) return;
  publish({
    joined: true,
    code: saved.code,
    role: saved.role,
    seatId: saved.seatId,
    pending: saved.pending.length,
    status: saved.pending.length ? "pending" : "saving",
  });
  start();
  void serial(refresh).catch(fail);
}

export function pendingActions() {
  return session()?.pending.map((command) => ({ id: command.id, kind: command.kind })) ?? [];
}
export async function importPending(file: File) {
  if (file.size > 2_000_000) throw new Error("Recovery file is too large.");
  const raw = JSON.parse(await file.text());
  const { commandSchema } = await import("./commands.ts");
  return serial(async () => {
    const s = requireSession();
    if (raw.code !== s.code || !Array.isArray(raw.commands))
      throw new Error("This recovery file belongs to a different campaign code.");
    if (raw.commands.length + s.pending.length > 100)
      throw new Error("Submit the current pending actions before importing more.");
    const incoming = raw.commands.map((c: unknown) => commandSchema.parse(c)) as Command[];
    const known = new Set(s.pending.map((c) => c.id));
    s.pending.push(...incoming.filter((c) => !known.has(c.id)));
    remember(s);
    publish({ pending: s.pending.length, status: "pending", error: "" });
    if (view.live) await flush();
    else await stage();
  });
}

/** A stable message id makes manual retries safe after an ambiguous network failure. */
export function sendRoomMessage(command: Extract<Command, { kind: "message" }>) {
  return serial(async () => {
    const s = requireSession();
    const remote = await submitCloudCommands({ data: { code: s.code, token: s.token, batchId: command.id, commands: [command] } });
    await accept(remote);
  });
}
export function roomCredentials() {
  const s = requireSession();
  return { code: s.code, token: s.token };
}
