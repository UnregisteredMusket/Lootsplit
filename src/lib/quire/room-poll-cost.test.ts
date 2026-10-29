import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { applyCommand, type Command } from "./commands.ts";
import { sameCommand } from "./command-identity.ts";
import { emptyCloudTable } from "./cloud.ts";
import { fromCopper } from "./money.ts";
import { readRoomResponse, readUnchangedRoom } from "./room-response.ts";

// P6 (October 22 review): room polling cost on phones. These tests run the real
// publish/getCloudTable/accept/refresh source against stubbed transport, as the
// other cloud-client harnesses do, so they exercise the shipped code paths.
const source = readFileSync(new URL("./cloud-client.ts", import.meta.url), "utf8");
const slice = (from: string, to: string) => {
  const start = source.indexOf(from),
    end = source.indexOf(to);
  assert.ok(start >= 0 && end > start, `${from} … ${to}`);
  return source.slice(start, end).replace(/^export /gm, "");
};
const store = slice("let seenRecovery", "export function refreshRecoveryVisibility()");
const failure = slice("function fail(", "function warnUnsentPlayerActions(");
const conflictOpen = slice("function previewConflictOpen()", "export function hasPendingChanges()");
const network = slice("async function accept(", "export async function refreshShared()");

const seat = {
  id: "player",
  token: "private-token",
  name: "Synthetic player",
  role: "player" as const,
};
// Offline turn-based queue: sell one sword the DM has since sold.
const sell: Command = {
  id: "queued-sell",
  kind: "sell",
  holdingId: "sword",
  shopId: "smith",
  quantity: 1,
} as Command;
const roomTable = () => ({
  ...emptyCloudTable(),
  purses: [{ id: "hero", name: "hero", kind: "character" as const, coins: fromCopper(1000) }],
});

function harness() {
  const session = {
    code: "TEST",
    token: seat.token,
    seatId: seat.id,
    role: seat.role,
    purseIds: ["hero"],
    pending: [sell],
    revision: 4,
    batchId: "offline-batch",
  };
  const counts = { pulls: 0, polls: 0, fails: 0, shown: 0, notified: 0, reloads: 0, applied: 0 };
  let serverRevision = 5;
  const faults: { poll?: () => Error; pull?: () => Error } = {};
  const remote = () => ({
    code: "TEST",
    seatId: seat.id,
    revision: serverRevision,
    turn: 0,
    mine: true,
    who: seat.name,
    live: false,
    encounterActive: false,
    table: roomTable(),
    seats: [{ ...seat, purseIds: ["hero"], pending: 0, allowParty: false }],
    purseIds: ["hero"],
    shopIds: [],
    acknowledged: [],
    draft: "[]",
  });
  const recovery = Object.freeze({
    recoveries: [],
    unverifiedRecoveries: 0,
    legacyRecoveryChecked: false,
  });
  const client = new Function(
    "deps",
    stripTypeScriptTypes(`
      const {session:sessionValue,counts,remote,recovery,readRoomResponse,readUnchangedRoom,applyCommand,sameCommand,faults}=deps;
      let acceptedPoll;
      const noteRoomView=()=>{},mergeHistory=(t)=>t; // no older history loaded
      const listeners=new Set();
      let view={joined:false,mine:true,live:false,who:"",code:"",sessionId:"",role:"dm",seats:[],departed:[],
        testMode:false,viewOnly:false,encounterActive:undefined,revision:0,seatId:"",pending:0,staged:0,
        status:"local",error:"",lastSync:0,recoveries:[],unverifiedRecoveries:0,legacyRecoveryChecked:false};
      const session=()=>sessionValue;
      const key=()=>"quire.cloud.v2.synthetic",requireSession=()=>sessionValue,remember=()=>{},
        getSeat=()=>({}),setSeat=()=>{},start=()=>{},notify=()=>{},rememberIncoming=async()=>{},
        recoveryVisibility=()=>recovery,isEphemeralCampaign=()=>false,detachTable=async()=>{},
        rememberRevokedRecovery=()=>{};
      const applyCloudTable=async()=>{counts.applied++;};
      const setCloudWatch=(_w,dataChanged)=>{if(dataChanged)counts.reloads++;};
      const pullCloudTable=async()=>{counts.pulls++;if(faults.pull)throw faults.pull();return remote();};
      const pollCloudTable=async({data})=>{counts.polls++;if(faults.poll)throw faults.poll();const r=remote();
        return data.knownRevision===r.revision?{unchanged:true,protocol:"lootsplit.room.unchanged.v1",
          code:r.code,seatId:r.seatId,revision:r.revision,encounterActive:false}:r;};
      ${store.replace("let seenRecovery", "var seenRecovery").replace("function publish(", "function storePublish(")}
      // Count attention announcements: publish({status:"attention",error}) alone.
      const publish=(next,dataChanged)=>{
        if(Object.keys(next).join()==="status,error"&&next.status==="attention")counts.shown++;
        return storePublish(next,dataChanged);};
      ${failure.replace("function fail(", "function shownFailure(")}
      const fail=(error)=>{counts.fails++;return shownFailure(error);};
      ${conflictOpen}
      ${network}
    `) +
      `;return {accept,refresh,publish,getCloudTable,previewConflictOpen,
        subscribe:(fn)=>{listeners.add(fn);return()=>listeners.delete(fn);},
        view:()=>view,acceptedPoll:()=>acceptedPoll};`,
  )({
    session,
    counts,
    remote,
    recovery,
    readRoomResponse,
    readUnchangedRoom,
    applyCommand,
    sameCommand,
    faults,
  });
  return {
    client,
    session,
    counts,
    faults,
    advance: () => {
      serverRevision++;
    },
  };
}

