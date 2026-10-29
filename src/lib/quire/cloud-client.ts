import { activeCampaignId } from "./campaign-context.ts";
import { roomCampaignName } from "./campaign-name.ts";
import { getCampaigns } from "./campaigns.ts";
import type { EconomyMutationOutcome } from "./mutation-outcome.ts";
import { captureDeviceMutationScope, type DeviceMutationScope } from "./mutation-scope.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { reloadCampaignContext } from "./navigation-launch.ts";
import { rememberSave } from "./saves.ts";
import { loadSeatLock } from "./lock.ts";
import { notify } from "./notify.ts";
import { toast } from "sonner";
/** The storage notice this tab has shown (room code and size), so it is shown once. */
let storageWarningShown = "";
import {
  closeCloudTable,
  joinCloudTable,
  openCloudTable,
  previewCloudTable,
  nameCloudRoom,
  pullCloudTable,
  pollCloudTable,
  setCloudPace,
  skipCloudTurn,
  submitCloudCommands,
  manageCloudRoom,
  readCloudHistory,
} from "./room-transport.ts";
import {
  connectRoomHistory,
  historyIncomplete,
  loadAllHistory,
  mergeHistory,
  noteRoomView,
  onRoomHistoryLoaded,
} from "./room-history.ts";
import { setCloudWatch } from "./cloud-turn.ts";
import { applyCloudTable, economySnapshot, snapshot } from "./economy.ts";
import { getSeat, setSeat, downloadJson, resumedPlayerSeat } from "./table.ts";
import {
  applyCommand,
  commandSchema,
  compactPatch,
  tablePatch,
  type Command,
  type CommandRequest,
} from "./commands.ts";
import type { RoomView } from "./cloud.server.ts";
import { rememberIncoming } from "./chat.ts";

import { isEphemeralCampaign, setEphemeralCampaign } from "./guest-storage.ts";
import { closeQuireDb } from "./db.ts";
import { reconcileAccountResume } from "./account-resume.ts";
import { sameCommand as sameIdentity } from "./command-identity.ts";
// A whole-journal patch from an older draft and its split form (journal-patch.ts) are the same action.
const sameCommand = (a: unknown, b: unknown) =>
  sameIdentity(compactPatch(a as Command), compactPatch(b as Command));
import { readRoomResponse, readUnchangedRoom } from "./room-response.ts";
import { forgetRoomImages, restoreRoomImages, roomImageReferences } from "./room-image-cache.ts";
import {
  rememberRevokedRecovery,
  recoveryVisibility,
  revokedRecoveryCopy,
  discardRevokedRecovery,
  hasRevokedMemoryWork,
  invalidateRecoveryVisibility,
  type RecoveryVisibility,
} from "./revoked-recovery.ts";
let playerSession: Session | null = null;
const PLAYER_TICKET = "lootsplit.player.reconnect.v1";
type Session = {
  /** Account owning this seat, captured before queuing work, not on revocation. */
  userId?: string;
  code: string;
  sessionId?: string;
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
  sessionId: "",
  role: "dm" as "dm" | "player",
  seats: [] as RoomView["seats"],
  departed: [] as NonNullable<RoomView["departed"]>,
  testMode: false,
  viewOnly: false,
  /** DM only: the campaign passed the total size warning threshold (storage-warning-notice.tsx). */
  storageWarning: null as { totalBytes: number; limit: number } | null,
  /** The DM's name for the shared campaign ("" when unnamed); campaign-name.ts shows it. */
  campaignName: "",
  encounterActive: undefined as boolean | undefined,
  revision: 0,
  seatId: "",
  pending: 0,
  // Readout only: exact local actions present in the last accepted server draft.
  staged: 0,
  status: "local" as SyncState,
  error: "",
  lastSync: 0,
  recoveries: [] as Array<{ id: string; code: string; pending: number }>,
  unverifiedRecoveries: 0,
  legacyRecoveryChecked: false,
};
let view = initialView;
// Hydration always starts from the same local snapshot, even if room restoration
// ran before a lazy component loaded. React reads the live snapshot after mount.
export function getServerCloudTable() {
  return initialView;
}
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
let pollGeneration = 0;
let pollFailures = 0;
let chain: Promise<unknown> = Promise.resolve();
let acceptedPoll:
  | {
      campaignKey: string;
      token: string;
      seatId: string;
      revision: number;
      userId?: string;
      sessionId?: string;
      /**
       * Set when this server revision could not be previewed under the local
       * pending batch. Conditional polls then ask only whether the room moved
       * past it, instead of re-reading and re-failing the whole room.
       */
      conflictBatch?: string;
      conflictMessage?: string;
    }
  | undefined;
export async function requestCampaignRoll(body: { purseId: string; [key: string]: unknown }) {
  const s = requireSession();
  if (
    !body.policy &&
    !body.log &&
    s.pending.some((c) => c.kind === "character" && c.purseId === body.purseId)
  )
    throw Error("Submit your pending character changes before rolling.");
  const { rollCampaignCharacter } = await import("./cloud-api");
  return rollCampaignCharacter({
    data: { ...body, code: s.code, token: s.token },
  });
}
let sessionKey = "";
const key = () =>
  `quire.cloud.v2.${typeof localStorage === "undefined" ? "main" : activeCampaignId()}`;
