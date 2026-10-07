import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const clientURL = new URL("../src/lib/quire/cloud-client.ts", import.meta.url);
const exportsByFile = {
  "cloud.ts": ["emptyCloudTable"],
  "navigation-launch.ts": ["reloadCampaignContext"],
  "saves.ts": ["rememberSave"],
  "lock.ts": ["loadSeatLock"],
  "notify.ts": ["notify"],
  "cloud-api.ts": ["closeCloudTable", "joinCloudTable", "openCloudTable", "previewCloudTable", "pullCloudTable", "setCloudPace", "skipCloudTurn", "submitCloudCommands", "manageCloudRoom"],
  "cloud-turn.ts": ["setCloudWatch"],
  "economy.ts": ["applyCloudTable", "economySnapshot", "snapshot"],
  "table.ts": ["getSeat", "setSeat", "downloadJson"],
  "commands.ts": ["applyCommand", "tablePatch"],
  "chat.ts": ["rememberIncoming"],
  "guest-storage.ts": ["isEphemeralCampaign", "setEphemeralCampaign"],
  "db.ts": ["closeQuireDb"],
  campaigns: ["selectAccountCampaign"],
};
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
    values,
  };
}
let serial = 0;
async function fixture() {
  const id = ++serial;
  const local = storage(), tab = storage();
  const member = { userId: "test-user", code: "ABCDEFGH", token: "test-token", seatId: "test-seat", role: "dm", purseIds: [], name: "Synthetic campaign" };
  tab.setItem("lootsplit.verified-account", member.userId);
  const target = `account-${member.userId}-${member.code}`;
  const targetKey = `quire.cloud.v2.${target}`;
  const cached = { ...member, revision: 5, pending: [{ id: "action-1", kind: "patch", changes: [] }], batchId: "original-batch" };
  const remote = { code: member.code, seatId: member.seatId, revision: 9, seats: [{ id: member.seatId, name: "DM", role: "dm", pending: 0 }], purseIds: [], shopIds: [], acknowledged: [], draft: "[]", live: true, mine: true, who: "everyone", table: { value: "authoritative", notes: [] } };
  const calls = { pulls: 0, selected: [], applied: [], reloads: 0, submissions: 0, locks: [] };
  let ephemeral = false;
  const mocks = Object.fromEntries(Object.values(exportsByFile).flat().map((name) => [name, () => { throw Error(`Unexpected dependency: ${name}`); }]));
  Object.assign(mocks, {
    pullCloudTable: async () => { calls.pulls++; return structuredClone(remote); },
    applyCloudTable: async (table) => { calls.applied.push(structuredClone(table)); },
    applyCommand: (table, _seat, _command) => ({ ...table, preview: true }),
    selectAccountCampaign: (campaignId) => { calls.selected.push(campaignId); local.setItem("quire.campaign.v1", campaignId); },
    reloadCampaignContext: () => { calls.reloads++; },
    isEphemeralCampaign: () => ephemeral,
    setEphemeralCampaign: (value) => { ephemeral = value; },
    closeQuireDb: () => {},
    getSeat: () => ({ role: "dm", purseIds: [], shopIds: [] }),
    setSeat: () => {},
    setCloudWatch: () => {},
    notify: () => {},
    rememberIncoming: async () => {},
    submitCloudCommands: async () => { calls.submissions++; throw Error("Resume must not submit actions"); },
  });
  const descriptors = new Map();
  for (const [name, value] of Object.entries({
    localStorage: local,
    sessionStorage: tab,
    window: { addEventListener() {}, removeEventListener() {} },
    navigator: { onLine: true, locks: { request: async (key, _options, run) => { calls.locks.push(key); return run({ name: key }); } } },
    document: { visibilityState: "hidden" },
    // Do not start real polling timers in this dependency-isolated client test.
    setTimeout: () => 1,
    clearTimeout: () => {},
    __resumeMocks: mocks,
  })) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.startsWith(clientURL.href) && specifier.startsWith("./")) {
        const filename = specifier.slice(2);
        if (exportsByFile[filename]) return { shortCircuit: true, url: `resume-mock:${id}:${filename}` };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith(`resume-mock:${id}:`)) {
        const names = exportsByFile[url.slice(`resume-mock:${id}:`.length)];
        return { shortCircuit: true, format: "module", source: names.map((name) => `export const ${name} = (...args) => globalThis.__resumeMocks.${name}(...args);`).join("\n") };
      }
      return nextLoad(url, context);
    },
  });
  const client = await import(`${clientURL.href}?fixture=${id}`);
  return { client, member, remote, cached, targetKey, local, tab, mocks, calls, close() { hooks.deregister(); for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } } };
}