test("an unchanged poll keeps the snapshot identity and notifies no subscriber", async () => {
  const h = harness();
  h.session.pending = [];
  await h.client.refresh();
  const snapshot = h.client.getCloudTable();
  let notified = 0;
  h.client.subscribe(() => notified++);
  for (let i = 0; i < 5; i++) await h.client.refresh(true);
  assert.equal(h.counts.polls, 5, "every 2 s tick is a conditional poll");
  assert.equal(h.counts.pulls, 1, "only the first read is a full room read");
  assert.equal(notified, 0, "unchanged polls must not wake React subscribers");
  assert.equal(h.client.getCloudTable(), snapshot, "useSyncExternalStore sees the same object");
  assert.equal(h.client.getCloudTable(), h.client.getCloudTable());
  // A real room change still reaches every subscriber (both split-view panes).
  h.advance();
  await h.client.refresh(true);
  assert.equal(notified, 1);
  assert.notEqual(h.client.getCloudTable(), snapshot);
  assert.equal(h.client.getCloudTable().revision, 6);
});

test("publishing identical readouts twice notifies once", () => {
  const h = harness();
  let notified = 0;
  h.client.subscribe(() => notified++);
  h.client.publish({ status: "attention", error: "Offline" }, false);
  const first = h.client.getCloudTable();
  h.client.publish({ status: "attention", error: "Offline" }, false);
  assert.equal(notified, 1);
  assert.equal(h.client.getCloudTable(), first);
});

test("a pending sell the DM already sold is surfaced once, polls stay conditional and nothing reloads", async () => {
  const h = harness();
  await h.client.refresh();
  assert.equal(h.counts.shown, 1, "the conflict is shown");
  assert.equal(h.client.view().status, "attention");
  assert.ok(h.client.view().error);
  assert.equal(h.session.revision, 4, "the device keeps its last hydrated revision");
  assert.equal(h.counts.applied, 0, "nothing was written to the device table");
  assert.equal(h.counts.reloads, 0, "a failed preview does not reload the economy");
  assert.equal(h.client.previewConflictOpen(), true, "the poll loop backs off");

  const before = { ...h.counts };
  let notified = 0;
  h.client.subscribe(() => notified++);
  for (let i = 0; i < 5; i++) await h.client.refresh(true);
  assert.equal(h.counts.pulls, before.pulls, "no full room read while the room is unchanged");
  assert.equal(h.counts.polls, 5);
  assert.equal(h.counts.shown, 1, "the conflict is not re-announced");
  assert.equal(h.counts.reloads, 0);
  assert.equal(notified, 0);
  assert.equal(h.client.view().status, "attention", "attention stays visible");

  // A newer room revision is read and previewed again; the same conflict for the
  // same batch keeps its attention without another announcement or reload.
  h.advance();
  await h.client.refresh(true);
  assert.equal(h.counts.polls, 6, "the conditional poll itself returns the newer room");
  assert.equal(h.client.view().revision, 6);
  assert.equal(h.counts.shown, 1);
  assert.equal(h.counts.reloads, 0);
  assert.equal(h.session.revision, 4);
  assert.deepEqual(h.session.pending, [sell], "pending work is retained");

  // New local work is a new batch: it is previewed and, if it still conflicts, shown again.
  h.session.batchId = "new-batch";
  assert.equal(h.client.previewConflictOpen(), false);
  await h.client.refresh(true);
  assert.equal(h.counts.pulls, before.pulls + 1, "a different batch is re-read in full");
  assert.equal(h.counts.shown, 2);

  // Discarding the queue hydrates the authoritative room and clears the conflict.
  h.session.pending = [];
  await h.client.accept(harnessRemote(h), true);
  assert.equal(h.counts.applied, 1);
  assert.equal(h.counts.reloads, 1);
  assert.equal(h.client.previewConflictOpen(), false);
  assert.equal(h.client.view().status, "synced");
});