function session(): Session | null {
  if (typeof localStorage === "undefined") return null;
  try {
    if (isEphemeralCampaign()) {
      if (!playerSession) {
        const ticket = JSON.parse(sessionStorage.getItem(PLAYER_TICKET) || "null");
        if (ticket?.token && ticket?.code && ticket.role === "player")
          playerSession = {
            ...ticket,
            revision: 0,
            pending: [],
            batchId: crypto.randomUUID(),
          };
      }
      return playerSession;
    }
    let saved = JSON.parse(localStorage.getItem(key()) || "null");
    if (!saved && typeof sessionStorage !== "undefined") {
      const old = JSON.parse(sessionStorage.getItem("quire.cloud.v1") || "null");
      if (old?.token && old?.code) {
        saved = {
          ...old,
          pending: [],
          batchId: crypto.randomUUID(),
          revision: 0,
        };
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
    // Older drafts carried the whole journal (with inline map artwork) in each DM edit, which
    // could exceed the batch limit and this device's storage. Split them into the parts that
    // changed; the room treats both forms as the same action.
    if (saved.pending.some((c: Command) => compactPatch(c) !== c)) {
      saved.pending = saved.pending.map((c: Command) => compactPatch(c));
      try {
        localStorage.setItem(key(), JSON.stringify(saved));
      } catch {
        // Kept in memory for this read; the next successful save stores the smaller form.
      }
    }
    // Legacy owned DM caches inherit the saved campaign owner, never whichever
    // account happens to sign in when a request is later rejected.
    if (saved.role === "dm" && !saved.userId)
      saved.userId = localStorage.getItem(`quire.owner.${activeCampaignId()}`) || undefined;
    return saved;
  } catch {
    return null;
  }
}
function remember(s: Session) {
  if (s.role === "player") {
    playerSession = s;
    sessionStorage.setItem(
      PLAYER_TICKET,
      JSON.stringify({
        code: s.code,
        sessionId: s.sessionId,
        token: s.token,
        seatId: s.seatId,
        role: s.role,
        purseIds: s.purseIds,
        userId: s.userId,
      }),
    );
    return;
  }
  localStorage.setItem(key(), JSON.stringify(s));
}
export type MutationScope = DeviceMutationScope &
  Readonly<{ code: string; seatId: string; sessionId: string }>;
export type ExpectedMutationScope = Pick<MutationScope, "campaignId" | "code"> &
  Partial<Omit<MutationScope, "campaignId" | "code">>;
// Credential identity remains internal and is never placed in requests or diagnostics.
const mutationCredentials = new WeakMap<object, string | undefined>();
export function captureMutationScope(): MutationScope {
  const current = session();
  const scope = Object.freeze({
    ...captureDeviceMutationScope(),
    code: current?.code || "device",
    seatId: current?.seatId || "",
    sessionId: current?.sessionId || "",
  });
  mutationCredentials.set(scope, current?.token);
  return scope;
}
/** Attach the current seat only to an in-campaign reference request, never to cached results. */
export async function searchCampaignReference(query: import("./open5e.ts").OpenQuery) {
  const current = session();
  const { searchOpen5e, searchScopedOpen5e } = await import("./open5e-api.ts");
  return current
    ? searchScopedOpen5e({
        data: { ...query, campaign: { code: current.code, token: current.token } },
      })
    : searchOpen5e({ data: query });
}
export function assertMutationScope(expected: ExpectedMutationScope): void {
  const actual = captureMutationScope();
  for (const key of [
    "campaignId",
    "databaseName",
    "accountId",
    "ephemeral",
    "code",
    "seatId",
    "sessionId",
  ] as const) {
    if (
      expected[key] !== undefined &&
      !(key === "sessionId" && expected[key] === "") &&
      actual[key] !== expected[key]
    )
      throw Error(
        "The campaign or seat changed before this action could finish. Your draft is retained; reopen its original campaign before trying again.",
      );
  }
  if (
    mutationCredentials.has(expected) &&
    mutationCredentials.get(actual) !== mutationCredentials.get(expected)
  )
    throw Error(
      "The campaign session changed before this action could finish. Your draft is retained; review the current session before trying again.",
    );
}

function requireSession() {
  const s = session();
  if (!s) throw new Error("Join a campaign first.");
  return s;
}
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const campaignKey = key();
  const guarded = () => {
    if (key() !== campaignKey)
      throw Error("The campaign changed before this action could finish. Your draft is retained.");
    return fn();
  };
  const locked = async (): Promise<T> =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(
          campaignKey + ".write",
          { signal: AbortSignal.timeout(15000) },
          guarded,
        )
      : guarded();
  const next = chain.then(locked, locked);
  chain = next.catch(() => undefined);
  return next;
}
let seenRecovery: RecoveryVisibility | undefined;
function sameValue(a: unknown, b: unknown) {
  return (
    Object.is(a, b) ||
    (typeof a === "object" &&
      typeof b === "object" &&
      a !== null &&
      b !== null &&
      JSON.stringify(a) === JSON.stringify(b))
  );
}
/** Keep the external-store snapshot identity unless a readout actually changed. */
function sameView(a: typeof view, b: typeof view) {
  for (const k of Object.keys(b) as Array<keyof typeof view>)
    if (!sameValue(a[k], b[k])) return false;
  return Object.keys(a).length === Object.keys(b).length;
}
function publish(next: Partial<typeof view>, dataChanged = true) {
  const previous = view;
  const recovery = (seenRecovery = recoveryVisibility());
  const candidate = {
    ...view,
    ...next,
    recoveries: recovery.recoveries as typeof view.recoveries,
    unverifiedRecoveries: recovery.unverifiedRecoveries,
    legacyRecoveryChecked: recovery.legacyRecoveryChecked,
  };
  const same = sameView(previous, candidate);
  if (!same) view = candidate;
  if (!same && previous.joined && view.joined) {
    if (previous.live !== view.live)
      notify("Mode changed", view.live ? "Live Mode" : "Turn-based Mode", "mode");
    if (!previous.mine && view.mine && !view.live)
      notify("Your turn", "You can make transactions now.", "turn");
    if (previous.seats.length < view.seats.length)
      notify("Player joined", "A participant joined the campaign.", "joined");
  }
  setCloudWatch(
    { joined: view.joined, mine: view.mine, live: view.live, who: view.who },
    dataChanged,
  );
  // An unchanged poll (same room, same status) notifies no subscriber, so the
  // ~60 useSyncExternalStore readers in both split-view panes stay idle.
  if (!same) for (const fn of listeners) fn();
}
export function getCloudTable() {
  // Owner changes can occur while no room is connected. Keep the external-store
  // snapshot stable except when the authorized recovery list actually changes.
  // recoveryVisibility() is cached until storage changes, so this getter stays
  // cheap; it returns the same object until then.
  const recovery = recoveryVisibility();
  if (recovery === seenRecovery) return view;
  seenRecovery = recovery;
  if (
    !sameValue(recovery.recoveries, view.recoveries) ||
    recovery.unverifiedRecoveries !== view.unverifiedRecoveries ||
    recovery.legacyRecoveryChecked !== view.legacyRecoveryChecked
  )
    view = {
      ...view,
      recoveries: recovery.recoveries as typeof view.recoveries,
      unverifiedRecoveries: recovery.unverifiedRecoveries,
      legacyRecoveryChecked: recovery.legacyRecoveryChecked,
    };
  return view;
}
export function refreshRecoveryVisibility() {
  publish({}, false);
}
function storageChanged() {
  // Another document changed storage: the cached recovery view may be stale.
  invalidateRecoveryVisibility();
  refreshRecoveryVisibility();
}
export function subscribeCloudTable(fn: () => void) {
  if (!listeners.size && typeof window !== "undefined") {
    window.addEventListener("lootsplit-account-changed", refreshRecoveryVisibility);
    window.addEventListener("storage", storageChanged);
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (!listeners.size && typeof window !== "undefined") {
      window.removeEventListener("lootsplit-account-changed", refreshRecoveryVisibility);
      window.removeEventListener("storage", storageChanged);
    }
  };
}
/** A preview conflict for the current pending batch is waiting on the user or the room. */
function previewConflictOpen() {
  const s = session();
  return !!acceptedPoll?.conflictBatch && !!s && acceptedPoll.conflictBatch === s.batchId;
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
function warnUnsentPlayerActions(event: BeforeUnloadEvent) {
  if (hasRevokedMemoryWork() || (isEphemeralCampaign() && session()?.pending.length)) {
    event.preventDefault();
    event.returnValue = "";
  }
}
function stopPolling() {
  acceptedPoll = undefined;
  if (typeof window !== "undefined" && !hasRevokedMemoryWork())
    window.removeEventListener("beforeunload", warnUnsentPlayerActions);
  polling = false;
  pollGeneration++;
  pollFailures = 0;
  if (timer) clearTimeout(timer);
  timer = undefined;
}
function start() {
  window.addEventListener("beforeunload", warnUnsentPlayerActions);
  if (polling) return;
  polling = true;
  const generation = ++pollGeneration;
  const schedule = () => {
    if (!polling || generation !== pollGeneration) return;
    const delay = Math.min(30000, 2000 * 2 ** pollFailures);
    timer = setTimeout(async () => {
      timer = undefined;
      if (!polling || generation !== pollGeneration) return;
      if (navigator.onLine !== false && document.visibilityState !== "hidden") {
        try {
          await serial(async () => {
            if (generation === pollGeneration) await refresh(true);
          });
          // A pending batch that cannot be previewed on the room needs the user
          // (export, discard or retry) or a newer room revision. Back off like a
          // failure instead of polling every 2 s; the conflict was shown once.
          pollFailures = previewConflictOpen() ? Math.min(4, pollFailures + 1) : 0;
        } catch (error) {
          if (generation === pollGeneration) {
            pollFailures = Math.min(4, pollFailures + 1);
            fail(error);
          }
        }
      }
      schedule();
    }, delay);
  };
  schedule();
}
async function accept(value: RoomView, committed = false) {
  value = await withRoomImages(value);
  const { remote, draft: incomingDraft } = readRoomResponse(value);
  const s = requireSession();
  if (remote.code !== s.code || remote.seatId !== s.seatId)
    throw Error(
      "The campaign response belongs to a different room or seat. Your pending actions are retained.",
    );
  // History on demand (protocol 12): the view holds the newest lines; the older pages and
  // archived sessions this tab has opened are put back before the device table is written.
  noteRoomView({ code: s.code, token: s.token }, remote);
  lastRemote = { code: remote.code, seatId: remote.seatId, revision: remote.revision, table: remote.table, purseIds: remote.purseIds, seats: remote.seats };
  if (remote.userId && s.userId && remote.userId !== s.userId)
    throw Error(
      "This seat now belongs to a different account. Export your original pending work before switching.",
    );
  if (remote.userId) s.userId = remote.userId;
  s.sessionId = remote.sessionId;
  const acknowledged = new Set(remote.acknowledged);
  const acknowledgedLocal = s.pending.some((c) => acknowledged.has(c.id));
  s.pending = s.pending.filter((c) => !acknowledged.has(c.id));
  if (committed || acknowledgedLocal) {
    if (committed) s.pending = [];
    s.batchId = crypto.randomUUID();
  }
  // Unite immutable same-seat drafts from every device. Acknowledged commands
  // never return as pending, including legacy/delayed server responses.
  const draft = incomingDraft.filter((c) => !acknowledged.has(c.id)).map((c) => compactPatch(c));
  const known = new Map(s.pending.map((c) => [c.id, c]));
  for (const command of draft) {
    const local = known.get(command.id);
    if (local && !sameCommand(local, command))
      fail(
        Error(
          "Another device saved different changes for this action. Export your pending actions before resolving the conflict.",
        ),
      );
    else if (!local) {
      s.pending.push(command);
      s.batchId = crypto.randomUUID();
      known.set(command.id, command);
    }
  }
  const hydratedHere =
    acceptedPoll?.campaignKey === key() &&
    acceptedPoll.token === s.token &&
    acceptedPoll.seatId === s.seatId &&
    acceptedPoll.revision === remote.revision;
  const changed = s.revision !== remote.revision || !hydratedHere;
  if (changed && !s.pending.length) s.batchId = crypto.randomUUID();
  const previousRevision = s.revision;
  s.revision = remote.revision;
  s.purseIds = remote.purseIds;
  // Only a table actually written to this device asks the economy to reload.
  let applied = false;
  let conflict: string | undefined;
  if (!s.pending.length && (changed || committed)) {
    await applyCloudTable(mergeHistory(remote.table));
    applied = true;
  } else if (changed) {
    try {
      await applyCloudTable(previewTable(s, lastRemote));
      applied = true;
    } catch (error) {
      s.revision = previousRevision;
      conflict =
        error instanceof Error
          ? error.message
          : "Connection failed. Your pending changes are saved on this device.";
      // Surface a conflict once per pending batch; a later revision that fails
      // the same way keeps the existing attention instead of re-announcing it.
      const repeated =
        acceptedPoll?.campaignKey === key() &&
        acceptedPoll.token === s.token &&
        acceptedPoll.seatId === s.seatId &&
        acceptedPoll.conflictBatch === s.batchId &&
        acceptedPoll.conflictMessage === conflict &&
        view.error === conflict;
      // Nothing was written to the device table, so this attention must not
      // ask the economy to reload (fail() would announce a data change).
      if (!repeated) publish({ status: "attention", error: conflict }, false);
      await rememberIncoming(remote.table.notes);
    }
  }
  // Persist the revision only after the local table has committed. Navigation can
  // interrupt IndexedDB hydration; saving the revision first made the next page
  // treat an empty/incomplete local copy as already synchronized.
  remember(s);
  acceptedPoll =
    s.revision === remote.revision || conflict !== undefined
      ? {
          campaignKey: key(),
          token: s.token,
          seatId: s.seatId,
          revision: remote.revision,
          userId: remote.userId,
          sessionId: remote.sessionId,
          ...(conflict !== undefined ? { conflictBatch: s.batchId, conflictMessage: conflict } : {}),
        }
      : undefined;
  if (s.role === "player")
    setSeat({
      ...getSeat(),
      role: "player",
      purseIds: remote.purseIds,
      shopIds: remote.shopIds,
    });
  // The campaign passed the total size warning threshold: tell the DM once per tab and size
  // (the Desk keeps the notice; storage-warning-notice.tsx). Never blocks anything.
  if (s.role === "dm" && remote.storageWarning) {
    const shown = `${remote.code}:${remote.storageWarning.totalBytes}`;
    if (shown !== storageWarningShown && typeof window !== "undefined") {
      storageWarningShown = shown;
      toast("This campaign is getting large", {
        description: "With its archived sessions it now passes the size at which every download and undo always works online. Download a copy (My account → Campaigns) to keep the whole campaign safe. Nothing was refused.",
        duration: 10000,
      });
    }
  }
  publish(
    {
      joined: true,
      mine: remote.mine,
      live: remote.live,
      who: remote.who,
      code: remote.code,
      sessionId: remote.sessionId || "",
      role: s.role,
      seats: remote.seats,
      departed: remote.departed || [],
      testMode: remote.testMode === true,
      viewOnly: remote.viewOnly === true,
      storageWarning:
        s.role === "dm" && remote.storageWarning && Number.isFinite(remote.storageWarning.totalBytes) && Number.isFinite(remote.storageWarning.limit)
          ? { totalBytes: remote.storageWarning.totalBytes, limit: remote.storageWarning.limit }
          : null,
      // The server stores a cleaned name (campaign-name.ts); absent means unnamed.
      campaignName: typeof remote.campaignName === "string" ? remote.campaignName : "",
      encounterActive: remote.encounterActive,
      seatId: remote.seatId,
      revision: remote.revision,
      pending: s.pending.length,
      staged: s.pending.filter((command) =>
        draft.some((saved) => saved.id === command.id && sameCommand(saved, command)),
      ).length,
      status: s.pending.length ? (view.error ? "attention" : "pending") : "synced",
      error: s.pending.length ? view.error : "",
      lastSync: Date.now(),
    },
    applied || committed,
  );
  start();
}
/**
 * Tabletop protocol 4+ responses carry shared map images as references (5 adds placement pin
 * styles, 6 map scale bars, 7 journeys). Restore them before the
 * table is read, so device storage, previews, backups and commands keep inline images exactly as
 * before. If any image cannot be loaded, read the same room once more as a protocol 3 client,
 * which receives the full inline envelope. (4 = IMAGE_REFERENCE_PROTOCOL; the 7 sent below is
 * CURRENT_TABLETOP_PROTOCOL in tabletop-protocol.ts. Literals: tests evaluate these functions.)
 */
async function withRoomImages(value: RoomView): Promise<RoomView> {
  const table = (value as { table?: import("./cloud.ts").CloudTable } | null)?.table;
  // Most responses (and every older-protocol one) carry no references: return before any work.
  if (!table?.journal?.world?.maps?.some((map) => map.image?.startsWith("/art/room-image-")))
    return value;
  if (!roomImageReferences(table).length) return value;
  const s = requireSession();
  try {
    return {
      ...value,
      table: await restoreRoomImages(table, {
        campaignKey: key(),
        code: s.code,
        token: s.token,
        ephemeral: isEphemeralCampaign(),
      }),
    };
  } catch {
    return pullCloudTable({
      data: { tabletopProtocol: 3, code: s.code, token: s.token },
    });
  }
}
/** The latest accepted room view's table (unmerged), for re-merging loaded history. */
let lastRemote:
  | { code: string; seatId: string; revision: number; table: CloudTable; purseIds: string[]; seats: RoomView["seats"] }
  | undefined;
/** The device's table for a view with this seat's pending actions applied as a preview. */
function previewTable(s: Session, remote: NonNullable<typeof lastRemote>) {
  let preview = mergeHistory(remote.table);
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
      { preview: true },
    );
  return preview;
}
/**
 * Earlier history finished loading (room-history.ts): write the latest view again with it merged,
 * so every screen sees the older lines. Reads nothing from the room; changes nothing in it.
 */
async function applyLoadedHistory() {
  const s = session();
  if (!s || !lastRemote || lastRemote.code !== s.code || lastRemote.seatId !== s.seatId || lastRemote.revision !== s.revision)
    return;
  try {
    await applyCloudTable(s.pending.length ? previewTable(s, lastRemote) : mergeHistory(lastRemote.table));
  } catch {
    // A pending preview that no longer applies is reported by the next sync, as before.
    return;
  }
  publish({ lastSync: Date.now() }, true);
}
/** Coalesced: batches loaded while one merge waits are written by that one merge. */
let reapplyQueued: Promise<void> | null = null;
function reapplyRoomHistory() {
  reapplyQueued ??= serial(async () => {
    reapplyQueued = null;
    await applyLoadedHistory();
  });
  return reapplyQueued;
}
if (typeof window !== "undefined") {
  connectRoomHistory(readCloudHistory);
  onRoomHistoryLoaded(() => void reapplyRoomHistory().catch(() => undefined));
}
async function refresh(conditional = false) {
  const s = session();
  if (!s) return;
  const campaignKey = key();
  let remote: RoomView | import("./cloud.server.ts").RoomUnchanged;
  const sameSeat =
    conditional &&
    acceptedPoll?.campaignKey === campaignKey &&
    acceptedPoll.token === s.token &&
    acceptedPoll.seatId === s.seatId;
  // After a preview conflict the device keeps its older revision, but the
  // poll only needs to learn whether the room moved past the conflicting one.
  const conflicted =
    sameSeat && !!acceptedPoll!.conflictBatch && acceptedPoll!.conflictBatch === s.batchId;
  const known = sameSeat && (conflicted || acceptedPoll!.revision === s.revision);
  const knownRevision = conflicted ? acceptedPoll!.revision : s.revision;
  try {
    if (known) {
      try {
        remote = await pollCloudTable({
          data: {
            tabletopProtocol: 14,
            code: s.code,
            token: s.token,
            knownRevision,
            knownSeatId: s.seatId,
          },
        });
      } catch (error) {
        // One bounded readonly fallback supports an older edge/client protocol (an edge without
        // the poll endpoint, or a response this client cannot decode). Any other failure (offline,
        // 429, 5xx, a closed room or a released seat) is reported as is: a full read would only
        // double the load during an outage (2026-10-28 load audit, F13). Pending work is retained.
        const message = error instanceof Error ? error.message : String(error);
        const protocol =
          error instanceof SyntaxError ||
          /server function|serverFnId|not found|invariant failed|content-type|unsupported framed protocol|unexpected token|not valid JSON/i.test(
            message,
          );
        if (!protocol) throw error;
        remote = await pullCloudTable({
          data: { tabletopProtocol: 14, code: s.code, token: s.token },
        });
      }
    } else
      remote = await pullCloudTable({
        data: { tabletopProtocol: 14, code: s.code, token: s.token },
      });
  } catch (error) {
    if (key() !== campaignKey || session()?.token !== s.token) return;
    const message = error instanceof Error ? error.message : "";
    if (
      /^(This room is closed\.|No table uses that code\.|This browser is not seated at that table\.|This campaign seat belongs to a restricted account\.)$/.test(
        message,
      )
    ) {
      if (s.pending.length) rememberRevokedRecovery(s, isEphemeralCampaign());
      if (s.role !== "player") await noteIncompleteDeviceCopy();
      await detachTable(s.role === "player");
      notify(
        "Campaign access ended",
        s.pending.length
          ? "Your seat was released. Export the unsent recovery copy before closing this document."
          : "Your seat was released. Authorized session reports remain in My account.",
        "mode",
      );
      return;
    }
    throw error;
  }
  if (key() !== campaignKey || session()?.token !== s.token) return;
  if (remote && typeof remote === "object" && "unchanged" in remote) {
    // Compare with the last authoritative envelope, not a legacy account cache:
    // older linked seats may legitimately omit userId in both full and compact views.
    const fresh = readUnchangedRoom(remote, {
      ...s,
      revision: knownRevision,
      userId: acceptedPoll?.userId,
      sessionId: acceptedPoll?.sessionId,
    });
    publish(
      {
        encounterActive: fresh.encounterActive,
        // Readers only distinguish "never synced" (0); a clock tick alone must
        // not give every subscriber a new snapshot.
        lastSync: view.lastSync || Date.now(),
        error: s.pending.length ? view.error : "",
        status: s.pending.length ? (view.error ? "attention" : "pending") : "synced",
      },
      false,
    );
    return;
  }
  await accept(remote);
}
export async function refreshShared() {
  return serial(refresh);
}
/**
 * Re-read the shared room for window focus and workspace changes: the light "unchanged" poll
 * first, so an unchanged room costs ~250 bytes instead of the whole room (2026-10-28 load
 * audit, F7). A changed room is read and applied exactly as by refreshShared().
 */
export async function refreshSharedIfChanged() {
  return serial(() => refresh(true));
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
      // History on demand: a copy holds every older line and archived session this seat may
      // read, as before, so they are loaded (with progress) and merged first.
      await loadWholeCampaign("the copy would be incomplete. Nothing was saved");
    }
    return snapshot();
  });
}
/**
 * History on demand (protocol 12): this device's copy of a shared campaign holds the newest
 * ledger and chat lines, plus the older lines and archived sessions loaded in this tab. Before
 * the copy becomes the whole campaign (a backup or download, the DM's local campaign after
 * closing or leaving the room, signing out or deleting the room while keeping the DM's copy,
 * a safety save before joining another room), every older line and archived session is loaded
 * and merged. When that fails, the caller stops and nothing changes (the room stays open).
 */
