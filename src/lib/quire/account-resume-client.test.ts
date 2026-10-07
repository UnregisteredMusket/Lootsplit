import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { reconcileAccountResume } from "./account-resume.ts";

// Execute the actual exported client function with isolated storage/transport.
// Browser coverage separately exercises its real UI entry points and backend.
const source = readFileSync(
  new URL("./cloud-client.ts", import.meta.url),
  "utf8",
);
const body = source
  .slice(
    source.indexOf("export async function resumeAccountMembership("),
    source.indexOf("export async function clearAccountRoom"),
  )
  .replace("export async function", "async function")
  .replace('await import("./campaigns")', "campaigns");
const build = new Function(
  "serial",
  "session",
  "sessionStorage",
  "localStorage",
  "pullCloudTable",
  "campaigns",
  "stopPolling",
  "setEphemeralCampaign",
  "closeQuireDb",
  "remember",
  "reloadCampaignContext",
  "reconcileAccountResume",
  "key",
  stripTypeScriptTypes(body) + "; return resumeAccountMembership;",
);
const member = {
  code: "TEST",
  token: "token",
  seatId: "dm",
  userId: "owner",
  name: "Disposable campaign",
};
const pending = [{ id: "action", kind: "patch", changes: [] }];
const saved = {
  ...member,
  role: "dm",
  pending,
  revision: 2,
  batchId: "original-batch",
  purseIds: [],
};
function harness(
  options: {
    cached?: object;
    current?: object;
    acknowledged?: string[];
    draft?: object[];
    account?: string;
    failRecovery?: boolean;
    seatId?: string;
  } = {},
) {
  const id = "account-owner-TEST",
    key = `quire.cloud.v2.${id}`;
  const values = new Map([[key, JSON.stringify(options.cached ?? null)]]);
  let selected = false,
    reloaded = false;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options.failRecovery && key.startsWith("quire.account-recovery"))
        throw Error("Storage full");
      values.set(key, value);
    },
  };
  const resume = build(
    (fn: () => unknown) => fn(),
    () => options.current ?? null,
    { getItem: () => options.account ?? "owner" },
    storage,
    async () => ({
      code: "TEST",
      seatId: options.seatId ?? "dm",
      seats: [{ id: "dm", role: "dm" }],
      purseIds: [],
      shopIds: [],
      revision: 3,
      acknowledged: options.acknowledged ?? [],
      draft: JSON.stringify(options.draft ?? []),
    }),
    {
      selectAccountCampaign: () => {
        selected = true;
      },
    },
    () => {},
    () => {},
    () => {},
    (value: object) => storage.setItem(key, JSON.stringify(value)),
    () => {
      reloaded = true;
    },
    reconcileAccountResume,
    () => key,
  );
  return {
    resume: () => resume(member),
    values,
    key,
    selected: () => selected,
    reloaded: () => reloaded,
  };
}
test("actual resume opens a cache with acknowledged stale Live actions", async () => {
  const h = harness({ cached: saved, acknowledged: ["action"] });
  await h.resume();
  assert.equal(h.selected(), true);
  assert.equal(h.reloaded(), true);
  assert.deepEqual(JSON.parse(h.values.get(h.key)!).pending, []);
  assert.equal(
    [...h.values.keys()].some((key) =>
      key.startsWith("quire.account-recovery"),
    ),
    false,
  );
});
test("actual resume exposes genuine unsynced actions with original batch ID", async () => {
  const h = harness({ cached: saved });
  await h.resume();
  const session = JSON.parse(h.values.get(h.key)!);
  assert.deepEqual(session.pending, pending);
  assert.equal(session.batchId, "original-batch");
  assert.equal(session.revision, -1);
});
test("current same-campaign pending queue does not prematurely block resume", async () => {
  const h = harness({
    cached: saved,
    current: saved,
    acknowledged: ["action"],
  });
  await h.resume();
  assert.equal(h.reloaded(), true);
});
test("unrelated campaign pending work blocks switching without changing either cache", async () => {
  const h = harness({ cached: saved, current: { ...saved, code: "OTHER" } });
  const before = h.values.get(h.key);
  await assert.rejects(h.resume(), /before switching campaigns/);
  assert.equal(h.values.get(h.key), before);
  assert.equal(h.selected(), false);
});
test("changed cached seat is archived without replay under authenticated seat", async () => {
  const h = harness({ cached: { ...saved, seatId: "old-seat" } });
  await h.resume();
  assert.deepEqual(JSON.parse(h.values.get(h.key)!).pending, []);
  const recovery = JSON.parse(
    [...h.values.entries()].find(([key]) =>
      key.startsWith("quire.account-recovery"),
    )![1],
  );
  assert.equal(recovery.separateSeat, true);
  assert.equal(recovery.seatId, "old-seat");
  assert.equal("token" in recovery, false);
});
test("failed durable recovery write leaves cache and selected campaign unchanged", async () => {
  const h = harness({
    cached: { ...saved, seatId: "old-seat" },
    failRecovery: true,
  });
  const before = h.values.get(h.key);
  await assert.rejects(h.resume(), /Storage full/);
  assert.equal(h.values.get(h.key), before);
  assert.equal(h.selected(), false);
});
test("different account cannot read or replace this cache", async () => {
  const h = harness({ cached: saved, account: "other" });
  const before = h.values.get(h.key);
  await assert.rejects(h.resume(), /account that owns/);
  assert.equal(h.values.get(h.key), before);
});
test("server changed-seat rejection precedes all local writes", async () => {
  const h = harness({ cached: saved, seatId: "new-seat" });
  const before = h.values.get(h.key);
  await assert.rejects(h.resume(), /membership has changed/);
  assert.equal(h.values.get(h.key), before);
  assert.equal(h.selected(), false);
});
