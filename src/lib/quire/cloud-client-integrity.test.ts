import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { applyCommand, commandSchema, tablePatch, type Command } from "./commands.ts";
import { sameCommand } from "./command-identity.ts";
import { emptyCloudTable, type CloudTable } from "./cloud.ts";
import { fromCopper, toCopper } from "./money.ts";

const source = readFileSync(new URL("./cloud-client.ts", import.meta.url), "utf8");
const give = (id: string, copper: number): Command => ({
  id,
  kind: "give",
  fromId: "hero",
  toId: "other",
  copper,
  holdingId: null,
  quantity: 0,
});
const table = (): CloudTable => ({
  ...emptyCloudTable(),
  purses: ["hero", "other"].map((id) => ({
    id,
    name: id,
    kind: "character" as const,
    coins: fromCopper(id === "hero" ? 1000 : 0),
  })),
});
const seat = {
  id: "player",
  token: "private-token",
  name: "Synthetic player",
  role: "player" as const,
  purseIds: ["hero"],
};
function acceptance(pending: Command[], acknowledged: string[], draft: Command[]) {
  const session = {
    userId: undefined as string | undefined,
    code: "TEST",
    token: seat.token,
    seatId: seat.id,
    role: seat.role,
    purseIds: seat.purseIds,
    pending,
    revision: 1,
    batchId: "original-batch",
  };
  const remote = {
    userId: undefined as string | undefined,
    code: "TEST",
    seatId: seat.id,
    revision: 2,
    table: table(),
    seats: [seat],
    purseIds: seat.purseIds,
    shopIds: [],
    acknowledged,
    draft: JSON.stringify(draft),
  };
  let displayed: ReturnType<typeof table> | undefined;
  let error = "";
  const view = { error: "" };
  const body = source.slice(
    source.indexOf("async function accept("),
    source.indexOf("async function refresh()"),
  );
  const accept = new Function(
    "requireSession",
    "applyCloudTable",
    "view",
    "rememberIncoming",
    "remember",
    "getSeat",
    "setSeat",
    "publish",
    "start",
    "applyCommand",
    "fail",
    "sameCommand",
    stripTypeScriptTypes(body) + "; return accept;",
  )(
    () => session,
    async (t: ReturnType<typeof table>) => {
      displayed = t;
    },
    view,
    async () => {},
    () => {},
    () => ({}),
    () => {},
    () => {},
    () => {},
    applyCommand,
    (e: Error) => {
      error = e.message;
      view.error = e.message;
    },
    sameCommand,
  );
  return { session, remote, accept, displayed: () => displayed, error: () => error };
}