async function loadWholeCampaign(failure: string) {
  if (!session()) return assertWholeDeviceCampaign(failure);
  await refresh();
  if (session()) {
    await loadAllHistory();
    if (historyIncomplete())
      throw new Error(`Part of this campaign's earlier history could not be loaded, so ${failure}. Check the connection and try again.`);
    await applyLoadedHistory();
  }
  await assertWholeDeviceCampaign(failure);
}
async function assertWholeDeviceCampaign(failure: string) {
  if ((await economySnapshot()).journal?.reports?.some((r) => r.deferred))
    throw new Error(`Part of this campaign's earlier history is not loaded on this device, so ${failure}. Open the shared campaign and try again.`);
}
/**
 * For account flows that end this device's room access while keeping the DM's copy (signing
 * out, deleting the shared campaign): loads the whole campaign onto the device first, or throws.
 */
export function keepWholeCampaignOnDevice() {
  return serial(() => loadWholeCampaign("nothing was changed"));
}
export const DEVICE_HISTORY_NOTICE_ID = "lootsplit-history-device-notice";
/**
 * When the room ended before its whole history reached this device (closed elsewhere, access
 * revoked) and the DM keeps the device's copy: the copy says so in its chat, so it never passes
 * silently for the whole campaign. The whole campaign stays with the shared campaign online.
 */