function harnessRemote(h: ReturnType<typeof harness>) {
  return {
    code: "TEST",
    seatId: seat.id,
    revision: 6,
    turn: 0,
    mine: true,
    who: seat.name,
    live: false,
    table: roomTable(),
    seats: [{ ...seat, purseIds: ["hero"], pending: 0, allowParty: false }],
    purseIds: h.session.purseIds,
    shopIds: [],
    acknowledged: [],
    draft: "[]",
  };
}

test("the shipped poll loop backs off while a preview conflict is open", () => {
  const loop = slice("function start()", "async function accept(");
  assert.match(
    loop,
    /pollFailures = previewConflictOpen\(\) \? Math\.min\(4, pollFailures \+ 1\) : 0;/,
  );
});

// 2026-10-28 load audit, F13: a failed conditional poll falls back to a full read only for an
// older edge/client protocol, never for rate limits, server errors, outages or ended access.
test("a failed poll is reported as is; only a protocol mismatch falls back to one full read", async () => {
  const h = harness();
  h.session.pending = [];
  await h.client.refresh();
  assert.equal(h.counts.pulls, 1);
  for (const failure of [
    () => Object.assign(Error("Too many requests. Wait a moment and try again."), { status: 429 }),
    () => Error("D1_ERROR: Network connection lost."),
    () => Error("<html><title>Worker exceeded resource limits</title></html>"),
    () => new TypeError("Failed to fetch"),
  ]) {
    h.faults.poll = failure;
    await assert.rejects(h.client.refresh(true));
  }
  assert.equal(h.counts.polls, 4);
  assert.equal(h.counts.pulls, 1, "no full read doubles the load during an outage");
  for (const failure of [
    () => Error("Server function info not found for 6c1f"),
    () => new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"),
    () => Error("Not Found"),
  ]) {
    h.faults.poll = failure;
    await h.client.refresh(true);
  }
  assert.equal(h.counts.pulls, 4, "each protocol mismatch reads the room once in full");
  delete h.faults.poll;
  await h.client.refresh(true);
  assert.equal(h.counts.pulls, 4, "a working poll is conditional again");
});

// F7: pre-action and focus refreshes ask the conditional poll first.
test("pre-action and window-focus refreshes are conditional", () => {
  const queue = source.slice(source.indexOf("export async function queueCommand("), source.indexOf("export async function queueCommandBatch("));
  const mutation = source.slice(source.indexOf("export function runSharedMutation("));
  assert.match(queue, /if \(!s\.pending\.length\) await refresh\(true\);/);
  assert.match(mutation.slice(0, 1500), /if \(!s\.pending\.length\) await refresh\(true\);/);
  assert.match(source, /export async function refreshSharedIfChanged\(\) \{\s*return serial\(\(\) => refresh\(true\)\);/);
  const context = readFileSync(new URL("./economy-context.tsx", import.meta.url), "utf8");
  assert.match(context, /window\.addEventListener\("focus", refresh\)/);
  assert.match(context, /if \(getCloudWatch\(\)\.joined\) await refreshSharedIfChanged\(\);/);
});
