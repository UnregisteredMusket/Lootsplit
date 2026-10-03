import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { verifyRemote } from "./standby-remote-check.mjs";

test("remote rehearsal verifies recovery and leaves its dedicated database empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "standby-rehearsal-test-"));
  const factory = () => createClient({ url: `file:${join(dir,"database.db")}` });
  try {
    await verifyRemote({ databaseUrl: "libsql://lootsplit-standby-test.turso.io", authToken: "synthetic", factory });
    const client = factory();
    try { assert.equal((await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.length, 0); }
    finally { client.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("remote rehearsal refuses unrelated hosts and populated databases without changing them", async () => {
  await assert.rejects(verifyRemote({ databaseUrl: "libsql://production.turso.io", authToken: "synthetic" }), /dedicated/);
  const dir = mkdtempSync(join(tmpdir(), "standby-rehearsal-refusal-"));
  const factory = () => createClient({ url: `file:${join(dir,"database.db")}` });
  const client = factory();
  try {
    await client.execute("CREATE TABLE real_data(value TEXT)");
    await client.execute("INSERT INTO real_data VALUES('preserved')");
    await assert.rejects(verifyRemote({ databaseUrl: "libsql://lootsplit-standby-test.turso.io", authToken: "synthetic", factory }), /empty/);
    assert.equal((await client.execute("SELECT value FROM real_data")).rows[0].value, "preserved");
  } finally { client.close(); rmSync(dir, { recursive: true, force: true }); }
});