async function noteIncompleteDeviceCopy() {
  const table = await economySnapshot();
  const partial = historyIncomplete() || (table.journal?.reports ?? []).some((r) => r.deferred);
  if (!partial || table.notes.some((n) => n.id === DEVICE_HISTORY_NOTICE_ID)) return;
  await applyCloudTable({
    ...table,
    notes: [
      {
        id: DEVICE_HISTORY_NOTICE_ID,
        at: table.notes[0]?.at ?? Date.now(),
        from: "dm",
        to: "party",
        purseId: "",
        text: "Lootsplitter: this device's copy ended before all of the shared campaign's earlier messages, ledger lines and archived sessions were loaded. The whole campaign is kept online with the shared campaign: My account → Campaigns (Download a copy). Nothing was deleted.",
      },
      ...table.notes,
    ],
  });
}
/** The campaign name the DM's device would send to this room (undefined: a device default). */
function deviceCampaignName(): string | undefined {
  const { campaigns, activeId } = getCampaigns();
  return roomCampaignName(campaigns.find((c) => c.id === activeId)?.name);
}
let namingRoom = "";
/**
 * Rooms opened before names travelled, or a campaign renamed while in Local Mode, get the DM
 * device's current name once the DM's seat has read the room (shell effect). One try per name
 * and room in this tab; naming is cosmetic, so a failure leaves the "Shared campaign · CODE"
 * fallback and is not surfaced.
 */