test("account resume opens already-acknowledged Live actions without resubmitting", async () => {
  const f = await fixture();
  try {
    f.local.setItem(f.targetKey, JSON.stringify(f.cached));
    f.remote.acknowledged = ["action-1"];
    await f.client.resumeAccountMembership(f.member);
    assert.equal(f.calls.reloads, 1);
    assert.equal(f.calls.submissions, 0);
    assert.deepEqual(JSON.parse(f.local.getItem(f.targetKey)).pending, []);
  } finally { f.close(); }
});

test("unrelated current campaign actions remain protected", async () => {
  const f = await fixture();
  try {
    const raw = JSON.stringify({ ...f.cached, code: "OTHER123" });
    f.local.setItem("quire.cloud.v2.main", raw);
    await assert.rejects(f.client.resumeAccountMembership(f.member), /pending|unsynced/i);
    assert.equal(f.local.getItem("quire.cloud.v2.main"), raw);
    assert.equal(f.calls.pulls, 0);
    assert.equal(f.calls.reloads, 0);
  } finally { f.close(); }
});

function savedSession(f) { return JSON.parse(f.local.getItem(f.targetKey)); }
function recoveries(f) { return [...f.local.values.entries()].filter(([key]) => key.startsWith("lootsplit.account-recovery.v1:")).map(([, value]) => JSON.parse(value)); }

test("fresh signed-in profile opens the authoritative campaign with no old cache", async () => {
  const f = await fixture();
  try {
    await f.client.resumeAccountMembership(f.member);
    assert.equal(f.calls.reloads, 1);
    assert.equal(savedSession(f).revision, 0, "Hydration must finish before persisting a remote revision");
    assert.deepEqual(savedSession(f).pending, []);
    assert.equal(f.calls.submissions, 0);
    await f.client.refreshShared();
    assert.deepEqual(f.calls.applied, [f.remote.table]);
    assert.equal(savedSession(f).revision, f.remote.revision);
  } finally { f.close(); }
});

test("same-campaign active DM with a lost Live acknowledgement can resume", async () => {
  const f = await fixture();
  try {
    f.local.setItem("quire.campaign.v1", f.targetKey.slice("quire.cloud.v2.".length));
    f.local.setItem(f.targetKey, JSON.stringify(f.cached));
    f.remote.acknowledged = ["action-1"];
    f.client.assertAccountResumeAllowed(f.member.code);
    await f.client.resumeAccountMembership(f.member);
    assert.deepEqual(savedSession(f).pending, []);
    assert.equal(f.calls.submissions, 0);
    assert.equal(f.calls.locks.length, 1, "Same active/target DB must not acquire the same lock twice");
  } finally { f.close(); }
});

test("a genuine unfinished turn reopens with original commands and retry identity, not an automatic submit", async () => {
  const f = await fixture();
  try {
    f.local.setItem(f.targetKey, JSON.stringify(f.cached));
    f.remote.live = false;
    f.remote.draft = JSON.stringify(f.cached.pending);
    await f.client.resumeAccountMembership(f.member);
    assert.deepEqual(savedSession(f).pending, f.cached.pending);
    assert.equal(savedSession(f).batchId, f.cached.batchId);
    await f.client.refreshShared();
    assert.deepEqual(savedSession(f).pending, f.cached.pending);
    assert.equal(f.client.getCloudTable().pending, 1);
    assert.equal(f.client.getCloudTable().live, false);
    assert.equal(f.calls.submissions, 0);
  } finally { f.close(); }
});

