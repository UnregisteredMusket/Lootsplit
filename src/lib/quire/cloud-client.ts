import type { EconomyMutationOutcome } from "./mutation-outcome.ts";
import { captureDeviceMutationScope, type DeviceMutationScope } from "./mutation-scope.ts";
import { emptyCloudTable } from "./cloud.ts";
import { reloadCampaignContext } from "./navigation-launch.ts";
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
import {
  applyCommand,
  commandSchema,
  tablePatch,
  type Command,
  type CommandInput,
} from "./commands.ts";
import type { RoomView } from "./cloud.server.ts";
import { rememberIncoming } from "./chat.ts";

import { isEphemeralCampaign, setEphemeralCampaign } from "./guest-storage.ts";
import { closeQuireDb } from "./db.ts";
import { reconcileAccountResume } from "./account-resume.ts";
import { sameCommand } from "./command-identity.ts";
import {
  rememberRevokedRecovery,
  revokedRecoverySummaries,
  revokedRecoveryCopy,
  discardRevokedRecovery,
  hasRevokedMemoryWork,
  legacyRecoveryCount,
  legacyRecoveryChecked,
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
  revision: 0,
  seatId: "",
  pending: 0,
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
  `quire.cloud.v2.${typeof localStorage === "undefined" ? "main" : localStorage.getItem("quire.campaign.v1") || "main"}`;
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
    // Legacy owned DM caches inherit the saved campaign owner, never whichever
    // account happens to sign in when a request is later rejected.
    if (saved.role === "dm" && !saved.userId)
      saved.userId =
        localStorage.getItem(
          `quire.owner.${localStorage.getItem("quire.campaign.v1") || "main"}`,
        ) || undefined;
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
function publish(next: Partial<typeof view>, dataChanged = true) {
  const previous = view;
  view = {
    ...view,
    ...next,
    recoveries: revokedRecoverySummaries(),
    unverifiedRecoveries: legacyRecoveryCount(),
    legacyRecoveryChecked: legacyRecoveryChecked(),
  };
  if (previous.joined && view.joined) {
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
  for (const fn of listeners) fn();
}
export function getCloudTable() {
  // Owner changes can occur while no room is connected. Keep the external-store
  // snapshot stable except when the authorized recovery list actually changes.
  const recoveries = revokedRecoverySummaries(),
    unverifiedRecoveries = legacyRecoveryCount(),
    checked = legacyRecoveryChecked();
  if (
    JSON.stringify(recoveries) !== JSON.stringify(view.recoveries) ||
    unverifiedRecoveries !== view.unverifiedRecoveries ||
    checked !== view.legacyRecoveryChecked
  )
    view = { ...view, recoveries, unverifiedRecoveries, legacyRecoveryChecked: checked };
  return view;
}
export function refreshRecoveryVisibility() {
  publish({}, false);
}
export function subscribeCloudTable(fn: () => void) {
  if (!listeners.size && typeof window !== "undefined")
    window.addEventListener("lootsplit-account-changed", refreshRecoveryVisibility);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (!listeners.size && typeof window !== "undefined")
      window.removeEventListener("lootsplit-account-changed", refreshRecoveryVisibility);
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
function warnUnsentPlayerActions(event: BeforeUnloadEvent) {
  if (hasRevokedMemoryWork() || (isEphemeralCampaign() && session()?.pending.length)) {
    event.preventDefault();
    event.returnValue = "";
  }
}
function stopPolling() {
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
            if (generation === pollGeneration) await refresh();
          });
          pollFailures = 0;
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
async function accept(remote: RoomView, committed = false) {
  const s = requireSession();
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
  const draft = (JSON.parse(remote.draft) as Command[]).filter((c) => !acknowledged.has(c.id));
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
  const changed = s.revision !== remote.revision;
  if (changed && !s.pending.length) s.batchId = crypto.randomUUID();
  const previousRevision = s.revision;
  s.revision = remote.revision;
  s.purseIds = remote.purseIds;
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
      s.revision = previousRevision;
      fail(error);
      await rememberIncoming(remote.table.notes);
    }
  }
  // Persist the revision only after the local table has committed. Navigation can
  // interrupt IndexedDB hydration; saving the revision first made the next page
  // treat an empty/incomplete local copy as already synchronized.
  remember(s);
  if (s.role === "player")
    setSeat({
      ...getSeat(),
      role: "player",
      purseIds: remote.purseIds,
      shopIds: remote.shopIds,
    });
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
      seatId: remote.seatId,
      revision: remote.revision,
      pending: s.pending.length,
      status: s.pending.length ? (view.error ? "attention" : "pending") : "synced",
      error: s.pending.length ? view.error : "",
      lastSync: Date.now(),
    },
    changed || committed,
  );
  start();
}
async function refresh() {
  const s = session();
  if (!s) return;
  const campaignKey = key();
  let remote: RoomView;
  try {
    remote = await pullCloudTable({ data: { code: s.code, token: s.token } });
  } catch (error) {
    if (key() !== campaignKey || session()?.token !== s.token) return;
    const message = error instanceof Error ? error.message : "";
    if (
      /^(This room is closed\.|No table uses that code\.|This browser is not seated at that table\.|This campaign seat belongs to a restricted account\.)$/.test(
        message,
      )
    ) {
      if (s.pending.length) rememberRevokedRecovery(s, isEphemeralCampaign());
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
  const opened = await openCloudTable({
    data: { name, table: await economySnapshot() },
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
      await rememberSave({
        name: `Before joining room ${code.trim().toUpperCase()}`,
        campaignId: localStorage.getItem("quire.campaign.v1") || "main",
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
    const remote = await submitCloudCommands({
      data: {
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
async function stage(rethrow = false) {
  const s = requireSession();
  if (!s.pending.length) return;
  try {
    const remote = await submitCloudCommands({
      data: {
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
    const submit = () => view.live ? flush() : stage(true);
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
  input: CommandInput,
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
    if (input.kind !== "message" && !view.mine) throw new Error(`It is ${view.who}'s turn.`);
    if (s.pending.length >= 100) throw new Error("Submit your pending actions before adding more.");
    const command = commandSchema.parse({ ...input, id: crypto.randomUUID() });
    const seasonalPlan = input.kind === "trade-season-plan" || (input.kind === "downtime-plan" && input.advanceSeason);
    if (seasonalPlan && s.pending.length) throw Error("Submit or resolve pending actions before preparing authoritative seasonal rolls.");
    if (input.kind === "message" || seasonalPlan) {
      // Chat is independent of transaction turns; retain a failed message in the editor.
      const remote = await submitCloudCommands({
        data: {
          code: s.code,
          token: s.token,
          batchId: command.id,
          commands: [command],
        },
      });
      await accept(remote);
      return { status: "committed" };
    }
    if (!s.pending.length) await refresh();
    guard();
    const current = requireSession(),
      before = await economySnapshot();
    guard();
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
    if (!s.pending.length) await refresh();
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
          data: { code: s.code, token: s.token, live: mode === "live" },
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
    await detachTable(false);
  });
}
export function skipTableTurn() {
  return serial(async () => {
    const s = requireSession();
    await accept(await skipCloudTurn({ data: { code: s.code, token: s.token } }));
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
        data: { code: s.code, token: s.token, action, seatId, allowParty },
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
      data: { code: s.code, token: s.token, action: "leave", seatId: s.seatId },
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
    const remote = await submitCloudCommands({
      data: {
        code: s.code,
        token: s.token,
        batchId: command.id,
        commands: [command],
      },
    });
    await accept(remote);
  });
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
    const remote = await pullCloudTable({
      data: { code: member.code, token: member.token },
    });
    const role = remote.seats.find((s) => s.id === remote.seatId)?.role;
    if (!role || (role === "player" && !remote.purseIds.length) || remote.seatId !== member.seatId)
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
      reconciled.pending = (JSON.parse(remote.draft) as Command[]).filter(
        (c) => !remote.acknowledged.includes(c.id),
      );
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
  await detachTable(!(preserveDmCopy && session()?.role === "dm"));
}