export function syncRoomCampaignName() {
  const s = session();
  if (!s || s.role !== "dm" || !view.joined || view.code !== s.code || !view.lastSync) return;
  const wanted = deviceCampaignName();
  if (!wanted || wanted === view.campaignName) return;
  const attempt = `${s.code}:${wanted}`;
  if (namingRoom === attempt) return;
  namingRoom = attempt;
  void serial(async () => {
    const current = session();
    if (!current || current.role !== "dm" || current.code !== s.code) return;
    await accept(
      await nameCloudRoom({
        data: { tabletopProtocol: 14, code: current.code, token: current.token, campaignName: wanted },
      }),
    );
  }).catch(() => {});
}
export async function openTable(name: string) {
  const campaignName = deviceCampaignName();
  const opened = await openCloudTable({
    data: { name, table: await economySnapshot(), ...(campaignName ? { campaignName } : {}) },
  });
  remember({
    ...opened,
    role: "dm",
    purseIds: [],
    pending: [],
    batchId: crypto.randomUUID(),
  });
  await refresh();
}
export async function lookupTable(code: string, sessionId?: string) {
  const [room, generation] = code.trim().split(".");
  return previewCloudTable({
    data: { code: room!.toUpperCase(), sessionId: sessionId || generation },
  });
}
export async function joinTable(
  code: string,
  purseId: string,
  name: string,
  invitation?: string,
  sessionId?: string,
) {
  return serial(async () => {
    if (hasPendingChanges())
      throw new Error("Resolve pending changes before joining another campaign.");
    if (!isEphemeralCampaign() && !(await loadSeatLock())?.protectSaves) {
      // A safety save is a whole campaign (history on demand).
      if (session()) await loadWholeCampaign("you did not join and nothing was changed");
      await rememberSave({
        name: `Before joining room ${code.trim().toUpperCase()}`,
        campaignId: activeCampaignId(),
        file: await snapshot(),
      });
    }
    const [room, generation] = code.trim().split(".");
    const joined = await joinCloudTable({
      data: {
        code: room!.toUpperCase(),
        purseId,
        name,
        invitation,
        sessionId: sessionId || generation,
      },
    });
    setEphemeralCampaign(true);
    closeQuireDb();
    remember({
      ...joined,
      revision: 0,
      code: room!.toUpperCase(),
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
    const remote = await submitRoomCommands({
      data: {
        tabletopProtocol: 14,
        code: s.code,
        token: s.token,
        batchId: s.batchId,
        commands: s.pending,
        endTurn,
      },
    });
    await accept(remote, true);
  } catch (error) {
    fail(error);
    throw error;
  }
}
/**
 * One automatic retry when the room was busy (live-campaign load audit F2): the server already
 * retried its revision conflicts, so this covers a burst of simultaneous actions that outlasted
 * them. The same batch and action IDs are sent again, which the room applies at most once.
 * Permission, validation and connection errors are never retried here.
 */
async function submitRoomCommands(request: Parameters<typeof submitCloudCommands>[0]) {
  try {
    return await submitCloudCommands(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("The table changed.") && !message.startsWith("The campaign is busy."))
      throw error;
    await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 250));
    return submitCloudCommands(request);
  }
}
async function stage(rethrow = false) {
  const s = requireSession();
  if (!s.pending.length) return;
  try {
    const remote = await submitRoomCommands({
      data: {
        tabletopProtocol: 14,
        code: s.code,
        token: s.token,
        batchId: s.batchId,
        commands: s.pending,
        stage: true,
      },
    });
    await accept(remote);
  } catch (error) {
    fail(error);
    if (rethrow) throw error;
  }
}
export function endTableTurn() {
  return serial(() => flush(true));
}
export function retryPending() {
  return serial(async () => {
    await refresh();
    if (!requireSession().pending.length) return;
    publish({ status: "saving", error: "" });
    const submit = () => (view.live ? flush() : stage(true));
    try {
      await submit();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.startsWith("This batch ID was already used for different actions.")
      )
        throw error;
      // Older clients could persist a changed queue under a committed receipt.
      // Only this explicit batch collision permits one fresh receipt. Keep the
      // immutable action IDs so already committed transfers cannot run twice.
      const s = requireSession();
      s.batchId = crypto.randomUUID();
      remember(s);
      await submit();
    }
  });
}
export function exportPending() {
  const s = requireSession();
  return downloadJson(`lootsplit-pending-${s.code}.json`, {
    code: s.code,
    seatId: s.seatId,
    batchId: s.batchId,
    commands: s.pending,
    exportedAt: Date.now(),
  });
}
export async function exportRevokedPending(id: string) {
  const recovery = revokedRecoveryCopy(id);
  return downloadJson(`lootsplit-pending-${recovery.code}.json`, recovery);
}
export async function discardRevokedPending(id: string) {
  discardRevokedRecovery(id);
  if (!hasRevokedMemoryWork() && !polling && typeof window !== "undefined")
    window.removeEventListener("beforeunload", warnUnsentPlayerActions);
  publish({});
}
export function discardPending() {
  return serial(async () => {
    const s = requireSession();
    const remote = await manageCloudRoom({
      data: {
        tabletopProtocol: 14,
        code: s.code,
        token: s.token,
        action: "discard",
        seatId: s.seatId,
      },
    });
    await accept(remote, true);
  });
}
export async function queueCommand(
  input: CommandRequest,
  expected?: ExpectedMutationScope,
): Promise<EconomyMutationOutcome> {
  const invoked = captureMutationScope();
  const guard = () => {
    assertMutationScope(invoked);
    if (expected) assertMutationScope(expected);
  };
  return serial(async () => {
    guard();
    const s = requireSession();
    if (view.viewOnly && s.role === "player")
      throw Error("The session has ended. This room is view-only until the DM resumes play.");
    // Chat, treasure-pool claims and quest changes (which move nothing) are not bound to the turn.
    if (input.kind !== "message" && input.kind !== "loot-claim" && !input.kind.startsWith("quest-") && !view.mine)
      throw new Error(`It is ${view.who}'s turn.`);
    if (s.pending.length >= 100) throw new Error("Submit your pending actions before adding more.");
    // A caller-supplied ID identifies one user action across retries: an action
    // already queued is not queued twice, and the room skips IDs it has applied.
    const command = commandSchema.parse({ ...input, id: input.id || crypto.randomUUID() });
    const queued = s.pending.find((c) => c.id === command.id);
    if (queued) {
      if (!sameCommand(queued, command))
        throw Error("This action ID was already used for a different action. Refresh before retrying.");
      return { status: "pending" };
    }
    const seasonalPlan =
      input.kind === "trade-season-plan" || (input.kind === "downtime-plan" && input.advanceSeason);
    if (seasonalPlan && s.pending.length)
      throw Error(
        "Submit or resolve pending actions before preparing authoritative seasonal rolls.",
      );
    // NPC barter is rolled and answered by the room server, so it is submitted directly
    // instead of being previewed on this device (docs/NPC-BARTER.md).
    const npcBarter = input.kind.startsWith("npc-barter-");
    if (npcBarter && s.pending.length)
      throw Error("Submit or discard your pending actions before bartering with an NPC.");
    // Treasure-pool claims and resolutions go to the room directly: a claim moves nothing, and a
    // resolution is rolled by the room server, so the preview cannot show its results.
    const loot = input.kind === "loot-claim" || input.kind === "loot-resolve";
    if (input.kind === "loot-resolve" && s.pending.length)
      throw Error("Submit or discard your pending actions before resolving the treasure pool.");
    // Quest changes (DM only, nothing moves) go to the room directly too, never with a turn.
    const quest = input.kind.startsWith("quest-");
    if (quest && s.pending.length)
      throw Error("Submit or discard your pending actions before changing quests.");
    if (input.kind === "message" || seasonalPlan || npcBarter || loot || quest) {
      // Chat is independent of transaction turns; retain a failed message in the editor.
      const remote = await submitRoomCommands({
        data: {
          tabletopProtocol: 14,
          code: s.code,
          token: s.token,
          batchId: command.id,
          commands: [command],
        },
      });
      await accept(remote);
      return { status: "committed" };
    }
    // Conditional: an unchanged room answers "unchanged" and the device table is already that
    // revision (accept() would not rewrite it either); a changed room is read in full (F7).
    if (!s.pending.length) await refresh(true);
    guard();
    const current = requireSession(),
      before = await economySnapshot();
    guard();
    // The room already committed this caller-identified action (its records
    // carry the command ID): a retry must not preview or submit it again.
    if (input.id && carriesCommand(before, command.id)) return { status: "committed" };
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
      { preview: true },
    );
    current.pending.push(command);
    current.batchId = crypto.randomUUID();
    remember(current);
    publish({ pending: current.pending.length, status: "pending", error: "" });
    try {
      await applyCloudTable(after, guard);
      guard();
    } catch (error) {
      // This exact command is already retained for recovery. A failed local
      // hydration must not invite the form to repeat the accepted action.
      fail(error);
      return { status: "pending" };
    }
    if (view.live) {
      await flush().catch(() => undefined);
    } else await stage();
    const latest = session();
    return {
      status: (latest?.code === current.code && latest.seatId === current.seatId
        ? latest.pending
        : current.pending
      ).some((c) => c.id === command.id)
        ? "pending"
        : "committed",
    };
  });
}
/**
 * Several commands submitted as one batch the room applies atomically (`applyCommandBatch`):
 * the journey planner's one-click "Approve & depart". Sent directly, like NPC barter, so it
 * needs no other pending actions. `batchId` is one per user action, reused on retry.
 */