test("unacknowledged Live changes remain accessible to Retry and Export after resume", async () => {
  const f = await fixture();
  try {
    f.local.setItem(f.targetKey, JSON.stringify(f.cached));
    await f.client.resumeAccountMembership(f.member);
    await f.client.refreshShared();
    assert.deepEqual(f.client.pendingActions(), [{ id: "action-1", kind: "patch" }]);
    assert.equal(savedSession(f).batchId, "original-batch");
    assert.equal(f.client.getCloudTable().status, "pending");
    assert.equal(f.calls.submissions, 0);
  } finally { f.close(); }
});

test("a newer server draft is not assigned an already-acknowledged batch ID", async () => {
  const f = await fixture();
  try {
    f.local.setItem(f.targetKey, JSON.stringify(f.cached));
    f.remote.acknowledged = ["action-1"];
    const newer = [{ id: "new-draft", kind: "patch", changes: [] }];
    f.remote.draft = JSON.stringify(newer);
    await f.client.resumeAccountMembership(f.member);
    assert.deepEqual(savedSession(f).pending, newer);
    assert.notEqual(savedSession(f).batchId, f.cached.batchId);
    assert.equal(f.calls.submissions, 0);
  } finally { f.close(); }
});

test("partly acknowledged queue retains outstanding command IDs without reusing a completed batch", async () => {
  const f = await fixture();
  try {
    f.cached.pending.push({ id: "still-unsynced", kind: "patch", changes: [] });
    f.local.setItem(f.targetKey, JSON.stringify(f.cached));
    f.remote.acknowledged = ["action-1"];
    await f.client.resumeAccountMembership(f.member);
    assert.deepEqual(savedSession(f).pending, [f.cached.pending[1]]);
    assert.notEqual(savedSession(f).batchId, f.cached.batchId);
    assert.equal(f.calls.submissions, 0);
  } finally { f.close(); }
});

test("divergent device actions are preserved separately while the server draft reopens", async () => {
  const f = await fixture();
  try {
    f.local.setItem(f.targetKey, JSON.stringify(f.cached));
    const draft = [{ id: "server-draft", kind: "patch", changes: [] }];
    f.remote.draft = JSON.stringify(draft);
    await f.client.resumeAccountMembership(f.member);
    assert.deepEqual(savedSession(f).pending, draft);
    const [copy] = recoveries(f);
    assert.deepEqual(copy.commands, f.cached.pending);
    assert.equal(copy.batchId, f.cached.batchId);
    assert.equal(copy.seatId, f.cached.seatId);
    assert.equal("token" in copy, false);
    assert.equal(f.calls.submissions, 0);
  } finally { f.close(); }
});

test("previous-seat cached actions are not replayed using current DM permissions", async () => {
  const f = await fixture();
  try {
    const old = { ...f.cached, role: "player", token: "old-token", seatId: "old-seat" };
    f.local.setItem(f.targetKey, JSON.stringify(old));
    await f.client.resumeAccountMembership(f.member);
    assert.deepEqual(savedSession(f).pending, []);
    assert.equal(recoveries(f)[0].role, "player");
    assert.equal(recoveries(f)[0].seatId, "old-seat");
    assert.deepEqual(recoveries(f)[0].commands, old.pending);
    assert.equal(f.calls.submissions, 0);
  } finally { f.close(); }
});

test("another local alias queue is not lost when selecting the canonical account DB", async () => {
  const f = await fixture();
  try {
    const active = { ...f.cached, batchId: "active-batch", pending: [{ id: "active-action", kind: "patch", changes: [] }] };
    const raw = JSON.stringify(active);
    f.local.setItem("quire.cloud.v2.main", raw);
    f.local.setItem(f.targetKey, JSON.stringify(f.cached));
    await f.client.resumeAccountMembership(f.member);
    assert.equal(f.local.getItem("quire.cloud.v2.main"), raw);
    assert.deepEqual(savedSession(f).pending, active.pending);
    assert.equal(savedSession(f).batchId, "active-batch");
    assert.deepEqual(recoveries(f)[0].commands, f.cached.pending);
  } finally { f.close(); }
});