test("actual acceptance drops acknowledged delayed drafts and hydrates the authoritative table", async () => {
  const a = give("already-committed", 100);
  const h = acceptance([a], [a.id], [a]);
  h.remote.table = applyCommand(h.remote.table, seat, a);
  await h.accept(h.remote);
  assert.deepEqual(h.session.pending, []);
  assert.equal(h.error(), "");
  assert.equal(toCopper(h.displayed()!.purses[1]!.coins), 100);
  assert.equal(h.displayed()!.ledger.length, 2);
});
test("actual acceptance unites another device's draft with this device's unsent action", async () => {
  const a = give("this-device", 100),
    b = give("other-device", 200);
  const h = acceptance([a], [], [b]);
  await h.accept(h.remote);
  assert.deepEqual(new Set(h.session.pending.map((c) => c.id)), new Set([a.id, b.id]));
  assert.equal(toCopper(h.displayed()!.purses[1]!.coins), 300);
  assert.equal(h.session.batchId, "original-batch");
});
test("actual commit acceptance restores only the other device's unsubmitted draft", async () => {
  const a = give("committed", 100),
    b = give("still-pending", 200);
  const h = acceptance([a], [a.id], [b]);
  h.remote.table = applyCommand(h.remote.table, seat, a);
  await h.accept(h.remote, true);
  assert.deepEqual(
    h.session.pending.map((c) => c.id),
    [b.id],
  );
  assert.equal(toCopper(h.displayed()!.purses[1]!.coins), 300);
  assert.equal(h.displayed()!.ledger.length, 4);
});
test("a lost subset-commit response gives remaining device drafts a fresh batch receipt", async () => {
  const a = give("committed", 100),
    b = give("still-pending", 200);
  const h = acceptance([a], [a.id], [b]);
  h.remote.table = applyCommand(h.remote.table, seat, a);
  await h.accept(h.remote);
  assert.deepEqual(
    h.session.pending.map((c) => c.id),
    [b.id],
  );
  assert.notEqual(h.session.batchId, "original-batch");
});
test("a conflicting same-ID draft remains recoverable and is never silently replaced", async () => {
  const h = acceptance([give("conflict", 100)], [], [give("conflict", 200)]);
  await h.accept(h.remote);
  assert.match(h.error(), /different changes/);
  assert.equal((h.session.pending[0] as Extract<Command, { kind: "give" }>).copper, 100);
});
test("actual acceptance keeps id-last client portrait pending without conflicting with its Zod server echo", async () => {
  const client: Command = {
    kind: "portrait",
    purseId: "hero",
    portrait: "data:image/png;base64,QUFB",
    id: "photo",
  };
  const h = acceptance([client], [], [commandSchema.parse(client)]);
  h.remote.table.purses[0]!.editingAllowed = true;
  await h.accept(h.remote);
  assert.equal(h.error(), "");
  assert.equal(h.session.pending.length, 1);
  assert.equal(h.displayed()!.purses[0]!.portrait, client.portrait);
});
test("a rebase failure preserves the original queue and revision for a later hydration retry", async () => {
  const h = acceptance([give("overspend", 2000)], [], []);
  await h.accept(h.remote);
  assert.match(h.error(), /Insufficient funds/);
  assert.equal(h.session.revision, 1);
  assert.deepEqual(
    h.session.pending.map((c) => c.id),
    ["overspend"],
  );
});

