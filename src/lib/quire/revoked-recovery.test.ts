import test from "node:test";
import assert from "node:assert/strict";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  };
}
async function harness() {
  const prior = {
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
  };
  const local = storage(),
    session = storage();
  session.setItem("lootsplit.verified-account", "owner-a");
  Object.assign(globalThis, { localStorage: local, sessionStorage: session });
  const reload = () =>
    import(new URL("./revoked-recovery.ts?test=" + crypto.randomUUID(), import.meta.url).href);
  return {
    local,
    session,
    recovery: await reload(),
    reload,
    restore: () => Object.assign(globalThis, prior),
  };
}
const key = "lootsplit.revoked-recovery:OWNED";
const raw = JSON.stringify({
  code: "OWNED",
  seatId: "old-seat",
  batchId: "old-batch",
  commands: [{ id: "old-action", kind: "patch", changes: [] }],
  exportedAt: 1,
  token: "never-export-this",
});

test("verified legacy recovery stays available after reload without changing original bytes or exposing credentials", async () => {
  const h = await harness();
  try {
    h.local.setItem(key, raw);
    h.recovery.authorizeLegacyRecovery("owner-a", [{ code: "OWNED", role: "dm" }]);
    const loaded = await h.reload();
    assert.equal(
      loaded.legacyRecoveryCount(),
      0,
      "Verified ownership must survive a new module/document",
    );
    const copy = loaded.revokedRecoverySummaries()[0];
    assert.equal(copy.pending, 1);
    assert.equal(h.local.getItem(key), raw, "Keep original legacy bytes unchanged");
    assert.equal(
      JSON.stringify(loaded.revokedRecoveryCopy(copy.id)).includes("never-export-this"),
      false,
    );
    h.session.setItem("lootsplit.verified-account", "owner-b");
    assert.deepEqual(loaded.revokedRecoverySummaries(), []);
    assert.equal(loaded.legacyRecoveryCount(), 1);
    assert.throws(() => loaded.revokedRecoveryCopy(copy.id), /account that owns/);
    assert.equal(h.local.getItem(key), raw);
  } finally {
    h.restore();
  }
});

test("an unmatched ownership check reports its result and preserves private and unreadable copies across reload", async () => {
  const h = await harness();
  try {
    h.local.setItem(key, raw);
    h.local.setItem("lootsplit.revoked-recovery:UNREADABLE", "{broken");
    const result = h.recovery.authorizeLegacyRecovery("owner-a", [
      { code: "OWNED", role: "player" },
    ]);
    assert.deepEqual(result, { verified: 0, remaining: 2, durable: true });
    assert.equal(h.recovery.legacyRecoveryChecked(), true);
    const loaded = await h.reload();
    assert.equal(loaded.legacyRecoveryChecked(), true);
    assert.deepEqual(loaded.revokedRecoverySummaries(), []);
    assert.equal(h.local.getItem(key), raw);
    assert.equal(h.local.getItem("lootsplit.revoked-recovery:UNREADABLE"), "{broken");
    h.local.setItem("lootsplit.revoked-recovery:NEW", raw);
    assert.equal(loaded.legacyRecoveryChecked(), false, "New copies need a new check");
    h.session.setItem("lootsplit.verified-account", "owner-b");
    assert.equal(loaded.legacyRecoveryChecked(), false);
  } finally {
    h.restore();
  }
});

test("discarding verified legacy work removes only its matching original and verified copy", async () => {
  const h = await harness();
  try {
    h.local.setItem(key, raw);
    h.local.setItem("lootsplit.revoked-recovery:OTHER", "{unreadable");
    h.recovery.authorizeLegacyRecovery("owner-a", [{ code: "OWNED", role: "dm" }]);
    const loaded = await h.reload();
    const copy = loaded.revokedRecoverySummaries()[0];
    assert.ok(copy);
    loaded.discardRevokedRecovery(copy.id);
    assert.equal(h.local.getItem(key), null);
    assert.deepEqual((await h.reload()).revokedRecoverySummaries(), []);
    assert.equal(h.local.getItem("lootsplit.revoked-recovery:OTHER"), "{unreadable");
  } finally {
    h.restore();
  }
});

test("a replaced original is not mistaken for previously verified commands or erased by discarding the old copy", async () => {
  const h = await harness();
  try {
    h.local.setItem(key, raw);
    h.recovery.authorizeLegacyRecovery("owner-a", [{ code: "OWNED", role: "dm" }]);
    const changed = raw.replace("old-action", "different-action");
    h.local.setItem(key, changed);
    const loaded = await h.reload();
    assert.equal(loaded.legacyRecoveryCount(), 1);
    const copy = loaded.revokedRecoverySummaries()[0];
    assert.ok(copy);
    assert.equal(loaded.revokedRecoveryCopy(copy.id).commands[0].id, "old-action");
    loaded.discardRevokedRecovery(copy.id);
    assert.equal(h.local.getItem(key), changed, "Changed unverified work remains untouched");
  } finally {
    h.restore();
  }
});

test("full storage preserves verified work in memory and tells the caller verification was not saved", async () => {
  const h = await harness();
  try {
    h.local.setItem(key, raw);
    h.local.setItem = () => {
      throw Error("Storage full");
    };
    const result = h.recovery.authorizeLegacyRecovery("owner-a", [{ code: "OWNED", role: "dm" }]);
    assert.deepEqual(result, { verified: 1, remaining: 0, durable: false });
    assert.equal(h.recovery.revokedRecoverySummaries()[0].pending, 1);
    assert.equal(h.local.getItem(key), raw);
    assert.equal((await h.reload()).legacyRecoveryCount(), 1);
  } finally {
    h.restore();
  }
});