test("a conflicting preview still loads server progress and retains unsynced actions", async () => {
  const f = await fixture();
  try {
    f.local.setItem(f.targetKey, JSON.stringify(f.cached));
    f.mocks.applyCommand = () => { throw Error("A newer server edit conflicts"); };
    await f.client.resumeAccountMembership(f.member);
    await f.client.refreshShared();
    assert.deepEqual(f.calls.applied, [f.remote.table]);
    assert.deepEqual(savedSession(f).pending, f.cached.pending);
    assert.equal(savedSession(f).batchId, "original-batch");
    assert.equal(f.client.getCloudTable().status, "attention");
    assert.match(f.client.getCloudTable().error, /conflicts/);
    assert.equal(f.calls.submissions, 0);
  } finally { f.close(); }
});

test("interrupted hydration leaves a durable zero revision so a reload can recover", async () => {
  const f = await fixture();
  try {
    await f.client.resumeAccountMembership(f.member);
    f.mocks.applyCloudTable = async () => { throw Error("Synthetic transaction abort"); };
    await assert.rejects(f.client.refreshShared(), /transaction abort/);
    assert.equal(savedSession(f).revision, 0);
  } finally { f.close(); }
});

test("changed account and invalid server membership never switch or modify the destination", async () => {
  for (const change of [
    f => f.tab.setItem("lootsplit.verified-account", "another-user"),
    f => { f.remote.seatId = "different-seat"; },
    f => { f.remote.seats[0].role = "player"; },
    f => { f.remote.code = "OTHER123"; },
  ]) {
    const f = await fixture();
    try {
      const raw = JSON.stringify(f.cached);
      f.local.setItem(f.targetKey, raw);
      change(f);
      await assert.rejects(f.client.resumeAccountMembership(f.member));
      assert.equal(f.local.getItem(f.targetKey), raw);
      assert.equal(f.calls.reloads, 0);
      assert.deepEqual(f.calls.selected, []);
    } finally { f.close(); }
  }
});

test("an account change during the read aborts without applying the previous account's data", async () => {
  const f = await fixture();
  try {
    f.mocks.pullCloudTable = async () => { f.tab.setItem("lootsplit.verified-account", "different-user"); return f.remote; };
    await assert.rejects(f.client.resumeAccountMembership(f.member), /changed/);
    assert.equal(f.calls.reloads, 0);
    assert.deepEqual(f.calls.selected, []);
  } finally { f.close(); }
});

test("malformed pending cache and busy target lock are retained rather than bypassed", async () => {
  const f = await fixture();
  try {
    f.local.setItem(f.targetKey, "{broken");
    await assert.rejects(f.client.resumeAccountMembership(f.member), /could not be read/);
    assert.equal(f.local.getItem(f.targetKey), "{broken");
    navigator.locks.request = async (key, options, run) => run(key === f.targetKey + ".write" ? null : {});
    await assert.rejects(f.client.resumeAccountMembership(f.member), /tab/);
    assert.equal(f.calls.reloads, 0);
  } finally { f.close(); }
});

test("recovery storage failure must not replace the only copy of unsynced work", async () => {
  const f = await fixture();
  try {
    const raw = JSON.stringify({ ...f.cached, token: "old-token" });
    f.local.setItem(f.targetKey, raw);
    const write = f.local.setItem;
    f.local.setItem = (key, value) => {
      if (key.startsWith("lootsplit.account-recovery.v1:")) throw Error("Synthetic storage quota");
      return write(key, value);
    };
    await assert.rejects(f.client.resumeAccountMembership(f.member), /quota/);
    assert.equal(f.local.getItem(f.targetKey), raw);
    assert.equal(f.calls.reloads, 0);
    assert.deepEqual(f.calls.selected, []);
  } finally { f.close(); }
});

