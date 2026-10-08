import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  accountBackupSummary,
  backupConfirmation,
  pendingCommandDescription,
  assertBackupPreviewContext,
} from "../src/lib/account/backup-presentation.ts";
const file = () => ({
  kind: "quire",
  version: 1,
  exportedAt: 123,
  books: [],
  articles: [],
  purses: [],
  holdings: [],
  shops: [],
  stock: [],
  ledger: [],
});
test("reviewed backups cannot commit to a changed campaign or password policy", () => {
  const gate = {
    salt: "synthetic-salt",
    hash: "synthetic-hash",
    protectSaves: true,
    iterations: 210000,
  };
  const before = structuredClone(gate);
  assert.doesNotThrow(() =>
    assertBackupPreviewContext(
      { campaignId: "first", gate },
      { campaignId: "first", gate: { ...gate } },
    ),
  );
  for (const current of [
    { campaignId: "second", gate },
    { campaignId: "first", gate: null },
    { campaignId: "first", gate: { ...gate, protectSaves: false } },
    { campaignId: "first", gate: { ...gate, hash: "changed" } },
  ])
    assert.throws(
      () => assertBackupPreviewContext({ campaignId: "first", gate }, current),
      /changed.*Review/,
    );
  assert.deepEqual(gate, before);
  assert.equal(accountBackupSummary({ ...file(), exportedAt: Number.MAX_VALUE }).capturedAt, null);
});
test("backup presentation validates before counting without changing old copy", () => {
  const original = file();
  const before = JSON.stringify(original);
  const summary = accountBackupSummary(original);
  assert.equal(summary.version, 1);
  assert.equal(summary.counts["Private PDFs"], 0);
  assert.equal(summary.supplementalRecovery, false);
  assert.equal(JSON.stringify(original), before);
  assert.throws(
    () => accountBackupSummary({ ...original, books: [{}] }),
    /invalid or missing data/,
  );
  assert.throws(() => accountBackupSummary({ ...original, holdings: [{ id: "bad" }] }));
});
test("backup destinations stay separate and supplemental history is not certified", () => {
  const summary = accountBackupSummary({ ...file(), campaignRecovery: { version: 1 } });
  assert.match(backupConfirmation(summary, true), /only you as DM/);
  assert.match(backupConfirmation(summary, true), /server validates/);
  assert.match(backupConfirmation(summary, false), /new device campaign/);
  assert.match(backupConfirmation(summary, false), /original backup will remain/);
});
test("authorized pending previews never reveal private text or bearer fields", () => {
  const secret = "synthetic private text";
  assert.match(
    pendingCommandDescription({
      id: "1",
      kind: "message",
      to: "dm",
      purseId: "p",
      text: secret,
      token: "synthetictoken",
    }),
    /text kept/,
  );
  assert.ok(
    !pendingCommandDescription({
      id: "1",
      kind: "message",
      to: "dm",
      purseId: "p",
      text: secret,
    }).includes(secret),
  );
  assert.match(
    pendingCommandDescription({ id: "2", kind: "buy", purseId: "p", stockId: "s", quantity: 2 }),
    /Purchase 2 units/,
  );
  assert.match(
    pendingCommandDescription({ kind: "unknown", token: "neverprint" }),
    /Unreadable action/,
  );
});