function storage() {
  const values = new Map<string, string>();
  const writes: string[] = [];
  return {
    values,
    writes,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
      writes.push(key);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
async function recoveryHarness(ephemeral = true, owner?: string) {
  const local = storage(),
    ticket = storage();
  if (owner) {
    ticket.setItem("lootsplit.verified-account", owner);
    local.setItem("quire.owner.main", owner);
  }
  const priorLocal = globalThis.localStorage,
    priorSession = globalThis.sessionStorage;
  Object.assign(globalThis, { localStorage: local, sessionStorage: ticket });
  const moduleUrl = new URL("./revoked-recovery.ts?test=" + crypto.randomUUID(), import.meta.url);
  const recovery = await import(moduleUrl.href);
  const refresh = source.slice(
    source.indexOf("async function refresh() {"),
    source.indexOf("export async function refreshShared()"),
  );
  const detach = source.slice(
    source.indexOf("async function detachTable("),
    source.indexOf("export async function leaveTable()"),
  );
  const recoveryFunctions = source
    .slice(
      source.indexOf("export async function exportRevokedPending("),
      source.indexOf("export function discardPending()"),
    )
    .replaceAll("export function", "function")
    .replaceAll("export async function", "async function");
  const downloads: any[] = [];
  const build = new Function(
    "original",
    "ephemeral",
    "recovery",
    "emptyCloudTable",
    "downloadJson",
    stripTypeScriptTypes(`function harness() {
    let playerSession=original;
    const session=()=>playerSession,key=()=>"quire.cloud.v2.main",isEphemeralCampaign=()=>ephemeral;
    const stopPolling=()=>{},polling=false,publish=()=>{},initialView={},PLAYER_TICKET="lootsplit.player.reconnect.v1";
    const warnUnsentPlayerActions=()=>{},applyCloudTable=async()=>{},setSeat=()=>{},notify=()=>{};
    const {rememberRevokedRecovery,revokedRecoveryCopy,discardRevokedRecovery,hasRevokedMemoryWork}=recovery;
    const pullCloudTable=async()=>{throw Error("This room is closed.");};
    ${detach}
    ${refresh}
    ${recoveryFunctions}
    return {refresh,session,exportRevokedPending,discardRevokedPending};
  }`) + "; return harness();",
  );
  const original = {
    userId: owner,
    code: "TEST",
    token: "must-never-export",
    seatId: "player",
    role: ephemeral ? "player" : "dm",
    pending: [give("failed-send", 100)],
    batchId: "stable-batch",
    revision: 1,
  };
  ticket.setItem("lootsplit.player.reconnect.v1", "credentials only");
  const client = build(
    original,
    ephemeral,
    recovery,
    emptyCloudTable,
    async (_name: string, payload: unknown) => {
      downloads.push(payload);
      return false;
    },
  );
  return {
    client,
    original,
    local,
    ticket,
    recovery,
    downloads,
    restore: () =>
      Object.assign(globalThis, { localStorage: priorLocal, sessionStorage: priorSession }),
  };
}

test("actual automatic revocation removes transport credentials but preserves token-free guest recovery only in memory", async () => {
  const h = await recoveryHarness();
  try {
    await h.client.refresh();
    assert.equal(h.client.session(), null);
    assert.equal(h.ticket.getItem("lootsplit.player.reconnect.v1"), null);
    assert.equal(h.local.writes.length, 0, "Guest campaign content is never persisted");
    const copies = h.recovery.revokedRecoverySummaries();
    assert.equal(copies.length, 1);
    const copy = h.recovery.revokedRecoveryCopy(copies[0].id);
    assert.equal(copy.batchId, "stable-batch");
    assert.deepEqual(copy.commands, h.original.pending);
    assert.equal("token" in copy, false);
    await h.client.exportRevokedPending(copy.id);
    assert.equal(JSON.stringify(h.downloads).includes(h.original.token), false);
    assert.equal(
      h.recovery.revokedRecoverySummaries().length,
      1,
      "Cancelled/failed export retains recovery",
    );
    await h.client.discardRevokedPending(copy.id);
    assert.equal(h.recovery.revokedRecoverySummaries().length, 0);
  } finally {
    h.restore();
  }
});
test("actual revoked DM recovery persists by owner/room/seat and reloads only for its verified account", async () => {
  const h = await recoveryHarness(false, "owner-a");
  try {
    await h.client.refresh();
    const copy = h.recovery.revokedRecoverySummaries()[0];
    const persistedKey = [...h.local.values.keys()].find((key) =>
      key.startsWith("quire.account-recovery.v1."),
    )!;
    assert.match(persistedKey, /account-owner-a-TEST\.player\.stable-batch/);
    assert.equal(JSON.stringify([...h.local.values.values()]).includes(h.original.token), false);
    h.ticket.removeItem("lootsplit.verified-account");
    assert.deepEqual(h.recovery.revokedRecoverySummaries(), []);
    await assert.rejects(h.client.exportRevokedPending(copy.id), /account that owns/);
    await assert.rejects(h.client.discardRevokedPending(copy.id), /account that owns/);
    h.ticket.setItem("lootsplit.verified-account", "owner-b");
    assert.deepEqual(h.recovery.revokedRecoverySummaries(), []);
    assert.ok(
      h.local.getItem(persistedKey),
      "Switching accounts does not erase owner A's recovery",
    );
    const reloaded = await import(
      new URL("./revoked-recovery.ts?reload=" + crypto.randomUUID(), import.meta.url).href
    );
    assert.deepEqual(reloaded.revokedRecoverySummaries(), []);
    h.ticket.setItem("lootsplit.verified-account", "owner-a");
    assert.equal(
      reloaded.revokedRecoverySummaries()[0].id,
      copy.id,
      "A fresh document restores its own durable copy",
    );
    await h.client.exportRevokedPending(copy.id);
    assert.equal(h.downloads[0].userId, "owner-a");
    await h.client.discardRevokedPending(copy.id);
    assert.equal(
      h.local.getItem(persistedKey),
      null,
      "Explicit own discard removes persistent recovery",
    );
  } finally {
    h.restore();
  }
});
test("account-linked guest memory recovery is hidden on sign-out/switch and never persisted", async () => {
  const h = await recoveryHarness(true, "owner-a");
  try {
    const before = h.local.writes.length;
    await h.client.refresh();
    const copy = h.recovery.revokedRecoverySummaries()[0];
    assert.equal(h.local.writes.length, before);
    h.ticket.setItem("lootsplit.verified-account", "owner-b");
    assert.deepEqual(h.recovery.revokedRecoverySummaries(), []);
    await assert.rejects(h.client.exportRevokedPending(copy.id), /account that owns/);
    h.ticket.setItem("lootsplit.verified-account", "owner-a");
    assert.equal(h.recovery.revokedRecoverySummaries()[0].id, copy.id);
  } finally {
    h.restore();
  }
});
test("a player queue keeps its original account owner when another account signs in before revocation", async () => {
  const h = await recoveryHarness(true, "owner-a");
  try {
    const before = h.local.writes.length;
    h.ticket.setItem("lootsplit.verified-account", "owner-b");
    await h.client.refresh();
    assert.deepEqual(
      h.recovery.revokedRecoverySummaries(),
      [],
      "B cannot see A's rejected offline queue",
    );
    assert.equal(h.local.writes.length, before, "Player queues remain in memory");
    h.ticket.setItem("lootsplit.verified-account", "owner-a");
    const copy = h.recovery.revokedRecoverySummaries()[0];
    assert.equal(h.recovery.revokedRecoveryCopy(copy.id).userId, "owner-a");
    h.ticket.setItem("lootsplit.verified-account", "owner-b");
    await assert.rejects(h.client.exportRevokedPending(copy.id), /account that owns/);
    await assert.rejects(h.client.discardRevokedPending(copy.id), /account that owns/);
  } finally {
    h.restore();
  }
});
test("an initially anonymous guest queue is not relabeled as the later signed-in account", async () => {
  const h = await recoveryHarness();
  try {
    h.ticket.setItem("lootsplit.verified-account", "owner-b");
    await h.client.refresh();
    const copy = h.recovery.revokedRecoverySummaries()[0];
    assert.equal(h.recovery.revokedRecoveryCopy(copy.id).userId, undefined);
    assert.equal(h.local.writes.length, 0);
  } finally {
    h.restore();
  }
});
test("actual acceptance captures canonical seat identity before pending work and rejects a changed owner", async () => {
  const h = acceptance([give("original", 100)], [], []);
  h.remote.userId = "owner-a";
  await h.accept(h.remote);
  assert.equal(h.session.userId, "owner-a");
  h.remote.userId = "owner-b";
  await assert.rejects(h.accept(h.remote), /different account/);
  assert.equal(h.session.userId, "owner-a");
  assert.deepEqual(
    h.session.pending.map((c) => c.id),
    ["original"],
  );
});
test("full device storage retains revoked account work in memory instead of retaining transport access", async () => {
  const h = await recoveryHarness(false, "owner-a");
  try {
    h.local.setItem = () => {
      throw Error("Storage full");
    };
    await h.client.refresh();
    const copy = h.recovery.revokedRecoverySummaries()[0];
    assert.deepEqual(h.recovery.revokedRecoveryCopy(copy.id).commands, h.original.pending);
    assert.equal(h.recovery.hasRevokedMemoryWork(), true);
    assert.equal(
      [...h.local.values.keys()].some((key) => key.startsWith("quire.account-recovery.v1.")),
      false,
    );
    await h.client.exportRevokedPending(copy.id);
    assert.equal(h.downloads.length, 1);
  } finally {
    h.restore();
  }
});
test("legacy unscoped records stay untouched until authenticated DM campaign ownership is verified", async () => {
  const h = await recoveryHarness(false, "owner-a");
  try {
    const key = "lootsplit.revoked-recovery:LEGACY";
    const unowned = "lootsplit.revoked-recovery:UNRELATED";
    const legacy = JSON.stringify({
      code: "LEGACY",
      commands: h.original.pending,
      exportedAt: 1,
      token: "do-not-export",
    });
    h.local.setItem(key, legacy);
    h.local.setItem(unowned, JSON.stringify({ code: "UNRELATED", commands: h.original.pending }));
    assert.equal(h.recovery.legacyRecoveryCount(), 2);
    assert.deepEqual(h.recovery.revokedRecoverySummaries(), []);
    h.recovery.authorizeLegacyRecovery("owner-a", [{ code: "UNRELATED", role: "player" }]);
    assert.equal(
      h.recovery.legacyRecoveryCount(),
      2,
      "Player or same-name information grants no old DM recovery access",
    );
    h.recovery.authorizeLegacyRecovery("owner-a", [{ code: "LEGACY", role: "dm" }]);
    const copy = h.recovery.revokedRecoverySummaries()[0];
    assert.equal(h.recovery.legacyRecoveryCount(), 1);
    assert.equal(h.local.getItem(key), legacy, "Verification does not alter the old record");
    await h.client.exportRevokedPending(copy.id);
    assert.equal(JSON.stringify(h.downloads).includes("do-not-export"), false);
    assert.ok(h.local.getItem(unowned));
    await h.client.discardRevokedPending(copy.id);
    assert.equal(h.local.getItem(key), null);
    assert.ok(h.local.getItem(unowned), "Unverified records remain preserved");
  } finally {
    h.restore();
  }
});

test("actual account authentication clears old recovery identity before announcing account changes", async () => {
  const accountSource = readFileSync(new URL("../account/client.ts", import.meta.url), "utf8");
  const body = accountSource.slice(
    accountSource.indexOf("async function accountRequestCore"),
    accountSource.indexOf("export type AccountLibrary"),
  );
  const build = new Function(
    "native",
    "localStorage",
    "sessionStorage",
    "fetch",
    "window",
    "announceSheetChange",
    "API_ORIGIN",
    "TOKEN",
    "let identityRead; " + stripTypeScriptTypes(body) + ";return accountRequestCore;",
  );
  for (const path of ["auth/sign-in/email", "auth/sign-up/email", "auth/sign-out"]) {
    const local = storage(),
      session = storage();
    session.setItem("lootsplit.verified-account", "previous-owner");
    let changed = false;
    const request = build(
      () => false,
      local,
      session,
      async () => Response.json({ user: { id: "next-owner" } }),
      {
        dispatchEvent: (event: Event) => {
          assert.equal(event.type, "lootsplit-account-changed");
          assert.equal(
            session.getItem("lootsplit.verified-account"),
            null,
            "Previous account access is revoked before subscribers render",
          );
          changed = true;
        },
      },
      () => {},
      "",
      "token",
    );
    await request(path, {});
    assert.equal(changed, true);
  }
});

// Execute the real queue/flush/stage/accept functions while replacing only
// storage, network, and IndexedDB boundaries. JSON session reads reproduce a
// returning DM's persisted cache rather than sharing an in-memory object.
function outcomeHarness({ live = true, lostResponse = false, hydrationFailure = false } = {}) {
  let serialized = JSON.stringify({
    code: "TEST",
    token: seat.token,
    seatId: "dm",
    role: "dm",
    purseIds: [],
    pending: [],
    revision: 1,
    sessionId: "original-generation",
    batchId: "outcome-batch",
  });
  let local = table(),
    authoritative = table(),
    submissions = 0,
    revision = 1;
  let error = "",
    hydrationAttempts = 0;
  let deviceScope = {
    campaignId: "main",
    databaseName: "quire",
    accountId: "synthetic-owner",
    ephemeral: false,
  };
  let duringRefresh: (() => void | Promise<void>) | undefined;
  let duringSnapshot: (() => void | Promise<void>) | undefined;
  const view = {
    mine: true,
    who: "Synthetic DM",
    live,
    viewOnly: false,
    seats: [{ ...seat, id: "dm", role: "dm" }],
    error: "",
  };
  const session = () => JSON.parse(serialized);
  const remember = (s: unknown) => {
    serialized = JSON.stringify(s);
  };
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const result = chain.then(fn);
    chain = result.catch(() => undefined);
    return result;
  };
  const applyCloudTable = async (next: CloudTable) => {
    hydrationAttempts++;
    if (hydrationFailure && hydrationAttempts === 1)
      throw Error("Synthetic hydration interruption");
    local = structuredClone(next);
  };
  const submitCloudCommands = async ({
    data,
  }: {
    data: { commands: Command[]; stage?: boolean };
  }) => {
    submissions++;
    if (!data.stage) {
      for (const command of data.commands)
        authoritative = applyCommand(authoritative, { ...seat, id: "dm", role: "dm" }, command);
      revision++;
    }
    if (lostResponse) throw Error("Synthetic lost response");
    return {
      code: session().code,
      sessionId: session().sessionId,
      seatId: "dm",
      revision,
      table: authoritative,
      seats: view.seats,
      purseIds: [],
      shopIds: [],
      acknowledged: data.stage ? [] : data.commands.map((c) => c.id),
      draft: JSON.stringify(data.stage ? data.commands : []),
      mine: true,
      live,
      who: "Synthetic DM",
    };
  };
  const body = [
    source.slice(
      source.indexOf("export type MutationScope"),
      source.indexOf("function requireSession()"),
    ),
    source.slice(
      source.indexOf("async function accept("),
      source.indexOf("async function refresh()"),
    ),
    source.slice(
      source.indexOf("async function flush("),
      source.indexOf("export function endTableTurn()"),
    ),
    source.slice(
      source.indexOf("export async function queueCommand("),
      source.indexOf("export function chooseTableMode("),
    ),
  ]
    .join("\n")
    .replaceAll("export async function", "async function")
    .replaceAll("export function", "function");
  const functions = new Function(
    "captureDeviceMutationScope",
    "session",
    "requireSession",
    "remember",
    "view",
    "serial",
    "refresh",
    "economySnapshot",
    "applyCloudTable",
    "submitCloudCommands",
    "applyCommand",
    "commandSchema",
    "tablePatch",
    "fail",
    "publish",
    "rememberIncoming",
    "getSeat",
    "setSeat",
    "start",
    "sameCommand",
    stripTypeScriptTypes(body) +
      "; return {queueCommand, runSharedMutation, captureMutationScope};",
  )(
    () => Object.freeze({ ...deviceScope }),
    session,
    session,
    remember,
    view,
    serial,
    async () => {
      await duringRefresh?.();
    },
    async () => {
      await duringSnapshot?.();
      return structuredClone(local);
    },
    applyCloudTable,
    submitCloudCommands,
    applyCommand,
    commandSchema,
    tablePatch,
    (e: Error) => {
      error = e.message;
      view.error = error;
    },
    (patch: object) => Object.assign(view, patch),
    async () => {},
    () => ({}),
    () => {},
    () => {},
    sameCommand,
  );
  return {
    ...functions,
    session,
    submissions: () => submissions,
    error: () => error,
    local: () => local,
    authoritative: () => authoritative,
    edit: () => {
      local.purses[0]!.coins = fromCopper(1200);
    },
    serial,
    onRefresh: (work: () => void | Promise<void>) => {
      duringRefresh = work;
    },
    onSnapshot: (work: () => void | Promise<void>) => {
      duringSnapshot = work;
    },
    retarget: (
      change: Partial<typeof deviceScope> & {
        code?: string;
        seatId?: string;
        token?: string;
        sessionId?: string;
      },
    ) => {
      const { code, seatId, token, sessionId, ...device } = change;
      deviceScope = { ...deviceScope, ...device };
      const s = session();
      if (code !== undefined) s.code = code;
      if (seatId !== undefined) s.seatId = seatId;
      if (token !== undefined) s.token = token;
      if (sessionId !== undefined) s.sessionId = sessionId;
      remember(s);
    },
  };
}
test("real Live DM queue reports committed from the updated JSON cache and applies once", async () => {
  const h = outcomeHarness();
  assert.deepEqual(
    await h.queueCommand({
      kind: "give",
      fromId: "hero",
      toId: "other",
      copper: 100,
      holdingId: null,
      quantity: 0,
    }),
    { status: "committed" },
  );
  assert.equal(h.session().pending.length, 0);
  assert.equal(h.submissions(), 1);
  assert.equal(toCopper(h.local().purses[1]!.coins), 100);
  assert.equal(h.authoritative().ledger.length, 2);
});
test("real Turn-based stage reports pending without claiming the preview was committed", async () => {
  const h = outcomeHarness({ live: false });
  assert.deepEqual(
    await h.queueCommand({
      kind: "give",
      fromId: "hero",
      toId: "other",
      copper: 100,
      holdingId: null,
      quantity: 0,
    }),
    { status: "pending" },
  );
  assert.equal(h.session().pending.length, 1);
  assert.equal(h.submissions(), 1);
  assert.equal(toCopper(h.local().purses[1]!.coins), 100);
  assert.equal(toCopper(h.authoritative().purses[1]!.coins), 0);
});
test("real lost stage and flush responses preserve their exact accepted command as pending", async () => {
  for (const live of [false, true]) {
    const h = outcomeHarness({ live, lostResponse: true });
    assert.deepEqual(
      await h.queueCommand({
        kind: "give",
        fromId: "hero",
        toId: "other",
        copper: 100,
        holdingId: null,
        quantity: 0,
      }),
      { status: "pending" },
    );
    assert.equal(h.session().pending.length, 1);
    assert.equal(h.session().pending[0].copper, 100);
    assert.match(h.error(), /lost response/);
    assert.equal(h.submissions(), 1);
  }
});
test("real hydration interruption after retention reports recoverable pending without submitting again", async () => {
  const h = outcomeHarness({ hydrationFailure: true });
  assert.deepEqual(
    await h.queueCommand({
      kind: "give",
      fromId: "hero",
      toId: "other",
      copper: 100,
      holdingId: null,
      quantity: 0,
    }),
    { status: "pending" },
  );
  assert.equal(h.session().pending.length, 1);
  assert.equal(h.submissions(), 0);
  assert.match(h.error(), /hydration interruption/);
  assert.equal(toCopper(h.local().purses[1]!.coins), 0);
});
test("real serialized valid and invalid commands never mistake another command for acceptance", async () => {
  const h = outcomeHarness({ live: false });
  const valid = h.queueCommand({
    kind: "give",
    fromId: "hero",
    toId: "other",
    copper: 100,
    holdingId: null,
    quantity: 0,
  });
  const invalid = h.queueCommand({
    kind: "give",
    fromId: "hero",
    toId: "other",
    copper: 2000,
    holdingId: null,
    quantity: 0,
  });
  assert.deepEqual(await valid, { status: "pending" });
  await assert.rejects(invalid, /Insufficient funds/);
  assert.equal(h.session().pending.length, 1);
  assert.equal(h.session().pending[0].copper, 100);
  assert.equal(h.submissions(), 1);
});
test("real DM shared mutations use their own patch receipt for committed versus staged status", async () => {
  for (const live of [false, true]) {
    const h = outcomeHarness({ live });
    assert.deepEqual(await h.runSharedMutation(async () => h.edit()), {
      status: live ? "committed" : "pending",
    });
    assert.equal(h.session().pending.length, live ? 0 : 1);
    assert.equal(
      toCopper(h.local().purses.find((p: { id: string }) => p.id === "hero")!.coins),
      1200,
    );
    assert.equal(
      toCopper(h.authoritative().purses.find((p: { id: string }) => p.id === "hero")!.coins),
      live ? 1200 : 1000,
    );
  }
});

test("real queued action rejects after an earlier resumed campaign changes its execution target", async () => {
  const h = outcomeHarness();
  let release!: () => void;
  const prior = h.serial(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    h.retarget({
      campaignId: "other",
      databaseName: "quire-other",
      code: "NEXT",
      seatId: "new-seat",
      token: "new-private-token",
      sessionId: "new-generation",
    });
  });
  await Promise.resolve();
  const action = h.queueCommand({
    kind: "give",
    fromId: "hero",
    toId: "other",
    copper: 100,
    holdingId: null,
    quantity: 0,
  });
  release();
  await prior;
  await assert.rejects(action, /campaign or seat changed/);
  assert.equal(h.submissions(), 0);
  assert.equal(h.session().pending.length, 0);
  assert.equal(toCopper(h.local().purses[1]!.coins), 0);
});
test("real queue rechecks authoritative storage, account and credentials after refresh and snapshot", async () => {
  for (const phase of ["refresh", "snapshot"] as const) {
    for (const changed of [
      { databaseName: "quire-mapped-elsewhere" },
      { accountId: "another-owner" },
      { token: "revoked-private-token" },
      { sessionId: "reopened-generation" },
    ]) {
      const h = outcomeHarness();
      const change = () => h.retarget(changed);
      if (phase === "refresh") h.onRefresh(change);
      else h.onSnapshot(change);
      await assert.rejects(
        h.queueCommand({
          kind: "give",
          fromId: "hero",
          toId: "other",
          copper: 100,
          holdingId: null,
          quantity: 0,
        }),
        /changed before this action/,
      );
      assert.equal(h.submissions(), 0);
      assert.equal(h.session().pending.length, 0);
      assert.equal(toCopper(h.local().purses[1]!.coins), 0);
    }
  }
});
test("real explicit reviewed scope rejects an older target even when invocation is already in the new room", async () => {
  const h = outcomeHarness();
  const reviewed = h.captureMutationScope();
  assert.equal("token" in reviewed, false);
  h.retarget({ code: "NEXT", sessionId: "new-generation" });
  await assert.rejects(
    h.queueCommand(
      { kind: "give", fromId: "hero", toId: "other", copper: 100, holdingId: null, quantity: 0 },
      reviewed,
    ),
    /campaign or seat changed/,
  );
  assert.equal(h.submissions(), 0);
  assert.equal(h.session().pending.length, 0);
});