export async function queueCommandBatch(
  batchId: string,
  inputs: CommandRequest[],
  expected?: ExpectedMutationScope,
): Promise<EconomyMutationOutcome> {
  const invoked = captureMutationScope();
  const guard = () => {
    assertMutationScope(invoked);
    if (expected) assertMutationScope(expected);
  };
  return serial(async () => {
    guard();
    const s = requireSession();
    if (view.viewOnly && s.role === "player")
      throw Error("The session has ended. This room is view-only until the DM resumes play.");
    if (!view.mine) throw new Error(`It is ${view.who}'s turn.`);
    if (s.pending.length)
      throw Error("Submit or discard your pending actions before approving in one step.");
    const commands = inputs.map((input) =>
      commandSchema.parse({ ...input, id: input.id || crypto.randomUUID() }),
    );
    const remote = await submitRoomCommands({
      data: { tabletopProtocol: 14, code: s.code, token: s.token, batchId, commands },
    });
    guard();
    await accept(remote);
    return { status: "committed" };
  });
}
/** True when the table holds records the shared engine keys by this command ID. */
function carriesCommand(table: CloudTable, id: string): boolean {
  const ours = (rowId: string) => rowId === id || rowId.startsWith(id + "-");
  return (
    table.ledger.some((l) => ours(l.id)) ||
    table.holdings.some((h) => ours(h.id)) ||
    table.notes.some((n) => ours(n.id)) ||
    (table.journal?.events ?? []).some((e) => e.id.startsWith(id + "-event-"))
  );
}
export function runSharedMutation(
  work: () => Promise<unknown>,
  expected?: ExpectedMutationScope,
): Promise<EconomyMutationOutcome> {
  const invoked = captureMutationScope();
  const guard = () => {
    assertMutationScope(invoked);
    if (expected) assertMutationScope(expected);
  };
  return serial(async () => {
    guard();
    const s = requireSession();
    if (s.role !== "dm")
      throw new Error(
        "Only the DM can directly edit funds and inventory in shared modes. Use Buy, Sell, Give, or Request loan.",
      );
    if (!view.mine) throw new Error(`It is ${view.who}'s turn.`);
    if (s.pending.length >= 100) throw new Error("Submit your pending actions first.");
    if (!s.pending.length) await refresh(true);
    guard();
    const before = await economySnapshot();
    guard();
    let after;
    try {
      await work();
      guard();
      after = await economySnapshot();
      guard();
    } catch (e) {
      await applyCloudTable(before, guard);
      throw e;
    }
    const patch = tablePatch(before, after);
    if (patch.kind !== "patch" || !patch.changes.length) return { status: "committed" };
    const current = requireSession();
    const command = commandSchema.parse({ ...patch, id: crypto.randomUUID() });
    current.pending.push(command);
    current.batchId = crypto.randomUUID();
    try {
      remember(current);
    } catch (e) {
      await applyCloudTable(before, guard);
      throw e;
    }
    publish({ pending: current.pending.length, status: "pending", error: "" });
    if (view.live) await flush().catch(() => undefined);
    else await stage();
    const latest = session();
    return {
      status: (latest?.code === current.code && latest.seatId === current.seatId
        ? latest.pending
        : current.pending
      ).some((c) => c.id === command.id)
        ? "pending"
        : "committed",
    };
  });
}
export function chooseTableMode(mode: "local" | "turns" | "live") {
  return serial(async () => {
    if (hasPendingChanges())
      throw new Error("Submit or export and discard pending actions before changing modes.");
    if (mode === "local") {
      const s = session();
      if (s) {
        // The DM's device keeps the campaign: load all of it while the room can still serve it.
        await loadWholeCampaign("the room was not closed and nothing was changed");
        await closeCloudTable({ data: { code: s.code, token: s.token } });
        await detachTable(false);
      }
      return;
    }
    if (!session()) await openTable("Dungeon master");
    if (view.viewOnly || view.live !== (mode === "live")) {
      const s = requireSession();
      await accept(
        await setCloudPace({
          data: { tabletopProtocol: 14, code: s.code, token: s.token, live: mode === "live" },
        }),
      );
    }
  });
}
export function endSessionKeepOnline() {
  return serial(async () => {
    if (hasPendingChanges()) throw Error("Resolve pending actions before ending the session.");
    const s = requireSession();
    await closeCloudTable({ data: { code: s.code, token: s.token, keepOnline: true } });
    await refresh();
  });
}
export function leaveViewableRoom() {
  return serial(async () => {
    const s = requireSession();
    if (s.role !== "dm" || !view.viewOnly || hasPendingChanges())
      throw Error("End the session and resolve pending actions before leaving the room online.");
    await refresh();
    if (!view.viewOnly) throw Error("The session has resumed. End it before leaving.");
    await loadWholeCampaign("you are still in the room and nothing was changed");
    await detachTable(false);
  });
}
export function skipTableTurn() {
  return serial(async () => {
    const s = requireSession();
    await accept(
      await skipCloudTurn({ data: { tabletopProtocol: 14, code: s.code, token: s.token } }),
    );
  });
}
export function manageParticipant(
  action: "release" | "kick" | "ban" | "invite" | "permission" | "start" | "discard",
  seatId: string,
  allowParty?: boolean,
) {
  return serial(async () => {
    const s = requireSession();
    await accept(
      await manageCloudRoom({
        data: { tabletopProtocol: 14, code: s.code, token: s.token, action, seatId, allowParty },
      }),
    );
  });
}
export function releasePlayerSeat() {
  if (view.joined) throw new Error("Leave the shared campaign before changing roles.");
}
async function detachTable(clearPlayerCopy: boolean) {
  if (clearPlayerCopy) {
    await applyCloudTable(emptyCloudTable());
    setSeat({
      role: "player",
      purseIds: [],
      shopIds: [],
      openedAt: Date.now(),
    });
  }
  if (isEphemeralCampaign()) {
    playerSession = null;
    sessionStorage.removeItem(PLAYER_TICKET);
  } else if (typeof localStorage !== "undefined") localStorage.removeItem(key());
  forgetRoomImages();
  stopPolling();
  publish({ ...initialView });
}
export async function leaveTable() {
  if (hasPendingChanges())
    throw new Error("Export and resolve your pending actions before disconnecting.");
  const s = session();
  if (s?.role === "dm") throw Error("The DM must end the session before leaving.");
  if (s)
    await manageCloudRoom({
      data: {
        tabletopProtocol: 14,
        code: s.code,
        token: s.token,
        action: "leave",
        seatId: s.seatId,
      },
    });
  await detachTable(true);
}
export async function disconnectClosedRoom() {
  const saved = await exportPending();
  if (!saved)
    throw new Error(
      "Share the recovery file before disconnecting. Pending actions are still on this device.",
    );
  const s = requireSession();
  s.pending = [];
  remember(s);
  if (s.role !== "player") await noteIncompleteDeviceCopy();
  await detachTable(s.role === "player");
}
export function resumeTable() {
  if (typeof localStorage === "undefined") return;
  if (sessionKey && sessionKey !== key()) {
    stopPolling();
  }
  sessionKey = key();
  const saved = session();
  if (!saved) return;
  // A reloaded player document starts with an empty seat (campaign gate). Restore this
  // seat's characters from the saved session before the room is shown as joined, so the
  // composer and sheets do not treat the player as unassigned until the first response.
  const seat = resumedPlayerSeat(getSeat(), saved);
  if (seat) setSeat(seat);
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
  return (
    session()?.pending.map((command) => ({
      id: command.id,
      kind: command.kind,
    })) ?? []
  );
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
    if (raw.seatId && raw.seatId !== s.seatId)
      throw new Error(
        "These device changes belong to a different seat. Review them with the DM instead of replaying them here.",
      );
    const saved = new Map(s.pending.map((c) => [c.id, c]));
    if (incoming.some((c) => saved.has(c.id) && !sameCommand(saved.get(c.id), c)))
      throw Error(
        "This recovery file contains conflicting changes for a pending action. Export both copies and resolve them with the DM.",
      );
    const known = new Set(saved.keys());
    const additions = incoming.filter((c) => !known.has(c.id));
    s.pending.push(...additions);
    if (additions.length) s.batchId = crypto.randomUUID();
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
    const remote = await submitRoomCommands({
      data: {
        tabletopProtocol: 14,
        code: s.code,
        token: s.token,
        batchId: command.id,
        commands: [command],
      },
    });
    await accept(remote);
  });
}
/** A player's NPC barter quote comes from the room server: the NPC's rules and purse stay there. */
export async function requestNpcBarterQuote(input: import("./npc-barter.ts").BarterOfferInput) {
  const s = requireSession();
  const { quoteCloudNpcBarter } = await import("./cloud-api");
  return quoteCloudNpcBarter({ data: { ...input, code: s.code, token: s.token } });
}
export function roomCredentials() {
  const s = requireSession();
  return { code: s.code, token: s.token };
}