test("a stale guest reconnect ticket cannot override the verified DM selection", async () => {
  const f = await fixture();
  try {
    f.tab.setItem("lootsplit.player.reconnect.v1", JSON.stringify({ code: "OTHER123", token: "old-guest", role: "player" }));
    f.mocks.setEphemeralCampaign(true);
    await f.client.resumeAccountMembership(f.member);
    assert.equal(f.tab.getItem("lootsplit.player.reconnect.v1"), null);
    assert.equal(savedSession(f).role, "dm");
    assert.equal(f.calls.reloads, 1);
  } finally { f.close(); }
});

test("prefix-compatible server and device drafts preserve the longer queue without duplicate actions", async () => {
  for (const serverLonger of [true, false]) {
    const f = await fixture();
    try {
      const more = { id: "action-2", kind: "patch", changes: [] };
      if (!serverLonger) f.cached.pending.push(more);
      f.local.setItem(f.targetKey, JSON.stringify(f.cached));
      f.remote.draft = JSON.stringify(serverLonger ? [...f.cached.pending, more] : [f.cached.pending[0]]);
      await f.client.resumeAccountMembership(f.member);
      assert.deepEqual(savedSession(f).pending.map(c => c.id), ["action-1", "action-2"]);
      assert.equal(savedSession(f).batchId, "original-batch");
      assert.equal(recoveries(f).length, 0);
      assert.equal(f.calls.submissions, 0);
    } finally { f.close(); }
  }
});

test("failed authoritative read leaves source and target sessions untouched", async () => {
  const f = await fixture();
  try {
    const raw = JSON.stringify(f.cached);
    f.local.setItem(f.targetKey, raw);
    f.mocks.pullCloudTable = async () => { throw Error("Synthetic network failure"); };
    await assert.rejects(f.client.resumeAccountMembership(f.member), /network failure/);
    assert.equal(f.local.getItem(f.targetKey), raw);
    assert.equal(f.calls.reloads, 0);
    assert.deepEqual(f.calls.selected, []);
  } finally { f.close(); }
});

test("recovery imports carrying a different seat or role cannot change the current queue", async () => {
  const f = await fixture();
  try {
    f.local.setItem(f.targetKey, JSON.stringify(f.cached));
    await f.client.resumeAccountMembership(f.member);
    for (const wrong of [{ seatId: "old-seat" }, { role: "player" }]) {
      const file = new File([JSON.stringify({ code: f.member.code, commands: f.cached.pending, ...wrong })], "recovery.json");
      await assert.rejects(f.client.importPending(file), /different seat/);
      assert.deepEqual(savedSession(f).pending, f.cached.pending);
      assert.equal(f.calls.submissions, 0);
    }
  } finally { f.close(); }
});

test("recovery records are account and campaign scoped, append-only and deduplicated", async () => {
  const { readResumeRecoveries, saveResumeRecoveries } = await import("../src/lib/quire/account-resume.ts");
  const local = storage();
  const source = { code: "ROOM0001", token: "never-export", seatId: "seat", role: "dm", purseIds: [], revision: 3, pending: [{ kind: "patch", id: "one", changes: [] }], batchId: "batch" };
  const work = [{ session: source, reason: "Synthetic recovery" }];
  saveResumeRecoveries(local, "first-user", source.code, work);
  saveResumeRecoveries(local, "first-user", source.code, work);
  assert.equal(readResumeRecoveries(local, "first-user", source.code).length, 1);
  assert.equal(readResumeRecoveries(local, "second-user", source.code).length, 0);
  assert.equal(readResumeRecoveries(local, "first-user", "ROOM0002").length, 0);
  assert.ok([...local.values.values()].every(value => !value.includes("never-export")));
  const old = [...local.values.entries()];
  source.pending.push({ kind: "patch", id: "two", changes: [] });
  saveResumeRecoveries(local, "first-user", source.code, work);
  assert.equal(readResumeRecoveries(local, "first-user", source.code).length, 2);
  for (const [key, value] of old) assert.equal(local.getItem(key), value);
});