test("real legacy cache with unknown invitation generation learns it without rejecting the first same-seat action", async () => {
  const h = outcomeHarness();
  h.retarget({ sessionId: "" });
  h.onRefresh(() => h.retarget({ sessionId: "learned-generation" }));
  assert.deepEqual(
    await h.queueCommand({
      kind: "give",
      fromId: "hero",
      toId: "other",
      copper: 100,
      holdingId: null,
      quantity: 0,
    }),
    { status: "committed" },
  );
  assert.equal(h.submissions(), 1);
  assert.equal(h.session().pending.length, 0);
  assert.equal(toCopper(h.local().purses[1]!.coins), 100);
});

test("real shared mutation rejects a queued target switch before invoking its work", async () => {
  const h = outcomeHarness();
  let release!: () => void,
    worked = false;
  const prior = h.serial(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    h.retarget({ databaseName: "quire-other", code: "NEXT", token: "next-private-token" });
  });
  await Promise.resolve();
  const action = h.runSharedMutation(async () => {
    worked = true;
    h.edit();
  });
  release();
  await prior;
  await assert.rejects(action, /campaign or seat changed/);
  assert.equal(worked, false);
  assert.equal(h.submissions(), 0);
  assert.equal(h.session().pending.length, 0);
  assert.equal(
    toCopper(h.local().purses.find((p: { id: string }) => p.id === "hero")!.coins),
    1000,
  );
});