/** Account resume reads the server copy, not this device's optimistic edits. */
export function prepareAccountMembership() {
  return serial(async () => {
    await refresh();
    requireSession();
    if (view.live && hasPendingChanges()) {
      try {
        // Retain the existing command/batch IDs: a lost response may already
        // have committed, and retrying must never duplicate campaign actions.
        await flush();
      } catch {
        throw new Error(
          "Campaign changes have not synced. They are kept on this device. Open Multiplayer to retry, then save this membership again.",
        );
      }
    }
    return roomCredentials();
  });
}

export async function resumeAccountMembership(
  member: import("../account/client").AccountMembership,
) {
  return serial(async () => {
    const current = session();
    if (sessionStorage.getItem("lootsplit.verified-account") !== member.userId)
      throw new Error("Sign in to the account that owns this saved campaign.");
    if (current?.pending.length && current.code !== member.code)
      throw new Error("Submit or resolve your pending actions before switching campaigns.");
    if (
      current?.pending.length &&
      current.role === "player" &&
      (current.seatId !== member.seatId || current.token !== member.token)
    )
      throw new Error("Export your unsynced player changes in Multiplayer before changing seats.");
    const { remote, draft } = readRoomResponse(
      await pullCloudTable({
        data: { tabletopProtocol: 14, code: member.code, token: member.token },
      }),
    );
    const role = remote.seats.find((s) => s.id === remote.seatId)?.role;
    if (
      !role ||
      (role === "player" && !remote.purseIds.length) ||
      remote.seatId !== member.seatId ||
      remote.code !== member.code ||
      (remote.userId && remote.userId !== member.userId)
    )
      throw new Error("This membership has changed. Refresh your account library.");
    const { selectAccountCampaign } = await import("./campaigns");
    const id = `account-${member.userId}-${member.code}`;
    const targetKey = `quire.cloud.v2.${id}`;
    const existing = JSON.parse(localStorage.getItem(targetKey) || "null") as Session | null;
    const cached = current?.pending.length ? current : role === "player" ? current : existing;
    const reconciled = reconcileAccountResume(
      cached,
      remote,
      { token: member.token, role },
      crypto.randomUUID(),
    );
    if (role === "player" && reconciled.needsRecovery)
      throw new Error(
        "Your unsynced player changes are still in this session. Export them in Multiplayer before changing seats.",
      );
    const recoveryCandidates =
      role === "dm"
        ? [
            ...(cached?.pending.length && reconciled.needsRecovery ? [cached] : []),
            ...(existing?.pending.length && cached !== existing && key() !== targetKey
              ? [existing]
              : []),
          ]
        : [];
    for (const recovery of recoveryCandidates) {
      // Keep an immutable recovery record before replacing the active cache.
      // Includes the original batch and seat IDs, but never an authentication token.
      const recoveryKey = `quire.account-recovery.v1.${id}.${recovery.batchId}.${crypto.randomUUID()}`;
      if (!localStorage.getItem(recoveryKey))
        localStorage.setItem(
          recoveryKey,
          JSON.stringify({
            userId: member.userId,
            code: recovery.code,
            seatId: recovery.seatId,
            batchId: recovery.batchId,
            commands: recovery.pending,
            exportedAt: Date.now(),
            separateSeat: true,
          }),
        );
    }
    if (reconciled.needsRecovery) {
      // Open the authoritative seat with its own draft. Old work stays exportable.
      reconciled.pending = draft.filter((c) => !remote.acknowledged.includes(c.id));
      reconciled.batchId = crypto.randomUUID();
      reconciled.revision = reconciled.pending.length ? -1 : 0;
    }
    stopPolling();
    setEphemeralCampaign(role === "player");
    closeQuireDb();
    if (role === "dm")
      selectAccountCampaign(id, member.name, {
        role,
        purseIds: remote.purseIds,
        shopIds: remote.shopIds,
        openedAt: Date.now(),
      });
    remember({
      code: member.code,
      userId: member.userId,
      token: member.token,
      seatId: remote.seatId,
      role,
      purseIds: remote.purseIds,
      revision: reconciled.revision,
      pending: reconciled.pending,
      batchId: reconciled.batchId,
    });
    if (role === "dm") localStorage.setItem(`quire.owner.${id}`, member.userId);
    reloadCampaignContext();
  });
}

export async function clearAccountRoom(preserveDmCopy = false) {
  if (preserveDmCopy && session()?.role === "dm") await noteIncompleteDeviceCopy();
  await detachTable(!(preserveDmCopy && session()?.role === "dm"));
}

/** Ephemeral signals bypass financial commands/turn drafts and never enter device storage. */
export async function requestMapSignals(
  mapId: string,
  ping?: import("./map-signals.ts").MapPingInput,
) {
  const s = requireSession(),
    campaign = key();
  const { requestCloudMapSignals } = await import("./cloud-api.ts");
  const started = Date.now();
  const result = await requestCloudMapSignals({
    data: { code: s.code, token: s.token, mapId, ping },
  });
  if (key() !== campaign || session()?.token !== s.token) throw Error("The campaign changed.");
  return { ...result, serverNow: result.serverNow + Math.max(0, Date.now() - started) };
}

/** Private media travels separately; a stale campaign response never enters another window. */
export async function requestMapAssets(request: unknown) {
  const s = requireSession(),
    campaign = key();
  const { requestCloudMapAssets } = await import("./cloud-api.ts");
  const result = await requestCloudMapAssets({ data: { code: s.code, token: s.token, request } });
  if (key() !== campaign || session()?.token !== s.token) throw Error("The campaign changed.");
  return result;
}

/** The seat's initiative panel (revealed order, round, own HP); null when not shown here. */
export async function readSharedMapCombatOrder(mapId:string) {
  const expected=captureMutationScope(),current=requireSession();
  const {readMapCombatOrder}=await import("./cloud-api");
  const {mapCombatOrderSchema}=await import("./map-combat-schema");
  const result=await readMapCombatOrder({data:{code:current.code,token:current.token,mapId}});
  assertMutationScope(expected);
  return result===null?null:mapCombatOrderSchema.parse(result);
}
export async function readSharedMapCombat(mapId:string) {
  const expected=captureMutationScope(),current=requireSession();
  const {readMapCombatPresentation}=await import("./cloud-api");
  const {mapCombatHudSchema}=await import("./map-combat-schema");
  const result=await readMapCombatPresentation({data:{code:current.code,token:current.token,mapId}});
  assertMutationScope(expected);
  return result===null?null:mapCombatHudSchema.parse(result);
}
